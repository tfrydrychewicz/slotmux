/**
 * Factory for validated {@link ContextConfig} with preset slot layouts (§7.3 — Phase 3.5).
 *
 * @remarks
 * Fluent `ctx.system()` / `ctx.build()` from the README lands with the orchestrator (Phase 5).
 * This entrypoint returns a **resolved, Zod-validated** config you can pass to upcoming APIs.
 *
 * @packageDocumentation
 */

import { CONTEXT_PRESETS, type ContextPresetId } from '../config/presets.js';
import {
  validateContextConfig,
  type ParsedContextConfig,
} from '../config/validator.js';
import type { ContextConfig, SlotConfig } from '../types/config.js';

/** Options for {@link createContext} — `preset` selects defaults; explicit `slots` override by name. */
export type CreateContextOptions = Omit<ContextConfig, 'slots'> & {
  slots?: Record<string, SlotConfig>;
  /** When set, start from that preset’s slots unless `slots` alone is provided. */
  preset?: ContextPresetId;
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
  /** Validated configuration with `slots` fully resolved. */
  readonly config: ParsedContextConfig;
}

/**
 * Creates a validated {@link ContextConfig} with preset-based or custom slots.
 *
 * @throws {@link InvalidConfigError} When Zod validation fails (including cross-slot rules).
 */
export function createContext(options: CreateContextOptions): CreateContextResult {
  const { preset, slots: slotsInput, ...rest } = options;
  // exactOptionalPropertyTypes: never pass `preset: undefined` / `slots: undefined`
  const resolveOpts: { preset?: ContextPresetId; slots?: Record<string, SlotConfig> } =
    {};
  if (preset !== undefined) resolveOpts.preset = preset;
  if (slotsInput !== undefined) resolveOpts.slots = slotsInput;
  const slots = resolveContextSlots(resolveOpts);

  const config: ContextConfig = {
    ...rest,
    slots,
  };

  const parsed = validateContextConfig(config);

  return { config: parsed };
}
