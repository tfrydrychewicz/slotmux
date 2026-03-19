/**
 * Branded types for type-safe primitives.
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';

/** Token count — always a non-negative integer */
export type TokenCount = number & { readonly __brand: unique symbol };

/** Slot priority (1–100, higher = more important, survives overflow longer) */
export type SlotPriority = number & { readonly __brand: unique symbol };

/** Unique identifier for a content item within a slot */
export type ContentId = string & { readonly __brand: unique symbol };

/**
 * Creates a TokenCount from a number.
 *
 * @param value - Non-negative integer
 * @returns Branded TokenCount
 * @throws {RangeError} If value is negative or not an integer
 *
 * @example
 * ```typescript
 * const tokens = toTokenCount(150);
 * ```
 */
export function toTokenCount(value: number): TokenCount {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `TokenCount must be a non-negative integer, got ${value}`,
    );
  }
  return value as TokenCount;
}

/**
 * Type guard for TokenCount.
 *
 * @param value - Value to check
 * @returns True if value is a valid TokenCount (non-negative integer)
 */
export function isTokenCount(value: unknown): value is TokenCount {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Creates a SlotPriority from a number.
 *
 * @param value - Integer in range 1–100
 * @returns Branded SlotPriority
 * @throws {RangeError} If value is outside 1–100
 *
 * @example
 * ```typescript
 * const priority = toSlotPriority(50);
 * ```
 */
export function toSlotPriority(value: number): SlotPriority {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError(
      `SlotPriority must be an integer between 1 and 100, got ${value}`,
    );
  }
  return value as SlotPriority;
}

/**
 * Type guard for SlotPriority.
 *
 * @param value - Value to check
 * @returns True if value is a valid SlotPriority (1–100)
 */
export function isSlotPriority(value: unknown): value is SlotPriority {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100
  );
}

/**
 * Creates a ContentId from a string.
 *
 * @param value - Non-empty string identifier
 * @returns Branded ContentId
 * @throws {RangeError} If value is empty
 *
 * @example
 * ```typescript
 * const id = toContentId('msg-123');
 * ```
 */
export function toContentId(value: string): ContentId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError('ContentId must be a non-empty string');
  }
  return value as ContentId;
}

/**
 * Generates a new unique ContentId using nanoid.
 *
 * @returns Branded ContentId
 *
 * @example
 * ```typescript
 * const id = createContentId();
 * ```
 */
export function createContentId(): ContentId {
  return nanoid() as ContentId;
}

/**
 * Type guard for ContentId.
 *
 * @param value - Value to check
 * @returns True if value is a valid ContentId (non-empty string)
 */
export function isContentId(value: unknown): value is ContentId {
  return typeof value === 'string' && value.length > 0;
}
