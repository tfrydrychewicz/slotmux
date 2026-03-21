/**
 * Mistral provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createAdaptiveRateLimiter } from './adaptive-rate-limiter.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { createMistralAdapter } from './mistral-adapter.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';
import { withSanitizedInputs } from './sanitize-llm-input.js';

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const DEFAULT_COMPRESSION_MODEL = 'mistral-small-latest';

/**
 * Creates a `SlotmuxProvider` for Mistral.
 *
 * @example
 * ```typescript
 * import { mistral } from '@slotmux/providers';
 * import { createContext } from 'slotmux';
 *
 * createContext({
 *   model: 'mistral-large-latest',
 *   preset: 'chat',
 *   slotmuxProvider: mistral({ apiKey: process.env.MISTRAL_API_KEY! }),
 * });
 * ```
 *
 * @param opts - API key and optional overrides
 * @returns A `SlotmuxProvider` with auto-wired summarization
 */
export function mistral(opts: SlotmuxProviderOptions): SlotmuxProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.compressionModel ?? DEFAULT_COMPRESSION_MODEL;
  const limiter = createAdaptiveRateLimiter({
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : async ({ systemPrompt, userPayload }) =>
        limiter.run(async () => {
          const res = await fetchWithRetry(
            `${baseUrl}/chat/completions`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${opts.apiKey}`,
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPayload },
                ],
                temperature: 0.3,
              }),
            },
            { maxRetries: 0 },
          );
          const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return json.choices?.[0]?.message?.content ?? '';
        });

  return {
    adapter: createMistralAdapter(),
    summarizeText: withSanitizedInputs(summarizeText),
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
