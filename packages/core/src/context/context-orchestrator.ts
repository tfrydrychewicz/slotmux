/**
 * Build pipeline: plugins → budget → token count → overflow → compile → snapshot (§5.3).
 *
 * @packageDocumentation
 */

import type { ParsedContextConfig } from '../config/validator.js';
import { compileContentItem } from '../content/compile-content-item.js';
import {
  fillMissingContentItemTokens,
  sumCachedItemTokensWithLazyFill,
  sumCachedOrEstimatedItemTokens,
  tryResolveTokenizerForLazyFill,
} from '../content/lazy-item-tokens.js';
import { InvalidConfigError } from '../errors.js';
import {
  createContextualLogger,
  createLeveledLogger,
  createRedactingLogger,
  LogLevel,
  newBuildOperationId,
  noopLogger,
} from '../logging/logger.js';
import { overflowStrategyLoggerFromLogger } from '../logging/overflow-strategy-logger.js';
import type { RedactionOptions } from '../logging/redact.js';
import {
  createContextEventRedactor,
  shouldRedactObservability,
} from '../logging/redaction-engine.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import {
  BudgetAllocator,
  orderedSlotEntriesForBudget,
} from '../slots/budget-allocator.js';
import { OverflowEngine } from '../slots/overflow-engine.js';
import { sumCachedItemTokens } from '../slots/strategies/truncate-strategy.js';
import { ContextSnapshot } from '../snapshot/context-snapshot.js';
import { toTokenCount } from '../types/branded.js';
import type { ProviderId, SlotConfig } from '../types/config.js';
import type { CompiledMessage, ContentItem } from '../types/content.js';
import type { ContextEvent } from '../types/events.js';
import type { ContextPlugin, ResolvedSlot } from '../types/plugin.js';
import type { ProviderAdapter } from '../types/provider.js';
import type {
  ContextWarning,
  EvictionEvent,
  SlotMeta,
  SnapshotMeta,
} from '../types/snapshot.js';
import type { TokenAccountant } from '../types/token-accountant.js';

import type { Context } from './context.js';

function resolvePlugins(config: ParsedContextConfig): readonly ContextPlugin[] {
  const raw = config.plugins;
  if (raw === undefined || raw.length === 0) {
    return [];
  }
  return raw as ContextPlugin[];
}

function resolveCountTokens(
  config: ParsedContextConfig,
  providerAdapters?: Partial<Record<ProviderId, ProviderAdapter>>,
): (items: readonly ContentItem[]) => number {
  const ta = config.tokenAccountant as TokenAccountant | undefined;
  if (ta !== undefined) {
    return (items) => ta.countItems(items);
  }
  if (config.lazyContentItemTokens === true) {
    const tokenizer = tryResolveTokenizerForLazyFill(
      config.model,
      providerAdapters,
      config.provider?.provider as ProviderId | undefined,
    );
    return (items) =>
      sumCachedItemTokensWithLazyFill(items as ContentItem[], (missing) => {
        if (tokenizer !== undefined) {
          fillMissingContentItemTokens({ items: missing, tokenizer });
        } else {
          fillMissingContentItemTokens({ items: missing });
        }
      });
  }
  if (config.charTokenEstimateForMissing === true) {
    return sumCachedOrEstimatedItemTokens;
  }
  return sumCachedItemTokens;
}

/** §19.1 — refuse estimated token paths when billing policy is enabled. */
function assertAuthoritativeTokenPolicy(config: ParsedContextConfig): void {
  if (config.requireAuthoritativeTokenCounts === true) {
    if (config.tokenAccountant === undefined) {
      throw new InvalidConfigError(
        'requireAuthoritativeTokenCounts is true but tokenAccountant is missing — supply an authoritative tokenAccountant for billing-sensitive paths (§19.1)',
        { context: { area: 'token-policy' } },
      );
    }
    if (config.lazyContentItemTokens === true || config.charTokenEstimateForMissing === true) {
      throw new InvalidConfigError(
        'requireAuthoritativeTokenCounts is incompatible with lazyContentItemTokens / charTokenEstimateForMissing — disable those flags when using authoritative counting (§19.1)',
        { context: { area: 'token-policy' } },
      );
    }
  }
}

async function applyBeforeBudgetResolvePlugins(
  slots: Record<string, SlotConfig>,
  plugins: readonly ContextPlugin[],
): Promise<Record<string, SlotConfig>> {
  if (plugins.length === 0) {
    return slots;
  }
  const ordered = orderedSlotEntriesForBudget(slots);
  let configs = ordered.map((e) => e.config);
  for (const p of plugins) {
    if (p.beforeBudgetResolve === undefined) {
      continue;
    }
    const out = p.beforeBudgetResolve(configs);
    const next = await Promise.resolve(out);
    if (next.length !== ordered.length) {
      throw new InvalidConfigError(
        `Plugin "${p.name}" beforeBudgetResolve must return ${ordered.length} slot configs, got ${next.length}`,
        { context: { plugin: p.name } },
      );
    }
    configs = next;
  }
  const nextSlots: Record<string, SlotConfig> = { ...slots };
  for (let i = 0; i < ordered.length; i++) {
    nextSlots[ordered[i]!.name] = configs[i]!;
  }
  return nextSlots;
}

async function runAfterBudgetResolve(
  plugins: readonly ContextPlugin[],
  resolved: readonly ResolvedSlot[],
): Promise<void> {
  for (const p of plugins) {
    if (p.afterBudgetResolve === undefined) {
      continue;
    }
    await Promise.resolve(p.afterBudgetResolve(resolved));
  }
}

async function applyBeforeOverflowForSlot(
  plugins: readonly ContextPlugin[],
  slot: string,
  items: ContentItem[],
  context: Context,
): Promise<ContentItem[]> {
  const env = { context };
  let cur = items;
  for (const p of plugins) {
    if (p.beforeOverflow === undefined) {
      continue;
    }
    const out = p.beforeOverflow(slot, cur, env);
    cur = await Promise.resolve(out);
  }
  return cur;
}

async function runAfterOverflowPlugins(
  plugins: readonly ContextPlugin[],
  preBySlot: ReadonlyMap<string, readonly ContentItem[]>,
  after: readonly ResolvedSlot[],
): Promise<void> {
  for (const p of plugins) {
    if (p.afterOverflow === undefined) {
      continue;
    }
    for (const rs of after) {
      const pre = preBySlot.get(rs.name) ?? [];
      const afterIds = new Set(rs.content.map((i) => i.id));
      const evicted = pre.filter((i) => !afterIds.has(i.id));
      await Promise.resolve(p.afterOverflow(rs.name, rs.content, evicted));
    }
  }
}

async function applyBeforeSnapshotPlugins(
  plugins: readonly ContextPlugin[],
  messages: CompiledMessage[],
): Promise<CompiledMessage[]> {
  let cur = messages;
  for (const p of plugins) {
    if (p.beforeSnapshot === undefined) {
      continue;
    }
    const out = p.beforeSnapshot(cur);
    cur = await Promise.resolve(out);
  }
  return cur;
}

async function runAfterSnapshotPlugins(
  plugins: readonly ContextPlugin[],
  snapshot: ContextSnapshot,
): Promise<void> {
  for (const p of plugins) {
    if (p.afterSnapshot === undefined) {
      continue;
    }
    await Promise.resolve(p.afterSnapshot(snapshot));
  }
}

export type ContextOrchestratorBuildInput = {
  readonly config: ParsedContextConfig;
  readonly context: Context;
  /** Optional adapters for {@link ContextSnapshot.format}(provider). */
  readonly providerAdapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  /** Prior snapshot for §18.2 structural sharing of unchanged messages. */
  readonly previousSnapshot?: ContextSnapshot;
  /** When false, disables reuse of message references from `previousSnapshot`. */
  readonly structuralSharing?: boolean;
  /**
   * When set, hooks and strategy registrations come from the manager instead of `config.plugins`.
   */
  readonly pluginManager?: PluginManager;
  /**
   * Correlates log lines for one {@link ContextOrchestrator.build} run (§13.3).
   * Defaults to a UUID from {@link newBuildOperationId} when omitted.
   */
  readonly operationId?: string;
};

export type ContextOrchestratorBuildResult = {
  readonly snapshot: ContextSnapshot;
  readonly context: Context;
};

const DEFAULT_MAX_TOKENS = 8192;

type SlotEntry = { readonly name: string; readonly config: SlotConfig };

function slotEntries(slots: Record<string, SlotConfig>): SlotEntry[] {
  return Object.entries(slots).map(([name, config]) => ({ name, config }));
}

/**
 * Order slots for compilation: `before` → `interleave` → `after` (§5.4 Step 8, simplified).
 */
export function orderSlotsForCompile(
  slots: Record<string, SlotConfig>,
): SlotEntry[] {
  const entries = slotEntries(slots);
  const pos = (c: SlotConfig): 'before' | 'after' | 'interleave' =>
    c.position ?? 'after';

  const before = entries
    .filter((e) => pos(e.config) === 'before')
    .sort(
      (a, b) =>
        b.config.priority - a.config.priority ||
        a.name.localeCompare(b.name),
    );
  const interleave = entries
    .filter((e) => pos(e.config) === 'interleave')
    .sort(
      (a, b) =>
        (a.config.order ?? 0) - (b.config.order ?? 0) ||
        b.config.priority - a.config.priority ||
        a.name.localeCompare(b.name),
    );
  const after = entries
    .filter((e) => pos(e.config) === 'after')
    .sort(
      (a, b) =>
        b.config.priority - a.config.priority ||
        a.name.localeCompare(b.name),
    );

  return [...before, ...interleave, ...after];
}

export function compileMessagesForSnapshot(
  slots: Record<string, SlotConfig>,
  resolvedSlots: readonly ResolvedSlot[],
): CompiledMessage[] {
  const byName = new Map(resolvedSlots.map((s) => [s.name, s.content]));
  const ordered = orderSlotsForCompile(slots);
  const out: CompiledMessage[] = [];
  for (const { name } of ordered) {
    const items = byName.get(name) ?? [];
    for (const item of items) {
      out.push(compileContentItem(item));
    }
  }
  return out;
}

/** §14.1 — compiled messages for a single slot from a resolved overflow result. */
export function compileSlotMessages(
  resolvedSlots: readonly ResolvedSlot[],
  slotName: string,
): CompiledMessage[] {
  const rs = resolvedSlots.find((s) => s.name === slotName);
  const items = rs?.content ?? [];
  const out: CompiledMessage[] = [];
  for (const item of items) {
    out.push(compileContentItem(item));
  }
  return out;
}

function cloneResolvedSlotItems(
  items: readonly ContentItem[],
): ContentItem[] {
  return items.map((i) => ({ ...i }));
}

function applyFrozenSlotContent(
  after: readonly ResolvedSlot[],
  frozen: ReadonlyMap<string, readonly ContentItem[]>,
): ResolvedSlot[] {
  return after.map((rs) =>
    frozen.has(rs.name)
      ? {
          ...rs,
          content: cloneResolvedSlotItems(frozen.get(rs.name)!),
        }
      : { ...rs, content: cloneResolvedSlotItems(rs.content) },
  );
}

function buildSlotMetaMap(params: {
  readonly resolvedAfterOverflow: readonly ResolvedSlot[];
  readonly evictionsBySlot: ReadonlyMap<string, number>;
  readonly overflowSlots: ReadonlySet<string>;
  readonly countTokens: (items: readonly ContentItem[]) => number;
}): Record<string, SlotMeta> {
  const o: Record<string, SlotMeta> = {};
  for (const rs of params.resolvedAfterOverflow) {
    const used = params.countTokens(rs.content);
    const budget = rs.budgetTokens;
    const evicted = params.evictionsBySlot.get(rs.name) ?? 0;
    const overflowTriggered = params.overflowSlots.has(rs.name);
    o[rs.name] = {
      name: rs.name,
      budgetTokens: toTokenCount(budget),
      usedTokens: toTokenCount(used),
      itemCount: rs.content.length,
      evictedCount: evicted,
      overflowTriggered,
      utilization: budget > 0 ? used / budget : 0,
    };
  }
  return o;
}

/**
 * Runs the §5.4 pipeline: plugin hooks, budget resolution, token accounting,
 * overflow, compilation, snapshot materialization, ephemeral cleanup, and `build:complete`.
 */
export class ContextOrchestrator {
  static async build(
    input: ContextOrchestratorBuildInput,
  ): Promise<ContextOrchestratorBuildResult> {
    const t0 = Date.now();
    const {
      config,
      context,
      providerAdapters,
      previousSnapshot,
      structuralSharing,
      operationId: operationIdInput,
    } = input;
    const operationId = operationIdInput ?? newBuildOperationId();
    const userLogger = config.logger;
    const hasUserLogger = userLogger !== undefined;
    let baseLogger: import('../logging/logger.js').Logger = hasUserLogger
      ? createLeveledLogger(userLogger, config.logLevel ?? LogLevel.INFO)
      : noopLogger;
    if (hasUserLogger && shouldRedactObservability(config)) {
      const r: RedactionOptions | true =
        config.redaction === undefined || config.redaction === true
          ? true
          : (config.redaction as RedactionOptions);
      baseLogger = createRedactingLogger({ delegate: baseLogger, redaction: r });
    }
    const pipelineLog = hasUserLogger
      ? createContextualLogger(baseLogger, { operationId })
      : noopLogger;

    const eventRedactor = createContextEventRedactor(config);

    const baseSlots = config.slots as Record<string, SlotConfig>;
    if (config.slots === undefined || Object.keys(config.slots).length === 0) {
      throw new InvalidConfigError('ContextOrchestrator.build: config.slots is required', {
        context: { area: 'context-config' },
      });
    }

    const pluginManager = input.pluginManager;
    const plugins = pluginManager?.getPlugins() ?? resolvePlugins(config);
    assertAuthoritativeTokenPolicy(config);
    const countTokens = resolveCountTokens(config, providerAdapters);

    const deliverPipelineEvent = (ev: ContextEvent): void => {
      const payload = eventRedactor !== undefined ? eventRedactor(ev) : ev;
      context.dispatchInspectorEvent(payload);
      const fn = config.onEvent as ((e: ContextEvent) => void) | undefined;
      fn?.(payload);
      if (pluginManager !== undefined) {
        void pluginManager.runHook('onEvent', payload);
      } else {
        for (const p of plugins) {
          if (p.onEvent !== undefined) {
            try {
              p.onEvent(payload);
            } catch {
              /* isolate plugin onEvent failures (§11.1) */
            }
          }
        }
      }
    };

    const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const reserve = config.reserveForResponse ?? 0;
    const totalBudget = Math.max(0, maxTokens - reserve);

    deliverPipelineEvent({ type: 'build:start', totalBudget });
    pipelineLog.debug(`build: pipeline started (totalBudget=${totalBudget})`);

    const slots =
      pluginManager !== undefined
        ? await pluginManager.runHook('beforeBudgetResolve', baseSlots)
        : await applyBeforeBudgetResolvePlugins(baseSlots, plugins);

    const evictionsBySlot = new Map<string, number>();
    const overflowSlots = new Set<string>();
    const warnings: ContextWarning[] = [];
    const evictionsMeta: EvictionEvent[] = [];

    const forward = (e: ContextEvent): void => {
      deliverPipelineEvent(e);
      if (e.type === 'warning') {
        pipelineLog.warn(e.warning.message, e.warning);
      }
      if (e.type === 'content:evicted') {
        evictionsBySlot.set(e.slot, (evictionsBySlot.get(e.slot) ?? 0) + 1);
        evictionsMeta.push({
          slot: e.slot,
          item: e.item,
          reason: e.reason,
        });
      } else if (e.type === 'slot:overflow') {
        overflowSlots.add(e.slot);
      } else if (e.type === 'warning') {
        warnings.push(e.warning);
      }
    };

    const allocator = new BudgetAllocator({
      onEvent: (e) => forward(e),
      ...(hasUserLogger ? { logger: pipelineLog } : {}),
    });
    const budgetResolved = allocator.resolve(slots, totalBudget);
    pipelineLog.debug('build: slot budgets resolved');

    if (pluginManager !== undefined) {
      await pluginManager.runHook('afterBudgetResolve', budgetResolved);
    } else {
      await runAfterBudgetResolve(plugins, budgetResolved);
    }

    const namedStrategies = pluginManager?.getNamedOverflowStrategiesForEngine();
    const engine = new OverflowEngine({
      countTokens,
      onEvent: (e) => forward(e),
      ...(namedStrategies !== undefined && Object.keys(namedStrategies).length > 0
        ? { namedStrategies }
        : {}),
      ...(hasUserLogger
        ? {
            strategyLoggerFactory: (slot) =>
              overflowStrategyLoggerFromLogger(
                createContextualLogger(pipelineLog, { slot }),
              ),
          }
        : {}),
    });

    const overflowInputs = await Promise.all(
      budgetResolved.map(async (rs) => ({
        name: rs.name,
        priority: rs.priority,
        budgetTokens: rs.budgetTokens,
        config: slots[rs.name]!,
        content:
          pluginManager !== undefined
            ? await pluginManager.runHook(
                'beforeOverflow',
                rs.name,
                context.getItems(rs.name),
                context,
              )
            : await applyBeforeOverflowForSlot(
                plugins,
                rs.name,
                context.getItems(rs.name),
                context,
              ),
      })),
    );

    const preOverflowBySlot = new Map<string, readonly ContentItem[]>(
      overflowInputs.map((s) => [s.name, s.content] as const),
    );

    pipelineLog.debug('build: overflow resolution');
    const afterOverflow = await engine.resolve(overflowInputs, {
      totalBudget,
    });
    pipelineLog.debug('build: overflow complete');

    if (pluginManager !== undefined) {
      await pluginManager.runHook('afterOverflow', preOverflowBySlot, afterOverflow);
    } else {
      await runAfterOverflowPlugins(plugins, preOverflowBySlot, afterOverflow);
    }

    context.applyResolvedItemTokens(afterOverflow);

    let messages = compileMessagesForSnapshot(slots, afterOverflow);
    messages =
      pluginManager !== undefined
        ? await pluginManager.runHook('beforeSnapshot', messages)
        : await applyBeforeSnapshotPlugins(plugins, messages);

    const slotMeta = buildSlotMetaMap({
      resolvedAfterOverflow: afterOverflow,
      evictionsBySlot,
      overflowSlots,
      countTokens,
    });

    let totalUsed = 0;
    let waste = 0;
    for (const rs of afterOverflow) {
      const u = countTokens(rs.content);
      totalUsed += u;
      waste += Math.max(0, rs.budgetTokens - u);
    }

    const buildTimeMs = Date.now() - t0;
    const builtAt = Date.now();

    const snapshotMeta: SnapshotMeta = {
      totalTokens: toTokenCount(totalUsed),
      totalBudget: toTokenCount(totalBudget),
      utilization: totalBudget > 0 ? totalUsed / totalBudget : 0,
      waste: toTokenCount(waste),
      slots: Object.freeze(slotMeta),
      compressions: Object.freeze([]),
      evictions: Object.freeze(evictionsMeta),
      warnings: Object.freeze(warnings),
      buildTimeMs,
      builtAt,
    };

    const snapshot = ContextSnapshot.create({
      messages,
      meta: snapshotMeta,
      model: config.model,
      immutable: config.immutableSnapshots !== false,
      ...(providerAdapters !== undefined ? { providerAdapters } : {}),
      ...(previousSnapshot !== undefined ? { previousSnapshot } : {}),
      ...(structuralSharing !== undefined ? { structuralSharing } : {}),
    });

    if (pluginManager !== undefined) {
      await pluginManager.runHook('afterSnapshot', snapshot);
    } else {
      await runAfterSnapshotPlugins(plugins, snapshot);
    }

    context.clearEphemeral();

    deliverPipelineEvent({ type: 'build:complete', snapshot });
    pipelineLog.debug(
      `build: complete (messages=${snapshot.messages.length}, buildTimeMs=${snapshot.meta.buildTimeMs})`,
    );

    return { snapshot, context };
  }

  /**
   * §14.1 streaming build: runs the same budget/overflow pipeline in stages so callers can observe
   * each slot before the full snapshot exists. Between stages, `yieldBetweenSlots` runs (macrotask)
   * so late {@link Context.push} calls can land in slots that have not been emitted yet; slots already
   * emitted are held fixed (“frozen”) while later slots are re-resolved.
   */
  static async buildStreaming(
    input: ContextOrchestratorBuildInput,
    callbacks: {
      readonly onSlotReady: (
        slot: string,
        messages: CompiledMessage[],
      ) => void | Promise<void>;
      readonly yieldBetweenSlots?: () => void | Promise<void>;
    },
  ): Promise<ContextOrchestratorBuildResult> {
    const t0 = Date.now();
    const {
      config,
      context,
      providerAdapters,
      previousSnapshot,
      structuralSharing,
      operationId: operationIdInput,
    } = input;
    const operationId = operationIdInput ?? newBuildOperationId();
    const userLogger = config.logger;
    const hasUserLogger = userLogger !== undefined;
    let baseLogger: import('../logging/logger.js').Logger = hasUserLogger
      ? createLeveledLogger(userLogger, config.logLevel ?? LogLevel.INFO)
      : noopLogger;
    if (hasUserLogger && shouldRedactObservability(config)) {
      const r: RedactionOptions | true =
        config.redaction === undefined || config.redaction === true
          ? true
          : (config.redaction as RedactionOptions);
      baseLogger = createRedactingLogger({ delegate: baseLogger, redaction: r });
    }
    const pipelineLog = hasUserLogger
      ? createContextualLogger(baseLogger, { operationId })
      : noopLogger;

    const eventRedactor = createContextEventRedactor(config);

    const baseSlots = config.slots as Record<string, SlotConfig>;
    if (config.slots === undefined || Object.keys(config.slots).length === 0) {
      throw new InvalidConfigError('ContextOrchestrator.buildStreaming: config.slots is required', {
        context: { area: 'context-config' },
      });
    }

    const pluginManager = input.pluginManager;
    const plugins = pluginManager?.getPlugins() ?? resolvePlugins(config);
    assertAuthoritativeTokenPolicy(config);
    const countTokens = resolveCountTokens(config, providerAdapters);

    const deliverPipelineEvent = (ev: ContextEvent): void => {
      const payload = eventRedactor !== undefined ? eventRedactor(ev) : ev;
      context.dispatchInspectorEvent(payload);
      const fn = config.onEvent as ((e: ContextEvent) => void) | undefined;
      fn?.(payload);
      if (pluginManager !== undefined) {
        void pluginManager.runHook('onEvent', payload);
      } else {
        for (const p of plugins) {
          if (p.onEvent !== undefined) {
            try {
              p.onEvent(payload);
            } catch {
              /* isolate plugin onEvent failures (§11.1) */
            }
          }
        }
      }
    };

    const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const reserve = config.reserveForResponse ?? 0;
    const totalBudget = Math.max(0, maxTokens - reserve);

    deliverPipelineEvent({ type: 'build:start', totalBudget });
    pipelineLog.debug(`buildStream: pipeline started (totalBudget=${totalBudget})`);

    const frozen = new Map<string, ContentItem[]>();
    let lastPreOverflowBySlot = new Map<string, readonly ContentItem[]>();

    const namedStrategies = pluginManager?.getNamedOverflowStrategiesForEngine();

    const slotsInitial =
      pluginManager !== undefined
        ? await pluginManager.runHook('beforeBudgetResolve', baseSlots)
        : await applyBeforeBudgetResolvePlugins(baseSlots, plugins);
    const orderedNames = orderSlotsForCompile(slotsInitial).map((e) => e.name);
    if (orderedNames.length === 0) {
      throw new InvalidConfigError('ContextOrchestrator.buildStreaming: no compile-order slots', {
        context: { area: 'build-stream' },
      });
    }

    for (let k = 0; k < orderedNames.length; k++) {
      if (callbacks.yieldBetweenSlots !== undefined) {
        await Promise.resolve(callbacks.yieldBetweenSlots());
      }

      const slots =
        pluginManager !== undefined
          ? await pluginManager.runHook('beforeBudgetResolve', baseSlots)
          : await applyBeforeBudgetResolvePlugins(baseSlots, plugins);

      const lastPass = k === orderedNames.length - 1;

      const evictionsBySlot = new Map<string, number>();
      const overflowSlots = new Set<string>();
      const warnings: ContextWarning[] = [];
      const evictionsMeta: EvictionEvent[] = [];

      const forward = (e: ContextEvent): void => {
        if (!lastPass) {
          return;
        }
        deliverPipelineEvent(e);
        if (e.type === 'warning') {
          pipelineLog.warn(e.warning.message, e.warning);
        }
        if (e.type === 'content:evicted') {
          evictionsBySlot.set(e.slot, (evictionsBySlot.get(e.slot) ?? 0) + 1);
          evictionsMeta.push({
            slot: e.slot,
            item: e.item,
            reason: e.reason,
          });
        } else if (e.type === 'slot:overflow') {
          overflowSlots.add(e.slot);
        } else if (e.type === 'warning') {
          warnings.push(e.warning);
        }
      };

      const allocator = new BudgetAllocator({
        onEvent: (e) => forward(e),
        ...(hasUserLogger ? { logger: pipelineLog } : {}),
      });
      const budgetResolved = allocator.resolve(slots, totalBudget);
      pipelineLog.debug(`buildStream: slot budgets resolved (pass ${String(k)})`);

      if (pluginManager !== undefined) {
        await pluginManager.runHook('afterBudgetResolve', budgetResolved);
      } else {
        await runAfterBudgetResolve(plugins, budgetResolved);
      }

      const engine = new OverflowEngine({
        countTokens,
        onEvent: (e) => forward(e),
        ...(namedStrategies !== undefined && Object.keys(namedStrategies).length > 0
          ? { namedStrategies }
          : {}),
        ...(hasUserLogger
          ? {
              strategyLoggerFactory: (slot) =>
                overflowStrategyLoggerFromLogger(
                  createContextualLogger(pipelineLog, { slot }),
                ),
            }
          : {}),
      });

      const overflowInputs = await Promise.all(
        budgetResolved.map(async (rs) => {
          if (frozen.has(rs.name)) {
            return {
              name: rs.name,
              priority: rs.priority,
              budgetTokens: rs.budgetTokens,
              config: slots[rs.name]!,
              content: cloneResolvedSlotItems(frozen.get(rs.name)!),
            };
          }
          const live =
            pluginManager !== undefined
              ? await pluginManager.runHook(
                  'beforeOverflow',
                  rs.name,
                  context.getItems(rs.name),
                  context,
                )
              : await applyBeforeOverflowForSlot(
                  plugins,
                  rs.name,
                  context.getItems(rs.name),
                  context,
                );
          return {
            name: rs.name,
            priority: rs.priority,
            budgetTokens: rs.budgetTokens,
            config: slots[rs.name]!,
            content: live,
          };
        }),
      );

      if (lastPass) {
        lastPreOverflowBySlot = new Map(
          overflowInputs.map((s) => [s.name, s.content] as const),
        );
      }

      pipelineLog.debug(`buildStream: overflow resolution (pass ${String(k)})`);
      const afterOverflowRaw = await engine.resolve(overflowInputs, {
        totalBudget,
      });
      const corrected = applyFrozenSlotContent(afterOverflowRaw, frozen);

      const slotName = orderedNames[k]!;

      await Promise.resolve(callbacks.onSlotReady(slotName, compileSlotMessages(corrected, slotName)));

      const rs = corrected.find((s) => s.name === slotName);
      if (rs !== undefined) {
        frozen.set(slotName, cloneResolvedSlotItems(rs.content));
      }

      if (lastPass) {
        if (pluginManager !== undefined) {
          await pluginManager.runHook('afterOverflow', lastPreOverflowBySlot, corrected);
        } else {
          await runAfterOverflowPlugins(plugins, lastPreOverflowBySlot, corrected);
        }

        context.applyResolvedItemTokens(corrected);

        let messages = compileMessagesForSnapshot(slots, corrected);
        messages =
          pluginManager !== undefined
            ? await pluginManager.runHook('beforeSnapshot', messages)
            : await applyBeforeSnapshotPlugins(plugins, messages);

        const slotMeta = buildSlotMetaMap({
          resolvedAfterOverflow: corrected,
          evictionsBySlot,
          overflowSlots,
          countTokens,
        });

        let totalUsed = 0;
        let waste = 0;
        for (const rs2 of corrected) {
          const u = countTokens(rs2.content);
          totalUsed += u;
          waste += Math.max(0, rs2.budgetTokens - u);
        }

        const buildTimeMs = Date.now() - t0;
        const builtAt = Date.now();

        const snapshotMeta: SnapshotMeta = {
          totalTokens: toTokenCount(totalUsed),
          totalBudget: toTokenCount(totalBudget),
          utilization: totalBudget > 0 ? totalUsed / totalBudget : 0,
          waste: toTokenCount(waste),
          slots: Object.freeze(slotMeta),
          compressions: Object.freeze([]),
          evictions: Object.freeze(evictionsMeta),
          warnings: Object.freeze(warnings),
          buildTimeMs,
          builtAt,
        };

        const snapshot = ContextSnapshot.create({
          messages,
          meta: snapshotMeta,
          model: config.model,
          immutable: config.immutableSnapshots !== false,
          ...(providerAdapters !== undefined ? { providerAdapters } : {}),
          ...(previousSnapshot !== undefined ? { previousSnapshot } : {}),
          ...(structuralSharing !== undefined ? { structuralSharing } : {}),
        });

        if (pluginManager !== undefined) {
          await pluginManager.runHook('afterSnapshot', snapshot);
        } else {
          await runAfterSnapshotPlugins(plugins, snapshot);
        }

        context.clearEphemeral();

        deliverPipelineEvent({ type: 'build:complete', snapshot });
        pipelineLog.debug(
          `buildStream: complete (messages=${snapshot.messages.length}, buildTimeMs=${snapshot.meta.buildTimeMs})`,
        );

        return { snapshot, context };
      }
    }

    throw new InvalidConfigError('ContextOrchestrator.buildStreaming: internal error (no return)', {
      context: { area: 'build-stream' },
    });
  }
}
