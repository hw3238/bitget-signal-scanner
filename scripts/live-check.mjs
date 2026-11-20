/** 라이브 GitHub Pages 배포본 검증 */
import { chromium } from 'playwright';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

  const res = await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.rescan');
      return !!btn && !btn.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    status: document.querySelector('.status-text')?.textContent,
    title: document.querySelector('.summary-title')?.textContent?.replace(/\s+/g, ' ').trim(),
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    firstSym: document.querySelector('.signal-card .sym')?.textContent,
    firstPrice: document.querySelector('.signal-card .price')?.textContent,
  }));
  await page.screenshot({ path: 'docs/screens/09-live-pages.png' });
  await browser.close();
  console.log(JSON.stringify({ httpStatus: res?.status(), url: URL, info, errors }, null, 1));
};

run().catch((e) => {
  console.error('LIVE CHECK FAILED', e);
  process.exitCode = 1;
});
