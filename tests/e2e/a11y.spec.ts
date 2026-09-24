import { expect, test, type Page } from '@playwright/test';
import { loadSampleJournal } from './helpers';

/** Structural accessibility checks that don't need an external engine. */
async function audit(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const visible = (el: Element) => {
      // checkVisibility also covers content that isn't rendered (e.g. inside a closed <details>).
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
    };
    const name = (el: Element) =>
      (el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ') ||
        (el as HTMLElement).innerText ||
        el.getAttribute('title') ||
        '').trim();

    for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"]'))) {
      if (visible(el) && !name(el)) problems.push(`unnamed control: ${el.outerHTML.slice(0, 120)}`);
    }
    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (!img.hasAttribute('alt')) problems.push(`img without alt: ${img.outerHTML.slice(0, 120)}`);
    }
    for (const input of Array.from(document.querySelectorAll('input, select, textarea'))) {
      const el = input as HTMLInputElement;
      if (el.type === 'hidden' || !visible(el)) continue;
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
      if (!labelled) problems.push(`unlabelled field: ${el.outerHTML.slice(0, 120)}`);
    }
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) problems.push(`duplicate ids: ${Array.from(new Set(dupes)).join(', ')}`);
    const h1s = Array.from(document.querySelectorAll('h1')).filter(visible);
    if (h1s.length !== 1) problems.push(`expected one visible h1, found ${h1s.length}`);
    if (!document.querySelector('main')) problems.push('no <main> landmark');
    if (document.documentElement.lang !== 'en') problems.push('html lang missing');
    return problems;
  });
}

const PAGES = ['/#/', '/#/search?q=walnut', '/#/import', '/#/imports', '/#/settings'];

test('core screens pass structural accessibility checks (light and dark)', async ({ page }) => {
  await loadSampleJournal(page);
  const entryHref = await page.locator('.entry-card__link').first().getAttribute('href');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: theme === 'dark' ? 'Dark theme' : 'Light theme' }).click();
    for (const url of [...PAGES, `/${entryHref}`]) {
      await page.goto(url);
      await page.waitForTimeout(300);
      expect(await audit(page), `${url} (${theme})`).toEqual([]);
    }
  }
});

test('entry page with transcript, dialogs and lightbox open passes checks', async ({ page }) => {
  await loadSampleJournal(page);
  await page.locator('.entry-card__link', { hasText: 'hologram' }).click();
  await page.getByRole('button', { name: 'Show full transcript' }).click();
  expect(await audit(page)).toEqual([]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View full size' }).click();
  expect(await audit(page)).toEqual([]);
});

test('keyboard focus is visible on interactive elements', async ({ page }) => {
  await loadSampleJournal(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
  expect(outline).toMatch(/solid 2px/);
});

test('reduced motion is respected', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await loadSampleJournal(page);
  const duration = await page.locator('.entry-card').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await ctx.close();
});
