import { describe, expect, it, vi } from 'vitest';

import { sanitizeLLMInput, withSanitizedInputs } from '../../src/sanitize-llm-input.js';

describe('sanitizeLLMInput', () => {
  it('returns clean text unchanged', () => {
    const clean = 'Hello, world! This is a test.\nWith newlines.\tAnd tabs.';
    expect(sanitizeLLMInput(clean)).toBe(clean);
  });

  it('strips NULL bytes', () => {
    expect(sanitizeLLMInput('Hello\x00World')).toBe('HelloWorld');
  });

  it('strips ASCII control characters (0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F)', () => {
    expect(sanitizeLLMInput('a\x01b\x02c\x07d\x08e')).toBe('abcde');
    expect(sanitizeLLMInput('f\x0Bg\x0Ch')).toBe('fgh');
    expect(sanitizeLLMInput('i\x0Ej\x1Fk')).toBe('ijk');
  });

  it('preserves tab, newline, and carriage return', () => {
    expect(sanitizeLLMInput('a\tb\nc\r\nd')).toBe('a\tb\nc\r\nd');
  });

  it('strips DEL character (0x7F)', () => {
    expect(sanitizeLLMInput('before\x7Fafter')).toBe('beforeafter');
  });

  it('strips C1 control range (0x80-0x9F)', () => {
    expect(sanitizeLLMInput('a\x80b\x8Fc\x9Fd')).toBe('abcd');
  });

  it('replaces lone high surrogates with U+FFFD', () => {
    expect(sanitizeLLMInput('a\uD800b')).toBe('a\uFFFDb');
  });

  it('replaces lone low surrogates with U+FFFD', () => {
    expect(sanitizeLLMInput('a\uDC00b')).toBe('a\uFFFDb');
  });

  it('preserves valid surrogate pairs (emoji)', () => {
    const emoji = '😀🎉';
    expect(sanitizeLLMInput(emoji)).toBe(emoji);
  });

  it('handles empty string', () => {
    expect(sanitizeLLMInput('')).toBe('');
  });

  it('handles mixed problematic characters', () => {
    expect(sanitizeLLMInput('Hi!\x00\x07\x7F How\x80 are you?'))
      .toBe('Hi! How are you?');
  });
});

describe('withSanitizedInputs', () => {
  it('sanitizes systemPrompt and userPayload before calling the wrapped fn', async () => {
    const inner = vi.fn(async (params: {
      readonly layer: 1 | 2 | 3;
      readonly systemPrompt: string;
      readonly userPayload: string;
      readonly targetTokens?: number;
    }) => `summary of: ${params.userPayload}`);

    const wrapped = withSanitizedInputs(inner);

    const result = await wrapped({
      layer: 1,
      systemPrompt: 'Summarize\x00 this',
      userPayload: 'Hello\x07 world\x00!',
      targetTokens: 100,
    });

    expect(inner).toHaveBeenCalledWith({
      layer: 1,
      systemPrompt: 'Summarize this',
      userPayload: 'Hello world!',
      targetTokens: 100,
    });
    expect(result).toBe('summary of: Hello world!');
  });

  it('preserves all other params untouched', async () => {
    const inner = vi.fn(async () => 'ok');
    const wrapped = withSanitizedInputs(inner);

    await wrapped({ layer: 3, systemPrompt: 'sys', userPayload: 'usr', targetTokens: 42 });

    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({ layer: 3, targetTokens: 42 }),
    );
  });

  it('propagates errors from the inner function', async () => {
    const inner = vi.fn(async () => { throw new Error('boom'); });
    const wrapped = withSanitizedInputs(inner);

    await expect(wrapped({ layer: 1, systemPrompt: '', userPayload: '' }))
      .rejects.toThrow('boom');
  });
});
