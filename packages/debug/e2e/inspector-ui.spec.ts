/**
 * E2E: Preact inspector UI.
 *
 * @packageDocumentation
 */

import { expect, test } from '@playwright/test';

test.describe('Inspector UI', () => {
  test('loads shell and shows live data after build', async ({ page }) => {
    await page.goto('/inspector/');
    await expect(page.locator('h1.inspector__title')).toContainText('Slotmux Inspector');
    await expect(page.getByText('Build complete', { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Slot utilization' })).toBeVisible();
    const utilizationPanel = page
      .locator('.panel')
      .filter({ has: page.getByRole('heading', { name: 'Slot utilization' }) });
    await expect(utilizationPanel.getByText('system', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
