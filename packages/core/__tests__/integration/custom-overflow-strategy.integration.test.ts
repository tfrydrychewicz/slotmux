import { describe, expect, it, vi } from 'vitest';

import {
  createContentItem,
  defineCompressionStrategy,
  defineOverflowStrategy,
  OverflowEngine,
  toTokenCount,
  type ContentItem,
  type OverflowEngineInputSlot,
  type SlotConfig,
} from '../../src/index.js';

function countSum(items: readonly ContentItem[]): number {
  return items.reduce((s, i) => s + (i.tokens ?? 0), 0);
}

describe('custom overflow strategy (§8.4 — Phase 4.6 integration)', () => {
  it('defineOverflowStrategy receives slotName, slotConfig, tokenCounter, logger', async () => {
    const log = vi.fn();
    const logger = {
      info: log,
      warn: vi.fn(),
      error: vi.fn(),
    };

    const custom = defineOverflowStrategy(
      ({ items, budget, slotName, slotConfig, tokenCounter, logger: lg }) => {
        expect(slotName).toBe('history');
        expect(slotConfig?.priority).toBe(50);
        expect(tokenCounter).toBeDefined();
        expect(lg).toBe(logger);
        lg?.info('custom-overflow', slotName);
        const n = tokenCounter?.countItems(items) ?? 0;
        if (n > budget) {
          return items.slice(-1);
        }
        return items;
      },
    );

    const flex: SlotConfig = { priority: 50, budget: { flex: true } };
    const a = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(40),
    });
    const b = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(40),
    });

    const slot: OverflowEngineInputSlot = {
      name: 'history',
      priority: 50,
      budgetTokens: 50,
      config: { ...flex, overflow: custom },
      content: [a, b],
    };

    const engine = new OverflowEngine({
      countTokens: countSum,
      strategyLogger: logger,
    });

    const out = await engine.resolve([slot]);
    expect(out[0]!.content).toHaveLength(1);
    expect(out[0]!.content[0]!.id).toBe(b.id);
    expect(log).toHaveBeenCalledWith('custom-overflow', 'history');
  });

  it('defineCompressionStrategy is the same factory as defineOverflowStrategy', () => {
    expect(defineCompressionStrategy).toBe(defineOverflowStrategy);
  });
});
