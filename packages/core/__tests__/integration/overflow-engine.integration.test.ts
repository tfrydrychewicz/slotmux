/**
 * Phase 4.8 — Overflow engine integration tests (§17.2 escalation / protection).
 */

import { describe, expect, it } from 'vitest';

import {
  OverflowEngine,
  createContentItem,
  toTokenCount,
  type ContextEvent,
  type OverflowEngineInputSlot,
} from '../../src/index.js';
import type { SlotConfig } from '../../src/types/config.js';
import type { ContentItem } from '../../src/types/content.js';

function slot(
  name: string,
  priority: number,
  budgetTokens: number,
  config: SlotConfig,
  content: ContentItem[],
): OverflowEngineInputSlot {
  return {
    name,
    priority,
    budgetTokens,
    config,
    content,
  };
}

function countSum(items: readonly ContentItem[]): number {
  return items.reduce((s, i) => s + (i.tokens ?? 0), 0);
}

describe('OverflowEngine integration (Phase 4.8)', () => {
  it('§17.2: escalation evicts lowest-priority (lowest numeric priority) slot first', async () => {
    const escalationSlots: string[] = [];
    const onEvent = (e: ContextEvent): void => {
      if (
        e.type === 'content:evicted' &&
        e.reason.includes('escalation: full eviction')
      ) {
        escalationSlots.push(e.slot);
      }
    };

    const mk = (slotName: string, tok: number) =>
      createContentItem({
        slot: slotName,
        role: 'user',
        content: slotName,
        tokens: toTokenCount(tok),
      });

    const flex: SlotConfig = { priority: 50, budget: { flex: true } };

    const engine = new OverflowEngine({ countTokens: countSum, onEvent });
    await engine.resolve(
      [
        slot('prio90', 90, 500, flex, [mk('prio90', 50)]),
        slot('prio10', 10, 500, flex, [mk('prio10', 50)]),
        slot('prio50', 50, 500, flex, [mk('prio50', 50)]),
      ],
      { totalBudget: 30 },
    );

    expect(escalationSlots.length).toBeGreaterThan(0);
    expect(escalationSlots[0]).toBe('prio10');
  });

  it('§4.8: escalation when per-slot budgets are satisfied but global totalBudget is exceeded', async () => {
    const reasons: string[] = [];
    const engine = new OverflowEngine({
      countTokens: countSum,
      onEvent: (e) => {
        if (e.type === 'content:evicted') {
          reasons.push(e.reason);
        }
      },
    });

    const flex: SlotConfig = { priority: 50, budget: { flex: true } };
    const a = createContentItem({
      slot: 'a',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(60),
    });
    const b = createContentItem({
      slot: 'b',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(60),
    });

    const out = await engine.resolve(
      [
        slot('a', 10, 200, flex, [a]),
        slot('b', 20, 200, flex, [b]),
      ],
      { totalBudget: 70 },
    );

    expect(
      reasons.some((r) => r.includes('escalation: full eviction')),
    ).toBe(true);
    expect(countSum(out[0]!.content) + countSum(out[1]!.content)).toBeLessThanOrEqual(
      70,
    );
  });

  it('§4.8: protected slot emits warning and is not evicted by overflow or escalation', async () => {
    const warnings: string[] = [];
    const evictedBySlot = new Map<string, number>();

    const engine = new OverflowEngine({
      countTokens: countSum,
      onEvent: (e) => {
        if (e.type === 'warning') {
          warnings.push(e.warning.code);
        }
        if (e.type === 'content:evicted') {
          evictedBySlot.set(
            e.slot,
            (evictedBySlot.get(e.slot) ?? 0) + 1,
          );
        }
      },
    });

    const low = createContentItem({
      slot: 'low',
      role: 'user',
      content: 'L',
      tokens: toTokenCount(40),
    });
    const prot = createContentItem({
      slot: 'protected',
      role: 'system',
      content: 'P',
      tokens: toTokenCount(200),
    });

    const flex: SlotConfig = { priority: 50, budget: { flex: true } };

    const out = await engine.resolve(
      [
        slot('low', 10, 500, flex, [low]),
        slot(
          'protected',
          20,
          50,
          {
            ...flex,
            overflow: 'truncate',
            protected: true,
          },
          [prot],
        ),
      ],
      { totalBudget: 10 },
    );

    expect(warnings).toContain('SLOT_PROTECTED_OVER_BUDGET');
    expect(evictedBySlot.get('protected')).toBeUndefined();
    const protOut = out.find((s) => s.name === 'protected')!;
    expect(protOut.content).toHaveLength(1);
    expect(protOut.content[0]!.id).toBe(prot.id);
    expect(warnings).toContain('ESCALATION_EXHAUSTED');
  });

  it('§4.8: multiple overflow + escalation rounds converge to within totalBudget', async () => {
    const mk = (name: string, t: number) =>
      createContentItem({
        slot: name,
        role: 'user',
        content: 'x',
        tokens: toTokenCount(t),
      });

    const flex: SlotConfig = {
      priority: 50,
      budget: { flex: true },
      overflow: 'truncate',
    };

    const engine = new OverflowEngine({ countTokens: countSum });
    const out = await engine.resolve(
      [
        slot('first', 10, 80, flex, [mk('first', 50), mk('first', 50)]),
        slot('second', 20, 80, flex, [mk('second', 50), mk('second', 50)]),
        slot('third', 30, 80, flex, [mk('third', 50), mk('third', 50)]),
      ],
      { totalBudget: 90 },
    );

    const total = out.reduce((s, sl) => s + countSum(sl.content), 0);
    expect(total).toBeLessThanOrEqual(90);
  });
});
