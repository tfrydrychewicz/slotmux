/**
 * @slotmux/react — hook smoke tests (jsdom).
 *
 * @packageDocumentation
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { SlotOverflow } from 'slotmux';
import { reactiveContext, type ReactiveContextInit } from 'slotmux/reactive';
import { describe, expect, it, vi } from 'vitest';

import {
  useReactiveContextBuildError,
  useReactiveContextMeta,
  useReactiveContextUtilization,
} from './use-reactive-context.js';

const slots = {
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

function testInit(
  overrides: Partial<ReactiveContextInit> = {},
): ReactiveContextInit {
  return {
    model: 'gpt-4o-mini',
    maxTokens: 8000,
    reserveForResponse: 0,
    strictTokenizerPeers: false,
    debounceMs: 0,
    slots,
    tokenAccountant: {
      countItems: (items) =>
        items.reduce(
          (n, i) => n + (typeof i.content === 'string' ? i.content.length : 0),
          0,
        ),
    },
    ...overrides,
  };
}

describe('@slotmux/react hooks', () => {
  it('useReactiveContextMeta tracks initial and debounced build', async () => {
    const ctx = reactiveContext(testInit());
    const { result } = renderHook(() => useReactiveContextMeta(ctx));

    await waitFor(() => expect(result.current).toBeDefined());

    act(() => {
      ctx.user('ping');
    });

    await waitFor(() =>
      expect(
        result.current?.totalTokens !== undefined &&
          Number(result.current.totalTokens) >= 'ping'.length,
      ).toBe(true),
    );

    ctx.dispose();
  });

  it('useReactiveContextUtilization matches meta.utilization', async () => {
    const ctx = reactiveContext(testInit());
    const { result: meta } = renderHook(() => useReactiveContextMeta(ctx));
    const { result: util } = renderHook(() => useReactiveContextUtilization(ctx));

    await waitFor(() => expect(meta.current).toBeDefined());
    expect(util.current).toBe(meta.current!.utilization);

    ctx.dispose();
  });

  it('useReactiveContextBuildError reflects failed build', async () => {
    const onBuildError = vi.fn();
    const ctx = reactiveContext(
      testInit({
        maxTokens: 2000,
        onBuildError,
        slots: {
          system: { ...slots.system, budget: { fixed: 100 } },
          history: { ...slots.history, overflow: SlotOverflow.SUMMARIZE },
        },
      }),
    );

    const { result: meta } = renderHook(() => useReactiveContextMeta(ctx));
    const { result: err } = renderHook(() => useReactiveContextBuildError(ctx));

    await waitFor(() => expect(meta.current).toBeDefined());
    expect(err.current).toBeUndefined();

    act(() => {
      ctx.user('x'.repeat(10_000));
    });

    await waitFor(() => expect(err.current).toBeDefined());
    expect(onBuildError).toHaveBeenCalled();

    ctx.dispose();
  });
});

