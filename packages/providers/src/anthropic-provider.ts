/**
 * Anthropic provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createAdaptiveRateLimiter } from './adaptive-rate-limiter.js';
import { createAnthropicAdapter } from './anthropic-adapter.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';
import { withSanitizedInputs } from './sanitize-llm-input.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_COMPRESSION_MODEL = 'claude-3-5-haiku-20241022';

/**
 * Creates a `SlotmuxProvider` for Anthropic.
 *
 * @example
 * ```typescript
 * import { anthropic } from '@slotmux/providers';
 * import { createContext } from 'slotmux';
 *
 * createContext({
 *   model: 'claude-sonnet-4-20250514',
 *   preset: 'chat',
 *   slotmuxProvider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
 * });
 * ```
 *
 * @param opts - API key and optional overrides
 * @returns A `SlotmuxProvider` with auto-wired summarization
 */
export function anthropic(opts: SlotmuxProviderOptions): SlotmuxProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.compressionModel ?? DEFAULT_COMPRESSION_MODEL;
  const limiter = createAdaptiveRateLimiter({
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : async ({ systemPrompt, userPayload, responseSchema }) =>
        limiter.run(async () => {
          const requestBody: Record<string, unknown> = {
            model,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPayload }],
            max_tokens: 4096,
            temperature: 0.3,
          };

          if (responseSchema !== undefined) {
            requestBody['tools'] = [
              {
                name: 'extract_facts',
                description: 'Extract structured facts from the conversation.',
                input_schema: responseSchema,
              },
            ];
            requestBody['tool_choice'] = { type: 'tool', name: 'extract_facts' };
          }

          const res = await fetchWithRetry(
            `${baseUrl}/messages`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': opts.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify(requestBody),
            },
            { maxRetries: 0 },
          );
          const json = (await res.json()) as {
            content?: Array<{ type: string; text?: string; input?: unknown }>;
          };

          if (responseSchema !== undefined) {
            const toolBlock = json.content?.find((b) => b.type === 'tool_use');
            if (toolBlock?.input !== undefined) {
              return JSON.stringify(toolBlock.input);
            }
          }

          const textBlock = json.content?.find((b) => b.type === 'text');
          return textBlock?.text ?? '';
        });

  return {
    adapter: createAnthropicAdapter(),
    summarizeText: withSanitizedInputs(summarizeText),
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
