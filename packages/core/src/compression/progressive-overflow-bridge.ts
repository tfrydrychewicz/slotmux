/**
 * Wires progressive summarization (§8.1 / Phase 8.3) to {@link OverflowStrategyFn}.
 * Implementation lives in `@contextcraft/compression`.
 *
 * @packageDocumentation
 */

import {
  runProgressiveSummarize,
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
};

/**
 * Built-in `summarize` overflow strategy when {@link OverflowEngineOptions.progressiveSummarize} is set.
 *
 * - `overflowConfig.summarizer` as a function → delegates to that {@link SummarizerFn}.
 * - `builtin:map-reduce` → throws (Phase 8.4).
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
    if (oc?.summarizer === 'builtin:map-reduce') {
      throw new InvalidConfigError('builtin:map-reduce summarizer is not implemented yet', {
        context: { strategy: 'summarize' },
      });
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

    const raw = await runProgressiveSummarize(progressiveItems, budgetNum, {
      preserveLastN,
      summarizeText: deps.summarizeText,
      countItemsTokens,
      countTextTokens,
      summaryBudgetTokens: summaryCap,
      slot,
      createId: () => createContentId(),
    });

    return raw.map((item) => {
      const ci = item as unknown as ContentItem;
      if (ci.tokens !== undefined) return ci;
      const plain = typeof item.content === 'string' ? item.content : '';
      const n = countTextTokens(plain);
      return { ...ci, tokens: toTokenCount(Math.max(0, Math.floor(n))) };
    });
  };
}
