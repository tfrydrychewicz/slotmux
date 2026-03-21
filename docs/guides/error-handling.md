# Error handling

Slotmux uses a structured error hierarchy so you can catch specific failures, inspect diagnostic context, and decide whether to retry or fail. Every error extends `SlotmuxError` with a `code`, `recoverable` flag, and optional `context` object.

## Error hierarchy

```
SlotmuxError (base)
├── BudgetExceededError        BUDGET_EXCEEDED         recoverable: false
├── InvalidBudgetError         INVALID_BUDGET          recoverable: false
├── ContextOverflowError       CONTEXT_OVERFLOW        recoverable: true
├── TokenizerNotFoundError     TOKENIZER_NOT_FOUND     recoverable: false
├── CompressionFailedError     COMPRESSION_FAILED      recoverable: true
├── SnapshotCorruptedError     SNAPSHOT_CORRUPTED      recoverable: false
├── InvalidConfigError         INVALID_CONFIG          recoverable: false
├── SlotNotFoundError          SLOT_NOT_FOUND          recoverable: false
├── ItemNotFoundError          ITEM_NOT_FOUND          recoverable: false
└── MaxItemsExceededError      MAX_ITEMS_EXCEEDED      recoverable: false
```

## The base class

```typescript
class SlotmuxError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;
}
```

| Field | Purpose |
| --- | --- |
| `code` | Machine-readable error code (e.g. `'BUDGET_EXCEEDED'`) |
| `recoverable` | `true` if the caller can retry or fall back without data loss |
| `context` | Diagnostic details — slot name, budget tokens, actual tokens, etc. |

All errors support `cause` chaining:

```typescript
throw new SlotmuxError('Something failed', { cause: originalError });
```

## Error types in detail

### BudgetExceededError

**When:** Fixed-budget slots collectively exceed the total model budget. This is a configuration error — the math doesn't work.

```typescript
try {
  createContext({
    model: 'gpt-5.4-mini',
    maxTokens: 10_000,
    slots: {
      system: { priority: 100, budget: { fixed: 6000 } },
      rag: { priority: 80, budget: { fixed: 6000 } },
      // Fixed budgets sum to 12000 > 10000
    },
  });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(err.message); // "Fixed slot budgets exceed total budget"
    console.error(err.context); // { totalBudget: 10000, fixedTotal: 12000 }
  }
}
```

**Recovery:** Fix the configuration — reduce fixed budgets or increase `maxTokens`.

### ContextOverflowError

**When:** A slot with `overflow: 'error'` exceeds its budget. This is recoverable — the build can proceed if you handle the overflow differently.

```typescript
try {
  await ctx.build();
} catch (err) {
  if (err instanceof ContextOverflowError) {
    console.warn(`Slot "${err.slot}" overflowed: ${err.actualTokens} > ${err.budgetTokens}`);
    // Option 1: Remove old content and retry
    // Option 2: Switch to a larger model
    // Option 3: Increase the slot's budget
  }
}
```

**Recovery:** Remove content from the slot, increase its budget, or switch the overflow strategy to `'truncate'`.

### TokenizerNotFoundError

**When:** The model requires a tokenizer whose peer dependency isn't installed.

```typescript
// gpt-tokenizer not installed
createContext({ model: 'gpt-5.4' });
// → TokenizerNotFoundError: Tokenizer "o200k_base" requires peer dependency "gpt-tokenizer"
```

**Recovery:** Install the required package, or set `strictTokenizerPeers: false` to fall back to character estimation.

### CompressionFailedError

**When:** A compression strategy (summarize, compress) fails — typically because an LLM call for summarization returned an error or timed out.

```typescript
try {
  await ctx.build();
} catch (err) {
  if (err instanceof CompressionFailedError) {
    // The fallback chain handles this automatically,
    // but if you're using a direct overflow strategy, catch it here
  }
}
```

**Recovery:** The fallback chain catches this automatically and proceeds to the next strategy. If you're using `'summarize'` directly (not `'fallback-chain'`), catch it and fall back manually.

### Provider rate limit errors

All provider factories (`openai()`, `anthropic()`, `google()`, `mistral()`, `ollama()`) use an **adaptive rate limiter** to handle HTTP 429 (rate limit) responses. The limiter coordinates across concurrent summarization calls using AIMD (Additive Increase / Multiplicative Decrease) congestion control:

- **On 429** — halves effective concurrency and pauses all pending calls for the `Retry-After` duration, preventing thundering-herd retries.
- **On success** — slowly increases concurrency by 1, recovering throughput after the rate limit clears.

Retry wait time is resolved from the `Retry-After` response header, body text hints like `"try again in 1.5s"`, or a 1-second default. Up to 5 retry attempts are made per call by default.

- **`ProviderRateLimitError`** — Thrown when all retry attempts are exhausted. The adaptive limiter already reduces parallelism automatically; if you still see this, increase `maxRetries` in the provider options.
- **`OpenAIApiError`** — Non-retryable OpenAI API errors (401 unauthorized, 400 bad request, 500 server error). These propagate immediately without retry.

Both error types are exported from `@slotmux/providers`. When using `overflow: 'summarize'` directly, catch them in your `build()` call:

```typescript
import { ProviderRateLimitError, OpenAIApiError } from '@slotmux/providers';

try {
  await ctx.build();
} catch (err) {
  if (err instanceof ProviderRateLimitError) {
    // All retries exhausted — the limiter already reduced concurrency
  }
  if (err instanceof OpenAIApiError) {
    // API key invalid, model not found, etc. (OpenAI-specific)
  }
}
```

You can configure the retry count per provider:

```typescript
openai({ apiKey: '...', maxRetries: 10 })   // 10 retries with adaptive backoff
anthropic({ apiKey: '...', maxRetries: 0 }) // no retries, fail immediately on 429
```

### SnapshotCorruptedError

**When:** `ContextSnapshot.deserialize()` detects a checksum mismatch.

```typescript
try {
  const snapshot = ContextSnapshot.deserialize(data);
} catch (err) {
  if (err instanceof SnapshotCorruptedError) {
    // Data was corrupted in transit or storage
    // Discard and rebuild from source
  }
}
```

**Recovery:** Discard the corrupted data and rebuild the context from the original source.

### InvalidConfigError

**When:** Configuration validation fails — invalid slot definitions, missing required fields, incompatible options.

**Recovery:** Fix the configuration. Check the error's `context` field for specifics.

### SlotNotFoundError / ItemNotFoundError

**When:** You reference a slot or item that doesn't exist.

```typescript
ctx.push('nonexistent', [{ content: 'Hello', role: 'user' }]);
// → SlotNotFoundError
```

**Recovery:** Check the slot name. Use `ctx.registeredSlots` to list valid slot names.

### MaxItemsExceededError

**When:** A slot reaches its `maxItems` limit (default 10,000).

**Recovery:** Remove old items, increase `maxItems`, or enable an overflow strategy that evicts items before the limit is reached.

## The fallback chain

When a slot uses `overflow: 'fallback-chain'` (or when the engine builds the default chain), strategies are tried in order:

```
1. Summarize  → if CompressionFailedError, skip to next
2. Compress   → if CompressionFailedError, skip to next
3. Truncate   → always succeeds (removes items until within budget)
4. Error      → throws ContextOverflowError if still over budget
```

Each step:
- Runs the strategy with the current items and budget.
- If the result fits within budget, stops.
- If the strategy throws a `CompressionFailedError` or `InvalidConfigError`, logs a warning and continues.
- Passes the (possibly partially reduced) items to the next step.

After truncation, if items still exceed the budget (e.g. a single item is larger than the entire budget), the error step throws `ContextOverflowError`.

## Designing resilient configurations

### Use flex budgets for non-critical slots

Flex slots absorb budget pressure. When the context is tight, they shrink gracefully:

```typescript
history: {
  priority: 50,
  budget: { flex: true },
  overflow: 'sliding-window',
}
```

### Reserve error overflow for critical slots only

`overflow: 'error'` should only be used on slots that **must** contain all their content (e.g. system instructions). For everything else, use a strategy that degrades gracefully:

```typescript
system: { overflow: 'error' },      // Must fit — fail loudly if it doesn't
history: { overflow: 'summarize' },  // Compress under pressure
rag: { overflow: 'truncate' },       // Drop oldest documents if needed
```

### Catch and adapt

```typescript
import {
  ContextOverflowError,
  CompressionFailedError,
} from 'slotmux';

async function buildWithFallback(ctx: Context) {
  try {
    return await ctx.build();
  } catch (err) {
    if (err instanceof ContextOverflowError) {
      // System prompt too large for this model — try a model with bigger context
      console.warn(`Overflow in slot "${err.slot}", switching to larger model`);
      return await ctx.build({
        overrides: { maxTokens: 200_000 },
      });
    }
    throw err;
  }
}
```

### Check `recoverable` for generic handling

```typescript
try {
  await ctx.build();
} catch (err) {
  if (err instanceof SlotmuxError) {
    if (err.recoverable) {
      console.warn(`Recoverable error: ${err.message}`);
      // Retry with adjusted parameters
    } else {
      console.error(`Fatal error: ${err.code} — ${err.message}`);
      // Report and abort
    }
  }
}
```

## Next

- [Overflow concept](/concepts/overflow) — strategies and how they interact with errors.
- [Compression concept](/concepts/compression) — the strategies behind the fallback chain.
- [Performance tuning](./performance-tuning) — optimizing build performance.
