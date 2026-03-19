/**
 * Test utility factories for contextcraft tests.
 *
 * These helpers produce objects matching the expected shapes for slot resolution,
 * overflow engine, and integration tests. Types will be refined in Phase 1.
 */

/** Resolved slot shape used in overflow/budget tests */
export interface ResolvedSlot {
  name: string;
  priority: number;
  budgetTokens: number;
  content: ContentItemShape[];
}

/** Content item shape for test fixtures */
export interface ContentItemShape {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string;
  slot: string;
  tokens: number;
  pinned?: boolean;
  ephemeral?: boolean;
  createdAt: number;
}

/** Overflow result shape */
export interface OverflowResult {
  slots: ResolvedSlot[];
  evictions: Array<{ slot: string; item: ContentItemShape }>;
}

/**
 * Creates a resolved slot for overflow/budget tests.
 *
 * @param name - Slot name
 * @param priority - Slot priority (1-100)
 * @param budgetTokens - Resolved token budget
 * @param items - Content items in the slot
 */
export function makeSlot(
  name: string,
  priority: number,
  budgetTokens: number,
  items: ContentItemShape[],
): ResolvedSlot {
  return {
    name,
    priority,
    budgetTokens,
    content: items.map((item) => ({ ...item, slot: name })),
  };
}

/**
 * Creates a content item for tests.
 *
 * @param id - Item identifier
 * @param tokens - Token count
 * @param options - Optional pinned, ephemeral, role, content
 */
export function makeItem(
  id: string,
  tokens: number,
  options?: {
    pinned?: boolean;
    ephemeral?: boolean;
    role?: ContentItemShape['role'];
    content?: string;
    slot?: string;
  },
): ContentItemShape {
  return {
    id,
    role: options?.role ?? 'user',
    content: options?.content ?? `Content for ${id}`,
    slot: options?.slot ?? 'history',
    tokens,
    pinned: options?.pinned,
    ephemeral: options?.ephemeral,
    createdAt: Date.now(),
  };
}

/**
 * Creates a minimal context-like object for tests.
 *
 * Placeholder until createContext is implemented. Returns a stub with
 * build(), user(), system(), assistant() that can be extended.
 */
export function makeContext(): {
  build: () => { messages: unknown[]; meta: { totalTokens: number } };
  user: (content: string) => void;
  system: (content: string) => void;
  assistant: (content: string) => void;
  _messages: Array<{ role: string; content: string }>;
} {
  const messages: Array<{ role: string; content: string }> = [];

  return {
    _messages: messages,
    user(content: string) {
      messages.push({ role: 'user', content });
    },
    system(content: string) {
      messages.push({ role: 'system', content });
    },
    assistant(content: string) {
      messages.push({ role: 'assistant', content });
    },
    build() {
      return {
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        meta: { totalTokens: 0 },
      };
    },
  };
}
