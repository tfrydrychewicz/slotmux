/**
 * Google (Gemini) provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createAdaptiveRateLimiter } from './adaptive-rate-limiter.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { createGoogleAdapter } from './google-adapter.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';
import { withSanitizedInputs } from './sanitize-llm-input.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_COMPRESSION_MODEL = 'gemini-2.0-flash';

/**
 * Creates a `SlotmuxProvider` for Google Gemini.
 *
 * @example
 * ```typescript
 * import { google } from '@slotmux/providers';
 * import { createContext } from 'slotmux';
 *
 * createContext({
 *   model: 'gemini-2.5-pro',
 *   preset: 'chat',
 *   slotmuxProvider: google({ apiKey: process.env.GOOGLE_API_KEY! }),
 * });
 * ```
 *
 * @param opts - API key and optional overrides
 * @returns A `SlotmuxProvider` with auto-wired summarization
 */
export function google(opts: SlotmuxProviderOptions): SlotmuxProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.compressionModel ?? DEFAULT_COMPRESSION_MODEL;
  const limiter = createAdaptiveRateLimiter({
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : async ({ systemPrompt, userPayload }) =>
        limiter.run(async () => {
          const url = `${baseUrl}/models/${model}:generateContent?key=${opts.apiKey}`;
          const res = await fetchWithRetry(
            url,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPayload }] }],
                generationConfig: {
                  temperature: 0.3,
                },
              }),
            },
            { maxRetries: 0 },
          );
          const json = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        });

  return {
    adapter: createGoogleAdapter(),
    summarizeText: withSanitizedInputs(summarizeText),
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
