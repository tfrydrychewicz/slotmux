# RAG Plugin

`@slotmux/plugin-rag` manages retrieval-augmented generation content within slotmux. It handles chunk deduplication, score-based ranking, budget-aware truncation, and citation tracking — all through a single plugin call.

## Installation

```bash
npm install @slotmux/plugin-rag
```

## Quick start

```typescript
import { createContext, Context } from 'slotmux';
import { ragPlugin } from '@slotmux/plugin-rag';

const rag = ragPlugin({ maxChunks: 15 });

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'chat',
  reserveForResponse: 4096,
  plugins: [rag],
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful assistant. Use the provided documents to answer.');

// Push retrieved chunks into the RAG slot
ctx.push('rag', {
  role: 'user',
  content: 'OAuth2 is an authorization framework that enables...',
  metadata: { 'rag.chunkId': 'doc-auth-1', 'rag.score': 0.95 },
});

ctx.push('rag', {
  role: 'user',
  content: 'JWT tokens consist of three parts: header, payload...',
  metadata: { 'rag.chunkId': 'doc-jwt-1', 'rag.score': 0.88 },
});

ctx.user('How does authentication work in our system?');

const { snapshot } = await ctx.build();

// After build, retrieve which chunks survived overflow
const citations = rag.getRagCitations();
// → [{ chunkId: 'doc-auth-1', itemId: ... }, { chunkId: 'doc-jwt-1', itemId: ... }]
```

## Configuration

```typescript
ragPlugin({
  slotName: 'rag',             // target slot name (default: 'rag')
  maxChunks: 20,               // max chunks after dedupe (default: 20)
  rerankOnOverflow: false,     // reorder by score before truncation (default: false)
  deduplication: true,         // near-duplicate removal (default: true)
  dedupeThreshold: 0.88,      // Jaccard similarity threshold for dedupe (default: 0.88)
  citationTracking: true,     // track which chunks survive overflow (default: true)
  rerank: undefined,          // custom reranking function
  defaultSlot: undefined,     // override the injected slot config
});
```

### `slotName`

The slot where RAG chunks live. The plugin creates this slot automatically if it doesn't exist in your config. Default: `'rag'`.

### `maxChunks`

After deduplication, only the top `maxChunks` items (by `rag.score`, highest first) are kept. Default: `20`.

### `deduplication`

When `true` (the default), the plugin removes near-duplicate chunks using Jaccard word-overlap similarity. If two chunks have a Jaccard similarity >= `dedupeThreshold`, the later one is dropped. This prevents your context from being filled with repetitive content from overlapping retrieval results.

### `dedupeThreshold`

The Jaccard similarity threshold for deduplication. Two chunks with similarity at or above this value are considered duplicates. Default: `0.88`.

### `rerankOnOverflow`

When the RAG slot's total tokens exceed its budget, the plugin can reorder items so that low-scoring chunks appear first — making them the first to be evicted by the FIFO `truncate` strategy. Default: `false`.

When enabled, the plugin uses `rag.score` metadata for ordering. If you provide a custom `rerank` function, it will be called instead.

### `rerank`

A custom function that reorders items **worst-first** (items at the beginning of the returned array will be evicted first under FIFO truncation):

```typescript
ragPlugin({
  rerankOnOverflow: true,
  rerank: async (items) => {
    // Call your cross-encoder to re-score items
    const scored = await crossEncoder.rank(query, items);
    // Return worst-first ordering
    return scored.sort((a, b) => a.score - b.score);
  },
});
```

### `citationTracking`

When `true` (the default), the plugin records which chunks survive overflow processing. Access them via `rag.getRagCitations()` after each `build()`.

### `defaultSlot`

Override the slot configuration injected when the slot doesn't exist. The default injected slot uses:

```typescript
{
  priority: 80,
  budget: { flex: true },
  defaultRole: 'user',
  position: 'before',
  overflow: 'truncate',
}
```

## Metadata keys

The plugin uses two metadata keys on content items:

| Key | Type | Purpose |
| --- | --- | --- |
| `rag.chunkId` | `string` | Stable identifier for a chunk. Used for citation tracking. Falls back to `String(item.id)` if not set. |
| `rag.score` | `number` | Relevance score (higher = more important). Used for `maxChunks` cap and `rerankOnOverflow` ordering. |

These are exported as constants:

```typescript
import { RAG_METADATA_CHUNK_ID, RAG_METADATA_SCORE } from '@slotmux/plugin-rag';
// RAG_METADATA_CHUNK_ID = 'rag.chunkId'
// RAG_METADATA_SCORE    = 'rag.score'
```

## Pipeline behavior

The plugin hooks into the build pipeline at three points:

### 1. Slot injection (`prepareSlots`)

If the configured slot doesn't exist in your context, the plugin adds it with default settings (priority 80, flex budget, FIFO truncation). This means you can use `preset: 'chat'` and the plugin will add the RAG slot for you.

### 2. Pre-overflow processing (`beforeOverflow`)

Before the overflow engine runs, the plugin processes the RAG slot's items in this order:

1. **Deduplicate** — Remove near-duplicate chunks using Jaccard word-overlap similarity.
2. **Cap at `maxChunks`** — Keep only the top-scored items. Ties preserve insertion order.
3. **Rerank for overflow** — If `rerankOnOverflow` is enabled and the slot is still over budget, reorder items worst-first so FIFO truncation removes the least relevant chunks.

### 3. Citation tracking (`afterOverflow`)

After overflow, the plugin records which chunks survived. Access them via:

```typescript
const citations = rag.getRagCitations();
// Returns: readonly { chunkId: string; itemId: string | number }[]
```

## Combining with overflow strategies

The default overflow for the RAG slot is `truncate` (FIFO), but you can combine the plugin with any overflow strategy:

```typescript
createContext({
  model: 'gpt-5.4',
  reserveForResponse: 4096,
  slots: {
    rag: {
      priority: 80,
      budget: { percent: 40 },
      overflow: 'semantic',
      overflowConfig: {
        embedFn: async (text) => embeddings.create(text),
        anchorTo: 'lastUserMessage',
      },
    },
  },
  plugins: [ragPlugin({ maxChunks: 30 })],
});
```

The plugin's deduplication and `maxChunks` cap run **before** the slot's overflow strategy, so they complement each other.

## End-to-end example with a vector database

```typescript
import { createContext, Context } from 'slotmux';
import { ragPlugin } from '@slotmux/plugin-rag';
import { formatOpenAIMessages } from '@slotmux/providers';

const rag = ragPlugin({
  maxChunks: 20,
  rerankOnOverflow: true,
  dedupeThreshold: 0.85,
});

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'rag',
  reserveForResponse: 4096,
  plugins: [rag],
});

const ctx = Context.fromParsedConfig(config);
ctx.system('Answer questions using the provided documents. Cite sources.');

// Retrieve chunks from your vector DB
const query = 'How does our payment system handle refunds?';
const results = await vectorDb.search(query, { topK: 30 });

// Push all retrieved chunks — the plugin handles deduplication and capping
for (const result of results) {
  ctx.push('rag', {
    role: 'user',
    content: result.text,
    metadata: {
      'rag.chunkId': result.id,
      'rag.score': result.score,
    },
  });
}

ctx.user(query);

const { snapshot } = await ctx.build();
const messages = formatOpenAIMessages(snapshot.messages);

// Use citations to show which documents were used
const citations = rag.getRagCitations();
console.log(`Used ${citations.length} chunks in final context`);
```

## Deduplication details

The plugin uses **Jaccard word-overlap similarity** to detect near-duplicates:

1. Both texts are lowercased and split into word sets (splitting on non-alphanumeric characters).
2. Jaccard similarity = |intersection| / |union|.
3. If similarity >= `dedupeThreshold`, the later chunk is dropped (order-preserving).

This catches overlapping retrieval results from chunked documents where adjacent chunks share significant text.

You can also use the deduplication utilities directly:

```typescript
import { dedupeNearDuplicateChunks, jaccardSimilarity } from '@slotmux/plugin-rag';

const similarity = jaccardSimilarity('the quick brown fox', 'the quick red fox');
// → 0.6 (3 shared words / 5 unique words)

const deduped = dedupeNearDuplicateChunks(items, { threshold: 0.85 });
```

## Next

- [Plugins concept](../concepts/plugins) — How slotmux plugins work.
- [Tools plugin](./tools) — Managing tool definitions and results.
- [Memory plugin](./memory) — Persistent memory across sessions.
