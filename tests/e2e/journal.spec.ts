import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { loadSampleJournal, openEntry } from './helpers';

test('first launch shows a calm empty state with one clear action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Start your journal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import conversations' })).toBeVisible();
  await expect(page.getByText('ChatGPT export')).toBeVisible();
  await expect(page.getByText('Claude export')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use sample journal' })).toBeVisible();
});

test('sample journal is labelled as sample and grouped by month', async ({ page }) => {
  await loadSampleJournal(page);
  await expect(page.getByText('You’re looking at sample entries')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /September 2026/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /August 2026/ })).toBeVisible();
  await expect(page.locator('.entry-card__sample')).toHaveCount(3);
});

test('source, tag and collection filters and sorting', async ({ page }) => {
  await loadSampleJournal(page);
  await page.locator('.sidebar').getByRole('link', { name: /^Claude/ }).click();
  await expect(page.locator('.entry-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove filter Claude' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove filter Claude' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(3);
  await page.locator('.sidebar').getByRole('link', { name: '#hologram' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Clear all' }).click();
  await page.locator('.sidebar').getByRole('link', { name: /Workshop projects/ }).click();
  await expect(page.locator('.entry-card')).toHaveCount(1);
  await page.goto('/#/?sort=oldest');
  await expect(page.locator('.entry-card__title').first()).toHaveText(/Sourdough/);
});

test('journal navigation: card → entry → breadcrumb back', async ({ page }) => {
  await loadSampleJournal(page);
  await openEntry(page, 'Raised beds for the side yard');
  await expect(page).toHaveURL(/#\/entry\//);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Journal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeVisible();
});

test('entry with no summary says so honestly and points to settings', async ({ page }) => {
  await loadSampleJournal(page);
  await openEntry(page, 'Sourdough starter smells like acetone');
  await expect(page.getByText('Summary not generated.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Configure summarization' })).toBeVisible();
  await expect(page.locator('.gallery')).toHaveCount(0);
});

test('theme choice persists across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Light theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('edits persist after reload and can be reverted', async ({ page }) => {
  await loadSampleJournal(page);
  await openEntry(page, 'Raised beds for the side yard');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit entry' });
  await dialog.getByLabel('Title', { exact: true }).fill('Cedar beds, finally');
  await dialog.getByLabel('Tags').fill('garden, cedar');
  await dialog.getByRole('button', { name: 'Add a next step' }).click();
  await dialog.getByRole('textbox', { name: 'Next step 3' }).fill('Order cedar boards');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cedar beds, finally');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cedar beds, finally');
  await expect(page.locator('.entry__tags').getByRole('link', { name: '#cedar' })).toBeVisible();
  await expect(page.getByText('Order cedar boards')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Revert to generated' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Raised beds for the side yard');
});

test('exports an entry as Markdown and JSON', async ({ page }) => {
  await loadSampleJournal(page);
  await openEntry(page, 'Tabletop hologram display');
  await page.getByRole('button', { name: 'Export' }).click();
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Markdown/ }).click()]);
  expect(md.suggestedFilename()).toBe('tabletop-hologram-display.md');
  const text = fs.readFileSync((await md.path())!, 'utf8');
  expect(text).toContain('# Tabletop hologram display');
  expect(text).toContain('## Transcript');
  await page.getByRole('button', { name: 'Export' }).click();
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /JSON/ }).click()]);
  const data = JSON.parse(fs.readFileSync((await json.path())!, 'utf8'));
  expect(data.source.messages).toHaveLength(17);
});

test('delete all local data returns to the empty state', async ({ page }) => {
  await loadSampleJournal(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Delete all local data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click();
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Start your journal' })).toBeVisible();
});

test('summaries off by default; local server shows an honest not-ready status', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('radio', { name: /Off/ })).toBeChecked();
  await page.getByRole('radio', { name: /Local server/ }).check();
  await expect(page.getByText('Not ready')).toBeVisible();
  await expect(page.getByText(/No API key configured/)).toBeVisible();
});
