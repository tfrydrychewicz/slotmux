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

const FACT_LINE_RE = /^FACT:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$/;

/**
 * Parses `FACT: subject | predicate | value` lines from LLM output.
 *
 * Lines matching the pattern are extracted as {@link FactEntry} objects.
 * Everything else is returned as the `narrative` portion.
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
        confidence: 0.9,
        createdAt,
      });
    } else {
      narrativeLines.push(line);
    }
  }

  const narrative = narrativeLines.join('\n').trim();
  return { facts, narrative };
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
   * Returns facts sorted by confidence descending (highest first), then
   * by createdAt descending (most recent first) as tiebreaker.
   *
   * Use this to decide which facts to drop when the fact block exceeds budget.
   */
  byConfidenceDesc(): readonly FactEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt,
    );
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
   * @returns The rendered text, or an empty string if the store is empty
   */
  render(maxChars: number = Infinity): string {
    const facts = this.byConfidenceDesc();
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
   * @returns Multi-line string of `FACT:` lines, or empty string if no facts
   */
  renderAsFactLines(maxChars: number = Infinity): string {
    const facts = this.byConfidenceDesc();
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
 * System prompt for the default LLM-based fact extraction.
 *
 * Instructs the model to output only `FACT:` lines — no narrative.
 */
const DEFAULT_EXTRACTION_PROMPT =
  `Extract every specific, concrete fact from the following conversation text. ` +
  `Output ONLY lines in this exact format:\n` +
  `FACT: subject | predicate | value\n\n` +
  `Include: names, numbers, dates, user preferences, decisions, places, products, ` +
  `accounts, URLs, versions, prices, quantities, and any other concrete detail ` +
  `that could be asked about later.\n\n` +
  `Do NOT include opinions, vague statements, or narrative. ` +
  `Do NOT include any text besides FACT: lines.`;

/**
 * Creates a default {@link ExtractFactsFn} that uses an LLM call to extract facts.
 *
 * The implementation calls `summarizeText` with a dedicated extraction prompt
 * that instructs the model to output only `FACT:` lines. The output is then
 * parsed with {@link parseFactLines}.
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
  }) => Promise<string | { readonly text: string }>,
): ExtractFactsFn {
  return async ({ text }: ExtractFactsParams): Promise<readonly FactEntry[]> => {
    try {
      const raw = await summarizeText({
        layer: 1,
        systemPrompt: DEFAULT_EXTRACTION_PROMPT,
        userPayload: text,
      });
      const output = typeof raw === 'string' ? raw : raw.text;
      const { facts } = parseFactLines(output, 'extract-facts', Date.now());
      return facts;
    } catch {
      return [];
    }
  };
}
