/**
 * Tools slot plugin (§11.2 design / Phase 11.3).
 *
 * @packageDocumentation
 */

import type { ContentItem, ContextPlugin, SlotConfig } from 'contextcraft';
import { AGENT_DEFAULTS, toTokenCount } from 'contextcraft';

import {
  estimateTokensFromText,
  truncateStringToApproxTokens,
} from './truncate-result.js';
import { VERSION } from './version.js';

const PLUGIN_NAME = '@contextcraft/plugin-tools';

/** Metadata: {@link TOOLS_METADATA_KIND} === `'definition'` marks function / JSON tool schemas. */
export const TOOLS_METADATA_KIND = 'tools.kind';

/** Value for {@link TOOLS_METADATA_KIND} on definition rows. */
export const TOOLS_KIND_DEFINITION = 'definition';

export type ToolsPluginOptions = {
  /** Slot for definitions + tool results (default `tools`). */
  readonly slotName?: string;

  /** Max `tool`-role results retained (non-pinned); definitions are not counted. */
  readonly maxToolResults?: number;

  readonly truncateLargeResults?: boolean;

  /** Approximate token cap per tool result body when truncating. */
  readonly resultMaxTokens?: number;

  /** Override token estimate for definition items (defaults to char/4 on serialized content). */
  readonly estimateDefinitionTokens?: (item: ContentItem) => number;

  /** Injected when absent via {@link ContextPlugin.prepareSlots}. */
  readonly defaultSlot?: SlotConfig;
};

function isToolDefinition(item: ContentItem): boolean {
  const k = item.metadata?.[TOOLS_METADATA_KIND];
  return k === TOOLS_KIND_DEFINITION || item.metadata?.['tools.definition'] === true;
}

function definitionPayloadText(item: ContentItem): string {
  if (typeof item.content === 'string') {
    return item.content;
  }
  try {
    return JSON.stringify(item.content);
  } catch {
    return '';
  }
}

function defaultEstimateDefinitionTokens(item: ContentItem): number {
  return estimateTokensFromText(definitionPayloadText(item));
}

function currentTokenEstimate(item: ContentItem): number {
  if (item.tokens !== undefined) {
    return Number(item.tokens);
  }
  if (typeof item.content === 'string') {
    return estimateTokensFromText(item.content);
  }
  return estimateTokensFromText(definitionPayloadText(item));
}

function enforceMaxToolResults(
  items: readonly ContentItem[],
  maxResults: number,
): ContentItem[] {
  if (maxResults <= 0) {
    return items.filter((i) => i.pinned || i.role !== 'tool' || isToolDefinition(i));
  }

  const resultItems = items.filter(
    (i) => i.role === 'tool' && !i.pinned && !isToolDefinition(i),
  );
  if (resultItems.length <= maxResults) {
    return [...items];
  }

  const byNewest = [...resultItems].sort((a, b) => b.createdAt - a.createdAt);
  const keepIds = new Set(byNewest.slice(0, maxResults).map((i) => i.id));

  return items.filter(
    (i) =>
      i.pinned ||
      i.role !== 'tool' ||
      isToolDefinition(i) ||
      keepIds.has(i.id),
  );
}

function applyDefinitionTokenEstimates(
  items: readonly ContentItem[],
  estimate: (item: ContentItem) => number,
): ContentItem[] {
  return items.map((item) => {
    if (!isToolDefinition(item)) {
      return item;
    }
    const t = toTokenCount(estimate(item));
    if (item.tokens !== undefined && Number(item.tokens) === t) {
      return item;
    }
    return { ...item, tokens: t };
  });
}

function applyToolResultTruncation(
  items: readonly ContentItem[],
  enabled: boolean,
  resultMaxTokens: number,
): ContentItem[] {
  if (!enabled) {
    return [...items];
  }
  return items.map((item) => {
    if (item.role !== 'tool' || isToolDefinition(item)) {
      return item;
    }
    if (typeof item.content !== 'string') {
      return item;
    }
    const cur = currentTokenEstimate(item);
    if (cur <= resultMaxTokens) {
      return item;
    }
    const next = truncateStringToApproxTokens(item.content, resultMaxTokens);
    return {
      ...item,
      content: next,
      tokens: toTokenCount(estimateTokensFromText(next)),
      metadata: {
        ...(item.metadata ?? {}),
        'tools.truncated': true,
        'tools.originalTokenEstimate': cur,
      },
    };
  });
}

/**
 * Injects a `tools` slot when missing and normalizes tool definitions + results before overflow.
 */
export function toolsPlugin(options: ToolsPluginOptions = {}): ContextPlugin {
  const slotName = options.slotName ?? 'tools';
  const maxToolResults = options.maxToolResults ?? 10;
  const truncateLargeResults = options.truncateLargeResults ?? true;
  const resultMaxTokens = options.resultMaxTokens ?? 500;
  const estimateDef = options.estimateDefinitionTokens ?? defaultEstimateDefinitionTokens;
  const defaultSlot = options.defaultSlot ?? { ...AGENT_DEFAULTS.tools };

  return {
    name: PLUGIN_NAME,
    version: VERSION,

    prepareSlots(slots) {
      if (slots[slotName] !== undefined) {
        return slots;
      }
      return { ...slots, [slotName]: { ...defaultSlot } };
    },

    beforeOverflow(slot, items) {
      if (slot !== slotName) {
        return items;
      }
      let out = applyDefinitionTokenEstimates(items, estimateDef);
      out = applyToolResultTruncation(out, truncateLargeResults, resultMaxTokens);
      out = enforceMaxToolResults(out, maxToolResults);
      return out;
    },
  };
}
