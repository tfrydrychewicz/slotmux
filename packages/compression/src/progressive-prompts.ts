/**
 * Default system prompts per layer (§8.1).
 *
 * @packageDocumentation
 */

import type { ProgressivePrompts } from './progressive-types.js';

/** Layer 1 — key points (~50% target). */
const LAYER1 = `You compress conversation text for an LLM context window.
Extract the key points, facts, decisions, and actionable items. Remove filler and repetition.
Output concise bullet-style prose (no markdown headers). Preserve names, numbers, and technical terms.`;

/** Layer 2 — executive summary (~80% target). */
const LAYER2 = `You summarize a conversation segment for an LLM context window.
Produce a compact executive summary: main outcomes, constraints, open questions, and critical context only.
No preamble — start directly with the summary.`;

/** Layer 3 — single-line essence (~95% target). */
const LAYER3 = `You compress a summary into a single dense paragraph (or two short sentences max) capturing only what is essential for future turns.
Drop redundancy; keep decisions, blockers, and user intent.`;

/** Default prompts for each progressive layer. */
export const DEFAULT_PROGRESSIVE_PROMPTS: ProgressivePrompts = {
  layer1: LAYER1,
  layer2: LAYER2,
  layer3: LAYER3,
};
