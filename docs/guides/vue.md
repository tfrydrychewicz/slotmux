# Vue integration

Slotmux's reactive layer uses `Ref`-shaped signals with `.value` and `.subscribe()` — and they carry the `__v_isRef` flag, so Vue 3's reactivity system recognizes them natively. You can use `reactiveContext` directly in a composable with `computed`, `watch`, and `watchEffect`.

## Install

```bash
pnpm add slotmux
```

No separate Vue package is needed. The `slotmux/reactive` subpath export provides `reactiveContext` and the `Ref` primitives.

## Quick start

```typescript
import { reactiveContext } from 'slotmux/reactive';
import { SlotOverflow } from 'slotmux';

const ctx = reactiveContext({
  model: 'gpt-4o-mini',
  maxTokens: 128_000,
  reserveForResponse: 4096,
  strictTokenizerPeers: false,
  slots: {
    system: {
      priority: 100,
      budget: { fixed: 2000 },
      overflow: SlotOverflow.ERROR,
      defaultRole: 'system',
      position: 'before',
    },
    history: {
      priority: 50,
      budget: { flex: true },
      overflow: SlotOverflow.TRUNCATE,
      defaultRole: 'user',
      position: 'after',
    },
  },
});

ctx.system('You are a helpful assistant.');
ctx.user('Hello!');

// ctx.meta.value is SnapshotMeta | undefined
// ctx.utilization.value is number (0–1)
// ctx.buildError.value is Error | undefined
```

Because slotmux refs have `__v_isRef`, Vue's template system unwraps `.value` automatically — `ctx.meta` behaves like a native `ref()` in templates.

## Composable pattern

Wrap `reactiveContext` in a composable so every component in the tree can share the same instance:

```typescript
// composables/useSlotmux.ts
import { computed, onUnmounted, type Ref as VueRef } from 'vue';
import { reactiveContext, type ReactiveContext, type ReactiveContextInit } from 'slotmux/reactive';
import type { SnapshotMeta } from 'slotmux';

let shared: ReactiveContext | undefined;

export function useSlotmux(init?: ReactiveContextInit): {
  ctx: ReactiveContext;
  meta: VueRef<SnapshotMeta | undefined>;
  utilization: VueRef<number>;
  buildError: VueRef<Error | undefined>;
} {
  if (!shared && init) {
    shared = reactiveContext(init);
  }
  if (!shared) {
    throw new Error('useSlotmux: call with init options at least once before use');
  }

  const ctx = shared;

  // Vue recognizes ctx.meta as a ref thanks to __v_isRef.
  // Wrap in computed() for consistent typing with Vue's Ref<T>.
  const meta = computed(() => ctx.meta.value);
  const utilization = computed(() => ctx.utilization.value);
  const buildError = computed(() => ctx.buildError.value);

  return { ctx, meta, utilization, buildError };
}

export function disposeSlotmux(): void {
  shared?.dispose();
  shared = undefined;
}
```

## Using in a component

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSlotmux } from '@/composables/useSlotmux';
import { SlotOverflow } from 'slotmux';
import { formatOpenAIMessages } from '@slotmux/providers';

const { ctx, meta, utilization, buildError } = useSlotmux({
  model: 'gpt-4o-mini',
  maxTokens: 128_000,
  reserveForResponse: 4096,
  strictTokenizerPeers: false,
  slots: {
    system: {
      priority: 100,
      budget: { fixed: 2000 },
      overflow: SlotOverflow.ERROR,
      defaultRole: 'system',
      position: 'before',
    },
    history: {
      priority: 50,
      budget: { flex: true },
      overflow: SlotOverflow.TRUNCATE,
      defaultRole: 'user',
      position: 'after',
    },
  },
});

ctx.system('You are a helpful assistant.');

const input = ref('');
const messages = ref<{ role: string; text: string }[]>([]);

watch(utilization, (val) => {
  if (val > 0.9) {
    console.warn('Context window nearly full:', (val * 100).toFixed(1) + '%');
  }
});

async function send() {
  const text = input.value.trim();
  if (!text) return;

  ctx.user(text);
  messages.value.push({ role: 'user', text });
  input.value = '';

  const { snapshot } = await ctx.build();
  const formatted = formatOpenAIMessages(snapshot.messages);

  const reply = await callYourLLM(formatted);

  ctx.assistant(reply);
  messages.value.push({ role: 'assistant', text: reply });
}
</script>

<template>
  <div class="chat">
    <ul>
      <li v-for="(m, i) in messages" :key="i">
        <b>{{ m.role }}:</b> {{ m.text }}
      </li>
    </ul>

    <input v-model="input" @keyup.enter="send" />
    <button @click="send">Send</button>

    <div v-if="buildError" class="error">
      Build failed: {{ buildError.message }}
    </div>

    <footer v-if="meta">
      {{ meta.totalTokens }} / {{ meta.totalBudget }} tokens
      ({{ (utilization * 100).toFixed(1) }}%)
      · {{ meta.buildTimeMs }} ms
    </footer>
  </div>
</template>
```

## `computed` and `watch`

Since `ctx.meta`, `ctx.utilization`, and `ctx.buildError` are ref-compatible, Vue's reactivity primitives work directly:

```typescript
import { computed, watch, watchEffect } from 'vue';

// Derived state
const slotBreakdown = computed(() => ctx.meta.value?.slots);
const isNearFull = computed(() => ctx.utilization.value > 0.85);
const wastedTokens = computed(() => ctx.meta.value?.waste ?? 0);

// React to changes
watch(() => ctx.meta.value, (newMeta, oldMeta) => {
  if (newMeta && oldMeta) {
    const diff = Number(newMeta.totalTokens) - Number(oldMeta.totalTokens);
    console.log(`Token delta: ${diff > 0 ? '+' : ''}${diff}`);
  }
});

watchEffect(() => {
  if (ctx.buildError.value) {
    showToast(`Build error: ${ctx.buildError.value.message}`);
  }
});
```

## Per-slot stats

The `meta.slots` record gives you per-slot utilization — useful for visual breakdowns:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useSlotmux } from '@/composables/useSlotmux';

const { meta } = useSlotmux();
const slots = computed(() => {
  if (!meta.value) return [];
  return Object.entries(meta.value.slots).map(([name, s]) => ({
    name,
    used: Number(s.usedTokens),
    budget: Number(s.budgetTokens),
    pct: (s.utilization * 100).toFixed(1),
    items: s.itemCount,
  }));
});
</script>

<template>
  <table v-if="slots.length">
    <thead>
      <tr><th>Slot</th><th>Tokens</th><th>Budget</th><th>%</th><th>Items</th></tr>
    </thead>
    <tbody>
      <tr v-for="s in slots" :key="s.name">
        <td>{{ s.name }}</td>
        <td>{{ s.used }}</td>
        <td>{{ s.budget }}</td>
        <td>{{ s.pct }}%</td>
        <td>{{ s.items }}</td>
      </tr>
    </tbody>
  </table>
</template>
```

## Sharing context across the component tree

### Option A: provide / inject

```typescript
// App.vue
import { provide } from 'vue';
import { reactiveContext } from 'slotmux/reactive';

const ctx = reactiveContext({ /* ... */ });
provide('slotmux', ctx);
```

```typescript
// ChildComponent.vue
import { inject } from 'vue';
import type { ReactiveContext } from 'slotmux/reactive';

const ctx = inject<ReactiveContext>('slotmux')!;
const meta = computed(() => ctx.meta.value);
```

### Option B: Pinia store

For apps using Pinia, wrap the `ReactiveContext` in a store:

```typescript
// stores/context.ts
import { defineStore } from 'pinia';
import { reactiveContext, type ReactiveContext } from 'slotmux/reactive';
import { computed, ref } from 'vue';

export const useContextStore = defineStore('slotmux', () => {
  const ctx = ref<ReactiveContext>();

  function init(options) {
    ctx.value = reactiveContext(options);
  }

  const meta = computed(() => ctx.value?.meta.value);
  const utilization = computed(() => ctx.value?.utilization.value ?? 0);

  return { ctx, init, meta, utilization };
});
```

## Cleanup

Call `dispose()` when the context is no longer needed — this cancels pending debounced builds and prevents stale results from writing to the signals:

```typescript
import { onUnmounted } from 'vue';

const { ctx } = useSlotmux();

onUnmounted(() => {
  ctx.dispose();
});
```

## Explicit vs debounced builds

By default, mutations (`ctx.user(...)`, `ctx.push(...)`, etc.) schedule a debounced rebuild after `debounceMs` milliseconds. The debounce coalesces rapid mutations into a single build.

For full control — e.g. when you need the snapshot before calling the LLM — call `ctx.build()` explicitly. This cancels any pending debounce and runs a build immediately:

```typescript
ctx.user(input);
const { snapshot } = await ctx.build();
// snapshot is ready — meta.value is updated
```

## Next steps

- [React integration](./react) — `@slotmux/react` hooks with `useSyncExternalStore`.
- [Angular integration](./angular) — injectable service with Signals.
- [Concepts: Snapshots](/concepts/snapshots) — what's inside `SnapshotMeta`.
- [Concepts: Overflow](/concepts/overflow) — overflow strategies and how they affect builds.
