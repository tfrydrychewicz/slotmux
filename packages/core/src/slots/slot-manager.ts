/**
 * Registry of {@link SlotConfig} entries (§20 — Phase 3.2).
 *
 * @packageDocumentation
 */

import { validateSlotConfig } from '../config/validator.js';
import { InvalidConfigError, SlotNotFoundError } from '../errors.js';
import type { SlotConfig } from '../types/config.js';

export type SlotManagerOptions = {
  /**
   * Invoked after a slot is removed from the registry (cascade cleanup hook —
   * e.g. drop mirrored content in a {@link ContentStore}).
   */
  onSlotRemoved?: (name: string) => void;
};

function assertNonEmptySlotName(name: string): void {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new InvalidConfigError('Slot name must be a non-empty string', {
      context: { name },
    });
  }
}

function mergeSlotConfig(
  current: SlotConfig,
  partial: Partial<SlotConfig>,
): SlotConfig {
  const out: SlotConfig = { ...current };
  for (const key of Object.keys(partial) as (keyof SlotConfig)[]) {
    const v = partial[key];
    if (v !== undefined) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/**
 * Mutable registry of named slot configurations with Zod validation.
 */
export class SlotManager {
  private readonly slots = new Map<string, SlotConfig>();

  private readonly options: SlotManagerOptions;

  constructor(options?: SlotManagerOptions) {
    this.options = options ?? {};
  }

  /** Number of registered slots. */
  get size(): number {
    return this.slots.size;
  }

  /**
   * Registers a slot. Validates `config` with {@link slotConfigSchema}.
   *
   * @throws {@link InvalidConfigError} If the name is invalid, the slot already exists, or config fails validation
   */
  registerSlot(name: string, config: unknown): void {
    assertNonEmptySlotName(name);
    if (this.slots.has(name)) {
      throw new InvalidConfigError(`Slot "${name}" is already registered`, {
        context: { slot: name },
      });
    }
    const parsed = validateSlotConfig(config);
    this.slots.set(name, parsed as SlotConfig);
  }

  /**
   * Returns a shallow copy of the config, or `undefined` if the slot is not registered.
   */
  getSlot(name: string): SlotConfig | undefined {
    assertNonEmptySlotName(name);
    const c = this.slots.get(name);
    return c ? { ...c } : undefined;
  }

  /**
   * All slots sorted by **descending** {@link SlotConfig.priority}, then by name ascending.
   */
  listSlots(): Array<{ name: string; config: SlotConfig }> {
    return [...this.slots.entries()]
      .map(([n, c]) => ({ name: n, config: { ...c } }))
      .sort((a, b) => {
        const dp = b.config.priority - a.config.priority;
        if (dp !== 0) {
          return dp;
        }
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Merges `partial` onto the existing config and re-validates the result.
   *
   * @throws {@link SlotNotFoundError} If the slot is not registered
   * @throws {@link InvalidConfigError} If the merged config is invalid
   */
  updateSlot(name: string, partial: Partial<SlotConfig>): void {
    assertNonEmptySlotName(name);
    const current = this.slots.get(name);
    if (!current) {
      throw new SlotNotFoundError(`Unknown slot: ${name}`, { slot: name });
    }
    const merged = mergeSlotConfig(current, partial);
    const parsed = validateSlotConfig(merged);
    this.slots.set(name, parsed as SlotConfig);
  }

  /**
   * Removes a slot from the registry and runs {@link SlotManagerOptions.onSlotRemoved}.
   *
   * @throws {@link SlotNotFoundError} If the slot is not registered
   */
  removeSlot(name: string): void {
    assertNonEmptySlotName(name);
    if (!this.slots.has(name)) {
      throw new SlotNotFoundError(`Unknown slot: ${name}`, { slot: name });
    }
    this.slots.delete(name);
    this.options.onSlotRemoved?.(name);
  }

  /**
   * Snapshot suitable for {@link ContentStore} or {@link ContextConfig.slots}.
   */
  toConfigRecord(): Record<string, SlotConfig> {
    const o: Record<string, SlotConfig> = {};
    for (const [k, v] of this.slots) {
      o[k] = { ...v };
    }
    return o;
  }
}
