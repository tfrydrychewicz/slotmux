/**
 * Progressive summarization (§8.1 / Phase 8.3).
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';

import { getPlainTextForLossless } from './lossless-compressor.js';
import { DEFAULT_PROGRESSIVE_PROMPTS } from './progressive-prompts.js';
import { partitionProgressiveZones } from './progressive-zones.js';
import type {
  ProgressiveItem,
  ProgressivePrompts,
  ProgressiveSummarizeTextFn,
} from './progressive-types.js';

export type RunProgressiveSummarizeOptions = {
  readonly preserveLastN?: number;
  readonly summarizeText: ProgressiveSummarizeTextFn;
  readonly countItemsTokens: (items: readonly ProgressiveItem[]) => number;
  readonly countTextTokens: (text: string) => number;
  /**
   * Soft cap for total tokens of generated summary messages (planning hint; summaries still run if payload non-empty).
   * Default ~15% of `budgetTokens`, minimum 64.
   */
  readonly summaryBudgetTokens?: number;
  readonly slot: string;
  readonly prompts?: Partial<ProgressivePrompts>;
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

function buildChain(
  l3: ProgressiveItem | undefined,
  l2: ProgressiveItem | undefined,
  l1: ProgressiveItem | undefined,
  recent: readonly ProgressiveItem[],
): ProgressiveItem[] {
  const head: ProgressiveItem[] = [];
  if (l3) {
    head.push(l3);
  } else if (l2) {
    head.push(l2);
  }
  if (l1) {
    head.push(l1);
  }
  return [...head, ...recent];
}

/**
 * Runs progressive summarization until estimated token count is ≤ `budgetTokens`, or only pinned recent remain.
 *
 * Order: `[Layer3?, Layer2?, Layer1?, ...RECENT]` with summary `createdAt` just before the oldest RECENT message.
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

  const { old, middle, recent } = partitionProgressiveZones(sorted, preserveLastN);
  const _summaryCap =
    options.summaryBudgetTokens ?? Math.max(64, Math.floor(budgetTokens * 0.15));
  void _summaryCap; // reserved for future chunking

  const minRecentTime =
    recent.length > 0 ? Math.min(...recent.map((r) => r.createdAt)) : nowFn();
  let tick = 0;
  const nextSummaryTime = (): number => minRecentTime - 1000 - tick++ * 1000;

  let l2: ProgressiveItem | undefined;
  let l1: ProgressiveItem | undefined;
  let l3: ProgressiveItem | undefined;

  const oldPayload = old.map(plain).filter((t) => t.length > 0).join('\n\n');
  if (old.length > 0 && oldPayload.length > 0) {
    const text = await summarizeText({
      layer: 2,
      systemPrompt: promptPack.layer2,
      userPayload: oldPayload,
    });
    l2 = makeSummary(text, old.map((x) => x.id), options.slot, createId, nextSummaryTime());
  }

  let recentWork = [...recent];
  const chain = (): ProgressiveItem[] => buildChain(l3, l2, l1, recentWork);
  let out = chain();

  if (sumTok(out) <= budgetTokens) {
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  const middlePayload = middle.map(plain).filter((t) => t.length > 0).join('\n\n');
  if (middle.length > 0 && middlePayload.length > 0) {
    const text = await summarizeText({
      layer: 1,
      systemPrompt: promptPack.layer1,
      userPayload: middlePayload,
    });
    l1 = makeSummary(
      text,
      middle.map((x) => x.id),
      options.slot,
      createId,
      nextSummaryTime(),
    );
    out = chain();
  }

  if (sumTok(out) > budgetTokens && l2) {
    const l2Text = plain(l2);
    if (l2Text.length > 0) {
      const text = await summarizeText({
        layer: 3,
        systemPrompt: promptPack.layer3,
        userPayload: l2Text,
      });
      const prior = l2.summarizes ?? [];
      l3 = makeSummary(
        text,
        [...prior, l2.id],
        options.slot,
        createId,
        nextSummaryTime(),
      );
      l2 = undefined;
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
