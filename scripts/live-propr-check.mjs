/**
 * 🏆 Propr 5K 터보 시그널 라이브(배포본) 검증 (실행: node scripts/live-propr-check.mjs)
 *
 *  배포된 https://hw3238.github.io/bitget-signal-scanner/ 에서 실제로
 *   ① 메뉴에 🏆 Propr 카드가 있고 ② 들어가면 Hyperliquid 실시간 탐지가 돌아 카드가 뜨며
 *   ③ 계좌 트래커($5,000 → $5,450 / 하한 $4,850 / 일일 −$150)가 규정대로 계산되고
 *   ④ 위험·오류 없이 끝나는지 확인한다. 세션·Supabase 는 가짜로 응답해 실제 DB 는 건드리지 않는다.
 */
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const num = (t) => Number(String(t ?? '').replace(/[^0-9.-]/g, ''));

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await context.addInitScript(seedAuthSession);
  await installE2EStubs(context);
  await context.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.scanner-tab .rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  const bundle = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(','));

  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => {
    const row = document.querySelector('.menu-row[data-menu="propr"]');
    return {
      title: row?.querySelector('.menu-copy b')?.textContent?.replace(/\s+/g, ' ').trim(),
      emoji: row?.querySelector('.menu-emoji')?.textContent?.trim(),
      hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
      rows: document.querySelectorAll('.menu-row').length,
    };
  });
  check('라이브 메뉴: 🏆 Propr 카드 · 도구 10', hub.emoji === '🏆' && /Propr 5K 터보/.test(hub.title ?? '') && hub.hero === '10' && hub.rows === 9, `${hub.title} · ${hub.rows}+자동매매=${hub.hero}`);
  await page.screenshot({ path: `${OUT}/154-live-menu-propr.png` });

  await page.locator('.menu-row[data-menu="propr"]').click();
  await page.waitForSelector('[data-propr-progress]', { state: 'detached', timeout: 240000 });
  await page.waitForTimeout(700);
  if ((await page.locator('.propr-card').count()) === 0) {
    const toggle = page.locator('[data-open-only]');
    if (((await toggle.innerText()) ?? '').includes('진행중만')) {
      await toggle.click();
      await page.waitForTimeout(600);
    }
  }
  const view = await page.evaluate(() => ({
    cards: document.querySelectorAll('.propr-card').length,
    empty: !!document.querySelector('[data-propr-empty]'),
    sub: document.querySelector('[data-propr-sub]')?.textContent?.replace(/\s+/g, ' ').trim(),
    balance: document.querySelector('[data-propr-balance]')?.value,
    target: document.querySelector('[data-propr-target]')?.textContent?.replace(/\s+/g, ' ').trim(),
    floor: document.querySelector('[data-propr-floor]')?.textContent?.trim(),
    daily: document.querySelector('[data-propr-daily]')?.textContent?.trim(),
    first: (() => {
      const c = document.querySelector('.propr-card');
      if (!c) return null;
      return {
        symbol: c.dataset.symbol,
        badge: c.querySelector('[data-propr-badge]')?.textContent?.trim(),
        lev: Number(c.dataset.lev),
        cap: Number(c.dataset.cap),
        risk: Number(c.dataset.risk),
        cells: [...c.querySelectorAll('.propr-plan-cell b')].map((b) => b.textContent?.trim()),
      };
    })(),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('라이브 탐지: Hyperliquid 실시간 카드(또는 빈 안내)', view.cards > 0 || view.empty, `${view.cards}장 · ${view.sub}`);
  check('라이브 계좌 트래커: $5,000 · 목표 $5,450 · 하한 $4,850 · 일일 −$150', num(view.balance) === 5000 && /5,450/.test(view.target ?? '') && num(view.floor) === 4850 && num(view.daily) === 150, `${view.balance} · ${view.target} · ${view.floor} · ${view.daily}`);
  check(
    '라이브 카드: 레버리지 ≤ Propr 상한 · 리스크 $25',
    !view.first || (view.first.lev >= 1 && view.first.lev <= view.first.cap && view.first.risk <= 25.02 && !!view.first.badge),
    view.first ? `${view.first.symbol} ${view.first.badge} ${view.first.lev}x/${view.first.cap}x $${view.first.risk}` : '카드 없음',
  );
  check('라이브 390px 오버플로 0건', !view.overflow);
  await page.screenshot({ path: `${OUT}/155-live-propr.png` });

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check('라이브 콘솔/페이지 에러 0건', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 2) }));
  console.log(`\n배포 번들: ${bundle}`);
  await browser.close();

  const allOk = checks.every((c) => c.ok);
  console.log(`\n${allOk ? '✅ 라이브 Propr 검증 통과' : `❌ 실패 ${checks.filter((c) => !c.ok).length}건`} (${checks.length}개 확인)`);
  if (!allOk) process.exitCode = 1;
};

run().catch((e) => {
  console.error('LIVE PROPR CHECK FAILED', e);
  process.exitCode = 1;
});
