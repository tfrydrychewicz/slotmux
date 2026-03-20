# Memory Plugin

`@slotmux/plugin-memory` adds persistent memory to your slotmux context. It retrieves relevant memories from a store, injects them into a dedicated slot, and optionally extracts new facts from each conversation turn.

## Installation

```bash
npm install @slotmux/plugin-memory
```

For SQLite-backed persistence:

```bash
npm install better-sqlite3
```

## Quick start

```typescript
import { createContext, Context } from 'slotmux';
import { memoryPlugin, InMemoryMemoryStore } from '@slotmux/plugin-memory';

const store = new InMemoryMemoryStore();

// Seed some memories
await store.set({ content: 'User prefers dark mode.' });
await store.set({ content: 'User is a TypeScript developer.' });

const memory = memoryPlugin({ store });

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'chat',
  reserveForResponse: 4096,
  plugins: [memory],
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful assistant. Use memories to personalize responses.');
ctx.user('What IDE should I use?');

const { snapshot } = await ctx.build();
// The memory slot now contains relevant memories like "User is a TypeScript developer"
```

## Configuration

```typescript
memoryPlugin({
  store: myStore,                  // required: MemoryStore implementation
  memorySlot: 'memory',           // slot name for retrieved memories (default: 'memory')
  historySlot: 'history',         // slot to read query from (default: 'history')
  memoryBudget: { percent: 10 },  // budget for the memory slot (default: 10%)
  retrievalStrategy: 'hybrid',    // ranking strategy (default: 'hybrid')
  hybridAlpha: 0.55,              // weight on relevance vs recency (default: 0.55)
  recencyHalfLifeMs: 604800000,   // recency decay half-life (default: 7 days)
  searchLimit: 48,                // max candidates from store.search() (default: 48)
  autoExtract: false,             // extract facts after each build (default: false)
  autoExtractMinLength: 24,       // minimum segment length for extraction (default: 24)
  defaultSlot: undefined,         // override injected slot config
});
```

### `store` (required)

A `MemoryStore` implementation. The package ships with two:

- **`InMemoryMemoryStore`** — Map-backed, suitable for testing and short-lived sessions.
- **`SQLiteMemoryStore`** — SQLite-backed via `better-sqlite3`, suitable for production persistence.

### `retrievalStrategy`

How retrieved memories are ranked before injection:

| Strategy | Behavior |
| --- | --- |
| `'recency'` | Rank by how recently the memory was updated. |
| `'relevance'` | Rank by Jaccard word-overlap similarity to the latest user message. |
| `'hybrid'` (default) | Weighted combination: `alpha * relevance + (1 - alpha) * recency`. |

### `hybridAlpha`

Controls the balance between relevance and recency in `'hybrid'` mode. `1.0` = pure relevance, `0.0` = pure recency. Default: `0.55` (slight relevance bias).

### `recencyHalfLifeMs`

The half-life for recency decay in milliseconds. A memory updated exactly one half-life ago gets a recency score of `0.5`. Default: 7 days (`604_800_000`).

### `memoryBudget`

The budget allocated to the memory slot. Default: `{ percent: 10 }` (10% of the pool remaining after fixed budgets).

### `autoExtract`

When `true`, the plugin automatically extracts fact-like statements from the last few messages after each `build()` and saves them to the store. Duplicate facts (Jaccard similarity >= 0.92 with existing memories) are skipped.

```typescript
memoryPlugin({
  store,
  autoExtract: true,
  autoExtractMinLength: 30,
});
```

Extraction works by splitting assistant and user messages into sentence-like segments and keeping those that are long enough to be meaningful facts.

## The `MemoryStore` interface

```typescript
interface MemoryStore {
  get(id: string): Promise<MemoryRecord | undefined>;
  set(input: MemorySetInput): Promise<MemoryRecord>;
  search(query: string, options?: { limit?: number }): Promise<MemoryRecord[]>;
  delete(id: string): Promise<boolean>;
}
```

### `MemoryRecord`

```typescript
type MemoryRecord = {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
};
```

### `MemorySetInput`

```typescript
type MemorySetInput = {
  id?: string;        // auto-generated if omitted
  content: string;
  metadata?: Record<string, unknown>;
};
```

## Built-in stores

### `InMemoryMemoryStore`

A simple Map-backed store. Memories are lost when the process exits.

```typescript
import { InMemoryMemoryStore } from '@slotmux/plugin-memory';

const store = new InMemoryMemoryStore();
await store.set({ content: 'User likes concise answers.' });

const results = await store.search('concise');
```

Search behavior: with an empty query, returns all records sorted by `updatedAt` (newest first). With a query, matches any record containing at least one query word as a substring.

### `SQLiteMemoryStore`

Persistent storage backed by SQLite via `better-sqlite3`. Uses WAL mode for file-based databases.

```typescript
import { SQLiteMemoryStore, isBetterSqliteAvailable } from '@slotmux/plugin-memory';

if (isBetterSqliteAvailable()) {
  const store = new SQLiteMemoryStore('./memories.db');

  // Use with the plugin
  const memory = memoryPlugin({ store });

  // Don't forget to close when shutting down
  process.on('exit', () => store.close());
}
```

For in-memory SQLite (no file, useful for tests):

```typescript
const store = new SQLiteMemoryStore(':memory:');
```

## Pipeline behavior

### 1. Slot injection (`prepareSlots`)

If the memory slot doesn't exist, the plugin creates it with:

```typescript
{
  priority: 65,
  budget: memoryBudget,  // default: { percent: 10 }
  defaultRole: 'user',
  position: 'before',
  overflow: 'truncate',
}
```

### 2. Memory retrieval (`beforeOverflow`)

Before overflow runs, the plugin:

1. Finds the **last non-empty user message** in the history slot to use as a retrieval query.
2. Calls `store.search(query, { limit: searchLimit })` to get candidates.
3. Ranks candidates using the configured `retrievalStrategy`.
4. Converts top-ranked memories into content items prefixed with `[memory]`.
5. Merges them with any pinned or user-provided items in the memory slot.
6. Trims to fit within the slot's token budget (pinned items are kept first).

### 3. Fact extraction (`afterSnapshot`)

When `autoExtract` is enabled, after each build the plugin:

1. Extracts sentence-like segments from the last few messages.
2. Checks each candidate against existing memories to avoid duplicates (Jaccard >= 0.92).
3. Saves new facts to the store with `metadata: { source: 'autoExtract' }`.

## End-to-end example with persistent memory

```typescript
import { createContext, Context } from 'slotmux';
import { memoryPlugin, SQLiteMemoryStore } from '@slotmux/plugin-memory';
import { formatOpenAIMessages } from '@slotmux/providers';

const store = new SQLiteMemoryStore('./user-memories.db');

const memory = memoryPlugin({
  store,
  retrievalStrategy: 'hybrid',
  hybridAlpha: 0.6,
  autoExtract: true,
  memoryBudget: { percent: 15 },
});

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'chat',
  reserveForResponse: 4096,
  plugins: [memory],
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a personal assistant. Use memories to personalize your responses.');

// Simulate a conversation
ctx.user('I just moved to Berlin and I love cycling.');
ctx.assistant('Welcome to Berlin! It is a great city for cycling.');
ctx.user('What activities would you recommend for this weekend?');

const { snapshot } = await ctx.build();
const messages = formatOpenAIMessages(snapshot.messages);

// After build with autoExtract, the store now contains:
// - "User just moved to Berlin and loves cycling."
// Next time, these memories will be retrieved and injected automatically.

// Clean shutdown
process.on('exit', () => store.close());
```

## Custom `MemoryStore` implementation

You can implement `MemoryStore` with any backend — Redis, PostgreSQL, a vector database, or an external API:

```typescript
import type { MemoryStore, MemoryRecord, MemorySetInput } from '@slotmux/plugin-memory';

class RedisMemoryStore implements MemoryStore {
  async get(id: string): Promise<MemoryRecord | undefined> {
    const data = await redis.get(`memory:${id}`);
    return data ? JSON.parse(data) : undefined;
  }

  async set(input: MemorySetInput): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: input.id ?? crypto.randomUUID(),
      content: input.content,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: input.metadata,
    };
    await redis.set(`memory:${record.id}`, JSON.stringify(record));
    return record;
  }

  async search(query: string, options?: { limit?: number }): Promise<MemoryRecord[]> {
    // Implement your search logic — full-text, vector, or hybrid
    // Return candidates; the plugin handles ranking
  }

  async delete(id: string): Promise<boolean> {
    return (await redis.del(`memory:${id}`)) > 0;
  }
}
```

## Retrieval ranking utilities

The ranking functions are exported for direct use:

```typescript
import { rankMemories, jaccardSimilarity } from '@slotmux/plugin-memory';

const ranked = rankMemories(records, {
  query: 'How does authentication work?',
  strategy: 'hybrid',
  alpha: 0.6,
  halfLifeMs: 7 * 24 * 60 * 60 * 1000,
});
// Returns: { record, score }[] sorted by score descending
```

## Next

- [Plugins concept](../concepts/plugins) — How slotmux plugins work.
- [RAG plugin](./rag) — Managing retrieval-augmented generation content.
- [Tools plugin](./tools) — Managing tool definitions and results.
