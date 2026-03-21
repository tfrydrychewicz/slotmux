/**
 * Anthropic provider factory (§10.3).
 *
 * @packageDocumentation
 */

import { createAnthropicAdapter } from './anthropic-adapter.js';
import {
  wrapCustomSummarize,
  type SlotmuxProvider,
  type SlotmuxProviderOptions,
  type SummarizeTextFn,
} from './provider-factory.js';

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

  const summarizeText: SummarizeTextFn = opts.summarize
    ? wrapCustomSummarize(opts.summarize)
    : async ({ systemPrompt, userPayload }) => {
        const res = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPayload }],
            max_tokens: 4096,
            temperature: 0.3,
          }),
        });
        const json = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        const textBlock = json.content?.find((b) => b.type === 'text');
        return textBlock?.text ?? '';
      };

  return {
    adapter: createAnthropicAdapter(),
    summarizeText,
    ...(opts.embed !== undefined ? { embed: opts.embed } : {}),
  };
}
