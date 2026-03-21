/**
 * Resilient OpenAI-compatible chat completion fetcher.
 *
 * Handles two problems that arise in production:
 *
 * 1. **`max_tokens` vs `max_completion_tokens`** — Newer OpenAI models (o-series, gpt-5.x)
 *    reject `max_tokens` and require `max_completion_tokens`; older models do the opposite.
 *    The fetcher auto-detects which parameter the model accepts on the first call and caches
 *    the result for all subsequent calls.
 *
 * 2. **HTTP 429 rate limits** — Delegated to {@link fetchWithRetry} which retries with
 *    exponential backoff, parsing `Retry-After` headers and body hints.
 *
 * @packageDocumentation
 */

import { fetchWithRetry } from './fetch-with-retry.js';

const MAX_COMPLETION_TOKENS = 'max_completion_tokens' as const;
const MAX_TOKENS = 'max_tokens' as const;

type TokenParamName = typeof MAX_COMPLETION_TOKENS | typeof MAX_TOKENS;

/** Shape of an OpenAI error response body. */
type OpenAIErrorBody = {
  error?: {
    message?: string;
    type?: string;
    param?: string | null;
    code?: string;
  };
};

/** Successful chat completion response (only the fields we need). */
type OpenAIChatBody = {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: OpenAIErrorBody['error'];
};

/** Result of a successful chat completion call. */
export type OpenAIChatResult = {
  /** The completion text (may be empty if the model returned nothing). */
  readonly content: string;
  /** The `finish_reason` from the API (`"stop"`, `"length"`, etc.). */
  readonly finishReason: string | null;
  /** HTTP status code of the response. */
  readonly httpStatus: number;
};

/** Options for {@link createOpenAIChatFetcher}. */
export type OpenAIChatFetcherOptions = {
  /** Base URL for the OpenAI-compatible API (e.g. `"https://api.openai.com/v1"`). */
  readonly baseUrl: string;
  /** Bearer token for the `Authorization` header. */
  readonly apiKey: string;
  /** Model name (e.g. `"gpt-5.4-mini"`, `"gpt-4o"`). */
  readonly model: string;
  /**
   * Maximum retry attempts for HTTP 429 (rate limit) responses.
   * @defaultValue 3
   */
  readonly maxRetries?: number;
};

/**
 * Thrown on non-retryable OpenAI API errors (4xx other than 429, 5xx, malformed responses).
 */
export class OpenAIApiError extends Error {
  override readonly name = 'OpenAIApiError';

  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
  }
}

/**
 * Creates a reusable, resilient OpenAI chat completion caller.
 *
 * The returned function is **stateful**: it caches the detected `max_tokens` parameter
 * name after the first successful probe. Multiple calls share the cache.
 *
 * Rate-limit retries are handled by {@link fetchWithRetry} — this module only adds the
 * OpenAI-specific `max_tokens` / `max_completion_tokens` auto-detection on top.
 *
 * @example
 * ```typescript
 * const chat = createOpenAIChatFetcher({
 *   baseUrl: 'https://api.openai.com/v1',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-5.4-mini',
 * });
 *
 * const { content } = await chat({
 *   messages: [
 *     { role: 'system', content: 'Summarize.' },
 *     { role: 'user', content: longText },
 *   ],
 *   maxOutputTokens: 500,
 * });
 * ```
 *
 * @throws {ProviderRateLimitError} When all 429 retries are exhausted.
 * @throws {OpenAIApiError} On non-retryable HTTP errors or malformed responses.
 */
export function createOpenAIChatFetcher(opts: OpenAIChatFetcherOptions) {
  const { baseUrl, apiKey, model } = opts;
  const retryOpts = opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : undefined;
  let detectedParam: TokenParamName | null = null;

  async function callApi(
    messages: ReadonlyArray<{ readonly role: string; readonly content: string }>,
    maxOutputTokens: number | undefined,
    temperature: number,
    paramOverride?: TokenParamName,
  ): Promise<OpenAIChatResult> {
    const paramName = paramOverride ?? detectedParam ?? MAX_COMPLETION_TOKENS;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
    };
    if (maxOutputTokens !== undefined) {
      body[paramName] = maxOutputTokens;
    }

    const res = await fetchWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      retryOpts,
    );

    if (res.status === 400 && detectedParam === null && maxOutputTokens !== undefined) {
      const raw = await res.text();
      let errBody: OpenAIErrorBody | undefined;
      try {
        errBody = JSON.parse(raw) as OpenAIErrorBody;
      } catch {
        /* not JSON — fall through */
      }

      if (
        errBody?.error?.code === 'unsupported_parameter' &&
        errBody.error.param === paramName
      ) {
        const otherParam = paramName === MAX_COMPLETION_TOKENS ? MAX_TOKENS : MAX_COMPLETION_TOKENS;
        detectedParam = otherParam;
        return callApi(messages, maxOutputTokens, temperature, otherParam);
      }

      throw new OpenAIApiError(
        `OpenAI API error (HTTP 400): ${raw.slice(0, 500)}`,
        400,
      );
    }

    if (!res.ok) {
      const raw = await res.text();
      throw new OpenAIApiError(
        `OpenAI API error (HTTP ${String(res.status)}): ${raw.slice(0, 500)}`,
        res.status,
      );
    }

    if (detectedParam === null && maxOutputTokens !== undefined) {
      detectedParam = paramName;
    }

    const json = (await res.json()) as OpenAIChatBody;
    if (json.error) {
      throw new OpenAIApiError(
        `OpenAI API error in response body: ${json.error.type ?? 'unknown'}: ${json.error.message ?? 'unknown'}`,
        res.status,
      );
    }

    return {
      content: json.choices?.[0]?.message?.content ?? '',
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      httpStatus: res.status,
    };
  }

  return async function fetchChatCompletion(params: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
    readonly maxOutputTokens?: number;
    readonly temperature?: number;
  }): Promise<OpenAIChatResult> {
    return callApi(params.messages, params.maxOutputTokens, params.temperature ?? 0.3);
  };
}
