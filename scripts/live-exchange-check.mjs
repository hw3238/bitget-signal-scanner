/**
 * 🏦 라이브 거래소 선택·전환 검증 — 배포본(https://hw3238.github.io/bitget-signal-scanner/)
 *
 *  실행: node scripts/live-exchange-check.mjs   (gh-pages 배포 후)
 *
 *  1) 처음 방문 = 거래소 선택 화면 + 공식 로고 2개
 *  2) Binance 선택 → 바이낸스 마켓 시그널 실제 탐지 · 출처 배지 · 주식선물 필터 없음
 *  3) 헤더 칩 → Bitget 전환 → 비트겟 마켓 시그널 실제 탐지 · 주식선물 필터 복귀
 *  4) 새로고침해도 선택 유지 · 콘솔 에러 0(451 폴백 제외)
 */
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';
const BINANCE_SPOT = 'https://data-api.binance.vision';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function binanceSymbols() {
  try {
    const res = await fetch(`${BINANCE_SPOT}/api/v3/ticker/24hr`);
    if (!res.ok) return new Set();
    const rows = await res.json();
    return new Set(rows.filter((r) => r.symbol.endsWith('USDT')).map((r) => r.symbol));
  } catch {
    return new Set();
  }
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

const waitScanner = async (timeout = 240000) => {
  await page.waitForSelector('.scanner-tab', { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.scanner-tab .rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout },
  );
  await page.waitForTimeout(900);
};
const readScanner = () =>
  page.evaluate(() => ({
    gate: !!document.querySelector('[data-exchange-gate]'),
    chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value') ?? null,
    chipLogo: (() => {
      const img = document.querySelector('[data-exchange-chip-logo]');
      return !!img && img.complete && img.naturalWidth > 0;
    })(),
    source: (document.querySelector('[data-scan-source]')?.textContent ?? '').trim(),
    summary: (document.querySelector('.scanner-tab .summary-sub')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    assets: [...document.querySelectorAll('[data-asset-filter] button')].map((b) => (b.textContent ?? '').trim()),
    cards: [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')].length,
    symbols: [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')]
      .map((c) => (c.textContent ?? '').match(/\b[A-Z0-9]{3,}USDT\b/)?.[0])
      .filter(Boolean),
    prices: [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')]
      .map((c) => ({
        symbol: (c.textContent ?? '').match(/\b[A-Z0-9]{3,}USDT\b/)?.[0],
        price: (c.querySelector('.price')?.textContent ?? '').trim(),
      }))
      .filter((x) => x.symbol),
    stored: localStorage.getItem('cota.exchange.v1'),
  }));

const binance = await binanceSymbols();

const res = await page.goto(URL, { waitUntil: 'domcontentloaded' });
check(res?.status() === 200, '라이브 페이지 응답', `HTTP ${res?.status()}`);

/* ---------- 1) 첫 방문 = 거래소 선택 ---------- */
const gateSeen = await page
  .waitForSelector('[data-exchange-gate]', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
const gate = await page.evaluate(() => {
  const root = document.querySelector('[data-exchange-gate]');
  const options = [...document.querySelectorAll('[data-exchange-option]')];
  return {
    heading: (root?.querySelector('h1')?.textContent ?? '').trim(),
    options: options.map((o) => o.getAttribute('data-exchange-option')),
    logos: options.map((o) => {
      const img = o.querySelector('img');
      return { src: img?.getAttribute('src'), ok: !!img && img.complete && img.naturalWidth > 0 };
    }),
    scanner: !!document.querySelector('.scanner-tab'),
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
  };
});
check(gateSeen && !gate.scanner, '라이브 첫 방문 = 거래소 선택 화면', `heading="${gate.heading}"`);
check(gate.options.join(',') === 'binance,bitget', '선택 카드 = Binance · Bitget', gate.options.join(','));
check(
  gate.logos.every((l) => l.ok) &&
    gate.logos.some((l) => /exchanges\/binance\.svg/.test(l.src ?? '')) &&
    gate.logos.some((l) => /exchanges\/bitget\.svg/.test(l.src ?? '')),
  '라이브 로고 2개 로드(내장 svg)',
  JSON.stringify(gate.logos),
);
check(gate.scripts.some((s) => /index-.*\.js/.test(s ?? '')), '새 빌드 자산 로드', gate.scripts.join(','));
await page.screenshot({ path: `${OUT}/114-live-exchange-gate.png` });

/* ---------- 2) Binance → 실제 탐지 ---------- */
await page.locator('[data-exchange-option="binance"]').click();
await waitScanner();
const b = await readScanner();
check(b.stored === 'binance', '라이브 Binance 선택 → 저장', String(b.stored));
check(b.chip === 'binance' && b.chipLogo, '라이브 헤더 칩 = 바이낸스 + 로고');
check(/바이낸스 USDT 마켓/.test(b.summary), '라이브 요약 = 바이낸스 USDT 마켓', b.summary);
check(/^바이낸스 (선물|현물 데이터)$/.test(b.source), '라이브 출처 배지 = 바이낸스 선물/현물', b.source);
check(!b.assets.includes('주식선물') && b.assets.includes('코인'), '라이브 바이낸스: 주식선물 필터 없음', b.assets.join(','));
check(b.cards > 0, '라이브 바이낸스 코인 시그널 탐지', `${b.cards}건 · ${b.symbols.slice(0, 5).join(',')}`);
check(
  b.cards > 0 && b.symbols.every((s) => binance.size === 0 || binance.has(s)),
  '라이브 바이낸스 시그널이 전부 바이낸스 USDT 마켓',
  b.symbols.slice(0, 6).join(','),
);
const livePrices = new Map();
for (const { symbol } of b.prices) {
  try {
    const r = await fetch(`${BINANCE_SPOT}/api/v3/ticker/24hr?symbol=${symbol}`);
    if (r.ok) livePrices.set(symbol, Number((await r.json()).lastPrice));
  } catch {
    /* 비교 표본에서 제외 */
  }
}
const priceRows = b.prices
  .filter((p) => livePrices.has(p.symbol))
  .map((p) => ({ ...p, live: livePrices.get(p.symbol) }));
check(
  priceRows.length === 0 ||
    priceRows.every((p) => Math.abs(Number(String(p.price).replace(/[^0-9.-]/g, '')) / p.live - 1) * 100 <= 2),
  '라이브 카드 가격 = 바이낸스 실시간 티커(±2%)',
  priceRows.map((p) => `${p.symbol} ${p.price} vs ${p.live}`).join(' | ').slice(0, 180) || '비교 표본 없음',
);
await page.screenshot({ path: `${OUT}/115-live-binance-signals.png` });

/* ---------- 3) Bitget 전환 → 실제 탐지 ---------- */
await page.locator('[data-exchange-chip]').click();
await page.waitForSelector('[data-exchange-sheet]', { timeout: 15000 });
await page.screenshot({ path: `${OUT}/116-live-switch-sheet.png` });
await page.locator('.exchange-sheet [data-exchange-option="bitget"]').click();
await waitScanner();
const g = await readScanner();
check(g.stored === 'bitget', '라이브 Bitget 전환 → 저장', String(g.stored));
check(g.source === '비트겟 선물', '라이브 출처 배지 = 비트겟 선물', g.source);
check(g.assets.includes('주식선물'), '라이브 비트겟: 주식선물 필터 복귀', g.assets.join(','));
check(g.cards > 0, '라이브 비트겟 코인 시그널 탐지', `${g.cards}건 · ${g.symbols.slice(0, 5).join(',')}`);
await page.screenshot({ path: `${OUT}/117-live-bitget-signals.png` });

/* ---------- 4) 새로고침 유지 ---------- */
await page.reload({ waitUntil: 'domcontentloaded' });
const after = await page.evaluate(() => ({
  gate: !!document.querySelector('[data-exchange-gate]'),
  chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
}));
check(!after.gate && after.chip === 'bitget', '라이브 새로고침 후 선택 유지(선택 화면 없음)', JSON.stringify(after));

const expected = (line) => /451|fapi\.binance\.com|Failed to load resource/.test(line);
const realConsole = consoleErrors.filter((e) => !expected(e));
check(realConsole.length === 0, '라이브 콘솔 에러 0건(451 폴백 제외)', JSON.stringify(realConsole.slice(0, 3)));
check(pageErrors.length === 0, '라이브 페이지 에러 0건', JSON.stringify(pageErrors.slice(0, 2)));

await context.close();
await browser.close();

console.log(`\n${failures === 0 ? '✅ 라이브 거래소 선택·전환 검증 통과' : `❌ 실패 ${failures}건`}`);
if (failures) process.exitCode = 1;
