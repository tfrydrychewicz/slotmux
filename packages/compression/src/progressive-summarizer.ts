/**
 * Progressive summarization (§8.1, §8.4).
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';

import { runWithConcurrency } from './concurrency.js';
import { FactStore, parseFactLines, type ExtractFactsFn } from './fact-extraction.js';
import { computeItemImportance, type ImportanceScorerFn } from './importance-scorer.js';
import { getPlainTextForLossless } from './lossless-compressor.js';
import { DEFAULT_PROGRESSIVE_PROMPTS } from './progressive-prompts.js';
import {
  extractSummarizeText,
  type ProgressiveItem,
  type ProgressivePrompts,
  type ProgressiveSummarizeTextFn,
} from './progressive-types.js';
import { partitionProgressiveZones } from './progressive-zones.js';

export type RunProgressiveSummarizeOptions = {
  readonly preserveLastN?: number;
  readonly summarizeText: ProgressiveSummarizeTextFn;
  readonly countItemsTokens: (items: readonly ProgressiveItem[]) => number;
  readonly countTextTokens: (text: string) => number;
  /**
   * Token budget for generated summary messages.
   * Summaries are instructed to fill this target. Default ~15% of `budgetTokens`, minimum 64.
   */
  readonly summaryBudgetTokens?: number;
  readonly slot: string;
  readonly prompts?: Partial<ProgressivePrompts>;
  readonly createId?: () => string;
  readonly now?: () => number;
  /**
   * Maximum number of concurrent LLM summarization calls.
   *
   * Old-zone and middle-zone chunks are independent and can be summarized in
   * parallel. Set this to limit API concurrency (e.g. to respect rate limits).
   * Default: `Infinity` (all chunks run in parallel).
   */
  readonly maxConcurrency?: number;
  /**
   * Maximum token budget for the rendered fact block (§8.4).
   *
   * Extracted facts are rendered as a synthetic content item at the start of
   * the summarized output. This controls how many tokens that block may consume.
   * Default: 20% of `summaryBudgetTokens`, capped at 512 tokens.
   */
  readonly factBudgetTokens?: number;
  /**
   * Custom importance scorer for zone partitioning (§8.4.4).
   *
   * When provided, non-recent items are sorted by importance before being split
   * into old/middle zones. Lowest-scored items go to the OLD zone (most aggressive
   * compression). When omitted, the default {@link computeItemImportance} is used,
   * which scores by entity density, decisions, preferences, and specific facts.
   *
   * Set to `null` to disable importance-weighted partitioning entirely
   * (pure chronological split).
   */
  readonly importanceScorer?: ImportanceScorerFn | null;
  /**
   * Dedicated fact extraction function (§8.4 P2).
   *
   * When provided, a separate extraction pass runs on each chunk's text
   * **before** summarization. Extracted facts are merged into the
   * {@link FactStore} and survive alongside inline `FACT:` lines from the
   * summarization output itself.
   *
   * Use {@link createDefaultExtractFacts} for an LLM-backed default, or
   * provide a custom function (e.g. regex-based domain extraction).
   */
  readonly extractFacts?: ExtractFactsFn;
};

function plain(item: ProgressiveItem): string {
  return getPlainTextForLossless(item);
}

/**
 * Minimum per-chunk token budget. LLMs struggle to produce useful output
 * below this threshold — responses are frequently empty or truncated.
 */
const MIN_PER_CHUNK_TOKENS = 200;

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

/**
 * Fallback when the LLM returns empty or errors out: extract the first
 * `targetTokens` worth of text from the original payload, preserving
 * at least some information rather than producing a useless "(empty summary)".
 *
 * Uses ~4 chars per token as a rough estimate (English text average).
 */
function truncateAsLastResort(payload: string, targetTokens: number): string {
  const charBudget = targetTokens * 4;
  if (payload.length <= charBudget) return payload;
  const cutPos = payload.lastIndexOf(' ', charBudget);
  const end = cutPos > charBudget * 0.5 ? cutPos : charBudget;
  return payload.slice(0, end) + '…';
}

/**
 * Appends a target-length instruction to a system prompt so the LLM
 * knows how much output to produce.
 */
function withTargetLength(systemPrompt: string, targetTokens: number): string {
  const approxWords = Math.floor(targetTokens * 0.75);
  return (
    systemPrompt +
    `\n\nTarget output length: approximately ${String(approxWords)} words (~${String(targetTokens)} tokens). ` +
    'Use the available space to preserve as many specific facts, names, numbers, dates, and user preferences as possible.'
  );
}

/**
 * Splits items into chunks of roughly `maxChunkTokens` each.
 */
function chunkZoneByTokenBudget(
  items: readonly ProgressiveItem[],
  maxChunkTokens: number,
  countItemsTokens: (items: readonly ProgressiveItem[]) => number,
): ProgressiveItem[][] {
  if (items.length === 0) return [];

  const chunks: ProgressiveItem[][] = [];
  let cur: ProgressiveItem[] = [];

  for (const item of items) {
    cur.push(item);
    if (countItemsTokens(cur) > maxChunkTokens && cur.length > 1) {
      const overflow = cur.pop()!;
      chunks.push(cur);
      cur = [overflow];
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/**
 * Runs progressive summarization until estimated token count is <= `budgetTokens`, or only pinned recent remain.
 *
 * When zones are large, items are chunked into segments of ~4-8K tokens and
 * each segment is summarized independently, producing multiple summary items
 * that collectively fill the summary budget.
 *
 * Facts are extracted from LLM output (§8.4) and rendered as a compact
 * synthetic item at the start of the output so specific details survive
 * compression rounds.
 *
 * Order: `[factBlock?, ...Layer2Summaries?, ...Layer1Summaries?, ...RECENT]` with summary `createdAt` just before the oldest RECENT message.
 */
export async function runProgressiveSummarize(
  items: readonly ProgressiveItem[],
  budgetTokens: number,
  options: RunProgressiveSummarizeOptions,
): Promise<ProgressiveItem[]> {
  const preserveLastN = options.preserveLastN ?? 4;
  const promptPack: ProgressivePrompts = {
    ...DEFAULT_PROGRESSIVE_PROMPTS,
    ...options.prompts,
  };
  const createId = options.createId ?? nanoid;
  const nowFn = options.now ?? Date.now;
  const { summarizeText } = options;
  const sumTok = (arr: readonly ProgressiveItem[]) => options.countItemsTokens(arr);

  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  if (sumTok(sorted) <= budgetTokens) {
    return sorted;
  }

  const scorer = options.importanceScorer === null
    ? undefined
    : options.importanceScorer ?? computeItemImportance;
  const { old, middle, recent } = partitionProgressiveZones(sorted, preserveLastN, scorer);
  const summaryCap =
    options.summaryBudgetTokens ?? Math.max(64, Math.floor(budgetTokens * 0.15));

  const defaultFactBudget = Math.min(512, Math.floor(summaryCap * 0.2));
  const factBudgetTokens = options.factBudgetTokens ?? defaultFactBudget;
  const factBudgetChars = factBudgetTokens * 4;

  const segmentSize = Math.min(8192, Math.max(2048, Math.floor(budgetTokens * 0.15)));

  const minRecentTime =
    recent.length > 0 ? Math.min(...recent.map((r) => r.createdAt)) : nowFn();
  const summaryTimeForTick = (tick: number): number => minRecentTime - 1000 - tick * 1000;

  const l2Cap = Math.floor(summaryCap * 0.55);
  const l1Cap = Math.floor(summaryCap * 0.45);
  const maxConc = options.maxConcurrency ?? Infinity;

  const oldChunks = old.length > 0 ? chunkZoneByTokenBudget(old, segmentSize, sumTok) : [];
  const midChunks = middle.length > 0 ? chunkZoneByTokenBudget(middle, segmentSize, sumTok) : [];
  const perOldCap = Math.max(MIN_PER_CHUNK_TOKENS, Math.floor(l2Cap / Math.max(1, oldChunks.length)));
  const perMidCap = Math.max(MIN_PER_CHUNK_TOKENS, Math.floor(l1Cap / Math.max(1, midChunks.length)));

  const factStore = new FactStore();
  const { extractFacts } = options;

  const summarizeChunk = async (
    chunk: readonly ProgressiveItem[],
    layer: 1 | 2,
    perChunkCap: number,
    prompt: string,
    tick: number,
  ): Promise<ProgressiveItem | null> => {
    const payload = chunk.map(plain).filter((t) => t.length > 0).join('\n\n');
    if (payload.length === 0) return null;

    const chunkSourceId = chunk.map((x) => x.id).join('+');

    if (extractFacts !== undefined) {
      try {
        const extracted = await extractFacts({
          text: payload,
          existingFacts: factStore.all(),
        });
        factStore.addAll(extracted);
      } catch {
        /* extraction failure is non-fatal */
      }
    }

    let text: string;
    try {
      const raw = await summarizeText({
        layer,
        systemPrompt: withTargetLength(prompt, perChunkCap),
        userPayload: payload,
        targetTokens: perChunkCap,
      });
      const fullText = extractSummarizeText(raw);
      const parsed = parseFactLines(fullText, chunkSourceId, nowFn());
      factStore.addAll(parsed.facts);
      text = parsed.narrative;
    } catch {
      text = '';
    }

    if (text.trim().length === 0) {
      text = truncateAsLastResort(payload, perChunkCap);
    }

    return makeSummary(text, chunk.map((x) => x.id), options.slot, createId, summaryTimeForTick(tick));
  };

  const allTasks: Array<() => Promise<ProgressiveItem | null>> = [
    ...oldChunks.map((chunk, i) =>
      () => summarizeChunk(chunk, 2, perOldCap, promptPack.layer2, i)),
    ...midChunks.map((chunk, i) =>
      () => summarizeChunk(chunk, 1, perMidCap, promptPack.layer1, oldChunks.length + i)),
  ];

  const allResults = await runWithConcurrency(allTasks, maxConc);
  let l2Summaries = allResults.slice(0, oldChunks.length).filter((x): x is ProgressiveItem => x !== null);
  const l1Summaries = allResults.slice(oldChunks.length).filter((x): x is ProgressiveItem => x !== null);

  let recentWork = [...recent];

  const makeFactItem = (): ProgressiveItem | null => {
    const rendered = factStore.render(factBudgetChars);
    if (rendered.length === 0) return null;
    return {
      id: createId(),
      role: 'assistant',
      content: rendered,
      slot: options.slot,
      createdAt: summaryTimeForTick(-1),
      pinned: true,
    };
  };

  const chain = (): ProgressiveItem[] => {
    const factItem = makeFactItem();
    return [...(factItem ? [factItem] : []), ...l2Summaries, ...l1Summaries, ...recentWork];
  };
  let out = chain();

  if (sumTok(out) > budgetTokens && l2Summaries.length > 0) {
    const l2Payload = l2Summaries.map(plain).filter((t) => t.length > 0).join('\n\n');
    if (l2Payload.length > 0) {
      const l3Cap = Math.max(MIN_PER_CHUNK_TOKENS, Math.floor(summaryCap * 0.15));

      let l3Prompt = promptPack.layer3;
      const pinnedFactBlock = factStore.renderAsFactLines(factBudgetChars);
      if (pinnedFactBlock.length > 0) {
        l3Prompt +=
          '\n\nThe following facts MUST be preserved verbatim in your output:\n' +
          pinnedFactBlock +
          '\nCompress the narrative, but do NOT drop any of the above facts.';
      }

      let text: string;
      try {
        const raw = await summarizeText({
          layer: 3,
          systemPrompt: withTargetLength(l3Prompt, l3Cap),
          userPayload: l2Payload,
          targetTokens: l3Cap,
        });
        const fullText = extractSummarizeText(raw);
        const parsed = parseFactLines(fullText, 'l3-consolidation', nowFn());
        factStore.addAll(parsed.facts);
        text = parsed.narrative;
      } catch {
        text = '';
      }
      if (text.trim().length === 0) {
        text = truncateAsLastResort(l2Payload, l3Cap);
      }
      const priorIds = l2Summaries.flatMap((s) => [...(s.summarizes ?? []), s.id]);
      const l3Tick = oldChunks.length + midChunks.length;
      const l3 = makeSummary(text, priorIds, options.slot, createId, summaryTimeForTick(l3Tick));
      l2Summaries = [l3];
      out = chain();
    }
  }

  while (sumTok(out) > budgetTokens) {
    const dropIdx = recentWork.findIndex((i) => !i.pinned);
    if (dropIdx < 0) {
      break;
    }
    recentWork = recentWork.filter((_, j) => j !== dropIdx);
    out = chain();
  }

  return out.sort((a, b) => a.createdAt - b.createdAt);
}
