import { describe, expect, it, vi } from 'vitest';

import { createDefaultExtractFacts, decayedConfidence, FactStore, parseFactLines } from '../../src/fact-extraction.js';
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

  it('parses optional 4th confidence field', () => {
    const text = 'FACT: user | name | Alice | 0.95';
    const result = parseFactLines(text, 'src-8', 8000);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.confidence).toBe(0.95);
  });

  it('defaults confidence to 0.9 when 4th field is absent', () => {
    const text = 'FACT: user | name | Alice';
    const result = parseFactLines(text, 'src-9', 9000);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.confidence).toBe(0.9);
  });

  it('clamps confidence to [0.1, 1.0]', () => {
    const lines = [
      'FACT: user | a | too-low | 0.0',
      'FACT: user | b | too-high | 1.5',
      'FACT: user | c | just-above-min | 0.05',
    ].join('\n');
    const result = parseFactLines(lines, 'src-10', 10000);

    expect(result.facts[0]!.confidence).toBe(0.1);
    expect(result.facts[1]!.confidence).toBe(1.0);
    expect(result.facts[2]!.confidence).toBe(0.1);
  });

  it('falls back to 0.9 when 4th field is not a number', () => {
    const text = 'FACT: user | name | Alice | high';
    const result = parseFactLines(text, 'src-11', 11000);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.confidence).toBe(0.9);
  });

  it('distinguishes confidence field from pipe-containing values', () => {
    const text = 'FACT: user | query | how to use | in bash';
    const result = parseFactLines(text, 'src-12', 12000);

    expect(result.facts[0]!.value).toBe('how to use | in bash');
    expect(result.facts[0]!.confidence).toBe(0.9);
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

  describe('byConfidenceDesc with decay', () => {
    it('reorders facts by decayed confidence when halfLifeMs is provided', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'old-high', 'ancient', 0.9, 1000));
      store.add(mkFact('user', 'new-low', 'recent', 0.5, 100_000));

      const withoutDecay = store.byConfidenceDesc();
      expect(withoutDecay[0]!.value).toBe('ancient');

      const withDecay = store.byConfidenceDesc(10_000);
      expect(withDecay[0]!.value).toBe('recent');
    });

    it('does not apply decay when halfLifeMs is undefined', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'a', 'high', 0.9, 1000));
      store.add(mkFact('user', 'b', 'low', 0.3, 50_000));

      const sorted = store.byConfidenceDesc();
      expect(sorted[0]!.value).toBe('high');
    });
  });

  describe('render with decay', () => {
    it('prioritizes recent facts when decay is enabled', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'old', 'stale', 0.9, 1000));
      store.add(mkFact('user', 'new', 'fresh', 0.6, 100_000));

      const rendered = store.render(Infinity, 10_000);
      const freshIdx = rendered.indexOf('fresh');
      const staleIdx = rendered.indexOf('stale');
      expect(freshIdx).toBeLessThan(staleIdx);
    });
  });

  describe('renderAsFactLines with decay', () => {
    it('drops old decayed facts first under budget', () => {
      const store = new FactStore();
      store.add(mkFact('user', 'critical', 'must-keep', 0.8, 100_000));
      store.add(mkFact('user', 'old', 'can-drop', 0.9, 1000));

      const rendered = store.renderAsFactLines(50, 10_000);
      expect(rendered).toContain('must-keep');
      expect(rendered).not.toContain('can-drop');
    });
  });
});

describe('decayedConfidence', () => {
  const mkEntry = (confidence: number, createdAt: number): FactEntry => ({
    subject: 'user',
    predicate: 'test',
    value: 'v',
    sourceItemId: 'test',
    confidence,
    createdAt,
  });

  it('returns raw confidence when age is 0', () => {
    const fact = mkEntry(0.9, 5000);
    expect(decayedConfidence(fact, 5000)).toBe(0.9);
  });

  it('halves confidence after one half-life', () => {
    const fact = mkEntry(1.0, 0);
    const result = decayedConfidence(fact, 1_800_000, 1_800_000);
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('quarters confidence after two half-lives', () => {
    const fact = mkEntry(1.0, 0);
    const result = decayedConfidence(fact, 3_600_000, 1_800_000);
    expect(result).toBeCloseTo(0.25, 5);
  });

  it('returns raw confidence when halfLifeMs is 0', () => {
    const fact = mkEntry(0.8, 0);
    expect(decayedConfidence(fact, 10_000, 0)).toBe(0.8);
  });

  it('handles negative age gracefully (returns raw confidence)', () => {
    const fact = mkEntry(0.7, 10_000);
    expect(decayedConfidence(fact, 5_000)).toBe(0.7);
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
    expect(call.systemPrompt).toContain('Extract');
    expect(call.responseSchema).toBeDefined();
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

  it('parses JSON response when provider supports structured output (§8.4.1a)', async () => {
    const jsonResponse = JSON.stringify({
      facts: [
        { subject: 'user', predicate: 'name', value: 'Alice', confidence: 0.95 },
        { subject: 'user', predicate: 'city', value: 'NYC', confidence: 0.8 },
      ],
    });
    const summarizeText = vi.fn(async () => jsonResponse);
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'Alice lives in NYC', existingFacts: [] });

    expect(summarizeText).toHaveBeenCalledOnce();
    const call = summarizeText.mock.calls[0]![0];
    expect(call.responseSchema).toBeDefined();
    expect(facts).toHaveLength(2);
    expect(facts[0]!.subject).toBe('user');
    expect(facts[0]!.value).toBe('Alice');
    expect(facts[0]!.confidence).toBe(0.95);
    expect(facts[1]!.value).toBe('NYC');
  });

  it('falls back to FACT: text parsing when JSON parsing fails (§8.4.1a)', async () => {
    const summarizeText = vi.fn(async () =>
      'FACT: user | name | Alice | 0.9\nFACT: user | city | NYC | 0.85',
    );
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'Alice lives in NYC', existingFacts: [] });

    expect(facts).toHaveLength(2);
    expect(facts[0]!.subject).toBe('user');
    expect(facts[0]!.value).toBe('Alice');
  });

  it('falls back to text parsing on malformed JSON', async () => {
    const summarizeText = vi.fn(async () => '{ broken json');
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'test', existingFacts: [] });

    expect(facts).toHaveLength(0);
  });

  it('clamps confidence to valid range in JSON response', async () => {
    const jsonResponse = JSON.stringify({
      facts: [
        { subject: 'user', predicate: 'name', value: 'Bob', confidence: 1.5 },
        { subject: 'user', predicate: 'age', value: '30', confidence: -0.5 },
      ],
    });
    const summarizeText = vi.fn(async () => jsonResponse);
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'Bob is 30', existingFacts: [] });

    expect(facts).toHaveLength(2);
    expect(facts[0]!.confidence).toBe(1.0);
    expect(facts[1]!.confidence).toBe(0.1);
  });

  it('filters out entries with missing required fields in JSON response', async () => {
    const jsonResponse = JSON.stringify({
      facts: [
        { subject: 'user', predicate: 'name', value: 'Alice', confidence: 0.9 },
        { subject: 'user', predicate: 'city' },
        { subject: 'user' },
      ],
    });
    const summarizeText = vi.fn(async () => jsonResponse);
    const extractFacts = createDefaultExtractFacts(summarizeText);

    const facts = await extractFacts({ text: 'test', existingFacts: [] });

    expect(facts).toHaveLength(1);
    expect(facts[0]!.value).toBe('Alice');
  });

  it('passes responseSchema to summarizeText for structured output', async () => {
    const summarizeText = vi.fn(async () => JSON.stringify({ facts: [] }));
    const extractFacts = createDefaultExtractFacts(summarizeText);

    await extractFacts({ text: 'test', existingFacts: [] });

    const call = summarizeText.mock.calls[0]![0];
    expect(call.responseSchema).toEqual(expect.objectContaining({
      type: 'object',
      properties: expect.objectContaining({
        facts: expect.any(Object),
      }),
    }));
  });
});
