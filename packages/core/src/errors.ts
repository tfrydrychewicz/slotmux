/**
 * Error types for slotmux.
 *
 * @packageDocumentation
 */

/**
 * Base error class for all slotmux errors.
 *
 * @see {@link BudgetExceededError}
 * @see {@link ContextOverflowError}
 * @see {@link TokenizerNotFoundError}
 * @see {@link CompressionFailedError}
 * @see {@link SnapshotCorruptedError}
 * @see {@link InvalidConfigError}
 * @see {@link SlotNotFoundError}
 * @see {@link ItemNotFoundError}
 * @see {@link MaxItemsExceededError}
 * @see {@link InvalidBudgetError}
 */
export class SlotmuxError extends Error {
  override readonly name: string = 'SlotmuxError';

  readonly code: string;

  readonly recoverable: boolean;

  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      code?: string;
      recoverable?: boolean;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.code = options?.code ?? 'SLOTMUX_ERROR';
    this.recoverable = options?.recoverable ?? false;
    if (options?.context !== undefined) {
      this.context = options.context;
    }
    Object.setPrototypeOf(this, SlotmuxError.prototype);
  }
}

/**
 * Fixed slots exceed total available budget.
 *
 * @example
 * ```typescript
 * throw new BudgetExceededError('Fixed slots require 15000 tokens but budget is 8000', {
 *   context: { totalBudget: 8000, fixedTotal: 15000 },
 * });
 * ```
 */
export class BudgetExceededError extends SlotmuxError {
  override readonly name = 'BudgetExceededError';

  override readonly code = 'BUDGET_EXCEEDED';

  override readonly recoverable = false;

  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, { ...options, code: 'BUDGET_EXCEEDED', recoverable: false });
    Object.setPrototypeOf(this, BudgetExceededError.prototype);
  }
}

/**
 * Slot percentage budgets are invalid (e.g. sum of percents above 100).
 */
export class InvalidBudgetError extends SlotmuxError {
  override readonly name = 'InvalidBudgetError';

  override readonly code = 'INVALID_BUDGET';

  override readonly recoverable = false;

  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, { ...options, code: 'INVALID_BUDGET', recoverable: false });
    Object.setPrototypeOf(this, InvalidBudgetError.prototype);
  }
}

/**
 * A slot with overflow: 'error' exceeded its budget.
 *
 * @example
 * ```typescript
 * throw new ContextOverflowError('Slot history exceeded budget', {
 *   context: { slot: 'history', budgetTokens: 5000, actualTokens: 6200 },
 * });
 * ```
 */
export class ContextOverflowError extends SlotmuxError {
  override readonly name = 'ContextOverflowError';

  override readonly code = 'CONTEXT_OVERFLOW';

  override readonly recoverable = true;

  readonly slot: string;

  readonly budgetTokens: number;

  readonly actualTokens: number;

  constructor(
    message: string,
    options: {
      slot: string;
      budgetTokens: number;
      actualTokens: number;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      ...options,
      code: 'CONTEXT_OVERFLOW',
      recoverable: true,
      context: {
        ...options.context,
        slot: options.slot,
        budgetTokens: options.budgetTokens,
        actualTokens: options.actualTokens,
      },
    });
    this.slot = options.slot;
    this.budgetTokens = options.budgetTokens;
    this.actualTokens = options.actualTokens;
    Object.setPrototypeOf(this, ContextOverflowError.prototype);
  }
}

/**
 * Requested tokenizer is not installed.
 *
 * @example
 * ```typescript
 * throw new TokenizerNotFoundError('Tokenizer cl100k_base not found. Install tiktoken.');
 * ```
 */
export class TokenizerNotFoundError extends SlotmuxError {
  override readonly name = 'TokenizerNotFoundError';

  override readonly code = 'TOKENIZER_NOT_FOUND';

  override readonly recoverable = false;

  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      ...options,
      code: 'TOKENIZER_NOT_FOUND',
      recoverable: false,
    });
    Object.setPrototypeOf(this, TokenizerNotFoundError.prototype);
  }
}

/**
 * Summarization or compression LLM call failed.
 *
 * @example
 * ```typescript
 * throw new CompressionFailedError('Summarization timed out', {
 *   context: { fallbackStrategy: 'truncate' },
 * });
 * ```
 */
export class CompressionFailedError extends SlotmuxError {
  override readonly name = 'CompressionFailedError';

  override readonly code = 'COMPRESSION_FAILED';

  override readonly recoverable = true;

  readonly fallbackStrategy: string;

  constructor(
    message: string,
    options: {
      fallbackStrategy: string;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      ...options,
      code: 'COMPRESSION_FAILED',
      recoverable: true,
      context: { ...options.context, fallbackStrategy: options.fallbackStrategy },
    });
    this.fallbackStrategy = options.fallbackStrategy;
    Object.setPrototypeOf(this, CompressionFailedError.prototype);
  }
}

/**
 * Deserialized snapshot fails integrity check.
 *
 * @example
 * ```typescript
 * throw new SnapshotCorruptedError('Checksum mismatch', {
 *   context: { expected: 'abc', actual: 'xyz' },
 * });
 * ```
 */
export class SnapshotCorruptedError extends SlotmuxError {
  override readonly name = 'SnapshotCorruptedError';

  override readonly code = 'SNAPSHOT_CORRUPTED';

  override readonly recoverable = false;

  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      ...options,
      code: 'SNAPSHOT_CORRUPTED',
      recoverable: false,
    });
    Object.setPrototypeOf(this, SnapshotCorruptedError.prototype);
  }
}

/**
 * Configuration validation failed (e.g. Zod validation).
 *
 * @example
 * ```typescript
 * throw new InvalidConfigError('Slot percentages exceed 100%', {
 *   context: { issues: zodError.issues },
 * });
 * ```
 */
export class InvalidConfigError extends SlotmuxError {
  override readonly name = 'InvalidConfigError';

  override readonly code = 'INVALID_CONFIG';

  override readonly recoverable = false;

  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      ...options,
      code: 'INVALID_CONFIG',
      recoverable: false,
    });
    Object.setPrototypeOf(this, InvalidConfigError.prototype);
  }
}

/**
 * Slot name is not registered on the content store.
 */
export class SlotNotFoundError extends SlotmuxError {
  override readonly name = 'SlotNotFoundError';

  override readonly code = 'SLOT_NOT_FOUND';

  override readonly recoverable = true;

  readonly slot: string;

  constructor(
    message: string,
    options: { slot: string; context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      ...options,
      code: 'SLOT_NOT_FOUND',
      recoverable: true,
      context: { ...options.context, slot: options.slot },
    });
    this.slot = options.slot;
    Object.setPrototypeOf(this, SlotNotFoundError.prototype);
  }
}

/**
 * No content item with the given id exists in the slot.
 */
export class ItemNotFoundError extends SlotmuxError {
  override readonly name = 'ItemNotFoundError';

  override readonly code = 'ITEM_NOT_FOUND';

  override readonly recoverable = true;

  readonly slot: string;

  readonly itemId: string;

  constructor(
    message: string,
    options: {
      slot: string;
      itemId: string;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      ...options,
      code: 'ITEM_NOT_FOUND',
      recoverable: true,
      context: {
        ...options.context,
        slot: options.slot,
        itemId: options.itemId,
      },
    });
    this.slot = options.slot;
    this.itemId = options.itemId;
    Object.setPrototypeOf(this, ItemNotFoundError.prototype);
  }
}

/**
 * {@link SlotConfig.maxItems} would be exceeded.
 */
export class MaxItemsExceededError extends SlotmuxError {
  override readonly name = 'MaxItemsExceededError';

  override readonly code = 'MAX_ITEMS_EXCEEDED';

  override readonly recoverable = true;

  readonly slot: string;

  readonly maxItems: number;

  readonly currentCount: number;

  constructor(
    message: string,
    options: {
      slot: string;
      maxItems: number;
      currentCount: number;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      ...options,
      code: 'MAX_ITEMS_EXCEEDED',
      recoverable: true,
      context: {
        ...options.context,
        slot: options.slot,
        maxItems: options.maxItems,
        currentCount: options.currentCount,
      },
    });
    this.slot = options.slot;
    this.maxItems = options.maxItems;
    this.currentCount = options.currentCount;
    Object.setPrototypeOf(this, MaxItemsExceededError.prototype);
  }
}
