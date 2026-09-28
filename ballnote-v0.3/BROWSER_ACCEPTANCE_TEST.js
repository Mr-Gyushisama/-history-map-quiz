'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');

const BASE = process.env.BALLNOTE_URL || 'http://127.0.0.1:4173/ballnote-v0.3/';
const chrome = process.env.CHROME_BIN || execSync(
  'command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser',
  { encoding: 'utf8', shell: '/bin/bash' }
).trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function storedState(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('ballnote-v030');
    return raw ? JSON.parse(raw) : null;
  });
}

async function safeText(page, selector) {
  return page.locator(selector).first().textContent().catch(() => '');
}

async function runScenario(browser, label, viewport) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'allow'
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  console.log('SCENARIO', label, viewport.width + 'x' + viewport.height);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  assert((await page.title()).includes('BALLNOTE'), label + ': title');
  assert((await safeText(page, 'body')).includes('スコアをつける'), label + ': home rendered');

  const manifest = await page.evaluate(async () => {
    const r = await fetch('./manifest.webmanifest');
    return { ok: r.ok, json: await r.json() };
  });
  assert(manifest.ok, label + ': manifest fetch');
  assert(manifest.json.display === 'standalone', label + ': manifest standalone');

  await page.getByRole('button', { name: '＋ 新しい試合' }).click();
  await page.locator('#opp').fill('受入テスト');
  await page.getByRole('button', { name: '先攻' }).click();
  await page.getByRole('button', { name: '試合を開始' }).click();

  assert((await safeText(page, 'body')).includes('1回表'), label + ': live start');
  const liveOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(liveOverflow <= 2, label + ': live viewport horizontal overflow=' + liveOverflow);

  await page.getByRole('button', { name: 'ボール' }).click();
  let state = await storedState(page);
  assert(state && state.g && state.g.count.b === 1, label + ': one-tap ball persisted');

  await page.getByRole('button', { name: /取消/ }).click();
  state = await storedState(page);
  assert(state.g.count.b === 0, label + ': Undo');

  await page.getByRole('button', { name: /やり直し/ }).click();
  state = await storedState(page);
  assert(state.g.count.b === 1, label + ': Redo');

  await page.getByRole('button', { name: '打球' }).click();
  await page.getByRole('button', { name: '単打' }).click();
  state = await storedState(page);
  assert(state.g.bases.first === 'p1', label + ': single places batter on first');
  assert(state.g.bi === 1, label + ': batting order advances');
  assert(state.g.count.b === 0 && state.g.count.s === 0, label + ': count resets after PA');

  await page.waitForFunction(
    () => document.querySelector('.status') && document.querySelector('.status').textContent.includes('オフライン準備済'),
    null,
    { timeout: 15000 }
  );
  await page.reload({ waitUntil: 'networkidle' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  assert(controlled, label + ': service worker controls reloaded page');

  state = await storedState(page);
  assert(state.g.bases.first === 'p1' && state.g.bi === 1, label + ': state restored after reload');

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  assert((await safeText(page, 'body')).includes('BALLNOTE'), label + ': offline shell reload');
  assert((await safeText(page, 'body')).includes('記録を続ける'), label + ': offline resume path is available');
  await page.getByRole('button', { name: '記録を続ける' }).click();
  assert((await safeText(page, 'body')).includes('1回表'), label + ': offline resume returns to live');

  await page.getByRole('button', { name: 'ボール' }).click();
  state = await storedState(page);
  assert(state.g.count.b === 1, label + ': offline pitch persists');

  await context.setOffline(false);
  await page.getByRole('button', { name: 'BOX' }).click();
  assert((await safeText(page, 'body')).includes('ボックススコア'), label + ': BOX opens');

  const boxData = await page.evaluate(() => ({
    scorecells: document.querySelectorAll('.scorecell').length,
    printPages: document.querySelectorAll('.print-page').length,
    hasLegacyDoubleGlyph: document.body.textContent.includes('8二'),
    hasLegacyTripleGlyph: document.body.textContent.includes('8三')
  }));
  assert(boxData.scorecells > 0, label + ': BOX score cells');
  assert(boxData.printPages === 2, label + ': print has two team pages');
  assert(!boxData.hasLegacyDoubleGlyph && !boxData.hasLegacyTripleGlyph, label + ': no legacy extra-base glyph');

  await page.emulateMedia({ media: 'print' });
  const printState = await page.evaluate(() => ({
    printOnly: getComputedStyle(document.querySelector('.print-only')).display,
    screenOnly: getComputedStyle(document.querySelector('.screen-only')).display
  }));
  assert(printState.printOnly !== 'none', label + ': print layout visible');
  assert(printState.screenOnly === 'none', label + ': screen layout hidden for print');

  const pdfPath = '/tmp/ballnote-' + label + '.pdf';
  const pdf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  assert(pdf.length > 5000, label + ': PDF generated');
  assert(fs.statSync(pdfPath).size === pdf.length, label + ': PDF file persisted');

  assert(pageErrors.length === 0, label + ': page errors: ' + pageErrors.join(' | '));
  assert(consoleErrors.length === 0, label + ': console errors: ' + consoleErrors.join(' | '));

  await context.close();
  console.log('PASS', label);
  return { label, pdfBytes: pdf.length };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const results = [];
    results.push(await runScenario(browser, 'iphone-like', { width: 390, height: 844 }));
    results.push(await runScenario(browser, 'ipad-like', { width: 1024, height: 1366 }));
    console.log('BALLNOTE browser acceptance: all ' + results.length + ' scenarios passed');
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('BALLNOTE browser acceptance FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
