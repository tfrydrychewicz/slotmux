# Providers

Slotmux separates context assembly from provider wire format. You work with a provider-agnostic `Context` and `ContextSnapshot`. When it's time to call an LLM API, you format the snapshot for your target provider.

## The adapter interface

Each provider is represented by a `ProviderAdapter`:

```typescript
interface ProviderAdapter {
  readonly id: ProviderId;
  resolveModel(modelId: ModelId): ModelCapabilities;
  formatMessages(messages: readonly CompiledMessage[]): unknown;
  getTokenizer(modelId: ModelId): Tokenizer;
  calculateOverhead(messages: readonly CompiledMessage[]): TokenCount;
}
```

| Method | Purpose |
| --- | --- |
| `resolveModel` | Looks up the model's capabilities (context window size, tokenizer, feature flags). |
| `formatMessages` | Converts slotmux's `CompiledMessage[]` into the provider's native shape. |
| `getTokenizer` | Returns the correct tokenizer for token counting. |
| `calculateOverhead` | Computes structural tokens the provider adds (role delimiters, conversation framing). |

## Provider factories

Provider **factories** extend adapters with the ability to **call** the LLM for auxiliary tasks — summarization for overflow, embeddings for semantic compression. This means strategies like `overflow: 'summarize'` work automatically without manual wiring.

### Quick start

```typescript
import { openai } from '@slotmux/providers';
import { createContext, Context } from 'slotmux';

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'chat',
  slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY! }),
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful assistant.');
ctx.user('Hello!');

const { snapshot } = await ctx.build();
// overflow: 'summarize' on the history slot just works — the provider
// knows how to call the OpenAI API for summarization automatically.
```

### Progressive disclosure

| Level | What you configure | What happens |
| --- | --- | --- |
| **0** (beginner) | `openai({ apiKey })` | Summarization uses `gpt-5.4-mini` via the OpenAI API. |
| **1** (intermediate) | `openai({ apiKey, compressionModel: 'gpt-5.4-nano' })` | You control which model does compression. |
| **2** (advanced) | `openai({ apiKey, summarize: myFn, embed: myEmbedFn })` | You provide custom summarization and/or embedding functions. |
| **3** (expert) | Direct `progressiveSummarize` injection on the overflow engine | Full control, bypass the factory entirely. |

### Available factories

| Factory | Import | Default compression model |
| --- | --- | --- |
| `openai()` | `@slotmux/providers` | `gpt-5.4-mini` |
| `anthropic()` | `@slotmux/providers` | `claude-3-5-haiku-20241022` |
| `google()` | `@slotmux/providers` | `gemini-2.0-flash` |
| `mistral()` | `@slotmux/providers` | `mistral-small-latest` |
| `ollama()` | `@slotmux/providers` | Same as context model |

Each factory accepts `SlotmuxProviderOptions`:

```typescript
type SlotmuxProviderOptions = {
  apiKey: string;
  compressionModel?: string;     // model for summarization calls
  baseUrl?: string;              // API endpoint override (proxies, Azure, self-hosted)
  summarize?: (system: string, user: string) => Promise<string>;  // custom summarizer
  embed?: (text: string) => Promise<number[]>;                    // custom embeddings
};
```

Ollama's `apiKey` is optional (local instances don't require one).

### What the factory provides

Each factory returns a `SlotmuxProvider` — an adapter bundled with LLM call capabilities:

```typescript
type SlotmuxProvider = {
  adapter: ProviderAdapter;      // message formatting + tokenizer
  summarizeText?: Function;      // auto-wired into overflow engine
  mapReduce?: Object;            // bulk content compression
  embed?: Function;              // semantic overflow
};
```

When you pass `slotmuxProvider` to `createContext()`, the orchestrator automatically:

1. Wires `summarizeText` into the overflow engine so `overflow: 'summarize'` works.
2. Registers the adapter for `snapshot.format()` so you can format messages without separate setup.

## Supported providers

| Provider | Adapter | Package | Format function |
| --- | --- | --- | --- |
| OpenAI | `OpenAIAdapter` | `@slotmux/providers` | `formatOpenAIMessages()` |
| Anthropic | `AnthropicAdapter` | `@slotmux/providers` | `formatAnthropicMessages()` |
| Google (Gemini) | `GoogleAdapter` | `@slotmux/providers` | `formatGeminiMessages()` |
| Mistral | `MistralAdapter` | `@slotmux/providers` | `formatMistralMessages()` |
| Ollama | `OllamaAdapter` | `@slotmux/providers` | `formatOllamaMessages()` |

## Formatting a snapshot

After building, format the compiled messages for any provider:

```typescript
import { formatOpenAIMessages, formatAnthropicMessages } from '@slotmux/providers';

const { snapshot } = await ctx.build();

const openaiMessages = formatOpenAIMessages(snapshot.messages);
// → [{ role: 'system', content: '...' }, { role: 'user', content: '...' }, ...]

const anthropicPayload = formatAnthropicMessages(snapshot.messages);
// → { system: '...', messages: [{ role: 'user', content: '...' }, ...] }
```

Each formatter handles provider-specific concerns:

- **OpenAI** — `{ role, content }` objects. System messages come first. Tool calls use `tool_call_id`. Multimodal content uses `image_url` parts.
- **Anthropic** — System message extracted to a top-level `system` field. Only `user` and `assistant` roles in the `messages` array. Consecutive same-role messages are collapsed. Images use `base64` source blocks.
- **Google** — `systemInstruction.parts` for system messages. Content uses `parts` with `text`, `inlineData`, `functionCall`, and `functionResponse` types.
- **Mistral** — OpenAI-compatible `{ role, content }` shape.
- **Ollama** — Simplified `{ role, content }` for the `/api/chat` endpoint.

## Text format

For debugging or non-LLM uses, format as plain text:

```typescript
const text = snapshot.format('text');
// → "system: You are a helpful assistant.\nuser: Hello!\n..."
```

## Model registry

Slotmux ships a built-in `MODEL_REGISTRY` that maps model IDs to their capabilities:

```typescript
// These are resolved automatically when you pass a model string:
createContext({ model: 'gpt-5.4' });
// → infers: maxTokens=128000, provider=openai, tokenizer=o200k_base

createContext({ model: 'claude-sonnet-4-20250514' });
// → infers: maxTokens=200000, provider=anthropic
```

### Sample registry entries

| Model | Provider | Context window | Tokenizer |
| --- | --- | --- | --- |
| `gpt-5.4` | openai | 128 000 | o200k_base |
| `gpt-5.4-mini` | openai | 128 000 | o200k_base |
| `gpt-4-turbo` | openai | 128 000 | cl100k_base |
| `o1` / `o3` / `o3-mini` | openai | 200 000 | o200k_base |
| `gpt-5.4` | openai | 1 000 000 | o200k_base |
| `claude-sonnet-4-6-*` | anthropic | 1 000 000 | — |
| `claude-3-5-haiku-*` | anthropic | 200 000 | — |
| `gemini-2.5-pro` | google | 1 048 576 | — |
| `gemini-2.0-flash` | google | 1 000 000 | — |
| `mistral-large-latest` | mistral | 128 000 | — |
| `codestral-latest` | mistral | 256 000 | — |
| `ollama/llama3.1` | ollama | 131 072 | — |

## Auto-detection

When `createContext()` receives a model string, it resolves capabilities in this order:

1. **Exact match** — look up the full model ID in `MODEL_REGISTRY`.
2. **Prefix fallback** — try progressively shorter prefixes (`gpt-5.4-nano` → `gpt-5.4` → `gpt-5`).
3. **Provider inference** — if no match, infer the provider from naming patterns (`gpt-*` → openai, `claude*` → anthropic, `gemini*` → google, `ollama/*` → ollama, mistral family → mistral).

The resolved values fill in `maxTokens`, `provider.provider`, and `tokenizer.name` when you don't set them explicitly.

## Registering custom models

For models not in the built-in registry (fine-tunes, self-hosted, new releases), use `registerModel`:

```typescript
import { registerModel } from 'slotmux';

registerModel('my-fine-tune', {
  maxTokens: 32_000,
  provider: 'openai',
  tokenizerName: 'o200k_base',
});

createContext({ model: 'my-fine-tune' });
// → uses the registered capabilities
```

## Token overhead

Different providers add structural tokens on top of your content:

| Provider | Per message | Per conversation | Per name field |
| --- | --- | --- | --- |
| OpenAI | 4 | 2 | 1 |
| Anthropic | 3 | 1 | 0 |
| Google | 4 | 2 | 0 |
| Mistral | 4 | 2 | 1 |
| Ollama | 4 | 2 | 1 |

These overheads are accounted for automatically when counting tokens for budget resolution. Unknown provider IDs fall back to OpenAI-style defaults.

For Ollama, you can customize overhead per deployment:

```typescript
import { ollamaOverhead } from 'slotmux';

const overhead = ollamaOverhead({ perMessage: 2, perConversation: 0 });
```

## When to use `@slotmux/providers` vs core

The **core** package (`slotmux`) handles context assembly, budgets, overflow, and snapshots. It produces `CompiledMessage[]` — a provider-agnostic intermediate format.

The **providers** package (`@slotmux/providers`) converts that intermediate format to provider-specific wire formats. You only need it when actually calling an LLM API.

```
slotmux (core)                     @slotmux/providers
─────────────                      ──────────────────
createContext()                    formatOpenAIMessages()
ctx.user() / ctx.push()           formatAnthropicMessages()
ctx.build() → snapshot.messages    formatGeminiMessages()
                                   formatMistralMessages()
                                   formatOllamaMessages()
```

If you're building a library on top of slotmux, depend on core only. Let your users bring `@slotmux/providers` for the provider they use.

## Next

- [Token counting](./token-counting) — how tokens are counted per provider.
- [Multi-model guide](/guides/multi-model) — switching providers with the same context.
- [Budgets](./budgets) — how token budgets interact with model context windows.
