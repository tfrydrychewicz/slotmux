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

  it('extracts FACT: lines from LLM output and renders a fact block item', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent msg one'),
      mk('r2', 4, 'recent msg two'),
    ];
    const summarizeText = vi.fn(async ({ layer }) => {
      if (layer === 2) {
        return [
          'FACT: user | created_playlist | Summer Vibes',
          'FACT: user | camera_lens | Sony FE 24-70mm',
          'The user discussed music and photography.',
        ].join('\n');
      }
      return 'summary';
    });
    const out = await runProgressiveSummarize(items, 500, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 128,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    const factItem = out.find(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItem).toBeDefined();
    expect(factItem!.content).toContain('Summer Vibes');
    expect(factItem!.content).toContain('Sony FE 24-70mm');
    expect(factItem!.pinned).toBe(true);
  });

  it('separates narrative from FACT: lines in summary items', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const summarizeText = vi.fn(async () =>
      'FACT: user | name | Alice\nThe user introduced themselves.',
    );
    const out = await runProgressiveSummarize(items, 500, {
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

    const summaryItems = out.filter(
      (i) => i.summarizes !== undefined && i.summarizes.length > 0,
    );
    for (const s of summaryItems) {
      expect(s.content).not.toContain('FACT:');
      expect(s.content).toContain('introduced themselves');
    }
  });

  it('deduplicates facts across chunks', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(300)),
    );
    const summarizeText = vi.fn(async () =>
      'FACT: user | name | Alice\nSummary text here.',
    );
    const out = await runProgressiveSummarize(items, 2000, {
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

    const factItems = out.filter(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItems).toHaveLength(1);
    const occurrences = (factItems[0]!.content.match(/Alice/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('respects factBudgetTokens limit', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const manyFacts = Array.from({ length: 30 }, (_, i) =>
      `FACT: user | fact_${String(i)} | value_${String(i)}`,
    ).join('\n') + '\nNarrative.';

    const summarizeText = vi.fn(async () => manyFacts);
    const out = await runProgressiveSummarize(items, 800, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 20,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    const factItem = out.find(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    if (factItem) {
      expect(factItem.content.length).toBeLessThanOrEqual(20 * 4);
    }
  });

  it('omits fact block when LLM produces no FACT: lines', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const summarizeText = vi.fn(async () => 'Just a plain summary with no facts.');
    const out = await runProgressiveSummarize(items, 500, {
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

    const factItems = out.filter(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItems).toHaveLength(0);
  });

  it('injects pinned facts into L3 re-compression prompt', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(500)),
    );
    const l3Prompts: string[] = [];
    let callCount = 0;
    const summarizeText = vi.fn(async ({ layer, systemPrompt }) => {
      callCount++;
      if (layer === 3) {
        l3Prompts.push(systemPrompt);
        return 'FACT: user | name | Alice\nL3 consolidated summary.';
      }
      return `FACT: user | name | Alice\nFACT: user | city | NYC\nL2 segment summary ${String(callCount)}`;
    });

    await runProgressiveSummarize(items, 200, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 512,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    expect(l3Prompts.length).toBeGreaterThan(0);
    const l3Prompt = l3Prompts[0]!;
    expect(l3Prompt).toContain('MUST be preserved verbatim');
    expect(l3Prompt).toContain('FACT:');
    expect(l3Prompt).toContain('Alice');
  });

  it('L3 fact deduplication keeps highest-confidence fact', async () => {
    const items = Array.from({ length: 16 }, (_, i) =>
      mk(`m${String(i)}`, i, 'x'.repeat(500)),
    );
    const summarizeText = vi.fn(async ({ layer }) => {
      if (layer === 3) {
        return 'FACT: user | name | Final\nConsolidated.';
      }
      return 'FACT: user | name | SameKey\nChunk summary.';
    });

    const out = await runProgressiveSummarize(items, 200, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 512,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    const factItem = out.find(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    if (factItem) {
      const nameOccurrences = (factItem.content.match(/user name/g) ?? []).length;
      expect(nameOccurrences).toBeLessThanOrEqual(1);
    }
  });

  it('uses importance scorer for zone partitioning when provided', async () => {
    const items = [
      mk('boring1', 1, 'aaaa'.repeat(100)),
      mk('boring2', 2, 'bbbb'.repeat(100)),
      mk('important', 3, 'I decided to buy "MacBook Pro" for 2499 dollars'.repeat(5)),
      mk('boring3', 4, 'cccc'.repeat(100)),
      mk('r1', 5, 'recent one'),
      mk('r2', 6, 'recent two'),
    ];

    const l2Payloads: string[] = [];
    const l1Payloads: string[] = [];
    const summarizeText = vi.fn(async ({ layer, userPayload }) => {
      if (layer === 2) l2Payloads.push(userPayload);
      if (layer === 1) l1Payloads.push(userPayload);
      return 'summary';
    });

    await runProgressiveSummarize(items, 200, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      importanceScorer: (item) => {
        const text = typeof item.content === 'string' ? item.content : '';
        return /MacBook/.test(text) ? 100 : 0;
      },
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    const l2Combined = l2Payloads.join(' ');
    const l1Combined = l1Payloads.join(' ');
    expect(l1Combined).toContain('MacBook');
    expect(l2Combined).not.toContain('MacBook');
  });

  it('disables importance scoring when importanceScorer is null', async () => {
    const items = [
      mk('a', 1, 'I decided to use "Important Thing" worth 999 on Jan 15'),
      mk('b', 2, 'boring filler text here'),
      mk('c', 3, 'boring filler text here'),
      mk('d', 4, 'boring filler text here'),
      mk('r1', 5, 'recent'),
      mk('r2', 6, 'recent'),
    ];

    const l2Payloads: string[] = [];
    const summarizeText = vi.fn(async ({ layer, userPayload }) => {
      if (layer === 2) l2Payloads.push(userPayload);
      return 'summary';
    });

    await runProgressiveSummarize(items, 100, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      importanceScorer: null,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    const l2Combined = l2Payloads.join(' ');
    expect(l2Combined).toContain('Important Thing');
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

  it('calls custom extractFacts before summarization and merges results', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent one'),
      mk('r2', 4, 'recent two'),
    ];
    const extractCalls: Array<{ text: string; existingFactCount: number }> = [];
    const extractFacts = vi.fn(async ({ text, existingFacts }) => {
      extractCalls.push({ text, existingFactCount: existingFacts.length });
      return [{
        subject: 'user',
        predicate: 'extracted_key',
        value: 'ExtractedValue',
        sourceItemId: 'custom-extractor',
        confidence: 0.95,
        createdAt: 9999,
      }];
    });
    const summarizeText = vi.fn(async () => 'Summary without FACT lines.');

    const out = await runProgressiveSummarize(items, 500, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 256,
      extractFacts,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    expect(extractFacts).toHaveBeenCalled();
    expect(extractCalls.length).toBeGreaterThan(0);

    const factItem = out.find(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItem).toBeDefined();
    expect(factItem!.content).toContain('ExtractedValue');
  });

  it('merges extractFacts results with inline FACT: lines from summarization', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const extractFacts = vi.fn(async () => [{
      subject: 'user',
      predicate: 'from_extractor',
      value: 'ExtractorFact',
      sourceItemId: 'extractor',
      confidence: 0.95,
      createdAt: 9999,
    }]);
    const summarizeText = vi.fn(async () =>
      'FACT: user | from_inline | InlineFact\nNarrative summary.',
    );

    const out = await runProgressiveSummarize(items, 500, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 256,
      extractFacts,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    const factItem = out.find(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItem).toBeDefined();
    expect(factItem!.content).toContain('ExtractorFact');
    expect(factItem!.content).toContain('InlineFact');
  });

  it('handles extractFacts throwing without breaking summarization', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const extractFacts = vi.fn(async () => {
      throw new Error('Extraction exploded');
    });
    const summarizeText = vi.fn(async () => 'FACT: user | name | Alice\nGot summary.');

    const out = await runProgressiveSummarize(items, 500, {
      preserveLastN: 2,
      summarizeText,
      countItemsTokens: countChars,
      countTextTokens: (t) => t.length,
      slot: 's',
      factBudgetTokens: 256,
      extractFacts,
      createId: (() => {
        let n = 0;
        return () => `s-${n++}`;
      })(),
    });

    expect(extractFacts).toHaveBeenCalled();
    const factItem = out.find(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItem).toBeDefined();
    expect(factItem!.content).toContain('Alice');
  });

  it('does not run extractFacts when not provided', async () => {
    const items = [
      mk('o1', 1, 'x'.repeat(300)),
      mk('o2', 2, 'x'.repeat(300)),
      mk('r1', 3, 'recent'),
      mk('r2', 4, 'recent'),
    ];
    const summarizeText = vi.fn(async () => 'Just a summary.');

    const out = await runProgressiveSummarize(items, 500, {
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
    const factItems = out.filter(
      (i) => typeof i.content === 'string' && i.content.startsWith('Known facts:'),
    );
    expect(factItems).toHaveLength(0);
  });
});
