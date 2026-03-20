/**
 * Memory store types (Phase 11.2).
 *
 * @packageDocumentation
 */

export type MemoryRecord = {
  readonly id: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata?: Record<string, unknown>;
};

export type MemorySetInput = {
  readonly id?: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
};

/**
 * Pluggable persistence for {@link memoryPlugin}.
 */
export interface MemoryStore {
  get(id: string): Promise<MemoryRecord | undefined>;

  set(input: MemorySetInput): Promise<MemoryRecord>;

  /**
   * Candidate search for retrieval ranking (may return a superset; plugin ranks and trims).
   */
  search(query: string, options?: { limit?: number }): Promise<MemoryRecord[]>;

  delete(id: string): Promise<boolean>;
}
