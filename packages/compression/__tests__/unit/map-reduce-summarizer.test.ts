import { describe, expect, it, vi } from 'vitest';

import {
  chunkBulkForMap,
  runMapReduceSummarize,
  splitTextToTokenBudget,
} from '../../src/map-reduce-summarizer.js';
import type { ProgressiveItem } from '../../src/progressive-types.js';

function mk(
  id: string,
  at: number,
  content: string,
  pinned?: boolean,
): ProgressiveItem {
  return {
    id,
    role: 'user',
    content,
    createdAt: at,
    ...(pinned ? { pinned: true } : {}),
    slot: 's',
  };
}

function countChars(items: readonly ProgressiveItem[]): number {
  let s = 0;
  for (const i of items) {
    s += typeof i.content === 'string' ? i.content.length : 0;
  }
  return s;
}

describe('splitTextToTokenBudget', () => {
  it('returns one piece when under budget', () => {
    const out = splitTextToTokenBudget('hello', (t) => t.length, 10);
    expect(out).toEqual(['hello']);
  });

  it('splits oversized text', () => {
    const out = splitTextToTokenBudget('abcdefghij', (t) => t.length, 3);
    expect(out.join('')).toBe('abcdefghij');
    expect(out.every((p) => p.length <= 3)).toBe(true);
  });
});

describe('chunkBulkForMap', () => {
  it('groups consecutive items until token budget', () => {
    const bulk = [mk('a', 1, 'aa'), mk('b', 2, 'bb'), mk('c', 3, 'cc')];
    const chunks = chunkBulkForMap(bulk, (t) => t.length, 6);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.map((x) => x.id)).toEqual(['a', 'b']);
    expect(chunks[1]!.map((x) => x.id)).toEqual(['c']);
  });
});

describe('runMapReduceSummarize', () => {
  it('maps each chunk then reduces when multiple chunk summaries', async () => {
    const items = [
      mk('o1', 1, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      mk('o2', 2, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      mk('m1', 3, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      mk('m2', 4, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      mk('r1', 5, 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'),
      mk('r2', 6, 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'),
    ];
    const mapChunk = vi.fn(async () => 'M');
    const reduceMerge = vi.fn(async () => 'R');

    const out = await runMapReduceSummarize(items, 70, {
      preserveLastN: 2,
      mapReduce: {
        mapChunk,
        reduceMerge,
        mapChunkMaxInputTokens: 65,
        reduceMaxInputTokens: 80,
      },
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `id-${n++}`;
      })(),
    });

    expect(mapChunk).toHaveBeenCalledTimes(2);
    expect(reduceMerge).toHaveBeenCalledTimes(1);
    expect(out.some((i) => i.content === 'R')).toBe(true);
    expect(countChars(out)).toBeLessThanOrEqual(70);
  });

  it('skips reduce when a single map output', async () => {
    const items = [
      mk('a', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      mk('b', 2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      mk('c', 3, 'cccccccccccccccccccccccccccccc'),
    ];
    const mapChunk = vi.fn(async () => 'only');
    const reduceMerge = vi.fn(async () => 'bad');

    const out = await runMapReduceSummarize(items, 50, {
      preserveLastN: 2,
      mapReduce: {
        mapChunk,
        reduceMerge,
        mapChunkMaxInputTokens: 100,
      },
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: () => 's0',
    });

    expect(mapChunk).toHaveBeenCalledTimes(1);
    expect(reduceMerge).not.toHaveBeenCalled();
    expect(out.some((i) => i.content === 'only')).toBe(true);
  });

  it('runs map phase in parallel by default', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(100)),
      mk('o2', 2, 'x'.repeat(100)),
      mk('o3', 3, 'x'.repeat(100)),
      mk('o4', 4, 'x'.repeat(100)),
      mk('r1', 5, 'y'.repeat(50)),
      mk('r2', 6, 'y'.repeat(50)),
    ];
    let concurrent = 0;
    let maxConcurrent = 0;
    const mapChunk = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return 'M';
    });
    const reduceMerge = vi.fn(async () => 'R');

    await runMapReduceSummarize(items, 120, {
      preserveLastN: 2,
      mapReduce: { mapChunk, reduceMerge, mapChunkMaxInputTokens: 120 },
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `id-${n++}`;
      })(),
    });

    expect(mapChunk.mock.calls.length).toBeGreaterThan(1);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('respects maxConcurrency in map phase', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(100)),
      mk('o2', 2, 'x'.repeat(100)),
      mk('o3', 3, 'x'.repeat(100)),
      mk('o4', 4, 'x'.repeat(100)),
      mk('r1', 5, 'y'.repeat(50)),
      mk('r2', 6, 'y'.repeat(50)),
    ];
    let concurrent = 0;
    let maxConcurrent = 0;
    const mapChunk = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return 'M';
    });
    const reduceMerge = vi.fn(async () => 'R');

    await runMapReduceSummarize(items, 120, {
      preserveLastN: 2,
      mapReduce: { mapChunk, reduceMerge, mapChunkMaxInputTokens: 120 },
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      maxConcurrency: 1,
      createId: (() => {
        let n = 0;
        return () => `id-${n++}`;
      })(),
    });

    expect(mapChunk.mock.calls.length).toBeGreaterThan(1);
    expect(maxConcurrent).toBe(1);
  });

  it('appends target token count to map system prompt', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(100)),
      mk('o2', 2, 'x'.repeat(100)),
      mk('r1', 3, 'y'.repeat(50)),
      mk('r2', 4, 'y'.repeat(50)),
    ];
    const prompts: string[] = [];
    const mapChunk = vi.fn(async ({ systemPrompt }: { systemPrompt: string }) => {
      prompts.push(systemPrompt);
      return 'mapped';
    });
    const reduceMerge = vi.fn(async () => 'reduced');

    await runMapReduceSummarize(items, 120, {
      preserveLastN: 2,
      mapReduce: { mapChunk, reduceMerge, mapChunkMaxInputTokens: 250 },
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `id-${n++}`;
      })(),
    });

    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).toContain('Target output length');
      expect(p).toContain('tokens');
    }
  });
});
