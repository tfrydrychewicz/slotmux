/**
 * RECENT / MIDDLE / OLD partitioning for progressive summarization (§8.1).
 *
 * @packageDocumentation
 */

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
 * Sorts by `createdAt` ascending, then partitions:
 * - **recent**: every `pinned` item, plus the last `preserveLastN` non-pinned items (by position in sorted order).
 * - **old** / **middle**: remaining non-pinned items split 50/50 (older half = OLD).
 */
export function partitionProgressiveZones(
  items: readonly ProgressiveItem[],
  preserveLastN: number,
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
