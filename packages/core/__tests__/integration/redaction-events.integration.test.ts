/**
 * Phase 10.2 — Redaction on observability paths (§19.2).
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Context,
  LogLevel,
  validateContextConfig,
} from '../../src/index.js';

const SLOTS = {
  system: {
    priority: 100,
    budget: { fixed: 80 },
    overflow: 'truncate' as const,
    position: 'before' as const,
  },
  history: {
    priority: 50,
    budget: { percent: 100 },
    overflow: 'truncate' as const,
    position: 'after' as const,
  },
};

describe('Redaction on events + logs (Phase 10.2)', () => {
  it('redacts onEvent payloads when redaction: true and logLevel is not TRACE', async () => {
    const onEvent = vi.fn();
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: SLOTS,
      redaction: true,
      onEvent,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('secret 123-45-6789');
    await ctx.build();

    const added = onEvent.mock.calls.find((c) => c[0]?.type === 'content:added');
    expect(added).toBeDefined();
    const item = added![0].item as { content: string };
    expect(item.content).not.toContain('123-45-6789');
    expect(item.content).toContain('[REDACTED]');
  });

  it('does not redact onEvent when logLevel is TRACE', async () => {
    const onEvent = vi.fn();
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: SLOTS,
      redaction: true,
      logLevel: LogLevel.TRACE,
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      onEvent,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('keep 123-45-6789 visible');
    await ctx.build();

    const added = onEvent.mock.calls.find((c) => c[0]?.type === 'content:added');
    expect(added).toBeDefined();
    const item = added![0].item as { content: string };
    expect(item.content).toContain('123-45-6789');
  });

  it('redacts build:complete snapshot in onEvent', async () => {
    const onEvent = vi.fn();
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: SLOTS,
      redaction: true,
      onEvent,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.user('contact u@secret.example');
    await ctx.build();

    const complete = onEvent.mock.calls.find((c) => c[0]?.type === 'build:complete');
    expect(complete).toBeDefined();
    const snap = complete![0].snapshot as { messages: readonly { content: unknown }[] };
    const blob = JSON.stringify(snap.messages);
    expect(blob).not.toContain('u@secret.example');
    expect(blob).toContain('[REDACTED]');
  });
});
