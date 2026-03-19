/**
 * @contextcraft/tokenizers — Token counting abstractions
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

export type { Tokenizer } from './tokenizer.js';

export {
  CHARS_PER_TOKEN_ESTIMATE,
  CharEstimatorTokenizer,
  compiledMessageToEstimationString,
} from './char-estimator.js';

export {
  PER_CONVERSATION_OVERHEAD_TOKENS,
  PER_MESSAGE_OVERHEAD_TOKENS,
  compiledMessageTokenUnits,
  countCompiledMessages,
} from './message-count.js';

export { Cl100kTokenizer, O200kTokenizer, freeTiktokenEncodings } from './tiktoken-adapters.js';

export { ClaudeTokenizer } from './claude-tokenizer.js';

export { SentencePieceTokenizer } from './sentencepiece-tokenizer.js';
export type { GptTokenizerEncodingName } from './sentencepiece-tokenizer.js';

export { FallbackTokenizer } from './fallback-tokenizer.js';

export { LRUCache } from './lru-cache.js';

export { TokenCountCache } from './token-count-cache.js';
export type {
  TokenCountCacheMetrics,
  TokenCountCacheOptions,
} from './token-count-cache.js';
