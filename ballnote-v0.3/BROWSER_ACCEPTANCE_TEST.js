'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { chromium, webkit } = require('playwright-core');

const BASE = process.env.BALLNOTE_URL || 'http://127.0.0.1:4173/ballnote-v0.3/';
const ENGINE = process.env.BROWSER_ENGINE || 'chromium';
const chrome = ENGINE === 'chromium' ? (process.env.CHROME_BIN || execSync(
  'command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser',
  { encoding: 'utf8', shell: '/bin/bash' }
).trim()) : '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function storedState(page) {
  return page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('ballnote-v030-db', 2);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['state','games'], 'readonly');
        const stateReq = tx.objectStore('state').get('current');
        stateReq.onerror = () => { try { db.close(); } catch(e) {} resolve(null); };
        stateReq.onsuccess = () => {
          const meta = stateReq.result || null;
          if (!meta) { try { db.close(); } catch(e) {} resolve(null); return; }
          if (meta.g) { try { db.close(); } catch(e) {} resolve(meta); return; }
          if (!meta.currentGameId) { try { db.close(); } catch(e) {} resolve({draft:meta.draft||{},g:null,savedAt:meta.savedAt||0}); return; }
          const gameReq = tx.objectStore('games').get(meta.currentGameId);
          gameReq.onerror = () => { try { db.close(); } catch(e) {} resolve(null); };
          gameReq.onsuccess = () => {
            const out = {draft:meta.draft||{},g:gameReq.result||null,savedAt:meta.savedAt||0,meta};
            try { db.close(); } catch(e) {}
            resolve(out);
          };
        };
      } catch (e) {
        try { db.close(); } catch(x) {}
        resolve(null);
      }
    };
  }));
}

async function waitStoredState(page, predicate, message) {
  let state = null;
  for (let i = 0; i < 60; i++) {
    state = await storedState(page);
    if (state && predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  throw new Error(message + ' last=' + JSON.stringify(state));
}

async function storageLayout(page) {
  return page.evaluate(() => new Promise(resolve => {
    const legacy = localStorage.getItem('ballnote-v030');
    const metaRaw = localStorage.getItem('ballnote-v031-meta');
    const req = indexedDB.open('ballnote-v030-db', 2);
    req.onerror = () => resolve({legacy,metaRaw,idb:null});
    req.onsuccess = () => {
      const db=req.result;
      const tx=db.transaction(['state','games','syncQueue'],'readonly');
      const sr=tx.objectStore('state').get('current');
      const gr=tx.objectStore('games').getAll();
      const qr=tx.objectStore('syncQueue').getAll();
      tx.oncomplete=async()=>{
        let estimate={usage:0,quota:0};
        try { if(navigator.storage&&navigator.storage.estimate) estimate=await navigator.storage.estimate(); } catch(e) {}
        const out={legacy,metaRaw,state:sr.result||null,games:gr.result||[],queue:qr.result||[],estimate};
        try{db.close()}catch(e){}
        resolve(out);
      };
      tx.onerror=()=>{try{db.close()}catch(e){} resolve({legacy,metaRaw,idb:null})};
    };
  }));
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
  const badResponses = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
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
  await page.waitForFunction(
    () => {
      try {
        const m = JSON.parse(localStorage.getItem('ballnote-v031-meta') || 'null');
        return !!(m && m.draft && m.draft.opponent === '受入テスト');
      } catch (e) { return false; }
    },
    null,
    { timeout: 5000 }
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '＋ 新しい試合' }).click();
  await page.waitForFunction(
    () => document.querySelector('#opp') && document.querySelector('#opp').value === '受入テスト',
    null,
    { timeout: 5000 }
  );
  assert((await page.locator('#opp').inputValue()) === '受入テスト', label + ': pregame draft restored from IndexedDB');
  await page.getByRole('button', { name: '先攻' }).click();
  await page.getByRole('button', { name: '試合を開始' }).click();

  assert((await safeText(page, 'body')).includes('1回表'), label + ': live start');
  const liveOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(liveOverflow <= 2, label + ': live viewport horizontal overflow=' + liveOverflow);

  await page.getByRole('button', { name: 'ボール' }).click();
  let state = await waitStoredState(page, s => s.g && s.g.count.b === 1, label + ': one-tap ball persisted');
  const layout = await storageLayout(page);
  assert(layout.legacy === null, label + ': legacy full localStorage payload removed');
  assert(layout.metaRaw && layout.metaRaw.length < 1024, label + ': lightweight localStorage metadata');
  assert(layout.state && !layout.state.g && layout.state.currentGameId === state.g.gameId, label + ': IndexedDB state is lightweight metadata');
  assert(layout.games && layout.games.some(g => g.gameId === state.g.gameId), label + ': game body stored in IndexedDB games');

  await page.getByRole('button', { name: /取消/ }).click();
  state = await waitStoredState(page, s => s.g && s.g.count.b === 0, label + ': Undo');

  await page.getByRole('button', { name: /やり直し/ }).click();
  state = await waitStoredState(page, s => s.g && s.g.count.b === 1, label + ': Redo');

  await page.getByRole('button', { name: '打球' }).click();
  await page.getByRole('button', { name: '単打' }).click();
  state = await waitStoredState(page, s => s.g && s.g.bases.first === 'p1', label + ': single persisted');
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

  if (ENGINE === 'chromium') {
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    assert((await safeText(page, 'body')).includes('BALLNOTE'), label + ': offline shell reload');
    assert((await safeText(page, 'body')).includes('記録を続ける'), label + ': offline resume path is available');
    await page.getByRole('button', { name: '記録を続ける' }).click();
    assert((await safeText(page, 'body')).includes('1回表'), label + ': offline resume returns to live');

    await page.getByRole('button', { name: 'ボール' }).click();
    state = await waitStoredState(page, s => s.g && s.g.count.b === 1, label + ': offline pitch persists');
    await context.setOffline(false);
  } else {
    assert((await safeText(page, 'body')).includes('記録を続ける'), label + ': WebKit resume path after reload');
    await page.getByRole('button', { name: '記録を続ける' }).click();
    assert((await safeText(page, 'body')).includes('1回表'), label + ': WebKit resume returns to live');
    await page.getByRole('button', { name: 'ボール' }).click();
    state = await waitStoredState(page, s => s.g && s.g.count.b === 1, label + ': WebKit resumed pitch persists');
  }
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

  let pdfBytes = 0;
  if (ENGINE === 'chromium') {
    const pdfPath = '/tmp/ballnote-' + label + '.pdf';
    const pdf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    pdfBytes = pdf.length;
    assert(pdf.length > 5000, label + ': PDF generated');
    assert(fs.statSync(pdfPath).size === pdf.length, label + ': PDF file persisted');
  }

  const unexpectedResponses = badResponses.filter(r => !/\/favicon\.ico(?:\?|$)/.test(r.url));
  const unexpectedConsoleErrors = unexpectedResponses.length
    ? consoleErrors
    : consoleErrors.filter(m => !/Failed to load resource: the server responded with a status of 404/.test(m));
  assert(pageErrors.length === 0, label + ': page errors: ' + pageErrors.join(' | '));
  assert(unexpectedResponses.length === 0, label + ': HTTP errors: ' + JSON.stringify(unexpectedResponses));
  assert(unexpectedConsoleErrors.length === 0, label + ': console errors: ' + unexpectedConsoleErrors.join(' | '));

  await context.close();
  console.log('PASS', ENGINE, label);
  return { engine: ENGINE, label, pdfBytes };
}

(async () => {
  const browserType = ENGINE === 'webkit' ? webkit : chromium;
  const launchOptions = ENGINE === 'chromium'
    ? { executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
    : { headless: true };
  const browser = await browserType.launch(launchOptions);
  try {
    const results = [];
    results.push(await runScenario(browser, 'iphone-like', { width: 390, height: 844 }));
    results.push(await runScenario(browser, 'ipad-like', { width: 1024, height: 1366 }));
    console.log('BALLNOTE browser acceptance: ' + ENGINE + ' all ' + results.length + ' scenarios passed');
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('BALLNOTE browser acceptance FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
