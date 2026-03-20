/**
 * @contextcraft/plugin-memory — Long-term memory (Phase 11.2).
 *
 * @packageDocumentation
 */

export { extractFactCandidatesFromMessages } from './auto-extract.js';
export { InMemoryMemoryStore } from './in-memory-memory-store.js';
export { memoryPlugin } from './memory-plugin.js';
export type { MemoryPluginOptions } from './memory-plugin.js';
export type { MemoryRecord, MemorySetInput, MemoryStore } from './memory-types.js';
export { jaccardSimilarity, rankMemories } from './retrieval.js';
export type { MemoryRetrievalStrategy, RankedMemory } from './retrieval.js';
export { SQLiteMemoryStore } from './sqlite-memory-store.js';
export { VERSION } from './version.js';
