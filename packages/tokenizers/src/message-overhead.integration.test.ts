/**
 * Integration checks: {@link countCompiledMessages} formula matches tokenizer `countMessages`
 * using real BPE backends (tiktoken, Anthropic) on {@link compiledMessageToEstimationString}.
 */

import { TOKEN_OVERHEAD } from 'slotmux';
import { describe, expect, it, afterEach } from 'vitest';

import { compiledMessageToEstimationString } from './compiled-message-string.js';
import { countCompiledMessages } from './message-count.js';

import {
  Cl100kTokenizer,
  ClaudeTokenizer,
  freeTiktokenEncodings,
} from './index.js';

afterEach(() => {
  freeTiktokenEncodings();
});

describe('countMessages ↔ §9.4 overhead (integration)', () => {
  it('Cl100kTokenizer.countMessages matches OpenAI registry + tiktoken(estimationString)', () => {
    const tokenizer = new Cl100kTokenizer();
    const messages = [
      { role: 'user' as const, content: 'Hello, world!' },
      { role: 'assistant' as const, content: 'Hi there.' },
    ] as const;

    const expected = countCompiledMessages(
      (s) => tokenizer.count(s) as number,
      [...messages],
      TOKEN_OVERHEAD.openai,
    );
    expect(tokenizer.countMessages([...messages]) as number).toBe(expected);
  });

  it('OpenAI: optional name adds perName on top of longer estimation string', () => {
    const tokenizer = new Cl100kTokenizer();
    const base = { role: 'user' as const, content: 'x' };
    const named = { ...base, name: 'tool-user' };

    const baseExpected = countCompiledMessages(
      (s) => tokenizer.count(s) as number,
      [base],
      TOKEN_OVERHEAD.openai,
    );
    const namedExpected = countCompiledMessages(
      (s) => tokenizer.count(s) as number,
      [named],
      TOKEN_OVERHEAD.openai,
    );

    expect(tokenizer.countMessages([base]) as number).toBe(baseExpected);
    expect(tokenizer.countMessages([named]) as number).toBe(namedExpected);

    const strExtra =
      compiledMessageToEstimationString(named).length -
      compiledMessageToEstimationString(base).length;
    const tokenDelta =
      (tokenizer.count(compiledMessageToEstimationString(named)) as number) -
      (tokenizer.count(compiledMessageToEstimationString(base)) as number);
    expect(namedExpected - baseExpected).toBe(
      tokenDelta + TOKEN_OVERHEAD.openai.perName,
    );
    expect(strExtra).toBeGreaterThan(0);
  });

  it('ClaudeTokenizer.countMessages matches Anthropic registry + countTokens(estimationString)', () => {
    const tokenizer = new ClaudeTokenizer();
    const messages = [
      { role: 'user' as const, content: 'Count me.' },
      { role: 'assistant' as const, content: 'OK.' },
    ];

    const expected = countCompiledMessages(
      (s) => tokenizer.count(s) as number,
      messages,
      TOKEN_OVERHEAD.anthropic,
    );
    expect(tokenizer.countMessages(messages) as number).toBe(expected);
  });
});
