import { describe, expect, it } from 'vitest';

import { computeItemImportance } from '../../src/importance-scorer.js';
import type { ProgressiveItem } from '../../src/progressive-types.js';

function item(content: string): ProgressiveItem {
  return { id: 'test', role: 'user', content, createdAt: 1000 };
}

describe('computeItemImportance (§8.4.4)', () => {
  it('returns 0 for empty content', () => {
    expect(computeItemImportance(item(''))).toBe(0);
  });

  it('scores higher when content contains decision language', () => {
    const generic = computeItemImportance(item('We talked about the weather today.'));
    const decision = computeItemImportance(
      item('I decided to use PostgreSQL for the database.'),
    );
    expect(decision).toBeGreaterThan(generic);
  });

  it('scores higher when content contains preference language', () => {
    const generic = computeItemImportance(item('The meeting was long.'));
    const preference = computeItemImportance(
      item('I prefer dark mode over light mode.'),
    );
    expect(preference).toBeGreaterThan(generic);
  });

  it('scores higher when content contains specific facts (numbers)', () => {
    const generic = computeItemImportance(item('We had a conversation.'));
    const withNumber = computeItemImportance(
      item('The server runs on port 8080 with 32 workers.'),
    );
    expect(withNumber).toBeGreaterThan(generic);
  });

  it('scores higher when content contains quoted strings', () => {
    const generic = computeItemImportance(item('The user created a playlist.'));
    const withQuote = computeItemImportance(
      item('The user created a playlist called "Summer Vibes" on Spotify.'),
    );
    expect(withQuote).toBeGreaterThan(generic);
  });

  it('scores higher when content contains dates', () => {
    const generic = computeItemImportance(item('We met recently.'));
    const withDate = computeItemImportance(
      item('We met on Jan 15 to discuss the project.'),
    );
    expect(withDate).toBeGreaterThan(generic);
  });

  it('scores higher for content with capitalized entity names', () => {
    const generic = computeItemImportance(item('the app is good'));
    const entities = computeItemImportance(
      item('Sony FE lens and Apple Watch and Google Maps are great products'),
    );
    expect(entities).toBeGreaterThan(generic);
  });

  it('accumulates scores from multiple signals', () => {
    const singleSignal = computeItemImportance(
      item('I prefer apples.'),
    );
    const multiSignal = computeItemImportance(
      item('I decided to buy "MacBook Pro" for 2499 on Jan 15 because I prefer Apple Silicon.'),
    );
    expect(multiSignal).toBeGreaterThan(singleSignal);
  });
});
