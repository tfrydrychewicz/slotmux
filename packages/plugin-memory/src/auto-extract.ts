/**
 * Heuristic fact extraction from compiled snapshot messages (Phase 11.2).
 *
 * @packageDocumentation
 */

import type { CompiledMessage } from 'contextcraft';

function compiledPlainText(m: CompiledMessage): string {
  if (typeof m.content === 'string') {
    return m.content;
  }
  const parts: string[] = [];
  for (const p of m.content) {
    if (p.type === 'text') {
      parts.push(p.text);
    }
  }
  return parts.join('\n');
}

/**
 * Pulls sentence-like segments from recent user/assistant turns for {@link memoryPlugin} `autoExtract`.
 */
export function extractFactCandidatesFromMessages(
  messages: readonly CompiledMessage[],
  options?: { maxMessages?: number; minLength?: number },
): string[] {
  const maxMessages = options?.maxMessages ?? 4;
  const minLength = options?.minLength ?? 24;
  const tail = messages.slice(-maxMessages);
  const out: string[] = [];
  for (const m of tail) {
    if (m.role !== 'user' && m.role !== 'assistant') {
      continue;
    }
    const text = compiledPlainText(m).trim();
    if (text.length < minLength) {
      continue;
    }
    const sentences = text.split(/\.\s+|\n+/u);
    for (const s of sentences) {
      const t = s.trim();
      if (t.length >= minLength) {
        out.push(t.endsWith('.') ? t : `${t}.`);
      }
    }
  }
  return out;
}
