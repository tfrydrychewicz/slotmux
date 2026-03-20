/**
 * @slotmux/plugin-rag — RAG integration.
 *
 * @packageDocumentation
 */

export {
  dedupeNearDuplicateChunks,
  jaccardSimilarity,
  ragItemPlainText,
} from './dedupe.js';
export {
  RAG_METADATA_CHUNK_ID,
  RAG_METADATA_SCORE,
  ragPlugin,
} from './rag-plugin.js';
export type { RagCitation, RagPlugin, RagPluginOptions } from './rag-plugin.js';
export { VERSION } from './version.js';
