import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  fetchWithRetry,
  ProviderRateLimitError,
  parseRetryAfterBody,
} from '../../src/fetch-with-retry.js';

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function rateLimitResponse(retryHint: string, retryAfterHeader?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (retryAfterHeader !== undefined) {
    headers['Retry-After'] = retryAfterHeader;
  }
  return jsonResponse(
    {
      error: {
        message: `Rate limit reached. Please ${retryHint}.`,
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    },
    429,
    headers,
  );
}

const URL = 'https://api.example.com/v1/chat';
const INIT: RequestInit = { method: 'POST', body: '{}' };

// ── Tests ────────────────────────────────────────────────────────────

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetch(): ReturnType<typeof vi.fn> {
    return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  }

  it('returns successful response without retry', async () => {
    mockFetch().mockResolvedValueOnce(jsonResponse({ ok: true }));

    const res = await fetchWithRetry(URL, INIT);

    expect(res.status).toBe(200);
    expect(mockFetch()).toHaveBeenCalledTimes(1);
  });

  it('returns non-429 error responses without retry', async () => {
    mockFetch().mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 400));

    const res = await fetchWithRetry(URL, INIT);

    expect(res.status).toBe(400);
    expect(mockFetch()).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    mockFetch()
      .mockResolvedValueOnce(rateLimitResponse('try again in 500ms'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchWithRetry(URL, INIT);
    await vi.advanceTimersByTimeAsync(600);

    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('retries multiple times then succeeds', async () => {
    mockFetch()
      .mockResolvedValueOnce(rateLimitResponse('try again in 500ms'))
      .mockResolvedValueOnce(rateLimitResponse('try again in 1s'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchWithRetry(URL, INIT, { maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch()).toHaveBeenCalledTimes(3);
  });

  it('throws ProviderRateLimitError when maxRetries is 0', async () => {
    vi.useRealTimers();
    mockFetch().mockResolvedValueOnce(rateLimitResponse('try again in 1s'));

    await expect(
      fetchWithRetry(URL, INIT, { maxRetries: 0 }),
    ).rejects.toThrow(ProviderRateLimitError);
    expect(mockFetch()).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After header (seconds)', async () => {
    mockFetch()
      .mockResolvedValueOnce(rateLimitResponse('', '2'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchWithRetry(URL, INIT);

    await vi.advanceTimersByTimeAsync(1500);
    expect(mockFetch()).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);

    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('falls back to exponential backoff when no hints', async () => {
    mockFetch()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchWithRetry(URL, INIT);

    await vi.advanceTimersByTimeAsync(500);
    expect(mockFetch()).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);

    const res = await promise;
    expect(res.status).toBe(200);
  });

  it('includes response body in ProviderRateLimitError', async () => {
    vi.useRealTimers();
    const errorBody = '{"error":{"message":"Rate limit reached"}}';
    mockFetch().mockResolvedValueOnce(
      new Response(errorBody, { status: 429 }),
    );

    try {
      await fetchWithRetry(URL, INIT, { maxRetries: 0 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderRateLimitError);
      expect((e as ProviderRateLimitError).responseBody).toBe(errorBody);
      expect((e as ProviderRateLimitError).httpStatus).toBe(429);
    }
  });

  it('uses default maxRetries of 3', async () => {
    vi.useRealTimers();
    mockFetch().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: 'try again in 1ms' } }),
          { status: 429 },
        ),
      ),
    );

    await expect(fetchWithRetry(URL, INIT)).rejects.toThrow(ProviderRateLimitError);
    expect(mockFetch()).toHaveBeenCalledTimes(4);
  });
});

describe('parseRetryAfterBody', () => {
  it('parses seconds', () => {
    expect(parseRetryAfterBody('Please try again in 1.5s.')).toBe(1500);
  });

  it('parses milliseconds', () => {
    expect(parseRetryAfterBody('try again in 311ms')).toBe(311);
  });

  it('rounds up fractional seconds', () => {
    expect(parseRetryAfterBody('try again in 1.013s')).toBe(1013);
  });

  it('returns null for non-matching strings', () => {
    expect(parseRetryAfterBody('Something went wrong')).toBeNull();
  });

  it('parses whole seconds', () => {
    expect(parseRetryAfterBody('try again in 2s')).toBe(2000);
  });
});
