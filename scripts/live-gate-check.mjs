/**
 * 🔒 라이브(배포본) 게이트 확인 — https://hw3238.github.io/bitget-signal-scanner/
 *
 *   node scripts/live-gate-check.mjs
 *
 *  1) 세션이 없는 새 브라우저 → **회원 전용 게이트만** (탭·시그널·헤더·거래소 선택 없음, 마켓 요청 0)
 *  2) 세션을 심은 브라우저 → 게이트 없이 앱(스캐너) — 회원은 그대로 쓸 수 있다
 *  스크린샷: docs/screens/146-live-auth-gate.png · 147-live-member-app.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

/* 1) 세션 없는 새 브라우저 */
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const market = { n: 0 };
await guestCtx.route('**://api.bitget.com/**', (r) => {
  market.n += 1;
  return r.abort();
});
await guestCtx.route('**://fapi.binance.com/**', (r) => {
  market.n += 1;
  return r.abort();
});
await guestCtx.route('**://data-api.binance.vision/**', (r) => {
  market.n += 1;
  return r.abort();
});
const guest = await guestCtx.newPage();
const guestErrors = [];
guest.on('pageerror', (e) => guestErrors.push(String(e)));
await guest.goto(URL, { waitUntil: 'domcontentloaded' });
await guest.waitForSelector('[data-auth-gate]', { timeout: 60000 });
await guest.waitForTimeout(1200);
const locked = await guest.evaluate(() => ({
  gate: !!document.querySelector('[data-auth-gate]'),
  tabs: document.querySelectorAll('[data-tab]').length,
  bottomNav: document.querySelectorAll('.bottom-nav').length,
  appBar: document.querySelectorAll('.app-bar').length,
  scanner: document.querySelectorAll('.scanner-tab').length,
  cards: document.querySelectorAll('.signal-card').length,
  exchangeGate: document.querySelectorAll('[data-exchange-gate]').length,
  guestBtn: document.querySelectorAll('[data-auth-guest]').length,
  banner: document.querySelectorAll('[data-auth-banner]').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  session: localStorage.getItem('cota.auth.session.v1'),
}));
check('라이브: 세션이 없으면 회원 전용 게이트만 뜬다', locked.gate && locked.tabs === 0 && locked.bottomNav === 0 && locked.appBar === 0);
check('라이브: 스캐너·시그널·거래소 선택 DOM 없음', locked.scanner === 0 && locked.cards === 0 && locked.exchangeGate === 0);
check('라이브: 둘러보기 버튼·게스트 배너 없음', locked.guestBtn === 0 && locked.banner === 0);
check('라이브: 로컬 세션 없음 · 390px 오버플로 0', locked.session === null && !locked.overflow);
check('라이브: 게이트 때문에 마켓 API 호출 0건', market.n === 0, `${market.n}건`);
check('라이브: 페이지 예외 0건', guestErrors.length === 0, guestErrors.slice(0, 1).join(''));
await guest.screenshot({ path: `${OUT}/146-live-auth-gate.png` });
await guestCtx.close();

/* 2) 세션을 심은 브라우저 — 회원은 그대로 사용 */
const memberCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await memberCtx.addInitScript(seedAuthSession);
await installE2EStubs(memberCtx);
await memberCtx.addInitScript(() => {
  localStorage.setItem('cota.exchange.v1', 'bitget');
  localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
});
const member = await memberCtx.newPage();
await member.goto(URL, { waitUntil: 'domcontentloaded' });
await member.waitForSelector('.scanner-tab', { timeout: 60000 });
await member.waitForTimeout(1500);
const open = await member.evaluate(() => ({
  gate: !!document.querySelector('[data-auth-gate]'),
  tabs: document.querySelectorAll('[data-tab]').length,
  scanner: document.querySelectorAll('.scanner-tab').length,
  chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value') ?? null,
  status: document.querySelector('.status-text')?.textContent?.trim() ?? null,
}));
check('라이브: 세션이 있으면 게이트 없이 앱(스캐너)이 열린다', !open.gate && open.scanner === 1 && open.tabs >= 9, `탭 ${open.tabs}`);
check('라이브: 로그인 상태에서 거래소 칩·스캔 상태 정상', open.chip === 'bitget' && !!open.status, `${open.chip} · ${open.status}`);
await member.screenshot({ path: `${OUT}/147-live-member-app.png` });
await memberCtx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log('');
console.log(`라이브 게이트 확인: ${checks.length - failed.length}/${checks.length} 통과`);
if (failed.length) {
  console.log(`실패: ${failed.map((f) => f.name).join(' · ')}`);
  process.exitCode = 1;
}
