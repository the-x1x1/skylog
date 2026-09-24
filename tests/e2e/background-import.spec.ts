import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildLargeExport } from '../../scripts/make-large-export';
import { createZip } from '../../src/utils/zip-writer';

test('an import keeps running while you browse, with visible progress', async ({ page }, info) => {
  test.setTimeout(90_000);
  const file = path.join(info.outputDir, 'medium-export.zip');
  fs.mkdirSync(info.outputDir, { recursive: true });
  fs.writeFileSync(file, await createZip(buildLargeExport(400)));

  await page.goto('/#/import');
  await page.locator('#export-file').setInputFiles(file);
  await page.getByRole('button', { name: 'Import 400 conversations' }).click();
  await expect(page.locator('.run-count')).toBeVisible();

  // Leave the import page mid-import.
  await page.locator('.sidebar-list--nav').getByRole('link', { name: /^Journal/ }).click();
  const status = page.locator('.import-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/Importing|Writing summaries/);
  await expect(page.locator('.entry-card').first()).toBeVisible();

  // Come back: the same import is still running (or finished), not restarted.
  await status.click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible({ timeout: 80_000 });
  await expect(page.locator('.stat', { hasText: 'Imported' }).first().locator('dd')).toHaveText('400');
  await expect(page.locator('.import-status')).toHaveCount(0);
});
