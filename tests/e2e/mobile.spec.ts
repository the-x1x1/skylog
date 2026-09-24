import { expect, test } from '@playwright/test';
import { loadSampleJournal, openEntry } from './helpers';

test('mobile uses a bottom nav instead of the sidebar', async ({ page }) => {
  await loadSampleJournal(page);
  await expect(page.locator('.sidebar')).toBeHidden();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Search' }).click();
  const input = page.locator('.search-mobile-field input');
  await expect(input).toBeVisible();
  await input.fill('perlite');
  await expect(page.locator('.result--message').first()).toBeVisible();
  await nav.getByRole('link', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import conversations' })).toBeVisible();
  await nav.getByRole('link', { name: 'Journal' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(3);
});

test('mobile entry: title and meta at the top, swipeable gallery with thumbnails, expandable transcript', async ({ page }) => {
  await loadSampleJournal(page);
  await openEntry(page, 'Tabletop hologram display');
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(title && title.y < 400).toBeTruthy();
  const track = page.locator('.gallery__track');
  await track.evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 }));
  await expect(page.locator('.gallery__sub')).toContainText('Image 3 of 3');
  await page.getByRole('button', { name: /Show image 1/ }).click();
  await expect(page.locator('.gallery__sub')).toContainText('Image 1 of 3');
  await page.getByRole('button', { name: 'Show full transcript' }).click();
  await expect(page.locator('.transcript__list > li')).toHaveCount(17);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('mobile theme toggle lives in the top bar', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('.mobile-top').getByRole('button', { name: /Switch to/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
});
