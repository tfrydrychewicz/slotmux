/**
 * Phase 4.8 — property: after overflow + escalation, total tokens ≤ totalBudget
 * when escalation is not exhausted (§17.2).
 */

import * as fc from 'fast-check';
import { describe, it } from 'vitest';

import {
  OverflowEngine,
  createContentItem,
  toTokenCount,
  type ContentItem,
  type ContextEvent,
  type OverflowEngineInputSlot,
} from '../../src/index.js';

function countSum(items: readonly ContentItem[]): number {
  return items.reduce((s, i) => s + (i.tokens ?? 0), 0);
}

describe('OverflowEngine invariants (Phase 4.8 property)', () => {
  it('after resolve with totalBudget, total ≤ budget unless escalation exhausted or max rounds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 25, max: 1200 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 8, max: 55 }),
        fc.integer({ min: 1, max: 4 }),
        async (totalBudget, nSlots, tokEach, itemsPerSlot) => {
          const flex = {
            priority: 50,
            budget: { flex: true },
            overflow: 'truncate' as const,
          };

          const inputs: OverflowEngineInputSlot[] = Array.from(
            { length: nSlots },
            (_, i) => {
              const name = `s${i}`;
              const priority = 5 + i * 17;
              const items = Array.from({ length: itemsPerSlot }, (_, j) =>
                createContentItem({
                  slot: name,
                  role: 'user',
                  content: `${i}-${j}`,
                  tokens: toTokenCount(tokEach),
                }),
              );
              const used = itemsPerSlot * tokEach;
              return {
                name,
                priority,
                budgetTokens: used + 500,
                config: { ...flex, priority },
                content: items,
              };
            },
          );

          const codes: string[] = [];
          const onEvent = (e: ContextEvent): void => {
            if (e.type === 'warning') {
              codes.push(e.warning.code);
            }
          };

          const engine = new OverflowEngine({ countTokens: countSum, onEvent });
          const out = await engine.resolve(inputs, { totalBudget });
          const total = out.reduce((s, sl) => s + countSum(sl.content), 0);

          const exhausted = codes.includes('ESCALATION_EXHAUSTED');
          const maxRounds = codes.includes('ESCALATION_MAX_ROUNDS');
          if (exhausted || maxRounds) {
            return true;
          }
          return total <= totalBudget;
        },
      ),
      { numRuns: 100 },
    );
  });
});
