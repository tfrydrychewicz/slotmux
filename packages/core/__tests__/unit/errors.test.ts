import { describe, expect, it } from 'vitest';

import {
  SlotmuxError,
  BudgetExceededError,
  ContextOverflowError,
  TokenizerNotFoundError,
  CompressionFailedError,
  SnapshotCorruptedError,
  InvalidConfigError,
  InvalidBudgetError,
  SlotNotFoundError,
  ItemNotFoundError,
  MaxItemsExceededError,
} from '../../src/errors.js';

describe('SlotmuxError', () => {
  it('creates error with message and options', () => {
    const err = new SlotmuxError('Test error', {
      code: 'TEST',
      recoverable: true,
      context: { foo: 'bar' },
    });
    expect(err.message).toBe('Test error');
    expect(err.code).toBe('TEST');
    expect(err.recoverable).toBe(true);
    expect(err.context).toEqual({ foo: 'bar' });
    expect(err.name).toBe('SlotmuxError');
  });

  it('is instanceof Error and SlotmuxError', () => {
    const err = new SlotmuxError('Test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SlotmuxError);
  });

  it('preserves cause', () => {
    const cause = new Error('Original');
    const err = new SlotmuxError('Wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('BudgetExceededError', () => {
  it('has correct code and recoverable', () => {
    const err = new BudgetExceededError('Fixed slots exceed budget', {
      context: { totalBudget: 8000, fixedTotal: 15000 },
    });
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.recoverable).toBe(false);
    expect(err.context?.['totalBudget']).toBe(8000);
  });
});

describe('ContextOverflowError', () => {
  it('has slot and token fields', () => {
    const err = new ContextOverflowError('Slot overflowed', {
      slot: 'history',
      budgetTokens: 5000,
      actualTokens: 6200,
    });
    expect(err.code).toBe('CONTEXT_OVERFLOW');
    expect(err.recoverable).toBe(true);
    expect(err.slot).toBe('history');
    expect(err.budgetTokens).toBe(5000);
    expect(err.actualTokens).toBe(6200);
  });
});

describe('TokenizerNotFoundError', () => {
  it('has correct code', () => {
    const err = new TokenizerNotFoundError('cl100k_base not found');
    expect(err.code).toBe('TOKENIZER_NOT_FOUND');
    expect(err.recoverable).toBe(false);
  });
});

describe('CompressionFailedError', () => {
  it('has fallbackStrategy', () => {
    const err = new CompressionFailedError('Summarization failed', {
      fallbackStrategy: 'truncate',
    });
    expect(err.code).toBe('COMPRESSION_FAILED');
    expect(err.recoverable).toBe(true);
    expect(err.fallbackStrategy).toBe('truncate');
  });
});

describe('SnapshotCorruptedError', () => {
  it('has correct code', () => {
    const err = new SnapshotCorruptedError('Checksum mismatch');
    expect(err.code).toBe('SNAPSHOT_CORRUPTED');
    expect(err.recoverable).toBe(false);
  });
});

describe('InvalidConfigError', () => {
  it('has correct code', () => {
    const err = new InvalidConfigError('Slot percentages exceed 100%', {
      context: { issues: [] },
    });
    expect(err.code).toBe('INVALID_CONFIG');
    expect(err.recoverable).toBe(false);
    expect(err.context?.['issues']).toEqual([]);
  });
});

describe('InvalidBudgetError', () => {
  it('has INVALID_BUDGET code', () => {
    const err = new InvalidBudgetError('percents > 100');
    expect(err.code).toBe('INVALID_BUDGET');
    expect(err.recoverable).toBe(false);
  });
});

describe('SlotNotFoundError', () => {
  it('carries slot and recoverable', () => {
    const err = new SlotNotFoundError('missing', { slot: 'foo' });
    expect(err.code).toBe('SLOT_NOT_FOUND');
    expect(err.recoverable).toBe(true);
    expect(err.slot).toBe('foo');
  });
});

describe('ItemNotFoundError', () => {
  it('carries slot and itemId', () => {
    const err = new ItemNotFoundError('nope', {
      slot: 'history',
      itemId: 'id-1',
    });
    expect(err.code).toBe('ITEM_NOT_FOUND');
    expect(err.slot).toBe('history');
    expect(err.itemId).toBe('id-1');
  });
});

describe('MaxItemsExceededError', () => {
  it('carries limits', () => {
    const err = new MaxItemsExceededError('full', {
      slot: 'tiny',
      maxItems: 2,
      currentCount: 2,
    });
    expect(err.code).toBe('MAX_ITEMS_EXCEEDED');
    expect(err.maxItems).toBe(2);
    expect(err.currentCount).toBe(2);
  });
});

describe('Error inheritance', () => {
  it('all errors extend SlotmuxError', () => {
    expect(new BudgetExceededError('x')).toBeInstanceOf(SlotmuxError);
    expect(new ContextOverflowError('x', { slot: 's', budgetTokens: 1, actualTokens: 2 })).toBeInstanceOf(SlotmuxError);
    expect(new TokenizerNotFoundError('x')).toBeInstanceOf(SlotmuxError);
    expect(new CompressionFailedError('x', { fallbackStrategy: 'y' })).toBeInstanceOf(SlotmuxError);
    expect(new SnapshotCorruptedError('x')).toBeInstanceOf(SlotmuxError);
    expect(new InvalidConfigError('x')).toBeInstanceOf(SlotmuxError);
    expect(new InvalidBudgetError('x')).toBeInstanceOf(SlotmuxError);
    expect(new SlotNotFoundError('x', { slot: 's' })).toBeInstanceOf(SlotmuxError);
    expect(new ItemNotFoundError('x', { slot: 's', itemId: 'i' })).toBeInstanceOf(
      SlotmuxError,
    );
    expect(
      new MaxItemsExceededError('x', {
        slot: 's',
        maxItems: 1,
        currentCount: 1,
      }),
    ).toBeInstanceOf(SlotmuxError);
  });
});
