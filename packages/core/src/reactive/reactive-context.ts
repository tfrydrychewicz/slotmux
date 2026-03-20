/**
 * Reactive context wrapper — debounced auto-build and signal-shaped `meta` / `utilization` (§14.2).
 *
 * @packageDocumentation
 */

import type { ContextBuildParams } from '../context/build-overrides.js';
import type { ContextBuildStream } from '../context/context-build-stream.js';
import type { ContextCheckpoint } from '../context/context-checkpoint.js';
import type { ContextOrchestratorBuildResult } from '../context/context-orchestrator.js';
import { Context, type ContextPushItemInput } from '../context/context.js';
import {
  createContext,
  type CreateContextOptions,
} from '../context/create-context.js';
import type { ContentId } from '../types/branded.js';
import type { SlotConfig } from '../types/config.js';
import type { ContentItem, MultimodalContent } from '../types/content.js';
import type { ContextEvent } from '../types/events.js';
import type { SnapshotMeta } from '../types/snapshot.js';

import { computedRef, ref, type ReadonlyRef, type Ref } from './ref.js';

export type ReactiveContextInit = CreateContextOptions & {
  /**
   * Delay before running {@link Context.build} after a mutating call (default `50`).
   * Use `0` to schedule a macrotask-only coalescing via `setTimeout(0)`.
   */
  readonly debounceMs?: number;
  /** Passed to every automatic and explicit {@link ReactiveContext.build} unless overridden per call. */
  readonly defaultBuildParams?: ContextBuildParams;
  /**
   * Invoked when a build fails (initial, debounced, {@link ReactiveContext.build}, or
   * {@link ReactiveContext.buildStream} `finished` rejection). Runs after {@link ReactiveContext.buildError}
   * is set. Exceptions from this callback are swallowed.
   */
  readonly onBuildError?: (error: unknown) => void;
};

/**
 * {@link Context} with debounced recompilation and reactive {@link SnapshotMeta} on `meta.value`.
 *
 * Builds are **serialized** (one `Context.build` at a time). Debounced and initial runs use a generation
 * counter so stale results never overwrite newer {@link ReactiveContext.meta}. Explicit {@link ReactiveContext.build}
 * always applies its result to `meta` when it succeeds.
 */
export class ReactiveContext {
  readonly #ctx: Context;

  readonly #debounceMs: number;

  readonly #defaultBuildParams: ContextBuildParams | undefined;

  readonly #onBuildError: ((error: unknown) => void) | undefined;

  #debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Monotonic counter: incremented when starting a new logical build wave so stale async completions
   * skip applying to {@link ReactiveContext.meta}.
   */
  #buildGeneration = 0;

  /** Serialized execution of all `Context.build` calls (initial, debounced, explicit). */
  #chain: Promise<unknown> = Promise.resolve();

  /** Latest snapshot metadata from the most recent successful build (auto or explicit). */
  readonly meta: Ref<SnapshotMeta | undefined>;

  /** Overall utilization ratio (`meta.value?.utilization ?? 0`). Updates when `meta` updates. */
  readonly utilization: ReadonlyRef<number>;

  /** Set when the last failed build was automatic, explicit, or streaming; cleared on success. */
  readonly buildError: Ref<Error | undefined>;

  private constructor(
    ctx: Context,
    options: {
      debounceMs: number;
      defaultBuildParams?: ContextBuildParams;
      onBuildError?: (error: unknown) => void;
    },
  ) {
    this.#ctx = ctx;
    this.#debounceMs = options.debounceMs;
    this.#defaultBuildParams = options.defaultBuildParams;
    this.#onBuildError = options.onBuildError;
    this.meta = ref<SnapshotMeta | undefined>(undefined);
    this.utilization = computedRef(this.meta, (m) => m?.utilization ?? 0);
    this.buildError = ref<Error | undefined>(undefined);
  }

  /**
   * Validates config, constructs {@link Context}, and kicks an initial {@link Context.build} to
   * populate {@link ReactiveContext.meta} (async — `meta.value` may stay `undefined` briefly).
   */
  static create(init: ReactiveContextInit): ReactiveContext {
    const { debounceMs = 50, defaultBuildParams, onBuildError, ...createOpts } = init;
    const { config } = createContext(createOpts);
    const ctx = Context.fromParsedConfig(config);
    const rc = new ReactiveContext(ctx, {
      debounceMs,
      ...(defaultBuildParams !== undefined ? { defaultBuildParams } : {}),
      ...(onBuildError !== undefined ? { onBuildError } : {}),
    });
    void rc.#initialBuild();
    return rc;
  }

  /** Underlying mutable context (escape hatch). */
  get context(): Context {
    return this.#ctx;
  }

  #setBuildFailure(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.buildError.value = err;
    if (this.#onBuildError !== undefined) {
      try {
        this.#onBuildError(error);
      } catch {
        /* isolate user handler */
      }
    }
  }

  #clearBuildFailure(): void {
    this.buildError.value = undefined;
  }

  /** Runs `fn` after all prior chained work; extends the chain with `fn`’s settlement. */
  #runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(() => fn());
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * First populate — no generation gate so a synchronous {@link ReactiveContext.buildStream} cannot
   * permanently skip the first snapshot (callers should still wait for `meta` before streaming in production).
   */
  async #initialBuild(): Promise<void> {
    await this.#runExclusive(async () => {
      try {
        const r = await this.#ctx.build(this.#defaultBuildParams);
        this.meta.value = r.snapshot.meta;
        this.#clearBuildFailure();
      } catch (e) {
        this.#setBuildFailure(e);
      }
    });
  }

  #cancelDebounce(): void {
    if (this.#debounceTimer !== undefined) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = undefined;
    }
  }

  #scheduleRebuild(): void {
    this.#cancelDebounce();
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined;
      const gen = ++this.#buildGeneration;
      void this.#runExclusive(async () => {
        try {
          const r = await this.#ctx.build(this.#defaultBuildParams);
          if (gen !== this.#buildGeneration) {
            return;
          }
          this.meta.value = r.snapshot.meta;
          this.#clearBuildFailure();
        } catch (e) {
          if (gen !== this.#buildGeneration) {
            return;
          }
          this.#setBuildFailure(e);
        }
      });
    }, this.#debounceMs);
  }

  /**
   * Cancels any pending debounced build, bumps the build generation (so in-flight work won’t apply),
   * and clears the debounce timer. Safe to call more than once.
   */
  dispose(): void {
    this.#cancelDebounce();
    this.#buildGeneration += 1;
  }

  mergeBuildParams(override?: ContextBuildParams): ContextBuildParams | undefined {
    if (this.#defaultBuildParams === undefined) {
      return override;
    }
    if (override === undefined) {
      return this.#defaultBuildParams;
    }
    return { ...this.#defaultBuildParams, ...override };
  }

  async build(params?: ContextBuildParams): Promise<ContextOrchestratorBuildResult> {
    this.#cancelDebounce();
    this.#buildGeneration += 1;
    const merged = this.mergeBuildParams(params);
    return this.#runExclusive(async () => {
      try {
        const r = await this.#ctx.build(merged);
        this.meta.value = r.snapshot.meta;
        this.#clearBuildFailure();
        return r;
      } catch (e) {
        this.#setBuildFailure(e);
        throw e;
      }
    });
  }

  buildStream(params?: ContextBuildParams): ContextBuildStream {
    this.#cancelDebounce();
    const streamGen = ++this.#buildGeneration;
    const stream = this.#ctx.buildStream(this.mergeBuildParams(params));
    void stream.finished
      .then((r) => {
        void this.#runExclusive(async () => {
          if (streamGen !== this.#buildGeneration) {
            return;
          }
          this.meta.value = r.snapshot.meta;
          this.#clearBuildFailure();
        });
      })
      .catch((e: unknown) => {
        void this.#runExclusive(async () => {
          if (streamGen !== this.#buildGeneration) {
            return;
          }
          this.#setBuildFailure(e);
        });
      });
    return stream;
  }

  getItems(slot: string): ContentItem[] {
    return this.#ctx.getItems(slot);
  }

  get registeredSlots(): string[] {
    return this.#ctx.registeredSlots;
  }

  getSlotsConfig(): Readonly<Record<string, SlotConfig>> | undefined {
    return this.#ctx.getSlotsConfig();
  }

  subscribeInspectorEvents(handler: (event: ContextEvent) => void): () => void {
    return this.#ctx.subscribeInspectorEvents(handler);
  }

  dispatchInspectorEvent(event: ContextEvent): void {
    this.#ctx.dispatchInspectorEvent(event);
  }

  system(content: string | readonly MultimodalContent[]): void {
    this.#ctx.system(content);
    this.#scheduleRebuild();
  }

  user(content: string | readonly MultimodalContent[]): void {
    this.#ctx.user(content);
    this.#scheduleRebuild();
  }

  assistant(content: string | readonly MultimodalContent[]): void {
    this.#ctx.assistant(content);
    this.#scheduleRebuild();
  }

  push(
    slot: string,
    payload: string | readonly MultimodalContent[] | readonly ContextPushItemInput[],
  ): void {
    this.#ctx.push(slot, payload);
    this.#scheduleRebuild();
  }

  pin(slot: string, itemOrId: ContentItem | Pick<ContentItem, 'id'> | ContentId): void {
    this.#ctx.pin(slot, itemOrId);
    this.#scheduleRebuild();
  }

  ephemeral(slot: string, itemOrId: ContentItem | Pick<ContentItem, 'id'> | ContentId): void {
    this.#ctx.ephemeral(slot, itemOrId);
    this.#scheduleRebuild();
  }

  clearEphemeral(): void {
    this.#ctx.clearEphemeral();
    this.#scheduleRebuild();
  }

  checkpoint(): ContextCheckpoint {
    return this.#ctx.checkpoint();
  }

  restore(checkpoint: ContextCheckpoint): void {
    this.#ctx.restore(checkpoint);
    this.#scheduleRebuild();
  }
}

/**
 * Factory: validated config + {@link ReactiveContext} with debounced auto-build (§14.2).
 */
export function reactiveContext(init: ReactiveContextInit): ReactiveContext {
  return ReactiveContext.create(init);
}
