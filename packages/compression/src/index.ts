/**
 * @slotmux/compression — compression strategies (see `slotmux-design.md` package layout).
 *
 * @packageDocumentation
 */

export const VERSION = '1.0.0-rc.1';

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

export { runWithConcurrency } from './concurrency.js';

export { createDefaultExtractFacts, decayedConfidence, DEFAULT_FACT_DECAY_HALF_LIFE_MS, FACT_EXTRACTION_SCHEMA, FactStore, parseFactLines } from './fact-extraction.js';
export type { ExtractFactsFn, ExtractFactsParams, FactEntry, ParseFactResult } from './fact-extraction.js';

export { computeItemImportance } from './importance-scorer.js';
export type { ImportanceScorerFn } from './importance-scorer.js';

export { DEFAULT_PROGRESSIVE_PROMPTS } from './progressive-prompts.js';
export { computeDynamicPreserveLastN, partitionProgressiveZones } from './progressive-zones.js';
export type { ProgressiveZones } from './progressive-zones.js';
export { runProgressiveSummarize } from './progressive-summarizer.js';
export type { RunProgressiveSummarizeOptions } from './progressive-summarizer.js';
export { extractSummarizeText } from './progressive-types.js';
export type {
  ProgressiveItem,
  ProgressiveLayer,
  ProgressivePrompts,
  ProgressiveSummarizeTextFn,
  SummarizeTextResult,
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

export { computeAdaptiveThreshold, cosineSimilarity, runSemanticCompress } from './semantic-compressor.js';
export type { RunSemanticCompressParams } from './semantic-compressor.js';
export type { EmbedFunction, SemanticScorableItem } from './semantic-types.js';
