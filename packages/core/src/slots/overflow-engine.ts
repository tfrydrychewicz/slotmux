/**
 * Per-slot overflow resolution (§7.2).
 *
 * @packageDocumentation
 */

import type {
  MapReduceSummarizeDeps,
  ProgressiveSummarizeTextFn,
} from '@slotmux/compression';

import { losslessCompressAsOverflow } from '../compression/lossless-bridge.js';
import { createProgressiveSummarizeOverflow } from '../compression/progressive-overflow-bridge.js';
import { semanticCompressAsOverflow } from '../compression/semantic-overflow-bridge.js';
import { InvalidConfigError } from '../errors.js';
import { toTokenCount, type TokenCount } from '../types/branded.js';
import type {
  OverflowContext,
  OverflowStrategyFn,
  OverflowStrategyLogger,
  SlotConfig,
  SlotOverflowStrategy,
} from '../types/config.js';
import type { ContentItem } from '../types/content.js';
import type {
  CompressionCompleteEvent,
  CompressionStartEvent,
  ContentEvictedEvent,
  ContextEvent,
  SlotOverflowEvent,
  WarningEvent,
} from '../types/events.js';
import type { ResolvedSlot } from '../types/plugin.js';
import type { TokenAccountant } from '../types/token-accountant.js';

import { errorStrategy } from './strategies/error-strategy.js';
import { createFallbackChainStrategy } from './strategies/fallback-chain-strategy.js';
import { slidingWindowStrategy } from './strategies/sliding-window-strategy.js';
import { truncateLatestStrategy } from './strategies/truncate-latest-strategy.js';
import { truncateStrategy } from './strategies/truncate-strategy.js';

/** @deprecated Use {@link truncateFifo} from `slotmux` (same implementation). */
export { truncateFifo as builtinTruncateFifo } from './strategies/truncate-strategy.js';

/** @deprecated Use {@link truncateLatest} from `slotmux` (same implementation). */
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
   * Included on {@link OverflowContext} as `logger` for custom / factory-built strategies
   * (§8.4).
   */
  strategyLogger?: OverflowStrategyLogger;

  /**
   * Per-slot logger for {@link OverflowContext.logger} (§13.3).
   * When set, takes precedence over {@link strategyLogger}.
   */
  strategyLoggerFactory?: (slot: string) => OverflowStrategyLogger;

  /**
   * Override built-in named strategies (tests or advanced wiring).
   * Unspecified names use the engine defaults.
   */
  strategies?: Partial<Record<NamedOverflowStrategy, OverflowStrategyFn>>;

  /**
   * Extra strategy names (e.g. from {@link PluginManager.getNamedOverflowStrategiesForEngine})
   * used when {@link SlotConfig.overflow} is a string that is not a built-in name.
   */
  namedStrategies?: Record<string, OverflowStrategyFn>;

  /**
   * Enables built-in `summarize` (§8.1): progressive and/or map-reduce. Without this, `summarize` throws until configured.
   */
  progressiveSummarize?: {
    readonly summarizeText: ProgressiveSummarizeTextFn;
    /** Required when a slot uses `overflowConfig.summarizer: 'builtin:map-reduce'`. */
    readonly mapReduce?: MapReduceSummarizeDeps;
  };
};

export type OverflowResolveRunOptions = {
  /**
   * Global context budget. When set, after each full pass the engine runs
   * escalation: if total tokens still exceed this value, all non-pinned items
   * are removed from the lowest-priority non-protected slot, then the pass repeats.
   */
  totalBudget?: number;

  /**
   * When `true`, overflow strategies run on all eligible slots even when their
   * content is within budget. Useful for on-demand context compression.
   *
   * For slots that are within budget, the engine sets a synthetic reduced budget
   * (50% of current usage) so the strategy has a meaningful target to compress toward.
   */
  forceCompress?: boolean;
};

type NamedOverflowStrategy =
  | 'truncate'
  | 'truncate-latest'
  | 'summarize'
  | 'sliding-window'
  | 'semantic'
  | 'compress'
  | 'error'
  | 'fallback-chain';

/** Built-ins except `fallback-chain`, which is composed after user overrides are merged. */
type CoreNamedOverflowStrategy = Exclude<NamedOverflowStrategy, 'fallback-chain'>;

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

function strategyNotImplemented(name: NamedOverflowStrategy): never {
  throw new InvalidConfigError(
    `Overflow strategy "${name}" is not implemented yet (see §5.2 overflow strategies)`,
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
    s === 'error' ||
    s === 'fallback-chain'
  );
}

/** Strategies that transform content for token reduction (§13.1 — compression events). */
function isCompressionLikeOverflowLabel(label: string): boolean {
  return label === 'compress' || label === 'summarize' || label === 'semantic';
}

/**
 * Resolves slot overflows: sorts by **ascending** priority (lowest first),
 * applies strategies, optional global escalation, emits events.
 */
export class OverflowEngine {
  private readonly countTokens: (items: readonly ContentItem[]) => number;

  /** Present only when the constructor was given `onEvent` (exactOptionalPropertyTypes). */
  private readonly onEvent: ((event: ContextEvent) => void) | undefined;

  private readonly strategyLogger: OverflowStrategyLogger | undefined;

  private readonly strategyLoggerFactory:
    | ((slot: string) => OverflowStrategyLogger)
    | undefined;

  private readonly builtins: Record<NamedOverflowStrategy, OverflowStrategyFn>;

  private readonly namedStrategies: Record<string, OverflowStrategyFn>;

  constructor(options: OverflowEngineOptions) {
    this.countTokens = options.countTokens;
    this.onEvent = options.onEvent;
    this.strategyLogger = options.strategyLogger;
    this.strategyLoggerFactory = options.strategyLoggerFactory;

    const builtinSummarize =
      options.progressiveSummarize !== undefined
        ? createProgressiveSummarizeOverflow(
            options.countTokens,
            options.progressiveSummarize,
          )
        : (
            _items: readonly ContentItem[],
            _budget: TokenCount,
            _ctx: OverflowContext,
          ) => {
            strategyNotImplemented('summarize');
          };

    const coreBuiltins: Record<CoreNamedOverflowStrategy, OverflowStrategyFn> = {
      truncate: truncateStrategy,
      'truncate-latest': truncateLatestStrategy,
      'sliding-window': slidingWindowStrategy,
      error: errorStrategy,
      summarize: builtinSummarize,
      semantic: semanticCompressAsOverflow,
      compress: losslessCompressAsOverflow,
    };

    const userStrategies = options.strategies ?? {};
    const merged = {
      ...coreBuiltins,
      ...userStrategies,
    };

    const builtins: Record<NamedOverflowStrategy, OverflowStrategyFn> = {
      ...merged,
      'fallback-chain': Object.hasOwn(userStrategies, 'fallback-chain')
        ? userStrategies['fallback-chain']!
        : createFallbackChainStrategy({
            summarize: merged.summarize,
            compress: merged.compress,
            truncate: merged.truncate,
            error: merged.error,
          }),
    };

    this.builtins = builtins;
    this.namedStrategies = options.namedStrategies ?? {};
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

  private emitCompressionStart(slot: string, itemCount: number): void {
    const ev: CompressionStartEvent = {
      type: 'compression:start',
      slot,
      itemCount,
    };
    this.emit(ev);
  }

  /**
   * `ratio` = fraction of tokens removed: `1 - afterTokens/beforeTokens` (see {@link SnapshotMeta.compressions}).
   */
  private emitCompressionComplete(
    slot: string,
    beforeTokens: number,
    afterTokens: number,
  ): void {
    const ratio = beforeTokens > 0 ? 1 - afterTokens / beforeTokens : 0;
    const ev: CompressionCompleteEvent = {
      type: 'compression:complete',
      slot,
      beforeTokens,
      afterTokens,
      ratio,
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

  private buildOverflowContext(slot: WorkingSlot): OverflowContext {
    const tokenAccountant: TokenAccountant = {
      countItems: (items) => this.countTokens(items),
    };
    const base: OverflowContext = {
      slot: slot.name,
      slotName: slot.name,
      slotConfig: slot.config,
      tokenAccountant,
    };
    if (this.strategyLoggerFactory !== undefined) {
      return { ...base, logger: this.strategyLoggerFactory(slot.name) };
    }
    if (this.strategyLogger !== undefined) {
      return { ...base, logger: this.strategyLogger };
    }
    return base;
  }

  private resolveStrategy(
    overflow: SlotOverflowStrategy | undefined,
  ): { label: string; fn: OverflowStrategyFn } {
    if (typeof overflow === 'function') {
      return { label: 'custom', fn: overflow };
    }
    const name = overflow ?? 'truncate';
    if (isNamedStrategy(name)) {
      const fn = this.builtins[name];
      return { label: name, fn };
    }
    const pluginFn = this.namedStrategies[name];
    if (pluginFn !== undefined) {
      return { label: name, fn: pluginFn };
    }
    throw new InvalidConfigError(`Unknown overflow strategy "${name}"`, {
      context: { strategy: name },
    });
  }

  private async processSlot(
    slot: WorkingSlot,
    forceCompress?: boolean,
  ): Promise<void> {
    const ctx = this.buildOverflowContext(slot);
    const used = this.countTokens(slot.content);
    if (used <= slot.budgetTokens && !forceCompress) return;

    if (slot.config.protected) {
      ctx.logger?.warn(
        `Slot is over token budget but marked protected; skipping overflow`,
      );
      this.emitWarning({
        code: 'SLOT_PROTECTED_OVER_BUDGET',
        message: `Slot "${slot.name}" is over token budget but marked protected; skipping overflow`,
        slot: slot.name,
        severity: 'warn',
      });
      return;
    }

    let label: string;
    let fn: OverflowStrategyFn;
    try {
      const resolved = this.resolveStrategy(slot.config.overflow);
      label = resolved.label;
      fn = resolved.fn;
    } catch (err) {
      ctx.logger?.error('Overflow strategy resolution failed', err);
      throw err;
    }

    const effectiveBudget =
      forceCompress && used <= slot.budgetTokens
        ? toTokenCount(Math.floor(used * 0.5))
        : toTokenCount(slot.budgetTokens);

    const beforeTokens = used;
    const compressionLike = isCompressionLikeOverflowLabel(label);
    if (compressionLike) {
      this.emitCompressionStart(slot.name, slot.content.length);
    }

    let newContent: ContentItem[];
    try {
      newContent = await fn(slot.content, effectiveBudget, ctx);
    } catch (err) {
      ctx.logger?.error('Overflow strategy execution failed', err);
      throw err;
    }
    const afterTokens = this.countTokens(newContent);

    if (compressionLike) {
      this.emitCompressionComplete(slot.name, beforeTokens, afterTokens);
    }

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
    const forceCompress = runOptions?.forceCompress;
    const maxRounds = Math.max(32, working.length * 4 + 8);

    for (let round = 0; round < maxRounds; round++) {
      working.sort(sortByPriorityAsc);

      for (const slot of working) {
        await this.processSlot(slot, forceCompress);
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
