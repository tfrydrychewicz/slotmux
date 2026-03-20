/**
 * In-memory {@link MemoryStore} for tests and ephemeral use.
 *
 * @packageDocumentation
 */

import type { MemoryRecord, MemorySetInput, MemoryStore } from './memory-types.js';

function now(): number {
  return Date.now();
}

function randomId(): string {
  return `mem_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly byId = new Map<string, MemoryRecord>();

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.byId.get(id);
  }

  async set(input: MemorySetInput): Promise<MemoryRecord> {
    const t = now();
    const id = input.id ?? randomId();
    const prev = this.byId.get(id);
    const meta =
      input.metadata !== undefined
        ? input.metadata
        : (prev?.metadata !== undefined ? prev.metadata : undefined);
    const rec: MemoryRecord = {
      id,
      content: input.content,
      createdAt: prev?.createdAt ?? t,
      updatedAt: t,
      ...(meta !== undefined ? { metadata: meta } : {}),
    };
    this.byId.set(id, rec);
    return rec;
  }

  async search(query: string, options?: { limit?: number }): Promise<MemoryRecord[]> {
    const limit = options?.limit ?? 100;
    const q = query.trim().toLowerCase();
    const words = q.length > 0 ? q.split(/\s+/u).filter((w) => w.length > 1) : [];
    const all = [...this.byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (words.length === 0) {
      return all.slice(0, limit);
    }
    const scored = all.filter((r) => {
      const t = r.content.toLowerCase();
      return words.some((w) => t.includes(w));
    });
    return scored.slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}
