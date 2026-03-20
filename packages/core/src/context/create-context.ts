/**
 * Factory for validated {@link ContextConfig} with presets, model registry inference (§6.1, §7.3 — Phase 5.3).
 *
 * @packageDocumentation
 */

import {
  resolveModel,
  inferProviderFromModelId,
  type ModelRegistryEntry,
} from '../config/model-registry.js';
import { assertTokenizerPeersAvailable } from '../config/peer-resolve.js';
import { CONTEXT_PRESETS, type ContextPresetId } from '../config/presets.js';
import {
  validateContextConfig,
  type ParsedContextConfig,
} from '../config/validator.js';
import type { ContextConfig, ModelId, SlotConfig } from '../types/config.js';
import type { ContextPlugin } from '../types/plugin.js';

/**
 * Options for {@link createContext} — `preset` selects defaults; explicit `slots` override by name.
 * Registry inference fills `maxTokens`, `provider.provider`, and `tokenizer.name` when omitted.
 */
export type CreateContextOptions = Omit<ContextConfig, 'slots'> & {
  slots?: Record<string, SlotConfig>;
  /** When set, start from that preset’s slots unless `slots` alone is provided. */
  preset?: ContextPresetId;
  /**
   * When true (default), verify an npm peer exists for known {@link TokenizerConfig.name} values
   * (e.g. `o200k_base` → `gpt-tokenizer`). Set false in browsers or sandboxes without peers.
   */
  strictTokenizerPeers?: boolean;
};

/**
 * Resolves `slots` from optional `preset` / `slots` (§7.3).
 *
 * - `slots` only → use `slots`.
 * - `preset` only → use preset layout.
 * - both → shallow merge `{ ...preset, ...slots }` (per-slot keys in `slots` win).
 * - neither → {@link CHAT_DEFAULTS} (default layout when omitted).
 */
export function resolveContextSlots(options: {
  preset?: ContextPresetId;
  slots?: Record<string, SlotConfig>;
}): Record<string, SlotConfig> {
  const { preset, slots: override } = options;

  if (override !== undefined && preset === undefined) {
    return { ...override };
  }

  const base =
    preset !== undefined
      ? { ...CONTEXT_PRESETS[preset] }
      : { ...CONTEXT_PRESETS.chat };

  if (override !== undefined) {
    return { ...base, ...override };
  }

  return base;
}

export interface CreateContextResult {
  /** Validated configuration with `slots` fully resolved and registry defaults applied. */
  readonly config: ParsedContextConfig;
  /** {@link resolveModel} result when a built-in, custom, or prefix rule matched. */
  readonly modelMatch: ModelRegistryEntry | undefined;
  /** Plugin instances from options (identity preserved). */
  readonly plugins: readonly ContextPlugin[];
}

function mergeInferredConfig(
  base: ContextConfig,
  modelId: ModelId,
  match: ModelRegistryEntry | undefined,
): ContextConfig {
  let merged: ContextConfig = { ...base };

  if (merged.maxTokens === undefined && match?.maxTokens !== undefined) {
    merged = { ...merged, maxTokens: match.maxTokens };
  }

  const providerUnset =
    merged.provider === undefined || merged.provider.provider === undefined;
  if (providerUnset) {
    const pid = match?.provider ?? inferProviderFromModelId(modelId);
    if (pid !== undefined) {
      merged = {
        ...merged,
        provider: { ...merged.provider, provider: pid },
      };
    }
  }

  const tokenizerNameUnset =
    merged.tokenizer === undefined || merged.tokenizer.name === undefined;
  if (tokenizerNameUnset && match?.tokenizerName !== undefined) {
    merged = {
      ...merged,
      tokenizer: { ...merged.tokenizer, name: match.tokenizerName },
    };
  }

  return merged;
}

/**
 * Creates a validated {@link ContextConfig} with preset-based or custom slots,
 * {@link MODEL_REGISTRY} inference, and optional tokenizer peer checks.
 * Runs {@link ContextPlugin.prepareSlots} on each plugin (in order) before validation.
 *
 * @throws {@link InvalidConfigError} When Zod validation fails (including cross-slot rules).
 * @throws {@link TokenizerNotFoundError} When `strictTokenizerPeers` is true and no peer resolves for a known tokenizer id.
 */
export function createContext(options: CreateContextOptions): CreateContextResult {
  const {
    preset,
    slots: slotsInput,
    strictTokenizerPeers = true,
    ...rest
  } = options;

  const resolveOpts: { preset?: ContextPresetId; slots?: Record<string, SlotConfig> } =
    {};
  if (preset !== undefined) {
    resolveOpts.preset = preset;
  }
  if (slotsInput !== undefined) {
    resolveOpts.slots = slotsInput;
  }
  let slots = resolveContextSlots(resolveOpts);

  const pluginsForPrepare = (rest.plugins ?? []) as ContextPlugin[];
  for (const p of pluginsForPrepare) {
    if (p.prepareSlots === undefined) {
      continue;
    }
    slots = p.prepareSlots(slots);
  }

  const modelId = rest.model;
  const match = resolveModel(modelId);
  const withSlots: ContextConfig = {
    ...rest,
    slots,
  };
  const merged = mergeInferredConfig(withSlots, modelId, match);

  const parsed = validateContextConfig(merged);

  if (strictTokenizerPeers && parsed.tokenizer?.name !== undefined) {
    assertTokenizerPeersAvailable(parsed.tokenizer.name);
  }

  const plugins = (parsed.plugins ?? []) as ContextPlugin[];

  return {
    config: parsed,
    modelMatch: match,
    plugins,
  };
}
