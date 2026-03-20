/**
 * Hybrid recency + lexical relevance ranking (Phase 11.2).
 *
 * @packageDocumentation
 */

import type { MemoryRecord } from './memory-types.js';

export type MemoryRetrievalStrategy = 'recency' | 'relevance' | 'hybrid';

function wordSet(text: string): Set<string> {
  const norm = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const words = norm.split(/[^a-z0-9]+/u).filter((w) => w.length > 0);
  return new Set(words);
}

/**
 * Jaccard similarity on word sets (0–1).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size === 0 && B.size === 0) {
    return 1;
  }
  if (A.size === 0 || B.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) {
      inter += 1;
    }
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function relevanceScore(query: string, content: string): number {
  if (query.trim().length === 0) {
    return 0;
  }
  return jaccardSimilarity(query, content);
}

function recencyScore(updatedAt: number, nowMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) {
    return 1;
  }
  const age = Math.max(0, nowMs - updatedAt);
  return Math.exp(-age / halfLifeMs);
}

export type RankedMemory = {
  readonly record: MemoryRecord;
  readonly score: number;
};

/**
 * Ranks memories for injection into the context.
 *
 * @param alpha — hybrid only: weight on relevance in [0,1]; recency weight is `1 - alpha`.
 */
export function rankMemories(
  records: readonly MemoryRecord[],
  query: string,
  strategy: MemoryRetrievalStrategy,
  options?: { alpha?: number; halfLifeMs?: number; nowMs?: number },
): RankedMemory[] {
  const alpha = options?.alpha ?? 0.55;
  const halfLifeMs = options?.halfLifeMs ?? 7 * 24 * 60 * 60 * 1000;
  const nowMs = options?.nowMs ?? Date.now();

  const scored = records.map((record) => {
    const rel = relevanceScore(query, record.content);
    const rec = recencyScore(record.updatedAt, nowMs, halfLifeMs);
    let score: number;
    if (strategy === 'recency') {
      score = rec;
    } else if (strategy === 'relevance') {
      score = rel;
    } else {
      score = alpha * rel + (1 - alpha) * rec;
    }
    return { record, score };
  });

  scored.sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt);
  return scored;
}
