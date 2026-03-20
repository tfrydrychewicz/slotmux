# Performance tuning

Slotmux is designed to be fast by default — sub-millisecond token counting, cached results, and lazy evaluation. This guide covers the knobs you can turn when you need to squeeze out more performance or handle very large contexts.

## Performance targets

These are slotmux's design-level performance targets. CI enforces them with a 1.6x tolerance to account for shared-runner variance. Your local hardware will typically beat these numbers.

| Operation | Target | Conditions |
| --- | --- | --- |
| Single message token count | mean < 0.1ms | Cached tokenizer |
| Token cache hit | p99 < 1ms per hit | L1 cache (warm keys) |
| `Context.build()` | p99 < 5ms | 100 messages, 3 slots |
| `Context.build()` | p99 < 20ms | 1000 messages, 5 slots |
| `BudgetAllocator.resolve` | p99 < 0.5ms | 20 slots |
| `ContextSnapshot.serialize` | p99 < 10ms | ~50K token payload |

If your builds are significantly slower than these targets, something is misconfigured or you've hit an edge case this guide can help with.

## Lazy token counting

By default, slotmux counts tokens **lazily** — the `tokens` field on each `ContentItem` is computed on first access via a Proxy, then cached:

```typescript
createContext({
  model: 'gpt-5.4',
  lazyContentItemTokens: true,  // default
});
```

Benefits:
- Pushing 1000 messages doesn't trigger 1000 BPE encodings immediately.
- Tokens are counted only when the build pipeline needs them.
- Subsequent accesses read the cached value.

Disable with `lazyContentItemTokens: false` if you want tokens computed eagerly on insertion (useful for debugging or when you need immediate token counts).

## Character estimation

For non-critical paths where approximate counts are acceptable, use character estimation instead of real tokenization:

```typescript
createContext({
  model: 'gpt-5.4',
  charTokenEstimateForMissing: true,
});
```

This estimates tokens as `text.length / 4` without invoking the tokenizer. Useful for:
- Preview/draft UIs where exact counts don't matter.
- Server-side rendering where tokenizer WASM isn't available.
- Rapid prototyping before installing tokenizer peer dependencies.

`charTokenEstimateForMissing` and `lazyContentItemTokens` are mutually exclusive — the validator enforces this.

## Token count cache

The `TokenCountCache` uses a two-tier architecture:

```
L1: LRU cache (10,000 entries)  — sub-microsecond lookups
L2: Map (unbounded)             — survives LRU eviction
```

Cache keys are `SHA-256(tokenizer.id + content)`. Since content items are immutable once created, cache entries never need invalidation.

### Sizing the cache

The default L1 capacity of 10,000 entries covers most applications. For very large contexts:

```typescript
import { TokenCountCache } from '@slotmux/tokenizers';

const cache = new TokenCountCache({ l1Capacity: 50_000 });
```

### Monitoring cache performance

```typescript
const metrics = cache.getMetrics();
console.log(`L1 hits: ${metrics.l1Hits}, L2 hits: ${metrics.l2Hits}, misses: ${metrics.misses}`);

const hitRate = (metrics.l1Hits + metrics.l2Hits) / (metrics.l1Hits + metrics.l2Hits + metrics.misses);
console.log(`Hit rate: ${(hitRate * 100).toFixed(1)}%`);
```

A hit rate below 90% suggests your content changes frequently — consider increasing L1 capacity or reviewing whether content is being recreated unnecessarily.

## Batch token counting

`Tokenizer.countBatch()` processes multiple strings in a single call, reusing encoder state:

```typescript
const counts = tokenizer.countBatch(['Hello world', 'How are you?', 'Goodbye']);
```

The build pipeline uses batch counting internally when filling lazy token values for a slot's items. This is faster than counting strings individually in a loop.

## Structural sharing

When building repeatedly (e.g. after each user message in a chat), many messages stay the same between builds. Structural sharing reuses message object references from the previous snapshot:

```typescript
let previousSnapshot: ContextSnapshot | undefined;

async function buildAndSend(ctx: Context) {
  const { snapshot } = await ctx.build({
    previousSnapshot,
    structuralSharing: true,
  });
  previousSnapshot = snapshot;
  return snapshot;
}
```

When structural sharing is on:
- Each compiled message is compared (by JSON serialization) to the same-index message in the previous snapshot.
- Identical messages reuse the previous object reference — no cloning needed.
- Only changed messages are cloned.

This reduces memory allocation and GC pressure. Structural sharing is only available when both the current and previous snapshots are immutable (the default).

## Reusing unchanged snapshots

For the fastest path — skip the entire build pipeline when nothing changed:

```typescript
const { snapshot } = await ctx.build({
  reuseUnchangedSnapshot: true,
});
```

When `reuseUnchangedSnapshot` is `true`, slotmux fingerprints the current slot contents. If the fingerprint matches the last build, the previous result is returned without running budget resolution, overflow, or snapshot creation.

Constraints:
- Don't use with per-build `providerAdapters`, `pluginManager`, or changing `overrides`.
- The fingerprint only covers content items — if you change config between builds, the cache may return stale results.

## Immutable snapshots

By default, snapshots are deeply frozen with `Object.freeze()`. This provides safety guarantees but has a small cost for large snapshots:

```typescript
createContext({
  model: 'gpt-5.4',
  immutableSnapshots: false,  // skip Object.freeze()
});
```

Disabling immutability saves the freeze overhead but means you must be careful not to mutate snapshot data. Structural sharing requires immutable snapshots (it's disabled when `immutableSnapshots` is `false`).

## Profiling a build

Use the built-in event system to measure build performance:

```typescript
createContext({
  model: 'gpt-5.4',
  onEvent(event) {
    if (event.type === 'build:complete') {
      const { buildTimeMs, utilization, totalTokens } = event.snapshot.meta;
      console.log(`Build: ${buildTimeMs}ms, ${utilization * 100}% utilization, ${totalTokens} tokens`);
    }
  },
});
```

For deeper profiling, attach the [debug inspector](/guides/debug-inspector) and watch the token budget waterfall and build timeline.

## Configuration quick reference

| Option | Default | Effect |
| --- | --- | --- |
| `lazyContentItemTokens` | `true` | Defer token counting to first access |
| `charTokenEstimateForMissing` | `false` | Use `length/4` instead of real tokenizer |
| `immutableSnapshots` | `true` | Freeze snapshots with `Object.freeze()` |
| `structuralSharing` | `true` (when `previousSnapshot` is set) | Reuse identical message references |
| `reuseUnchangedSnapshot` | `false` | Skip build when content hasn't changed |
| `requireAuthoritativeTokenCounts` | `false` | Throw if token accountant is missing |

## Performance checklist

1. **Are you using lazy token counting?** Default `true` — leave it on unless you need eager counts.
2. **Is your cache hit rate high?** Check `cache.getMetrics()`. Below 90% may indicate unnecessary content recreation.
3. **Are you passing `previousSnapshot`?** Structural sharing saves allocation on repeated builds.
4. **Is `reuseUnchangedSnapshot` viable?** If your build params don't change, this skips the entire pipeline.
5. **Do you need immutable snapshots?** If you never mutate snapshots, disabling freeze saves a small amount of time on large payloads.
6. **Are builds under 20ms?** If not, check slot count, content volume, and whether compression strategies are running unnecessarily.

## Next

- [Token counting concept](/concepts/token-counting) — tokenizer internals and caching.
- [Error handling](./error-handling) — what happens when performance budgets are hit.
- [Debug inspector](/guides/debug-inspector) — visual profiling of builds.
