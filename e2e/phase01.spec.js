import { test, expect } from '@playwright/test';
import {
  PROJECT,
  WORKER_OK,
  WORKER_EXP,
  isoOffset,
  tapNav,
  visibleClick,
  assertNoOverflow,
  assertSaveAboveNav,
  selectOptionIncluding,
  waitStatus,
  attachErrorCollectors,
} from './helpers.js';

const LEGACY = [
  'slope',
  'bellhole',
  'cover',
  'station',
  'photo',
  'daily',
  'scope',
  'pressure',
  'locate',
  'trench-card',
  'confined',
  'weather',
  'mitti',
  'emergency',
  'lookups',
];

test.describe.configure({ mode: 'serial' });

test.describe('Phase 0/1 field regressions @390', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;
  let errors;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    errors = attachErrorCollectors(page);
    await page.goto('/');
    await page.locator('#home-root').waitFor();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('app loads with banner, disclaimer, and no overflow', async () => {
    await expect(page.locator('#sync-banner')).toContainText(/ONLINE/i);
    await expect(page.locator('#view-home')).toContainText(/Field reference only/i);
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await assertNoOverflow(page);
  });

  test('bottom navigation reaches Home / Projects / Inspect / Reports / More', async () => {
    for (const tab of ['projects', 'inspect', 'reports', 'more', 'home']) {
      await tapNav(page, tab);
      await expect(page.locator(`[data-view="${tab}"]:not([hidden])`)).toBeVisible();
      await expect(page.locator(`.bottom-nav [data-nav="${tab}"]`)).toHaveClass(/is-active/);
      await assertNoOverflow(page);
    }
  });

  test('create project, set active, save stays above nav', async () => {
    await tapNav(page, 'projects');
    await page.locator('#proj-new').click();
    await page.locator('#p-name').waitFor();
    await page.fill('#p-name', PROJECT);
    await page.fill('#p-operator', 'Acme Gas');
    await page.fill('#p-county', 'Harris');
    await page.fill('#p-state', 'TX');
    await page.fill('#p-pno', 'P-100');
    await assertSaveAboveNav(page, '#p-save');
    await assertSaveAboveNav(page, '#p-save-top');
    await page.locator('#p-save-top').click();
    await waitStatus(page, '#p-save-status', /Saved/);
    await page.locator('[data-view="project"] .back-btn').click();
    await expect(page.locator('#view-projects:not([hidden]) #proj-list')).toContainText(PROJECT);
    await tapNav(page, 'home');
    await expect(page.locator('#home-root')).toContainText(PROJECT);
    await assertNoOverflow(page);
  });

  test('project persists after reload (IndexedDB + settings)', async () => {
    await page.goto('/');
    await page.locator('#view-home:not([hidden]) #home-root').waitFor();
    await expect(page.locator('#view-home:not([hidden]) #home-root')).toContainText(PROJECT);
    await tapNav(page, 'projects');
    await expect(page.locator('#proj-list')).toContainText(PROJECT);
  });

  test('add workers and qualified + expired OQ with status colors', async () => {
    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="personnel"]');
    await page.locator('#w-new').waitFor();
    await page.locator('#w-new').click();
    await page.locator('#w-name').waitFor();
    await page.fill('#w-name', WORKER_OK);
    await page.fill('#w-co', 'Acme');
    await page.fill('#w-role', 'Operator');
    await page.locator('#w-save-top').click();
    await waitStatus(page, '#w-save-status', /Saved/);

    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="personnel"]');
    await page.locator('#w-new').waitFor();
    await page.locator('#w-new').click();
    await page.locator('#w-name').waitFor();
    await page.fill('#w-name', WORKER_EXP);
    await page.fill('#w-co', 'Acme');
    await page.fill('#w-role', 'Welder');
    await page.locator('#w-save-top').click();
    await waitStatus(page, '#w-save-status', /Saved/);

    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="oq"]');
    await page.locator('#oq-new').waitFor();
    await page.locator('#oq-new').click();
    await page.locator('#oq-worker').waitFor();
    await selectOptionIncluding(page, '#oq-worker', WORKER_OK);
    await page.fill('#oq-taskn', '001');
    await page.fill('#oq-taskd', 'Excavation');
    await page.selectOption('#oq-st', 'qualified');
    await page.fill('#oq-exp', isoOffset(400));
    await page.fill('#oq-insp', 'Pat Inspector');
    await page.locator('#oq-save-top').click();
    await waitStatus(page, '#oq-save-status', /Saved/);
    await expect(page.locator('#oq-disp .status-green')).toBeVisible();
    await expect(page.locator('#oq-disp')).toContainText(/Qualified/i);
    await assertSaveAboveNav(page, '#oq-save');

    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="oq"]');
    await page.locator('#oq-new').waitFor();
    await page.locator('#oq-new').click();
    await page.locator('#oq-worker').waitFor();
    await selectOptionIncluding(page, '#oq-worker', WORKER_EXP);
    await page.fill('#oq-taskn', '099');
    await page.fill('#oq-taskd', 'Welding');
    await page.selectOption('#oq-st', 'qualified');
    await page.fill('#oq-exp', isoOffset(-10));
    await page.locator('#oq-save-top').click();
    await waitStatus(page, '#oq-save-status', /Saved/);
    await expect(page.locator('#oq-disp .status-red')).toBeVisible();
    await expect(page.locator('#oq-disp')).toContainText(/Expired/i);

    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="oq"]');
    await page.selectOption('#oq-win', 'expired');
    await expect(page.locator('#oq-list')).toContainText(WORKER_EXP);
    await expect(page.locator('#oq-list')).toContainText(/Expired/i);
    await assertNoOverflow(page);
  });

  test('daily crew verification totals and All OQs Verified record', async () => {
    await tapNav(page, 'reports');
    await visibleClick(page, '[data-nav="crew"]');
    await page.locator('#crew-add').waitFor();
    await selectOptionIncluding(page, '#crew-add', WORKER_OK);
    await expect(page.locator('#crew-summary')).toContainText(/1 workers/i);
    await expect(page.locator('#crew-summary')).toContainText(/1 compliant/i);
    await expect(page.locator('#crew-summary')).toContainText(/0 issues/i);
    await assertSaveAboveNav(page, '#crew-verify');
    await page.locator('#crew-verify-top').click();
    await waitStatus(page, '#crew-verify-status', /All OQs verified/i);
    await expect(page.locator('#crew-hist')).toContainText(/All verified/i);
  });

  test('Start of Day READY and override with reason', async () => {
    await tapNav(page, 'reports');
    await visibleClick(page, '[data-nav="start-of-day"]');
    await page.locator('#sod-save-top').waitFor();
    await expect(page.locator('.sod-ck')).toHaveCount(24);
    const boxes = page.locator('.sod-ck');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i);
      if (!(await box.isChecked())) await box.check();
    }
    await page.locator('#sod-save-top').click();
    await waitStatus(page, '#sod-save-status', /READY FOR WORK/i);
    await expect(page.locator('#sod-result')).toContainText(/READY FOR WORK/i);

    await boxes.first().uncheck();
    await page.fill('#sod-reason', 'spotter delayed');
    await page.locator('#sod-save-top').click();
    await waitStatus(page, '#sod-save-status', /override|ISSUES/i);
    await expect(page.locator('#sod-hist')).toContainText(/ISSUES|OVERRIDE/i);
    await assertSaveAboveNav(page, '#sod-save');
    await assertNoOverflow(page);
  });

  test('Daily Report shows today’s CrewDay OQs verified indicator', async () => {
    await tapNav(page, 'reports');
    await visibleClick(page, '[data-nav="daily"]');
    await page.locator('#daily-root').waitFor();
    await expect(page.locator('#dr-oq-hook')).toContainText(/OQs verified/i);
    await expect(page.locator('#dr-oq-hook')).toContainText(/1 workers/i);
    await assertNoOverflow(page);
  });

  test('IndexedDB records survive reload', async () => {
    await page.goto('/');
    await page.locator('#view-home:not([hidden]) #home-root').waitFor();
    await expect(page.locator('#view-home:not([hidden]) #home-root')).toContainText(PROJECT);
    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="personnel"]');
    await expect(page.locator('#w-list')).toContainText(WORKER_OK);
    await expect(page.locator('#w-list')).toContainText(WORKER_EXP);
    await tapNav(page, 'more');
    await visibleClick(page, '[data-nav="oq"]');
    await expect(page.locator('#oq-list')).toContainText(WORKER_OK);
    await tapNav(page, 'reports');
    await visibleClick(page, '[data-nav="crew"]');
    await expect(page.locator('#crew-hist')).toContainText(/All verified|workers/i);
  });

  test('offline edit shows OFFLINE banner and keeps data after reconnect', async () => {
    await context.setOffline(true);
    await tapNav(page, 'projects');
    await page.locator('.proj-open').first().click();
    await page.locator('#p-notes').waitFor();
    await page.locator('#p-notes').fill('offline note from field');
    await page.locator('#p-save-top').click();
    await waitStatus(page, '#p-save-status', /Saved|failed/i);
    await expect(page.locator('#sync-banner')).toContainText(/OFFLINE/i);
    await context.setOffline(false);
    await page.goto('/');
    await page.locator('#view-home:not([hidden]) #home-root').waitFor();
    await tapNav(page, 'projects');
    await page.locator('.proj-open').first().click();
    await page.locator('#p-notes').waitFor();
    await expect(page.locator('#p-notes')).toHaveValue(/offline note from field/);
    await expect(page.locator('#home-root, #sync-banner').first()).toBeVisible();
  });

  test('legacy tool routes still mount', async () => {
    for (const name of LEGACY) {
      await page.goto(`/#${name}`);
      await expect(page.locator(`[data-view="${name}"]:not([hidden])`)).toBeVisible();
    }
    await tapNav(page, 'inspect');
    await expect(page.locator('#view-inspect')).toContainText(/Trench Slope/i);
    await expect(page.locator('#view-inspect')).toContainText(/Bell Hole/i);
    await expect(page.locator('#view-inspect')).toContainText(/Photo Stamp/i);
    await assertNoOverflow(page);
  });

  test('no IndexedDB/pageerror console failures on primary workflow', async () => {
    const interesting = errors.pageErrors.filter(
      (m) => !/ResizeObserver|AbortError/i.test(m)
    );
    expect(interesting, interesting.join('\n')).toEqual([]);
    expect(errors.failedApp, errors.failedApp.join('\n')).toEqual([]);
  });
});
