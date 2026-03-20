import type { CompiledMessage } from 'contextcraft';
import { describe, expect, it } from 'vitest';

import {
  collapseConsecutiveGeminiRoles,
  createGoogleAdapter,
  formatGeminiMessages,
  GoogleAdapter,
} from './google-adapter.js';

describe('formatGeminiMessages', () => {
  it('extracts system into systemInstruction.parts', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];
    expect(formatGeminiMessages(messages)).toEqual({
      systemInstruction: { parts: [{ text: 'You are helpful.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
    });
  });

  it('joins multiple system messages', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'Hi' },
    ];
    expect(formatGeminiMessages(messages).systemInstruction?.parts[0]?.text).toBe(
      'A\n\nB',
    );
  });

  it('maps assistant to model role', () => {
    const messages: CompiledMessage[] = [
      { role: 'assistant', content: 'Hello.' },
    ];
    expect(formatGeminiMessages(messages)).toEqual({
      contents: [{ role: 'model', parts: [{ text: 'Hello.' }] }],
    });
  });

  it('maps tool to user functionResponse', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'tool',
        name: 'get_weather',
        tool_call_id: 'x',
        content: '{"temp":72}',
      },
    ];
    expect(formatGeminiMessages(messages)).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_weather',
                response: { temp: 72 },
              },
            },
          ],
        },
      ],
    });
  });

  it('wraps non-JSON tool output in response.output', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'tool',
        name: 't',
        content: 'plain result',
      },
    ];
    expect(formatGeminiMessages(messages).contents[0]?.parts[0]).toEqual({
      functionResponse: {
        name: 't',
        response: { output: 'plain result' },
      },
    });
  });

  it('maps assistant toolUses to functionCall parts', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'assistant',
        content: 'Calling.',
        toolUses: [
          { id: '1', name: 'fn', input: { a: 1 } },
        ],
      },
    ];
    expect(formatGeminiMessages(messages)).toEqual({
      contents: [
        {
          role: 'model',
          parts: [
            { text: 'Calling.' },
            { functionCall: { name: 'fn', args: { a: 1 } } },
          ],
        },
      ],
    });
  });

  it('maps image_base64 to inlineData', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_base64',
            image_base64: { data: 'QUJD', mime_type: 'image/jpeg' },
          },
        ],
      },
    ];
    expect(formatGeminiMessages(messages)).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: 'QUJD',
              },
            },
          ],
        },
      ],
    });
  });

  it('maps image_url to fileData', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/p.png' },
          },
        ],
      },
    ];
    const out = formatGeminiMessages(messages);
    expect(out.contents[0]?.parts[0]).toMatchObject({
      fileData: {
        fileUri: 'https://example.com/p.png',
        mimeType: 'image/png',
      },
    });
  });

  it('merges consecutive user turns', () => {
    const messages: CompiledMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ];
    expect(formatGeminiMessages(messages)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }],
    });
  });
});

describe('collapseConsecutiveGeminiRoles', () => {
  it('merges same role', () => {
    const merged = collapseConsecutiveGeminiRoles([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'user', parts: [{ text: 'b' }] },
    ]);
    expect(merged).toEqual([
      { role: 'user', parts: [{ text: 'a' }, { text: 'b' }] },
    ]);
  });
});

describe('GoogleAdapter', () => {
  it('implements ProviderAdapter', () => {
    const a: GoogleAdapter = createGoogleAdapter();
    expect(a.id).toBe('google');
    expect(a.resolveModel('gemini-2.5-flash').maxContextTokens).toBe(1_048_576);
    const out = a.formatMessages([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ]) as ReturnType<GoogleAdapter['formatMessages']>;
    expect(out.systemInstruction).toEqual({ parts: [{ text: 'S' }] });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'U' }] }]);
    expect(a.getTokenizer('gemini-pro').id).toBeDefined();
  });
});
