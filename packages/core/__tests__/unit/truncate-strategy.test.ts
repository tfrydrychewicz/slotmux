import { describe, expect, it } from 'vitest';

import {
  createContentItem,
  sumCachedItemTokens,
  truncateFifo,
  truncateStrategy,
  toTokenCount,
  type TokenAccountant,
} from '../../src/index.js';
import type { OverflowContext } from '../../src/types/config.js';

describe('truncateStrategy / truncateFifo (§5.2 — Phase 4.2)', () => {
  it('removes oldest non-pinned items until within budget (basic FIFO)', () => {
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(20),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(20),
    });
    const c = createContentItem({
      slot: 's',
      role: 'user',
      content: 'c',
      tokens: toTokenCount(20),
    });

    // 60 total → drop oldest once → 40 ≤ 45
    const out = truncateFifo([a, b, c], toTokenCount(45), sumCachedItemTokens);
    expect(out.map((i) => i.id)).toEqual([b.id, c.id]);
    expect(sumCachedItemTokens(out)).toBe(40);
  });

  it('preserves pinned items (never evicts them)', () => {
    const u1 = createContentItem({
      slot: 's',
      role: 'user',
      content: '1',
      tokens: toTokenCount(20),
    });
    const pin = createContentItem({
      slot: 's',
      role: 'user',
      content: 'p',
      pinned: true,
      tokens: toTokenCount(20),
    });
    const u2 = createContentItem({
      slot: 's',
      role: 'user',
      content: '2',
      tokens: toTokenCount(20),
    });

    // Drop u1 only; pin + u2 = 40 ≤ 40
    const out = truncateFifo([u1, pin, u2], toTokenCount(40), sumCachedItemTokens);
    expect(out.map((i) => i.id)).toEqual([pin.id, u2.id]);
  });

  it('stops when total equals budget exactly (exact fit)', () => {
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(10),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(10),
    });
    const out = truncateFifo([a, b], toTokenCount(20), sumCachedItemTokens);
    expect(out).toHaveLength(2);
    expect(sumCachedItemTokens(out)).toBe(20);
  });

  it('uses TokenAccountant from context when calling truncateStrategy', async () => {
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
    /** Counts 2× cached sum so budget 15 still requires dropping one item. */
    const accountant: TokenAccountant = {
      countItems: (items) => sumCachedItemTokens(items) * 2,
    };
    const ctx: OverflowContext = { slot: 's', tokenAccountant: accountant };
    const out = await truncateStrategy([a, b], toTokenCount(15), ctx);
    expect(out).toHaveLength(1);
  });

  it('falls back to sumCachedItemTokens when tokenAccountant is omitted', async () => {
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(20),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(20),
    });
    const out = await truncateStrategy([a, b], toTokenCount(25), { slot: 's' });
    expect(out).toHaveLength(1);
    expect(sumCachedItemTokens(out)).toBe(20);
  });
});
