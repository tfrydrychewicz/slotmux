# Tools Plugin

`@slotmux/plugin-tools` manages tool definitions and tool call results within slotmux. It handles automatic truncation of large results, enforces a cap on retained results, and properly accounts for the token cost of function schemas.

## Installation

```bash
npm install @slotmux/plugin-tools
```

## Quick start

```typescript
import { createContext, Context } from 'slotmux';
import { toolsPlugin } from '@slotmux/plugin-tools';

const tools = toolsPlugin({ maxToolResults: 5 });

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'agent',
  reserveForResponse: 4096,
  plugins: [tools],
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful agent with access to tools.');

// Push tool definitions (function schemas)
ctx.push('tools', {
  role: 'assistant',
  content: JSON.stringify({
    name: 'search_web',
    description: 'Search the web for information',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  }),
  metadata: { 'tools.kind': 'definition' },
});

// Push tool results
ctx.push('tools', {
  role: 'tool',
  content: 'Search results: The capital of France is Paris...',
});

const { snapshot } = await ctx.build();
```

## Configuration

```typescript
toolsPlugin({
  slotName: 'tools',            // target slot (default: 'tools')
  maxToolResults: 10,           // max non-pinned tool results kept (default: 10)
  truncateLargeResults: true,   // auto-truncate oversized results (default: true)
  resultMaxTokens: 500,         // token cap per result when truncating (default: 500)
  estimateDefinitionTokens: undefined,  // custom token estimator for definitions
  defaultSlot: undefined,       // override injected slot config
});
```

### `slotName`

The slot where tool definitions and results live. Created automatically if it doesn't exist. Default: `'tools'`.

### `maxToolResults`

Maximum number of non-pinned tool results to keep. When more results exist, only the most recent ones (by `createdAt`) are retained. **Tool definitions and pinned items are never counted or removed.** Default: `10`.

Set to `0` to drop all non-pinned tool results (keeping only definitions and pinned items).

### `truncateLargeResults`

When `true` (the default), tool results whose estimated token count exceeds `resultMaxTokens` are truncated. The truncated content is cut to approximately `resultMaxTokens * 4` characters and appended with `...[truncated]`.

Truncated items get metadata markers:
- `tools.truncated: true`
- `tools.originalTokenEstimate: <number>`

### `resultMaxTokens`

The approximate token cap per tool result when truncation is enabled. Uses a `~4 characters per token` estimate. Default: `500`.

### `estimateDefinitionTokens`

Custom function to estimate the token cost of a tool definition item. By default, the plugin uses `ceil(content.length / 4)` on the stringified content.

```typescript
toolsPlugin({
  estimateDefinitionTokens: (item) => {
    // Use your tokenizer for precise counting
    return myTokenizer.count(String(item.content));
  },
});
```

### `defaultSlot`

Override the slot configuration injected when the slot doesn't exist. The default:

```typescript
{
  priority: 85,
  budget: { flex: true },
  defaultRole: 'tool',
  position: 'before',
  overflow: 'truncate',
}
```

## Metadata keys

| Key | Value | Purpose |
| --- | --- | --- |
| `tools.kind` | `'definition'` | Marks an item as a tool **definition** (function schema). Definitions are never truncated or removed by `maxToolResults`. |
| `tools.truncated` | `true` | Set by the plugin when a result was truncated. |
| `tools.originalTokenEstimate` | `number` | The estimated token count before truncation. |

These constants are exported:

```typescript
import { TOOLS_METADATA_KIND, TOOLS_KIND_DEFINITION } from '@slotmux/plugin-tools';
// TOOLS_METADATA_KIND   = 'tools.kind'
// TOOLS_KIND_DEFINITION = 'definition'
```

## Pipeline behavior

### 1. Slot injection (`prepareSlots`)

If the tools slot doesn't exist, the plugin creates it with priority 85 and flex budget.

### 2. Pre-overflow processing (`beforeOverflow`)

Before the overflow engine runs, the plugin processes the tools slot in three steps:

**Step 1: Estimate definition tokens** — For each tool definition item, the plugin sets the `tokens` field using `estimateDefinitionTokens` (or the default char/4 estimate). This ensures that function schemas are properly accounted for in the token budget.

**Step 2: Truncate large results** — For each `tool`-role item with string content, if the estimated token count exceeds `resultMaxTokens`, the content is cut down and `...[truncated]` is appended.

**Step 3: Enforce `maxToolResults`** — Non-pinned, non-definition tool results are capped at `maxToolResults`, keeping only the most recent by `createdAt`. Pinned items and definitions are always kept.

## Tool definitions consume tokens

A common mistake is forgetting that function schemas (tool definitions) consume tokens from the context window. The plugin addresses this by estimating definition tokens and including them in the slot's budget.

For a typical function schema:

```typescript
const searchTool = {
  name: 'search_web',
  description: 'Search the web for real-time information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: ['query'],
  },
};
// ~50 tokens — not free!
```

With 10+ tools, definitions alone can consume 500–1000 tokens. The plugin makes this visible in the budget.

## Multi-turn tool use

In agentic workflows, the model calls tools across multiple turns. The plugin keeps the most recent results and discards older ones:

```typescript
const tools = toolsPlugin({
  maxToolResults: 5,
  resultMaxTokens: 800,
});

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'agent',
  reserveForResponse: 4096,
  plugins: [tools],
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a research agent.');

// Turn 1: model calls search_web
ctx.push('tools', {
  role: 'tool',
  content: 'Result from search_web: ...(large JSON response)...',
  metadata: { toolCallId: 'call_1' },
});

// Turn 2: model calls fetch_page
ctx.push('tools', {
  role: 'tool',
  content: 'Full page content: ...(very large HTML)...',
  metadata: { toolCallId: 'call_2' },
});

// Turn 3: model calls summarize
ctx.push('tools', {
  role: 'tool',
  content: 'Summary: The article discusses...',
  metadata: { toolCallId: 'call_3' },
});

// Only the 5 most recent results are kept,
// large results are truncated to ~500 tokens
const { snapshot } = await ctx.build();
```

## Pinning important tool results

If a particular tool result is critical and should never be evicted:

```typescript
ctx.push('tools', {
  role: 'tool',
  content: 'Critical calculation result: 42',
  pinned: true,
  metadata: { toolCallId: 'call_important' },
});
```

Pinned tool results are exempt from both `maxToolResults` enforcement and truncation.

## Truncation utilities

The truncation helpers are exported for standalone use:

```typescript
import { estimateTokensFromText, truncateStringToApproxTokens } from '@slotmux/plugin-tools';

const tokens = estimateTokensFromText('Hello, world!');
// → 4 (ceil(13 / 4))

const truncated = truncateStringToApproxTokens('A very long string...', 100);
// Truncated to ~400 characters (100 tokens * 4 chars/token)
```

## Next

- [Plugins concept](../concepts/plugins) — How slotmux plugins work.
- [RAG plugin](./rag) — Managing retrieval-augmented generation content.
- [Memory plugin](./memory) — Persistent memory across sessions.
