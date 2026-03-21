# Compression

Slotmux provides three compression families for reducing token usage without losing critical information. All are available from the `@slotmux/compression` package and integrate with the overflow engine as strategies.

## Progressive summarization

Progressive summarization condenses content through multiple layers of increasing abstraction. It's designed for conversation history where you want to preserve recent detail while compacting older turns.

<p align="center">
  <img src="/compression-progressive.svg" alt="Progressive summarization zones" style="max-width: 480px; width: 100%;" />
</p>

### How it works

Content is divided into **zones** based on age and importance:

- **Zone 1 (recent)** — Kept verbatim. These are the most recent messages that the model needs full access to.
- **Zone 2 (mid-range)** — Summarized at a moderate level. Key points and decisions are preserved.
- **Zone 3 (old)** — Aggressively summarized into high-level bullet points.

The zone boundaries shift as conversation grows: what was Zone 1 becomes Zone 2, then Zone 3. Each layer builds on the previous summary rather than re-processing raw text.

### Usage as overflow strategy

```typescript
overflow: 'summarize',
overflowConfig: {
  summarizer: 'builtin:progressive',
  preserveLastN: 5,   // keep last N items verbatim
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

This approach parallelizes well and handles content that doesn't have a natural temporal ordering.

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
