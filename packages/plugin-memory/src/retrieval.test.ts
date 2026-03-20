import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from './memory-types.js';
import { rankMemories } from './retrieval.js';

function rec(
  id: string,
  content: string,
  updatedAt: number,
): MemoryRecord {
  return { id, content, createdAt: updatedAt, updatedAt };
}

describe('rankMemories', () => {
  it('hybrid balances relevance and recency', () => {
    const now = 1_000_000;
    const old = now - 10 * 24 * 60 * 60 * 1000;
    const records: MemoryRecord[] = [
      rec('a', 'postgres indexing and btree internals', old),
      rec('b', 'unrelated cooking pasta recipe', now),
    ];
    const ranked = rankMemories(records, 'postgres btree', 'hybrid', {
      alpha: 0.92,
      halfLifeMs: 2 * 60 * 60 * 1000,
      nowMs: now,
    });
    expect(ranked[0]?.record.id).toBe('a');
  });

  it('recency strategy ignores query content', () => {
    const now = 5_000_000;
    const records: MemoryRecord[] = [
      rec('x', 'alpha', now - 1000),
      rec('y', 'beta', now),
    ];
    const ranked = rankMemories(records, 'alpha', 'recency', { nowMs: now });
    expect(ranked[0]?.record.id).toBe('y');
  });
});
