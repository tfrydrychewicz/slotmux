import { describe, expect, it } from 'vitest';

import {
  LOSSLESS_LANGUAGE_PACK_EN,
  LOSSLESS_LANGUAGE_PACK_MINIMAL,
  LosslessCompressor,
  createLosslessCompressionStrategy,
  getPlainTextForLossless,
  losslessCompressAsOverflow,
  registerLosslessLanguagePack,
  unregisterLosslessLanguagePack,
  createContentItem,
  toTokenCount,
} from '../../src/index.js';

describe('LosslessCompressor (Phase 8.2)', () => {
  it('compressText removes filler, abbreviates, and collapses whitespace', () => {
    const c = new LosslessCompressor();
    const out = c.compressText(
      'Well,   you know, for example   this is   dense.\n\n\nThat is clear.',
    );
    expect(out).toBe('e.g. this is dense.\n\ni.e. clear.');
  });

  it('compressText drops standalone pleasantry lines', () => {
    const c = new LosslessCompressor();
    const out = c.compressText('Hello world.\nThanks!\nMore text.');
    expect(out).toBe('Hello world.\nMore text.');
  });

  it('achieves ≥10% character reduction on filler-heavy synthetic text (§8.2 target band)', () => {
    const c = new LosslessCompressor();
    const verbose = Array.from({ length: 30 }, () =>
      'Well, you know, so basically for example that is all.   ',
    ).join('\n');
    const out = c.compressText(verbose);
    const ratio = out.length / verbose.length;
    expect(ratio).toBeLessThan(0.9); // ≥10% reduction vs raw length
    expect(ratio).toBeGreaterThan(0);
  });

  it('compressItems maps multimodal text blocks', () => {
    const c = new LosslessCompressor({ dedupe: false });
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: [
        { type: 'text', text: 'For example,   well,   ok.' },
        { type: 'image_url', imageUrl: 'https://x.test/a.png' },
      ],
      tokens: toTokenCount(10),
    });
    const [next] = c.compressItems([item]);
    expect(next!.content).toEqual([
      { type: 'text', text: 'e.g., ok.' },
      { type: 'image_url', imageUrl: 'https://x.test/a.png' },
    ]);
  });

  it('stripAdjacentPleasantries removes trailing thanks and leading welcome (string messages)', () => {
    const c = new LosslessCompressor({ dedupe: false });
    const u = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Here is the answer.\nThanks!',
      tokens: toTokenCount(5),
    });
    const a = createContentItem({
      slot: 's',
      role: 'assistant',
      content: "You're welcome!\nGlad to help.",
      tokens: toTokenCount(5),
    });
    const [u2, a2] = c.compressItems([u, a]);
    expect(typeof u2!.content).toBe('string');
    expect(typeof a2!.content).toBe('string');
    expect(u2!.content).toBe('Here is the answer.');
    expect(a2!.content).toBe('Glad to help.');
  });

  it('dedupe drops consecutive same-role near-duplicates', () => {
    const c = new LosslessCompressor({
      dedupeSimilarityThreshold: 0.92,
      stripAdjacentPleasantries: false,
    });
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'The quick brown fox jumps over the lazy dog.',
      tokens: toTokenCount(1),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'The quick brown fox jumps over the lazy dog!', // tiny change
      tokens: toTokenCount(1),
    });
    const cItem = createContentItem({
      slot: 's',
      role: 'assistant',
      content: 'Reply.',
      tokens: toTokenCount(1),
    });
    const out = c.compressItems([a, b, cItem]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe(a.id);
    expect(out[1]!.id).toBe(cItem.id);
  });

  it('getPlainTextForLossless joins multimodal text blocks', () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: [
        { type: 'text', text: 'a' },
        { type: 'image_url', imageUrl: 'https://x.test/b.png' },
        { type: 'text', text: 'b' },
      ],
      tokens: toTokenCount(1),
    });
    expect(getPlainTextForLossless(item)).toBe('a b');
  });

  it('losslessCompressAsOverflow matches compressor output', async () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Well, for example x',
      tokens: toTokenCount(1),
    });
    const fromClass = new LosslessCompressor().compressItems([item]);
    const fromOverflow = await losslessCompressAsOverflow(
      [item],
      toTokenCount(100),
      { slot: 's' },
    );
    expect(fromOverflow[0]!.content).toEqual(fromClass[0]!.content);
  });

  it('locale "de" applies German filler and abbreviations', () => {
    const c = new LosslessCompressor({ locale: 'de', dedupe: false });
    const out = c.compressText('Naja, zum Beispiel ist das klar.');
    expect(out).toBe('z. B. ist das klar.');
  });

  it('Unicode dedupe treats CJK lines differing only by punctuation as near-identical', () => {
    const c = new LosslessCompressor({
      locale: 'en',
      dedupeSimilarityThreshold: 0.92,
      stripAdjacentPleasantries: false,
    });
    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'こんにちは世界。',
      tokens: toTokenCount(1),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'こんにちは世界!',
      tokens: toTokenCount(1),
    });
    const out = c.compressItems([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(a.id);
  });

  it('registerLosslessLanguagePack + languagePack override', () => {
    const tag = 'lossless-test-xx';
    registerLosslessLanguagePack(tag, {
      ...LOSSLESS_LANGUAGE_PACK_EN,
      fillerPatterns: [/\bCUSTOMFILLER\s+/giu],
    });
    try {
      const c = new LosslessCompressor({ locale: tag, dedupe: false });
      expect(c.compressText('CUSTOMFILLER hello')).toBe('hello');
    } finally {
      unregisterLosslessLanguagePack(tag);
    }
  });

  it('applies different packs per ContentItem.losslessLocale', () => {
    const c = new LosslessCompressor({ dedupe: false });
    const en = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Well, done.',
      losslessLocale: 'en',
      tokens: toTokenCount(1),
    });
    const de = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Naja, fertig.',
      losslessLocale: 'de',
      tokens: toTokenCount(1),
    });
    const out = c.compressItems([en, de]);
    expect(out[0]!.content).toBe('done.');
    expect(out[1]!.content).toBe('fertig.');
  });

  it('languagePack ignores per-item losslessLocale', () => {
    const c = new LosslessCompressor({
      languagePack: LOSSLESS_LANGUAGE_PACK_EN,
      dedupe: false,
    });
    const deTagged = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Naja, ok.',
      losslessLocale: 'de',
      tokens: toTokenCount(1),
    });
    expect(c.compressItems([deTagged])[0]!.content).toBe('Naja, ok.');
  });

  it('uses detectLanguage when losslessLocale is omitted', () => {
    const c = new LosslessCompressor({
      detectLanguage: (t) => (t.includes('Naja') ? 'de' : 'en'),
      dedupe: false,
    });
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Naja, ok.',
      tokens: toTokenCount(1),
    });
    expect(c.compressItems([item])[0]!.content).toBe('ok.');
  });

  it('resolveTagForItem prefers losslessLocale over detectLanguage', () => {
    const c = new LosslessCompressor({
      locale: 'en',
      detectLanguage: () => 'de',
    });
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Naja, x',
      losslessLocale: 'de',
      tokens: toTokenCount(1),
    });
    expect(c.resolveTagForItem(item)).toBe('de');
  });

  it('adjacent pleasantry uses user and assistant packs separately', () => {
    const c = new LosslessCompressor({ dedupe: false });
    const u = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Done.\nThanks!',
      losslessLocale: 'en',
      tokens: toTokenCount(1),
    });
    const a = createContentItem({
      slot: 's',
      role: 'assistant',
      content: 'Bitte!\nGern.',
      losslessLocale: 'de',
      tokens: toTokenCount(1),
    });
    const [u2, a2] = c.compressItems([u, a]);
    expect(u2!.content).toBe('Done.');
    expect(a2!.content).toBe('Gern.');
  });

  it('locale minimal skips phrase stripping', () => {
    const c = new LosslessCompressor({ locale: 'minimal', dedupe: false });
    expect(c.compressText('Well, for example x')).toBe('Well, for example x');
  });

  it('LOSSLESS_LANGUAGE_PACK_MINIMAL has no filler rules', () => {
    const c = new LosslessCompressor({
      languagePack: LOSSLESS_LANGUAGE_PACK_MINIMAL,
      dedupe: false,
    });
    expect(c.compressText('Well, you know')).toBe('Well, you know');
  });

  it('createContentItem copies losslessLocale', () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'x',
      losslessLocale: 'de',
      tokens: toTokenCount(1),
    });
    expect(item.losslessLocale).toBe('de');
  });

  it('losslessCompressAsOverflow forwards losslessDetectLanguage', async () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Naja, kurz.',
      tokens: toTokenCount(1),
    });
    const out = await losslessCompressAsOverflow([item], toTokenCount(100), {
      slot: 's',
      slotConfig: {
        priority: 1,
        budget: { flex: true },
        overflowConfig: { losslessDetectLanguage: () => 'de' },
      },
    });
    expect(out[0]!.content).toBe('kurz.');
  });

  it('createLosslessCompressionStrategy uses name and compresses', async () => {
    const s = createLosslessCompressionStrategy({ name: 'my-lossless' });
    expect(s.name).toBe('my-lossless');
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'In other words yes',
      tokens: toTokenCount(1),
    });
    const out = await s.compress([item], toTokenCount(10), {
      slotName: 's',
      slotConfig: { priority: 1, budget: { flex: true } },
      config: {},
      tokenCounter: { count: () => toTokenCount(0) },
      logger: {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      anchorText: undefined,
    });
    expect(out[0]!.content).toBe('i.e. yes');
  });
});
