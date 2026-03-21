/**
 * Importance scoring for content items (§8.4.4).
 *
 * Scores items by entity density, presence of decisions/preferences,
 * and specific facts (numbers, dates, product names). Higher-scored items
 * survive longer in the context window during progressive summarization.
 *
 * @packageDocumentation
 */

import type { ProgressiveItem } from './progressive-types.js';

/**
 * Scoring function that assigns an importance score to a content item.
 *
 * Higher scores mean the item contains more factual detail worth preserving.
 * Items with lower scores are placed in the OLD zone (compressed most
 * aggressively), while higher-scored items stay in the MIDDLE zone.
 *
 * @param item - The content item to score
 * @returns A numeric importance score (higher = more important)
 */
export type ImportanceScorerFn = (item: ProgressiveItem) => number;

const DECISION_WORDS =
  /\b(decided|chose|chosen|picked|selected|going with|went with|settled on|committed to|opting for)\b/i;
const PREFERENCE_WORDS =
  /\b(I prefer|my favorite|I like|I love|I enjoy|I want|I need|I chose|I picked|I use)\b/i;
const NUMBER_PATTERN = /\b\d{2,}\b/;
const DATE_PATTERN =
  /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2})\b/i;
const QUOTED_STRING = /"[^"]{2,}"|'[^']{2,}'/;
const CAPITALIZED_SEQUENCE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/;

/**
 * Default importance scorer.
 *
 * Scoring breakdown:
 * - `entityDensity * 2`: ratio of capitalized multi-word sequences per 100 chars
 * - `+1` if item contains decision language
 * - `+1` if item contains preference language
 * - `+1` if item contains specific facts (numbers, dates, quoted strings)
 *
 * @param item - The content item to score
 * @returns A numeric importance score (typically 0-5 range)
 */
export function computeItemImportance(item: ProgressiveItem): number {
  const text = typeof item.content === 'string' ? item.content : '';
  if (text.length === 0) return 0;

  const capitalizedMatches = text.match(new RegExp(CAPITALIZED_SEQUENCE.source, 'g'));
  const entityDensity = ((capitalizedMatches?.length ?? 0) / Math.max(1, text.length)) * 100;

  const hasDecision = DECISION_WORDS.test(text) ? 1 : 0;
  const hasPreference = PREFERENCE_WORDS.test(text) ? 1 : 0;

  const hasSpecificFact =
    NUMBER_PATTERN.test(text) || DATE_PATTERN.test(text) || QUOTED_STRING.test(text) ? 1 : 0;

  return entityDensity * 2 + hasDecision + hasPreference + hasSpecificFact;
}
