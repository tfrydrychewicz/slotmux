/**
 * Resolves per-slot token budgets from {@link SlotConfig} (§7.1 — Phase 3.3).
 *
 * @packageDocumentation
 */

import { BudgetExceededError, InvalidBudgetError } from '../errors.js';
import type { SlotBudget, SlotConfig } from '../types/config.js';
import type { SlotBudgetResolvedEvent } from '../types/events.js';
import type { ResolvedSlot } from '../types/plugin.js';

export type BudgetAllocatorOptions = {
  /** Fired once per slot after budgets are computed (§3.3). */
  onEvent?: (event: SlotBudgetResolvedEvent) => void;
};

type SlotEntry = { readonly name: string; readonly config: SlotConfig };

/**
 * Slot records in the same order as {@link BudgetAllocator.resolve} (priority desc, name asc).
 * Used by {@link ContextOrchestrator} for `beforeBudgetResolve` ↔ slot name round-trip.
 */
export function orderedSlotEntriesForBudget(
  slots: Record<string, SlotConfig>,
): SlotEntry[] {
  return sortSlots(toEntries(slots));
}

function sortSlots(entries: SlotEntry[]): SlotEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.config.priority - a.config.priority ||
      a.name.localeCompare(b.name),
  );
}

function toEntries(slots: Record<string, SlotConfig>): SlotEntry[] {
  return Object.entries(slots).map(([name, config]) => ({ name, config }));
}

function isFlexBudget(budget: SlotBudget): budget is
  | { flex: true }
  | { min: number; max: number; flex: true } {
  return 'flex' in budget && budget.flex === true;
}

function flexMin(budget: SlotBudget): number {
  return 'min' in budget && isFlexBudget(budget) ? budget.min : 0;
}

function flexMax(budget: SlotBudget): number {
  return 'max' in budget && isFlexBudget(budget)
    ? budget.max
    : Number.MAX_SAFE_INTEGER;
}

function sumMap(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) {
    s += v;
  }
  return s;
}

/**
 * Distributes `flexPool` across flex slots: minimums first, then equal chunks,
 * remainder to highest-priority slots with capacity (under max), respecting bounds.
 */
export function allocateFlexPool(
  flexSlots: SlotEntry[],
  flexPool: number,
): Map<string, number> {
  const sorted = sortSlots(flexSlots);
  const alloc = new Map<string, number>();

  if (sorted.length === 0) {
    return alloc;
  }

  let sumMin = 0;
  for (const s of sorted) {
    const m = flexMin(s.config.budget);
    alloc.set(s.name, m);
    sumMin += m;
  }

  if (sumMin > flexPool) {
    throw new BudgetExceededError(
      `Flex slot minimums (${sumMin}) exceed flex pool (${flexPool})`,
      {
        context: { flexPool, sumMins: sumMin },
      },
    );
  }

  let rem = flexPool - sumMin;
  const n = sorted.length;
  const extraEach = Math.floor(rem / n);

  for (const s of sorted) {
    const cur = alloc.get(s.name)!;
    const max = flexMax(s.config.budget);
    alloc.set(s.name, Math.min(max, cur + extraEach));
  }

  rem = flexPool - sumMap(alloc);

  while (rem > 0) {
    let placed = false;
    for (const s of sorted) {
      const cur = alloc.get(s.name)!;
      const max = flexMax(s.config.budget);
      if (cur < max) {
        alloc.set(s.name, cur + 1);
        rem--;
        placed = true;
        break;
      }
    }
    if (!placed) {
      break;
    }
  }

  return alloc;
}

/**
 * Round-robin bonus tokens onto percent slots (priority desc, cyclic), when there is no flex.
 */
function distributePercentBonus(
  percentSlots: SlotEntry[],
  alloc: Map<string, number>,
  bonus: number,
): void {
  if (bonus <= 0 || percentSlots.length === 0) {
    return;
  }
  const sorted = sortSlots(percentSlots);
  let i = 0;
  let b = bonus;
  while (b > 0) {
    const s = sorted[i % sorted.length]!;
    alloc.set(s.name, (alloc.get(s.name) ?? 0) + 1);
    i++;
    b--;
  }
}

/**
 * Resolves token budgets for all slots (fixed → percent of post-fixed pool → flex remainder).
 */
export class BudgetAllocator {
  private readonly options: BudgetAllocatorOptions;

  constructor(options?: BudgetAllocatorOptions) {
    this.options = options ?? {};
  }

  /**
   * @param slots - Slot name → configuration
   * @param totalBudget - Total context token budget (non-negative integer)
   * @returns Resolved slots sorted by priority (desc) then name; `content` is always `[]`
   * @throws {@link BudgetExceededError} If fixed budgets exceed `totalBudget`, or flex mins exceed flex pool
   * @throws {@link InvalidBudgetError} If the sum of percentage budgets exceeds 100
   */
  resolve(
    slots: Record<string, SlotConfig>,
    totalBudget: number,
  ): ResolvedSlot[] {
    if (!Number.isInteger(totalBudget) || totalBudget < 0) {
      throw new InvalidBudgetError(
        `totalBudget must be a non-negative integer, got ${totalBudget}`,
        { context: { totalBudget } },
      );
    }

    const entries = toEntries(slots);
    const alloc = new Map<string, number>();

    let fixedSum = 0;
    for (const { name, config } of entries) {
      const b = config.budget;
      if ('fixed' in b) {
        const f = b.fixed;
        if (!Number.isInteger(f) || f < 0) {
          throw new InvalidBudgetError(`Invalid fixed budget for slot "${name}"`, {
            context: { slot: name, fixed: f },
          });
        }
        fixedSum += f;
        alloc.set(name, f);
      }
    }

    if (fixedSum > totalBudget) {
      throw new BudgetExceededError(
        `Fixed slot budgets (${fixedSum}) exceed total budget (${totalBudget})`,
        { context: { fixedSum, totalBudget } },
      );
    }

    const poolAfterFixed = totalBudget - fixedSum;

    const percentSlots = entries.filter((e) => 'percent' in e.config.budget);
    const sumPercent = percentSlots.reduce(
      (s, e) => s + (e.config.budget as { percent: number }).percent,
      0,
    );

    if (sumPercent > 100) {
      throw new InvalidBudgetError(
        `Sum of slot percentage budgets (${sumPercent}) must not exceed 100`,
        { context: { sumPercent } },
      );
    }

    for (const e of percentSlots) {
      const p = (e.config.budget as { percent: number }).percent;
      alloc.set(
        e.name,
        Math.floor((poolAfterFixed * p) / 100),
      );
    }

    let usedPercent = 0;
    for (const e of percentSlots) {
      usedPercent += alloc.get(e.name) ?? 0;
    }

    let flexPool = poolAfterFixed - usedPercent;

    const flexSlots = entries.filter((e) => isFlexBudget(e.config.budget));

    if (flexSlots.length === 0) {
      distributePercentBonus(percentSlots, alloc, flexPool);
      flexPool = 0;
    } else {
      const flexAlloc = allocateFlexPool(flexSlots, flexPool);
      for (const [name, v] of flexAlloc) {
        alloc.set(name, v);
      }
    }

    for (const { name } of entries) {
      if (!alloc.has(name)) {
        alloc.set(name, 0);
      }
    }

    let totalAllocated = 0;
    for (const v of alloc.values()) {
      totalAllocated += v;
    }

    if (totalAllocated > totalBudget) {
      throw new BudgetExceededError(
        `Internal error: allocated ${totalAllocated} exceeds budget ${totalBudget}`,
        { context: { totalAllocated, totalBudget } },
      );
    }

    const ordered = sortSlots(entries);
    const result: ResolvedSlot[] = [];

    for (const { name, config } of ordered) {
      const budgetTokens = alloc.get(name) ?? 0;
      const ev: SlotBudgetResolvedEvent = {
        type: 'slot:budget-resolved',
        slot: name,
        budgetTokens,
      };
      this.options.onEvent?.(ev);

      result.push({
        name,
        priority: config.priority,
        budgetTokens,
        content: [],
      });
    }

    return result;
  }
}
