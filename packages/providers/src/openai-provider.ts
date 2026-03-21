/**
 * OpenAI provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createOpenAIAdapter } from './openai-adapter.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';

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
    : async ({ systemPrompt, userPayload }) => {
        const res = await fetch(`${baseUrl}/chat/completions`, {
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
        });
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return json.choices?.[0]?.message?.content ?? '';
      };

  return {
    adapter: createOpenAIAdapter(),
    summarizeText,
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
