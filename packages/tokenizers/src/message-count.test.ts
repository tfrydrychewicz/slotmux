import { TOKEN_OVERHEAD } from 'slotmux';
import { describe, expect, it } from 'vitest';

import { compiledMessageToEstimationString } from './compiled-message-string.js';
import {
  compiledMessageTokenUnits,
  countCompiledMessages,
} from './message-count.js';

/** Deterministic “tokenizer”: one token per UTF-16 code unit. */
function countChars(s: string): number {
  return s.length;
}

describe('compiledMessageTokenUnits / countCompiledMessages', () => {
  const openai = TOKEN_OVERHEAD.openai;
  const anthropic = TOKEN_OVERHEAD.anthropic;

  it('adds perName only when name is non-empty (OpenAI)', () => {
    const base = { role: 'user' as const, content: 'hi' };
    const named = { ...base, name: 'alice' };
    const uBase = compiledMessageTokenUnits(countChars, base, openai);
    const uNamed = compiledMessageTokenUnits(countChars, named, openai);
    const strDelta =
      compiledMessageToEstimationString(named).length -
      compiledMessageToEstimationString(base).length;
    expect(uNamed - uBase).toBe(strDelta + openai.perName);
  });

  it('does not add Anthropic perName (registry perName is 0)', () => {
    const base = { role: 'user' as const, content: 'hi' };
    const named = { ...base, name: 'alice' };
    const uBase = compiledMessageTokenUnits(countChars, base, anthropic);
    const uNamed = compiledMessageTokenUnits(countChars, named, anthropic);
    const strDelta =
      compiledMessageToEstimationString(named).length -
      compiledMessageToEstimationString(base).length;
    expect(uNamed - uBase).toBe(strDelta);
  });

  it('countCompiledMessages returns 0 for empty list', () => {
    expect(countCompiledMessages(countChars, [], openai)).toBe(0);
  });

  it('applies conversation overhead once for non-empty lists', () => {
    const a = { role: 'user' as const, content: 'a' };
    const b = { role: 'assistant' as const, content: 'b' };
    const msgs = [a, b];
    const total = countCompiledMessages(countChars, msgs, openai);
    const sumParts =
      openai.perConversation +
      compiledMessageTokenUnits(countChars, a, openai) +
      compiledMessageTokenUnits(countChars, b, openai);
    expect(total).toBe(sumParts);
  });

  it('Anthropic overhead totals are lower than OpenAI for same messages', () => {
    const msgs = [{ role: 'user' as const, content: 'hello world' }];
    const o = countCompiledMessages(countChars, msgs, openai);
    const a = countCompiledMessages(countChars, msgs, anthropic);
    expect(a).toBeLessThan(o);
  });
});
