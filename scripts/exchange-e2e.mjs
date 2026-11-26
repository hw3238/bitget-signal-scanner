/**
 * 🏦 거래소 선택 · 전환 E2E 검증 (실행: npm run build && npm run check:exchange-e2e)
 *
 *  1) 첫 방문 = 거래소 선택 화면 · 로고 2개 실제 로드 · 헤더/스캐너 없음
 *  2) Binance 선택 → 저장 · 칩/배지 표시 · 바이낸스 마켓만 스캔(주식선물 필터 없음)
 *  3) 카드 가격 = 바이낸스 실시간 티커(교차검증) · 비트겟 전용 심볼 없음
 *  4) 새로고침해도 선택 화면이 다시 나오지 않는다(저장)
 *  5) 헤더 칩 → Bitget 전환 → 이전 시그널 비우고 비트겟 마켓만 다시 스캔
 *  6) 메뉴 급등 탐색기 = 현재 거래소 유니버스 · 바이낸스 모드에는 원클릭 주문 없음
 *  7) 자동매매 화면 = 비트겟 전용 안내 + `Bitget으로 전환` 동작
 *  8) 설정 탭 거래소 카드(로고·사용 중 표시·전환) · 시그널 이력 분리 저장 · 콘솔 에러 0
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4179;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const BG = 'https://api.bitget.com';
const BINANCE_SPOT = 'https://data-api.binance.vision';

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
  stdio: ['ignore', 'ignore', 'ignore'],
  env: {
    ...process.env,
    PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}`,
  },
  detached: true,
});

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const num = (t) => Number(String(t ?? '').replace(/[^0-9.-]/g, ''));
const close = (a, b, tolPct) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a / b - 1) * 100 <= tolPct;

async function binanceSymbols() {
  try {
    const res = await fetch(`${BINANCE_SPOT}/api/v3/ticker/24hr`);
    if (!res.ok) return { symbols: new Set(), tickers: new Map() };
    const rows = await res.json();
    const usdt = rows.filter((r) => r.symbol.endsWith('USDT'));
    return {
      symbols: new Set(usdt.map((r) => r.symbol)),
      tickers: new Map(usdt.map((r) => [r.symbol, r])),
    };
  } catch {
    return { symbols: new Set(), tickers: new Map() };
  }
}

async function bitgetSymbols() {
  try {
    const res = await fetch(`${BG}/api/v2/mix/market/contracts?productType=USDT-FUTURES`);
    const body = await res.json();
    if (body.code !== '00000') return new Set();
    return new Set(body.data.filter((c) => c.symbolStatus === 'normal').map((c) => String(c.symbol)));
  } catch {
    return new Set();
  }
}

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await context.addInitScript(seedAuthSession);
  await installE2EStubs(context);

  // 거래소 선택값은 **일부러 비워 둔다** — 첫 방문 시나리오.
  await context.addInitScript(() => {
    if (!localStorage.getItem('bgss.settings.v1')) {
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    }
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  const shot = async (name, full = false) => {
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  };
  const waitScanner = async (timeout = 240000) => {
    await page.waitForSelector('.scanner-tab', { timeout: 60000 });
    await page.waitForFunction(
      () => {
        const b = document.querySelector('.scanner-tab .rescan');
        return !!b && !b.classList.contains('busy');
      },
      { timeout },
    );
    await page.waitForTimeout(600);
  };
  /** 시장에 '진행중' 코인 시그널이 없을 때도 카드 검증이 가능하도록 종료 포함 → 자산 전체로 넓힌다. */
  const ensureCards = async () => {
    let count = await page.locator('.scanner-tab .signal-card:not(.skeleton)').count();
    if (count > 0) return count;
    const toggle = page.locator('.scanner-tab .ghost-toggle').first();
    if (((await toggle.textContent()) ?? '').includes('진행중만')) {
      await toggle.click();
      await page.waitForTimeout(800);
      count = await page.locator('.scanner-tab .signal-card:not(.skeleton)').count();
    }
    if (count > 0) return count;
    const all = page.locator('.scanner-tab [data-asset-filter] button[data-asset="all"]');
    if (await all.count()) {
      await all.first().click();
      await page.waitForTimeout(800);
      count = await page.locator('.scanner-tab .signal-card:not(.skeleton)').count();
    }
    return count;
  };
  const chip = () => page.evaluate(() => {
    const el = document.querySelector('[data-exchange-chip]');
    const img = document.querySelector('[data-exchange-chip-logo]');
    return {
      value: el?.getAttribute('data-exchange-value') ?? null,
      text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      logoLoaded: !!img && img.complete && img.naturalWidth > 0,
      src: img?.getAttribute('src') ?? null,
    };
  });
  const source = () => page.evaluate(() => (document.querySelector('[data-scan-source]')?.textContent ?? '').trim());

  const binance = await binanceSymbols();
  const bitget = await bitgetSymbols();

  /* ---------- 1) 첫 방문 — 거래소 선택 화면 ---------- */
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const gateSeen = await page
    .waitForSelector('[data-exchange-gate]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const gate = await page.evaluate(() => {
    const root = document.querySelector('[data-exchange-gate]');
    const options = [...document.querySelectorAll('[data-exchange-option]')];
    return {
      heading: (root?.querySelector('h1')?.textContent ?? '').trim(),
      options: options.map((o) => o.getAttribute('data-exchange-option')),
      titles: options.map((o) => (o.querySelector('b')?.textContent ?? '').replace(/\s+/g, ' ').trim()),
      descs: options.map((o) => (o.querySelector('.exchange-option-copy span')?.textContent ?? '').trim()),
      logos: options.map((o) => {
        const img = o.querySelector('img');
        return { src: img?.getAttribute('src'), ok: !!img && img.complete && img.naturalWidth > 0 };
      }),
      header: !!document.querySelector('.app-bar'),
      scanner: !!document.querySelector('.scanner-tab'),
      stored: localStorage.getItem('cota.exchange.v1'),
    };
  });
  check('첫 방문 = 거래소 선택 화면', gateSeen && !gate.scanner, `heading="${gate.heading}"`);
  check('선택 화면에 스캐너·헤더가 먼저 나오지 않는다', !gate.header && !gate.scanner);
  check('선택 카드 = Binance · Bitget 순서', gate.options.join(',') === 'binance,bitget', gate.options.join(','));
  check(
    '카드 제목에 영문+한글 이름',
    /Binance/.test(gate.titles[0]) && /바이낸스/.test(gate.titles[0]) && /Bitget/.test(gate.titles[1]) && /비트겟/.test(gate.titles[1]),
    gate.titles.join(' / '),
  );
  check(
    '카드 설명 문구',
    /바이낸스 USDT 마켓/.test(gate.descs[0]) && /비트겟 USDT-M 선물/.test(gate.descs[1]),
    gate.descs.join(' / '),
  );
  check(
    '두 거래소 로고 실제 로드(내장 svg)',
    gate.logos.every((l) => l.ok) && gate.logos[0].src?.includes('exchanges/binance.svg') && gate.logos[1].src?.includes('exchanges/bitget.svg'),
    JSON.stringify(gate.logos.map((l) => `${l.src}:${l.ok}`)),
  );
  check('선택 전에는 저장값 없음', gate.stored === null);
  await shot('105-exchange-gate');

  /* ---------- 2) Binance 선택 ---------- */
  await page.locator('[data-exchange-option="binance"]').click();
  await waitScanner();
  const afterPick = await page.evaluate(() => ({
    stored: localStorage.getItem('cota.exchange.v1'),
    chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
    summary: (document.querySelector('.scanner-tab .summary-sub')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    assets: [...document.querySelectorAll('[data-asset-filter] button')].map((b) => (b.textContent ?? '').trim()),
    source: (document.querySelector('[data-scan-source]')?.textContent ?? '').trim(),
    cards: [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')].map((c) => ({
      symbol: c.querySelector('[data-symbol]')?.getAttribute('data-symbol') ?? c.getAttribute('data-symbol'),
      text: (c.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
    })),
    quick: document.querySelectorAll('[data-quick-order]').length,
    brand: (document.querySelector('.brand-text span')?.textContent ?? '').trim(),
  }));
  check('Binance 선택 → localStorage 저장', afterPick.stored === 'binance', String(afterPick.stored));
  check('헤더 칩 = 바이낸스 + 로고', (await chip()).value === 'binance' && (await chip()).logoLoaded, JSON.stringify(await chip()));
  check('요약 줄 = 바이낸스 USDT 마켓', /바이낸스 USDT 마켓/.test(afterPick.summary), afterPick.summary);
  check(
    '데이터 출처 배지가 실제 소스(바이낸스 선물/현물)',
    /^바이낸스 (선물|현물 데이터)$/.test(afterPick.source),
    afterPick.source,
  );
  check('바이낸스 모드: 주식선물 필터 없음', !afterPick.assets.includes('주식선물') && afterPick.assets.includes('코인'), afterPick.assets.join(','));
  check('바이낸스 모드: 원클릭 주문 버튼 없음', afterPick.quick === 0, `${afterPick.quick}건`);
  const cardSymbols = afterPick.cards
    .map((c) => (c.symbol ? c.symbol : (c.text.match(/\b[A-Z0-9]{3,}USDT\b/) ?? [])[0]))
    .filter(Boolean);
  check(
    '바이낸스 모드: 카드 종목이 전부 바이낸스 USDT 마켓',
    cardSymbols.length > 0 && cardSymbols.every((s) => binance.symbols.size === 0 || binance.symbols.has(s)),
    `${cardSymbols.length}건 · ${cardSymbols.slice(0, 6).join(',')}`,
  );
  check(
    '바이낸스 모드: 비트겟 전용 주식선물(STOCK) 카드 없음',
    !afterPick.cards.some((c) => /STOCK|주식선물/.test(c.text)),
  );
  // 실시간 교차검증 — 카드 가격 = 바이낸스 24h 티커 lastPrice
  const priced = await page.evaluate(() =>
    [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')]
      .map((c) => {
        const sym = (c.textContent ?? '').match(/\b[A-Z0-9]{3,}USDT\b/);
        const price = (c.querySelector('.price')?.textContent ?? '').trim();
        return sym ? { symbol: sym[0], price } : null;
      })
      .filter(Boolean),
  );
  const comparable = priced.filter((p) => binance.tickers.get(p.symbol));
  check(
    '바이낸스 카드 가격 = 바이낸스 실시간 티커(±2%)',
    comparable.length > 0 && comparable.every((p) => close(num(p.price), Number(binance.tickers.get(p.symbol).lastPrice), 2)),
    comparable.map((p) => `${p.symbol} ${p.price} vs ${binance.tickers.get(p.symbol).lastPrice}`).join(' | ').slice(0, 200) ||
      '비교 표본 없음',
  );
  await shot('106-exchange-binance-scanner');

  /* ---------- 3) 새로고침 = 선택 화면 없이 바로 스캐너 ---------- */
  await page.reload({ waitUntil: 'domcontentloaded' });
  // 🔐 게이트(v1.5.8) — 저장된 세션 복원이 끝나야 앱이 그려진다(부팅 화면 → 앱).
  await page.waitForSelector('[data-exchange-chip]', { timeout: 60000 });
  const afterReload = await page.evaluate(() => ({
    gate: !!document.querySelector('[data-exchange-gate]'),
    chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
  }));
  check('새로고침 후에도 선택 화면 없이 스캐너', !afterReload.gate && afterReload.chip === 'binance', JSON.stringify(afterReload));
  await waitScanner();

  /* ---------- 4) 헤더 칩 → Bitget 전환 ---------- */
  await page.locator('[data-exchange-chip]').click();
  await page.waitForSelector('[data-exchange-sheet]', { timeout: 8000 });
  const sheet = await page.evaluate(() => ({
    note: (document.querySelector('.exchange-sheet-note')?.textContent ?? '').trim(),
    current: document.querySelector('[data-exchange-current]')?.closest('[data-exchange-option]')?.getAttribute('data-exchange-option'),
    logos: [...document.querySelectorAll('.exchange-sheet [data-exchange-option] img')].map((i) => i.complete && i.naturalWidth > 0),
  }));
  check('전환 시트: 현재 거래소 표시(바이낸스)', sheet.current === 'binance', String(sheet.current));
  check('전환 시트: 로고 2개 로드', sheet.logos.length === 2 && sheet.logos.every(Boolean));
  check('전환 시트: 재스캔 안내', /다시 스캔/.test(sheet.note), sheet.note);
  await shot('107-exchange-switch-sheet');

  await page.locator('.exchange-sheet [data-exchange-option="bitget"]').click();
  // 전환 직후 — 이전 거래소 시그널이 즉시 비워지는지(새 스캔 첫 카드가 뜨기 전) 확인
  const early = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')];
    return {
      count: cards.length,
      symbols: cards.map((c) => (c.textContent ?? '').match(/\b[A-Z0-9]{3,}USDT\b/)?.[0]).filter(Boolean),
      chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
    };
  });
  check(
    '전환 직후 이전 거래소 시그널 목록 비움',
    early.count === 0 || early.symbols.every((s) => bitget.size === 0 || bitget.has(s)),
    `${early.count}건 · ${early.symbols.slice(0, 5).join(',')}`,
  );
  await waitScanner();
  await ensureCards();
  const afterSwitch = await page.evaluate(() => ({
    stored: localStorage.getItem('cota.exchange.v1'),
    chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
    source: (document.querySelector('[data-scan-source]')?.textContent ?? '').trim(),
    summary: (document.querySelector('.scanner-tab .summary-sub')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    assets: [...document.querySelectorAll('[data-asset-filter] button')].map((b) => (b.textContent ?? '').trim()),
    cards: [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')].map((c) => {
      const sym = (c.textContent ?? '').match(/\b[A-Z0-9]{3,}USDT\b/);
      return sym ? sym[0] : null;
    }).filter(Boolean),
    historyKeys: Object.keys(localStorage).filter((k) => k.startsWith('bgss.history.v1')),
    snapshot: JSON.parse(localStorage.getItem('cota.scan.snapshot.v2') ?? 'null')?.exchange ?? null,
  }));
  check('Bitget 전환 → 저장값 변경', afterSwitch.stored === 'bitget', String(afterSwitch.stored));
  check('Bitget 전환 → 칩·요약 줄 변경', afterSwitch.chip === 'bitget' && /비트겟 USDT-M 선물/.test(afterSwitch.summary), afterSwitch.summary);
  check('Bitget 전환 → 출처 배지 = 비트겟 선물', afterSwitch.source === '비트겟 선물', afterSwitch.source);
  check('Bitget 모드: 주식선물 필터 복귀', afterSwitch.assets.includes('주식선물'), afterSwitch.assets.join(','));
  check(
    'Bitget 전환 → 카드가 전부 비트겟 마켓(이전 바이낸스 목록 비움)',
    afterSwitch.cards.length > 0 && afterSwitch.cards.every((s) => bitget.size === 0 || bitget.has(s)),
    `${afterSwitch.cards.length}건 · ${afterSwitch.cards.slice(0, 6).join(',')}`,
  );
  check('스냅숏 거래소 = bitget', afterSwitch.snapshot === 'bitget', String(afterSwitch.snapshot));
  check(
    '시그널 이력은 거래소별로 따로 저장',
    afterSwitch.historyKeys.includes('bgss.history.v1.binance') && afterSwitch.historyKeys.includes('bgss.history.v1'),
    afterSwitch.historyKeys.join(','),
  );
  await shot('108-exchange-bitget-scanner');

  /* ---------- 5) 급등 탐색기 = 현재 거래소 ---------- */
  const openSurge = async () => {
    await page.locator('.bottom-nav button[data-tab="menu"]').click();
    await page.waitForTimeout(500);
    await page.locator('.menu-row[data-menu="surge"]').click();
    await page.waitForSelector('.surge-card, [data-surge-empty-filter], .notice', { timeout: 240000 });
    await page.waitForFunction(() => !document.querySelector('[data-surge-progress]'), { timeout: 240000 });
    await page.waitForTimeout(500);
    return page.evaluate(() => ({
      sub: (document.querySelector('[data-surge-sub]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      cards: document.querySelectorAll('.surge-card').length,
      symbols: [...document.querySelectorAll('.surge-card')].map((c) => c.getAttribute('data-symbol')),
      orderBtns: document.querySelectorAll('[data-order]').length,
      orderHint: (document.querySelector('[data-order-hint]')?.textContent ?? '').trim(),
      note: (document.querySelector('.surge-tab .feed-note')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    }));
  };
  const surgeBitget = await openSurge();
  check('급등 탐색기(비트겟): 유니버스 문구 = 비트겟 코인 선물', /비트겟 코인 선물/.test(surgeBitget.sub), surgeBitget.sub);
  check(
    '급등 탐색기(비트겟): 후보가 비트겟 마켓',
    surgeBitget.cards > 0 && surgeBitget.symbols.every((s) => bitget.size === 0 || bitget.has(s)),
    `${surgeBitget.cards}건`,
  );
  check('급등 탐색기(비트겟): 각주도 비트겟 기준', /비트겟 코인 선물/.test(surgeBitget.note), surgeBitget.note);

  // 바이낸스로 전환하면 열려 있는 탐색기도 새 마켓만 보여준다.
  await page.locator('[data-exchange-chip]').click();
  await page.waitForSelector('[data-exchange-sheet]', { timeout: 8000 });
  await page.locator('.exchange-sheet [data-exchange-option="binance"]').click();
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => !document.querySelector('[data-surge-progress]'), { timeout: 240000 });
  await page.waitForTimeout(800);
  const surgeBinance = await page.evaluate(() => ({
    sub: (document.querySelector('[data-surge-sub]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cards: document.querySelectorAll('.surge-card').length,
    symbols: [...document.querySelectorAll('.surge-card')].map((c) => c.getAttribute('data-symbol')),
    orderBtns: document.querySelectorAll('[data-order]').length,
    orderHint: (document.querySelector('[data-order-hint]')?.textContent ?? '').trim(),
    note: (document.querySelector('.surge-tab .feed-note')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
  }));
  check('급등 탐색기(바이낸스): 유니버스 문구 전환', /바이낸스 USDT 마켓/.test(surgeBinance.sub), surgeBinance.sub);
  check(
    '급등 탐색기(바이낸스): 후보 전부 바이낸스 마켓',
    surgeBinance.symbols.length > 0 && surgeBinance.symbols.every((s) => binance.symbols.size === 0 || binance.symbols.has(s)),
    `${surgeBinance.cards}건 · ${surgeBinance.symbols.slice(0, 5).join(',')}`,
  );
  check('급등 탐색기(바이낸스): 원클릭 주문 없음 + 비트겟 전용 안내', surgeBinance.orderBtns === 0 && /비트겟 계좌 전용/.test(surgeBinance.orderHint), surgeBinance.orderHint);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('109-exchange-binance-surge');
  await page.locator('.menu-back').click();
  await page.waitForTimeout(400);

  /* ---------- 6) 자동매매 = 비트겟 전용 안내 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-row[data-menu="auto"], .menu-auto').first().click();
  await page.waitForSelector('[data-auto-root]', { timeout: 15000 });
  const auto = await page.evaluate(() => ({
    notice: !!document.querySelector('[data-auto-bitget-only]'),
    text: (document.querySelector('[data-auto-bitget-only]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    title: (document.querySelector('.subview-nav b')?.textContent ?? '').trim(),
    btn: (document.querySelector('[data-switch-bitget]')?.textContent ?? '').trim(),
  }));
  check('바이낸스 모드 자동매매: 비트겟 전용 안내', auto.notice && /Bitget 계좌 전용/.test(auto.text), auto.text.slice(0, 80));
  check('자동매매 화면 제목에 비트겟 전용 표시', /비트겟 전용/.test(auto.title), auto.title);
  check('`Bitget으로 전환` 버튼', auto.btn === 'Bitget으로 전환', auto.btn);
  await shot('110-exchange-autotrade-notice');
  await page.locator('[data-switch-bitget]').click();
  await page.waitForTimeout(900);
  const afterSwitchBtn = await page.evaluate(() => ({
    chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
    notice: !!document.querySelector('[data-auto-bitget-only]'),
  }));
  check('`Bitget으로 전환` 즉시 동작', afterSwitchBtn.chip === 'bitget' && !afterSwitchBtn.notice, JSON.stringify(afterSwitchBtn));

  /* ---------- 7) 설정 탭 거래소 카드 ---------- */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('[data-settings-exchange]', { timeout: 15000 });
  const settings = await page.evaluate(() => ({
    options: [...document.querySelectorAll('[data-settings-exchange-option]')].map((o) => o.getAttribute('data-settings-exchange-option')),
    current: document.querySelector('[data-settings-exchange-current]')?.closest('[data-settings-exchange-option]')?.getAttribute('data-settings-exchange-option'),
    logos: [...document.querySelectorAll('[data-settings-exchange] img')].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
    note: (document.querySelector('#settings-exchange .setting-desc')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
  check('설정 탭: 거래소 카드 2개(바이낸스·비트겟)', settings.options.join(',') === 'binance,bitget', settings.options.join(','));
  check('설정 탭: 현재 거래소 = 비트겟 표시', settings.current === 'bitget', String(settings.current));
  check('설정 탭: 로고 2개 로드', settings.logos.length === 2 && settings.logos.every((l) => l.ok), JSON.stringify(settings.logos));
  check('설정 탭: 전환 시 재스캔 안내', /다시 스캔/.test(settings.note), settings.note);
  await page.evaluate(() => document.querySelector('#settings-exchange')?.scrollIntoView({ block: 'center' }));
  await shot('111-exchange-settings-card');

  await page.locator('[data-settings-exchange-option="binance"]').click();
  await page.waitForTimeout(1200);
  const settingsSwitched = await page.evaluate(() => ({
    chip: document.querySelector('[data-exchange-chip]')?.getAttribute('data-exchange-value'),
    current: document.querySelector('[data-settings-exchange-current]')?.closest('[data-settings-exchange-option]')?.getAttribute('data-settings-exchange-option'),
  }));
  check('설정 탭에서 바이낸스로 전환', settingsSwitched.chip === 'binance' && settingsSwitched.current === 'binance', JSON.stringify(settingsSwitched));
  // 마무리: 비트겟으로 되돌려 다음 검증(live-check)과 같은 기본 상태로 둔다.
  await page.locator('[data-settings-exchange-option="bitget"]').click();
  await page.waitForTimeout(600);

  /* ---------- 8) 데스크톱 선택 화면 ---------- */
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  // 🔐 회원 전용 게이트(v1.5.8) — 데스크톱 시나리오도 로그인된 상태에서 시작한다.
  await desktop.addInitScript(seedAuthSession);
  await installE2EStubs(desktop);

  const dpage = await desktop.newPage();
  dpage.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[desktop] ${m.text()}`);
  });
  dpage.on('pageerror', (e) => pageErrors.push(`[desktop] ${e}`));
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await dpage.waitForSelector('[data-exchange-gate]', { timeout: 20000 });
  await dpage.screenshot({ path: `${OUT}/112-exchange-gate-desktop.png` });
  await dpage.locator('[data-exchange-option="binance"]').click();
  await dpage.waitForSelector('.scanner-tab', { timeout: 30000 });
  await dpage.waitForTimeout(1500);
  await dpage.screenshot({ path: `${OUT}/113-exchange-binance-desktop.png` });
  await desktop.close();

  /* ---------- 콘솔 정리 ---------- */
  // fapi.binance.com 은 해외 IP 에서 451(지역 제한) → 현물 폴백이 정상 동작하는 설계된 경로다.
  const expected = (line) => /451|fapi\.binance\.com|Failed to load resource/.test(line);
  const realConsole = consoleErrors.filter((e) => !expected(e));
  const realFailed = failedRequests.filter((r) => !/451|fapi\.binance\.com/.test(r));
  check('콘솔 에러 0건(451 폴백 제외)', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 3)));
  check('페이지 에러 0건', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 2)));
  check('예상 밖 실패 요청 0건(451 제외)', realFailed.length === 0, realFailed.slice(0, 5).join(' | '));

  await context.close();
  await browser.close();

  const report = {
    gate,
    afterPick: { ...afterPick, cards: afterPick.cards.length },
    afterSwitch: { ...afterSwitch },
    surgeBitget,
    surgeBinance,
    auto,
    settings,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(0, 20),
    checks,
    allOk: checks.every((c) => c.ok),
  };
  writeFileSync('.tmp/exchange-report.json', JSON.stringify(report, null, 1));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${report.allOk ? '✅ 거래소 선택·전환 E2E 통과' : `❌ 실패 ${failed.length}건`} (${checks.length}개 확인)`);
  if (!report.allOk) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('EXCHANGE E2E FAILED', e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
