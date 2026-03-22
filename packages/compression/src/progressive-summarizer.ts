/**
 * Progressive summarization (§8.1, §8.4, §8.9).
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
  /**
   * Half-life in milliseconds for time-based fact confidence decay (§8.4).
   *
   * When set, older facts lose effective confidence over time, causing them
   * to be dropped first when the fact budget is tight. The decay formula is
   * `confidence * 0.5^(age / halfLifeMs)`.
   *
   * Default: `undefined` (no decay — raw confidence is used as-is).
   */
  readonly factDecayHalfLifeMs?: number;
  /**
   * Fast character-based token estimator for heuristic paths (§9.3.1 Tier 0).
   *
   * When provided, used instead of exact `countItemsTokens` in
   * `chunkZoneByTokenBudget`, `computeDynamicPreserveLastN`, and adaptive
   * zone skip (first pass). The exact counter is still used for final budget
   * enforcement and `enrichSummaryTokens`.
   */
  readonly estimateItemsTokens?: (items: readonly ProgressiveItem[]) => number;
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
 * Returns `true` if the item is an existing summary (has been through
 * a previous compression pass) and can be carried forward without
 * re-summarizing.
 */
function isStableSummary(item: ProgressiveItem): boolean {
  return item.summarizes !== undefined && item.summarizes.length > 0;
}

/**
 * Splits a zone's items into stable summaries (carry forward) and fresh
 * items (need LLM summarization).
 */
function splitStableAndFresh(
  items: readonly ProgressiveItem[],
): { stable: ProgressiveItem[]; fresh: ProgressiveItem[] } {
  const stable: ProgressiveItem[] = [];
  const fresh: ProgressiveItem[] = [];
  for (const item of items) {
    if (isStableSummary(item)) {
      stable.push(item);
    } else {
      fresh.push(item);
    }
  }
  return { stable, fresh };
}

/**
 * Runs progressive summarization until estimated token count is <= `budgetTokens`, or only pinned recent remain.
 *
 * **Incremental mode (§8.9 P1):** Items that are already summaries (have a
 * `summarizes` field) are treated as stable and carried forward without
 * re-summarization. Only fresh, unsummarized items are sent to the LLM.
 * This makes per-build cost proportional to new content, not total content.
 *
 * **Adaptive zone skip (§8.9 P1):** After old-zone processing, if the output
 * already fits within budget, middle-zone LLM calls are skipped entirely.
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
  const fastEstimate = options.estimateItemsTokens ?? sumTok;

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

  const factStore = new FactStore();
  const { extractFacts, factDecayHalfLifeMs } = options;

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

  // --- Incremental summarization (§8.9 P1) ---
  // Separate each zone into stable summaries (carry forward) and fresh items (need LLM).
  const oldSplit = splitStableAndFresh(old);
  const midSplit = splitStableAndFresh(middle);

  const freshOldChunks = oldSplit.fresh.length > 0
    ? chunkZoneByTokenBudget(oldSplit.fresh, segmentSize, sumTok)
    : [];
  const freshMidChunks = midSplit.fresh.length > 0
    ? chunkZoneByTokenBudget(midSplit.fresh, segmentSize, sumTok)
    : [];

  const totalOldChunks = freshOldChunks.length;
  const perOldCap = Math.max(MIN_PER_CHUNK_TOKENS, Math.floor(l2Cap / Math.max(1, totalOldChunks)));
  const perMidCap = Math.max(MIN_PER_CHUNK_TOKENS, Math.floor(l1Cap / Math.max(1, freshMidChunks.length)));

  // Phase 1: Summarize fresh old-zone items
  const oldTasks: Array<() => Promise<ProgressiveItem | null>> = freshOldChunks.map((chunk, i) =>
    () => summarizeChunk(chunk, 2, perOldCap, promptPack.layer2, i));

  const oldResults = await runWithConcurrency(oldTasks, maxConc);
  const newOldSummaries = oldResults.filter((x): x is ProgressiveItem => x !== null);
  let l2Summaries = [...oldSplit.stable, ...newOldSummaries];

  let recentWork = [...recent];

  const makeFactItem = (): ProgressiveItem | null => {
    const rendered = factStore.render(factBudgetChars, factDecayHalfLifeMs);
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

  // l1Summaries may be populated later if middle zone is processed
  let l1Summaries: ProgressiveItem[] = [...midSplit.stable];

  const chain = (): ProgressiveItem[] => {
    const factItem = makeFactItem();
    return [...(factItem ? [factItem] : []), ...l2Summaries, ...l1Summaries, ...recentWork];
  };

  // --- Adaptive zone skip (§8.9 P1) ---
  // After old-zone summarization, check if l2Summaries + middle + recent fits.
  // If so, skip middle-zone LLM calls entirely.
  // Uses fast estimate for early rejection only; exact counter for the accept path
  // (fast estimates can diverge significantly from exact counters, e.g. char-based tests).
  const afterOldZone = [...l2Summaries, ...middle, ...recentWork];
  const afterOldZoneFactItem = makeFactItem();
  const afterOldCheck = [
    ...(afterOldZoneFactItem ? [afterOldZoneFactItem] : []),
    ...afterOldZone,
  ];

  const skipMiddle = fastEstimate(afterOldCheck) > budgetTokens
    ? false
    : sumTok(afterOldCheck) <= budgetTokens;

  if (skipMiddle) {
    // Middle zone fits verbatim — skip middle-zone LLM calls
    l1Summaries = [...middle];
  } else {
    // Phase 2: Summarize fresh middle-zone items
    const midTasks: Array<() => Promise<ProgressiveItem | null>> = freshMidChunks.map((chunk, i) =>
      () => summarizeChunk(chunk, 1, perMidCap, promptPack.layer1, totalOldChunks + i));

    const midResults = await runWithConcurrency(midTasks, maxConc);
    const newMidSummaries = midResults.filter((x): x is ProgressiveItem => x !== null);
    l1Summaries = [...midSplit.stable, ...newMidSummaries];
  }

  let out = chain();

  // Phase 3: L3 consolidation — only when output exceeds budget
  if (sumTok(out) > budgetTokens && l2Summaries.length > 0) {
    const l2Payload = l2Summaries.map(plain).filter((t) => t.length > 0).join('\n\n');
    if (l2Payload.length > 0) {
      const l3Cap = Math.max(MIN_PER_CHUNK_TOKENS, Math.floor(summaryCap * 0.15));

      let l3Prompt = promptPack.layer3;
      const pinnedFactBlock = factStore.renderAsFactLines(factBudgetChars, factDecayHalfLifeMs);
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
      const l3Tick = totalOldChunks + freshMidChunks.length;
      const l3 = makeSummary(text, priorIds, options.slot, createId, summaryTimeForTick(l3Tick));
      l2Summaries = [l3];
      out = chain();
    }
  }

  if (sumTok(out) > budgetTokens && recentWork.length > 0) {
    const toDrop: ProgressiveItem[] = [];
    while (sumTok(chain()) > budgetTokens) {
      const dropIdx = recentWork.findIndex((i) => !i.pinned);
      if (dropIdx < 0) break;
      toDrop.push(recentWork[dropIdx]!);
      recentWork = recentWork.filter((_, j) => j !== dropIdx);
    }

    if (toDrop.length > 0) {
      const dropCap = Math.max(MIN_PER_CHUNK_TOKENS, perMidCap);
      const dropSummary = await summarizeChunk(
        toDrop, 1, dropCap, promptPack.layer1,
        totalOldChunks + freshMidChunks.length + 1,
      );
      if (dropSummary !== null) {
        l1Summaries = [...l1Summaries, dropSummary];
      }
      out = chain();
    }
  }

  return out.sort((a, b) => a.createdAt - b.createdAt);
}
