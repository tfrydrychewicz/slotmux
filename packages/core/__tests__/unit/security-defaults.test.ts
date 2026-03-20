/**
 * Phase 13.1 — security defaults (§19.1).
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SLOT_MAX_ITEMS,
  effectiveSlotMaxItems,
  slotItemsNearLimitThreshold,
} from '../../src/config/security-defaults.js';

describe('security-defaults (Phase 13.1 — §19.1)', () => {
  it('DEFAULT_SLOT_MAX_ITEMS is 10_000', () => {
    expect(DEFAULT_SLOT_MAX_ITEMS).toBe(10_000);
  });

  it('effectiveSlotMaxItems uses explicit maxItems or default', () => {
    expect(
      effectiveSlotMaxItems({
        priority: 10,
        budget: { fixed: 1 },
        maxItems: 42,
      }),
    ).toBe(42);
    expect(
      effectiveSlotMaxItems({
        priority: 10,
        budget: { fixed: 1 },
      }),
    ).toBe(DEFAULT_SLOT_MAX_ITEMS);
  });

  it('slotItemsNearLimitThreshold is floor(0.8 * max), minimum 1', () => {
    expect(slotItemsNearLimitThreshold(10)).toBe(8);
    expect(slotItemsNearLimitThreshold(5)).toBe(4);
    expect(slotItemsNearLimitThreshold(1)).toBe(1);
  });
});
