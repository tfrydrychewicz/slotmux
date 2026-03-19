import { bench, describe } from 'vitest';

import { makeItem, makeSlot } from '../helpers';

describe('Test helpers benchmark', () => {
  bench('makeItem x 1000', () => {
    for (let i = 0; i < 1000; i++) {
      makeItem(`item-${i}`, 50);
    }
  });

  bench('makeSlot with 10 items', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem(`item-${i}`, 50),
    );
    makeSlot('history', 50, 500, items);
  });
});
