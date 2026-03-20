import type { SnapshotMeta } from 'slotmux';
import { reactiveContext } from 'slotmux/reactive';
import { ref, computed, onUnmounted } from 'vue';

const rctx = reactiveContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  reserveForResponse: 4096,
  charTokenEstimateForMissing: true,
});

rctx.system('You are a helpful assistant.');

export function useSlotmux() {
  const meta = ref<SnapshotMeta | null>(null);
  const error = ref<unknown>(null);

  const unsub = rctx.meta.subscribe(() => {
    meta.value = rctx.meta.value ?? null;
  });

  const unsubErr = rctx.buildError.subscribe(() => {
    error.value = rctx.buildError.value;
  });

  onUnmounted(() => {
    unsub();
    unsubErr();
  });

  const utilization = computed(() => meta.value?.utilization ?? 0);
  const totalTokens = computed(() => meta.value?.totalTokens ?? 0);

  return {
    rctx,
    meta,
    error,
    utilization,
    totalTokens,
    user: (content: string) => rctx.user(content),
    assistant: (content: string) => rctx.assistant(content),
    build: () => rctx.build(),
  };
}
