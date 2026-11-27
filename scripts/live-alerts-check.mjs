/**
 * 🎯 라이브(배포본) 알림 센터 · 메뉴 파인더 확인 — https://hw3238.github.io/bitget-signal-scanner/
 *
 *   node scripts/live-alerts-check.mjs
 *
 *  1) 메뉴 16도구 · 4그룹 · 칩 5개 · 검색
 *  2) 알림 센터: 마스터·4채널 · 지표 카드(예상/이전·카운트다운·롱숏) · 펼치기 · 🔕 저장
 *  3) 지정가 알림 추가 → localStorage 저장(새로고침 뒤 유지)
 *  4) 390px 오버플로 0 · 콘솔/페이지 에러 0
 *  스크린샷: docs/screens/187~192
 *
 *  ⚠️ DB 무접촉: 세션 시드 + 가짜 Supabase.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';
mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
await context.addInitScript(() => localStorage.setItem('cota.exchange.v1', 'bitget'));
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
await page.locator('.bottom-nav button[data-tab="menu"]').click();
await page.waitForSelector('.menu-hero', { timeout: 20000 });
await page.waitForTimeout(800);

const hub = await page.evaluate(() => ({
  hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
  rows: document.querySelectorAll('.menu-row').length,
  groups: [...document.querySelectorAll('.menu-group-title')].map((g) => g.textContent?.trim()),
  chips: document.querySelectorAll('[data-menu-chip]').length,
  alertChip: document.querySelector('[data-menu-chip="alert"]')?.textContent?.trim(),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
check('라이브 메뉴: 16도구 · 15행', hub.hero === '16' && hub.rows === 15, `${hub.hero} / ${hub.rows}`);
check(
  '라이브 메뉴: 그룹 4 · 칩 5',
  hub.groups.join('|') === '알림 · 시황|실전 레이더|리스크 · 계산기|분석 · 엔진' && hub.chips === 5,
  hub.groups.join(' / '),
);
check('라이브 메뉴: 390px 오버플로 0', !hub.overflow, '');
await page.screenshot({ path: `${OUT}/187-live-menu-finder.png` });

await page.locator('[data-menu-search]').fill('알림');
await page.waitForTimeout(300);
const search = await page.evaluate(() => [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu));
check('라이브 검색 — 알림 1건', search.length === 1 && search[0] === 'alerts', search.join(','));
await page.locator('[data-menu-search]').fill('');
await page.waitForTimeout(200);

await page.locator('[data-menu="alerts"]').click();
await page.waitForSelector('[data-alerts-tab]', { timeout: 20000 });
await page.waitForTimeout(700);

const center = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-macro-event]')];
  const nfp = cards.find((c) => c.dataset.macroEvent === 'nfp-2026-11');
  return {
    master: document.querySelector('[data-alert-master-switch]')?.getAttribute('aria-pressed'),
    channels: document.querySelectorAll('[data-alert-channel]').length,
    cards: cards.length,
    first: cards[0]?.dataset.macroEvent,
    countdown: cards[0]?.querySelector('[data-macro-countdown]')?.textContent?.trim(),
    nfp: nfp?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    context: document.querySelector('.macro-context')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check('라이브 알림 센터: 마스터·채널 4', center.master === 'true' && center.channels === 4, center.master);
check('라이브 지표 카드 8건 이상', center.cards >= 8, `${center.cards}건`);
check('라이브 첫 지표 = ISM 제조업', center.first === 'ism-mfg-2026-11', center.first);
check('라이브 카운트다운', /일|시간|분/.test(center.countdown ?? ''), center.countdown);
check('라이브 NFP 예상·롱숏 배지', /\+90K/.test(center.nfp) && /숏 유리/.test(center.nfp) && /롱 유리/.test(center.nfp), '');
check('라이브 기준금리 3.75~4.00%', /3\.75 ~ 4\.00%/.test(center.context), center.context.slice(0, 50));
check('라이브 알림 센터 오버플로 0', !center.overflow, '');
await page.screenshot({ path: `${OUT}/188-live-alerts-center.png`, fullPage: true });

await page.locator('[data-macro-event="nfp-2026-11"] .macro-card-head').click();
await page.waitForTimeout(400);
const detail = await page.evaluate(() => {
  const card = document.querySelector('[data-macro-event="nfp-2026-11"]');
  return {
    open: card?.classList.contains('open'),
    basis: card?.querySelectorAll('.macro-block li').length,
    scenarios: card?.querySelectorAll('.macro-scenario').length,
    source: card?.querySelector('.macro-source')?.textContent?.trim(),
  };
});
check('라이브 지표 펼치기: 근거·시나리오·출처', detail.open && (detail.basis ?? 0) >= 3 && detail.scenarios === 3 && /BLS/.test(detail.source ?? ''), JSON.stringify({ ...detail, source: undefined }));
await page.screenshot({ path: `${OUT}/189-live-macro-detail.png`, fullPage: true });

// 지정가 알림 추가 → 저장
await page.selectOption('[data-alert-symbol]', 'BTCUSDT');
await page.selectOption('[data-alert-kind]', 'price_above');
await page.locator('[data-alert-value]').fill('90000');
await page.locator('[data-alert-add]').click();
await page.waitForTimeout(400);
const added = await page.evaluate(() => ({
  rows: document.querySelectorAll('[data-alert-row]').length,
  stored: JSON.parse(localStorage.getItem('cota.alerts.v1') ?? '[]'),
  text: document.querySelector('[data-alert-active-list]')?.textContent ?? '',
}));
check('라이브 지정가 알림 추가', added.rows >= 1 && added.stored.some((a) => a.symbol === 'BTCUSDT' && a.value === 90000), added.text.replace(/\s+/g, ' ').slice(0, 50));
await page.screenshot({ path: `${OUT}/190-live-alert-custom.png` });

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
await page.locator('.bottom-nav button[data-tab="menu"]').click();
await page.waitForTimeout(400);
const badge = await page.evaluate(() => document.querySelector('[data-alert-menu-badge]')?.textContent?.trim());
check('새로고침 뒤 메뉴 배지에 감시 건수', /감시/.test(badge ?? ''), badge);
await page.screenshot({ path: `${OUT}/191-live-alert-badge.png` });

const realErrors = consoleErrors.filter((e) => !/Failed to load resource|net::ERR|429|500 \(Internal Server Error\)/.test(e));
check('라이브 콘솔/페이지 에러 0', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: realErrors.slice(0, 2), pageErrors: pageErrors.slice(0, 2) }));

await context.close();
await browser.close();

writeFileSync('.tmp/live-alerts-report.json', JSON.stringify({ hub, center, checks }, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${failed.length ? '❌' : '✅'} 라이브 알림·메뉴 검증: ${checks.length - failed.length}/${checks.length} 통과${failed.length ? ` · 실패: ${failed.map((f) => f.name).join(' / ')}` : ''}`);
if (failed.length) process.exitCode = 1;
