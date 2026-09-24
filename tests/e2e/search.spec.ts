import { expect, test } from '@playwright/test';
import { loadSampleJournal } from './helpers';

test.beforeEach(async ({ page }) => {
  await loadSampleJournal(page);
});

test('Ctrl/Cmd+K focuses global search and results are grouped', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.locator('.sidebar [data-global-search]');
  await expect(input).toBeFocused();
  await page.keyboard.type('walnut');
  await expect(page).toHaveURL(/#\/search\?q=walnut/);
  await expect(input).toHaveValue('walnut');
  await expect(page.getByRole('heading', { name: /^Entries/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Images/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Messages/ })).toBeVisible();
  await expect(page.locator('mark').first()).toHaveText(/walnut/i);
});

test('an image result opens the entry with that image selected', async ({ page }) => {
  await page.goto('/#/search?q=box%20at%20night');
  await page.locator('.result--image').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tabletop hologram display');
  await expect(page.locator('.gallery__title')).toHaveText('Walnut hologram box at night');
});

test('a message result opens the entry scrolled to that message', async ({ page }) => {
  await page.goto('/#/search?q=perlite');
  await page.locator('.result--message').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Raised beds for the side yard');
  const target = page.locator('.msg[data-message-id$="garden-m07"]');
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
});

test('keyboard: arrows move through results, Enter opens, Escape returns and clears', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('hologram');
  await expect(page.locator('[data-result-index]').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-result-index="0"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-result-index="1"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar [data-global-search]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar [data-global-search]')).toHaveValue('');
  await page.keyboard.type('sourdough');
  await expect(page.locator('[data-result-index]').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sourdough starter smells like acetone');
});

test('typos and filters', async ({ page }) => {
  await page.goto('/#/search?q=trelis');
  await expect(page.locator('.result--message').first()).toContainText(/trellis/i);
  await page.getByRole('button', { name: 'ChatGPT', exact: true }).click();
  await expect(page.getByText(/No results for/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.result--message').first()).toBeVisible();
});
