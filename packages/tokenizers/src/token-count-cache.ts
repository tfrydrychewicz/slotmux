/**
 * Two-tier token count cache (§9.3): L1 LRU + L2 Map, FNV-1a keys.
 *
 * @packageDocumentation
 */

import type { TokenCount } from 'slotmux';

import { LRUCache } from './lru-cache.js';
import type { Tokenizer } from './tokenizer.js';

/**
 * FNV-1a 32-bit hash — fast, non-cryptographic, pure JS.
 *
 * Used for cache key generation where collision resistance at the
 * level of SHA-256 is unnecessary. Returns a hex string.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const DEFAULT_L1_CAPACITY = 10_000;

/** Observability counters (reset by {@link TokenCountCache.reset}). */
export interface TokenCountCacheMetrics {
  /** Hits served from the L1 LRU. */
  readonly l1Hits: number;
  /** Hits served from L2 after an L1 miss (entry may be promoted to L1). */
  readonly l2Hits: number;
  /** Full misses (computed via tokenizer). */
  readonly misses: number;
}

export interface TokenCountCacheOptions {
  /** L1 LRU capacity (default 10,000). */
  l1Capacity?: number;
}

/**
 * Caches `tokenizer.count(content)` by `FNV-1a(tokenizerId + NUL + content)`.
 */
export class TokenCountCache {
  private readonly l1: LRUCache<string, TokenCount>;

  private readonly l2 = new Map<string, TokenCount>();

  private l1Hits = 0;

  private l2Hits = 0;

  private misses = 0;

  constructor(options?: TokenCountCacheOptions) {
    this.l1 = new LRUCache(options?.l1Capacity ?? DEFAULT_L1_CAPACITY);
  }

  /** Default L1 capacity from the spec. */
  static readonly defaultL1Capacity = DEFAULT_L1_CAPACITY;

  /**
   * Stable cache key for a tokenizer id and raw string content.
   * Uses FNV-1a (non-cryptographic, ~50x faster than SHA-256).
   * Exposed for tests and custom storage layers.
   */
  static computeKey(tokenizerId: string, content: string): string {
    return fnv1a32(tokenizerId + '\0' + content);
  }

  /** Instance alias for {@link TokenCountCache.computeKey}. */
  computeKey(tokenizerId: string, content: string): string {
    return TokenCountCache.computeKey(tokenizerId, content);
  }

  /**
   * Returns cached token count or delegates to `tokenizer.count(content)` and stores the result.
   */
  count(tokenizer: Tokenizer, content: string): TokenCount {
    const key = this.computeKey(tokenizer.id, content);

    const fromL1 = this.l1.get(key);
    if (fromL1 !== undefined) {
      this.l1Hits++;
      return fromL1;
    }

    const fromL2 = this.l2.get(key);
    if (fromL2 !== undefined) {
      this.l2Hits++;
      this.l1.set(key, fromL2);
      return fromL2;
    }

    this.misses++;
    const value = tokenizer.count(content);
    this.l1.set(key, value);
    this.l2.set(key, value);
    return value;
  }

  /** Clears L1 and L2 and resets hit/miss metrics. */
  reset(): void {
    this.l1.clear();
    this.l2.clear();
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.misses = 0;
  }

  /** Snapshot of observability counters. */
  getMetrics(): TokenCountCacheMetrics {
    return {
      l1Hits: this.l1Hits,
      l2Hits: this.l2Hits,
      misses: this.misses,
    };
  }

  /** L1 entry count (for tests / debugging). */
  get l1Size(): number {
    return this.l1.size;
  }

  /** L2 entry count (for tests / debugging). */
  get l2Size(): number {
    return this.l2.size;
  }
}
