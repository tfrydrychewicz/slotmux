/**
 * LIFO truncate-latest overflow strategy (§5.2 — Phase 4.3).
 *
 * @packageDocumentation
 */

import type { TokenCount } from '../../types/branded.js';
import type { OverflowStrategyFn } from '../../types/config.js';
import type { ContentItem } from '../../types/content.js';

import { resolveOverflowCountItems } from './truncate-strategy.js';

/**
 * Remove **newest** non-pinned items (LIFO / truncate-latest) until
 * `countItems(remaining) <= budget`. Order of kept items is preserved.
 */
export function truncateLatest(
  items: readonly ContentItem[],
  budget: TokenCount,
  countItems: (xs: readonly ContentItem[]) => number,
): ContentItem[] {
  const order = items.slice();
  while (countItems(order) > budget) {
    let idx = -1;
    for (let i = order.length - 1; i >= 0; i--) {
      if (!order[i]!.pinned) {
        idx = i;
        break;
      }
    }
    if (idx < 0) break;
    order.splice(idx, 1);
  }
  return order;
}

/**
 * {@link OverflowStrategyFn} for `overflow: 'truncate-latest'`.
 */
export const truncateLatestStrategy: OverflowStrategyFn = (
  items,
  budget,
  context,
) => {
  const countItems = resolveOverflowCountItems(context);
  return Promise.resolve(truncateLatest(items, budget, countItems));
};
