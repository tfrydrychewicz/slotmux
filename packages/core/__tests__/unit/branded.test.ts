import { describe, expect, it } from 'vitest';

import {
  toTokenCount,
  isTokenCount,
  toSlotPriority,
  isSlotPriority,
  toContentId,
  createContentId,
  isContentId,
} from '../../src/types/branded.js';

describe('TokenCount', () => {
  it('creates TokenCount from valid non-negative integer', () => {
    expect(toTokenCount(0)).toBe(0);
    expect(toTokenCount(1)).toBe(1);
    expect(toTokenCount(1000)).toBe(1000);
  });

  it('throws on negative number', () => {
    expect(() => toTokenCount(-1)).toThrow(RangeError);
    expect(() => toTokenCount(-100)).toThrow(RangeError);
  });

  it('throws on non-integer', () => {
    expect(() => toTokenCount(1.5)).toThrow(RangeError);
    expect(() => toTokenCount(NaN)).toThrow(RangeError);
  });

  it('isTokenCount returns true for valid values', () => {
    expect(isTokenCount(0)).toBe(true);
    expect(isTokenCount(100)).toBe(true);
  });

  it('isTokenCount returns false for invalid values', () => {
    expect(isTokenCount(-1)).toBe(false);
    expect(isTokenCount(1.5)).toBe(false);
    expect(isTokenCount('100')).toBe(false);
    expect(isTokenCount(null)).toBe(false);
    expect(isTokenCount(undefined)).toBe(false);
  });
});

describe('SlotPriority', () => {
  it('creates SlotPriority from valid 1–100 integer', () => {
    expect(toSlotPriority(1)).toBe(1);
    expect(toSlotPriority(50)).toBe(50);
    expect(toSlotPriority(100)).toBe(100);
  });

  it('throws on value below 1', () => {
    expect(() => toSlotPriority(0)).toThrow(RangeError);
    expect(() => toSlotPriority(-1)).toThrow(RangeError);
  });

  it('throws on value above 100', () => {
    expect(() => toSlotPriority(101)).toThrow(RangeError);
    expect(() => toSlotPriority(200)).toThrow(RangeError);
  });

  it('throws on non-integer', () => {
    expect(() => toSlotPriority(50.5)).toThrow(RangeError);
  });

  it('isSlotPriority returns true for valid values', () => {
    expect(isSlotPriority(1)).toBe(true);
    expect(isSlotPriority(100)).toBe(true);
  });

  it('isSlotPriority returns false for invalid values', () => {
    expect(isSlotPriority(0)).toBe(false);
    expect(isSlotPriority(101)).toBe(false);
    expect(isSlotPriority('50')).toBe(false);
    expect(isSlotPriority(null)).toBe(false);
  });
});

describe('ContentId', () => {
  it('creates ContentId from non-empty string', () => {
    const id = toContentId('msg-123');
    expect(id).toBe('msg-123');
  });

  it('throws on empty string', () => {
    expect(() => toContentId('')).toThrow(RangeError);
  });

  it('throws on non-string', () => {
    expect(() => toContentId(null as unknown as string)).toThrow(RangeError);
    expect(() => toContentId(123 as unknown as string)).toThrow(RangeError);
  });

  it('createContentId generates unique ids', () => {
    const id1 = createContentId();
    const id2 = createContentId();
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
  });

  it('isContentId returns true for non-empty strings', () => {
    expect(isContentId('x')).toBe(true);
    expect(isContentId('msg-123')).toBe(true);
  });

  it('isContentId returns false for invalid values', () => {
    expect(isContentId('')).toBe(false);
    expect(isContentId(null)).toBe(false);
    expect(isContentId(123)).toBe(false);
  });
});
