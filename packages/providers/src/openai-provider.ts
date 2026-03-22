/**
 * OpenAI provider factory (§10.3).
 *
 * Uses {@link createOpenAIChatFetcher} for resilient API calls and an
 * adaptive rate limiter (AIMD) for coordinated 429 retry across concurrent
 * calls. Output length is guided by the prompt instruction (not a hard
 * `max_completion_tokens` cap), so the model always has room to produce a
 * response.
 *
 * @packageDocumentation
 */

import { createAdaptiveRateLimiter } from './adaptive-rate-limiter.js';
import { createOpenAIAdapter } from './openai-adapter.js';
import { createOpenAIChatFetcher } from './openai-fetch.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
  type SummarizeTextResult,
} from './provider-factory.js';
import { withSanitizedInputs } from './sanitize-llm-input.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_COMPRESSION_MODEL = 'gpt-5.4-mini';

/**
 * Creates a `SlotmuxProvider` for OpenAI.
 *
 * @example
 * ```typescript
 * import { openai } from '@slotmux/providers';
 * import { createContext } from 'slotmux';
 *
 * createContext({
 *   model: 'gpt-5.4',
 *   preset: 'chat',
 *   slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY! }),
 * });
 * ```
 *
 * @param opts - API key and optional overrides
 * @returns A `SlotmuxProvider` with auto-wired summarization
 */
export function openai(opts: SlotmuxProviderOptions): SlotmuxProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.compressionModel ?? DEFAULT_COMPRESSION_MODEL;

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : (() => {
        const chat = createOpenAIChatFetcher({
          baseUrl,
          apiKey: opts.apiKey,
          model,
          maxRetries: 0,
        });
        const limiter = createAdaptiveRateLimiter({
          ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
        });

        return async ({ systemPrompt, userPayload, responseSchema }): Promise<SummarizeTextResult> =>
          limiter.run(async () => {
            const { content, finishReason, httpStatus } = await chat({
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPayload },
              ],
              ...(responseSchema !== undefined
                ? { responseFormat: { type: 'json_schema', json_schema: { name: 'facts', schema: responseSchema, strict: true } } }
                : {}),
            });
            return { text: content, finishReason, httpStatus };
          });
      })();

  return {
    adapter: createOpenAIAdapter(),
    summarizeText: withSanitizedInputs(summarizeText),
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
