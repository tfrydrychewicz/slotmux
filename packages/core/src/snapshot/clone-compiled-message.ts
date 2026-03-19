/**
 * Clone {@link CompiledMessage} for snapshot storage (Phase 5.5).
 *
 * @packageDocumentation
 */

import type { CompiledMessage } from '../types/content.js';

/**
 * Deep-enough copy for snapshot isolation (string vs multimodal parts array).
 */
export function cloneCompiledMessage(m: CompiledMessage): CompiledMessage {
  const out: CompiledMessage = {
    role: m.role,
    content: typeof m.content === 'string' ? m.content : [...m.content],
  };
  if (m.name !== undefined) {
    out.name = m.name;
  }
  return out;
}

/** Stable JSON for equality / structural sharing (same shape as {@link CompiledMessage}). */
export function compiledMessageJson(m: Readonly<CompiledMessage>): string {
  return JSON.stringify(m);
}
