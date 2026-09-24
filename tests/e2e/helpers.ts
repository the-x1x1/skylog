import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = path.join(import.meta.dirname, '../../fixtures/exports');

export async function loadSampleJournal(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample journal' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(3);
}

export async function openEntry(page: Page, title: string | RegExp) {
  await page.getByRole('link', { name: title }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
}

export async function importFixture(page: Page, file: string) {
  await page.goto('/#/import');
  await page.locator('#export-file').setInputFiles(path.join(FIXTURES, file));
}
