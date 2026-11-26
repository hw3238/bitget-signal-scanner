/**
 * 🟡 바이낸스 모드 E2E (v1.5.8) — "바이낸스를 선택하면 오류가 뜬다" 재발 방지
 *
 *   node scripts/binance-e2e.mjs      (npm run binance-e2e)
 *
 *  1) 첫 화면(거래소 게이트)에서 바이낸스 선택 → 스캐너가 열리고 **오류 배너 없이** 스캔이 끝난다
 *     · 상태 = `실시간 · HH:MM 갱신` (연결 오류 아님) · 출처 배지 = 선물/현물 중 실제 붙은 곳
 *     · 콘솔 오류는 **기대된 것만**(fapi CORS·429·api.github.com) · 페이지 예외 0
 *  2) 헤더 칩으로 비트겟 → 바이낸스 전환 → 같은 조건(오류 0) · 이전 시그널 즉시 비움
 *  3) 설정 탭 거래소 카드로 전환 → 같은 조건
 *  4) 시황·급등 탐색기(바이낸스 모드)에 오류 배너/알림 0
 *  5) 장애 주입 — 선물 전면 차단(abort) + 현물 429 → **빨간 오류 배너 없이** 재시도로 회복
 *  6) 장애 주입 — 선물·현물 모두 죽어도 화면이 깨지지 않고 '다시 시도' 안내만 뜬다(페이지 예외 0)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4195;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(URL);
    if (r.ok) break;
  } catch {
    /* 아직 안 떴다 */
  }
  await sleep(300);
}
mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** 기대된 잡음만 남기고 앱 오류만 고른다. */
const APP_ERROR = (t) =>
  !/fapi\.binance\.com|data-api\.binance\.vision|api\.github\.com|api\.bitget\.com|429|418|451|403|net::ERR_FAILED|Failed to load resource/i.test(t);

const WATCH = () => ({
  source: document.querySelector('[data-scan-source]')?.textContent?.trim() ?? null,
  status: document.querySelector('.status-text')?.textContent?.trim() ?? null,
  notice: document.querySelector('.scanner-tab .notice.error')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  summary: document.querySelector('.scanner-tab .summary-sub')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  cards: document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)').length,
  empty: document.querySelector('.scanner-tab .empty-title')?.textContent?.trim() ?? null,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
});

async function scanFinished(page, timeout = 240000) {
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.scanner-tab .rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout },
  );
  await page.waitForTimeout(900);
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const newPage = async (state, { exchange = null, snapshot = true, routes = null } = {}) => {
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
    await context.addInitScript(
      ({ exchange }) => {
        localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
        if (exchange) localStorage.setItem('cota.exchange.v1', exchange);
      },
      { exchange },
    );
    await context.route('**://api.github.com/**', (route) => route.abort());
    if (routes) await routes(context);
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => {
      if (m.type() === 'error') logs.push(m.text());
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`));
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    return { context, page, logs, dialogs };
  };

  /* ================= 1) 첫 화면에서 바이낸스 선택 ================= */
  const stateA = {};
  const A = await newPage(stateA);
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await A.page.waitForSelector('[data-exchange-gate]', { timeout: 60000 });
  await A.page.locator('[data-exchange-option="binance"]').click();
  await A.page.waitForSelector('.scanner-tab', { timeout: 30000 });
  await scanFinished(A.page);
  const first = await A.page.evaluate(WATCH);
  check('첫 화면: 바이낸스를 고르면 바로 스캐너가 열린다', first.status !== null && first.summary?.includes('바이낸스'));
  check('첫 화면: 상태 = 실시간 갱신(연결 오류 아님)', /^실시간/.test(first.status ?? ''), first.status ?? 'null');
  check('첫 화면: 오류 배너 없음', !first.notice, first.notice ?? '없음');
  check('첫 화면: 출처 배지 = 바이낸스 선물 또는 현물 데이터', /^바이낸스 (선물|현물 데이터)$/.test(first.source ?? ''), first.source ?? 'null');
  check('첫 화면: 시그널 카드 또는 정상 빈 상태(오류 아님)', first.cards > 0 || !!first.empty, `카드 ${first.cards} · ${first.empty ?? ''}`);
  check('첫 화면: 390px 가로 오버플로 0건', !first.overflow);
  const firstErrors = A.logs.filter(APP_ERROR);
  check('첫 화면: 앱 콘솔 오류 0건(바이낸스 지역차단·429 잡음 제외)', firstErrors.length === 0, firstErrors.slice(0, 2).join(' | '));
  check('첫 화면: 페이지 예외 0건', A.logs.filter((t) => t.startsWith('[pageerror]')).length === 0);
  check('첫 화면: 경고·알림창 0건', A.dialogs.length === 0, A.dialogs.slice(0, 2).join(' | '));
  await A.page.screenshot({ path: `${OUT}/141-binance-first-scan.png` });

  /* 시황 탭 */
  const beforeMarket = A.logs.length;
  await A.page.locator('.bottom-nav button[data-tab="market"]').click();
  await A.page.waitForSelector('.market-tab', { timeout: 20000 });
  await A.page.waitForTimeout(3500);
  const market = await A.page.evaluate(() => ({
    text: document.querySelector('.market-tab')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? '',
    notice: document.querySelector('.market-tab .notice.error')?.textContent?.trim() ?? null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('시황(바이낸스): 마켓 요약이 그려지고 오류 배너 없음', market.text.includes('바이낸스') && !market.notice, market.text.slice(0, 60));
  check('시황(바이낸스): 오버플로 0건 · 콘솔 오류 0건', !market.overflow && A.logs.slice(beforeMarket).filter(APP_ERROR).length === 0);
  await A.page.screenshot({ path: `${OUT}/142-binance-market.png` });

  /* 급등 탐색기 (1H 단계까지만 확인 — 전체 탐색은 시간이 길다) */
  const beforeSurge = A.logs.length;
  await A.page.locator('.bottom-nav button[data-tab="menu"]').click();
  await A.page.waitForTimeout(400);
  await A.page.locator('.menu-row[data-menu="surge"]').click();
  await A.page.waitForTimeout(4000);
  const surge = await A.page.evaluate(() => ({
    text: document.querySelector('.surge-tab')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '',
    error: document.querySelector('.surge-tab .notice.error')?.textContent?.trim() ?? null,
  }));
  check('급등 탐색기(바이낸스): 유니버스가 그려지고 오류 없음', surge.text.includes('바이낸스 USDT 마켓') && !surge.error, surge.text.slice(0, 60));
  check('급등 탐색기(바이낸스): 콘솔 오류 0건', A.logs.slice(beforeSurge).filter(APP_ERROR).length === 0, A.logs.slice(beforeSurge).filter(APP_ERROR).slice(0, 2).join(' | '));
  await A.context.close();

  /* ================= 2) 헤더 칩 전환 (비트겟 → 바이낸스) ================= */
  const B = await newPage({}, { exchange: 'bitget' });
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('[data-exchange-chip]', { timeout: 60000 });
  await scanFinished(B.page);
  const beforeSwitch = B.logs.length;
  await B.page.locator('[data-exchange-chip]').click();
  await B.page.waitForSelector('[data-exchange-option="binance"]', { timeout: 10000 });
  await B.page.locator('[data-exchange-option="binance"]').click();
  await B.page.waitForSelector('.scanner-tab', { timeout: 20000 });
  await scanFinished(B.page);
  const switched = await B.page.evaluate(WATCH);
  check('헤더 칩 전환: 바이낸스 스캔 완료 · 연결 오류 아님', /^실시간/.test(switched.status ?? '') && !switched.notice, switched.status ?? 'null');
  check('헤더 칩 전환: 출처 배지 표시', /^바이낸스 /.test(switched.source ?? ''), switched.source ?? 'null');
  const switchErrors = B.logs.slice(beforeSwitch).filter(APP_ERROR);
  check('헤더 칩 전환: 앱 콘솔 오류 0건', switchErrors.length === 0, switchErrors.slice(0, 2).join(' | '));
  await B.page.screenshot({ path: `${OUT}/143-binance-switched.png` });

  /* ================= 3) 설정 탭에서 전환 ================= */
  const beforeSettings = B.logs.length;
  await B.page.locator('.bottom-nav button[data-tab="settings"]').click();
  await B.page.waitForSelector('.settings-tab', { timeout: 20000 });
  await B.page.waitForTimeout(600);
  await B.page.waitForSelector('[data-settings-exchange]', { timeout: 15000 });
  const settingsExchange = await B.page.evaluate(() => ({
    options: [...document.querySelectorAll('[data-settings-exchange-option]')].map((o) => o.getAttribute('data-settings-exchange-option')),
    current: document.querySelector('[data-settings-exchange-current]')?.closest('[data-settings-exchange-option]')?.getAttribute('data-settings-exchange-option') ?? null,
  }));
  check('설정 탭: 거래소 카드 2개 · 현재 = 바이낸스', settingsExchange.options.join(',') === 'binance,bitget' && settingsExchange.current === 'binance', JSON.stringify(settingsExchange));
  // 비트겟으로 갔다가 다시 바이낸스 — 전환 왕복에서도 오류가 없어야 한다.
  await B.page.locator('[data-settings-exchange-option="bitget"]').click();
  await B.page.waitForTimeout(800);
  await B.page.locator('[data-settings-exchange-option="binance"]').click();
  await sleep(1500);
  await B.page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await B.page.waitForSelector('.scanner-tab', { timeout: 20000 });
  await scanFinished(B.page);
  const afterRound = await B.page.evaluate(WATCH);
  check('설정 탭 왕복(비트겟↔바이낸스): 오류 배너 없이 스캔 완료', /^실시간/.test(afterRound.status ?? '') && !afterRound.notice, afterRound.status ?? 'null');
  const settingsErrors = B.logs.slice(beforeSettings).filter(APP_ERROR);
  check('설정 탭 왕복: 앱 콘솔 오류 0건', settingsErrors.length === 0, settingsErrors.slice(0, 2).join(' | '));
  await B.context.close();

  /* ================= 4) 장애 주입 — 선물 차단 + 현물 429 ================= */
  let spotCalls = 0;
  const C = await newPage({}, {
    exchange: 'binance',
    routes: async (context) => {
      // 선물은 브라우저에서 막힌 것처럼(CORS) 실패시킨다.
      await context.route('**://fapi.binance.com/**', (route) => route.abort());
      // 현물은 첫 2번 429(레이트리밋) 후 정상 — 자동 재시도로 회복해야 한다.
      await context.route('**://data-api.binance.vision/**', (route) => {
        spotCalls += 1;
        if (spotCalls <= 2) {
          return route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*', 'retry-after': '1' }, body: '' });
        }
        return route.continue();
      });
    },
  });
  await C.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('.scanner-tab', { timeout: 60000 });
  await sleep(2500);
  const during = await C.page.evaluate(WATCH);
  check('장애 주입: 429 중에도 화면이 깨지지 않는다(페이지 예외 0)', C.logs.filter((t) => t.startsWith('[pageerror]')).length === 0);
  await scanFinished(C.page, 240000);
  const recovered = await C.page.evaluate(WATCH);
  check('장애 주입: 선물 차단 → 현물 폴백으로 스캔 완료', recovered.source === '바이낸스 현물 데이터' && /^실시간/.test(recovered.status ?? ''), `${recovered.source} · ${recovered.status}`);
  check('장애 주입: 빨간 오류 배너 없이 회복', !recovered.notice, recovered.notice ?? '없음');
  check('장애 주입: 429 는 자동 재시도로 넘어간다(추가 조작 없음)', spotCalls > 2, `현물 요청 ${spotCalls}건`);
  await C.page.screenshot({ path: `${OUT}/144-binance-retry-recovered.png` });
  await C.context.close();

  /* ================= 5) 장애 주입 — 두 출처 모두 죽어도 화면은 살아 있어야 ================= */
  const D = await newPage({}, {
    exchange: 'binance',
    routes: async (context) => {
      await context.route('**://fapi.binance.com/**', (route) => route.abort());
      await context.route('**://data-api.binance.vision/**', (route) => route.abort());
    },
  });
  await D.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await D.page.waitForSelector('.scanner-tab', { timeout: 60000 });
  await sleep(9000);
  const dead = await D.page.evaluate(() => ({
    notice: document.querySelector('.scanner-tab .notice.error')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    retry: !!document.querySelector('.scanner-tab .notice.error button'),
    tabs: document.querySelectorAll('[data-tab]').length,
    pageAlive: !!document.querySelector('.bottom-nav'),
  }));
  check('전면 장애: 스캐너에 다시 시도 안내(빨간 배너)가 뜬다', !!dead.notice && dead.retry, dead.notice?.slice(0, 60) ?? '없음');
  check('전면 장애: 탭바·화면은 그대로 살아 있다(앱 크래시 없음)', dead.pageAlive && dead.tabs >= 9);
  check('전면 장애: 페이지 예외 0건', D.logs.filter((t) => t.startsWith('[pageerror]')).length === 0, D.logs.filter((t) => t.startsWith('[pageerror]')).slice(0, 1).join(''));
  await D.page.screenshot({ path: `${OUT}/145-binance-offline-notice.png` });
  await D.context.close();

  await browser.close();

  const failed = checks.filter((cc) => !cc.ok);
  console.log('');
  console.log(`바이낸스 모드 E2E: ${checks.length - failed.length}/${checks.length} 통과`);
  if (failed.length) {
    console.log(`실패: ${failed.map((f) => f.name).join(' · ')}`);
    process.exitCode = 1;
  }
  try {
    process.kill(-server.pid);
  } catch {
    /* 이미 종료 */
  }
};

run().catch((err) => {
  console.error(err);
  try {
    process.kill(-server.pid);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
