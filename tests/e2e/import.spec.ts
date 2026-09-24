import { expect, test } from '@playwright/test';
import path from 'node:path';
import { FIXTURES, importFixture } from './helpers';

test('imports a ChatGPT export end to end and skips it on re-import', async ({ page }) => {
  await importFixture(page, 'chatgpt-sample-export.zip');
  await expect(page.locator('.preview-head')).toContainText('ChatGPT');
  await expect(page.locator('.preview-head')).toContainText('detected automatically');
  await expect(page.locator('.stat', { hasText: 'Conversations' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.stat', { hasText: 'Image files in export' }).locator('dd')).toHaveText('3');
  await expect(page.getByLabel(/Generate summaries/)).toBeDisabled();
  await page.getByRole('button', { name: 'Import 2 conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.stat', { hasText: 'Imported' }).first().locator('dd')).toHaveText('2');
  await expect(page.locator('.stat', { hasText: 'Images stored' }).locator('dd')).toHaveText('3 of 3');
  await page.getByRole('button', { name: 'Open journal' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(2);
  await expect(page.locator('.entry-card__sample')).toHaveCount(0);

  await page.goto('/#/import');
  await page.locator('#export-file').setInputFiles(path.join(FIXTURES, 'chatgpt-sample-export.zip'));
  await page.getByRole('button', { name: 'Import 2 conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.stat', { hasText: 'Already imported' }).locator('dd')).toHaveText('2');
  await page.goto('/#/');
  await expect(page.locator('.entry-card')).toHaveCount(2);
});

test('imports a Claude export and shows the report with problems', async ({ page }) => {
  await importFixture(page, 'claude-edge-cases.zip');
  await expect(page.locator('.preview-head')).toContainText('Claude');
  await expect(page.getByText(/don't include uploaded image files/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Import finished with some problems' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'View import report' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('claude-edge-cases.zip');
  await expect(page.locator('.issue')).not.toHaveCount(0);
  await expect(page.getByText('Conversation has no chat_messages array.')).toBeVisible();
  await page.getByRole('button', { name: /Errors/ }).click();
  await expect(page.locator('.issue--warning')).toHaveCount(0);
  await page.locator('.report__entries').getByRole('link', { name: 'Kitchen shelves' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kitchen shelves');
  await expect(page.getByText('Summary not generated.')).toBeVisible();
});

test('a zip that is not an export asks which app it came from, then explains the problem', async ({ page }) => {
  await importFixture(page, 'not-an-export.zip');
  await expect(page.getByRole('heading', { name: 'Which app is this export from?' })).toBeVisible();
  await page.getByRole('button', { name: /ChatGPT/ }).click();
  await expect(page.getByText(/No conversations\.json found/)).toBeVisible();
});

test('a corrupt file shows a readable error', async ({ page }) => {
  await importFixture(page, 'corrupt.zip');
  await expect(page.getByText('That file couldn’t be imported')).toBeVisible();
  await expect(page.getByText(/not a valid \.zip archive/)).toBeVisible();
});

test('a truncated export stops with a clear explanation', async ({ page }) => {
  await importFixture(page, 'truncated-json.zip');
  await expect(page.getByRole('heading', { name: 'Which app is this export from?' }).or(page.getByText('That file couldn’t be imported'))).toBeVisible();
  const chooser = page.getByRole('heading', { name: 'Which app is this export from?' });
  if (await chooser.isVisible()) await page.getByRole('button', { name: /ChatGPT/ }).click();
  await expect(page.getByText(/not valid JSON/)).toBeVisible();
});

test('a nested-folder export is still detected', async ({ page }) => {
  await importFixture(page, 'chatgpt-nested-folder.zip');
  await expect(page.locator('.preview-head')).toContainText('detected automatically');
  await expect(page.locator('.stat', { hasText: 'Image files in export' }).locator('dd')).toHaveText('3');
});
