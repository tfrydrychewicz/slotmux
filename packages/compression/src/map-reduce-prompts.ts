/**
 * Default prompts for map-reduce summarization (§8.1 / Phase 8.4).
 *
 * @packageDocumentation
 */

import type { MapReducePrompts } from './map-reduce-types.js';

export const DEFAULT_MAP_REDUCE_PROMPTS: MapReducePrompts = {
  map: `You summarize a contiguous segment of a conversation for later merging.
Output a concise factual summary: key points, decisions, open questions, and entities.
Do not add preamble or markdown headings unless the source uses them.`,

  reduce: `You merge several segment summaries of one conversation into a single coherent summary.
Preserve chronological sense where possible, deduplicate repeated facts, and keep critical details.
Output one flowing summary without listing "Segment 1, Segment 2".`,
};
