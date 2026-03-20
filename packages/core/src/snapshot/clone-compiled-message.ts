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
  if (m.tool_call_id !== undefined) {
    out.tool_call_id = m.tool_call_id;
  }
  if (m.toolUses !== undefined) {
    out.toolUses = m.toolUses.map((t) => ({
      id: t.id,
      name: t.name,
      input: { ...t.input },
    }));
  }
  return out;
}

/** Stable JSON for equality / structural sharing (same shape as {@link CompiledMessage}). */
export function compiledMessageJson(m: Readonly<CompiledMessage>): string {
  return JSON.stringify(m);
}
