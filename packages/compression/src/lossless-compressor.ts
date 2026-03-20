/**
 * Lossless-ish text compression (§8.3) — filler removal, whitespace,
 * abbreviations, pleasantries, and near-duplicate consecutive messages.
 *
 * Lives in `@slotmux/compression` per design (packages/compression).
 *
 * @packageDocumentation
 */

import {
  resolveLosslessLanguagePack,
  type LosslessLanguagePack,
} from './lossless-language-packs.js';
import type {
  LosslessCompressibleItem,
  LosslessMultimodalBlock,
  LosslessMultimodalText,
} from './lossless-types.js';

// --- Plain text helpers -----------------------------------------------------

function removeFillerPhrases(text: string, pack: LosslessLanguagePack): string {
  let t = text;
  for (const p of pack.fillerPatterns) {
    t = t.replace(p, ' ');
  }
  return t;
}

function applyAbbreviations(text: string, pack: LosslessLanguagePack): string {
  let t = text;
  for (const { pattern, replacement } of pack.abbreviations) {
    t = t.replace(pattern, replacement);
  }
  return t;
}

function collapseRedundantWhitespace(text: string): string {
  const lines = text.split('\n').map((line) => line.trim().replace(/\s+/g, ' '));
  const joined = lines.filter((l, i) => l.length > 0 || (i > 0 && lines[i - 1] !== '')).join('\n');
  return joined.replace(/\n{3,}/g, '\n\n').trim();
}

function stripPleasantryOnlyLines(text: string, pack: LosslessLanguagePack): string {
  return text
    .split('\n')
    .filter((line) => !pack.pleasantryOnlyLine.test(line.trim()))
    .join('\n')
    .trim();
}

/** Text from item for comparison / transforms (text blocks only). */
export function getPlainTextForLossless(item: Readonly<LosslessCompressibleItem>): string {
  if (typeof item.content === 'string') {
    return item.content;
  }
  return item.content
    .filter((b): b is LosslessMultimodalText => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

function mapItemStringContent<T extends LosslessCompressibleItem>(
  item: T,
  map: (s: string) => string,
): T {
  if (typeof item.content === 'string') {
    return { ...item, content: map(item.content) };
  }
  const next: LosslessMultimodalBlock[] = item.content.map((block) =>
    block.type === 'text' ? { ...block, text: map(block.text) } : block,
  );
  return { ...item, content: next };
}

function normalizeForDedupe(s: string, dedupeLocale: string): string {
  return s
    .normalize('NFKC')
    .toLocaleLowerCase(dedupeLocale)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardWordSimilarity(a: string, b: string): number {
  const wa = new Set(a.split(/\s+/).filter((x) => x.length > 0));
  const wb = new Set(b.split(/\s+/).filter((x) => x.length > 0));
  if (wa.size === 0 && wb.size === 0) {
    return 1;
  }
  if (wa.size === 0 || wb.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const w of wa) {
    if (wb.has(w)) {
      inter += 1;
    }
  }
  const union = wa.size + wb.size - inter;
  return union === 0 ? 1 : inter / union;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) {
    row[j] = j;
  }
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[n]!;
}

function similarityScore(a: string, b: string, dedupeLocale: string): number {
  const na = normalizeForDedupe(a, dedupeLocale);
  const nb = normalizeForDedupe(b, dedupeLocale);
  if (na === nb) {
    return 1;
  }
  if (na.length === 0 || nb.length === 0) {
    return 0;
  }
  const j = jaccardWordSimilarity(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen <= 160) {
    const d = levenshtein(na, nb);
    const lev = 1 - d / maxLen;
    return Math.max(j, lev);
  }
  return j;
}

function stripAdjacentPleasantries<T extends LosslessCompressibleItem>(
  items: readonly T[],
  resolvePack: (item: T) => LosslessLanguagePack,
): T[] {
  const out = items.map((i) => ({ ...i })) as T[];
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (a.role !== 'user' || b.role !== 'assistant') {
      continue;
    }
    if (typeof a.content !== 'string' || typeof b.content !== 'string') {
      continue;
    }
    const sa = a.content;
    const sb = b.content;
    const packUser = resolvePack(a);
    const packAsst = resolvePack(b);
    if (!packUser.trailingThanks.test(sa) || !packAsst.leadingWelcome.test(sb)) {
      continue;
    }
    out[i] = {
      ...a,
      content: sa.replace(packUser.trailingThanks, '').trim(),
    } as T;
    out[i + 1] = {
      ...b,
      content: sb.replace(packAsst.leadingWelcome, '').trim(),
    } as T;
  }
  return out;
}

function dedupeConsecutiveSimilar<T extends LosslessCompressibleItem>(
  items: readonly T[],
  threshold: number,
  dedupeLocale: string,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const text = getPlainTextForLossless(item);
    if (out.length === 0) {
      out.push(item);
      continue;
    }
    const prev = out[out.length - 1]!;
    if (prev.role !== item.role) {
      out.push(item);
      continue;
    }
    const sim = similarityScore(getPlainTextForLossless(prev), text, dedupeLocale);
    if (sim >= threshold) {
      continue;
    }
    out.push(item);
  }
  return out;
}

function dedupeConsecutiveSimilarPerTag<T extends LosslessCompressibleItem>(
  items: readonly T[],
  threshold: number,
  resolveTag: (item: T) => string,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const text = getPlainTextForLossless(item);
    if (out.length === 0) {
      out.push(item);
      continue;
    }
    const prev = out[out.length - 1]!;
    if (prev.role !== item.role) {
      out.push(item);
      continue;
    }
    const tagPrev = resolveTag(prev);
    const tagItem = resolveTag(item);
    const dedupeLocale =
      tagPrev === tagItem
        ? (resolveLosslessLanguagePack(tagItem).dedupeLocale ?? 'en')
        : 'en';
    const sim = similarityScore(getPlainTextForLossless(prev), text, dedupeLocale);
    if (sim >= threshold) {
      continue;
    }
    out.push(item);
  }
  return out;
}

// --- Public API --------------------------------------------------------------

export type LosslessDetectLanguageFn = (text: string) => string | undefined;

export type LosslessCompressorOptions = {
  /**
   * BCP 47 tag: default pack when an item has no `losslessLocale` and
   * `detectLanguage` returns nothing. Default `'en'`.
   * Ignored when `languagePack` is set (single-pack mode).
   */
  readonly locale?: string;
  /**
   * Called with plain text when an item omits `losslessLocale`; return a BCP 47 tag (e.g. from `franc` or CLD).
   * Ignored when `languagePack` is set.
   */
  readonly detectLanguage?: LosslessDetectLanguageFn;
  /**
   * Full override: one pack for all items; per-item `losslessLocale` and `detectLanguage` are ignored.
   */
  readonly languagePack?: LosslessLanguagePack;
  /**
   * Jaccard / Levenshtein blend threshold for consecutive same-role dedupe (default `0.92`).
   */
  readonly dedupeSimilarityThreshold?: number;
  /** Run consecutive near-duplicate removal (default true). */
  readonly dedupe?: boolean;
  /** Strip thanks / welcome pairs between string user→assistant messages (default true). */
  readonly stripAdjacentPleasantries?: boolean;
  readonly collapseWhitespace?: boolean;
  readonly removeFiller?: boolean;
  readonly abbreviate?: boolean;
  readonly stripPleasantryLines?: boolean;
};

/**
 * Applies §8.3 transforms to chat text and message lists without LLM calls.
 * Works with any item that extends `LosslessCompressibleItem` (e.g. slotmux `ContentItem`).
 */
export class LosslessCompressor {
  private readonly fixedPack: LosslessLanguagePack | undefined;

  private readonly slotDefaultLocale: string;

  private readonly detectLanguage: LosslessDetectLanguageFn | undefined;

  private readonly opts: Required<
    Pick<
      LosslessCompressorOptions,
      | 'dedupeSimilarityThreshold'
      | 'dedupe'
      | 'stripAdjacentPleasantries'
      | 'collapseWhitespace'
      | 'removeFiller'
      | 'abbreviate'
      | 'stripPleasantryLines'
    >
  >;

  constructor(options: LosslessCompressorOptions = {}) {
    this.fixedPack = options.languagePack;
    const loc = options.locale?.trim();
    this.slotDefaultLocale = loc !== undefined && loc !== '' ? loc : 'en';
    this.detectLanguage = options.detectLanguage;
    this.opts = {
      dedupeSimilarityThreshold: options.dedupeSimilarityThreshold ?? 0.92,
      dedupe: options.dedupe !== false,
      stripAdjacentPleasantries: options.stripAdjacentPleasantries !== false,
      collapseWhitespace: options.collapseWhitespace !== false,
      removeFiller: options.removeFiller !== false,
      abbreviate: options.abbreviate !== false,
      stripPleasantryLines: options.stripPleasantryLines !== false,
    };
  }

  resolveTagForItem(item: Readonly<LosslessCompressibleItem>): string {
    const fromItem = item.losslessLocale?.trim();
    if (fromItem) {
      return fromItem;
    }
    const plain = getPlainTextForLossless(item);
    const fromDetect = this.detectLanguage?.(plain)?.trim();
    if (fromDetect) {
      return fromDetect;
    }
    return this.slotDefaultLocale;
  }

  resolvePackForItem(item: Readonly<LosslessCompressibleItem>): LosslessLanguagePack {
    if (this.fixedPack !== undefined) {
      return this.fixedPack;
    }
    return resolveLosslessLanguagePack(this.resolveTagForItem(item));
  }

  private compressTextWithPack(text: string, pack: LosslessLanguagePack): string {
    let t = text;
    if (this.opts.removeFiller) {
      t = removeFillerPhrases(t, pack);
    }
    if (this.opts.abbreviate) {
      t = applyAbbreviations(t, pack);
    }
    if (this.opts.collapseWhitespace) {
      t = collapseRedundantWhitespace(t);
    }
    if (this.opts.stripPleasantryLines) {
      t = stripPleasantryOnlyLines(t, pack);
    }
    return t;
  }

  compressText(text: string): string {
    const pack = this.fixedPack ?? resolveLosslessLanguagePack(this.slotDefaultLocale);
    return this.compressTextWithPack(text, pack);
  }

  compressItems<T extends LosslessCompressibleItem>(items: readonly T[]): T[] {
    const resolvePack = (item: T) => this.resolvePackForItem(item);

    let next = items.map((item) =>
      mapItemStringContent(item, (s) => this.compressTextWithPack(s, resolvePack(item))),
    );

    if (this.opts.stripAdjacentPleasantries) {
      next = stripAdjacentPleasantries(next, resolvePack);
    }
    if (this.opts.dedupe) {
      if (this.fixedPack !== undefined) {
        const dedupeLocale = this.fixedPack.dedupeLocale ?? 'en';
        next = dedupeConsecutiveSimilar(next, this.opts.dedupeSimilarityThreshold, dedupeLocale);
      } else {
        next = dedupeConsecutiveSimilarPerTag(next, this.opts.dedupeSimilarityThreshold, (item) =>
          this.resolveTagForItem(item),
        );
      }
    }
    return next;
  }
}

export type { LosslessLanguagePack } from './lossless-language-packs.js';
export {
  LOSSLESS_LANGUAGE_PACK_DE,
  LOSSLESS_LANGUAGE_PACK_EN,
  LOSSLESS_LANGUAGE_PACK_MINIMAL,
  registerLosslessLanguagePack,
  resolveLosslessLanguagePack,
  unregisterLosslessLanguagePack,
} from './lossless-language-packs.js';
export type {
  LosslessCompressibleItem,
  LosslessMultimodalBlock,
  LosslessMultimodalImageBase64,
  LosslessMultimodalImageUrl,
  LosslessMultimodalText,
} from './lossless-types.js';
