/**
 * Provider-agnostic fetch wrapper with automatic HTTP 429 (rate limit) retry.
 *
 * All provider factories use this instead of raw `fetch` so that rate-limited
 * requests are retried transparently with exponential backoff.
 *
 * Retry wait time is resolved in order:
 * 1. Standard `Retry-After` response header (seconds or HTTP date)
 * 2. Body text pattern — `"try again in Xs"` / `"try again in Xms"` (OpenAI style)
 * 3. Exponential backoff: 1 s → 2 s → 4 s → … (capped at 30 s)
 *
 * @packageDocumentation
 */

/** Options for {@link fetchWithRetry}. */
export type FetchWithRetryOptions = {
  /**
   * Maximum retry attempts for HTTP 429 responses.
   * @defaultValue 3
   */
  readonly maxRetries?: number;
};

/**
 * Thrown when all retry attempts for an HTTP 429 response are exhausted.
 *
 * The `responseBody` contains the raw API error for diagnostics.
 */
export class ProviderRateLimitError extends Error {
  override readonly name = 'ProviderRateLimitError';

  constructor(
    readonly responseBody: string,
    readonly httpStatus: number,
  ) {
    super(`Provider rate limit exceeded after retries: ${responseBody.slice(0, 300)}`);
  }
}

/**
 * Wraps `fetch` with automatic retry on HTTP 429 (rate limit) responses.
 *
 * On success (any status other than 429), returns the `Response` as-is
 * for the caller to parse. On 429, retries up to `maxRetries` times with
 * backoff derived from the response.
 *
 * @throws {ProviderRateLimitError} When all retries are exhausted.
 * @returns The successful `Response` (never a 429).
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  options?: FetchWithRetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(input, init);

    if (res.status !== 429) return res;

    const body = await res.text();

    if (attempt === maxRetries) {
      throw new ProviderRateLimitError(body, 429);
    }

    const waitMs = retryWaitMs(res.headers, body, attempt);
    await sleep(waitMs);
  }

  throw new ProviderRateLimitError('', 429);
}

function retryWaitMs(headers: Headers, body: string, attempt: number): number {
  const fromHeader = parseRetryAfterHeader(headers);
  if (fromHeader !== null) return fromHeader;

  const fromBody = parseRetryAfterBody(body);
  if (fromBody !== null) return fromBody;

  return Math.min(1000 * 2 ** attempt, 30_000);
}

function parseRetryAfterHeader(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (value === null) return null;

  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000);

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

/** Visible for testing — parses `"try again in Xs"` / `"try again in Xms"`. */
export function parseRetryAfterBody(body: string): number | null {
  const match = /try again in (\d+(?:\.\d+)?)\s*(s|ms)/i.exec(body);
  if (!match) return null;
  const value = parseFloat(match[1]!);
  return match[2] === 'ms' ? Math.ceil(value) : Math.ceil(value * 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
