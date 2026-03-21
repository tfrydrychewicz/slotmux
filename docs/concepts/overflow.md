# Overflow

When a slot's content exceeds its token budget, the **overflow engine** kicks in. Each slot can declare its own overflow strategy, and slotmux provides eight built-in strategies plus support for custom functions.

## When overflow runs

Overflow is part of the `build()` pipeline:

```
ctx.build()
  → plugin hooks (beforeBudgetResolve)
  → budget allocation
  → plugin hooks (beforeOverflow)
  → overflow engine          ← here
  → plugin hooks (afterOverflow)
  → compile messages
  → snapshot
```

For each slot, the engine compares `countTokens(content)` against `budgetTokens`. If the content fits, nothing happens. If it exceeds the budget, the slot's overflow strategy runs.

Slots are processed in **priority-ascending** order — the least important slots are trimmed first.

## Built-in strategies

### `truncate`

Removes items from the **beginning** (oldest first / FIFO) until the content fits within budget. Pinned items are skipped.

```typescript
overflow: 'truncate'
```

This is the **default** when no overflow strategy is specified.

### `truncate-latest`

Removes items from the **end** (newest first / LIFO) until the content fits. Pinned items are skipped.

```typescript
overflow: 'truncate-latest'
```

<p align="center">
  <img src="/overflow-truncate.svg" alt="truncate vs truncate-latest strategies" style="max-width: 520px; width: 100%;" />
</p>

### `sliding-window`

Keeps all pinned items plus the last `windowSize` non-pinned items. If the result still exceeds the budget, falls back to FIFO truncation on the kept items.

```typescript
overflow: 'sliding-window',
overflowConfig: {
  windowSize: 20,   // default: 10
}
```

<p align="center">
  <img src="/overflow-sliding-window.svg" alt="sliding-window overflow strategy" style="max-width: 400px; width: 100%;" />
</p>

### `summarize`

Compresses older content using a summarization function. Supports three modes via `overflowConfig.summarizer`:

- `'builtin:progressive'` (default) — Layer-based progressive summarization.
- `'builtin:map-reduce'` — Splits content into chunks, summarizes each, then merges.
- A custom `SummarizerFn` — Your own async function.

```typescript
overflow: 'summarize',
overflowConfig: {
  summarizer: 'builtin:progressive',
  preserveLastN: 5,
}
```

<p align="center">
  <img src="/overflow-summarize.svg" alt="summarize overflow strategy" style="max-width: 440px; width: 100%;" />
</p>

::: tip Auto-wired with provider factories
When you configure `slotmuxProvider` (e.g. `openai({ apiKey })`), the summarize strategy works automatically — the provider factory creates the summarization function for you. No manual wiring needed.

```typescript
import { openai } from '@slotmux/providers';

createContext({
  model: 'gpt-5.4',
  preset: 'chat',   // history slot uses overflow: 'summarize'
  slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY! }),
});
// summarization just works ✓
```

Without a `slotmuxProvider`, you must inject a `progressiveSummarize` implementation manually via the overflow engine options.
:::

### `semantic`

Uses embedding similarity to keep the most relevant items. Requires an `embedFn` in `overflowConfig` and an anchor point to score against.

```typescript
overflow: 'semantic',
overflowConfig: {
  embedFn: async (text) => embeddings.create(text),
  anchorTo: 'lastUserMessage',   // or 'systemPrompt', a string, or a ContentItem
  similarityThreshold: 0.7,
}
```

Items below the similarity threshold are dropped first. Among remaining items, the least similar are evicted until the slot fits within budget.

<p align="center">
  <img src="/overflow-semantic.svg" alt="semantic overflow strategy" style="max-width: 440px; width: 100%;" />
</p>

### `compress`

Applies lossless text compression (stop-word removal, whitespace normalization) via `@slotmux/compression`'s `LosslessCompressor`. The meaning is preserved while reducing token count.

```typescript
overflow: 'compress',
overflowConfig: {
  losslessLocale: 'en',
}
```

<p align="center">
  <img src="/overflow-compress.svg" alt="compress overflow strategy" style="max-width: 440px; width: 100%;" />
</p>

### `error`

Throws a `ContextOverflowError` if content exceeds the budget. Use this for slots that must never be truncated (e.g. system prompts).

```typescript
overflow: 'error'
```

### `fallback-chain`

Tries strategies in sequence: **summarize → compress → truncate**. If summarize or compress fails (non-fatal), the chain moves to the next strategy. If the content still doesn't fit after truncation, it throws an error.

```typescript
overflow: 'fallback-chain'
```

<p align="center">
  <img src="/overflow-fallback-chain.svg" alt="fallback-chain overflow strategy" style="max-width: 520px; width: 100%;" />
</p>

## Custom strategies

Set `overflow` to a function for full control:

```typescript
overflow: async (context) => {
  const { items, budgetTokens, countTokens } = context;
  // Return a filtered/transformed array of items
  // that fits within budgetTokens
  return items.filter((item) => !item.metadata?.lowPriority);
}
```

The function receives the slot's current items, budget, and a token-counting function, and must return items that fit.

## Forced compression

Normally, overflow strategies only run when a slot exceeds its token budget. Sometimes you want to proactively compress the context — for example, to free up headroom before a long conversation fills the window, or to let users manually trigger compression.

Pass `forceCompress: true` in the build overrides:

```typescript
const { snapshot } = await ctx.build({
  overrides: { forceCompress: true },
});
```

When `forceCompress` is active:

- **Every** non-protected slot's overflow strategy runs, even if content is within budget.
- For slots that are within budget, the engine sets a **synthetic reduced budget** (50% of current token usage) so the strategy has a real target to compress toward.
- Protected slots are still skipped — `forceCompress` does not override the `protected` flag.
- The flag is per-build — it does not change the stored config. The next `build()` without the flag behaves normally.

This works with both `build()` and `buildStream()`:

```typescript
const stream = ctx.buildStream({
  overrides: { forceCompress: true },
});
```

::: tip Use case: user-triggered compression
In a chatbot, you can expose a command (like `!compress`) that lets users shrink the context on demand:

```typescript
if (userInput === '!compress') {
  const before = await ctx.build();
  const after = await ctx.build({ overrides: { forceCompress: true } });
  console.log(`Compressed: ${before.snapshot.meta.totalTokens} → ${after.snapshot.meta.totalTokens} tokens`);
}
```

See the [terminal chatbot tutorial](/guide/build-a-chatbot) for a working example.
:::

## Protected slots

Mark a slot as `protected: true` to exempt it from all overflow. If a protected slot exceeds its budget, a `SLOT_PROTECTED_OVER_BUDGET` warning is emitted instead of evicting content. Use sparingly — a protected slot that consistently overflows will squeeze the remaining slots.

## Global escalation

After processing all slots individually, the engine checks if the **total** token count across all slots exceeds `totalBudget`. If it does, it enters **escalation mode**:

1. Find the lowest-priority non-protected slot that still has evictable (non-pinned) items.
2. Fully evict all non-pinned content from that slot.
3. Recheck the total. Repeat if still over budget.

This ensures the combined output always fits the model's context window, even when individual slot budgets sum correctly but rounding or token estimation causes a slight overshoot.

## Events

The overflow engine emits events that you can observe via `config.onEvent` or plugins:

| Event | When |
| --- | --- |
| `compression:start` | A compression-like strategy (`summarize`, `compress`, `semantic`) begins. |
| `compression:complete` | The strategy finishes, with before/after token counts. |
| `slot:overflow` | After a slot's overflow strategy has run. |
| `content:evicted` | For each individual item removed during overflow. |

## Next

- [Compression](./compression) — deep dive into the compression strategies.
- [Budgets](./budgets) — how token budgets are allocated.
- [Snapshots](./snapshots) — the immutable build result.
