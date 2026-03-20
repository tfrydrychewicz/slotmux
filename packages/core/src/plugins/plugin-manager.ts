/**
 * {@link PluginManager} — plugin lifecycle, hooks, and strategy registration (§11.1 / Phase 7.2).
 *
 * @packageDocumentation
 */

import { compressionContextFromOverflow } from '../compression/from-overflow-context.js';
import { InvalidConfigError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import { orderedSlotEntriesForBudget } from '../slots/budget-allocator.js';
import type { ContextSnapshot } from '../snapshot/context-snapshot.js';
import type {
  OverflowStrategyFn,
  SlotConfig,
} from '../types/config.js';
import type {
  CompiledMessage,
  ContentItem,
} from '../types/content.js';
import type { ContextEvent } from '../types/events.js';
import type {
  CompressionStrategy,
  ContextPlugin,
  PluginContext,
  PluginLogger,
  ResolvedSlot,
  TokenCountCache,
} from '../types/plugin.js';

const noopPluginLogger: PluginLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function adaptCompressorToOverflow(
  compressor: CompressionStrategy,
  tokenCounter: TokenCountCache,
  fallbackLogger: Logger,
): OverflowStrategyFn {
  return (items, budget, ctx) =>
    Promise.resolve(
      compressor.compress(
        items,
        budget,
        compressionContextFromOverflow(ctx, { tokenCounter, fallbackLogger }),
      ),
    );
}

type OverflowReg = {
  readonly plugin: ContextPlugin;
  readonly name: string;
  readonly fn: OverflowStrategyFn;
};

type CompressorReg = {
  readonly plugin: ContextPlugin;
  readonly name: string;
  readonly compressor: CompressionStrategy;
};

export type PluginManagerOptions = {
  /** Current slot layout (may change between installs). */
  readonly getSlots: () => Record<string, SlotConfig>;

  readonly tokenCounter: TokenCountCache;

  /**
   * Scoped logger factory; defaults to no-op loggers.
   * Use for `[contextcraft:pluginName]` style output (see Phase 7.3).
   */
  readonly createLogger?: (pluginName: string) => PluginLogger;

  /**
   * When a compressor runs via {@link OverflowEngine} without `strategyLogger`,
   * this {@link Logger} is passed as {@link CompressionContext.logger}.
   */
  readonly compressionFallbackLogger?: Logger;

  /**
   * Receives {@link ContextPlugin.install} failures before rethrow (§13.3 — Phase 10.1).
   */
  readonly logger?: Logger;
};

/** Hook names supported by {@link PluginManager.runHook}. */
export type PluginManagerHook =
  | 'beforeBudgetResolve'
  | 'afterBudgetResolve'
  | 'beforeOverflow'
  | 'afterOverflow'
  | 'beforeSnapshot'
  | 'afterSnapshot'
  | 'onContentAdded'
  | 'onEvent';

/**
 * Registers {@link ContextPlugin} instances, runs {@link ContextPlugin.install},
 * exposes {@link PluginContext.registerOverflowStrategy} / {@link PluginContext.registerCompressor},
 * and runs lifecycle hooks in registration order with per-plugin error isolation.
 */
export class PluginManager {
  private readonly getSlots: () => Record<string, SlotConfig>;

  private readonly tokenCounter: TokenCountCache;

  private readonly createLogger: (pluginName: string) => PluginLogger;

  private readonly compressionFallbackLogger: Logger;

  private readonly pipelineLogger: Logger;

  private readonly plugins: ContextPlugin[] = [];

  private readonly seen = new Set<ContextPlugin>();

  private overflowRegs: OverflowReg[] = [];

  private compressorRegs: CompressorReg[] = [];

  constructor(options: PluginManagerOptions) {
    this.getSlots = options.getSlots;
    this.tokenCounter = options.tokenCounter;
    this.createLogger = options.createLogger ?? (() => noopPluginLogger);
    this.compressionFallbackLogger = options.compressionFallbackLogger ?? noopPluginLogger;
    this.pipelineLogger = options.logger ?? noopPluginLogger;
  }

  /** Plugins in registration order. */
  getPlugins(): readonly ContextPlugin[] {
    return this.plugins;
  }

  /**
   * Named overflow functions for {@link OverflowEngine} (includes compressor-backed names).
   */
  getNamedOverflowStrategiesForEngine(): Record<string, OverflowStrategyFn> {
    const out: Record<string, OverflowStrategyFn> = {};
    for (const r of this.overflowRegs) {
      out[r.name] = r.fn;
    }
    return out;
  }

  /** Last registered compressor for `name`, if any. */
  getCompressor(name: string): CompressionStrategy | undefined {
    for (let i = this.compressorRegs.length - 1; i >= 0; i--) {
      const r = this.compressorRegs[i]!;
      if (r.name === name) {
        return r.compressor;
      }
    }
    return undefined;
  }

  private buildPluginContext(plugin: ContextPlugin): PluginContext {
    return {
      getSlots: () => this.getSlots(),
      tokenCounter: this.tokenCounter,
      registerOverflowStrategy: (name: string, strategy: OverflowStrategyFn): void => {
        this.overflowRegs.push({ plugin, name, fn: strategy });
      },
      registerCompressor: (name: string, compressor: CompressionStrategy): void => {
        if (compressor.name !== name) {
          throw new InvalidConfigError(
            `registerCompressor("${name}"): compressor.name must match (got "${compressor.name}")`,
            { context: { name, compressorName: compressor.name } },
          );
        }
        this.compressorRegs.push({ plugin, name, compressor });
        this.overflowRegs.push({
          plugin,
          name,
          fn: adaptCompressorToOverflow(
            compressor,
            this.tokenCounter,
            this.compressionFallbackLogger,
          ),
        });
      },
      logger: this.createLogger(plugin.name),
    };
  }

  /**
   * Calls {@link ContextPlugin.install} then tracks the plugin for hooks.
   *
   * @throws {@link InvalidConfigError} When the same plugin instance is registered twice.
   */
  async register(plugin: ContextPlugin): Promise<void> {
    if (this.seen.has(plugin)) {
      throw new InvalidConfigError(`Plugin "${plugin.name}" is already registered on this PluginManager`, {
        context: { plugin: plugin.name },
      });
    }
    const ctx = this.buildPluginContext(plugin);
    try {
      if (plugin.install !== undefined) {
        await Promise.resolve(plugin.install(ctx));
      }
    } catch (error) {
      this.pipelineLogger.error(
        `Plugin "${plugin.name}" install failed; registrations rolled back`,
        error,
      );
      this.overflowRegs = this.overflowRegs.filter((r) => r.plugin !== plugin);
      this.compressorRegs = this.compressorRegs.filter((r) => r.plugin !== plugin);
      throw error;
    }
    this.seen.add(plugin);
    this.plugins.push(plugin);
  }

  /**
   * Calls {@link ContextPlugin.destroy}, removes hook participation, and drops strategy registrations
   * made from that plugin’s {@link PluginContext}.
   */
  async unregister(plugin: ContextPlugin): Promise<void> {
    if (!this.seen.has(plugin)) {
      return;
    }
    this.seen.delete(plugin);
    const idx = this.plugins.indexOf(plugin);
    if (idx >= 0) {
      this.plugins.splice(idx, 1);
    }
    this.overflowRegs = this.overflowRegs.filter((r) => r.plugin !== plugin);
    this.compressorRegs = this.compressorRegs.filter((r) => r.plugin !== plugin);
    if (plugin.destroy !== undefined) {
      await Promise.resolve(plugin.destroy());
    }
  }

  private async runBeforeBudgetResolve(
    slots: Record<string, SlotConfig>,
  ): Promise<Record<string, SlotConfig>> {
    const ordered = orderedSlotEntriesForBudget(slots);
    let configs = ordered.map((e) => e.config);
    for (const p of this.plugins) {
      if (p.beforeBudgetResolve === undefined) {
        continue;
      }
      try {
        const out = await Promise.resolve(p.beforeBudgetResolve(configs));
        if (Array.isArray(out) && out.length === configs.length) {
          configs = out;
        }
      } catch {
        /* isolate */
      }
    }
    const nextSlots: Record<string, SlotConfig> = { ...slots };
    for (let i = 0; i < ordered.length; i++) {
      nextSlots[ordered[i]!.name] = configs[i]!;
    }
    return nextSlots;
  }

  private async runAfterBudgetResolve(resolved: readonly ResolvedSlot[]): Promise<void> {
    for (const p of this.plugins) {
      if (p.afterBudgetResolve === undefined) {
        continue;
      }
      try {
        await Promise.resolve(p.afterBudgetResolve(resolved));
      } catch {
        /* isolate */
      }
    }
  }

  private async runBeforeOverflow(slot: string, items: ContentItem[]): Promise<ContentItem[]> {
    let cur = items;
    for (const p of this.plugins) {
      if (p.beforeOverflow === undefined) {
        continue;
      }
      try {
        const out = await Promise.resolve(p.beforeOverflow(slot, cur));
        cur = out;
      } catch {
        /* isolate */
      }
    }
    return cur;
  }

  private async runAfterOverflow(
    preBySlot: ReadonlyMap<string, readonly ContentItem[]>,
    after: readonly ResolvedSlot[],
  ): Promise<void> {
    for (const p of this.plugins) {
      if (p.afterOverflow === undefined) {
        continue;
      }
      for (const rs of after) {
        try {
          const pre = preBySlot.get(rs.name) ?? [];
          const afterIds = new Set(rs.content.map((i) => i.id));
          const evicted = pre.filter((i) => !afterIds.has(i.id));
          await Promise.resolve(p.afterOverflow(rs.name, rs.content, evicted));
        } catch {
          /* isolate */
        }
      }
    }
  }

  private async runBeforeSnapshot(messages: CompiledMessage[]): Promise<CompiledMessage[]> {
    let cur = messages;
    for (const p of this.plugins) {
      if (p.beforeSnapshot === undefined) {
        continue;
      }
      try {
        const out = await Promise.resolve(p.beforeSnapshot(cur));
        cur = out;
      } catch {
        /* isolate */
      }
    }
    return cur;
  }

  private async runAfterSnapshot(snapshot: ContextSnapshot): Promise<void> {
    for (const p of this.plugins) {
      if (p.afterSnapshot === undefined) {
        continue;
      }
      try {
        await Promise.resolve(p.afterSnapshot(snapshot));
      } catch {
        /* isolate */
      }
    }
  }

  private runOnContentAdded(slot: string, item: ContentItem): void {
    for (const p of this.plugins) {
      if (p.onContentAdded === undefined) {
        continue;
      }
      try {
        void Promise.resolve(p.onContentAdded(slot, item));
      } catch {
        /* isolate */
      }
    }
  }

  private runOnEvent(event: ContextEvent): void {
    for (const p of this.plugins) {
      if (p.onEvent === undefined) {
        continue;
      }
      try {
        p.onEvent(event);
      } catch {
        /* isolate */
      }
    }
  }

  /**
   * Runs the given lifecycle hook across plugins in registration order.
   * Transform hooks return the updated value; void hooks return `undefined`.
   */
  async runHook(
    hook: 'beforeBudgetResolve',
    slots: Record<string, SlotConfig>,
  ): Promise<Record<string, SlotConfig>>;
  async runHook(
    hook: 'afterBudgetResolve',
    resolved: readonly ResolvedSlot[],
  ): Promise<void>;
  async runHook(
    hook: 'beforeOverflow',
    slot: string,
    items: ContentItem[],
  ): Promise<ContentItem[]>;
  async runHook(
    hook: 'afterOverflow',
    preBySlot: ReadonlyMap<string, readonly ContentItem[]>,
    after: readonly ResolvedSlot[],
  ): Promise<void>;
  async runHook(
    hook: 'beforeSnapshot',
    messages: CompiledMessage[],
  ): Promise<CompiledMessage[]>;
  async runHook(hook: 'afterSnapshot', snapshot: ContextSnapshot): Promise<void>;
  async runHook(
    hook: 'onContentAdded',
    slot: string,
    item: ContentItem,
  ): Promise<void>;
  async runHook(hook: 'onEvent', event: ContextEvent): Promise<void>;
  async runHook(
    hook: PluginManagerHook,
    ...args: unknown[]
  ): Promise<Record<string, SlotConfig> | ContentItem[] | CompiledMessage[] | void> {
    switch (hook) {
      case 'beforeBudgetResolve':
        return this.runBeforeBudgetResolve(args[0] as Record<string, SlotConfig>);
      case 'afterBudgetResolve':
        await this.runAfterBudgetResolve(args[0] as readonly ResolvedSlot[]);
        return;
      case 'beforeOverflow':
        return this.runBeforeOverflow(args[0] as string, args[1] as ContentItem[]);
      case 'afterOverflow':
        await this.runAfterOverflow(
          args[0] as ReadonlyMap<string, readonly ContentItem[]>,
          args[1] as readonly ResolvedSlot[],
        );
        return;
      case 'beforeSnapshot':
        return this.runBeforeSnapshot(args[0] as CompiledMessage[]);
      case 'afterSnapshot':
        await this.runAfterSnapshot(args[0] as ContextSnapshot);
        return;
      case 'onContentAdded':
        this.runOnContentAdded(args[0] as string, args[1] as ContentItem);
        return;
      case 'onEvent':
        this.runOnEvent(args[0] as ContextEvent);
        return;
    }
  }
}
