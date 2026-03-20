/**
 * Lazy token counting for {@link ContentItem}: pipeline fill-on-first-sum, optional Proxy wrapper (§18.2).
 *
 * @packageDocumentation
 */

import { inferProviderFromModelId } from '../config/model-registry.js';
import { toTokenCount, type TokenCount } from '../types/branded.js';
import type { ProviderId } from '../types/config.js';
import type { ContentItem } from '../types/content.js';
import type { ProviderAdapter, Tokenizer } from '../types/provider.js';

import {
  estimateTokensFromContentPayload,
} from './char-token-estimate.js';
import { compileContentItem } from './compile-content-item.js';
/**
 * Resolves a {@link Tokenizer} for lazy fills when {@link Context.build} is given `providerAdapters`.
 */
export function tryResolveTokenizerForLazyFill(
  modelId: string,
  providerAdapters: Partial<Record<ProviderId, ProviderAdapter>> | undefined,
  explicitProvider?: ProviderId,
): Tokenizer | undefined {
  if (providerAdapters === undefined || Object.keys(providerAdapters).length === 0) {
    return undefined;
  }
  const inferred =
    explicitProvider ?? inferProviderFromModelId(modelId as import('../types/config.js').ModelId);
  if (inferred === undefined) {
    return undefined;
  }
  const adapter = providerAdapters[inferred];
  if (adapter === undefined) {
    return undefined;
  }
  return adapter.getTokenizer(modelId as import('../types/config.js').ModelId);
}

/**
 * Fills missing {@link ContentItem.tokens} using {@link Tokenizer.countBatch} for string rows when
 * possible, otherwise {@link Tokenizer.countMessage} or char-length estimate.
 */
export function fillMissingContentItemTokens(params: {
  readonly items: readonly ContentItem[];
  readonly tokenizer?: Tokenizer;
}): void {
  const { tokenizer } = params;
  const needs = params.items.filter((i) => i.tokens === undefined);
  if (needs.length === 0) {
    return;
  }

  const stringRows: ContentItem[] = [];
  const other: ContentItem[] = [];
  for (const item of needs) {
    if (typeof item.content === 'string') {
      stringRows.push(item);
    } else {
      other.push(item);
    }
  }

  if (tokenizer !== undefined && stringRows.length > 0) {
    const texts = stringRows.map((i) => i.content as string);
    const batch = tokenizer.countBatch(texts);
    for (let i = 0; i < stringRows.length; i++) {
      stringRows[i]!.tokens = batch[i]!;
    }
  } else {
    for (const item of stringRows) {
      item.tokens = toTokenCount(estimateTokensFromContentPayload(item.content));
    }
  }

  for (const item of other) {
    if (tokenizer !== undefined) {
      item.tokens = tokenizer.countMessage(compileContentItem(item));
    } else {
      item.tokens = toTokenCount(estimateTokensFromContentPayload(item.content));
    }
  }
}

/**
 * Like {@link sumCachedItemTokens}, but runs `fillMissing` for items with unset `tokens` first.
 */
export function sumCachedItemTokensWithLazyFill(
  items: readonly ContentItem[],
  fillMissing: (missing: ContentItem[]) => void,
): number {
  const missing: ContentItem[] = [];
  let sum = 0;
  for (const item of items) {
    if (item.tokens !== undefined) {
      sum += item.tokens;
    } else {
      missing.push(item as ContentItem);
    }
  }
  if (missing.length > 0) {
    fillMissing(missing);
  }
  for (const item of missing) {
    sum += item.tokens ?? 0;
  }
  return sum;
}

/**
 * Sums cached `tokens`, using a char-based estimate when unset (does not mutate items).
 */
export function sumCachedOrEstimatedItemTokens(items: readonly ContentItem[]): number {
  let s = 0;
  for (const i of items) {
    if (i.tokens !== undefined) {
      s += i.tokens;
    } else {
      s += estimateTokensFromContentPayload(i.content);
    }
  }
  return s;
}

/**
 * Wraps an item so the first read of `tokens` invokes `resolve` and caches the result on the target.
 */
export function wrapContentItemLazyTokens(
  item: ContentItem,
  resolve: (target: ContentItem) => TokenCount,
): ContentItem {
  return new Proxy(item, {
    get(target, prop, receiver) {
      if (prop === 'tokens') {
        let v = target.tokens;
        if (v === undefined) {
          v = resolve(target);
          target.tokens = v;
        }
        return v;
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as ContentItem;
}
