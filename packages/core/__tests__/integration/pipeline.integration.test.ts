/**
 * Phase 5.7 — End-to-end pipeline checks (§17.3).
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import {
  CHAT_DEFAULTS,
  Context,
  contextBuilder,
  InvalidConfigError,
  toTokenCount,
  validateContextConfig,
  type ContentItem,
  type ContextPushItemInput,
  type ModelId,
  type ProviderAdapter,
  type ProviderId,
  type Tokenizer,
} from '../../src/index.js';

/** Chat layout with history using FIFO truncate (default chat uses summarize — not implemented). */
const CHAT_TRUNCATE_HISTORY = {
  system: { ...CHAT_DEFAULTS.system, budget: { fixed: 80 } },
  history: {
    ...CHAT_DEFAULTS.history,
    overflow: 'truncate' as const,
  },
};

function stubTokenizer(): Tokenizer {
  return {
    id: 'stub',
    count: () => toTokenCount(0),
    countBatch: (texts) => texts.map(() => toTokenCount(0)),
    countMessage: () => toTokenCount(0),
    countMessages: () => toTokenCount(0),
    encode: () => [],
    decode: () => '',
    truncateToFit: (t) => t,
  };
}

function adapterWithTag(
  id: ProviderId,
  tag: string,
): ProviderAdapter {
  return {
    id,
    resolveModel: (_modelId: ModelId) => ({
      maxContextTokens: 128_000,
      maxOutputTokens: 4096,
      supportsFunctions: true,
      supportsVision: false,
      supportsStreaming: true,
      tokenizerName: 'stub',
    }),
    formatMessages: (messages) => ({ tag, count: messages.length, roles: messages.map((m) => m.role) }),
    getTokenizer: stubTokenizer,
    calculateOverhead: () => toTokenCount(0),
  };
}

function batchRows(count: number, tokensPerRow: number): ContextPushItemInput[] {
  return Array.from({ length: count }, (_, i) => ({
    content: `message-${i}`,
    tokens: toTokenCount(tokensPerRow),
  }));
}

function messagesFingerprint(snapshot: { messages: readonly { role: string; content: unknown }[] }) {
  return snapshot.messages.map((m) => JSON.stringify({ role: m.role, content: m.content }));
}

describe('Pipeline integration (Phase 5.7 — §17.3)', () => {
  it('conversation over tight budget: truncate yields valid snapshot + checksum', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 600,
      reserveForResponse: 0,
      slots: CHAT_TRUNCATE_HISTORY,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('sys');
    ctx.push('history', batchRows(40, 80));

    const { snapshot } = await ctx.build();

    expect(snapshot.messages.length).toBeGreaterThan(0);
    const userMsgs = snapshot.messages.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBeLessThan(40);
    const ser = snapshot.serialize();
    expect(ser.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(ser.version).toBe('1.0');
  });

  it('system prompt preserved when history truncates (priority 100, overflow: error on system)', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: CHAT_TRUNCATE_HISTORY,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('SYSTEM_PROMPT_HOLD');
    ctx.push('history', batchRows(25, 100));

    const { snapshot } = await ctx.build();

    expect(snapshot.messages[0]).toMatchObject({
      role: 'system',
      content: 'SYSTEM_PROMPT_HOLD',
    });
  });

  it('truncate keeps more recent history messages (FIFO drops oldest)', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 500,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 50 },
          defaultRole: 'system',
          position: 'before',
          overflow: 'error',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after',
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('s');
    const n = 14;
    ctx.push('history', batchRows(n, 120));

    const { snapshot } = await ctx.build();

    const userContents = snapshot.messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    expect(userContents.some((c) => c.includes(`message-${n - 1}`))).toBe(true);
    expect(userContents.some((c) => c.includes('message-0'))).toBe(false);
  });

  it('switching provider changes format() payload, not compiled message list', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 4000,
      slots: CHAT_TRUNCATE_HISTORY,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('s');
    ctx.user('u');

    const { snapshot } = await ctx.build({
      providerAdapters: {
        openai: adapterWithTag('openai', 'openai'),
        anthropic: adapterWithTag('anthropic', 'anthropic'),
      },
    });

    const openaiFmt = snapshot.format('openai') as { tag: string; count: number; roles: string[] };
    const anthropicFmt = snapshot.format('anthropic') as { tag: string; count: number; roles: string[] };

    expect(openaiFmt.tag).toBe('openai');
    expect(anthropicFmt.tag).toBe('anthropic');
    expect(JSON.stringify(openaiFmt)).not.toBe(JSON.stringify(anthropicFmt));
    expect(openaiFmt.count).toBe(snapshot.messages.length);
    expect(anthropicFmt.count).toBe(snapshot.messages.length);
    expect(openaiFmt.roles).toEqual(anthropicFmt.roles);
  });

  it('full pipeline: 3 slots, mixed budgets, overflow on flex slot', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 700,
      reserveForResponse: 0,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 120 },
          defaultRole: 'system',
          position: 'before',
          overflow: 'error',
        },
        docs: {
          priority: 80,
          budget: { percent: 25 },
          defaultRole: 'user',
          position: 'before',
          overflow: 'truncate',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after',
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('sys');
    ctx.push('docs', batchRows(8, 90));
    ctx.push('history', batchRows(6, 90));

    const { snapshot } = await ctx.build();

    expect(snapshot.messages.length).toBeGreaterThan(0);
    expect(Object.keys(snapshot.meta.slots).sort()).toEqual(['docs', 'history', 'system']);
    expect(snapshot.serialize().checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('empty user messages: valid snapshot with zero compiled messages', async () => {
    const { snapshot } = await contextBuilder().model('m').preset('chat').build();

    expect(snapshot.messages).toHaveLength(0);
    expect(snapshot.serialize().version).toBe('1.0');
  });

  it('single system message: valid snapshot', async () => {
    const { snapshot } = await contextBuilder()
      .model('m')
      .preset('chat')
      .system('only one')
      .build();

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({ role: 'system', content: 'only one' });
  });

  it('build() twice: equivalent compiled messages (idempotent for content)', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 2000,
      slots: CHAT_TRUNCATE_HISTORY,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('s');
    ctx.user('u1');
    ctx.assistant('a1');

    const first = await ctx.build();
    const second = await ctx.build();

    expect(messagesFingerprint(first.snapshot)).toEqual(messagesFingerprint(second.snapshot));
    expect(first.snapshot.meta.totalTokens).toBe(second.snapshot.meta.totalTokens);
  });

  it('requireAuthoritativeTokenCounts throws without tokenAccountant (§19.1)', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 600,
      reserveForResponse: 0,
      requireAuthoritativeTokenCounts: true,
      slots: CHAT_TRUNCATE_HISTORY,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('x');
    await expect(ctx.build()).rejects.toThrow(InvalidConfigError);
  });

  it('requireAuthoritativeTokenCounts allows build when tokenAccountant is set', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 600,
      reserveForResponse: 0,
      requireAuthoritativeTokenCounts: true,
      slots: CHAT_TRUNCATE_HISTORY,
      tokenAccountant: {
        countItems: (items: readonly ContentItem[]) =>
          items.reduce(
            (n: number, i: ContentItem) =>
              n + (typeof i.content === 'string' ? i.content.length : 0),
            0,
          ),
      },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('hi');
    await expect(ctx.build()).resolves.toBeDefined();
  });
});
