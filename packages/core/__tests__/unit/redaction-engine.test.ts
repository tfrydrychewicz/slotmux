import { describe, expect, it } from 'vitest';

import { LogLevel } from '../../src/logging/logger.js';
import {
  createContextEventRedactor,
  RedactionEngine,
  redactContextEvent,
  shouldRedactObservability,
} from '../../src/logging/redaction-engine.js';
import { createContentId, toTokenCount } from '../../src/types/branded.js';
import type { ContentItem } from '../../src/types/content.js';

describe('RedactionEngine', () => {
  it('redacts with default patterns', () => {
    const engine = RedactionEngine.defaultEngine();
    expect(engine.redactString('email me@x.com')).toBe('email [REDACTED]');
  });

  it('accepts custom patterns', () => {
    const engine = new RedactionEngine({
      patterns: [/SECRET/g],
      replacement: 'X',
    });
    expect(engine.redactString('SECRET code')).toBe('X code');
  });

  it('fromConfig(true) matches defaultEngine', () => {
    const a = RedactionEngine.fromConfig(true);
    const b = RedactionEngine.defaultEngine();
    expect(a.redactString('123-45-6789')).toBe(b.redactString('123-45-6789'));
  });
});

describe('shouldRedactObservability', () => {
  it('is false without redaction', () => {
    expect(shouldRedactObservability({})).toBe(false);
  });

  it('is true when redaction set and level not TRACE', () => {
    expect(shouldRedactObservability({ redaction: true, logLevel: LogLevel.INFO })).toBe(true);
  });

  it('is false at TRACE (full observability)', () => {
    expect(shouldRedactObservability({ redaction: true, logLevel: LogLevel.TRACE })).toBe(false);
  });
});

describe('redactContextEvent', () => {
  it('redacts content:added item strings', () => {
    const engine = RedactionEngine.defaultEngine();
    const item: ContentItem = {
      id: createContentId(),
      role: 'user',
      content: 'reach me@evil.com',
      slot: 'history',
      createdAt: 1,
    };
    const out = redactContextEvent({ type: 'content:added', slot: 'history', item }, engine);
    expect(out.type).toBe('content:added');
    if (out.type === 'content:added') {
      expect(out.item.content).toBe('reach [REDACTED]');
    }
  });
});

describe('createContextEventRedactor', () => {
  it('returns undefined when redaction off', () => {
    expect(createContextEventRedactor({})).toBeUndefined();
  });

  it('returns undefined at TRACE', () => {
    expect(createContextEventRedactor({ redaction: true, logLevel: LogLevel.TRACE })).toBeUndefined();
  });

  it('redacts in returned closure', () => {
    const r = createContextEventRedactor({ redaction: true, logLevel: LogLevel.DEBUG });
    expect(r).toBeDefined();
    const item: ContentItem = {
      id: createContentId(),
      role: 'user',
      content: '123-45-6789',
      slot: 'h',
      createdAt: 1,
    };
    const ev = r!({ type: 'content:added', slot: 'h', item });
    if (ev.type === 'content:added') {
      expect(ev.item.content).toBe('[REDACTED]');
    }
  });
});

describe('RedactionEngine redactUnknown with tokens', () => {
  it('preserves numeric branded-like fields in plain objects', () => {
    const engine = RedactionEngine.defaultEngine();
    const out = engine.redactUnknown({ t: toTokenCount(5), s: 'me@x.com' }) as {
      t: unknown;
      s: string;
    };
    expect(out.t).toBe(5);
    expect(out.s).toBe('[REDACTED]');
  });
});
