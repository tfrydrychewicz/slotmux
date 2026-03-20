/**
 * Playwright config for @slotmux/debug inspector UI.
 *
 * @packageDocumentation
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const packageRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node e2e/fixtures/inspector-dev-server.mjs',
    cwd: packageRoot,
    url: 'http://127.0.0.1:4173/inspector/',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
