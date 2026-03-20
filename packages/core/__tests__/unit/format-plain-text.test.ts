import { describe, expect, it } from 'vitest';

import {
  compiledMessageToPlainText,
  formatCompiledMessagesAsPlainText,
} from '../../src/snapshot/format-plain-text.js';
import type { CompiledMessage } from '../../src/types/content.js';

describe('formatCompiledMessagesAsPlainText', () => {
  it('joins string messages with blank lines', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hey' },
    ];
    expect(formatCompiledMessagesAsPlainText(messages)).toBe('Sys\n\nHi\n\nHey');
  });

  it('skips wholly empty messages', () => {
    const messages: CompiledMessage[] = [
      { role: 'user', content: 'A' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'B' },
    ];
    expect(formatCompiledMessagesAsPlainText(messages)).toBe('A\n\nB');
  });

  it('renders multimodal text and image placeholders', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'See:' },
          { type: 'image_url', image_url: { url: 'https://x.test/a.png' } },
          { type: 'text', text: 'Thanks.' },
        ],
      },
    ];
    expect(formatCompiledMessagesAsPlainText(messages)).toBe('See:\n[image]\nThanks.');
  });

  it('appends JSON for assistant toolUses', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'assistant',
        content: 'Calling tool',
        toolUses: [{ id: 'call_1', name: 'search', input: { q: 'x' } }],
      },
    ];
    expect(formatCompiledMessagesAsPlainText(messages)).toBe(
      'Calling tool\n[{"id":"call_1","name":"search","input":{"q":"x"}}]',
    );
  });

  it('uses only toolUses when there is no textual content', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolUses: [{ id: '1', name: 'noop', input: {} }],
      },
    ];
    expect(formatCompiledMessagesAsPlainText(messages)).toBe('[{"id":"1","name":"noop","input":{}}]');
  });
});

describe('compiledMessageToPlainText', () => {
  it('maps image_base64 to placeholder', () => {
    const m: CompiledMessage = {
      role: 'user',
      content: [{ type: 'image_base64', image_base64: { data: 'abc' } }],
    };
    expect(compiledMessageToPlainText(m)).toBe('[image]');
  });
});
