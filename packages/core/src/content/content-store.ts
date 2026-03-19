/**
 * In-memory storage for {@link ContentItem} values per slot (§20 — Phase 3.1).
 *
 * @packageDocumentation
 */

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
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  ephemeral?: boolean;
  tokens?: TokenCount;
  summarizes?: ContentId[];
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
  const { id, createdAt, ...rest } = params;
  return {
    ...rest,
    id: id ?? createContentId(),
    createdAt: createdAt ?? Date.now(),
  };
}

function shallowCopyItem(item: ContentItem): ContentItem {
  return { ...item };
}

/**
 * Per-slot ordered lists of content items, validated against {@link SlotConfig}.
 */
export class ContentStore {
  private readonly slotConfigs: Readonly<Record<string, SlotConfig>>;

  private readonly lists = new Map<string, ContentItem[]>();

  /**
   * @param slotConfigs — allowed slot names and limits (e.g. from {@link ContextConfig.slots}).
   */
  constructor(slotConfigs: Record<string, SlotConfig>) {
    this.slotConfigs = { ...slotConfigs };
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
    const max = this.slotConfigs[slot]!.maxItems;
    if (max !== undefined && list.length >= max) {
      throw new MaxItemsExceededError(
        `Slot "${slot}" is at maxItems (${max})`,
        { slot, maxItems: max, currentCount: list.length },
      );
    }

    list.push(shallowCopyItem(item));
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
}
