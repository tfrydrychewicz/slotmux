/**
 * @contextcraft/compression — compression strategies (see `contextcraft-design.md` package layout).
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

export {
  LOSSLESS_LANGUAGE_PACK_DE,
  LOSSLESS_LANGUAGE_PACK_EN,
  LOSSLESS_LANGUAGE_PACK_MINIMAL,
  LosslessCompressor,
  getPlainTextForLossless,
  registerLosslessLanguagePack,
  resolveLosslessLanguagePack,
  unregisterLosslessLanguagePack,
} from './lossless-compressor.js';
export type {
  LosslessCompressibleItem,
  LosslessCompressorOptions,
  LosslessDetectLanguageFn,
  LosslessLanguagePack,
  LosslessMultimodalBlock,
  LosslessMultimodalImageBase64,
  LosslessMultimodalImageUrl,
  LosslessMultimodalText,
} from './lossless-compressor.js';

export { DEFAULT_PROGRESSIVE_PROMPTS } from './progressive-prompts.js';
export { partitionProgressiveZones } from './progressive-zones.js';
export type { ProgressiveZones } from './progressive-zones.js';
export { runProgressiveSummarize } from './progressive-summarizer.js';
export type { RunProgressiveSummarizeOptions } from './progressive-summarizer.js';
export type {
  ProgressiveItem,
  ProgressiveLayer,
  ProgressivePrompts,
  ProgressiveSummarizeTextFn,
} from './progressive-types.js';

export { DEFAULT_MAP_REDUCE_PROMPTS } from './map-reduce-prompts.js';
export {
  chunkBulkForMap,
  runMapReduceSummarize,
  splitTextToTokenBudget,
} from './map-reduce-summarizer.js';
export type { RunMapReduceSummarizeOptions } from './map-reduce-summarizer.js';
export type {
  MapReduceMapChunkFn,
  MapReducePrompts,
  MapReduceReduceMergeFn,
  MapReduceSummarizeDeps,
} from './map-reduce-types.js';
