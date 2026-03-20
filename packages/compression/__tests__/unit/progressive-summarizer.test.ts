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

describe('runProgressiveSummarize (§8.1 / Phase 8.3)', () => {
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
});
