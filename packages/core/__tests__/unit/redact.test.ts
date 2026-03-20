import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REDACTION_PATTERNS,
  redactString,
  redactUnknown,
} from '../../src/logging/redact.js';

describe('redactString', () => {
  it('redacts SSN-like segments', () => {
    expect(redactString('id 123-45-6789 end')).toBe('id [REDACTED] end');
  });

  it('redacts email addresses', () => {
    expect(redactString('Contact a@b.co please')).toBe('Contact [REDACTED] please');
  });

  it('redacts 16-digit card-style groups', () => {
    expect(redactString('pay 4111-1111-1111-1111 ok')).toBe('pay [REDACTED] ok');
  });

  it('redacts Amex-style 15 digits', () => {
    expect(redactString('card 378282246310005 end')).toBe('card [REDACTED] end');
  });

  it('uses custom replacement', () => {
    expect(
      redactString('123-45-6789', DEFAULT_REDACTION_PATTERNS, '***'),
    ).toBe('***');
  });
});

describe('redactUnknown', () => {
  it('walks nested objects', () => {
    const out = redactUnknown({
      user: 'x@y.com',
      nested: { ssn: '123-45-6789' },
    }) as { user: string; nested: { ssn: string } };
    expect(out.user).toBe('[REDACTED]');
    expect(out.nested.ssn).toBe('[REDACTED]');
  });

  it('leaves numbers and null', () => {
    expect(redactUnknown({ n: 1, z: null })).toEqual({ n: 1, z: null });
  });
});
