/**
 * Phase 2.6 / §18.1 — performance targets (documented via Vitest bench; enforced in `performance-targets.sla.test.ts`).
 *
 * Targets:
 * - Single `countMessage` mean < **0.1 ms** per call (see SLA test).
 * - **TokenCountCache** L1 hits: **per-hit** latency p99 < **1 ms** over many samples (1000 warm keys; see SLA test — aggregate 1000× hit wall time is dominated by SHA-256 keying).
 */

import { bench, describe, afterEach } from 'vitest';

import {
  Cl100kTokenizer,
  TokenCountCache,
  freeTiktokenEncodings,
} from './index.js';

afterEach(() => {
  freeTiktokenEncodings();
});

const USER_MSG = {
  role: 'user' as const,
  content:
    'Hello, this is a typical user message for §18.1 single-message timing.',
};

describe('§2.6 / §18.1 — token counting targets (bench)', () => {
  const tokenizer = new Cl100kTokenizer();

  bench('countMessage single (SLA: mean <0.1ms/call in sla.test)', () => {
    tokenizer.countMessage(USER_MSG);
  });

  const cacheKeys = Array.from({ length: 1000 }, (_, i) => `cache-key-${i}`);
  const cache = new TokenCountCache();
  const tok = new Cl100kTokenizer();
  for (const k of cacheKeys) {
    cache.count(tok, k);
  }

  bench('TokenCountCache 1000× L1 hits / iteration (see sla.test for p99 per hit)', () => {
    for (const k of cacheKeys) {
      cache.count(tok, k);
    }
  });
});
