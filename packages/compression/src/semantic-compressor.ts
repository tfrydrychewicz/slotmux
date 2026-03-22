/**
 * Semantic compression: embed anchor + items, cosine similarity, greedy selection (§8.2).
 *
 * @packageDocumentation
 */

import type { EmbedFunction, SemanticScorableItem } from './semantic-types.js';

export type RunSemanticCompressParams = {
  readonly items: readonly SemanticScorableItem[];
  /** Slot token budget (non-negative). */
  readonly budgetTokens: number;
  readonly embed: EmbedFunction;
  /** Text to embed as the relevance anchor (from last user message, system prompt, etc.). */
  readonly anchorText: string;
  /**
   * Minimum cosine similarity to consider a non-pinned item (0–1). Pinned items are always kept.
   * @defaultValue 0
   */
  readonly similarityThreshold?: number;
  /**
   * Enable adaptive similarity thresholds (§8.2.1).
   *
   * - `true` uses default `k = 1.0` (keep items above mean + 1 stddev)
   * - A number sets a custom `k` value (higher = stricter)
   * - When both `adaptiveThreshold` and `similarityThreshold` are set,
   *   the effective threshold is `max(adaptive, fixed)`
   */
  readonly adaptiveThreshold?: boolean | number;
  /** Token estimate for a single item (aligned with overflow engine counter). */
  readonly countItemTokens: (item: SemanticScorableItem) => number;
};

/**
 * Cosine similarity of two same-length vectors. Empty or mismatched length → 0.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Computes an adaptive similarity threshold from the distribution of scores.
 *
 * @param scores - Non-pinned similarity scores
 * @param k - Standard deviations above the mean (default 1.0).
 *   Higher values are stricter (fewer items retained).
 * @returns The computed threshold (`mean + k * stddev`), or 0 when scores is empty
 */
export function computeAdaptiveThreshold(scores: readonly number[], k: number = 1.0): number {
  const n = scores.length;
  if (n === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return mean + k * Math.sqrt(variance);
}

/**
 * Selects items: all **pinned** first, then non-pinned by descending similarity to the anchor
 * until the token budget is exhausted. Result sorted by `createdAt` ascending.
 */
export async function runSemanticCompress(
  params: RunSemanticCompressParams,
): Promise<readonly SemanticScorableItem[]> {
  const fixedThreshold = params.similarityThreshold ?? 0;
  const anchorIn = params.anchorText.trim();
  const anchorVec =
    anchorIn.length === 0 ? ([] as number[]) : await params.embed(anchorIn);

  const scored: { readonly item: SemanticScorableItem; readonly sim: number }[] = [];

  for (const item of params.items) {
    const t = item.text.trim();
    let sim = 0;
    if (t.length > 0 && anchorVec.length > 0) {
      const v = await params.embed(t);
      sim = cosineSimilarity(anchorVec, v);
    }
    scored.push({ item, sim });
  }

  const pinned = scored.filter((s) => s.item.pinned);
  const nonPinned = scored.filter((s) => !s.item.pinned);

  let effectiveThreshold = fixedThreshold;
  if (params.adaptiveThreshold !== undefined && params.adaptiveThreshold !== false) {
    const k = typeof params.adaptiveThreshold === 'number' ? params.adaptiveThreshold : 1.0;
    const nonPinnedScores = nonPinned.map((s) => s.sim);
    const adaptive = computeAdaptiveThreshold(nonPinnedScores, k);
    effectiveThreshold = Math.max(adaptive, fixedThreshold);
  }

  const pool = nonPinned.filter((s) => s.sim >= effectiveThreshold);
  pool.sort((a, b) => b.sim - a.sim || a.item.createdAt - b.item.createdAt);

  let used = 0;
  for (const s of pinned) {
    used += params.countItemTokens(s.item);
  }

  const chosen: SemanticScorableItem[] = pinned.map((s) => s.item);
  for (const s of pool) {
    const t = params.countItemTokens(s.item);
    if (used + t <= params.budgetTokens) {
      chosen.push(s.item);
      used += t;
    }
  }

  return chosen.sort((a, b) => a.createdAt - b.createdAt);
}
