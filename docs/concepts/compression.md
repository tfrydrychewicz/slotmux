# Compression

Slotmux provides three compression families for reducing token usage without losing critical information. All are available from the `@slotmux/compression` package and integrate with the overflow engine as strategies.

## Progressive summarization

Progressive summarization condenses content through multiple layers of increasing abstraction. It's designed for conversation history where you want to preserve recent detail while compacting older turns.

<p align="center">
  <img src="/compression-progressive.svg" alt="Progressive summarization zones" style="max-width: 480px; width: 100%;" />
</p>

### How it works

Content is divided into **zones** based on age and importance:

- **Recent zone** — Kept verbatim. The most recent messages that the model needs full access to. When `preserveLastN` is omitted, slotmux dynamically sizes this zone to fill ~50% of the slot budget.
- **Middle zone** — Summarized at a moderate level (Layer 1). Key points, decisions, and specific facts are preserved.
- **Old zone** — Summarized more aggressively (Layer 2). Executive-level outcomes and critical context only.

When a zone is large, it's split into **segments** of ~2-8K tokens each, and each segment is summarized independently. This produces multiple summary items rather than one monolithic summary, preserving more information across the full conversation history.

All independent segment summarizations run **in parallel** by default, significantly reducing wall-clock latency when the overflow engine needs multiple LLM calls. Set `maxParallelSummarizations` on `overflowConfig` to cap concurrency (e.g. to respect provider rate limits). When omitted, all chunks execute simultaneously.

Each summary call includes a **target token count** in the system prompt and as a `targetTokens` parameter, so the LLM knows how much detail to produce. Provider factories forward this as the appropriate output-length parameter for the LLM API (e.g. `max_completion_tokens` for newer OpenAI models, `max_tokens` for Anthropic).

If the result still doesn't fit after Layer 1 and Layer 2 summaries, the Layer 2 summaries are further compressed into a single Layer 3 "essence" summary.

### Usage as overflow strategy

```typescript
overflow: 'summarize',
overflowConfig: {
  summarizer: 'builtin:progressive',
  preserveLastN: 10,              // or omit for dynamic sizing
  summaryBudget: { percent: 30 }, // portion of slot budget for summaries
  proactiveThreshold: 0.85,       // start compressing at 85% utilization
}
```

### Direct API

```typescript
import { runProgressiveSummarize } from '@slotmux/compression';

const result = await runProgressiveSummarize({
  items,
  budget: 2000,
  summarizeFn: async (text, targetTokens) => {
    // call your LLM to summarize
    return summarizedText;
  },
});
```

## Map-reduce summarization

An alternative to progressive summarization that works better for large batches of independent content (e.g. retrieved documents).

<p align="center">
  <img src="/compression-map-reduce.svg" alt="Map-reduce summarization pipeline" style="max-width: 480px; width: 100%;" />
</p>

### How it works

1. **Map** — Split content into chunks that fit a token budget, then summarize each chunk independently.
2. **Reduce** — Merge the chunk summaries into a final summary.

The map phase runs all chunk summarizations in parallel by default, bounded by `maxParallelSummarizations` when set. This approach handles content that doesn't have a natural temporal ordering.

### Usage

```typescript
overflow: 'summarize',
overflowConfig: {
  summarizer: 'builtin:map-reduce',
}
```

### Direct API

```typescript
import { runMapReduceSummarize, chunkBulkForMap } from '@slotmux/compression';

const chunks = chunkBulkForMap(items, { chunkBudget: 4000 });
const result = await runMapReduceSummarize({
  chunks,
  mapFn: async (text) => summarize(text),
  reduceFn: async (summaries) => merge(summaries),
});
```

## Semantic compression

Semantic compression uses embedding similarity to selectively keep the most relevant content. Unlike summarization, it doesn't rewrite text — it filters items based on how relevant they are to an anchor.

<p align="center">
  <img src="/compression-semantic.svg" alt="Semantic compression via similarity filtering" style="max-width: 500px; width: 100%;" />
</p>

### How it works

1. Compute embeddings for all items and the **anchor** (the latest user message, the system prompt, or a custom string).
2. Score each item by cosine similarity to the anchor.
3. Drop items below a similarity threshold.
4. If still over budget, remove the least similar items until the content fits.

### Usage as overflow strategy

```typescript
overflow: 'semantic',
overflowConfig: {
  embedFn: async (text) => myEmbeddingModel.embed(text),
  anchorTo: 'lastUserMessage',
  similarityThreshold: 0.7,
}
```

### Anchor options

| Value | Anchor computed from |
| --- | --- |
| `'lastUserMessage'` | The most recent user message in the slot. |
| `'systemPrompt'` | The system slot's content. |
| A string | The literal string provided. |
| A `ContentItem` | The content of the provided item. |

### Direct API

```typescript
import { runSemanticCompress, cosineSimilarity } from '@slotmux/compression';

const result = await runSemanticCompress({
  items,
  budget: 5000,
  embedFn: async (text) => embed(text),
  anchorEmbedding: await embed('What is the user asking about?'),
});
```

## Lossless compression

Lossless compression reduces token count through mechanical text transformations that preserve meaning: stop-word removal, whitespace normalization, and redundancy elimination. No LLM call is required.

<p align="center">
  <img src="/compression-lossless.svg" alt="Lossless compression text transformation" style="max-width: 480px; width: 100%;" />
</p>

### How it works

The `LosslessCompressor` applies language-aware transformations:

- Remove filler words and stop words (language-specific word lists).
- Normalize whitespace and punctuation.
- Collapse redundant phrasing.

The compression ratio is modest (typically 10–30%) but guaranteed to be meaning-preserving and deterministic.

### Usage as overflow strategy

```typescript
overflow: 'compress',
overflowConfig: {
  losslessLocale: 'en',
  losslessDetectLanguage: (text) => detectLanguage(text),
}
```

### Direct API

```typescript
import { LosslessCompressor } from '@slotmux/compression';

const compressor = new LosslessCompressor({ locale: 'en' });
const compressed = compressor.compress(text);
```

## Choosing a compression strategy

| Strategy | LLM required | Preserves exact text | Best for |
| --- | --- | --- | --- |
| Progressive summarize | Yes | No | Conversation history with temporal ordering |
| Map-reduce summarize | Yes | No | Large document batches, RAG contexts |
| Semantic | Yes (embeddings) | Yes (filters, doesn't rewrite) | RAG retrieval slots, heterogeneous content |
| Lossless | No | Approximately | Quick wins, combining with other strategies |

## Fallback chain

The `fallback-chain` overflow strategy composes these approaches automatically: **summarize → compress → truncate → error**. If one step fails, the next is tried. This gives you best-effort compression with a guaranteed fit.

```typescript
overflow: 'fallback-chain'
```

## On-demand compression

All compression strategies above normally trigger only when content exceeds its token budget. You can force them to run at any time — even when content is within budget — by passing `forceCompress: true` to `build()`:

```typescript
const { snapshot } = await ctx.build({
  overrides: { forceCompress: true },
});
```

The engine sets a synthetic reduced budget (50% of current usage) so the strategy has a meaningful compression target. This is useful for:

- **Proactive space management** — compress before the context window fills up.
- **User-triggered compression** — let users manually reclaim space in long-running conversations.
- **Testing compression strategies** — verify that your strategies work without needing to fill the context to capacity.

See [Overflow — Forced compression](/concepts/overflow#forced-compression) for the full behavior and examples.

## Next

- [Overflow](./overflow) — the full overflow pipeline and all strategies.
- [Snapshots](./snapshots) — inspecting compression results in snapshot metadata.
