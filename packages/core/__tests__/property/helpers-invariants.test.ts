import * as fc from 'fast-check';
import { describe, it } from 'vitest';

import { makeItem, makeSlot } from '../helpers';

describe('Test helpers (property-based)', () => {
  it('makeItem always produces valid item shape', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: 100_000 }),
        (id, tokens) => {
          const item = makeItem(id, tokens);
          return (
            item.id === id &&
            item.tokens === tokens &&
            typeof item.role === 'string' &&
            typeof item.content === 'string' &&
            typeof item.slot === 'string' &&
            typeof item.createdAt === 'number'
          );
        },
      ),
    );
  });

  it('makeSlot preserves item count', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 50 }),
        (name, priority, budget, itemCount) => {
          const items = Array.from({ length: itemCount }, (_, i) =>
            makeItem(`item-${i}`, 10),
          );
          const slot = makeSlot(name, priority, budget, items);
          return (
            slot.name === name &&
            slot.priority === priority &&
            slot.budgetTokens === budget &&
            slot.content.length === itemCount
          );
        },
      ),
    );
  });
});
