/**
 * Long-term memory plugin (§11.2 design).
 *
 * @packageDocumentation
 */

import {
  createContentItem,
  sumCachedItemTokens,
  toTokenCount,
  type ContentItem,
  type ContextPlugin,
  type SlotBudget,
  type SlotConfig,
  SlotOverflow,
} from 'slotmux';

import { extractFactCandidatesFromMessages } from './auto-extract.js';
import type { MemoryStore } from './memory-types.js';
import { jaccardSimilarity, rankMemories, type MemoryRetrievalStrategy } from './retrieval.js';
import { VERSION } from './version.js';

const PLUGIN_NAME = '@slotmux/plugin-memory';
const META_INJECTED = 'memory.injected';
const META_RECORD_ID = 'memory.recordId';

export type MemoryPluginOptions = {
  readonly store: MemoryStore;

  /** Slot holding retrieved memories (default `memory`). */
  readonly memorySlot?: string;

  /** Slot used to infer retrieval query (default `history`). */
  readonly historySlot?: string;

  /** Injected when absent via {@link ContextPlugin.prepareSlots}. */
  readonly memoryBudget?: SlotBudget;

  readonly retrievalStrategy?: MemoryRetrievalStrategy;

  /** Hybrid mode: weight on lexical relevance in [0,1]. */
  readonly hybridAlpha?: number;

  /** Half-life for recency decay (default 7 days). */
  readonly recencyHalfLifeMs?: number;

  /** Max candidates from {@link MemoryStore.search} before ranking. */
  readonly searchLimit?: number;

  /**
   * Heuristic extraction of facts from the compiled snapshot after each build.
   */
  readonly autoExtract?: boolean;

  readonly autoExtractMinLength?: number;

  /** Override default slot layout when injecting the memory slot. */
  readonly defaultSlot?: SlotConfig;
};

function itemPlainText(item: ContentItem): string {
  if (typeof item.content === 'string') {
    return item.content;
  }
  const parts: string[] = [];
  for (const b of item.content) {
    if (b.type === 'text') {
      parts.push(b.text);
    }
  }
  return parts.join('\n');
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function lastUserQueryFromHistory(items: readonly ContentItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.role !== 'user') {
      continue;
    }
    const t = itemPlainText(it).trim();
    if (t.length > 0) {
      return t;
    }
  }
  return '';
}

function defaultMemorySlotConfig(budget: SlotBudget): SlotConfig {
  return {
    priority: 65,
    budget,
    defaultRole: 'user',
    position: 'before',
    overflow: SlotOverflow.TRUNCATE,
  };
}

function greedyWithinBudget(
  items: ContentItem[],
  budget: number,
  count: (xs: readonly ContentItem[]) => number,
): ContentItem[] {
  const pinned = items.filter((i) => i.pinned);
  const tail = items.filter((i) => !i.pinned);
  const out: ContentItem[] = [...pinned];
  let used = count(out);
  for (const it of tail) {
    const add = count([it]);
    if (used + add <= budget) {
      out.push(it);
      used += add;
    }
  }
  return out;
}

/**
 * Wires a {@link MemoryStore} into the build pipeline: optional `memory` slot injection,
 * hybrid retrieval before overflow, budget-aware trimming, and optional `autoExtract`.
 */
export function memoryPlugin(options: MemoryPluginOptions): ContextPlugin {
  const store = options.store;
  const memorySlot = options.memorySlot ?? 'memory';
  const historySlot = options.historySlot ?? 'history';
  const memoryBudget: SlotBudget = options.memoryBudget ?? { percent: 10 };
  const strategy = options.retrievalStrategy ?? 'hybrid';
  const hybridAlpha = options.hybridAlpha ?? 0.55;
  const recencyHalfLifeMs = options.recencyHalfLifeMs ?? 7 * 24 * 60 * 60 * 1000;
  const searchLimit = options.searchLimit ?? 48;
  const autoExtract = options.autoExtract ?? false;
  const autoExtractMinLength = options.autoExtractMinLength ?? 24;
  const defaultSlot = options.defaultSlot ?? defaultMemorySlotConfig(memoryBudget);

  const budgetBySlot = new Map<string, number>();

  const plugin: ContextPlugin = {
    name: PLUGIN_NAME,
    version: VERSION,

    prepareSlots(slots) {
      if (slots[memorySlot] !== undefined) {
        return slots;
      }
      return { ...slots, [memorySlot]: { ...defaultSlot } };
    },

    afterBudgetResolve(resolved) {
      budgetBySlot.clear();
      for (const r of resolved) {
        budgetBySlot.set(r.name, r.budgetTokens);
      }
    },

    async beforeOverflow(slot, items, env) {
      if (slot !== memorySlot || env === undefined) {
        return items;
      }

      const query = lastUserQueryFromHistory(env.context.getItems(historySlot));
      const raw = await store.search(query, { limit: searchLimit });
      const ranked = rankMemories(raw, query, strategy, {
        alpha: hybridAlpha,
        halfLifeMs: recencyHalfLifeMs,
      });

      const pinned = items.filter((i) => i.pinned);
      const userCustom = items.filter(
        (i) => !i.pinned && i.metadata?.[META_INJECTED] !== true,
      );

      const synthesized: ContentItem[] = [];
      for (const { record } of ranked) {
        const line = `[memory] ${record.content}`;
        synthesized.push(
          createContentItem({
            slot: memorySlot,
            role: 'user',
            content: line,
            tokens: toTokenCount(estimateTokens(line)),
            metadata: {
              [META_INJECTED]: true,
              [META_RECORD_ID]: record.id,
            },
          }),
        );
      }

      const merged = [...pinned, ...userCustom, ...synthesized];
      const budget = budgetBySlot.get(slot) ?? 0;
      return greedyWithinBudget(merged, budget, sumCachedItemTokens);
    },

    async afterSnapshot(snapshot) {
      if (!autoExtract) {
        return;
      }
      const facts = extractFactCandidatesFromMessages(snapshot.messages, {
        minLength: autoExtractMinLength,
      });
      for (const fact of facts) {
        const probe = fact.slice(0, Math.min(48, fact.length));
        const hits = await store.search(probe, { limit: 6 });
        const dup = hits.some((h) => jaccardSimilarity(fact, h.content) >= 0.92);
        if (dup) {
          continue;
        }
        await store.set({
          content: fact,
          metadata: { source: 'autoExtract' },
        });
      }
    },
  };

  return plugin;
}
