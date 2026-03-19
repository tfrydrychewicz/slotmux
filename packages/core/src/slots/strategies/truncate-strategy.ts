/**
 * FIFO truncate overflow strategy (§5.2 — Phase 4.2).
 *
 * @packageDocumentation
 */

import type { TokenCount } from '../../types/branded.js';
import type { OverflowContext, OverflowStrategyFn } from '../../types/config.js';
import type { ContentItem } from '../../types/content.js';

/**
 * Sum of {@link ContentItem.tokens} when set; missing `tokens` counts as 0.
 * Used when no {@link TokenAccountant} is on the overflow context.
 */
export function sumCachedItemTokens(items: readonly ContentItem[]): number {
  let s = 0;
  for (const i of items) {
    s += i.tokens ?? 0;
  }
  return s;
}

/**
 * Token counter for overflow strategies: {@link OverflowContext.tokenAccountant}
 * or {@link sumCachedItemTokens}.
 */
export function resolveOverflowCountItems(
  context: OverflowContext,
): (items: readonly ContentItem[]) => number {
  const ta = context.tokenAccountant;
  if (ta !== undefined) {
    return (xs) => ta.countItems(xs);
  }
  return sumCachedItemTokens;
}

/**
 * Remove oldest **non-pinned** items (FIFO) until `countItems(remaining) <= budget`.
 * Relative order of kept items is preserved.
 */
export function truncateFifo(
  items: readonly ContentItem[],
  budget: TokenCount,
  countItems: (xs: readonly ContentItem[]) => number,
): ContentItem[] {
  const order = items.slice();
  while (countItems(order) > budget) {
    const idx = order.findIndex((i) => !i.pinned);
    if (idx < 0) break;
    order.splice(idx, 1);
  }
  return order;
}

/**
 * {@link OverflowStrategyFn} for `overflow: 'truncate'`.
 * Uses {@link OverflowContext.tokenAccountant} when present; otherwise {@link sumCachedItemTokens}.
 */
export const truncateStrategy: OverflowStrategyFn = (items, budget, context) => {
  const countItems = resolveOverflowCountItems(context);
  return Promise.resolve(truncateFifo(items, budget, countItems));
};
