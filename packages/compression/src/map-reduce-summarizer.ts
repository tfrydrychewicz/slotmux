/**
 * Map-reduce summarization (§8.1 / Phase 8.4).
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';

import { getPlainTextForLossless } from './lossless-compressor.js';
import { DEFAULT_MAP_REDUCE_PROMPTS } from './map-reduce-prompts.js';
import type {
  MapReducePrompts,
  MapReduceSummarizeDeps,
} from './map-reduce-types.js';
import { partitionProgressiveZones } from './progressive-zones.js';
import type { ProgressiveItem } from './progressive-types.js';

export type RunMapReduceSummarizeOptions = {
  readonly preserveLastN?: number;
  readonly mapReduce: MapReduceSummarizeDeps;
  readonly countItemsTokens: (items: readonly ProgressiveItem[]) => number;
  readonly countTextTokens: (text: string) => number;
  /**
   * Soft cap for generated summary sizing (reserved / symmetry with progressive).
   * Defaults ~15% of `budgetTokens`, min 64.
   */
  readonly summaryBudgetTokens?: number;
  readonly slot: string;
  readonly prompts?: Partial<MapReducePrompts>;
  readonly createId?: () => string;
  readonly now?: () => number;
};

function plain(item: ProgressiveItem): string {
  return getPlainTextForLossless(item);
}

function makeSummary(
  text: string,
  summarizes: readonly string[],
  slot: string,
  createId: () => string,
  createdAt: number,
): ProgressiveItem {
  const trimmed = text.trim();
  return {
    id: createId(),
    role: 'assistant',
    content: trimmed.length > 0 ? trimmed : '(empty summary)',
    slot,
    createdAt,
    summarizes: [...summarizes],
  };
}

function defaultLlmWindowTokens(budgetTokens: number): number {
  return Math.min(8192, Math.max(256, Math.floor(budgetTokens * 0.45)));
}

/**
 * Split `text` into substrings each within `maxTokens` (by `countTextTokens`).
 */
export function splitTextToTokenBudget(
  text: string,
  countTextTokens: (t: string) => number,
  maxTokens: number,
): string[] {
  if (text.length === 0) return [];
  if (countTextTokens(text) <= maxTokens) return [text];

  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let lo = start + 1;
    let hi = text.length;
    let best = start + 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const slice = text.slice(start, mid);
      if (countTextTokens(slice) <= maxTokens) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best <= start) {
      out.push(text.slice(start, start + 1));
      start += 1;
    } else {
      out.push(text.slice(start, best));
      start = best;
    }
  }
  return out;
}

/**
 * Partition bulk (non-recent) items into chunks that fit the map LLM window.
 */
export function chunkBulkForMap(
  bulk: readonly ProgressiveItem[],
  countTextTokens: (t: string) => number,
  maxTokens: number,
): ProgressiveItem[][] {
  const out: ProgressiveItem[][] = [];
  const sep = '\n\n';
  let cur: ProgressiveItem[] = [];
  let curJoin = '';

  const flush = () => {
    if (cur.length > 0) {
      out.push(cur);
      cur = [];
      curJoin = '';
    }
  };

  for (const item of bulk) {
    const p = plain(item);
    if (p.length === 0) continue;

    if (countTextTokens(p) > maxTokens) {
      flush();
      const pieces = splitTextToTokenBudget(p, countTextTokens, maxTokens);
      for (const piece of pieces) {
        out.push([{ ...item, content: piece }]);
      }
      continue;
    }

    const addition = cur.length === 0 ? p : curJoin + sep + p;
    if (cur.length > 0 && countTextTokens(addition) > maxTokens) {
      flush();
      cur = [item];
      curJoin = p;
    } else {
      cur.push(item);
      curJoin = addition;
    }
  }
  flush();
  return out;
}

const REDUCE_SEP = '\n\n---\n\n';

async function reduceOneLayer(
  parts: readonly string[],
  countTextTokens: (t: string) => number,
  maxReduce: number,
  reduceMerge: MapReduceSummarizeDeps['reduceMerge'],
  systemPrompt: string,
): Promise<string[]> {
  const next: string[] = [];
  let batch: string[] = [];
  let join = '';

  const flush = async () => {
    if (batch.length === 0) return;
    let payload = join;
    if (countTextTokens(payload) > maxReduce) {
      const subs = splitTextToTokenBudget(payload, countTextTokens, maxReduce);
      const partials = await Promise.all(
        subs.map((sub) => reduceMerge({ systemPrompt, userPayload: sub })),
      );
      const folded = await reduceUntilOne(
        partials,
        countTextTokens,
        maxReduce,
        reduceMerge,
        systemPrompt,
      );
      next.push(folded);
    } else {
      next.push(await reduceMerge({ systemPrompt, userPayload: payload }));
    }
    batch = [];
    join = '';
  };

  for (const p of parts) {
    const cand = batch.length === 0 ? p : join + REDUCE_SEP + p;
    if (batch.length > 0 && countTextTokens(cand) > maxReduce) {
      await flush();
      batch = [p];
      join = p;
    } else {
      batch.push(p);
      join = cand;
    }
  }
  await flush();
  return next;
}

async function reduceUntilOne(
  parts: readonly string[],
  countTextTokens: (t: string) => number,
  maxReduce: number,
  reduceMerge: MapReduceSummarizeDeps['reduceMerge'],
  systemPrompt: string,
): Promise<string> {
  let level = [...parts];
  while (level.length > 1) {
    level = await reduceOneLayer(level, countTextTokens, maxReduce, reduceMerge, systemPrompt);
  }
  let s = level[0] ?? '';
  if (countTextTokens(s) > maxReduce) {
    const subs = splitTextToTokenBudget(s, countTextTokens, maxReduce);
    const partials = await Promise.all(
      subs.map((sub) => reduceMerge({ systemPrompt, userPayload: sub })),
    );
    s = await reduceUntilOne(partials, countTextTokens, maxReduce, reduceMerge, systemPrompt);
  }
  return s;
}

/**
 * Map-reduce over non-recent messages (same RECENT boundary as progressive summarization),
 * then prepend one merged summary before recent items. Shrinks with the same recent-drop
 * loop as progressive when still over `budgetTokens`.
 */
export async function runMapReduceSummarize(
  items: readonly ProgressiveItem[],
  budgetTokens: number,
  options: RunMapReduceSummarizeOptions,
): Promise<ProgressiveItem[]> {
  const preserveLastN = options.preserveLastN ?? 4;
  const promptPack: MapReducePrompts = {
    ...DEFAULT_MAP_REDUCE_PROMPTS,
    ...options.prompts,
  };
  const createId = options.createId ?? nanoid;
  const nowFn = options.now ?? Date.now;
  const { mapChunk, reduceMerge } = options.mapReduce;
  const mapMax =
    options.mapReduce.mapChunkMaxInputTokens ?? defaultLlmWindowTokens(budgetTokens);
  const reduceMax =
    options.mapReduce.reduceMaxInputTokens ?? defaultLlmWindowTokens(budgetTokens);
  const _summaryCap =
    options.summaryBudgetTokens ?? Math.max(64, Math.floor(budgetTokens * 0.15));
  void _summaryCap;

  const sumTok = (arr: readonly ProgressiveItem[]) => options.countItemsTokens(arr);

  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  if (sumTok(sorted) <= budgetTokens) {
    return sorted;
  }

  const { old, middle, recent } = partitionProgressiveZones(sorted, preserveLastN);
  const bulk = [...old, ...middle];
  let recentWork = [...recent];

  const minRecentTime =
    recentWork.length > 0 ? Math.min(...recentWork.map((r) => r.createdAt)) : nowFn();
  let tick = 0;
  const nextSummaryTime = (): number => minRecentTime - 1000 - tick++ * 1000;

  if (bulk.length === 0) {
    const chain = recentWork;
    while (sumTok(chain) > budgetTokens) {
      const dropIdx = recentWork.findIndex((i) => !i.pinned);
      if (dropIdx < 0) break;
      recentWork = recentWork.filter((_, j) => j !== dropIdx);
    }
    return recentWork.sort((a, b) => a.createdAt - b.createdAt);
  }

  const chunks = chunkBulkForMap(bulk, options.countTextTokens, mapMax);
  const bulkIds = [...new Set(bulk.map((b) => b.id))];
  const mapOutputs: string[] = [];
  for (const ch of chunks) {
    const payload = ch.map(plain).filter((t) => t.length > 0).join('\n\n');
    if (payload.length === 0) continue;
    const text = await mapChunk({
      systemPrompt: promptPack.map,
      userPayload: payload,
    });
    mapOutputs.push(text);
  }

  let finalText: string;
  if (mapOutputs.length === 0) {
    finalText = '';
  } else if (mapOutputs.length === 1) {
    finalText = mapOutputs[0]!;
  } else {
    finalText = await reduceUntilOne(
      mapOutputs,
      options.countTextTokens,
      reduceMax,
      reduceMerge,
      promptPack.reduce,
    );
  }

  let head: ProgressiveItem | undefined =
    mapOutputs.length > 0
      ? makeSummary(finalText, bulkIds, options.slot, createId, nextSummaryTime())
      : undefined;

  const chain = (): ProgressiveItem[] =>
    head !== undefined ? [head, ...recentWork] : recentWork;

  let out = chain();
  while (sumTok(out) > budgetTokens) {
    const dropIdx = recentWork.findIndex((i) => !i.pinned);
    if (dropIdx >= 0) {
      recentWork = recentWork.filter((_, j) => j !== dropIdx);
      out = chain();
      continue;
    }
    break;
  }

  return out.sort((a, b) => a.createdAt - b.createdAt);
}
