/**
 * Fact extraction from LLM summarization output (§8.4).
 *
 * Parses structured `FACT:` lines from LLM responses, manages a deduplicating
 * fact store, and renders facts into compact text blocks for context windows.
 *
 * Also provides a dedicated {@link ExtractFactsFn} hook for running a separate
 * fact-extraction pass before or instead of inline extraction from summarization
 * output. A default LLM-based implementation is available via
 * {@link createDefaultExtractFacts}.
 *
 * @packageDocumentation
 */

/**
 * A single atomic fact extracted from conversation content.
 *
 * @example
 * ```typescript
 * const fact: FactEntry = {
 *   subject: 'user',
 *   predicate: 'created_playlist',
 *   value: 'Summer Vibes',
 *   sourceItemId: 'msg-42',
 *   confidence: 0.95,
 *   createdAt: 1700000000000,
 * };
 * ```
 */
export type FactEntry = {
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly sourceItemId: string;
  readonly confidence: number;
  readonly createdAt: number;
};

/**
 * Result of parsing `FACT:` lines from LLM output.
 *
 * @param facts - Extracted fact entries
 * @param narrative - The remaining text after fact lines are removed
 */
export type ParseFactResult = {
  readonly facts: readonly FactEntry[];
  readonly narrative: string;
};

const FACT_LINE_RE = /^FACT:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)(?:\s*\|\s*([\d.]+))?\s*$/;

const DEFAULT_CONFIDENCE = 0.9;
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 1.0;

function parseConfidence(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CONFIDENCE;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) return DEFAULT_CONFIDENCE;
  return Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, n));
}

/**
 * Parses `FACT: subject | predicate | value [ | confidence ]` lines from LLM output.
 *
 * Lines matching the pattern are extracted as {@link FactEntry} objects.
 * The optional 4th field is a confidence score (0.0–1.0); when absent the
 * default is 0.9. Everything else is returned as the `narrative` portion.
 *
 * @param text - Raw LLM output containing interleaved FACT lines and narrative
 * @param sourceItemId - ID of the content item(s) that produced this text
 * @param createdAt - Timestamp for the extracted facts
 * @returns Parsed facts and remaining narrative
 */
export function parseFactLines(
  text: string,
  sourceItemId: string,
  createdAt: number,
): ParseFactResult {
  const lines = text.split('\n');
  const facts: FactEntry[] = [];
  const narrativeLines: string[] = [];

  for (const line of lines) {
    const match = FACT_LINE_RE.exec(line.trim());
    if (match) {
      facts.push({
        subject: match[1]!.trim(),
        predicate: match[2]!.trim(),
        value: match[3]!.trim(),
        sourceItemId,
        confidence: parseConfidence(match[4]),
        createdAt,
      });
    } else {
      narrativeLines.push(line);
    }
  }

  const narrative = narrativeLines.join('\n').trim();
  return { facts, narrative };
}

/** Default half-life for fact decay: 30 minutes. */
export const DEFAULT_FACT_DECAY_HALF_LIFE_MS = 1_800_000;

/**
 * Computes effective confidence after time-based decay.
 *
 * Uses exponential decay: `confidence * 0.5^(age / halfLifeMs)`.
 * Stored confidence is never mutated — decay only affects ordering
 * and budget pruning at render time.
 *
 * @param fact - The fact entry
 * @param newestCreatedAt - Timestamp of the most recent fact (reference point)
 * @param halfLifeMs - Time in ms for confidence to halve (default 30 min)
 * @returns Decayed confidence value
 */
export function decayedConfidence(
  fact: FactEntry,
  newestCreatedAt: number,
  halfLifeMs: number = DEFAULT_FACT_DECAY_HALF_LIFE_MS,
): number {
  const age = Math.max(0, newestCreatedAt - fact.createdAt);
  if (age === 0 || halfLifeMs <= 0) return fact.confidence;
  return fact.confidence * Math.pow(0.5, age / halfLifeMs);
}

/**
 * In-memory store that accumulates facts across compression rounds.
 *
 * Keyed by `subject|predicate` — when a duplicate key arrives, the entry
 * with higher confidence wins. Ties are broken by recency (`createdAt`).
 */
export class FactStore {
  private readonly entries = new Map<string, FactEntry>();

  private static key(subject: string, predicate: string): string {
    return `${subject}|${predicate}`;
  }

  /** Number of facts in the store. */
  get size(): number {
    return this.entries.size;
  }

  /** All facts, ordered by createdAt ascending. */
  all(): readonly FactEntry[] {
    return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Add or update a fact. Keeps the higher-confidence entry on conflict.
   *
   * @param fact - Fact to merge into the store
   */
  add(fact: FactEntry): void {
    const k = FactStore.key(fact.subject, fact.predicate);
    const existing = this.entries.get(k);
    if (
      existing === undefined ||
      fact.confidence > existing.confidence ||
      (fact.confidence === existing.confidence && fact.createdAt > existing.createdAt)
    ) {
      this.entries.set(k, fact);
    }
  }

  /**
   * Merge multiple facts into the store.
   *
   * @param facts - Facts to merge
   */
  addAll(facts: readonly FactEntry[]): void {
    for (const f of facts) this.add(f);
  }

  /**
   * Returns facts sorted by effective confidence descending (highest first),
   * then by createdAt descending (most recent first) as tiebreaker.
   *
   * When `halfLifeMs` is provided, effective confidence is computed with
   * time-based decay relative to the newest fact in the store.
   *
   * @param halfLifeMs - Optional decay half-life. When omitted, raw confidence is used.
   */
  byConfidenceDesc(halfLifeMs?: number): readonly FactEntry[] {
    const all = [...this.entries.values()];
    if (halfLifeMs === undefined || all.length === 0) {
      return all.sort(
        (a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt,
      );
    }
    const newest = Math.max(...all.map((f) => f.createdAt));
    return all.sort((a, b) => {
      const da = decayedConfidence(a, newest, halfLifeMs);
      const db = decayedConfidence(b, newest, halfLifeMs);
      return db - da || b.createdAt - a.createdAt;
    });
  }

  /**
   * Renders facts into a compact text block for inclusion in a context window.
   *
   * Facts are formatted as semicolon-separated entries:
   * `"Known facts: user created playlist 'Summer Vibes' on Spotify; ..."`
   *
   * Facts are added in **confidence-descending** order so the most reliable
   * facts survive when the budget is tight.
   *
   * @param maxChars - Maximum character length for the rendered block.
   *   Once the limit is reached, remaining facts are dropped.
   *   Pass `Infinity` to include all.
   * @param halfLifeMs - Optional decay half-life for time-based confidence decay.
   * @returns The rendered text, or an empty string if the store is empty
   */
  render(maxChars: number = Infinity, halfLifeMs?: number): string {
    const facts = this.byConfidenceDesc(halfLifeMs);
    if (facts.length === 0) return '';

    const prefix = 'Known facts: ';
    let result = prefix;

    for (let i = 0; i < facts.length; i++) {
      const f = facts[i]!;
      const entry = `${f.subject} ${f.predicate.replace(/_/g, ' ')} "${f.value}"`;
      const separator = i === 0 ? '' : '; ';
      const candidate = result + separator + entry;

      if (candidate.length > maxChars) break;
      result = candidate;
    }

    return result === prefix ? '' : result;
  }

  /**
   * Renders facts as `FACT:` lines suitable for injection into an LLM prompt.
   *
   * Used for fact pinning: when re-compressing summaries (L3), the existing
   * facts are prepended to the prompt so the LLM preserves them.
   *
   * @param maxChars - Maximum character length. Facts are added in confidence
   *   order; lowest-confidence facts are dropped first when over budget.
   * @param halfLifeMs - Optional decay half-life for time-based confidence decay.
   * @returns Multi-line string of `FACT:` lines, or empty string if no facts
   */
  renderAsFactLines(maxChars: number = Infinity, halfLifeMs?: number): string {
    const facts = this.byConfidenceDesc(halfLifeMs);
    if (facts.length === 0) return '';

    const lines: string[] = [];
    let totalLen = 0;

    for (const f of facts) {
      const line = `FACT: ${f.subject} | ${f.predicate} | ${f.value}`;
      if (totalLen + line.length + 1 > maxChars) break;
      lines.push(line);
      totalLen += line.length + 1;
    }

    return lines.join('\n');
  }
}

// ============================================================
// Dedicated fact extraction hook (§8.4 P2)
// ============================================================

/**
 * Parameters passed to an {@link ExtractFactsFn}.
 *
 * @param text - The raw conversation text to extract facts from
 * @param existingFacts - Facts already in the store; implementations can use
 *   these to avoid redundant extraction or to resolve conflicts
 */
export type ExtractFactsParams = {
  readonly text: string;
  readonly existingFacts: readonly FactEntry[];
};

/**
 * Dedicated fact extraction function.
 *
 * Unlike inline `FACT:` parsing from summarization output, an `ExtractFactsFn`
 * runs as a **separate pass** — either before summarization or as a standalone
 * step. This gives users full control over how facts are discovered.
 *
 * @param params - Text and existing facts context
 * @returns Extracted facts (merged into the {@link FactStore} by the caller)
 *
 * @example
 * ```typescript
 * const customExtractor: ExtractFactsFn = async ({ text }) => {
 *   // Domain-specific regex extraction for order IDs
 *   const orders = [...text.matchAll(/order #(\d+)/gi)];
 *   return orders.map(m => ({
 *     subject: 'user',
 *     predicate: 'placed_order',
 *     value: m[1]!,
 *     sourceItemId: 'custom',
 *     confidence: 1.0,
 *     createdAt: Date.now(),
 *   }));
 * };
 * ```
 */
export type ExtractFactsFn = (params: ExtractFactsParams) => Promise<readonly FactEntry[]>;

/**
 * System prompt for JSON structured extraction.
 *
 * Shorter than the text-based prompt since the JSON schema enforces structure.
 */
const JSON_EXTRACTION_PROMPT =
  `Extract every specific, concrete fact from the conversation. ` +
  `Include names, numbers, dates, preferences, decisions, places, products, ` +
  `accounts, URLs, versions, prices, and quantities. ` +
  `Exclude trivial social interactions, opinions, and vague statements. ` +
  `Set confidence 0.0–1.0 (1.0 = critical, 0.5 = moderately useful).`;

/**
 * JSON schema for structured fact extraction (§8.4.1a).
 *
 * Sent to providers that support `responseSchema` to get type-safe JSON output
 * instead of parsing `FACT:` text lines.
 */
export const FACT_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          predicate: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['subject', 'predicate', 'value', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['facts'],
  additionalProperties: false,
};

type JsonFactEntry = {
  subject?: string;
  predicate?: string;
  value?: string;
  confidence?: number;
};

type JsonFactPayload = {
  facts?: JsonFactEntry[];
};

/**
 * Attempts to parse a JSON response into FactEntry[].
 * Returns `null` if parsing fails, so the caller can fall back to text parsing.
 */
function tryParseJsonFacts(
  output: string,
  sourceItemId: string,
  createdAt: number,
): readonly FactEntry[] | null {
  try {
    const parsed = JSON.parse(output) as JsonFactPayload;
    if (!Array.isArray(parsed.facts)) return null;

    return parsed.facts
      .filter(
        (f): f is Required<JsonFactEntry> =>
          typeof f.subject === 'string' &&
          typeof f.predicate === 'string' &&
          typeof f.value === 'string' &&
          typeof f.confidence === 'number',
      )
      .map((f) => ({
        subject: f.subject,
        predicate: f.predicate,
        value: f.value,
        sourceItemId,
        confidence: Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, f.confidence)),
        createdAt,
      }));
  } catch {
    return null;
  }
}

/**
 * Creates a default {@link ExtractFactsFn} that uses an LLM call to extract facts.
 *
 * When the provider supports structured output, the extraction uses JSON
 * (`responseSchema`) for reliable, type-safe extraction. If JSON parsing fails
 * or the provider ignores the schema, it falls back to `FACT:` line parsing.
 *
 * @param summarizeText - The LLM summarization function (same one used for
 *   progressive summarization). Layer 1 is used for extraction calls.
 * @returns An `ExtractFactsFn` backed by the provided LLM
 *
 * @example
 * ```typescript
 * import { createDefaultExtractFacts } from '@slotmux/compression';
 *
 * const extractFacts = createDefaultExtractFacts(mySummarizeTextFn);
 * const facts = await extractFacts({ text: conversationChunk, existingFacts: [] });
 * ```
 */
export function createDefaultExtractFacts(
  summarizeText: (params: {
    readonly layer: 1 | 2 | 3;
    readonly systemPrompt: string;
    readonly userPayload: string;
    readonly targetTokens?: number;
    readonly responseSchema?: Record<string, unknown>;
  }) => Promise<string | { readonly text: string }>,
): ExtractFactsFn {
  return async ({ text }: ExtractFactsParams): Promise<readonly FactEntry[]> => {
    const now = Date.now();
    try {
      const raw = await summarizeText({
        layer: 1,
        systemPrompt: JSON_EXTRACTION_PROMPT,
        userPayload: text,
        responseSchema: FACT_EXTRACTION_SCHEMA,
      });
      const output = typeof raw === 'string' ? raw : raw.text;

      const jsonFacts = tryParseJsonFacts(output, 'extract-facts', now);
      if (jsonFacts !== null) return jsonFacts;

      const { facts } = parseFactLines(output, 'extract-facts', now);
      return facts;
    } catch {
      return [];
    }
  };
}
