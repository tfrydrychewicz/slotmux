import { describe, expect, it } from 'vitest';

import {
  createContentItem,
  DEFAULT_SLIDING_WINDOW_SIZE,
  resolveSlidingWindowSize,
  slidingWindow,
  slidingWindowStrategy,
  sumCachedItemTokens,
  toTokenCount,
  type TokenAccountant,
} from '../../src/index.js';
import type { OverflowContext, SlotConfig } from '../../src/types/config.js';

describe('slidingWindowStrategy / slidingWindow (§5.2 — Phase 4.4)', () => {
  it('keeps last N non-pinned items by list order', () => {
    const items = [1, 2, 3, 4, 5].map((n) =>
      createContentItem({
        slot: 's',
        role: 'user',
        content: String(n),
        tokens: toTokenCount(10),
      }),
    );
    const out = slidingWindow(items, toTokenCount(1000), sumCachedItemTokens, 2);
    expect(out.map((i) => i.content)).toEqual(['4', '5']);
  });

  it('keeps pinned items even when outside the last-N window', () => {
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'old',
      tokens: toTokenCount(10),
    });
    const pin = createContentItem({
      slot: 's',
      role: 'user',
      content: 'pin',
      pinned: true,
      tokens: toTokenCount(10),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'mid',
      tokens: toTokenCount(10),
    });
    const c = createContentItem({
      slot: 's',
      role: 'user',
      content: 'new',
      tokens: toTokenCount(10),
    });

    const out = slidingWindow(
      [a, pin, b, c],
      toTokenCount(1000),
      sumCachedItemTokens,
      1,
    );
    expect(out.map((i) => i.content)).toEqual(['pin', 'new']);
    expect(out.some((i) => i.pinned)).toBe(true);
  });

  it('applies FIFO truncate when windowed set still exceeds budget', () => {
    const items = [1, 2, 3, 4].map((n) =>
      createContentItem({
        slot: 's',
        role: 'user',
        content: String(n),
        tokens: toTokenCount(20),
      }),
    );
    const out = slidingWindow(items, toTokenCount(35), sumCachedItemTokens, 2);
    expect(out).toHaveLength(1);
    expect(sumCachedItemTokens(out)).toBeLessThanOrEqual(35);
  });

  it('resolveSlidingWindowSize reads overflowConfig then context.windowSize', () => {
    const cfg: SlotConfig = {
      priority: 50,
      budget: { flex: true },
      overflowConfig: { windowSize: 7 },
    };
    const ctx: OverflowContext & { slotConfig?: SlotConfig } = {
      slot: 's',
      slotConfig: cfg,
    };
    expect(resolveSlidingWindowSize(ctx)).toBe(7);

    const ctx2: OverflowContext & { windowSize?: number } = {
      slot: 's',
      windowSize: 3,
    };
    expect(resolveSlidingWindowSize(ctx2)).toBe(3);

    expect(resolveSlidingWindowSize({ slot: 's' })).toBe(
      DEFAULT_SLIDING_WINDOW_SIZE,
    );
  });

  it('slidingWindowStrategy uses TokenAccountant from context', async () => {
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(5),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(5),
    });
    const accountant: TokenAccountant = {
      countItems: (xs) => sumCachedItemTokens(xs) * 2,
    };
    const ctx: OverflowContext & { windowSize?: number } = {
      slot: 's',
      windowSize: 2,
      tokenAccountant: accountant,
    };
    const out = await slidingWindowStrategy([a, b], toTokenCount(12), ctx);
    expect(out.length).toBeLessThan(2);
  });
});
