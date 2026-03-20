/**
 * Wires built-in summarization (§8.1 — progressive Phase 8.3, map-reduce Phase 8.4) to {@link OverflowStrategyFn}.
 * Implementation lives in `@contextcraft/compression`.
 *
 * @packageDocumentation
 */

import {
  runMapReduceSummarize,
  runProgressiveSummarize,
  type MapReduceSummarizeDeps,
  type ProgressiveItem,
  type ProgressiveSummarizeTextFn,
} from '@contextcraft/compression';

import { InvalidConfigError } from '../errors.js';
import { createContentId, toTokenCount } from '../types/branded.js';
import type { OverflowStrategyFn, SlotBudget } from '../types/config.js';
import type { ContentItem } from '../types/content.js';

function summaryBudgetTokensFromConfig(slotBudget: number, sb: SlotBudget | undefined): number {
  if (sb === undefined) return Math.max(64, Math.floor(slotBudget * 0.15));
  if ('fixed' in sb) return Math.max(1, Math.floor(sb.fixed));
  if ('percent' in sb) return Math.max(64, Math.floor((slotBudget * sb.percent) / 100));
  if ('min' in sb && 'max' in sb && sb.flex === true) {
    const guess = Math.floor(slotBudget * 0.15);
    return Math.min(sb.max, Math.max(sb.min, guess));
  }
  if ('flex' in sb && sb.flex === true) {
    return Math.max(64, Math.floor(slotBudget * 0.15));
  }
  return Math.max(64, Math.floor(slotBudget * 0.15));
}

export type ProgressiveSummarizeOverflowDeps = {
  readonly summarizeText: ProgressiveSummarizeTextFn;
  /**
   * Required when `overflowConfig.summarizer` is `builtin:map-reduce`.
   */
  readonly mapReduce?: MapReduceSummarizeDeps;
};

function enrichSummaryTokens(
  raw: readonly ProgressiveItem[],
  countTextTokens: (text: string) => number,
): ContentItem[] {
  return raw.map((item) => {
    const ci = item as unknown as ContentItem;
    if (ci.tokens !== undefined) return ci;
    const plain = typeof item.content === 'string' ? item.content : '';
    const n = countTextTokens(plain);
    return { ...ci, tokens: toTokenCount(Math.max(0, Math.floor(n))) };
  });
}

/**
 * Built-in `summarize` overflow strategy when {@link OverflowEngineOptions.progressiveSummarize} is set.
 *
 * - `overflowConfig.summarizer` as a function → delegates to that {@link SummarizerFn}.
 * - `builtin:map-reduce` → {@link runMapReduceSummarize} (requires `deps.mapReduce`).
 * - `builtin:progressive` or omitted → {@link runProgressiveSummarize} with `deps.summarizeText`.
 */
export function createProgressiveSummarizeOverflow(
  countTokens: (items: readonly ContentItem[]) => number,
  deps: ProgressiveSummarizeOverflowDeps,
): OverflowStrategyFn {
  return async (items, budget, ctx) => {
    const oc = ctx.slotConfig?.overflowConfig;
    if (typeof oc?.summarizer === 'function') {
      return oc.summarizer([...items], budget);
    }

    const preserveLastN = oc?.preserveLastN ?? 4;
    const budgetNum = budget as number;
    const summaryCap = summaryBudgetTokensFromConfig(budgetNum, oc?.summaryBudget);
    const slot = ctx.slot;

    const synthetic = (text: string): ContentItem => ({
      id: createContentId(),
      role: 'user',
      content: text,
      slot,
      createdAt: Date.now(),
      tokens: toTokenCount(Math.max(0, text.length)),
    });

    const countTextTokens = (text: string) => countTokens([synthetic(text)]);
    const countItemsTokens = (arr: readonly ProgressiveItem[]) =>
      countTokens(arr as unknown as ContentItem[]);

    const progressiveItems = items as unknown as ProgressiveItem[];
    const createId = () => createContentId();

    if (oc?.summarizer === 'builtin:map-reduce') {
      if (deps.mapReduce === undefined) {
        throw new InvalidConfigError(
          'builtin:map-reduce requires progressiveSummarize.mapReduce (mapChunk + reduceMerge)',
          { context: { strategy: 'summarize' } },
        );
      }
      const raw = await runMapReduceSummarize(progressiveItems, budgetNum, {
        preserveLastN,
        mapReduce: deps.mapReduce,
        countItemsTokens,
        countTextTokens,
        summaryBudgetTokens: summaryCap,
        slot,
        createId,
      });
      return enrichSummaryTokens(raw, countTextTokens);
    }

    const raw = await runProgressiveSummarize(progressiveItems, budgetNum, {
      preserveLastN,
      summarizeText: deps.summarizeText,
      countItemsTokens,
      countTextTokens,
      summaryBudgetTokens: summaryCap,
      slot,
      createId,
    });

    return enrichSummaryTokens(raw, countTextTokens);
  };
}

export type { MapReduceSummarizeDeps } from '@contextcraft/compression';
