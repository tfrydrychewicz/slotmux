/**
 * Two-tier token count cache (§9.3): L1 LRU + L2 Map, SHA-256 keys.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

import type { TokenCount } from 'contextcraft';

import { LRUCache } from './lru-cache.js';
import type { Tokenizer } from './tokenizer.js';


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
 * Caches `tokenizer.count(content)` by `SHA-256(tokenizerId + NUL + content)` (hex digest).
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
   * Exposed for tests and custom storage layers.
   */
  static computeKey(tokenizerId: string, content: string): string {
    return createHash('sha256')
      .update(tokenizerId, 'utf8')
      .update('\0', 'utf8')
      .update(content, 'utf8')
      .digest('hex');
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
