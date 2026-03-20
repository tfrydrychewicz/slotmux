/**
 * Stub sanitize plugin — strips common prompt-injection phrases from compiled messages (§19.1 — Phase 13.1).
 *
 * Runs at {@link ContextPlugin.beforeSnapshot} so outbound snapshot / adapter payloads are scrubbed.
 * Stored {@link ContentItem} values are unchanged; extend with custom patterns for your threat model.
 *
 * @packageDocumentation
 */

import { cloneCompiledMessage } from '../snapshot/clone-compiled-message.js';
import type {
  CompiledContentPart,
  CompiledMessage,
} from '../types/content.js';
import type { ContextPlugin } from '../types/plugin.js';

/** Default patterns — conservative English-centric heuristics only. */
export const DEFAULT_SANITIZE_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+all\s+previous\s+instructions\b/gi,
  /\bignore\s+(?:any|all)\s+(?:previous\s+)?(?:instructions?|prompts?|rules?)\b/gi,
  /\bdisregard\s+(?:all|any|previous)\s+(?:instructions?|prompts?)\b/gi,
  /\byou are now (?:in|a) ['"]?DAN['"]?\b/gi,
  /(?:^|\s)system\s*:\s*/gim,
  /\[INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
];

export type SanitizePluginOptions = {
  /** Extra patterns merged after defaults. */
  readonly extraPatterns?: readonly RegExp[];
  /** String replacement for matched regions (default single space collapse). */
  readonly replacement?: string;
};

function sanitizeString(text: string, patterns: readonly RegExp[], replacement: string): string {
  let out = text;
  for (const re of patterns) {
    out = out.replace(re, replacement);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function sanitizeCompiledMessage(
  m: CompiledMessage,
  patterns: readonly RegExp[],
  replacement: string,
): CompiledMessage {
  const copy = cloneCompiledMessage(m);
  if (typeof copy.content === 'string') {
    copy.content = sanitizeString(copy.content, patterns, replacement);
    return copy;
  }
  copy.content = copy.content.map((part: CompiledContentPart) => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: sanitizeString(part.text, patterns, replacement) };
    }
    return part;
  });
  return copy;
}

/**
 * Returns a {@link ContextPlugin} that scrubs {@link CompiledMessage} content before snapshot materialization.
 */
export function sanitizePlugin(options?: SanitizePluginOptions): ContextPlugin {
  const replacement = options?.replacement ?? ' ';
  const patterns: RegExp[] = [
    ...DEFAULT_SANITIZE_INJECTION_PATTERNS,
    ...(options?.extraPatterns ?? []),
  ];

  return {
    name: 'sanitize',
    version: '0.0.1',
    beforeSnapshot(messages: CompiledMessage[]) {
      return messages.map((msg) => sanitizeCompiledMessage(msg, patterns, replacement));
    },
  };
}
