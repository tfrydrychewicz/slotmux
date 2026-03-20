/**
 * @contextcraft/debug — Debug inspector (§13.2 — Phase 10.3)
 *
 * @packageDocumentation
 */

export { InspectorDisabledError } from './errors.js';
export {
  attachInspector,
  DEFAULT_MAX_EVENTS,
  DEFAULT_PORT,
} from './inspector-server.js';
export type { AttachInspectorOptions, InspectorHandle } from './inspector-server.js';
export { serializeContextEventForJson } from './serialize-event.js';

export const VERSION = '0.0.1';
