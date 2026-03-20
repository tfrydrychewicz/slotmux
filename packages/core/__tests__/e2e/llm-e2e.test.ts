/**
 * End-to-end tests with real LLM API calls (§17.1).
 *
 * Gated on environment variables — skipped in CI unless secrets are configured.
 * Tagged `@slow` by convention; run with `pnpm vitest run __tests__/e2e/`.
 *
 * Token counting uses `lazyContentItemTokens: true` so slotmux resolves
 * a real tokenizer (gpt-tokenizer) from the model registry at build time.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import {
  Context,
  ContextSnapshot,
  createContext,
  type ContextPlugin,
} from '../../src/index.js';

// ---------------------------------------------------------------------------
// Environment gates
// ---------------------------------------------------------------------------

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY'];

const HAS_OPENAI = typeof OPENAI_KEY === 'string' && OPENAI_KEY.length > 0;
const HAS_ANTHROPIC = typeof ANTHROPIC_KEY === 'string' && ANTHROPIC_KEY.length > 0;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function openaiChat(
  messages: Array<{ role: string; content: string }>,
  options?: { model?: string; tools?: unknown[] },
): Promise<{
  content: string;
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const model = options?.model ?? 'gpt-4o-mini';
  const body: Record<string, unknown> = { model, messages, max_tokens: 256 };
  if (options?.tools) {
    body['tools'] = options.tools;
    body['tool_choice'] = 'auto';
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  return {
    content: json.choices[0]?.message?.content ?? '',
    toolCalls: json.choices[0]?.message?.tool_calls,
    usage: json.usage,
  };
}

async function anthropicChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number } }> {
  const system = systemPrompt ?? messages.find((m) => m.role === 'system')?.content;
  const nonSystemMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      ...(system ? { system } : {}),
      messages: nonSystemMessages,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  const text = json.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  return { content: text, usage: json.usage };
}

function toMessages(snapshot: { messages: readonly { role: string; content: unknown }[] }) {
  return snapshot.messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
  }));
}

// =========================================================================
// 1. Full chatbot conversation with OpenAI — verify token counts
// =========================================================================

describe.skipIf(!HAS_OPENAI)('@slow OpenAI chatbot E2E', { timeout: 30_000 }, () => {
  it('builds a multi-turn context and verifies token counts are plausible', async () => {
    const { config } = createContext({
      model: 'gpt-4o-mini',
      preset: 'chat',
      maxTokens: 128_000,
      reserveForResponse: 4096,
      lazyContentItemTokens: true,
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('You are a helpful assistant that gives brief answers.');
    ctx.user('What is TypeScript?');

    const { snapshot: snap1 } = await ctx.build();
    expect(snap1.messages.length).toBe(2);
    expect(snap1.meta.totalTokens).toBeGreaterThan(0);
    expect(snap1.meta.utilization).toBeGreaterThan(0);
    expect(snap1.meta.utilization).toBeLessThan(1);

    const reply1 = await openaiChat(toMessages(snap1));
    expect(reply1.usage.prompt_tokens).toBeGreaterThan(0);

    ctx.assistant(reply1.content);
    ctx.user('How does it compare to JavaScript?');

    const { snapshot: snap2 } = await ctx.build();
    expect(snap2.messages.length).toBe(4);
    expect(snap2.meta.totalTokens).toBeGreaterThan(snap1.meta.totalTokens);

    const reply2 = await openaiChat(toMessages(snap2));
    expect(reply2.usage.prompt_tokens).toBeGreaterThan(reply1.usage.prompt_tokens);
    expect(reply2.content.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// 2. Full chatbot conversation with Anthropic — verify format
// =========================================================================

describe.skipIf(!HAS_ANTHROPIC)('@slow Anthropic chatbot E2E', { timeout: 30_000 }, () => {
  it('builds context and sends correctly formatted messages to Anthropic', async () => {
    const { config } = createContext({
      model: 'claude-haiku-4-5-20251001',
      preset: 'chat',
      maxTokens: 200_000,
      reserveForResponse: 4096,
      charTokenEstimateForMissing: true,
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('You are a concise assistant. Respond in one sentence.');
    ctx.user('What is the capital of France?');

    const { snapshot } = await ctx.build();

    const systemMsg = snapshot.messages.find((m) => m.role === 'system');
    const userMsgs = snapshot.messages.filter((m) => m.role === 'user');
    expect(systemMsg).toBeDefined();
    expect(userMsgs.length).toBe(1);
    expect(snapshot.meta.totalTokens).toBeGreaterThan(0);

    const systemContent = typeof systemMsg!.content === 'string'
      ? systemMsg!.content
      : '';
    const nonSystemMessages = snapshot.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      }));

    const reply = await anthropicChat(nonSystemMessages, systemContent);
    expect(reply.content.toLowerCase()).toContain('paris');
    expect(reply.usage.input_tokens).toBeGreaterThan(0);
  });
});

// =========================================================================
// 3. RAG pipeline with real embeddings and semantic overflow
// =========================================================================

describe.skipIf(!HAS_OPENAI)('@slow RAG pipeline with semantic overflow E2E', { timeout: 60_000 }, () => {
  it('embeds documents, overflows semantically when slot budget is tight', async () => {
    const embeddingCache = new Map<string, number[]>();

    async function embedFn(text: string): Promise<number[]> {
      const cached = embeddingCache.get(text);
      if (cached) return cached;
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: [text] }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
      const vec = json.data[0]!.embedding;
      embeddingCache.set(text, vec);
      return vec;
    }

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 800,
      reserveForResponse: 100,
      lazyContentItemTokens: true,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 100 },
          defaultRole: 'system',
          position: 'before' as const,
          overflow: 'error',
        },
        docs: {
          priority: 80,
          budget: { fixed: 300 },
          defaultRole: 'user',
          position: 'before' as const,
          overflow: 'semantic',
          overflowConfig: {
            embedFn,
            anchorTo: 'query' as const,
          },
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after' as const,
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('You answer questions about programming languages.');

    const documents = [
      'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static typing and class-based object-oriented programming.',
      'Python is a high-level, interpreted programming language known for its readability and versatility. It supports multiple programming paradigms.',
      'Rust is a systems programming language focused on safety, concurrency, and performance. It prevents segfaults and guarantees thread safety.',
      'Go is a statically typed, compiled language designed at Google. It is known for its simplicity, efficiency, and built-in concurrency support.',
      'Java is a class-based, object-oriented programming language. It follows the write once, run anywhere principle via the JVM.',
      'Kotlin is a modern, cross-platform language that is fully interoperable with Java. It is the preferred language for Android development.',
      'Swift is a powerful programming language developed by Apple for iOS, macOS, and other Apple platforms. It is designed to be safe and fast.',
      'C++ is a general-purpose programming language that extends C with classes and objects. It is widely used in systems programming and game development.',
    ];

    for (const doc of documents) {
      ctx.push('docs', doc);
    }

    ctx.user('Tell me about TypeScript');

    const { snapshot } = await ctx.build();

    expect(snapshot.messages.length).toBeGreaterThan(0);
    const totalBudget = snapshot.meta.totalBudget;
    expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(totalBudget);

    const docSlotMeta = snapshot.meta.slots['docs'];
    expect(docSlotMeta).toBeDefined();
    if (docSlotMeta!.evictedCount > 0) {
      expect(docSlotMeta!.usedTokens).toBeLessThanOrEqual(docSlotMeta!.budgetTokens);
    }
  });
});

// =========================================================================
// 4. Progressive summarization with real LLM summarizer
// =========================================================================

describe.skipIf(!HAS_OPENAI)('@slow Progressive summarization E2E', { timeout: 60_000 }, () => {
  it('summarizes overflowing history via a real LLM call', async () => {
    async function summarizeText(text: string): Promise<string> {
      const reply = await openaiChat([
        { role: 'system', content: 'Summarize the following conversation in 1-2 sentences.' },
        { role: 'user', content: text },
      ]);
      return reply.content;
    }

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      reserveForResponse: 200,
      lazyContentItemTokens: true,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 200 },
          defaultRole: 'system',
          position: 'before' as const,
          overflow: 'error',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after' as const,
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('You are a helpful assistant.');

    const longConversation = [
      { role: 'user' as const, text: 'I need help planning a vacation to Japan. I want to visit Tokyo, Kyoto, and Osaka.' },
      { role: 'assistant' as const, text: 'Great choices! I recommend spending 3-4 days in Tokyo for the temples, markets, and Shibuya area, 2-3 days in Kyoto for shrines and gardens, and 1-2 days in Osaka for street food and entertainment.' },
      { role: 'user' as const, text: 'What about transportation between cities?' },
      { role: 'assistant' as const, text: 'The Japan Rail Pass is your best option. It covers the Shinkansen bullet trains between all three cities. Tokyo to Kyoto is about 2 hours 15 minutes, and Kyoto to Osaka is only about 15 minutes.' },
      { role: 'user' as const, text: 'What is the best time of year to visit?' },
      { role: 'assistant' as const, text: 'Cherry blossom season in late March to mid-April is stunning but crowded. Autumn (October-November) offers beautiful foliage with fewer tourists. Avoid rainy season in June-July and the extreme heat of August.' },
      { role: 'user' as const, text: 'Any hotel recommendations in Tokyo?' },
      { role: 'assistant' as const, text: 'For first-timers, Shinjuku or Shibuya areas are great bases. Consider hotels near major JR stations for easy transportation. Budget options include business hotels like APA or Toyoko Inn. For luxury, try the Park Hyatt or Aman Tokyo.' },
    ];

    for (const msg of longConversation) {
      if (msg.role === 'user') ctx.user(msg.text);
      else ctx.assistant(msg.text);
    }

    const { snapshot: fullSnap } = await ctx.build();
    expect(fullSnap.meta.totalTokens).toBeGreaterThan(0);

    const historyItems = fullSnap.messages.filter((m) => m.role !== 'system');
    const fullText = historyItems
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : ''}`)
      .join('\n');

    const summary = await summarizeText(fullText);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.length).toBeLessThan(fullText.length);

    const { config: config2 } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      reserveForResponse: 200,
      lazyContentItemTokens: true,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 200 },
          defaultRole: 'system',
          position: 'before' as const,
          overflow: 'error',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after' as const,
          overflow: 'truncate',
        },
      },
    });
    const ctx2 = Context.fromParsedConfig(config2);
    ctx2.system('You are a helpful assistant.');
    ctx2.user(`Previous conversation summary: ${summary}`);
    ctx2.user('Can you suggest some must-try dishes in Osaka?');

    const { snapshot: summarySnap } = await ctx2.build();
    expect(summarySnap.meta.totalTokens).toBeGreaterThan(0);
    expect(summarySnap.meta.totalTokens).toBeLessThan(fullSnap.meta.totalTokens);

    const reply = await openaiChat(toMessages(summarySnap));
    expect(reply.content.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// 5. Agent tool loop with real function calling
// =========================================================================

describe.skipIf(!HAS_OPENAI)('@slow Agent tool loop E2E', { timeout: 45_000 }, () => {
  it('runs a tool-use loop with real function calling', async () => {
    const { config } = createContext({
      model: 'gpt-4o-mini',
      preset: 'agent',
      maxTokens: 128_000,
      reserveForResponse: 4096,
      lazyContentItemTokens: true,
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system(
      'You are an assistant with access to a get_weather tool. Use it when the user asks about weather.',
    );
    ctx.user('What is the weather in Paris today?');

    const { snapshot: snap1 } = await ctx.build();
    expect(snap1.meta.totalTokens).toBeGreaterThan(0);

    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' },
            },
            required: ['city'],
          },
        },
      },
    ];

    const reply = await openaiChat(toMessages(snap1), { tools });

    expect(reply.toolCalls).toBeDefined();
    expect(reply.toolCalls!.length).toBeGreaterThan(0);
    expect(reply.toolCalls![0]!.function.name).toBe('get_weather');

    const toolCallArgs = JSON.parse(reply.toolCalls![0]!.function.arguments) as { city: string };
    expect(toolCallArgs.city.toLowerCase()).toContain('paris');

    ctx.assistant(reply.content || '');
    const toolResult = JSON.stringify({ temperature: 18, condition: 'partly cloudy', humidity: 65 });
    ctx.push('history', toolResult);

    const { snapshot: snap2 } = await ctx.build();
    expect(snap2.messages.length).toBeGreaterThan(snap1.messages.length);
    expect(snap2.meta.totalTokens).toBeGreaterThan(snap1.meta.totalTokens);
  });
});

// =========================================================================
// 6. Multi-model — same context sent to OpenAI and Anthropic
// =========================================================================

describe.skipIf(!HAS_OPENAI || !HAS_ANTHROPIC)('@slow Multi-model E2E', { timeout: 45_000 }, () => {
  it('builds the same context and sends to both OpenAI and Anthropic', async () => {
    const systemPrompt = 'You are a helpful assistant. Answer in exactly one sentence.';
    const userQuestion = 'What is the speed of light?';

    const { config: openaiConfig } = createContext({
      model: 'gpt-4o-mini',
      preset: 'chat',
      maxTokens: 128_000,
      reserveForResponse: 256,
      lazyContentItemTokens: true,
    });
    const openaiCtx = Context.fromParsedConfig(openaiConfig);
    openaiCtx.system(systemPrompt);
    openaiCtx.user(userQuestion);

    const { config: anthropicConfig } = createContext({
      model: 'claude-haiku-4-5-20251001',
      preset: 'chat',
      maxTokens: 200_000,
      reserveForResponse: 256,
      charTokenEstimateForMissing: true,
    });
    const anthropicCtx = Context.fromParsedConfig(anthropicConfig);
    anthropicCtx.system(systemPrompt);
    anthropicCtx.user(userQuestion);

    const { snapshot: openaiSnap } = await openaiCtx.build();
    const { snapshot: anthropicSnap } = await anthropicCtx.build();

    expect(openaiSnap.messages.length).toBe(anthropicSnap.messages.length);
    expect(openaiSnap.messages.map((m) => m.role)).toEqual(
      anthropicSnap.messages.map((m) => m.role),
    );

    const openaiReply = await openaiChat(toMessages(openaiSnap));

    const anthropicNonSystem = anthropicSnap.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
    const anthropicReply = await anthropicChat(anthropicNonSystem, systemPrompt);

    expect(openaiReply.content.length).toBeGreaterThan(0);
    expect(anthropicReply.content.length).toBeGreaterThan(0);

    const bothMentionLight =
      openaiReply.content.toLowerCase().includes('light') ||
      anthropicReply.content.toLowerCase().includes('light');
    expect(bothMentionLight).toBe(true);
  });
});

// =========================================================================
// 7. Snapshot serialize → deserialize → re-build identical output
// =========================================================================

describe('@slow Snapshot round-trip E2E', { timeout: 15_000 }, () => {
  it('serializes and deserializes a snapshot, producing identical messages', async () => {
    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      reserveForResponse: 500,
      lazyContentItemTokens: true,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 500 },
          defaultRole: 'system',
          position: 'before' as const,
          overflow: 'error',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after' as const,
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('You are a helpful AI assistant specializing in science.');
    ctx.user('Explain quantum entanglement in simple terms.');
    ctx.assistant(
      'Quantum entanglement is when two particles become connected so that measuring one instantly affects the other, no matter how far apart they are.',
    );
    ctx.user('Is it really instant?');

    const { snapshot } = await ctx.build();

    expect(snapshot.meta.totalTokens).toBeGreaterThan(0);

    const serialized = snapshot.serialize();
    expect(serialized.version).toBe('1.0');
    expect(serialized.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized.model).toBe('gpt-4o-mini');

    const restored = ContextSnapshot.deserialize(serialized);

    expect(restored.messages.length).toBe(snapshot.messages.length);
    for (let i = 0; i < snapshot.messages.length; i++) {
      expect(restored.messages[i]!.role).toBe(snapshot.messages[i]!.role);
      expect(restored.messages[i]!.content).toEqual(snapshot.messages[i]!.content);
    }

    expect(restored.meta.totalTokens).toBe(snapshot.meta.totalTokens);
    expect(restored.meta.utilization).toBe(snapshot.meta.utilization);
    expect(restored.meta.buildTimeMs).toBe(snapshot.meta.buildTimeMs);

    const reSerialized = restored.serialize();
    expect(reSerialized.checksum).toBe(serialized.checksum);

    const ctx2 = Context.fromParsedConfig(config);
    ctx2.system('You are a helpful AI assistant specializing in science.');
    ctx2.user('Explain quantum entanglement in simple terms.');
    ctx2.assistant(
      'Quantum entanglement is when two particles become connected so that measuring one instantly affects the other, no matter how far apart they are.',
    );
    ctx2.user('Is it really instant?');

    const { snapshot: snap2 } = await ctx2.build();
    expect(snap2.messages.length).toBe(snapshot.messages.length);
    for (let i = 0; i < snapshot.messages.length; i++) {
      expect(snap2.messages[i]!.role).toBe(snapshot.messages[i]!.role);
      expect(snap2.messages[i]!.content).toEqual(snapshot.messages[i]!.content);
    }
  });
});

// =========================================================================
// 8. Checkpoint → restore → continue conversation
// =========================================================================

describe('@slow Checkpoint / restore E2E', { timeout: 15_000 }, () => {
  it('checkpoints, mutates, restores, and continues the conversation', async () => {
    const { config } = createContext({
      model: 'gpt-4o-mini',
      preset: 'chat',
      maxTokens: 128_000,
      reserveForResponse: 4096,
      lazyContentItemTokens: true,
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('You are a helpful assistant.');
    ctx.user('Hello');
    ctx.assistant('Hi there! How can I help you today?');

    const cp = ctx.checkpoint();
    expect(cp.version).toBe('1.0');
    expect(cp.seq).toBe(1);
    expect(cp.changedSincePrevious).toContain('history');

    const { snapshot: snapBeforeMutation } = await ctx.build();
    expect(snapBeforeMutation.meta.totalTokens).toBeGreaterThan(0);

    ctx.user('This is a tangent I want to undo.');
    ctx.assistant('OK, going on a tangent...');
    ctx.user('Actually, let me undo.');

    const { snapshot: snapAfterMutation } = await ctx.build();
    expect(snapAfterMutation.messages.length).toBeGreaterThan(snapBeforeMutation.messages.length);

    ctx.restore(cp);

    const { snapshot: snapAfterRestore } = await ctx.build();
    expect(snapAfterRestore.messages.length).toBe(snapBeforeMutation.messages.length);

    for (let i = 0; i < snapBeforeMutation.messages.length; i++) {
      expect(snapAfterRestore.messages[i]!.role).toBe(snapBeforeMutation.messages[i]!.role);
      expect(snapAfterRestore.messages[i]!.content).toEqual(snapBeforeMutation.messages[i]!.content);
    }

    ctx.user('What is 2 + 2?');
    const { snapshot: snapContinued } = await ctx.build();
    expect(snapContinued.messages.length).toBe(snapBeforeMutation.messages.length + 1);

    const lastMsg = snapContinued.messages[snapContinued.messages.length - 1];
    expect(lastMsg!.role).toBe('user');
    expect(lastMsg!.content).toBe('What is 2 + 2?');
  });
});

// =========================================================================
// 9. Plugin lifecycle hooks fire in correct order
// =========================================================================

describe('@slow Plugin lifecycle E2E', { timeout: 15_000 }, () => {
  it('fires all plugin lifecycle hooks in the expected order', async () => {
    const hookLog: string[] = [];
    let capturedSnapshot: ContextSnapshot | undefined;

    const lifecyclePlugin: ContextPlugin = {
      name: 'lifecycle-tracker',
      version: '1.0.0',

      install() {
        hookLog.push('install');
      },

      prepareSlots(slots) {
        hookLog.push('prepareSlots');
        return slots;
      },

      beforeBudgetResolve(slots) {
        hookLog.push('beforeBudgetResolve');
        return slots;
      },

      afterBudgetResolve() {
        hookLog.push('afterBudgetResolve');
      },

      beforeOverflow(slot, items) {
        hookLog.push(`beforeOverflow:${slot}`);
        return items;
      },

      afterOverflow(slot) {
        hookLog.push(`afterOverflow:${slot}`);
      },

      beforeSnapshot(messages) {
        hookLog.push('beforeSnapshot');
        return messages;
      },

      afterSnapshot(snapshot) {
        hookLog.push('afterSnapshot');
        capturedSnapshot = snapshot;
      },

      onContentAdded(slot) {
        hookLog.push(`onContentAdded:${slot}`);
      },

      onEvent(event) {
        hookLog.push(`onEvent:${event.type}`);
      },

      destroy() {
        hookLog.push('destroy');
      },
    };

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      reserveForResponse: 500,
      lazyContentItemTokens: true,
      plugins: [lifecyclePlugin],
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 500 },
          defaultRole: 'system',
          position: 'before' as const,
          overflow: 'error',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after' as const,
          overflow: 'truncate',
        },
      },
    });

    expect(hookLog).toContain('prepareSlots');

    const ctx = Context.fromParsedConfig(config);

    ctx.system('System prompt');
    ctx.user('User message');

    const { snapshot } = await ctx.build();

    expect(hookLog).toContain('beforeBudgetResolve');
    expect(hookLog).toContain('afterBudgetResolve');
    expect(hookLog).toContain('beforeSnapshot');
    expect(hookLog).toContain('afterSnapshot');

    const budgetIdx = hookLog.indexOf('beforeBudgetResolve');
    const afterBudgetIdx = hookLog.indexOf('afterBudgetResolve');
    const beforeSnapIdx = hookLog.indexOf('beforeSnapshot');
    const afterSnapIdx = hookLog.indexOf('afterSnapshot');

    expect(budgetIdx).toBeLessThan(afterBudgetIdx);
    expect(afterBudgetIdx).toBeLessThan(beforeSnapIdx);
    expect(beforeSnapIdx).toBeLessThan(afterSnapIdx);

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot!.messages.length).toBe(snapshot.messages.length);

    const onEventEntries = hookLog.filter((h) => h.startsWith('onEvent:'));
    expect(onEventEntries.length).toBeGreaterThan(0);
    expect(onEventEntries.some((e) => e.includes('build:'))).toBe(true);
  });
});
