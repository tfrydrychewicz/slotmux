/**
 * Abstract base for provider adapters (§10.1).
 *
 * @packageDocumentation
 */

import { getTokenOverhead, type ProviderTokenOverhead } from '../config/token-overhead.js';
import { toTokenCount } from '../types/branded.js';
import type { ModelId, ProviderId } from '../types/config.js';
import type { CompiledMessage } from '../types/content.js';
import type { ModelCapabilities, ProviderAdapter, Tokenizer } from '../types/provider.js';

import { resolveModelCapabilitiesForAdapter } from './resolve-model-capabilities.js';

/**
 * Structural token overhead for a compiled message list (role/delimiter/name surcharges only).
 * Does not include content BPE length — pair with tokenizer counts in @slotmux/tokenizers.
 */
export function structuralOverheadForCompiledMessages(
  messages: readonly CompiledMessage[],
  overhead: ProviderTokenOverhead,
): number {
  if (messages.length === 0) {
    return 0;
  }
  let sum = overhead.perConversation;
  for (const m of messages) {
    sum += overhead.perMessage;
    if (overhead.perName > 0 && m.name !== undefined && m.name !== '') {
      sum += overhead.perName;
    }
  }
  return sum;
}

/**
 * Shared {@link ProviderAdapter} logic: registry-backed {@link resolveModel} and
 * `TOKEN_OVERHEAD`-backed {@link ProviderAdapter.calculateOverhead}.
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  constructor(public readonly id: ProviderId) {}

  resolveModel(modelId: ModelId): ModelCapabilities {
    return resolveModelCapabilitiesForAdapter(this.id, modelId);
  }

  calculateOverhead(messages: readonly CompiledMessage[]): ReturnType<typeof toTokenCount> {
    const o = getTokenOverhead(this.id);
    return toTokenCount(structuralOverheadForCompiledMessages(messages, o));
  }

  abstract formatMessages(messages: readonly CompiledMessage[]): unknown;

  abstract getTokenizer(modelId: ModelId): Tokenizer;
}
