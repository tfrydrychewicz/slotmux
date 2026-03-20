#!/usr/bin/env node
/**
 * Supply-chain check: ensure `slotmux` (packages/core) runtime `dependencies`
 * match the audited allowlist (§19.1). Update this script when intentionally adding a dep.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'packages', 'core', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

/** Exact package names allowed in `dependencies` (sorted). Tokenizers stay in peerDependencies. */
const ALLOWED_KEYS = ['@slotmux/compression', 'nanoid', 'zod'];

const deps = pkg.dependencies ?? {};
const keys = Object.keys(deps).sort();

if (keys.join(',') !== [...ALLOWED_KEYS].sort().join(',')) {
  console.error(
    '[verify-core-runtime-deps] packages/core `dependencies` must be exactly:',
    ALLOWED_KEYS.join(', '),
  );
  console.error('Found:', keys.length ? keys.join(', ') : '(empty)');
  process.exit(1);
}

if (deps['@slotmux/compression'] !== 'workspace:*') {
  console.error(
    '[verify-core-runtime-deps] @slotmux/compression must use workspace:* (monorepo link).',
  );
  process.exit(1);
}

for (const name of ['nanoid', 'zod']) {
  const v = deps[name];
  if (typeof v !== 'string' || v.length === 0) {
    console.error(`[verify-core-runtime-deps] ${name} must have a non-empty semver range.`);
    process.exit(1);
  }
}

console.log('[verify-core-runtime-deps] OK —', ALLOWED_KEYS.join(', '));
