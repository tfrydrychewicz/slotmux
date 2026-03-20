# WASM / native tokenizers (advanced)

The default OpenAI path uses the **`tiktoken`** peer, which ships a **WASM** implementation in Node.js. It is loaded lazily and encoding instances are **pooled per process** (see `TiktokenTokenizer` in `src/tiktoken-adapters.ts`).

## When to use WASM explicitly

- **Latency-sensitive servers** counting large batches: prefer `Tokenizer.countBatch()` so implementations can reuse a single encoder session where the underlying library allows it.
- **Browsers / edge**: if `tiktoken` is unavailable, use **`@slotmux/tokenizers`** fallbacks (`CharEstimatorTokenizer`, `gpt-tokenizer`, or provider-specific adapters) and/or supply a `tokenAccountant` on the core side for authoritative totals.

## Optional tiktoken-wasm variants

For experiments with alternate WASM builds (e.g. precompiled `tiktoken-wasm` bundles), wrap the same `Tokenizer` interface and pass the adapter through `Context.build({ providerAdapters: { … } })`. Core stays tokenizer-agnostic; counting policy is controlled by `tokenAccountant`, `lazyContentItemTokens`, and `requireAuthoritativeTokenCounts` (see design §18.2 / §19.1).
