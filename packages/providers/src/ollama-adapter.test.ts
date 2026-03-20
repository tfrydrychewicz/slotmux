import type { CompiledMessage } from 'slotmux';
import {
  clearRegisteredModels,
  registerModel,
} from 'slotmux';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createOllamaAdapter,
  formatOllamaMessages,
  OllamaAdapter,
} from './ollama-adapter.js';

afterEach(() => {
  clearRegisteredModels();
});

describe('formatOllamaMessages', () => {
  it('orders system first and maps roles', () => {
    const messages: CompiledMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'system', content: 'Be brief.' },
    ];
    expect(formatOllamaMessages(messages)).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('maps assistant toolUses to tool_calls', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolUses: [{ id: '1', name: 'get_weather', input: { city: 'YYZ' } }],
      },
    ];
    expect(formatOllamaMessages(messages)).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'get_weather',
              arguments: { city: 'YYZ' },
            },
          },
        ],
      },
    ]);
  });

  it('maps tool role to tool_name + content', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'tool',
        name: 'get_weather',
        tool_call_id: 'ignored-by-ollama',
        content: '12°C',
      },
    ];
    expect(formatOllamaMessages(messages)).toEqual([
      { role: 'tool', content: '12°C', tool_name: 'get_weather' },
    ]);
  });

  it('maps function role to user text', () => {
    const messages: CompiledMessage[] = [
      { role: 'function', name: 'f', content: '{"x":1}' },
    ];
    expect(formatOllamaMessages(messages)).toEqual([
      { role: 'user', content: '{"x":1}' },
    ]);
  });

  it('puts base64 images on user.images', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What?' },
          {
            type: 'image_base64',
            image_base64: { data: 'QUJD', mime_type: 'image/png' },
          },
        ],
      },
    ];
    expect(formatOllamaMessages(messages)).toEqual([
      { role: 'user', content: 'What?', images: ['QUJD'] },
    ]);
  });
});

describe('OllamaAdapter', () => {
  it('resolves built-in registry models', () => {
    const a = createOllamaAdapter();
    expect(a.id).toBe('ollama');
    expect(a.resolveModel('ollama/llama3').maxContextTokens).toBe(8192);
    expect(
      a.formatMessages([{ role: 'user', content: 'x' }]),
    ).toEqual([{ role: 'user', content: 'x' }]);
    expect(a.getTokenizer('ollama/llama3').id).toBeDefined();
  });

  it('uses registerModel for arbitrary local names', () => {
    registerModel('myorg/custom-7b', {
      maxTokens: 4096,
      provider: 'ollama',
    });
    const a: OllamaAdapter = createOllamaAdapter();
    expect(a.resolveModel('myorg/custom-7b').maxContextTokens).toBe(4096);
  });
});
