# Compression

Slotmux provides three compression families for reducing token usage without losing critical information. All are available from the `@slotmux/compression` package and integrate with the overflow engine as strategies.

## Progressive summarization

Progressive summarization condenses content through multiple layers of increasing abstraction. It's designed for conversation history where you want to preserve recent detail while compacting older turns.

<p align="center">
  <img src="/compression-progressive.svg" alt="Progressive summarization zones" style="max-width: 720px; width: 100%;" />
</p>

### How it works

Content is divided into **zones** based on age and importance:

- **Recent zone** — Kept verbatim. The most recent messages that the model needs full access to. When `preserveLastN` is omitted, slotmux dynamically sizes this zone to fill ~50% of the slot budget.
- **Middle zone** — Summarized at a moderate level (Layer 1). Key points, decisions, and specific facts are preserved.
- **Old zone** — Summarized more aggressively (Layer 2). Executive-level outcomes and critical context only.

When a zone is large, it's split into **segments** of ~2-8K tokens each, and each segment is summarized independently. This produces multiple summary items rather than one monolithic summary, preserving more information across the full conversation history.

All independent segment summarizations run **in parallel** by default, significantly reducing wall-clock latency when the overflow engine needs multiple LLM calls. Set `maxParallelSummarizations` on `overflowConfig` to cap concurrency (e.g. to respect provider rate limits). When omitted, all chunks execute simultaneously.

Each summary call includes a **target token count** in the system prompt and as a `targetTokens` parameter, so the LLM knows how much detail to produce. The `targetTokens` value guides the prompt instruction only — providers do not pass it as a hard API output limit.

If the result still doesn't fit after Layer 1 and Layer 2 summaries, the Layer 2 summaries are further compressed into a single Layer 3 "essence" summary. When facts have been extracted from earlier rounds, they are injected into the L3 prompt as hard constraints so the model preserves them even under aggressive compression.

### Incremental summarization

<p align="center">
  <img src="/compression-incremental.svg" alt="Incremental summarization: stable summaries reused, only fresh items sent to LLM" style="max-width: 720px; width: 100%;" />
</p>

Without incremental summarization, every `build()` re-summarizes all items — including items that were *already summaries* from a previous pass. This means cost and latency grow with total conversation length, not with how much new content was added.

The summarizer recognizes items that are **already summaries** (they have a `summarizes` field from a previous compression pass) and carries them forward without re-summarizing. Only fresh, unsummarized items are sent to the LLM. This makes per-build cost proportional to **new content added since the last build**, not total content in the context.

After old-zone processing, the summarizer also performs an **adaptive zone skip**: if the old-zone summaries plus middle-zone items plus recent items already fit within budget, the middle-zone LLM calls are skipped entirely. This avoids unnecessary compression when there's enough headroom.

The result: in a long-running conversation, early builds may need 5–10 LLM calls when compression first kicks in, but subsequent builds typically need only 1–2 calls for the freshly added messages.

### Fact-aware compression

<p align="center">
  <img src="/compression-fact-aware.svg" alt="Fact-aware compression: extraction-first prompts, fact store, and fact pinning" style="max-width: 720px; width: 100%;" />
</p>

Narrative summaries are inherently lossy for specific details — names, numbers, dates, and preferences get dropped when the model compresses aggressively. For example, "The user created a playlist called 'Summer Vibes' on Spotify" might become "The user discussed music streaming platforms." The specific playlist name is gone.

Fact-aware compression addresses this with a **dual-store architecture** that separates structured facts from narrative:

1. **Extraction-first prompts** — The LLM is instructed to output structured `FACT: subject | predicate | value | confidence` lines *before* writing narrative. Facts are produced first and survive even when the model runs out of space for the narrative tail. The confidence field (0.0–1.0) lets the LLM express how important each fact is; when omitted, it defaults to 0.9.
2. **Trivial fact filtering** — Prompts explicitly instruct the LLM to skip greetings, thank-yous, farewells, and other trivial social interactions. Only facts that would be useful if asked about later are extracted.
3. **Fact store** — Extracted facts accumulate in an in-memory `FactStore` across compression rounds, keyed by `subject|predicate`. Duplicates are resolved by keeping the highest-confidence entry.
4. **Fact block** — A synthetic `Known facts:` item is rendered at the start of the summarized context so the downstream LLM can reference specific details when answering questions. Facts are ordered by confidence — the most important facts appear first and survive when budget is tight.
5. **Fact pinning** — When L3 re-compression runs, existing facts are injected into the prompt as "must preserve" constraints, preventing the model from silently dropping them.

#### Fact confidence scoring

<p align="center">
  <img src="/compression-fact-confidence.svg" alt="Fact confidence scoring: LLM assigns importance, trivial facts deprioritized" style="max-width: 720px; width: 100%;" />
</p>

The LLM assigns a confidence score to each fact it extracts. Critical facts (names, decisions, account numbers) get high confidence; trivial observations get low confidence. When the fact budget is tight, low-confidence facts are dropped first, ensuring the most useful information survives.

#### Time-based fact decay

<p align="center">
  <img src="/compression-fact-decay.svg" alt="Fact decay: old facts lose effective confidence over time" style="max-width: 720px; width: 100%;" />
</p>

In long conversations, facts from early turns become stale. Time-based decay reduces the effective confidence of older facts using exponential decay: `confidence × 0.5^(age / halfLife)`. This means old trivial facts drop off naturally while recent important facts hold their position.

Enable decay with `factDecayHalfLifeMs` in `overflowConfig`:

```typescript
overflowConfig: {
  factBudgetTokens: 256,
  factDecayHalfLifeMs: 1_800_000, // 30-minute half-life
}
```

Decay only affects **render-time ordering** — stored confidence values are never mutated. When decay is not configured, raw confidence is used as-is (the default).

#### Custom fact extraction

For domain-specific extraction, you can provide a custom `extractFacts` function that runs as a separate pass before summarization:

```typescript
overflowConfig: {
  factBudgetTokens: 256,
  extractFacts: async ({ text }) => {
    // Domain-specific: extract order IDs via regex
    return [...text.matchAll(/order #(\w+)/gi)].map(m => ({
      subject: 'user', predicate: 'placed_order', value: m[1]!,
      sourceItemId: 'custom', confidence: 1.0, createdAt: Date.now(),
    }));
  },
}
```

### Importance-weighted zone partitioning

<p align="center">
  <img src="/compression-importance.svg" alt="Importance-weighted partitioning: fact-dense items stay in MIDDLE zone" style="max-width: 720px; width: 100%;" />
</p>

By default, non-recent items are split into OLD and MIDDLE zones using importance scoring — not purely by age. Items are scored before splitting:

- **Low-importance items** (generic filler, small talk) go to the OLD zone and get compressed first.
- **High-importance items** (containing specific facts, code, structured data) stay in the MIDDLE zone and survive longer.

The default scorer (`computeItemImportance`) uses **language-agnostic structural signals** — no hardcoded English keywords, so it works regardless of the user's language:

| Signal | Score contribution |
| --- | --- |
| Entity density (capitalized multi-word sequences) | `density × 2` |
| Specific facts (numbers ≥ 2 digits, numeric dates, quoted strings) | `+1` |
| Code blocks (fenced or inline) | `+1.5` |
| URLs | `+1` |
| Structured lists (bullet or numbered) | `+1` |
| Key-value pairs (`key: value` or `key=value`) | `+0.5` per pair (max 1.5) |
| Substantive length | `0–1` (scaled by `text.length / 500`) |
| Lexical diversity (unique/total word ratio ≥ 0.7) | `+0.5` |

You can provide a custom scorer or disable importance scoring entirely:

```typescript
overflowConfig: {
  // Custom domain-specific scorer
  importanceScorer: (item) => /ProductX/i.test(item.content) ? 10 : 0,

  // Or disable importance scoring (pure chronological)
  // importanceScorer: null,
}
```

For semantic or embedding-based scoring, pre-compute embeddings and look them up synchronously in the scorer (since `ImportanceScorerFn` is sync):

```typescript
const embeddings = await precomputeEmbeddings(items, embedFn);
const anchor = await embedFn('important decision preference');

overflowConfig: {
  importanceScorer: (item) => {
    const vec = embeddings.get(hash(item.content));
    return vec ? cosineSimilarity(vec, anchor) : 0;
  },
}
```

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
  <img src="/compression-map-reduce.svg" alt="Map-reduce summarization pipeline" style="max-width: 720px; width: 100%;" />
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
  <img src="/compression-semantic.svg" alt="Semantic compression via similarity filtering" style="max-width: 720px; width: 100%;" />
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

### Adaptive similarity thresholds

Fixed similarity thresholds are brittle across embedding models and content types. Enable `adaptiveThreshold` to automatically compute the cutoff from the score distribution of each query:

```typescript
overflowConfig: {
  embedFn: async (text) => embed(text),
  anchorTo: 'lastUserMessage',
  adaptiveThreshold: true,     // mean + 1 stddev
  // adaptiveThreshold: 0.5,   // more permissive
  // adaptiveThreshold: 2.0,   // stricter
}
```

The algorithm computes `mean + k × stddev` over all non-pinned similarity scores. When combined with a fixed `similarityThreshold`, the effective threshold is `max(adaptive, fixed)`.

<p align="center">
  <img src="/semantic-adaptive-threshold.svg" alt="Adaptive similarity threshold" style="max-width: 500px; width: 100%;" />
</p>

The `computeAdaptiveThreshold` utility is also available directly:

```typescript
import { computeAdaptiveThreshold } from '@slotmux/compression';

const threshold = computeAdaptiveThreshold(scores, 1.0);
```

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

## Tiered token estimation

The progressive summarizer uses a **three-tier token counting strategy** to balance accuracy and speed:

<p align="center">
  <img src="/token-count-tiers.svg" alt="Tiered token estimation" style="max-width: 540px; width: 100%;" />
</p>

| Tier | Method | Speed | Used for |
| --- | --- | --- | --- |
| Tier 0 | `ceil(charLength / 3.5)` | <1&#x00B5;s | Zone sizing, chunk boundaries, adaptive skip |
| Tier 1 | FNV-1a-keyed cache &#x2192; BPE | <10&#x00B5;s | Final budget checks, snapshot metadata |
| Tier 2 | Full BPE tokenization | 0.1&#x2013;1ms | Cache misses only |

For heuristic decisions (how many items to keep in the recent zone, where to place chunk boundaries), the fast Tier 0 estimate is sufficient — it over-estimates by ~10% for English text, which is the safe direction for budget checks. Exact counting is reserved for budget-critical paths: final overflow enforcement, summary token enrichment, and snapshot metadata.

Cache keys use FNV-1a (pure JS, synchronous) instead of SHA-256 — cache lookups don't need cryptographic collision resistance, and FNV-1a is ~50x faster. Snapshot integrity checksums remain SHA-256.

## Lossless compression

Lossless compression reduces token count through mechanical text transformations that preserve meaning: stop-word removal, whitespace normalization, and redundancy elimination. No LLM call is required.

<p align="center">
  <img src="/compression-lossless.svg" alt="Lossless compression text transformation" style="max-width: 720px; width: 100%;" />
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
