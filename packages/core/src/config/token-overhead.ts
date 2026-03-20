/**
 * Provider-specific token overhead for compiled message lists (§9.4).
 *
 * Applied on top of BPE (or estimator) length of estimation strings in @slotmux/tokenizers.
 *
 * @packageDocumentation
 */

/**
 * Fixed token overhead per message list and per message (and optional `name` field).
 */
export interface ProviderTokenOverhead {
  /** Formatting tokens charged once per message (e.g. role / turn delimiters). */
  readonly perMessage: number;
  /** Charged once when the message list is non-empty. */
  readonly perConversation: number;
  /** Extra tokens when `message.name` is set (OpenAI-style `name` metadata). */
  readonly perName: number;
}

/**
 * Registry keyed by logical provider id (used by adapters and tokenizers).
 *
 * - **Ollama**: defaults here; override via {@link ollamaOverhead} for custom templates.
 * - **Mistral**: OpenAI-chat-compatible defaults until a dedicated SPM path lands (§2.4).
 */
export const TOKEN_OVERHEAD = {
  openai: {
    perMessage: 4,
    perConversation: 2,
    perName: 1,
  },
  anthropic: {
    perMessage: 3,
    perConversation: 1,
    perName: 0,
  },
  google: {
    perMessage: 4,
    perConversation: 2,
    perName: 0,
  },
  mistral: {
    perMessage: 4,
    perConversation: 2,
    perName: 1,
  },
  ollama: {
    perMessage: 4,
    perConversation: 2,
    perName: 1,
  },
} as const satisfies Record<string, ProviderTokenOverhead>;

export type TokenOverheadProviderId = keyof typeof TOKEN_OVERHEAD;

const registry = TOKEN_OVERHEAD as Record<string, ProviderTokenOverhead>;

/**
 * Resolve overhead for a provider id. Unknown ids fall back to OpenAI-style defaults.
 */
export function getTokenOverhead(providerId: string): ProviderTokenOverhead {
  const o = registry[providerId];
  return o ?? TOKEN_OVERHEAD.openai;
}

/**
 * Build Ollama overhead from defaults plus optional per-field overrides (configurable deployments).
 */
export function ollamaOverhead(
  overrides: Partial<ProviderTokenOverhead> = {},
): ProviderTokenOverhead {
  return { ...TOKEN_OVERHEAD.ollama, ...overrides };
}
