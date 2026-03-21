import { describe, expect, it } from 'vitest';

import type { ImportanceScorerFn } from '../../src/importance-scorer.js';
import type { ProgressiveItem } from '../../src/progressive-types.js';
import { computeDynamicPreserveLastN, partitionProgressiveZones } from '../../src/progressive-zones.js';

function item(id: string, at: number, pinned?: boolean, content?: string): ProgressiveItem {
  return {
    id,
    role: 'user',
    content: content ?? id,
    createdAt: at,
    ...(pinned ? { pinned: true } : {}),
  };
}

describe('partitionProgressiveZones (§8.1)', () => {
  it('puts last preserveLastN unpinned in recent and splits remainder into old/middle', () => {
    const a = item('a', 1);
    const b = item('b', 2);
    const c = item('c', 3);
    const d = item('d', 4);
    const z = partitionProgressiveZones([c, a, d, b], 2);
    expect(z.recent.map((x) => x.id)).toEqual(['c', 'd']);
    expect(z.old.map((x) => x.id)).toEqual(['a']);
    expect(z.middle.map((x) => x.id)).toEqual(['b']);
  });

  it('includes all pinned items in recent', () => {
    const a = item('a', 1);
    const b = item('b', 2, true);
    const c = item('c', 3);
    const d = item('d', 4);
    const z = partitionProgressiveZones([a, b, c, d], 1);
    expect(z.recent.map((x) => x.id).sort()).toEqual(['b', 'd']);
    expect(z.old.map((x) => x.id)).toEqual(['a']);
    expect(z.middle.map((x) => x.id)).toEqual(['c']);
  });

  it('orders recent by chronological index in full sort', () => {
    const items = [item('a', 1), item('b', 2, true), item('c', 3)];
    const z = partitionProgressiveZones(items, 1);
    expect(z.recent.map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('partitionProgressiveZones with importanceScorer (§8.4.4)', () => {
  it('puts low-importance items in OLD zone and high-importance in MIDDLE', () => {
    const scores: Record<string, number> = {
      boring1: 0,
      boring2: 0,
      factDense1: 10,
      factDense2: 10,
    };
    const scorer: ImportanceScorerFn = (i) => scores[i.id] ?? 0;

    const items = [
      item('boring1', 1),
      item('factDense1', 2),
      item('boring2', 3),
      item('factDense2', 4),
      item('recent1', 5),
      item('recent2', 6),
    ];
    const z = partitionProgressiveZones(items, 2, scorer);

    expect(z.recent.map((x) => x.id)).toEqual(['recent1', 'recent2']);
    expect(z.old.map((x) => x.id).sort()).toEqual(['boring1', 'boring2']);
    expect(z.middle.map((x) => x.id).sort()).toEqual(['factDense1', 'factDense2']);
  });

  it('uses custom scorer instead of default when provided', () => {
    const calls: string[] = [];
    const scorer: ImportanceScorerFn = (i) => {
      calls.push(i.id);
      return i.id === 'special' ? 100 : 0;
    };

    const items = [
      item('a', 1),
      item('special', 2),
      item('b', 3),
      item('c', 4),
      item('r1', 5),
      item('r2', 6),
    ];
    const z = partitionProgressiveZones(items, 2, scorer);

    expect(calls).toContain('special');
    expect(z.middle.some((x) => x.id === 'special')).toBe(true);
    expect(z.old.every((x) => x.id !== 'special')).toBe(true);
  });

  it('falls back to chronological split when no scorer is provided', () => {
    const items = [
      item('a', 1, false, 'I decided to pick "Important Thing" worth 999'),
      item('b', 2, false, 'boring'),
      item('c', 3, false, 'boring'),
      item('d', 4, false, 'boring'),
      item('r1', 5),
      item('r2', 6),
    ];
    const withoutScorer = partitionProgressiveZones(items, 2);
    expect(withoutScorer.old.map((x) => x.id)).toEqual(['a', 'b']);
    expect(withoutScorer.middle.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('breaks importance ties by createdAt (oldest first in OLD)', () => {
    const scorer: ImportanceScorerFn = () => 5;
    const items = [
      item('oldest', 1),
      item('middle', 2),
      item('newer', 3),
      item('newest', 4),
      item('r1', 5),
      item('r2', 6),
    ];
    const z = partitionProgressiveZones(items, 2, scorer);
    expect(z.old.map((x) => x.id)).toEqual(['oldest', 'middle']);
    expect(z.middle.map((x) => x.id)).toEqual(['newer', 'newest']);
  });
});

function mkItem(id: string, at: number, tokenSize: number): ProgressiveItem {
  return {
    id,
    role: 'user',
    content: 'x'.repeat(tokenSize),
    createdAt: at,
  };
}

describe('computeDynamicPreserveLastN', () => {
  const countTokens = (items: readonly ProgressiveItem[]) =>
    items.reduce((sum, i) => sum + (typeof i.content === 'string' ? i.content.length : 0), 0);

  it('returns ~50% of budget worth of recent items', () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`m${String(i)}`, i, 100));
    const result = computeDynamicPreserveLastN(items, 1000, countTokens);
    expect(result).toBe(5);
  });

  it('returns at least 4 even when budget is tiny', () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`m${String(i)}`, i, 100));
    const result = computeDynamicPreserveLastN(items, 200, countTokens);
    expect(result).toBeGreaterThanOrEqual(4);
  });

  it('returns the explicit override when provided', () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`m${String(i)}`, i, 100));
    const result = computeDynamicPreserveLastN(items, 10000, countTokens, 3);
    expect(result).toBe(3);
  });

  it('scales up with larger budgets', () => {
    const items = Array.from({ length: 50 }, (_, i) => mkItem(`m${String(i)}`, i, 100));
    const small = computeDynamicPreserveLastN(items, 1000, countTokens);
    const large = computeDynamicPreserveLastN(items, 5000, countTokens);
    expect(large).toBeGreaterThan(small);
  });
});
