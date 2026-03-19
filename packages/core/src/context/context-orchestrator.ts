/**
 * Build pipeline: plugins → budget → token count → overflow → compile → snapshot (§5.3 — Phase 5.4).
 *
 * @packageDocumentation
 */

import type { ParsedContextConfig } from '../config/validator.js';
import { InvalidConfigError } from '../errors.js';
import {
  BudgetAllocator,
  orderedSlotEntriesForBudget,
} from '../slots/budget-allocator.js';
import { OverflowEngine } from '../slots/overflow-engine.js';
import { sumCachedItemTokens } from '../slots/strategies/truncate-strategy.js';
import { ContextSnapshot } from '../snapshot/context-snapshot.js';
import { toTokenCount } from '../types/branded.js';
import type { ProviderId, SlotConfig } from '../types/config.js';
import type {
  CompiledContentPart,
  CompiledMessage,
  ContentItem,
  MultimodalContent,
} from '../types/content.js';
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
): (items: readonly ContentItem[]) => number {
  const ta = config.tokenAccountant as TokenAccountant | undefined;
  if (ta !== undefined) {
    return (items) => ta.countItems(items);
  }
  return sumCachedItemTokens;
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
): Promise<ContentItem[]> {
  let cur = items;
  for (const p of plugins) {
    if (p.beforeOverflow === undefined) {
      continue;
    }
    const out = p.beforeOverflow(slot, cur);
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
};

export type ContextOrchestratorBuildResult = {
  readonly snapshot: ContextSnapshot;
  readonly context: Context;
};

const DEFAULT_MAX_TOKENS = 8192;

function emitEvent(
  config: ParsedContextConfig,
  event: ContextEvent,
): void {
  const fn = config.onEvent as ((e: ContextEvent) => void) | undefined;
  fn?.(event);
}

function compileContentItem(item: ContentItem): CompiledMessage {
  if (typeof item.content === 'string') {
    return { role: item.role, content: item.content };
  }
  const parts: CompiledContentPart[] = [];
  for (const block of item.content as MultimodalContent[]) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image_url') {
      const url = block.imageUrl ?? block.image_url ?? '';
      parts.push({
        type: 'image_url',
        image_url: { url },
      });
    } else {
      const data = block.imageBase64 ?? block.image_base64 ?? '';
      parts.push({
        type: 'image_base64',
        image_base64:
          block.mimeType !== undefined
            ? { data, mime_type: block.mimeType }
            : { data },
      });
    }
  }
  return { role: item.role, content: parts };
}

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
    const { config, context, providerAdapters, previousSnapshot, structuralSharing } =
      input;
    const baseSlots = config.slots as Record<string, SlotConfig>;
    if (config.slots === undefined || Object.keys(config.slots).length === 0) {
      throw new InvalidConfigError('ContextOrchestrator.build: config.slots is required', {
        context: { phase: '5.2' },
      });
    }

    const plugins = resolvePlugins(config);
    const countTokens = resolveCountTokens(config);

    const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const reserve = config.reserveForResponse ?? 0;
    const totalBudget = Math.max(0, maxTokens - reserve);

    emitEvent(config, { type: 'build:start', totalBudget });

    const slots = await applyBeforeBudgetResolvePlugins(baseSlots, plugins);

    const evictionsBySlot = new Map<string, number>();
    const overflowSlots = new Set<string>();
    const warnings: ContextWarning[] = [];
    const evictionsMeta: EvictionEvent[] = [];

    const forward = (e: ContextEvent): void => {
      emitEvent(config, e);
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
    });
    const budgetResolved = allocator.resolve(slots, totalBudget);

    await runAfterBudgetResolve(plugins, budgetResolved);

    const engine = new OverflowEngine({
      countTokens,
      onEvent: (e) => forward(e),
    });

    const overflowInputs = await Promise.all(
      budgetResolved.map(async (rs) => ({
        name: rs.name,
        priority: rs.priority,
        budgetTokens: rs.budgetTokens,
        config: slots[rs.name]!,
        content: await applyBeforeOverflowForSlot(
          plugins,
          rs.name,
          context.getItems(rs.name),
        ),
      })),
    );

    const preOverflowBySlot = new Map<string, readonly ContentItem[]>(
      overflowInputs.map((s) => [s.name, s.content] as const),
    );

    const afterOverflow = await engine.resolve(overflowInputs, {
      totalBudget,
    });

    await runAfterOverflowPlugins(plugins, preOverflowBySlot, afterOverflow);

    let messages = compileMessagesForSnapshot(slots, afterOverflow);
    messages = await applyBeforeSnapshotPlugins(plugins, messages);

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

    await runAfterSnapshotPlugins(plugins, snapshot);

    context.clearEphemeral();

    emitEvent(config, { type: 'build:complete', snapshot });

    return { snapshot, context };
  }
}
