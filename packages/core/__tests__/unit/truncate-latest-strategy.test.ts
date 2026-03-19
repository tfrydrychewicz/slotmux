import { describe, expect, it } from 'vitest';

import {
  createContentItem,
  sumCachedItemTokens,
  truncateLatest,
  truncateLatestStrategy,
  toTokenCount,
  type TokenAccountant,
} from '../../src/index.js';
import type { OverflowContext } from '../../src/types/config.js';

describe('truncateLatestStrategy / truncateLatest (§5.2 — Phase 4.3)', () => {
  it('removes newest non-pinned items first (LIFO)', () => {
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

    const out = truncateLatest([a, b, c], toTokenCount(45), sumCachedItemTokens);
    expect(out.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(sumCachedItemTokens(out)).toBe(40);
  });

  it('never removes pinned items', () => {
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

    const out = truncateLatest([u1, pin, u2], toTokenCount(40), sumCachedItemTokens);
    expect(out.map((i) => i.id)).toEqual([u1.id, pin.id]);
  });

  it('uses TokenAccountant from context in truncateLatestStrategy', async () => {
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
      countItems: (items) => sumCachedItemTokens(items) * 2,
    };
    const ctx: OverflowContext = { slot: 's', tokenAccountant: accountant };
    const out = await truncateLatestStrategy([a, b], toTokenCount(15), ctx);
    expect(out).toHaveLength(1);
  });
});
