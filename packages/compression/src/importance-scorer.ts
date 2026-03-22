/**
 * Language-agnostic importance scoring for content items (§8.4.4).
 *
 * Scores items using structural signals that work across all languages:
 * entity density, numeric/quoted specifics, code blocks, URLs, lists,
 * key-value pairs, substantive length, and lexical diversity.
 *
 * Higher-scored items survive longer in the context window during
 * progressive summarization. Users can override via {@link ImportanceScorerFn}
 * in `OverflowConfig` for domain-specific or embedding-based scoring.
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

/* ------------------------------------------------------------------ */
/*  Language-agnostic structural patterns                              */
/* ------------------------------------------------------------------ */

const NUMBER_PATTERN = /\b\d{2,}\b/;
const NUMERIC_DATE = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/;
const QUOTED_STRING = /"[^"]{2,}"|'[^']{2,}'/;
const CAPITALIZED_SEQUENCE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/;
const CODE_BLOCK = /```[\s\S]*?```|`[^`\n]+`/;
const URL_PATTERN = /https?:\/\/\S+/;
const LIST_PATTERN = /^[\t ]*[-*•]\s|^\s*\d+[.)]\s/m;
const KEY_VALUE_PATTERN = /\w+\s*[:=]\s*\S+/g;

const LENGTH_SCALE = 500;
const MAX_KEY_VALUE_BONUS = 1.5;
const KEY_VALUE_WEIGHT = 0.5;
const DIVERSITY_THRESHOLD = 0.7;
const DIVERSITY_BONUS = 0.5;
const MIN_WORDS_FOR_DIVERSITY = 5;

/**
 * Default importance scorer — fully language-agnostic.
 *
 * All signals are structural (regex + string ops), requiring no
 * external services, embeddings, or language-specific dictionaries.
 *
 * Scoring breakdown:
 * - `entityDensity * 2`: ratio of capitalized multi-word sequences per 100 chars
 * - `+1` if item contains specific facts (numbers, numeric dates, quoted strings)
 * - `+1.5` if item contains code blocks or inline code
 * - `+1` if item contains URLs
 * - `+1` if item contains structured lists
 * - `+0.5` per key-value pair (capped at 1.5)
 * - `0–1` length bonus (longer messages carry more information)
 * - `+0.5` lexical diversity bonus (high ratio of unique words)
 *
 * @param item - The content item to score
 * @returns A numeric importance score (typically 0–8 range)
 */
export function computeItemImportance(item: ProgressiveItem): number {
  const text = typeof item.content === 'string' ? item.content : '';
  if (text.length === 0) return 0;

  const capitalizedMatches = text.match(new RegExp(CAPITALIZED_SEQUENCE.source, 'g'));
  const entityDensity = ((capitalizedMatches?.length ?? 0) / Math.max(1, text.length)) * 100;

  const hasSpecificFact =
    NUMBER_PATTERN.test(text) || NUMERIC_DATE.test(text) || QUOTED_STRING.test(text) ? 1 : 0;

  const hasCode = CODE_BLOCK.test(text) ? 1.5 : 0;
  const hasUrl = URL_PATTERN.test(text) ? 1 : 0;
  const hasList = LIST_PATTERN.test(text) ? 1 : 0;

  const kvMatches = text.match(KEY_VALUE_PATTERN);
  const keyValueBonus = Math.min(MAX_KEY_VALUE_BONUS, (kvMatches?.length ?? 0) * KEY_VALUE_WEIGHT);

  const lengthBonus = Math.min(1, text.length / LENGTH_SCALE);

  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const diversityBonus =
    words.length >= MIN_WORDS_FOR_DIVERSITY && new Set(words).size / words.length >= DIVERSITY_THRESHOLD
      ? DIVERSITY_BONUS
      : 0;

  return (
    entityDensity * 2 +
    hasSpecificFact +
    hasCode +
    hasUrl +
    hasList +
    keyValueBonus +
    lengthBonus +
    diversityBonus
  );
}
