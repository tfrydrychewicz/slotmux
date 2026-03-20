/**
 * Truncate oversized tool result payloads (Phase 11.3).
 *
 * @packageDocumentation
 */

/** ~4 chars per token heuristic (aligned with plugin-memory). */
export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Truncate plain text to roughly `maxTokens` using the char heuristic.
 */
export function truncateStringToApproxTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return '';
  }
  const maxChars = Math.max(4, Math.floor(maxTokens * 4) - 16);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…[truncated]`;
}
