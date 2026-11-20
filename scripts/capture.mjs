import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';

function waitForServer(url, timeoutMs = 40000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve(true);
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('preview server timed out'));
      setTimeout(tick, 400);
    };
    tick();
  });
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
});

const logs = [];
server.stdout.on('data', (d) => logs.push(`[server] ${d.toString().trim()}`));
server.stderr.on('data', (d) => logs.push(`[server:err] ${d.toString().trim()}`));

mkdirSync(OUT, { recursive: true });

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  const errors = [];
  const consoleErrors = [];

  // ---------- 모바일 ----------
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await mobile.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 150000 });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.rescan');
      return !!btn && !btn.classList.contains('busy');
    },
    { timeout: 150000 },
  );
  await page.waitForTimeout(1200);

  const summary = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
    return {
      cards: cards.length,
      first: cards.slice(0, 4).map((c) => ({
        sym: c.querySelector('.sym')?.textContent,
        price: c.querySelector('.price')?.textContent,
        rr: c.querySelector('.rr-pill b')?.textContent,
        roi: c.querySelector('.roi-value')?.textContent,
        tf: c.querySelector('.tf')?.textContent,
        badge: c.querySelector('.badge.state')?.textContent,
      })),
      title: document.querySelector('.summary-title')?.textContent?.replace(/\s+/g, ' ').trim(),
      counters: [...document.querySelectorAll('.counter')].map((c) => c.textContent),
      listHead: document.querySelector('.list-head')?.textContent?.replace(/\s+/g, ' ').trim(),
    };
  });

  await page.screenshot({ path: `${OUT}/01-scanner.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/01-scanner-full.png`, fullPage: true });

  // 다크 공유 카드
  await page.locator('.signal-card').first().click();
  await page.waitForSelector('.share-canvas.in', { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/02-dark-card.png`, fullPage: false });

  const modalInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.share-canvas');
    return canvas ? { w: canvas.width, h: canvas.height } : null;
  });

  // 카드 PNG 저장 검증
  const pngData = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.share-canvas');
    return canvas ? canvas.toDataURL('image/png').length : 0;
  });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.locator('.share-actions button.primary').click(),
  ]);
  const savedFile = download ? `${download.suggestedFilename()} / ${(await download.path()) ? 'path-ok' : 'no-path'}` : 'no-download';
  if (download) await download.saveAs(`${OUT}/02-dark-card-export.png`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 전략엔진 탭
  await page.locator('.bottom-nav button', { hasText: '전략엔진' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/03-strategy-engine.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/03-strategy-engine-full.png`, fullPage: true });

  const engine = await page.evaluate(() => ({
    heroTitle: document.querySelector('.hero-copy h2')?.textContent,
    stats: [...document.querySelectorAll('.hero-stats div')].map((d) => d.textContent),
    topName: document.querySelector('.hero-top-name')?.textContent,
    rows: [...document.querySelectorAll('.strat-row')].map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim()),
    swaps: [...document.querySelectorAll('.swap-list li')]
      .slice(0, 6)
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim()),
    swapCount: document.querySelectorAll('.count-badge').length
      ? document.querySelector('.count-badge')?.textContent
      : '0',
  }));

  // 시황 / 기록
  await page.locator('.bottom-nav button', { hasText: '시황' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-market.png`, fullPage: false });
  const market = await page.evaluate(() => ({
    stats: [...document.querySelectorAll('.stat')].map((d) => d.textContent?.replace(/\s+/g, ' ').trim()),
    rows: [...document.querySelectorAll('.mv-list li')].slice(0, 4).map((li) => li.textContent?.replace(/\s+/g, ' ').trim()),
  }));

  await page.locator('.bottom-nav button', { hasText: '설정' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/08-settings.png`, fullPage: false });

  await page.locator('.bottom-nav button', { hasText: '기록' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-history.png`, fullPage: false });
  const history = await page.evaluate(() => ({
    stats: [...document.querySelectorAll('.stat')].map((d) => d.textContent?.replace(/\s+/g, ' ').trim()),
    rows: [...document.querySelectorAll('.history-list li')].slice(0, 4).map((li) => li.textContent?.replace(/\s+/g, ' ').trim()),
  }));

  // ---------- 데스크톱 ----------
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const dpage = await desktop.newPage();
  dpage.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[desktop] ${msg.text()}`);
  });
  dpage.on('pageerror', (err) => errors.push(`[desktop] ${String(err)}`));
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await dpage.waitForSelector('.signal-card:not(.skeleton)', { timeout: 150000 });
  await dpage.waitForFunction(
    () => {
      const btn = document.querySelector('.rescan');
      return !!btn && !btn.classList.contains('busy');
    },
    { timeout: 150000 },
  );
  await dpage.waitForTimeout(1200);
  await dpage.screenshot({ path: `${OUT}/06-desktop.png`, fullPage: false });
  const desktopInfo = await dpage.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    cols: getComputedStyle(document.querySelector('.card-grid')).gridTemplateColumns,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));

  await browser.close();

  console.log(
    JSON.stringify(
      {
        summary,
        modalInfo,
        pngBytes: pngData,
        savedFile,
        engine,
        market,
        history,
        desktopInfo,
        consoleErrors,
        pageErrors: errors,
        serverLogs: logs.slice(-4),
      },
      null,
      2,
    ),
  );
};

run()
  .catch((e) => {
    console.error('CAPTURE FAILED', e);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill('SIGTERM');
  });
