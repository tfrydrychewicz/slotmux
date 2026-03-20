/**
 * Near-duplicate detection for RAG chunks (§11.1 — Phase 11.1).
 *
 * @packageDocumentation
 */

import type { ContentItem, MultimodalContent } from 'contextcraft';

/** Extract searchable text from a content item. */
export function ragItemPlainText(item: ContentItem): string {
  if (typeof item.content === 'string') {
    return item.content;
  }
  const parts: string[] = [];
  for (const block of item.content as MultimodalContent[]) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(text: string): Set<string> {
  const norm = normalizeForDedupe(text);
  const words = norm.split(/[^a-z0-9]+/u).filter((w) => w.length > 0);
  return new Set(words);
}

/**
 * Jaccard similarity on word sets (0–1).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size === 0 && B.size === 0) {
    return 1;
  }
  if (A.size === 0 || B.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) {
      inter += 1;
    }
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Drops items whose text is ≥ `threshold` similar to an earlier kept item (order-preserving).
 */
export function dedupeNearDuplicateChunks(
  items: readonly ContentItem[],
  threshold: number,
): ContentItem[] {
  if (items.length <= 1) {
    return [...items];
  }
  const kept: ContentItem[] = [];
  const keptTexts: string[] = [];
  const texts = items.map((i) => ragItemPlainText(i));
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const t = texts[i]!;
    let dup = false;
    for (const kt of keptTexts) {
      if (jaccardSimilarity(t, kt) >= threshold) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      kept.push(item);
      keptTexts.push(t);
    }
  }
  return kept;
}
