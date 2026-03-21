/**
 * Default system prompts per layer (§8.1, §8.4).
 *
 * Prompts use an **extraction-first** design: the LLM outputs structured
 * `FACT: subject | predicate | value` lines before writing narrative.
 * Facts are produced first so they survive even when output is truncated.
 * Downstream, {@link parseFactLines} separates fact lines from narrative.
 *
 * @packageDocumentation
 */

import type { ProgressivePrompts } from './progressive-types.js';

/** Layer 1 — key points with fact extraction. */
const LAYER1 = `You compress conversation text for an LLM context window.

First, extract every specific fact as FACT: lines using this exact format:
FACT: subject | predicate | value

Include: names, numbers, dates, user preferences, decisions, places, products, accounts, and any other concrete detail that could be asked about later.

Then write concise bullet-style prose (no markdown headers) summarizing the conversation flow.
Remove filler and repetition. Preserve ALL fact lines even if the narrative must be shorter.`;

/** Layer 2 — executive summary with fact extraction. */
const LAYER2 = `You summarize a conversation segment for an LLM context window.

First, extract every specific fact as FACT: lines using this exact format:
FACT: subject | predicate | value

Include: names, numbers, dates, user preferences, decisions, places, products, accounts, and any other concrete detail.

Then write a compact executive summary: main outcomes, constraints, open questions, and critical context.
No preamble — start with FACT: lines, then the summary. Preserve ALL fact lines even if the narrative must be shorter.`;

/** Layer 3 — compressed essence, carrying forward all facts. */
const LAYER3 = `You compress a summary into minimal form for an LLM context window.

Carry forward ALL FACT: lines from the input exactly as they appear.
Then write one dense paragraph (or two short sentences max) capturing only what is essential for future turns.
Drop narrative redundancy; keep decisions, blockers, and user intent. Do NOT drop any FACT: lines.`;

/** Default prompts for each progressive layer. */
export const DEFAULT_PROGRESSIVE_PROMPTS: ProgressivePrompts = {
  layer1: LAYER1,
  layer2: LAYER2,
  layer3: LAYER3,
};
