import { describe, expect, it, vi } from 'vitest';

import { runProgressiveSummarize } from '../../src/progressive-summarizer.js';
import type { ProgressiveItem } from '../../src/progressive-types.js';

function mk(id: string, at: number, content: string, pinned?: boolean): ProgressiveItem {
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

describe('runProgressiveSummarize (§8.1)', () => {
  it('returns sorted input when already under budget', async () => {
    const items = [mk('b', 2, 'bb'), mk('a', 1, 'aa')];
    const summarizeText = vi.fn(async () => 'nope');
    const out = await runProgressiveSummarize(items, 100, {
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: () => `id-${Math.random()}`,
    });
    expect(summarizeText).not.toHaveBeenCalled();
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('calls layer 2 for old zone then fits budget', async () => {
    const items = [
      mk('o1', 1, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      mk('o2', 2, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      mk('r1', 3, 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'),
      mk('r2', 4, 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'),
    ];
    const summarizeText = vi.fn(async ({ layer }) => (layer === 2 ? 'L2' : 'X'));
    const out = await runProgressiveSummarize(items, 70, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(summarizeText).toHaveBeenCalled();
    expect(out.some((i) => i.content === 'L2')).toBe(true);
    expect(countChars(out)).toBeLessThanOrEqual(70);
  });

  it('appends target token count to system prompt', async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(100)),
    );
    const calls: Array<{ systemPrompt: string; targetTokens?: number }> = [];
    const summarizeText = vi.fn(async (params: { systemPrompt: string; targetTokens?: number }) => {
      calls.push({ systemPrompt: params.systemPrompt, targetTokens: params.targetTokens });
      return 'summary';
    });
    await runProgressiveSummarize(items, 500, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.systemPrompt).toContain('Target output length');
      expect(call.systemPrompt).toContain('tokens');
      expect(call.targetTokens).toBeTypeOf('number');
      expect(call.targetTokens).toBeGreaterThan(0);
    }
  });

  it('produces multiple summary segments for large old zones', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(500)),
    );
    let idCounter = 0;
    const summarizeText = vi.fn(async () => 'segment-summary-' + String(idCounter++));
    const out = await runProgressiveSummarize(items, 5000, {
      preserveLastN: 4,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    const summaryItems = out.filter((i) => i.summarizes && i.summarizes.length > 0);
    expect(summaryItems.length).toBeGreaterThan(1);
  });

  it('preserves more recent items when budget allows (dynamic preserveLastN omitted)', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(100)),
    );
    const summarizeText = vi.fn(async () => 'summary');
    const out = await runProgressiveSummarize(items, 1200, {
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    const nonSummaryItems = out.filter((i) => !i.summarizes || i.summarizes.length === 0);
    expect(nonSummaryItems.length).toBeGreaterThanOrEqual(4);
  });

  it('runs chunk summarizations in parallel by default', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(500)),
    );
    let concurrent = 0;
    let maxConcurrent = 0;
    const summarizeText = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return 'summary';
    });
    await runProgressiveSummarize(items, 5000, {
      preserveLastN: 4,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(summarizeText).toHaveBeenCalled();
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('respects maxConcurrency=1 (sequential)', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(500)),
    );
    let concurrent = 0;
    let maxConcurrent = 0;
    const summarizeText = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return 'summary';
    });
    await runProgressiveSummarize(items, 5000, {
      preserveLastN: 4,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      maxConcurrency: 1,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(summarizeText).toHaveBeenCalled();
    expect(maxConcurrent).toBe(1);
  });

  it('produces identical output regardless of maxConcurrency', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(200)),
    );
    let seqCounter = 0;
    const seqSummarize = vi.fn(async ({ layer }: { layer: number }) => `summary-seq-L${String(layer)}-${String(seqCounter++)}`);
    const seqResult = await runProgressiveSummarize(items, 1500, {
      preserveLastN: 4,
      summarizeText: seqSummarize,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      maxConcurrency: 1,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    let parCounter = 0;
    const parSummarize = vi.fn(async ({ layer }: { layer: number }) => `summary-par-L${String(layer)}-${String(parCounter++)}`);
    const parResult = await runProgressiveSummarize(items, 1500, {
      preserveLastN: 4,
      summarizeText: parSummarize,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `p-${n++}`;
      })(),
    });

    expect(seqResult.length).toBe(parResult.length);
    expect(seqSummarize).toHaveBeenCalledTimes(parSummarize.mock.calls.length);
    const seqSummaries = seqResult.filter((i) => i.summarizes && i.summarizes.length > 0);
    const parSummaries = parResult.filter((i) => i.summarizes && i.summarizes.length > 0);
    expect(seqSummaries.length).toBe(parSummaries.length);
  });

  it('still works with preserveLastN=4 when explicitly configured', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(100)),
    );
    const summarizeText = vi.fn(async () => 'summary');
    const out = await runProgressiveSummarize(items, 600, {
      preserveLastN: 4,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(countChars(out)).toBeLessThanOrEqual(600);
    expect(out.some((i) => i.summarizes && i.summarizes.length > 0)).toBe(true);
  });

  it('falls back to truncation when summarizeText returns empty', async () => {
    const items = [
      mk('o1', 1, 'Important fact about user preferences that should not be lost'),
      mk('o2', 2, 'Another important detail about the conversation context'),
      mk('r1', 3, 'recent msg'),
      mk('r2', 4, 'recent msg'),
    ];
    const summarizeText = vi.fn(async () => '');
    const out = await runProgressiveSummarize(items, 80, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    const summaryItems = out.filter((i) => i.summarizes && i.summarizes.length > 0);
    expect(summaryItems.length).toBeGreaterThan(0);
    for (const s of summaryItems) {
      expect(s.content).not.toBe('(empty summary)');
      expect(s.content.length).toBeGreaterThan(0);
    }
  });

  it('recovers when summarizeText throws an error', async () => {
    const items = [
      mk('o1', 1, 'Content that caused an API error'),
      mk('o2', 2, 'More content in the old zone'),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const summarizeText = vi.fn(async () => {
      throw new Error('HTTP 400 — could not parse JSON body');
    });
    const out = await runProgressiveSummarize(items, 50, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(out.length).toBeGreaterThan(0);
    const summaryItems = out.filter((i) => i.summarizes && i.summarizes.length > 0);
    for (const s of summaryItems) {
      expect(s.content).not.toBe('(empty summary)');
      expect(s.content.length).toBeGreaterThan(0);
    }
  });

  it('enforces a minimum per-chunk token cap of 200', async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(200)),
    );
    const targetTokensSeen: number[] = [];
    const summarizeText = vi.fn(async (params: { targetTokens?: number }) => {
      if (params.targetTokens !== undefined) targetTokensSeen.push(params.targetTokens);
      return 'summary';
    });
    await runProgressiveSummarize(items, 3000, {
      preserveLastN: 4,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });
    expect(targetTokensSeen.length).toBeGreaterThan(0);
    for (const t of targetTokensSeen) {
      expect(t).toBeGreaterThanOrEqual(200);
    }
  });
});
