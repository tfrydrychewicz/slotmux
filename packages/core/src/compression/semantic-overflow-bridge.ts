/**
 * Wires semantic (embedding) selection (§8.2) to {@link OverflowStrategyFn}.
 * Implementation lives in `@slotmux/compression`.
 *
 * @packageDocumentation
 */

import {
  getPlainTextForLossless,
  runSemanticCompress,
  type SemanticScorableItem,
} from '@slotmux/compression';

import { InvalidConfigError } from '../errors.js';
import type { OverflowContext, OverflowStrategyFn } from '../types/config.js';
import type { ContentItem } from '../types/content.js';

function resolveSemanticAnchorText(
  items: readonly ContentItem[],
  ctx: OverflowContext,
): string {
  const oc = ctx.slotConfig?.overflowConfig;
  const anchorTo = oc?.anchorTo ?? 'lastUserMessage';

  if (anchorTo === 'lastUserMessage') {
    const users = [...items]
      .filter((i) => i.role === 'user')
      .sort((a, b) => a.createdAt - b.createdAt);
    const last = users.at(-1);
    return last !== undefined ? getPlainTextForLossless(last) : '';
  }

  if (anchorTo === 'systemPrompt') {
    const sp = ctx.systemPrompt;
    if (sp === undefined || sp.trim() === '') {
      throw new InvalidConfigError(
        'semantic overflow with anchorTo "systemPrompt" requires OverflowContext.systemPrompt',
        { context: { strategy: 'semantic' } },
      );
    }
    return sp.trim();
  }

  if (typeof anchorTo === 'string') {
    return anchorTo;
  }

  const fromList = items.find((i) => i.id === anchorTo.id);
  if (fromList !== undefined) {
    return getPlainTextForLossless(fromList);
  }
  return getPlainTextForLossless(anchorTo);
}

/**
 * Built-in `semantic` overflow: keep pinned items, then highest-similarity non-pinned items until
 * the slot budget. Requires `overflowConfig.embedFn`.
 */
export const semanticCompressAsOverflow: OverflowStrategyFn = async (items, budget, ctx) => {
  const oc = ctx.slotConfig?.overflowConfig;
  const embedFn = oc?.embedFn;
  if (embedFn === undefined) {
    throw new InvalidConfigError('semantic overflow requires overflowConfig.embedFn', {
      context: { strategy: 'semantic' },
    });
  }

  const budgetNum = budget as number;
  const threshold = oc?.similarityThreshold ?? 0;
  const anchorText = resolveSemanticAnchorText(items, ctx);

  const scorable: SemanticScorableItem[] = items.map((item) => ({
    id: item.id as string,
    role: item.role,
    text: getPlainTextForLossless(item),
    createdAt: item.createdAt,
    ...(item.pinned === true ? { pinned: true as const } : {}),
  }));

  const countItemTokens = (row: SemanticScorableItem): number => {
    const full = items.find((i) => i.id === row.id);
    if (full === undefined) return 0;
    if (ctx.tokenAccountant !== undefined) {
      return ctx.tokenAccountant.countItems([full]);
    }
    return full.tokens ?? 0;
  };

  const selected = await runSemanticCompress({
    items: scorable,
    budgetTokens: budgetNum,
    embed: embedFn,
    anchorText,
    similarityThreshold: threshold,
    countItemTokens,
  });

  const idSet = new Set(selected.map((s) => s.id));
  return [...items]
    .filter((i) => idSet.has(i.id as string))
    .sort((a, b) => a.createdAt - b.createdAt);
};
