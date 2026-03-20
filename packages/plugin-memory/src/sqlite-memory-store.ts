/**
 * {@link MemoryStore} backed by better-sqlite3 (Node.js).
 *
 * @packageDocumentation
 */

import Database from 'better-sqlite3';

import type { MemoryRecord, MemorySetInput, MemoryStore } from './memory-types.js';

function parseRow(row: {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}): MemoryRecord {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata !== null && row.metadata.length > 0) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Persistent memory using SQLite (`:memory:` or a file path).
 */
export class SQLiteMemoryStore implements MemoryStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    if (path !== ':memory:') {
      try {
        this.db.pragma('journal_mode = WAL');
      } catch {
        /* ignore */
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_updated_at ON memories (updated_at DESC);
    `);
  }

  /** Close the DB handle (recommended for file-backed stores in tests / shutdown). */
  close(): void {
    this.db.close();
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const row = this.db
      .prepare(
        'SELECT id, content, created_at, updated_at, metadata FROM memories WHERE id = ?',
      )
      .get(id) as
      | {
          id: string;
          content: string;
          created_at: number;
          updated_at: number;
          metadata: string | null;
        }
      | undefined;
    return row === undefined ? undefined : parseRow(row);
  }

  async set(input: MemorySetInput): Promise<MemoryRecord> {
    const t = Date.now();
    const id = input.id ?? `mem_${t}_${Math.random().toString(36).slice(2, 10)}`;
    const prev = await this.get(id);
    const createdAt = prev?.createdAt ?? t;
    const metadataJson =
      input.metadata !== undefined ? JSON.stringify(input.metadata) : null;
    this.db
      .prepare(
        `INSERT INTO memories (id, content, created_at, updated_at, metadata)
         VALUES (@id, @content, @created_at, @updated_at, @metadata)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           updated_at = excluded.updated_at,
           metadata = excluded.metadata`,
      )
      .run({
        id,
        content: input.content,
        created_at: createdAt,
        updated_at: t,
        metadata: metadataJson,
      });
    const row = this.db
      .prepare(
        'SELECT id, content, created_at, updated_at, metadata FROM memories WHERE id = ?',
      )
      .get(id) as {
      id: string;
      content: string;
      created_at: number;
      updated_at: number;
      metadata: string | null;
    };
    return parseRow(row);
  }

  async search(query: string, options?: { limit?: number }): Promise<MemoryRecord[]> {
    const cap = options?.limit ?? 200;
    const q = query.trim().toLowerCase();
    const words = q.length > 0 ? q.split(/\s+/u).filter((w) => w.length > 1) : [];

    if (words.length === 0) {
      const rows = this.db
        .prepare(
          'SELECT id, content, created_at, updated_at, metadata FROM memories ORDER BY updated_at DESC LIMIT ?',
        )
        .all(cap) as Array<{
        id: string;
        content: string;
        created_at: number;
        updated_at: number;
        metadata: string | null;
      }>;
      return rows.map(parseRow);
    }

    const clause = words.map(() => 'LOWER(content) LIKE ?').join(' OR ');
    const params = words.map((w) => `%${w}%`);
    const rows = this.db
      .prepare(
        `SELECT id, content, created_at, updated_at, metadata FROM memories WHERE ${clause} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params, cap) as Array<{
      id: string;
      content: string;
      created_at: number;
      updated_at: number;
      metadata: string | null;
    }>;
    return rows.map(parseRow);
  }

  async delete(id: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return r.changes > 0;
  }
}
