/** Shared Playwright helpers for 390×844 field-UI regressions. */

export const PROJECT = 'Test Line 12';
export const WORKER_OK = 'Jane Operator';
export const WORKER_EXP = 'Ed Expired';

export function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function tapNav(page, name) {
  await page.locator(`.bottom-nav [data-nav="${name}"]`).click();
  await page.waitForSelector(`[data-view="${name}"]:not([hidden])`);
}

export async function visibleClick(page, selector) {
  await page.locator(`.view:not([hidden]) ${selector}`).first().click();
}

export async function assertNoOverflow(page) {
  const box = await page.evaluate(() => {
    const de = document.documentElement;
    const b = document.body;
    return {
      client: de.clientWidth,
      scroll: Math.max(de.scrollWidth, b.scrollWidth),
    };
  });
  if (box.scroll > box.client + 1) {
    throw new Error(`horizontal overflow: scrollWidth=${box.scroll} clientWidth=${box.client}`);
  }
}

export async function assertSaveAboveNav(page, saveSelector) {
  const save = page.locator(saveSelector).first();
  const nav = page.locator('.bottom-nav');
  await save.waitFor({ state: 'visible' });
  const sb = await save.boundingBox();
  const nb = await nav.boundingBox();
  if (!sb || !nb) throw new Error('missing save or nav box');
  if (sb.y + sb.height > nb.y + 2) {
    throw new Error(
      `save overlaps nav: save.bottom=${sb.y + sb.height} nav.top=${nb.y}`
    );
  }
}

export async function selectOptionIncluding(page, selectSelector, text) {
  await page.waitForFunction(
    ({ sel, needle }) =>
      [...document.querySelectorAll(`${sel} option`)].some((o) => (o.textContent || '').includes(needle)),
    { sel: selectSelector, needle: text }
  );
  const value = await page.locator(`${selectSelector} option`).evaluateAll((opts, needle) => {
    const hit = opts.find((o) => (o.textContent || '').includes(needle));
    return hit ? hit.value : '';
  }, text);
  if (!value) throw new Error(`option including "${text}" not found in ${selectSelector}`);
  await page.selectOption(selectSelector, value);
}

export async function waitStatus(page, selector, re) {
  await page.waitForFunction(
    ({ sel, pattern }) => new RegExp(pattern, 'i').test(document.querySelector(sel)?.textContent || ''),
    { sel: selector, pattern: re.source || re }
  );
}

export function attachErrorCollectors(page) {
  const pageErrors = [];
  const failedApp = [];
  page.on('pageerror', (err) => {
    pageErrors.push(String(err?.message || err));
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (/127\.0\.0\.1|localhost/.test(url) && /\.(js|css|mjs)(\?|$)/.test(url)) {
      failedApp.push(`${req.failure()?.errorText || 'failed'} ${url}`);
    }
  });
  return { pageErrors, failedApp };
}
