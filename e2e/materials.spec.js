import { test, expect } from '@playwright/test';
import { tapNav, visibleClick, assertNoOverflow, assertSaveAboveNav, attachErrorCollectors } from './helpers.js';

test.describe('Materials Check-In @390', () => {
  test('open tool, add a manual line, check in once, no overflow', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.locator('#home-root').waitFor();

    await tapNav(page, 'inspect');
    await expect(page.locator('#view-inspect:not([hidden])')).toContainText(/Materials Check-In/i);
    await visibleClick(page, '[data-nav="materials"]');
    await expect(page.locator('#view-materials:not([hidden])')).toBeVisible();
    await page.locator('#mat-desc').waitFor();
    await assertNoOverflow(page);
    await assertSaveAboveNav(page, '#mat-export');

    await page.fill('#mat-desc', '12" X52 pipe');
    await page.fill('#mat-qty', '10');
    await page.fill('#mat-unit', 'jt');
    await page.locator('#mat-add').click();
    await expect(page.locator('#mat-list')).toContainText('12" X52 pipe');
    await expect(page.locator('#mat-detail')).toBeVisible();

    await page.fill('#ci-qty', '4');
    await page.fill('#ci-loc', 'Sta 12+45');
    await page.locator('#ci-save').click();
    await expect(page.locator('#ci-save-status')).toContainText(/Check-in saved/i);
    await expect(page.locator('#mat-list')).toContainText(/recv 4/i);
    await expect(page.locator('#ci-hist')).toContainText(/Sta 12\+45/);
    await assertNoOverflow(page);

    const interesting = errors.pageErrors.filter((m) => !/ResizeObserver|AbortError/i.test(m));
    expect(interesting, interesting.join('\n')).toEqual([]);
  });
});
