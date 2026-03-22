/**
 * Ollama provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createAdaptiveRateLimiter } from './adaptive-rate-limiter.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { createOllamaAdapter } from './ollama-adapter.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';
import { withSanitizedInputs } from './sanitize-llm-input.js';

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
  const limiter = createAdaptiveRateLimiter({
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : async ({ systemPrompt, userPayload, responseSchema }) =>
        limiter.run(async () => {
          const requestBody: Record<string, unknown> = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPayload },
            ],
            stream: false,
            options: { num_predict: 4096 },
          };
          if (responseSchema !== undefined) {
            requestBody['format'] = 'json';
          }
          const res = await fetchWithRetry(
            `${baseUrl}/api/chat`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody),
            },
            { maxRetries: 0 },
          );
          const json = (await res.json()) as {
            message?: { content?: string };
          };
          return json.message?.content ?? '';
        });

  return {
    adapter: createOllamaAdapter(),
    summarizeText: withSanitizedInputs(summarizeText),
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
