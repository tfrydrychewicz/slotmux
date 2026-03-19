/**
 * Sliding-window overflow strategy (§5.2 — Phase 4.4).
 *
 * @packageDocumentation
 */

import type { TokenCount } from '../../types/branded.js';
import type {
  OverflowContext,
  OverflowStrategyFn,
  SlotConfig,
} from '../../types/config.js';
import type { ContentItem } from '../../types/content.js';

import { resolveOverflowCountItems, truncateFifo } from './truncate-strategy.js';

/** Used when `overflowConfig.windowSize` is unset and no `context.windowSize`. */
export const DEFAULT_SLIDING_WINDOW_SIZE = 10;

/**
 * Resolves window size from {@link SlotConfig.overflowConfig.windowSize},
 * optional `context.windowSize`, else {@link DEFAULT_SLIDING_WINDOW_SIZE}.
 */
export function resolveSlidingWindowSize(context: OverflowContext): number {
  const withCfg = context as OverflowContext & { slotConfig?: SlotConfig };
  const ws = withCfg.slotConfig?.overflowConfig?.windowSize;
  if (
    ws !== undefined &&
    Number.isInteger(ws) &&
    ws > 0
  ) {
    return ws;
  }
  const loose = (context as { windowSize?: number }).windowSize;
  if (
    loose !== undefined &&
    Number.isInteger(loose) &&
    loose > 0
  ) {
    return loose;
  }
  return DEFAULT_SLIDING_WINDOW_SIZE;
}

/**
 * Keeps **all pinned** items plus the last `windowSize` **non-pinned** items
 * (by list order). If the result still exceeds `budget` (per `countItems`),
 * applies {@link truncateFifo} on that list with the same counter.
 */
export function slidingWindow(
  items: readonly ContentItem[],
  budget: TokenCount,
  countItems: (xs: readonly ContentItem[]) => number,
  windowSize: number,
): ContentItem[] {
  const ws = Math.max(1, Math.floor(windowSize));
  const unpinned = items.filter((it) => !it.pinned);
  const keepUnpinned = new Set(unpinned.slice(-ws).map((it) => it.id));
  let out = items.filter((it) => it.pinned || keepUnpinned.has(it.id));
  if (countItems(out) > budget) {
    out = truncateFifo(out, budget, countItems);
  }
  return out;
}

/**
 * {@link OverflowStrategyFn} for `overflow: 'sliding-window'`.
 */
export const slidingWindowStrategy: OverflowStrategyFn = (
  items,
  budget,
  context,
) => {
  const countItems = resolveOverflowCountItems(context);
  const windowSize = resolveSlidingWindowSize(context);
  return Promise.resolve(
    slidingWindow(items, budget, countItems, windowSize),
  );
};
