/**
 * Default slot layouts (§7.3 — Phase 3.5).
 *
 * @packageDocumentation
 */

import type { SlotConfig } from '../types/config.js';

/** Built-in {@link createContext} preset ids. */
export type ContextPresetId = 'chat' | 'rag' | 'agent';

/**
 * Chat preset: system instructions (fixed) + rolling history (flex, summarize).
 */
export const CHAT_DEFAULTS = {
  system: {
    priority: 100,
    budget: { fixed: 2000 },
    defaultRole: 'system',
    position: 'before',
    overflow: 'error',
  },
  history: {
    priority: 50,
    budget: { flex: true },
    defaultRole: 'user',
    position: 'after',
    overflow: 'summarize',
  },
} as const satisfies Record<string, SlotConfig>;

/**
 * RAG preset: system, retrieved documents, conversation history, assistant output area.
 */
export const RAG_DEFAULTS = {
  system: {
    priority: 100,
    budget: { fixed: 2000 },
    defaultRole: 'system',
    position: 'before',
    overflow: 'error',
  },
  rag: {
    priority: 80,
    budget: { flex: true },
    defaultRole: 'user',
    position: 'before',
    overflow: 'truncate',
  },
  history: {
    priority: 50,
    budget: { flex: true },
    defaultRole: 'user',
    position: 'after',
    overflow: 'summarize',
  },
  output: {
    priority: 40,
    budget: { flex: true },
    defaultRole: 'assistant',
    position: 'after',
    overflow: 'truncate',
  },
} as const satisfies Record<string, SlotConfig>;

/**
 * Agent preset: system, tool definitions/results, scratchpad, conversation history.
 */
export const AGENT_DEFAULTS = {
  system: {
    priority: 100,
    budget: { fixed: 2000 },
    defaultRole: 'system',
    position: 'before',
    overflow: 'error',
  },
  tools: {
    priority: 85,
    budget: { flex: true },
    defaultRole: 'tool',
    position: 'before',
    overflow: 'truncate',
  },
  scratchpad: {
    priority: 65,
    budget: { flex: true },
    defaultRole: 'user',
    position: 'interleave',
    order: 10,
    overflow: 'truncate',
  },
  history: {
    priority: 50,
    budget: { flex: true },
    defaultRole: 'user',
    position: 'after',
    overflow: 'summarize',
  },
} as const satisfies Record<string, SlotConfig>;

/** Map preset id → slot record (shallow-copied by {@link resolveContextSlots}). */
export const CONTEXT_PRESETS: Record<ContextPresetId, Record<string, SlotConfig>> = {
  chat: { ...CHAT_DEFAULTS },
  rag: { ...RAG_DEFAULTS },
  agent: { ...AGENT_DEFAULTS },
};
