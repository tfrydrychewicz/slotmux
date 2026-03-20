/**
 * JSON-safe shapes for inspector HTTP/WebSocket (Phase 10.3).
 *
 * @packageDocumentation
 */

import type { ContextEvent } from 'contextcraft';

/**
 * Serializes {@link ContextEvent} for HTTP/WebSocket (build:complete uses {@link ContextSnapshot.serialize}).
 */
export function serializeContextEventForJson(ev: ContextEvent): unknown {
  if (ev.type === 'build:complete') {
    return {
      type: ev.type,
      snapshot: ev.snapshot.serialize(),
    };
  }
  return ev;
}
