/**
 * RECENT / MIDDLE / OLD partitioning for progressive summarization (§8.1, §8.4.4).
 *
 * @packageDocumentation
 */

import type { ImportanceScorerFn } from './importance-scorer.js';
import type { ProgressiveItem } from './progressive-types.js';

export type ProgressiveZones = {
  /** Oldest non-recent block (Layer 2+ candidates). */
  readonly old: ProgressiveItem[];
  /** Between OLD and RECENT (Layer 1 candidates). */
  readonly middle: ProgressiveItem[];
  /** Last `preserveLastN` unpinned + all pinned (Layer 0, never summarized). */
  readonly recent: ProgressiveItem[];
};

/**
 * Computes a dynamic `preserveLastN` value that scales with the available
 * budget, allocating ~50% of the budget to verbatim recent items.
 *
 * When the user explicitly sets `preserveLastN`, that value is returned
 * unchanged. Otherwise the function walks backwards from the newest item
 * and counts items until they fill half the budget (minimum 4).
 *
 * @param items - All items in chronological order
 * @param budgetTokens - Token budget for the slot
 * @param countItemsTokens - Token counter for a slice of items
 * @param configuredPreserveLastN - Explicit user override (returned as-is when set)
 * @param estimateItemsTokens - Optional fast estimator (§9.3.1 Tier 0).
 *   When provided, this is used instead of the exact counter for the
 *   heuristic budget calculation — sufficient since the result is approximate.
 */
export function computeDynamicPreserveLastN(
  items: readonly ProgressiveItem[],
  budgetTokens: number,
  countItemsTokens: (items: readonly ProgressiveItem[]) => number,
  configuredPreserveLastN?: number,
  estimateItemsTokens?: (items: readonly ProgressiveItem[]) => number,
): number {
  if (configuredPreserveLastN !== undefined) return configuredPreserveLastN;

  const counter = estimateItemsTokens ?? countItemsTokens;
  const targetRecentBudget = Math.floor(budgetTokens * 0.5);
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);

  let count = 0;
  let tokens = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const itemTokens = counter([sorted[i]!]);
    if (tokens + itemTokens > targetRecentBudget && count >= 4) break;
    tokens += itemTokens;
    count++;
  }
  return Math.max(4, count);
}

/**
 * Sorts by `createdAt` ascending, then partitions:
 * - **recent**: every `pinned` item, plus the last `preserveLastN` non-pinned items (by position in sorted order).
 * - **old** / **middle**: remaining non-pinned items split 50/50.
 *
 * When an `importanceScorer` is provided (§8.4.4), the non-recent items are
 * sorted by `(importance ASC, createdAt ASC)` before splitting — lowest-importance,
 * oldest items go to the OLD zone (compressed most aggressively), while
 * highest-importance items stay in the MIDDLE zone.
 *
 * @param items - All items to partition
 * @param preserveLastN - Number of recent non-pinned items to keep verbatim
 * @param importanceScorer - Optional scoring function; when omitted, the split
 *   is purely chronological (same behavior as before §8.4.4)
 */
export function partitionProgressiveZones(
  items: readonly ProgressiveItem[],
  preserveLastN: number,
  importanceScorer?: ImportanceScorerFn,
): ProgressiveZones {
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const n = sorted.length;
  const recentIndexSet = new Set<number>();

  for (let i = 0; i < n; i++) {
    if (sorted[i]!.pinned) {
      recentIndexSet.add(i);
    }
  }

  const unpinnedIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!sorted[i]!.pinned) {
      unpinnedIndices.push(i);
    }
  }

  const k = Math.max(0, preserveLastN);
  const tail = unpinnedIndices.slice(-k);
  for (const i of tail) {
    recentIndexSet.add(i);
  }

  const restIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!recentIndexSet.has(i)) {
      restIndices.push(i);
    }
  }

  if (importanceScorer !== undefined) {
    restIndices.sort((idxA, idxB) => {
      const scoreA = importanceScorer(sorted[idxA]!);
      const scoreB = importanceScorer(sorted[idxB]!);
      if (scoreA !== scoreB) return scoreA - scoreB;
      return sorted[idxA]!.createdAt - sorted[idxB]!.createdAt;
    });
  }

  const mid = Math.floor(restIndices.length / 2);
  const oldIdx = restIndices.slice(0, mid);
  const middleIdx = restIndices.slice(mid);

  const pick = (indices: readonly number[]) => indices.map((i) => sorted[i]!);

  return {
    old: pick(oldIdx),
    middle: pick(middleIdx),
    recent: [...recentIndexSet].sort((a, b) => a - b).map((i) => sorted[i]!),
  };
}
