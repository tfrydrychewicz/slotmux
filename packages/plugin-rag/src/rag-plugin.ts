/**
 * RAG first-party plugin (§11.2 design / Phase 11.1).
 *
 * @packageDocumentation
 */

import type { ContentItem, ContextPlugin, SlotConfig } from 'contextcraft';
import { RAG_DEFAULTS, sumCachedItemTokens } from 'contextcraft';

import { dedupeNearDuplicateChunks } from './dedupe.js';
import { VERSION } from './version.js';

/** Metadata key: stable chunk id for citations */
export const RAG_METADATA_CHUNK_ID = 'rag.chunkId';

/** Metadata key: relevance score (higher = more important) */
export const RAG_METADATA_SCORE = 'rag.score';

const PLUGIN_NAME = '@contextcraft/plugin-rag';

export type RagCitation = {
  readonly chunkId: string;
  readonly itemId: string;
};

export type RagPluginOptions = {
  /** Target slot (default `rag`). */
  readonly slotName?: string;

  /** Max chunks retained after dedupe (default `20`). */
  readonly maxChunks?: number;

  /**
   * When total tokens exceed slot budget before overflow, reorder so low-scoring chunks
   * are truncated first (FIFO truncate drops from the front). Uses {@link RAG_METADATA_SCORE}
   * or {@link rerank} when set.
   */
  readonly rerankOnOverflow?: boolean;

  /** Near-duplicate removal via Jaccard word overlap (default `true`). */
  readonly deduplication?: boolean;

  /** Jaccard threshold for dedupe (default `0.88`). */
  readonly dedupeThreshold?: number;

  /** Record surviving chunk ids after overflow (default `true`). */
  readonly citationTracking?: boolean;

  /**
   * Cross-encoder / bi-encoder hook: return items ordered **worst-first** (first entries
   * evicted under FIFO truncate). Async OK.
   */
  readonly rerank?: (
    items: readonly ContentItem[],
  ) => readonly ContentItem[] | Promise<readonly ContentItem[]>;

  /** Override default slot config when {@link prepareSlots} injects the slot. */
  readonly defaultSlot?: SlotConfig;
};

export type RagPlugin = ContextPlugin & {
  /** Chunk ids that survived overflow for the RAG slot in the last build. */
  getRagCitations(): readonly RagCitation[];
};

function scoreOf(item: ContentItem): number {
  const v = item.metadata?.[RAG_METADATA_SCORE];
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

function chunkIdOf(item: ContentItem): string {
  const v = item.metadata?.[RAG_METADATA_CHUNK_ID];
  return typeof v === 'string' && v.length > 0 ? v : String(item.id);
}

/**
 * Keep top-`max` by score; ties preserve original order among kept.
 */
function enforceMaxChunks(items: readonly ContentItem[], max: number): ContentItem[] {
  if (items.length <= max) {
    return [...items];
  }
  const scored = items.map((item, idx) => ({ item, idx, s: scoreOf(item) }));
  scored.sort((a, b) => b.s - a.s || a.idx - b.idx);
  const keep = new Set(scored.slice(0, max).map((r) => r.item.id));
  return items.filter((i) => keep.has(i.id));
}

/** Sort worst-first for FIFO truncate (low score first). */
function sortWorstFirstForFifoTruncate(items: readonly ContentItem[]): ContentItem[] {
  const withIdx = items.map((item, idx) => ({ item, idx }));
  withIdx.sort((a, b) => scoreOf(a.item) - scoreOf(b.item) || a.idx - b.idx);
  return withIdx.map((r) => r.item);
}

/**
 * RAG slot helper: default slot injection, chunk caps, dedupe, optional rerank before truncate,
 * and citation tracking after overflow.
 */
export function ragPlugin(options: RagPluginOptions = {}): RagPlugin {
  const slotName = options.slotName ?? 'rag';
  const maxChunks = options.maxChunks ?? 20;
  const rerankOnOverflow = options.rerankOnOverflow ?? false;
  const deduplication = options.deduplication ?? true;
  const dedupeThreshold = options.dedupeThreshold ?? 0.88;
  const citationTracking = options.citationTracking ?? true;
  const defaultSlot: SlotConfig = options.defaultSlot ?? { ...RAG_DEFAULTS.rag };

  const budgetBySlot = new Map<string, number>();
  let lastCitations: readonly RagCitation[] = [];

  const plugin: RagPlugin = {
    name: PLUGIN_NAME,
    version: VERSION,

    prepareSlots(slots) {
      if (slots[slotName] !== undefined) {
        return slots;
      }
      return { ...slots, [slotName]: { ...defaultSlot } };
    },

    afterBudgetResolve(resolved) {
      budgetBySlot.clear();
      if (!citationTracking) {
        lastCitations = [];
      }
      for (const r of resolved) {
        budgetBySlot.set(r.name, r.budgetTokens);
      }
    },

    async beforeOverflow(slot, items) {
      if (slot !== slotName) {
        return items;
      }

      let out = [...items];

      if (deduplication) {
        out = dedupeNearDuplicateChunks(out, dedupeThreshold);
      }

      out = enforceMaxChunks(out, maxChunks);

      const budget = budgetBySlot.get(slot) ?? 0;
      const tokens = sumCachedItemTokens(out);

      if (rerankOnOverflow && tokens > budget && out.length > 0) {
        if (options.rerank !== undefined) {
          out = [...(await Promise.resolve(options.rerank(out)))];
        } else {
          out = sortWorstFirstForFifoTruncate(out);
        }
      }

      return out;
    },

    afterOverflow(slot, items) {
      if (!citationTracking || slot !== slotName) {
        return;
      }
      lastCitations = items.map((item) => ({
        chunkId: chunkIdOf(item),
        itemId: String(item.id),
      }));
    },

    getRagCitations() {
      return lastCitations;
    },
  };

  return plugin;
}
