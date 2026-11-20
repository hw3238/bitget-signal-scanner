/**
 * 배포 경로 검증: dist 를 /bitget-signal-scanner/ 서브패스로 서빙해 자산 경로가 깨지지 않는지 확인
 *   (GH Pages https://hw3238.github.io/bitget-signal-scanner/ 와 동일한 조건)
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = '.tmp/pagesroot';
const SUB = 'bitget-signal-scanner';
const PORT = 4180;
const URL = `http://127.0.0.1:${PORT}/${SUB}/`;

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(`${ROOT}/${SUB}`, { recursive: true });
cpSync('dist', `${ROOT}/${SUB}`, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(URL);
      if (res.ok) break;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 150000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    url: location.pathname,
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    cssLoaded: !!document.styleSheets.length,
    scriptSrc: [...document.querySelectorAll('script')].map((s) => s.src),
    brand: document.querySelector('.brand-text b')?.textContent,
  }));
  await page.screenshot({ path: 'docs/screens/07-pages-subpath.png' });
  await browser.close();
  console.log(JSON.stringify({ info, errors }, null, 1));
};

run()
  .catch((e) => {
    console.error('SUBPATH CHECK FAILED', e);
    process.exitCode = 1;
  })
  .finally(() => server.kill('SIGTERM'));
