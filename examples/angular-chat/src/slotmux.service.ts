/**
 * Angular injectable service wrapping slotmux ReactiveContext.
 *
 * Copy this into your Angular project's `src/app/` directory.
 *
 * Usage in a component:
 *   constructor(public slotmux: SlotmuxService) {}
 *   // template: {{ slotmux.totalTokens() }} tokens
 */

import { Injectable, signal, type OnDestroy } from '@angular/core';
import type { SnapshotMeta } from 'slotmux';
import { reactiveContext, type ReactiveContext } from 'slotmux/reactive';

@Injectable({ providedIn: 'root' })
export class SlotmuxService implements OnDestroy {
  private readonly rctx: ReactiveContext = reactiveContext({
    model: 'gpt-5.4-mini',
    preset: 'chat',
    reserveForResponse: 4096,
    charTokenEstimateForMissing: true,
  });

  /** Reactive snapshot metadata — bind in template with `slotmux.meta()`. */
  readonly meta = signal<SnapshotMeta | null>(null);

  /** Reactive utilization (0–1) — bind with `slotmux.utilization()`. */
  readonly utilization = signal(0);

  /** Reactive total tokens — bind with `slotmux.totalTokens()`. */
  readonly totalTokens = signal(0);

  /** Build error if the last build failed. */
  readonly buildError = signal<unknown>(null);

  private readonly unsubs: Array<() => void> = [];

  constructor() {
    this.rctx.system('You are a helpful assistant.');

    this.unsubs.push(
      this.rctx.meta.subscribe(() => {
        const m = this.rctx.meta.value;
        this.meta.set(m ?? null);
        this.totalTokens.set(m?.totalTokens ?? 0);
      }),
    );

    this.unsubs.push(
      this.rctx.utilization.subscribe(() => {
        this.utilization.set(this.rctx.utilization.value);
      }),
    );

    this.unsubs.push(
      this.rctx.buildError.subscribe(() => {
        this.buildError.set(this.rctx.buildError.value);
      }),
    );
  }

  /** Send a user message via the context. */
  user(content: string): void {
    this.rctx.user(content);
  }

  /** Record an assistant response in the context. */
  assistant(content: string): void {
    this.rctx.assistant(content);
  }

  async build(): Promise<void> {
    await this.rctx.build();
  }

  ngOnDestroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.rctx.dispose();
  }
}
