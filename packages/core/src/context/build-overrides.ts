/**
 * Non-mutating build overrides for {@link Context.build} (§5.6 — Phase 5.6).
 *
 * @packageDocumentation
 */

import {
  validateContextConfig,
  type ParsedContextConfig,
} from '../config/validator.js';
import { InvalidConfigError } from '../errors.js';
import type { ContextSnapshot } from '../snapshot/context-snapshot.js';
import type { ContextConfig, ProviderId, SlotConfig } from '../types/config.js';
import type { ProviderAdapter } from '../types/provider.js';

/**
 * Temporary overrides for a single {@link Context.build} call (does not mutate stored config).
 */
export type ContextBuildOverrides = {
  /** Overrides `reserveForResponse` for this build only. */
  readonly reserveForResponse?: number;
  /** Overrides `maxTokens` for this build only. */
  readonly maxTokens?: number;
  /**
   * Per-slot shallow merge into {@link SlotConfig} for this build only
   * (e.g. `{ history: { budget: { fixed: 500 } } }`).
   */
  readonly slots?: Record<string, Partial<SlotConfig>>;
};

/**
 * Options for {@link Context.build} — overrides plus orchestrator extras.
 */
export type ContextBuildParams = {
  readonly overrides?: ContextBuildOverrides;
  readonly providerAdapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  readonly previousSnapshot?: ContextSnapshot;
  readonly structuralSharing?: boolean;
};

/**
 * Merges `overrides` into a copy of `base` and re-validates. Does not mutate `base`.
 */
export function mergeParsedConfigForBuild(
  base: ParsedContextConfig,
  overrides: ContextBuildOverrides | undefined,
): ParsedContextConfig {
  if (overrides === undefined) {
    return base;
  }

  const touchReserve = overrides.reserveForResponse !== undefined;
  const touchMax = overrides.maxTokens !== undefined;
  const touchSlots =
    overrides.slots !== undefined && Object.keys(overrides.slots).length > 0;

  if (!touchReserve && !touchMax && !touchSlots) {
    return base;
  }

  const merged: ParsedContextConfig = { ...base };

  if (touchReserve) {
    merged.reserveForResponse = overrides.reserveForResponse;
  }
  if (touchMax) {
    merged.maxTokens = overrides.maxTokens;
  }
  if (touchSlots) {
    const baseSlots = base.slots as Record<string, SlotConfig>;
    const nextSlots: Record<string, SlotConfig> = { ...baseSlots };
    for (const [name, partial] of Object.entries(overrides.slots!)) {
      const cur = baseSlots[name];
      if (cur === undefined) {
        throw new InvalidConfigError(`Build override: unknown slot "${name}"`, {
          context: { slot: name },
        });
      }
      nextSlots[name] = { ...cur, ...partial } as SlotConfig;
    }
    merged.slots = nextSlots as ParsedContextConfig['slots'];
  }

  return validateContextConfig(merged as unknown as ContextConfig);
}
