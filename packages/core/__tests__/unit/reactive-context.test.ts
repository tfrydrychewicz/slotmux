/**
 * Phase 12.2 — reactiveContext (§14.2).
 *
 * @packageDocumentation
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SlotOverflow } from '../../src/index.js';
import { reactiveContext } from '../../src/reactive/reactive-context.js';
import { toTokenCount } from '../../src/types/branded.js';
import type { ModelId } from '../../src/types/config.js';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

async function settle(): Promise<void> {
  await flushMicrotasks();
  await flushMicrotasks();
}

async function waitForMeta(ctx: { meta: { value: unknown } }): Promise<void> {
  await vi.waitUntil(() => ctx.meta.value !== undefined, { timeout: 5000 });
}

const baseSlots = {
  system: {
    priority: 100,
    budget: { fixed: 500 },
    defaultRole: 'system' as const,
    position: 'before' as const,
    overflow: SlotOverflow.TRUNCATE,
  },
  history: {
    priority: 50,
    budget: { flex: true as const },
    defaultRole: 'user' as const,
    position: 'after' as const,
    overflow: SlotOverflow.TRUNCATE,
  },
};

describe('reactiveContext (Phase 12.2 — §14.2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('populates meta after initial build and utilization tracks meta', async () => {
    const ctx = reactiveContext({
      model: 'gpt-4o-mini' as ModelId,
      maxTokens: 8000,
      reserveForResponse: 0,
      strictTokenizerPeers: false,
      slots: baseSlots,
      tokenAccountant: {
        countItems: (items) =>
          items.reduce(
            (n, i) => n + (typeof i.content === 'string' ? i.content.length : 0),
            0,
          ),
      },
    });
    await waitForMeta(ctx);
    expect(ctx.meta.value).toBeDefined();
    expect(typeof ctx.utilization.value).toBe('number');
    expect(ctx.utilization.value).toBe(ctx.meta.value!.utilization);
  });

  it('debounces auto-rebuild on mutating calls', async () => {
    const ctx = reactiveContext({
      model: 'gpt-4o-mini' as ModelId,
      maxTokens: 8000,
      reserveForResponse: 0,
      strictTokenizerPeers: false,
      debounceMs: 200,
      slots: baseSlots,
      tokenAccountant: {
        countItems: (items) =>
          items.reduce(
            (n, i) => n + (typeof i.content === 'string' ? i.content.length : 0),
            0,
          ),
      },
    });
    await waitForMeta(ctx);
    vi.useFakeTimers();

    const metaAfterInit = ctx.meta.value;
    expect(metaAfterInit).toBeDefined();

    ctx.user('hello');
    ctx.user(' world');
    await flushMicrotasks();
    expect(ctx.meta.value).toBe(metaAfterInit);

    await vi.advanceTimersByTimeAsync(200);
    await settle();

    expect(ctx.meta.value).not.toBe(metaAfterInit);
    expect(ctx.meta.value!.totalTokens).toBeGreaterThanOrEqual(
      toTokenCount('hello'.length + ' world'.length),
    );

    ctx.dispose();
  });

  it('build() cancels pending debounce and updates meta immediately', async () => {
    const ctx = reactiveContext({
      model: 'gpt-4o-mini' as ModelId,
      maxTokens: 8000,
      reserveForResponse: 0,
      strictTokenizerPeers: false,
      debounceMs: 10_000,
      slots: baseSlots,
      tokenAccountant: {
        countItems: (items) =>
          items.reduce(
            (n, i) => n + (typeof i.content === 'string' ? i.content.length : 0),
            0,
          ),
      },
    });
    await waitForMeta(ctx);
    vi.useFakeTimers();

    ctx.user('sync-build');
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(ctx.getItems('history').length).toBe(1);

    await ctx.build();
    expect(ctx.meta.value!.totalTokens).toBeGreaterThanOrEqual(toTokenCount('sync-build'.length));

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(ctx.meta.value!.totalTokens).toBeGreaterThanOrEqual(toTokenCount('sync-build'.length));

    ctx.dispose();
  });

  it('sets buildError and calls onBuildError when a debounced build fails', async () => {
    const onBuildError = vi.fn();
    const ctx = reactiveContext({
      model: 'gpt-4o-mini' as ModelId,
      maxTokens: 2000,
      reserveForResponse: 0,
      strictTokenizerPeers: false,
      debounceMs: 0,
      onBuildError,
      slots: {
        system: { ...baseSlots.system, budget: { fixed: 100 } },
        history: { ...baseSlots.history, overflow: SlotOverflow.SUMMARIZE },
      },
      tokenAccountant: {
        countItems: (items) =>
          items.reduce(
            (n, i) => n + (typeof i.content === 'string' ? i.content.length : 0),
            0,
          ),
      },
    });

    await waitForMeta(ctx);
    expect(ctx.buildError.value).toBeUndefined();

    ctx.user('x'.repeat(10_000));

    await vi.waitUntil(
      () => ctx.buildError.value !== undefined && onBuildError.mock.calls.length > 0,
      { timeout: 5000 },
    );

    expect(onBuildError).toHaveBeenCalled();
    expect(ctx.buildError.value).toBeDefined();

    ctx.dispose();
  });

  it('dispose clears debounce timer without throwing', async () => {
    const ctx = reactiveContext({
      model: 'gpt-4o-mini' as ModelId,
      maxTokens: 8000,
      reserveForResponse: 0,
      strictTokenizerPeers: false,
      debounceMs: 500,
      slots: baseSlots,
    });
    await waitForMeta(ctx);
    vi.useFakeTimers();
    ctx.user('x');
    ctx.dispose();
    ctx.dispose();
    await vi.advanceTimersByTimeAsync(500);
    await settle();
  });
});
