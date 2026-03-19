/**
 * Per-slot overflow resolution (§7.2 — Phase 4.1).
 *
 * @packageDocumentation
 */

import { ContextOverflowError, InvalidConfigError } from '../errors.js';
import { toTokenCount, type TokenCount } from '../types/branded.js';
import type {
  OverflowContext,
  OverflowStrategyFn,
  SlotConfig,
  SlotOverflowStrategy,
} from '../types/config.js';
import type { ContentItem } from '../types/content.js';
import type {
  ContentEvictedEvent,
  ContextEvent,
  SlotOverflowEvent,
  WarningEvent,
} from '../types/events.js';
import type { ResolvedSlot } from '../types/plugin.js';
import type { TokenAccountant } from '../types/token-accountant.js';

import { truncateLatestStrategy } from './strategies/truncate-latest-strategy.js';
import { truncateStrategy, truncateFifo } from './strategies/truncate-strategy.js';

/** @deprecated Use {@link truncateFifo} from `contextcraft` (same implementation). */
export { truncateFifo as builtinTruncateFifo } from './strategies/truncate-strategy.js';

/** @deprecated Use {@link truncateLatest} from `contextcraft` (same implementation). */
export { truncateLatest as builtinTruncateLatest } from './strategies/truncate-latest-strategy.js';

/** Resolved slot plus {@link SlotConfig} for overflow / protection flags. */
export type OverflowEngineInputSlot = ResolvedSlot & {
  readonly config: SlotConfig;
};

export type OverflowEngineOptions = {
  /** Sum token counts for a list of items (or estimate). */
  countTokens(items: readonly ContentItem[]): number;

  /** Observability — overflow, eviction, warnings. */
  onEvent?: (event: ContextEvent) => void;

  /**
   * Override built-in named strategies (tests or advanced wiring).
   * Unspecified names use the engine defaults.
   */
  strategies?: Partial<Record<NamedOverflowStrategy, OverflowStrategyFn>>;
};

export type OverflowResolveRunOptions = {
  /**
   * Global context budget. When set, after each full pass the engine runs
   * escalation: if total tokens still exceed this value, all non-pinned items
   * are removed from the lowest-priority non-protected slot, then the pass repeats.
   */
  totalBudget?: number;
};

type NamedOverflowStrategy =
  | 'truncate'
  | 'truncate-latest'
  | 'summarize'
  | 'sliding-window'
  | 'semantic'
  | 'compress'
  | 'error';

type WorkingSlot = OverflowEngineInputSlot;

function sortByPriorityAsc(a: WorkingSlot, b: WorkingSlot): number {
  return a.priority - b.priority || a.name.localeCompare(b.name);
}

function cloneInputs(slots: readonly OverflowEngineInputSlot[]): WorkingSlot[] {
  return slots.map((s) => ({
    name: s.name,
    priority: s.priority,
    budgetTokens: s.budgetTokens,
    config: s.config,
    content: s.content.map((i) => ({ ...i })),
  }));
}

function toResolvedOutput(s: WorkingSlot): ResolvedSlot {
  return {
    name: s.name,
    priority: s.priority,
    budgetTokens: s.budgetTokens,
    content: s.content,
  };
}

function builtinSlidingWindow(
  items: ContentItem[],
  budget: TokenCount,
  countTokens: (xs: readonly ContentItem[]) => number,
  windowSize: number,
): ContentItem[] {
  const ws = Math.max(1, windowSize);
  const unpinnedWithIndex = items
    .map((it, index) => ({ it, index }))
    .filter((x) => !x.it.pinned);
  const keepUnpinned = new Set(
    unpinnedWithIndex.slice(-ws).map((x) => x.it.id),
  );
  let out = items.filter((it) => it.pinned || keepUnpinned.has(it.id));
  if (countTokens(out) > budget) {
    out = truncateFifo(out, budget, countTokens);
  }
  return out;
}

function builtinError(
  items: ContentItem[],
  budget: TokenCount,
  countTokens: (xs: readonly ContentItem[]) => number,
  slot: string,
): ContentItem[] {
  const actual = countTokens(items);
  if (actual > budget) {
    throw new ContextOverflowError(
      `Slot "${slot}" exceeded budget with overflow strategy "error"`,
      { slot, budgetTokens: budget, actualTokens: actual },
    );
  }
  return items;
}

function strategyNotImplemented(name: NamedOverflowStrategy): never {
  throw new InvalidConfigError(
    `Overflow strategy "${name}" is not implemented yet (see Phase 4.2–4.6)`,
    { context: { strategy: name } },
  );
}

function isNamedStrategy(s: string): s is NamedOverflowStrategy {
  return (
    s === 'truncate' ||
    s === 'truncate-latest' ||
    s === 'summarize' ||
    s === 'sliding-window' ||
    s === 'semantic' ||
    s === 'compress' ||
    s === 'error'
  );
}

/**
 * Resolves slot overflows: sorts by **ascending** priority (lowest first),
 * applies strategies, optional global escalation, emits events.
 */
export class OverflowEngine {
  private readonly countTokens: (items: readonly ContentItem[]) => number;

  /** Present only when the constructor was given `onEvent` (exactOptionalPropertyTypes). */
  private readonly onEvent: ((event: ContextEvent) => void) | undefined;

  private readonly builtins: Record<NamedOverflowStrategy, OverflowStrategyFn>;

  constructor(options: OverflowEngineOptions) {
    const count = options.countTokens;
    this.countTokens = count;
    this.onEvent = options.onEvent;

    const base: Record<NamedOverflowStrategy, OverflowStrategyFn> = {
      truncate: truncateStrategy,
      'truncate-latest': truncateLatestStrategy,
      'sliding-window': (items, budget, ctx) => {
        const cfg = (ctx as OverflowContext & { slotConfig?: SlotConfig })
          .slotConfig;
        const ws =
          cfg?.overflowConfig?.windowSize ??
          (ctx as { windowSize?: number }).windowSize ??
          10;
        return Promise.resolve(
          builtinSlidingWindow(items, budget, count, ws),
        );
      },
      error: (items, budget, ctx) => {
        const slot = typeof ctx.slot === 'string' ? ctx.slot : '';
        return Promise.resolve(builtinError(items, budget, count, slot));
      },
      summarize: (_items, _budget, _ctx) => {
        strategyNotImplemented('summarize');
      },
      semantic: (_items, _budget, _ctx) => {
        strategyNotImplemented('semantic');
      },
      compress: (_items, _budget, _ctx) => {
        strategyNotImplemented('compress');
      },
    };

    this.builtins = { ...base, ...options.strategies };
  }

  private emit(ev: ContextEvent): void {
    this.onEvent?.(ev);
  }

  private emitWarning(warning: WarningEvent['warning']): void {
    const ev: WarningEvent = { type: 'warning', warning };
    this.emit(ev);
  }

  private emitOverflow(
    slot: string,
    strategy: string,
    beforeTokens: number,
    afterTokens: number,
  ): void {
    const ev: SlotOverflowEvent = {
      type: 'slot:overflow',
      slot,
      strategy,
      beforeTokens,
      afterTokens,
    };
    this.emit(ev);
  }

  private emitEvicted(
    slot: string,
    item: ContentItem,
    reason: string,
  ): void {
    const ev: ContentEvictedEvent = {
      type: 'content:evicted',
      slot,
      item,
      reason,
    };
    this.emit(ev);
  }

  private diffEvictions(
    slot: string,
    before: readonly ContentItem[],
    after: readonly ContentItem[],
    reason: string,
  ): void {
    const afterIds = new Set(after.map((i) => i.id));
    for (const item of before) {
      if (!afterIds.has(item.id)) {
        this.emitEvicted(slot, item, reason);
      }
    }
  }

  private resolveStrategy(
    overflow: SlotOverflowStrategy | undefined,
  ): { label: string; fn: OverflowStrategyFn } {
    if (typeof overflow === 'function') {
      return { label: 'custom', fn: overflow };
    }
    const name = overflow ?? 'truncate';
    if (!isNamedStrategy(name)) {
      throw new InvalidConfigError(`Unknown overflow strategy "${name}"`, {
        context: { strategy: name },
      });
    }
    const fn = this.builtins[name];
    return { label: name, fn };
  }

  private async processSlot(slot: WorkingSlot): Promise<void> {
    const used = this.countTokens(slot.content);
    if (used <= slot.budgetTokens) return;

    if (slot.config.protected) {
      this.emitWarning({
        code: 'SLOT_PROTECTED_OVER_BUDGET',
        message: `Slot "${slot.name}" is over token budget but marked protected; skipping overflow`,
        slot: slot.name,
        severity: 'warn',
      });
      return;
    }

    const { label, fn } = this.resolveStrategy(slot.config.overflow);
    const budget = toTokenCount(slot.budgetTokens);
    const tokenAccountant: TokenAccountant = {
      countItems: (items) => this.countTokens(items),
    };
    const ctx: OverflowContext & { slotConfig?: SlotConfig } = {
      slot: slot.name,
      slotConfig: slot.config,
      tokenAccountant,
    };

    const beforeTokens = used;
    const newContent = await fn(slot.content, budget, ctx);
    const afterTokens = this.countTokens(newContent);

    this.emitOverflow(slot.name, label, beforeTokens, afterTokens);
    this.diffEvictions(
      slot.name,
      slot.content,
      newContent,
      `overflow:${label}`,
    );
    slot.content = newContent;
  }

  private totalUsed(slots: readonly WorkingSlot[]): number {
    let t = 0;
    for (const s of slots) {
      t += this.countTokens(s.content);
    }
    return t;
  }

  private pickEscalationTarget(slots: readonly WorkingSlot[]): WorkingSlot | undefined {
    const sorted = [...slots].sort(sortByPriorityAsc);
    for (const s of sorted) {
      if (s.config.protected) continue;
      if (s.content.some((i) => !i.pinned)) return s;
    }
    return undefined;
  }

  private escalateFullSlot(target: WorkingSlot): void {
    const removable = target.content.filter((i) => !i.pinned);
    for (const item of removable) {
      this.emitEvicted(
        target.name,
        item,
        'escalation: full eviction of lowest-priority non-protected slot',
      );
    }
    target.content = target.content.filter((i) => i.pinned);
  }

  /**
   * Runs overflow resolution for all slots.
   *
   * @param slots - Resolved slots with content and {@link SlotConfig}
   * @param runOptions - Optional global {@link OverflowResolveRunOptions.totalBudget} for escalation
   * @returns New {@link ResolvedSlot} array (content may be truncated); `config` is not part of the output type
   */
  async resolve(
    slots: readonly OverflowEngineInputSlot[],
    runOptions?: OverflowResolveRunOptions,
  ): Promise<ResolvedSlot[]> {
    const working = cloneInputs(slots);
    const totalBudget = runOptions?.totalBudget;
    const maxRounds = Math.max(32, working.length * 4 + 8);

    for (let round = 0; round < maxRounds; round++) {
      working.sort(sortByPriorityAsc);

      for (const slot of working) {
        await this.processSlot(slot);
      }

      if (totalBudget === undefined) {
        return working.map(toResolvedOutput);
      }

      if (this.totalUsed(working) <= totalBudget) {
        return working.map(toResolvedOutput);
      }

      const target = this.pickEscalationTarget(working);
      if (target === undefined) {
        this.emitWarning({
          code: 'ESCALATION_EXHAUSTED',
          message:
            'Total context still over global budget but no non-protected slot with evictable content remains',
          severity: 'warn',
        });
        return working.map(toResolvedOutput);
      }

      this.escalateFullSlot(target);
    }

    this.emitWarning({
      code: 'ESCALATION_MAX_ROUNDS',
      message: 'Overflow escalation stopped after maximum rounds',
      severity: 'warn',
    });
    return working.map(toResolvedOutput);
  }
}
