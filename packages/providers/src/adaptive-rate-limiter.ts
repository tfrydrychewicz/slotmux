/**
 * Adaptive rate limiter using AIMD (Additive Increase / Multiplicative Decrease)
 * concurrency control with circuit-breaker semantics.
 *
 * Solves the thundering-herd problem that occurs when parallel summarization
 * calls all hit a provider's rate limit simultaneously: instead of each call
 * independently retrying (and re-flooding the API), the limiter coordinates
 * across all in-flight calls, pausing the whole batch and reducing concurrency.
 *
 * Concurrency adjustment follows TCP-style congestion control:
 * - **On 429**: halve effective concurrency (multiplicative decrease) and pause
 *   all pending calls for the `Retry-After` duration.
 * - **On success**: increment effective concurrency by 1 (additive increase),
 *   up to the configured ceiling.
 *
 * @packageDocumentation
 */

import { ProviderRateLimitError, parseRetryAfterBody } from './fetch-with-retry.js';

/** Options for {@link createAdaptiveRateLimiter}. */
export type AdaptiveRateLimiterOptions = {
  /**
   * Initial / maximum concurrency ceiling. The limiter will never exceed this.
   * @defaultValue Infinity
   */
  readonly maxConcurrency?: number;
  /**
   * Minimum concurrency floor. The limiter will never drop below this.
   * @defaultValue 1
   */
  readonly minConcurrency?: number;
  /**
   * Maximum retry attempts per call when a {@link ProviderRateLimitError} is caught.
   * @defaultValue 5
   */
  readonly maxRetries?: number;
};

/** Return type of {@link createAdaptiveRateLimiter}. */
export type AdaptiveRateLimiter = {
  /**
   * Executes `fn` with adaptive concurrency gating and rate-limit retry.
   *
   * - Waits for a concurrency slot and any active pause before calling `fn`.
   * - If `fn` throws {@link ProviderRateLimitError}, halves concurrency, pauses
   *   all pending calls, then retries after the pause.
   * - If `fn` succeeds, slowly increases concurrency back toward the ceiling.
   *
   * @throws {ProviderRateLimitError} When all retry attempts are exhausted.
   */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Current effective concurrency limit (may differ from the configured ceiling). */
  readonly concurrency: number;
  /** Number of calls currently in-flight. */
  readonly active: number;
};

/**
 * Creates an adaptive rate limiter that coordinates concurrent API calls.
 *
 * All provider factories use one limiter per instance, wrapping every
 * `summarizeText` call through {@link AdaptiveRateLimiter.run}. This replaces
 * the per-call retry in `fetchWithRetry` with coordinated, concurrency-aware
 * retry at the provider level.
 *
 * @example
 * ```typescript
 * const limiter = createAdaptiveRateLimiter({ maxRetries: 5 });
 *
 * // All calls share the same limiter — 429s reduce concurrency for everyone
 * const results = await Promise.all(
 *   chunks.map(chunk => limiter.run(() => summarize(chunk))),
 * );
 * ```
 */
export function createAdaptiveRateLimiter(opts?: AdaptiveRateLimiterOptions): AdaptiveRateLimiter {
  const ceiling = opts?.maxConcurrency ?? Infinity;
  const floor = opts?.minConcurrency ?? 1;
  const maxRetries = opts?.maxRetries ?? 5;

  let effectiveMax = ceiling;
  let active = 0;
  let pauseUntil = 0;
  const waiters: Array<() => void> = [];

  function wakeWaiters(): void {
    while (waiters.length > 0 && active < effectiveMax) {
      active++;
      const next = waiters.shift()!;
      next();
    }
  }

  async function acquireSlot(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop re-checks after async gaps
    while (true) {
      const now = Date.now();
      if (pauseUntil > now) {
        await sleep(pauseUntil - now);
        continue;
      }

      if (active < effectiveMax) {
        active++;
        return;
      }

      // Park until wakeWaiters resolves us — it increments active on our behalf
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      return;
    }
  }

  function releaseSlot(): void {
    active--;
    wakeWaiters();
  }

  function onRateLimit(err: ProviderRateLimitError): void {
    const waitMs = parseRetryAfterBody(err.responseBody) ?? 1000;
    pauseUntil = Math.max(pauseUntil, Date.now() + waitMs);

    if (!isFinite(effectiveMax)) {
      // First rate limit from Infinity — drop to half of current in-flight
      effectiveMax = Math.max(floor, Math.ceil((active + 1) / 2));
    } else {
      effectiveMax = Math.max(floor, Math.floor(effectiveMax / 2));
    }
  }

  function onSuccess(): void {
    if (effectiveMax < ceiling) {
      effectiveMax = Math.min(ceiling, effectiveMax + 1);
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await acquireSlot();
        try {
          const result = await fn();
          onSuccess();
          return result;
        } catch (e) {
          if (e instanceof ProviderRateLimitError && attempt < maxRetries) {
            onRateLimit(e);
            lastError = e;
            continue;
          }
          throw e;
        } finally {
          releaseSlot();
        }
      }

      throw lastError;
    },

    get concurrency() {
      return effectiveMax;
    },
    get active() {
      return active;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
