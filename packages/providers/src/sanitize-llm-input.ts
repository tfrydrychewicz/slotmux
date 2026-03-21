/**
 * Provider-agnostic input sanitization for LLM API calls.
 *
 * Strips characters that cause request payload parsing failures across
 * different API providers (OpenAI, Anthropic, Google, Mistral, Ollama).
 *
 * @packageDocumentation
 */

/**
 * ASCII control characters to strip. Preserves `\t` (0x09), `\n` (0x0A),
 * and `\r` (0x0D) which are common in conversation text.
 *
 * Also strips DEL (0x7F) and C1 control range (0x80-0x9F).
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g;

/**
 * Lone surrogates that survive in JS strings but produce invalid JSON
 * on strict parsers. These are unpaired high/low surrogates.
 */
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Strips characters that break LLM API JSON parsers.
 *
 * Safe to apply to any text before sending to an LLM. Does not alter
 * semantically meaningful content — only removes invisible control
 * characters and broken surrogate pairs.
 *
 * @param text - Raw input text (system prompt or user payload)
 * @returns Cleaned text safe for `JSON.stringify` and all LLM API parsers
 *
 * @example
 * ```typescript
 * const clean = sanitizeLLMInput('Hello\x00World\x07!');
 * // 'HelloWorld!'
 * ```
 */
export function sanitizeLLMInput(text: string): string {
  return text.replace(CONTROL_CHARS, '').replace(LONE_SURROGATES, '\uFFFD');
}

/**
 * Wraps a `SummarizeTextFn` so that `systemPrompt` and `userPayload`
 * are sanitized before reaching the LLM.
 *
 * Applied by all provider factories to ensure inputs are clean regardless
 * of the data source. Generic over the return type so providers returning
 * `SummarizeTextResult` metadata pass it through unchanged.
 *
 * @param fn - The summarize function to wrap
 * @returns A wrapped function with identical signature that sanitizes text inputs
 *
 * @internal
 */
export function withSanitizedInputs<R>(
  fn: (params: {
    readonly layer: 1 | 2 | 3;
    readonly systemPrompt: string;
    readonly userPayload: string;
    readonly targetTokens?: number;
  }) => Promise<R>,
): typeof fn {
  return async (params) =>
    fn({
      ...params,
      systemPrompt: sanitizeLLMInput(params.systemPrompt),
      userPayload: sanitizeLLMInput(params.userPayload),
    });
}
