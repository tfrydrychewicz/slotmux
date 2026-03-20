/**
 * SQLite memory store integration (`:memory:`).
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { SQLiteMemoryStore } from './sqlite-memory-store.js';

describe('SQLiteMemoryStore', () => {
  it('supports get, set, search, delete', async () => {
    const store = new SQLiteMemoryStore(':memory:');
    try {
      const a = await store.set({ content: 'hello sqlite world' });
      expect(a.id).toBeTruthy();
      const g = await store.get(a.id);
      expect(g?.content).toBe('hello sqlite world');

      const hits = await store.search('sqlite', { limit: 10 });
      expect(hits.some((h) => h.id === a.id)).toBe(true);

      const del = await store.delete(a.id);
      expect(del).toBe(true);
      expect(await store.get(a.id)).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
