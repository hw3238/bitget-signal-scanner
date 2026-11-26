/**
 * 배포 경로 검증: dist 를 /bitget-signal-scanner/ 서브패스로 서빙해 자산 경로가 깨지지 않는지 확인
 *   (GH Pages https://hw3238.github.io/bitget-signal-scanner/ 와 동일한 조건)
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

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
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await ctx.addInitScript(seedAuthSession);
  await installE2EStubs(ctx);

  await ctx.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem(
      'cota.profile.v1',
      JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }),
    );
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.scanner-tab .rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 150000 },
  );
  // 진행중 코인 시그널이 없는 시간대에도 카드 검증이 되도록 '종료 포함 → 자산 전체'로 넓힌다.
  if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
    const toggle = page.locator('.scanner-tab .ghost-toggle').first();
    if (((await toggle.textContent()) ?? '').includes('진행중만')) {
      await toggle.click();
      await page.waitForTimeout(800);
    }
    if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
      const all = page.locator('.scanner-tab [data-asset-filter] button[data-asset="all"]');
      if (await all.count()) {
        await all.first().click();
        await page.waitForTimeout(800);
      }
    }
  }
  await page.waitForSelector('.scanner-tab .signal-card:not(.skeleton)', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    url: location.pathname,
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    cssLoaded: !!document.styleSheets.length,
    scriptSrc: [...document.querySelectorAll('script')].map((s) => s.src),
    brand: document.querySelector('.brand-text b')?.textContent,
    tabs: [...document.querySelectorAll('.bottom-nav button .nav-label')].map((b) => b.textContent),
    onboarding: !!document.querySelector('.onboarding'),
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
  .finally(() => {
    server.kill('SIGTERM');
    // vite preview 자식 프로세스가 이벤트 루프를 붙잡아 종료가 늦어지는 것을 막는다.
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
