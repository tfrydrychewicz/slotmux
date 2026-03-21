import { describe, expect, it, vi } from 'vitest';

import { createDefaultExtractFacts, FactStore, parseFactLines } from '../../src/fact-extraction.js';
import type { FactEntry } from '../../src/fact-extraction.js';

describe('parseFactLines', () => {
  it('extracts FACT: lines and separates narrative', () => {
    const text = [
      'FACT: user | created_playlist | Summer Vibes',
      'FACT: user | platform | Spotify',
      'The user discussed music streaming and created a playlist.',
    ].join('\n');

    const result = parseFactLines(text, 'src-1', 1000);

    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({
      subject: 'user',
      predicate: 'created_playlist',
      value: 'Summer Vibes',
      sourceItemId: 'src-1',
      createdAt: 1000,
    });
    expect(result.facts[1]).toMatchObject({
      subject: 'user',
      predicate: 'platform',
      value: 'Spotify',
    });
    expect(result.narrative).toBe(
      'The user discussed music streaming and created a playlist.',
    );
  });

  it('returns empty facts when no FACT: lines present', () => {
    const text = 'Just a normal summary with no structured facts.';
    const result = parseFactLines(text, 'src-2', 2000);

    expect(result.facts).toHaveLength(0);
    expect(result.narrative).toBe(text);
  });

  it('handles facts interspersed with narrative', () => {
    const text = [
      'FACT: user | camera_lens | Sony FE 24-70mm f/2.8 GM',
      'The user enjoys photography.',
      'FACT: user | favorite_spot | Yosemite',
      'They recently visited a national park.',
    ].join('\n');

    const result = parseFactLines(text, 'src-3', 3000);

    expect(result.facts).toHaveLength(2);
    expect(result.narrative).toBe(
      'The user enjoys photography.\nThey recently visited a national park.',
    );
  });

  it('trims whitespace around subject, predicate, and value', () => {
    const text = 'FACT:   user   |   favorite_color   |   blue   ';
    const result = parseFactLines(text, 'src-4', 4000);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      subject: 'user',
      predicate: 'favorite_color',
      value: 'blue',
    });
  });

  it('ignores malformed FACT: lines (fewer than 3 pipe-separated fields)', () => {
    const text = [
      'FACT: user | incomplete',
      'FACT: user | name | Alice',
      'Some narrative.',
    ].join('\n');

    const result = parseFactLines(text, 'src-5', 5000);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.value).toBe('Alice');
    expect(result.narrative).toContain('FACT: user | incomplete');
  });

  it('handles empty input', () => {
    const result = parseFactLines('', 'src-6', 6000);

    expect(result.facts).toHaveLength(0);
    expect(result.narrative).toBe('');
  });

  it('handles values containing pipe characters after the third field', () => {
    const text = 'FACT: user | query | how to use | in bash';
    const result = parseFactLines(text, 'src-7', 7000);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.value).toBe('how to use | in bash');
  });
});

describe('FactStore', () => {
  const mkFact = (
    subject: string,
    predicate: string,
    value: string,
    confidence = 0.9,
    createdAt = 1000,
  ): FactEntry => ({
    subject,
    predicate,
    value,
    sourceItemId: 'test',
    confidence,
    createdAt,
  });

  it('stores and retrieves facts', () => {
    const store = new FactStore();
    store.add(mkFact('user', 'name', 'Alice'));
    store.add(mkFact('user', 'age', '30'));

    expect(store.size).toBe(2);
    expect(store.all()).toHaveLength(2);
  });

  it('deduplicates by subject|predicate — keeps higher confidence', () => {
    const store = new FactStore();
    store.add(mkFact('user', 'name', 'Alice', 0.7));
    store.add(mkFact('user', 'name', 'Bob', 0.9));

    expect(store.size).toBe(1);
    expect(store.all()[0]!.value).toBe('Bob');
  });

  it('on equal confidence, keeps more recent entry', () => {
    const store = new FactStore();
    store.add(mkFact('user', 'name', 'Alice', 0.9, 1000));
    store.add(mkFact('user', 'name', 'Bob', 0.9, 2000));

    expect(store.size).toBe(1);
    expect(store.all()[0]!.value).toBe('Bob');
  });

  it('does not replace with lower confidence', () => {
    const store = new FactStore();
    store.add(mkFact('user', 'name', 'Alice', 0.95));
    store.add(mkFact('user', 'name', 'Bob', 0.5));

    expect(store.all()[0]!.value).toBe('Alice');
  });

  it('addAll merges multiple facts', () => {
    const store = new FactStore();
    store.addAll([
      mkFact('user', 'name', 'Alice'),
      mkFact('user', 'city', 'NYC'),
      mkFact('user', 'hobby', 'photography'),
    ]);

    expect(store.size).toBe(3);
  });

  it('returns facts ordered by createdAt ascending', () => {
    const store = new FactStore();
    store.add(mkFact('user', 'c', 'third', 0.9, 3000));
    store.add(mkFact('user', 'a', 'first', 0.9, 1000));
    store.add(mkFact('user', 'b', 'second', 0.9, 2000));

    const all = store.all();
    expect(all[0]!.predicate).toBe('a');
    expect(all[1]!.predicate).toBe('b');
    expect(all[2]!.predicate).toBe('c');
  });

  describe('byConfidenceDesc', () => {
    it('returns facts sorted by confidence descending', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'a', 'low', 0.5, 1000));
      store.add(mkFact('user', 'b', 'high', 0.95, 2000));
      store.add(mkFact('user', 'c', 'mid', 0.8, 3000));

      const sorted = store.byConfidenceDesc();
      expect(sorted[0]!.value).toBe('high');
      expect(sorted[1]!.value).toBe('mid');
      expect(sorted[2]!.value).toBe('low');
    });

    it('breaks ties by recency (most recent first)', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'a', 'old', 0.9, 1000));
      store.add(mkFact('user', 'b', 'new', 0.9, 3000));
      store.add(mkFact('user', 'c', 'mid', 0.9, 2000));

      const sorted = store.byConfidenceDesc();
      expect(sorted[0]!.value).toBe('new');
      expect(sorted[1]!.value).toBe('mid');
      expect(sorted[2]!.value).toBe('old');
    });
  });

  describe('render', () => {
    it('renders facts as semicolon-separated text', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'created_playlist', 'Summer Vibes'));
      store.add(mkFact('user', 'platform', 'Spotify'));

      const rendered = store.render();
      expect(rendered).toContain('Known facts:');
      expect(rendered).toContain('Summer Vibes');
      expect(rendered).toContain('Spotify');
      expect(rendered).toContain(';');
    });

    it('returns empty string for empty store', () => {
      const store = new FactStore();
      expect(store.render()).toBe('');
    });

    it('respects maxChars limit', () => {
      const store = new FactStore();
      for (let i = 0; i < 50; i++) {
        store.add(mkFact('user', `fact_${String(i).padStart(2, '0')}`, `value-${String(i)}`, 0.9, i));
      }

      const rendered = store.render(100);
      expect(rendered.length).toBeLessThanOrEqual(100);
      expect(rendered).toContain('Known facts:');
    });

    it('replaces underscores in predicates with spaces', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'camera_lens', 'Sony FE 24-70'));

      const rendered = store.render();
      expect(rendered).toContain('camera lens');
      expect(rendered).not.toContain('camera_lens');
    });

    it('renders highest-confidence facts first', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'a', 'low-conf', 0.5, 1000));
      store.add(mkFact('user', 'b', 'high-conf', 0.99, 2000));

      const rendered = store.render();
      const highIdx = rendered.indexOf('high-conf');
      const lowIdx = rendered.indexOf('low-conf');
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });

  describe('renderAsFactLines', () => {
    it('renders facts as FACT: lines', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'name', 'Alice'));
      store.add(mkFact('user', 'city', 'NYC'));

      const rendered = store.renderAsFactLines();
      expect(rendered).toContain('FACT: user | name | Alice');
      expect(rendered).toContain('FACT: user | city | NYC');
    });

    it('returns empty string for empty store', () => {
      const store = new FactStore();
      expect(store.renderAsFactLines()).toBe('');
    });

    it('respects maxChars limit and drops lowest-confidence facts', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'critical', 'must-keep', 0.99, 1000));
      store.add(mkFact('user', 'low', 'can-drop', 0.3, 2000));

      const rendered = store.renderAsFactLines(40);
      expect(rendered).toContain('must-keep');
      expect(rendered).not.toContain('can-drop');
    });

    it('produces output parseable by parseFactLines', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'name', 'Alice'));
      store.add(mkFact('user', 'age', '30'));

      const rendered = store.renderAsFactLines();
      const parsed = parseFactLines(rendered, 'roundtrip', 9999);
      expect(parsed.facts).toHaveLength(2);
      expect(parsed.narrative).toBe('');
    });
  });
});

describe('createDefaultExtractFacts', () => {
  it('calls summarizeText with extraction prompt and parses FACT: lines', async () => {
    const summarizeText = vi.fn(async () =>
      'FACT: user | name | Alice\nFACT: user | city | NYC',
    );
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'Alice lives in NYC', existingFacts: [] });

    expect(summarizeText).toHaveBeenCalledOnce();
    const call = summarizeText.mock.calls[0]![0];
    expect(call.systemPrompt).toContain('FACT:');
    expect(call.systemPrompt).toContain('subject | predicate | value');
    expect(call.userPayload).toBe('Alice lives in NYC');
    expect(facts).toHaveLength(2);
    expect(facts[0]!.subject).toBe('user');
    expect(facts[0]!.value).toBe('Alice');
    expect(facts[1]!.value).toBe('NYC');
  });

  it('handles SummarizeTextResult objects (not just strings)', async () => {
    const summarizeText = vi.fn(async () => ({
      text: 'FACT: user | tool | TypeScript',
    }));
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'I use TypeScript', existingFacts: [] });

    expect(facts).toHaveLength(1);
    expect(facts[0]!.value).toBe('TypeScript');
  });

  it('returns empty array when summarizeText throws', async () => {
    const summarizeText = vi.fn(async () => {
      throw new Error('HTTP 500');
    });
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'test', existingFacts: [] });

    expect(facts).toHaveLength(0);
  });

  it('returns empty array when LLM produces no FACT: lines', async () => {
    const summarizeText = vi.fn(async () => 'No structured facts found.');
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'hello', existingFacts: [] });

    expect(facts).toHaveLength(0);
  });
});
