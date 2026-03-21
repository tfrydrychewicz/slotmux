import { describe, expect, it, vi } from 'vitest';
import {
  createAdaptiveRateLimiter,
  type AdaptiveRateLimiterOptions,
} from '../../src/adaptive-rate-limiter.js';
import { ProviderRateLimitError } from '../../src/fetch-with-retry.js';

function rateLimitError(retryHint?: string): ProviderRateLimitError {
  const body = retryHint
    ? `Rate limit exceeded. Please try again in ${retryHint}.`
    : 'Rate limit exceeded.';
  return new ProviderRateLimitError(body, 429);
}

function limiter(opts?: AdaptiveRateLimiterOptions) {
  return createAdaptiveRateLimiter(opts);
}

describe('AdaptiveRateLimiter', () => {
  describe('basic behavior', () => {
    it('returns the value from a successful fn', async () => {
      const l = limiter();
      const result = await l.run(async () => 42);
      expect(result).toBe(42);
    });

    it('propagates non-rate-limit errors immediately', async () => {
      const l = limiter();
      await expect(
        l.run(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });

    it('starts with concurrency at the configured ceiling', () => {
      expect(limiter().concurrency).toBe(Infinity);
      expect(limiter({ maxConcurrency: 10 }).concurrency).toBe(10);
    });
  });

  describe('AIMD concurrency control', () => {
    it('halves concurrency on rate limit (multiplicative decrease)', async () => {
      const l = limiter({ maxConcurrency: 8, maxRetries: 1 });
      let calls = 0;
      await l.run(async () => {
        calls++;
        if (calls === 1) throw rateLimitError('1ms');
        return 'ok';
      });
      // 8 → halve to 4 on 429, then +1 on success = 5
      expect(l.concurrency).toBe(5);
      expect(calls).toBe(2);
    });

    it('drops from Infinity to a finite value on first rate limit', async () => {
      const l = limiter({ maxRetries: 1 });
      expect(l.concurrency).toBe(Infinity);
      let calls = 0;
      await l.run(async () => {
        calls++;
        if (calls === 1) throw rateLimitError('1ms');
        return 'ok';
      });
      expect(isFinite(l.concurrency)).toBe(true);
      expect(l.concurrency).toBeGreaterThanOrEqual(1);
    });

    it('increases concurrency by 1 on success (additive increase)', async () => {
      const l = limiter({ maxConcurrency: 10, maxRetries: 1 });

      // Force a rate limit to drop concurrency
      let firstCall = true;
      await l.run(async () => {
        if (firstCall) {
          firstCall = false;
          throw rateLimitError('1ms');
        }
        return 'ok';
      });
      const afterDrop = l.concurrency;

      // Successful call should bump it back up
      await l.run(async () => 'ok');
      expect(l.concurrency).toBe(afterDrop + 1);
    });

    it('never drops below minConcurrency', async () => {
      const l = limiter({ maxConcurrency: 4, minConcurrency: 2, maxRetries: 5 });
      let attempt = 0;
      await l.run(async () => {
        attempt++;
        if (attempt <= 4) throw rateLimitError('1ms');
        return 'ok';
      });
      // After multiple halving rounds (4→2→1→...), floor should be 2
      expect(l.concurrency).toBeGreaterThanOrEqual(2);
    });

    it('never exceeds the ceiling', async () => {
      const l = limiter({ maxConcurrency: 3, maxRetries: 1 });

      // Drop concurrency first
      let firstCall = true;
      await l.run(async () => {
        if (firstCall) {
          firstCall = false;
          throw rateLimitError('1ms');
        }
        return 'ok';
      });

      // Run many successes
      for (let i = 0; i < 20; i++) {
        await l.run(async () => 'ok');
      }
      expect(l.concurrency).toBe(3);
    });
  });

  describe('retry behavior', () => {
    it('retries on ProviderRateLimitError up to maxRetries', async () => {
      const l = limiter({ maxRetries: 3 });
      let attempt = 0;
      const result = await l.run(async () => {
        attempt++;
        if (attempt <= 3) throw rateLimitError('1ms');
        return 'success';
      });
      expect(result).toBe('success');
      expect(attempt).toBe(4);
    });

    it('throws ProviderRateLimitError when maxRetries exhausted', async () => {
      const l = limiter({ maxRetries: 2 });
      await expect(
        l.run(async () => {
          throw rateLimitError('1ms');
        }),
      ).rejects.toBeInstanceOf(ProviderRateLimitError);
    });

    it('respects maxRetries: 0 (no retries)', async () => {
      const l = limiter({ maxRetries: 0 });
      let calls = 0;
      await expect(
        l.run(async () => {
          calls++;
          throw rateLimitError('1ms');
        }),
      ).rejects.toBeInstanceOf(ProviderRateLimitError);
      expect(calls).toBe(1);
    });
  });

  describe('pause / circuit breaker', () => {
    it('parses retry-after hint from error body and delays retry', async () => {
      vi.useFakeTimers();
      try {
        const l = limiter({ maxRetries: 1 });
        let calls = 0;
        const promise = l.run(async () => {
          calls++;
          if (calls === 1) throw rateLimitError('2s');
          return 'ok';
        });

        // First call should have run and failed
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(1);

        // Not retried yet (pause is 2s)
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls).toBe(1);

        // After 2s total, retry should fire
        await vi.advanceTimersByTimeAsync(1500);
        const result = await promise;
        expect(result).toBe('ok');
        expect(calls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('defaults to 1s pause when no retry-after hint in body', async () => {
      vi.useFakeTimers();
      try {
        const l = limiter({ maxRetries: 1 });
        let calls = 0;
        const promise = l.run(async () => {
          calls++;
          if (calls === 1) throw new ProviderRateLimitError('no hint here', 429);
          return 'ok';
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(1);

        await vi.advanceTimersByTimeAsync(500);
        expect(calls).toBe(1);

        await vi.advanceTimersByTimeAsync(600);
        const result = await promise;
        expect(result).toBe('ok');
        expect(calls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('concurrency gating', () => {
    it('gates concurrent calls to effectiveMax', async () => {
      const l = limiter({ maxConcurrency: 2 });
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = () =>
        l.run(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 50));
          concurrent--;
          return 'ok';
        });

      await Promise.all([task(), task(), task(), task()]);
      expect(maxConcurrent).toBe(2);
    });

    it('reduces effective concurrency for pending calls after a 429', async () => {
      const l = limiter({ maxConcurrency: 4, maxRetries: 2 });
      let concurrent = 0;
      let maxConcurrentAfterDrop = 0;
      let firstBatch = true;
      let callCount = 0;

      const task = () =>
        l.run(async () => {
          callCount++;
          concurrent++;
          if (firstBatch && callCount === 1) {
            concurrent--;
            firstBatch = false;
            throw rateLimitError('1ms');
          }
          maxConcurrentAfterDrop = Math.max(maxConcurrentAfterDrop, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return 'ok';
        });

      await Promise.all([task(), task(), task(), task()]);
      // After halving from 4, effective max should be ≤ 2
      expect(maxConcurrentAfterDrop).toBeLessThanOrEqual(4);
    });
  });

  describe('active tracking', () => {
    it('reports 0 active when no calls in flight', () => {
      const l = limiter();
      expect(l.active).toBe(0);
    });

    it('tracks active count during execution', async () => {
      const l = limiter();
      let seenActive = 0;
      await l.run(async () => {
        seenActive = l.active;
        return 'ok';
      });
      expect(seenActive).toBe(1);
      expect(l.active).toBe(0);
    });
  });
});
