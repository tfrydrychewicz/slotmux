import { describe, expect, it } from 'vitest';

import { computeItemImportance } from '../../src/importance-scorer.js';
import type { ProgressiveItem } from '../../src/progressive-types.js';

function item(content: string): ProgressiveItem {
  return { id: 'test', role: 'user', content, createdAt: 1000 };
}

describe('computeItemImportance — language-agnostic structural signals (§8.4.4)', () => {
  it('returns 0 for empty content', () => {
    expect(computeItemImportance(item(''))).toBe(0);
  });

  it('scores near-zero for trivial short messages', () => {
    const ok = computeItemImportance(item('ok'));
    const hi = computeItemImportance(item('hi'));
    expect(ok).toBeLessThan(0.5);
    expect(hi).toBeLessThan(0.5);
  });

  /* ---------- specific facts ---------- */

  it('scores higher when content contains numbers', () => {
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

  it('scores higher when content contains numeric dates', () => {
    const generic = computeItemImportance(item('We met recently.'));
    const withDate = computeItemImportance(
      item('We met on 01/15/2026 to discuss the project.'),
    );
    expect(withDate).toBeGreaterThan(generic);
  });

  /* ---------- entity density ---------- */

  it('scores higher for content with capitalized entity names', () => {
    const generic = computeItemImportance(item('the app is good'));
    const entities = computeItemImportance(
      item('Sony FE lens and Apple Watch and Google Maps are great products'),
    );
    expect(entities).toBeGreaterThan(generic);
  });

  /* ---------- code blocks ---------- */

  it('scores higher when content contains fenced code blocks', () => {
    const plain = computeItemImportance(item('Here is the config.'));
    const code = computeItemImportance(
      item('Here is the config:\n```json\n{"port": 3000}\n```'),
    );
    expect(code).toBeGreaterThan(plain);
  });

  it('scores higher when content contains inline code', () => {
    const plain = computeItemImportance(item('Run the install command.'));
    const code = computeItemImportance(
      item('Run `npm install --save-dev vitest` to add the dependency.'),
    );
    expect(code).toBeGreaterThan(plain);
  });

  /* ---------- URLs ---------- */

  it('scores higher when content contains URLs', () => {
    const plain = computeItemImportance(item('Check the documentation page.'));
    const withUrl = computeItemImportance(
      item('Check the documentation at https://docs.example.com/api/v2'),
    );
    expect(withUrl).toBeGreaterThan(plain);
  });

  /* ---------- structured lists ---------- */

  it('scores higher when content contains bullet lists', () => {
    const plain = computeItemImportance(item('We need three things.'));
    const list = computeItemImportance(
      item('We need:\n- PostgreSQL database\n- Redis cache\n- Nginx reverse proxy'),
    );
    expect(list).toBeGreaterThan(plain);
  });

  it('scores higher when content contains numbered lists', () => {
    const plain = computeItemImportance(item('Follow the steps.'));
    const list = computeItemImportance(
      item('Follow the steps:\n1. Clone the repo\n2. Run install\n3. Start the server'),
    );
    expect(list).toBeGreaterThan(plain);
  });

  /* ---------- key-value pairs ---------- */

  it('scores higher when content contains key-value pairs', () => {
    const plain = computeItemImportance(item('The system has settings.'));
    const kv = computeItemImportance(
      item('host: localhost\nport: 5432\ndb: myapp\nssl: true'),
    );
    expect(kv).toBeGreaterThan(plain);
  });

  /* ---------- length bonus ---------- */

  it('scores higher for substantive longer messages', () => {
    const short = computeItemImportance(item('ok fine'));
    const long = computeItemImportance(
      item(
        'The application architecture uses a three-tier design with a React frontend, ' +
        'a Node.js API layer handling authentication and business logic, and a PostgreSQL ' +
        'database for persistent storage. We also use Redis for session caching and rate ' +
        'limiting. The deployment pipeline runs through GitHub Actions with staging and ' +
        'production environments on AWS ECS.',
      ),
    );
    expect(long).toBeGreaterThan(short);
  });

  /* ---------- lexical diversity ---------- */

  it('scores higher for lexically diverse content', () => {
    const repetitive = computeItemImportance(
      item('good good good good good good good good good good'),
    );
    const diverse = computeItemImportance(
      item('database migration schema index constraint foreign key trigger view'),
    );
    expect(diverse).toBeGreaterThan(repetitive);
  });

  /* ---------- signal accumulation ---------- */

  it('accumulates scores from multiple structural signals', () => {
    const singleSignal = computeItemImportance(item('port 8080'));
    const multiSignal = computeItemImportance(
      item(
        'Deploy to https://staging.example.com with config:\n' +
        '- host: "staging-db.internal"\n' +
        '- port: 5432\n' +
        '```bash\ndocker compose up -d\n```',
      ),
    );
    expect(multiSignal).toBeGreaterThan(singleSignal);
  });

  /* ---------- language agnosticism ---------- */

  it('scores a non-English message with structural signals above zero', () => {
    const polish = computeItemImportance(
      item('Konfiguracja serwera: host=localhost, port=5432. Szczegoly: https://docs.pl/setup'),
    );
    expect(polish).toBeGreaterThan(1);
  });

  it('scores a non-English message with code blocks above plain text', () => {
    const plainGerman = computeItemImportance(item('Das funktioniert wirklich gut so.'));
    const germanWithCode = computeItemImportance(
      item('Verwende diese Konfiguration:\n```yaml\nport: 3000\nenv: production\n```'),
    );
    expect(germanWithCode).toBeGreaterThan(plainGerman);
  });

  it('does not rely on English keywords for scoring', () => {
    const japaneseWithFacts = computeItemImportance(
      item('port: 8080, host: "tokyo-server"\nhttps://api.example.jp/v2'),
    );
    expect(japaneseWithFacts).toBeGreaterThan(2);
  });
});
