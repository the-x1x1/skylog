import { expect, test } from '@playwright/test';
import { loadSampleJournal, openEntry } from './helpers';

test.beforeEach(async ({ page }) => {
  await loadSampleJournal(page);
});

test('images come before the summary', async ({ page }) => {
  await openEntry(page, 'Tabletop hologram display');
  const gallery = await page.locator('.gallery').boundingBox();
  const summary = await page.locator('.summary-panel').boundingBox();
  expect(gallery && summary && gallery.y < summary.y).toBeTruthy();
});

test('image selection by thumbnail and keyboard, with prompt and message link', async ({ page }) => {
  await openEntry(page, 'Tabletop hologram display');
  await expect(page.locator('.gallery__sub')).toContainText('Image 1 of 3');
  await expect(page.locator('.prompt-block__label')).toHaveText('Generation prompt');
  await page.getByRole('button', { name: /Show image 3/ }).click();
  await expect(page.locator('.gallery__title')).toHaveText('Walnut hologram box at night');
  await expect(page.locator('.prompt-block__label')).toHaveText('Prompt sent to the image tool');
  await expect(page).toHaveURL(/image=/);
  await page.getByRole('button', { name: /Show image 3/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.gallery__sub')).toContainText('Image 2 of 3');
  await expect(page.locator('.gallery__title')).toHaveText('desk-photo.jpg');
  await expect(page.locator('.prompt-block')).toHaveCount(0);
});

test('lightbox opens full size, navigates with arrows, closes with Escape', async ({ page }) => {
  await openEntry(page, 'Tabletop hologram display');
  await page.getByRole('button', { name: 'View full size' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.lightbox__count')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.lightbox__count')).toHaveText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.gallery__sub')).toContainText('Image 2 of 3');
});

test('jump to message from an image opens the transcript at that message', async ({ page }) => {
  await openEntry(page, 'Tabletop hologram display');
  await page.getByRole('button', { name: 'Jump to message 7' }).click();
  const msg = page.locator('#msg-7');
  await expect(msg).toBeFocused();
  await expect(msg).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Hide transcript' })).toBeVisible();
});

test('provenance chips jump to the supporting message', async ({ page }) => {
  await openEntry(page, 'Raised beds for the side yard');
  await page.locator('#section-lists, .extracted').first().getByRole('button', { name: /Go to message 8/ }).first().click();
  await expect(page.locator('#msg-8')).toBeFocused();
  await expect(page.locator('#msg-8')).toContainText('Perlite: 65 L');
});

test('missing images show an honest placeholder and the entry opens on an available image', async ({ page }) => {
  await openEntry(page, 'Raised beds for the side yard');
  await expect(page.locator('.gallery__title')).toHaveText('Side-yard bed layout');
  await page.getByRole('button', { name: /Show image 1.*not in export/ }).click();
  await expect(page.locator('.gallery__slide').first().getByText('Image not in export')).toBeVisible();
  await expect(page.locator('.gallery__slide').first()).toContainText("don't include the image file");
});

test('transcript preserves order and speakers and is searchable within the entry', async ({ page }) => {
  await openEntry(page, 'Raised beds for the side yard');
  await page.getByRole('button', { name: 'Show full transcript' }).click();
  const items = page.locator('.transcript__list > li');
  await expect(items).toHaveCount(10);
  await expect(items.nth(0).locator('.msg__who')).toHaveText('You');
  await expect(items.nth(1).locator('.msg__who')).toHaveText('Claude');
  await page.getByLabel('Find in this conversation').fill('trellis');
  await expect(page.locator('.transcript__find-count')).toHaveText(/1 of \d+/);
  await expect(page.locator('.transcript__list mark').first()).toHaveText(/trellis/i);
  await page.keyboard.press('Enter');
  await expect(page.locator('.transcript__find-count')).toHaveText(/2 of \d+/);
});

test('deep link to an image selects it', async ({ page }) => {
  await openEntry(page, 'Tabletop hologram display');
  await page.getByRole('button', { name: /Show image 3/ }).click();
  const url = page.url();
  await page.goto('/#/');
  await page.goto(url);
  await expect(page.locator('.gallery__title')).toHaveText('Walnut hologram box at night');
});
