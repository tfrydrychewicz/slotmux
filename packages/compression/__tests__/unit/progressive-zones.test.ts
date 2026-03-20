import { describe, expect, it } from 'vitest';

import type { ProgressiveItem } from '../../src/progressive-types.js';
import { partitionProgressiveZones } from '../../src/progressive-zones.js';

function item(id: string, at: number, pinned?: boolean): ProgressiveItem {
  return {
    id,
    role: 'user',
    content: id,
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
