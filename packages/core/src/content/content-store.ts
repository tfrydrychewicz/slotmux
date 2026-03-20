/**
 * In-memory storage for {@link ContentItem} values per slot (§20 — Phase 3.1).
 *
 * @packageDocumentation
 */

import {
  effectiveSlotMaxItems,
  slotItemsNearLimitThreshold,
} from '../config/security-defaults.js';
import {
  InvalidConfigError,
  ItemNotFoundError,
  MaxItemsExceededError,
  SlotNotFoundError,
} from '../errors.js';
import { createContentId, type ContentId, type TokenCount } from '../types/branded.js';
import type { SlotConfig } from '../types/config.js';
import type { ContentItem, MessageRole } from '../types/content.js';

/** Fields required to build a {@link ContentItem} (id / createdAt optional). */
export type CreateContentItemParams = {
  slot: string;
  role: MessageRole;
  content: ContentItem['content'];
  name?: string;
  toolCallId?: string;
  toolUses?: ContentItem['toolUses'];
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  ephemeral?: boolean;
  tokens?: TokenCount;
  summarizes?: ContentId[];
  /** Per-message locale for lossless compression (§8.3). */
  losslessLocale?: string;
  /** When omitted, a nanoid is generated. */
  id?: ContentId;
  /** When omitted, `Date.now()` is used. */
  createdAt?: number;
};

/**
 * Creates a {@link ContentItem} with auto-generated {@link ContentItem.id} (nanoid) and
 * {@link ContentItem.createdAt} (`Date.now()`), unless overridden.
 */
export function createContentItem(params: CreateContentItemParams): ContentItem {
  const {
    id,
    createdAt,
    slot,
    role,
    content,
    name,
    toolCallId,
    toolUses,
    metadata,
    pinned,
    ephemeral,
    tokens,
    summarizes,
    losslessLocale,
  } = params;
  const item: ContentItem = {
    slot,
    role,
    content,
    id: id ?? createContentId(),
    createdAt: createdAt ?? Date.now(),
  };
  if (name !== undefined) {
    item.name = name;
  }
  if (toolCallId !== undefined) {
    item.toolCallId = toolCallId;
  }
  if (toolUses !== undefined) {
    item.toolUses = toolUses;
  }
  if (metadata !== undefined) {
    item.metadata = metadata;
  }
  if (pinned !== undefined) {
    item.pinned = pinned;
  }
  if (ephemeral !== undefined) {
    item.ephemeral = ephemeral;
  }
  if (tokens !== undefined) {
    item.tokens = tokens;
  }
  if (summarizes !== undefined) {
    item.summarizes = summarizes;
  }
  if (losslessLocale !== undefined) {
    item.losslessLocale = losslessLocale;
  }
  return item;
}

function shallowCopyItem(item: ContentItem): ContentItem {
  return { ...item };
}

/** Optional hooks for {@link ContentStore} (§19.1 — Phase 13.1). */
export type ContentStoreOptions = {
  /**
   * Invoked once when a slot’s item count first reaches the 80% threshold of the effective max
   * (see {@link effectiveSlotMaxItems}).
   */
  readonly onApproachingMaxItems?: (info: {
    readonly slot: string;
    readonly itemCount: number;
    readonly maxItems: number;
  }) => void;
};

/**
 * Per-slot ordered lists of content items, validated against {@link SlotConfig}.
 */
export class ContentStore {
  private readonly slotConfigs: Readonly<Record<string, SlotConfig>>;

  private readonly lists = new Map<string, ContentItem[]>();

  readonly #options: ContentStoreOptions | undefined;

  /**
   * @param slotConfigs — allowed slot names and limits (e.g. from {@link ContextConfig.slots}).
   * @param options — optional callbacks (e.g. approaching max-items warning).
   */
  constructor(slotConfigs: Record<string, SlotConfig>, options?: ContentStoreOptions) {
    this.slotConfigs = { ...slotConfigs };
    this.#options = options;
    for (const name of Object.keys(this.slotConfigs)) {
      this.lists.set(name, []);
    }
  }

  /** Registered slot names (from the constructor config). */
  get registeredSlots(): string[] {
    return Object.keys(this.slotConfigs);
  }

  private requireSlot(slot: string): void {
    if (!(slot in this.slotConfigs)) {
      throw new SlotNotFoundError(`Unknown slot: ${slot}`, { slot });
    }
  }

  private listFor(slot: string): ContentItem[] {
    const list = this.lists.get(slot);
    if (!list) {
      throw new SlotNotFoundError(`Unknown slot: ${slot}`, { slot });
    }
    return list;
  }

  /**
   * Appends an item to `slot`. Validates the slot exists and `item.slot === slot`.
   * Enforces {@link SlotConfig.maxItems} when set.
   */
  addItem(slot: string, item: ContentItem): void {
    this.requireSlot(slot);
    if (item.slot !== slot) {
      throw new InvalidConfigError(
        `Item.slot "${item.slot}" does not match addItem slot "${slot}"`,
        {
          context: { itemSlot: item.slot, addSlot: slot },
        },
      );
    }

    const list = this.listFor(slot);
    const cfg = this.slotConfigs[slot]!;
    const max = effectiveSlotMaxItems(cfg);
    if (list.length >= max) {
      throw new MaxItemsExceededError(
        `Slot "${slot}" is at maxItems (${max})`,
        { slot, maxItems: max, currentCount: list.length },
      );
    }

    list.push(shallowCopyItem(item));

    const threshold = slotItemsNearLimitThreshold(max);
    if (
      this.#options?.onApproachingMaxItems !== undefined &&
      list.length === threshold
    ) {
      this.#options.onApproachingMaxItems({
        slot,
        itemCount: list.length,
        maxItems: max,
      });
    }
  }

  /**
   * Returns a shallow copy of items in insertion order.
   */
  getItems(slot: string): ContentItem[] {
    this.requireSlot(slot);
    return this.listFor(slot).map(shallowCopyItem);
  }

  /**
   * Removes the first item with `id` in `slot` and returns a shallow copy of it.
   */
  removeItem(slot: string, id: ContentId): ContentItem {
    this.requireSlot(slot);
    const list = this.listFor(slot);
    const index = list.findIndex((i) => i.id === id);
    if (index === -1) {
      throw new ItemNotFoundError(`No item "${id}" in slot "${slot}"`, {
        slot,
        itemId: id,
      });
    }
    const [removed] = list.splice(index, 1);
    return shallowCopyItem(removed!);
  }

  /**
   * Sets `pinned: true` on the item with `id` in `slot`.
   */
  pinItem(slot: string, id: ContentId): void {
    this.requireSlot(slot);
    const list = this.listFor(slot);
    const item = list.find((i) => i.id === id);
    if (!item) {
      throw new ItemNotFoundError(`No item "${id}" in slot "${slot}"`, {
        slot,
        itemId: id,
      });
    }
    item.pinned = true;
  }

  /**
   * Returns a shallow copy of the item with `id` in `slot`, or throws if missing.
   */
  getItem(slot: string, id: ContentId): ContentItem {
    this.requireSlot(slot);
    const list = this.listFor(slot);
    const item = list.find((i) => i.id === id);
    if (!item) {
      throw new ItemNotFoundError(`No item "${id}" in slot "${slot}"`, {
        slot,
        itemId: id,
      });
    }
    return shallowCopyItem(item);
  }

  /**
   * Sets `ephemeral: true` on the item with `id` in `slot` (§6.3 — Phase 5.1).
   */
  markItemEphemeral(slot: string, id: ContentId): void {
    this.requireSlot(slot);
    const list = this.listFor(slot);
    const item = list.find((i) => i.id === id);
    if (!item) {
      throw new ItemNotFoundError(`No item "${id}" in slot "${slot}"`, {
        slot,
        itemId: id,
      });
    }
    item.ephemeral = true;
  }

  /**
   * Removes every item with `ephemeral: true` from every registered slot (order preserved for survivors).
   */
  clearEphemeral(): void {
    for (const slot of this.lists.keys()) {
      const list = this.lists.get(slot)!;
      const kept = list.filter((i) => !i.ephemeral);
      list.length = 0;
      list.push(...kept);
    }
  }

  /**
   * Replaces every registered slot’s items from a checkpoint snapshot (§12.2 — Phase 9.3).
   * Each item’s {@link ContentItem.slot} must match its bucket.
   *
   * @throws {@link InvalidConfigError} When a registered slot is missing from `snapshot` or an item has wrong `slot`.
   */
  replaceAllSlots(snapshot: Readonly<Record<string, readonly ContentItem[]>>): void {
    for (const slot of Object.keys(this.slotConfigs)) {
      const raw = snapshot[slot];
      if (raw === undefined) {
        throw new InvalidConfigError(`replaceAllSlots: snapshot missing registered slot "${slot}"`, {
          context: { slot, phase: '9.3' },
        });
      }
      const list = this.listFor(slot);
      const max = effectiveSlotMaxItems(this.slotConfigs[slot]!);
      if (raw.length > max) {
        throw new MaxItemsExceededError(
          `replaceAllSlots: slot "${slot}" has ${raw.length} items, exceeds maxItems (${max})`,
          { slot, maxItems: max, currentCount: raw.length },
        );
      }
      list.length = 0;
      for (const item of raw) {
        if (item.slot !== slot) {
          throw new InvalidConfigError(
            `replaceAllSlots: item.slot "${item.slot}" does not match bucket "${slot}"`,
            {
              context: { itemSlot: item.slot, bucket: slot, phase: '9.3' },
            },
          );
        }
        list.push(shallowCopyItem(item));
      }
    }
  }
}
