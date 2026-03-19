/**
 * In-memory LRU cache with O(1) amortized get/set via `Map` insertion order.
 *
 * @packageDocumentation
 */

/**
 * Least-recently-used cache with a fixed maximum number of entries.
 *
 * On {@link get}, the entry is moved to most-recently-used.
 * On {@link set} when at capacity, the least-recently-used entry is evicted.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();

  /**
   * @param capacity - Maximum entries (must be ≥ 1).
   */
  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`LRUCache capacity must be a positive integer, got ${capacity}`);
    }
  }

  /** Current number of entries. */
  get size(): number {
    return this.map.size;
  }

  /** Maximum capacity. */
  get maxSize(): number {
    return this.capacity;
  }

  /**
   * Returns the value and marks the entry as most-recently-used.
   */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * Inserts or updates a value. Evicts LRU entry if at capacity and `key` is new.
   */
  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(key, value);
  }

  /** Removes a single key. */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** Clears all entries. */
  clear(): void {
    this.map.clear();
  }
}
