/**
 * Types for map-reduce summarization (design §8.1 / Phase 8.4).
 *
 * @packageDocumentation
 */

/** Summarize one chunk of conversation (map phase). */
export type MapReduceMapChunkFn = (params: {
  readonly systemPrompt: string;
  readonly userPayload: string;
}) => Promise<string>;

/** Merge several chunk summaries into one (reduce phase). */
export type MapReduceReduceMergeFn = (params: {
  readonly systemPrompt: string;
  readonly userPayload: string;
}) => Promise<string>;

export type MapReduceSummarizeDeps = {
  readonly mapChunk: MapReduceMapChunkFn;
  readonly reduceMerge: MapReduceReduceMergeFn;
  /**
   * Max estimated tokens per map call input (joined plain text of items in chunk).
   * Default derived from `budgetTokens` when passed to {@link runMapReduceSummarize}.
   */
  readonly mapChunkMaxInputTokens?: number;
  /**
   * Max estimated tokens per reduce call input (joined chunk summaries).
   * Default same heuristic as map.
   */
  readonly reduceMaxInputTokens?: number;
};

export type MapReducePrompts = {
  readonly map: string;
  readonly reduce: string;
};
