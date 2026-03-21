/**
 * Ollama provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createOllamaAdapter } from './ollama-adapter.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Ollama-specific options — apiKey is not required for local instances. */
export type OllamaProviderOptions = Omit<SlotmuxProviderOptions, 'apiKey'> & {
  /** API key (not required for local Ollama). */
  readonly apiKey?: string;
};

/**
 * Creates a `SlotmuxProvider` for Ollama (local models).
 *
 * @example
 * ```typescript
 * import { ollama } from '@slotmux/providers';
 * import { createContext } from 'slotmux';
 *
 * createContext({
 *   model: 'ollama/llama3.1',
 *   preset: 'chat',
 *   slotmuxProvider: ollama({ compressionModel: 'llama3.1' }),
 * });
 * ```
 *
 * @param opts - Optional base URL and compression model overrides
 * @returns A `SlotmuxProvider` with auto-wired summarization
 */
export function ollama(opts: OllamaProviderOptions = {}): SlotmuxProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.compressionModel ?? 'llama3.1';

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : async ({ systemPrompt, userPayload }) => {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPayload },
            ],
            stream: false,
          }),
        });
        const json = (await res.json()) as {
          message?: { content?: string };
        };
        return json.message?.content ?? '';
      };

  return {
    adapter: createOllamaAdapter(),
    summarizeText,
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
