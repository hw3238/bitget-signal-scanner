/**
 * 🤖 비트겟 자동매매 E2E — Capacitor 네이티브 브리지를 모킹해 확인한다.
 *
 *  1) 메뉴 허브 최상단 카드 · 상태 배지(꺼짐 / 모의투자 / 실거래)
 *  2) API 키 저장 → 연결 테스트 → 잔고 표시 (Secret 원문은 화면에 없음)
 *  3) 자동매매 ON → 서비스 start(config·plans 전달) → 배지 '모의투자 가동 중'
 *  4) 네이티브 체결·차단 이벤트가 로그로 흘러 들어오는지
 *  5) 1일 손실 한도 도달 → 자동 잠금 · 즉시 중지 버튼
 *  6) 시그널 카드 ⚡ 원클릭 주문 → 네이티브 order(TP/SL·수량) 호출
 *  7) 브라우저(네이티브 없음) → 모의 시뮬레이션 · 키 저장 불가 안내
 *
 * 실행: npm run build && node scripts/autotrade-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

const PORT = 4186;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
/** 검증 결과 — (조건, 이름, 상세) 순서 */
const check = (ok, name, detail) => {
  checks.push({ name, ok: !!ok, detail: detail ?? '' });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** 앱이 복원하는 스캔 스냅숏 — 실 API 없이도 '진행 중 시그널 카드'를 결정적으로 만든다. */
function snapshotScript() {
  const now = Date.now();
  const signal = {
    id: 'BTCUSDT|1H|long|' + now,
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    tf: '4H',
    side: 'long',
    strategyId: 'sweep-ob',
    strategyName: '유동성 스윕 + 오더블록 리테스트',
    strategyShort: '스윕·OB',
    star: 5,
    entry: 61000,
    stop: 57950,
    target: 67000,
    eq: 60000,
    rr: 2,
    remainingRR: 2,
    currentR: 0,
    price: 61100,
    changePct: 0.1,
    progress: 0.3,
    state: 'open',
    detectedAt: now - 5 * 60_000,
    barsSince: 1,
    winRate: 62,
    strategyRR: 2,
    leverage: 10,
    levRoi: 1,
    candles: [],
    detectedIdx: 0,
    tags: ['유동성 스윕', 'OB 리테스트'],
    fundingRate: 0.0001,
    quoteVolume: 3000000000,
    decimals: 1,
  };
  const contract = {
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    isRwa: false,
    decimals: 1,
    minTradeNum: 0.001,
    volumePlace: 3,
    minTradeUsdt: 5,
  };
  const stats = {
    n: 12,
    wins: 8,
    losses: 4,
    opens: 0,
    winRate: 62,
    avgWinR: 2.4,
    avgLossR: 0.9,
    rr: 2,
    expectancy: 0.95,
    totalR: 11.4,
    score: 7,
    movePct: 12,
    avgRiskPct: 1.2,
  };
  const analysis = {
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    tf: '4H',
    activeStrategyId: 'sweep-ob',
    activeWinRate: 62,
    activeRR: 2,
    activeN: 12,
    activeStats: stats,
    candidates: [{ id: 'sweep-ob', stats }],
    signals: [signal],
    replacement: null,
    candlesLoaded: 0,
    candleAt: now,
  };
  localStorage.setItem(
    'cota.scan.snapshot.v1',
    JSON.stringify({
      v: 1,
      at: now,
      contracts: [contract],
      markets: 1,
      analyses: [analysis],
      signals: [signal],
      tickers: [],
    }),
  );
  localStorage.setItem('cota.profile.v1', JSON.stringify({ seed: 5000, style: 'conservative', updatedAt: now }));
  // 10x 고정 — 50% 리스크(시드 $5,000)가 증거금 안에서 가능한 조건
  localStorage.setItem(
    'bgss.settings.v1',
    JSON.stringify({ leverageMode: 'manual', leverage: 10, minRR: 1.5, refreshSec: 60, notifyEnabled: false }),
  );
}

const NATIVE_MOCK = () => {
  // Capacitor 는 window.androidBridge 존재로 네이티브 플랫폼을 판별한다.
  window.androidBridge = { postMessage: () => {} };
  const mask = (k) => (k.length > 8 ? `${k.slice(0, 6)}••••••${k.slice(-4)}` : '••••');
  window.__auto = {
    keys: null,
    demo: true,
    running: false,
    plans: [],
    config: null,
    orders: [],
    positions: [],
    calls: [],
    nativeLog: [],
    dailyPnl: 0,
    dailyLocked: false,
  };
  const listeners = {};
  const state = () => ({
    hasKeys: !!window.__auto.keys,
    demo: window.__auto.demo,
    apiKeyMasked: window.__auto.keys ? mask(window.__auto.keys.apiKey) : '',
    passphraseSet: !!window.__auto.keys,
    savedAt: window.__auto.keys ? Date.now() : 0,
  });
  const statusOf = () => ({
    running: window.__auto.running,
    service: window.__auto.running,
    mode: window.__auto.demo ? 'demo' : 'live',
    armed: window.__auto.plans.length,
    openPositions: window.__auto.positions.length,
    equity: 1234.56,
    dailyPnl: window.__auto.dailyPnl,
    dailyLocked: window.__auto.dailyLocked,
    lastTickAt: Date.now(),
    log: window.__auto.nativeLog,
  });

  let methods = [
    'saveImage',
    'shareImage',
    'openExternal',
    'openBitgetFutures',
    'appInfo',
    'notificationPermission',
    'requestNotificationPermission',
    'notifySignal',
    'canInstallPackages',
    'openInstallPermissionSettings',
    'downloadAndInstallApk',
    'bitgetSaveKeys',
    'bitgetHasKeys',
    'bitgetClearKeys',
    'bitgetTestConnection',
    'bitgetGetPositions',
    'bitgetPlaceOrder',
    'autoTradeStart',
    'autoTradeStop',
    'autoTradeSync',
    'autoTradeStatus',
  ].map((name) => ({ name, rtype: 'promise' }));
  methods.push({ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' });
  // v1.4.0 이하 APK 흉내 — 자동매매 메서드가 아예 없다
  if (window.__oldApk) methods = methods.filter((m) => !/^(bitget|autoTrade)/.test(m.name));

  const handlers = {
    appInfo: async () => ({ versionName: '1.5.0', versionCode: 6, packageName: 'com.hw3238.bitgetscanner' }),
    notificationPermission: async () => ({ granted: true, supported: true }),
    canInstallPackages: async () => ({ allowed: true }),
    bitgetSaveKeys: async (o) => {
      window.__auto.calls.push({ method: 'bitgetSaveKeys', demo: o.demo, keyLen: (o.apiKey || '').length, secretLen: (o.secret || '').length });
      window.__auto.keys = { apiKey: o.apiKey };
      window.__auto.demo = !!o.demo;
      return state();
    },
    bitgetHasKeys: async () => state(),
    bitgetClearKeys: async () => {
      window.__auto.calls.push({ method: 'bitgetClearKeys' });
      window.__auto.keys = null;
      window.__auto.running = false;
      return { hasKeys: false, demo: window.__auto.demo };
    },
    bitgetTestConnection: async () => {
      window.__auto.calls.push({ method: 'bitgetTestConnection', demo: window.__auto.demo });
      return {
        ok: true,
        demo: window.__auto.demo,
        equity: 1234.56,
        available: 1000.5,
        unrealizedPL: 12.34,
        posMode: 'one_way_mode',
      };
    },
    bitgetGetPositions: async () => ({ ok: true, positions: window.__auto.positions }),
    bitgetPlaceOrder: async (o) => {
      window.__auto.orders.push(o);
      window.__auto.positions.push({
        symbol: o.symbol,
        holdSide: o.side === 'buy' ? 'long' : 'short',
        total: Number(o.size),
        openPriceAvg: 61100,
        markPrice: 61120,
        unrealizedPL: 2.5,
        leverage: o.leverage,
        marginSize: 100,
        liquidationPrice: 55000,
        presetStopSurplusPrice: Number(o.presetStopSurplusPrice),
        presetStopLossPrice: Number(o.presetStopLossPrice),
        ctime: Date.now(),
      });
      return { ok: true, orderId: `ord-${window.__auto.orders.length}`, clientOid: o.clientOid };
    },
    autoTradeStart: async (o) => {
      const config = JSON.parse(o.config);
      const plans = JSON.parse(o.plans);
      window.__auto.calls.push({
        method: 'autoTradeStart',
        enabled: config.enabled,
        mode: config.mode,
        plans: plans.length,
        planQty: plans[0]?.qty ?? null,
        riskPct: config.riskPct,
        maxPositions: config.maxPositions,
      });
      window.__auto.config = config;
      window.__auto.plans = plans;
      window.__auto.running = true;
      return statusOf();
    },
    autoTradeSync: async (o) => {
      const plans = JSON.parse(o.plans);
      window.__auto.plans = plans;
      return statusOf();
    },
    autoTradeStop: async () => {
      window.__auto.calls.push({ method: 'autoTradeStop' });
      window.__auto.running = false;
      return statusOf();
    },
    autoTradeStatus: async () => statusOf(),
  };

  window.Capacitor = {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
    PluginHeaders: [{ name: 'AppShell', methods }],
    nativePromise: (_plugin, method, options) => {
      const fn = handlers[method];
      if (!fn) return Promise.resolve({});
      try {
        return Promise.resolve(fn(options));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    nativeCallback: (_plugin, method, options, cb) => {
      window.__lc = window.__lc || [];
      if (method === 'addListener') {
        window.__lc.push(['add', options?.eventName, Date.now()]);
        listeners[options?.eventName] = cb;
        cb('cb-1');
        return Promise.resolve('cb-1');
      }
      if (method === 'removeListener') {
        window.__lc.push(['rm', options?.eventName, Date.now()]);
        delete listeners[options?.eventName];
        return Promise.resolve();
      }
      return Promise.resolve();
    },
  };

  window.__listenerKeys = () => Object.keys(listeners);

  /** 네이티브 서비스가 보내는 이벤트 흉내 */
  window.__emitAuto = (patch) => {
    Object.assign(window.__auto, patch);
    const cb = listeners.autoTradeEvent;
    if (cb) cb(statusOf());
  };
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function open({ native = true, blockMarket = true, oldApk = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(`(${snapshotScript.toString()})();`);
  if (native) await ctx.addInitScript(`window.__oldApk = ${oldApk ? 'true' : 'false'}; (${NATIVE_MOCK.toString()})();`);
  if (blockMarket) {
    // 실 API 호출을 끊어 복원한 스냅숏 시그널이 그대로 유지되게 한다(결정적 검증).
    await ctx.route('**://api.bitget.com/**', (route) => route.abort());
    await ctx.route('**://api.github.com/**', (route) => route.abort());
    await ctx.route('**://api.upbit.com/**', (route) => route.abort());
  }
  const page = await ctx.newPage();
  const errors = [];
  const dialogs = [];
  page.__dialogs = dialogs;
  page.on('console', (m) => {
    // 라우트를 끊어 놓은 외부 API의 리소스 실패는 앱 오류가 아니다.
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', sel);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

/* ================================================================== *
 * 1) 네이티브 — 메뉴 카드 → 키 연결 → 켜기 → 이벤트 → 잠금 → 정지
 * ================================================================== */
{
  const { ctx, page, errors } = await open();

  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(400);
  check(await page.locator('[data-menu="auto"]').count() === 1, '메뉴 허브 최상단 자동매매 카드');
  check((await text(page, '[data-auto-menu-badge]')) === '꺼짐', '기본 배지 = 꺼짐', await text(page, '[data-auto-menu-badge]'));
  check(/비트겟 자동매매/.test(await text(page, '[data-menu="auto"]')), '카드 제목 = 비트겟 자동매매');
  await page.locator('[data-menu="auto"]').screenshot({ path: `${OUT}/58-auto-menu.png` }).catch(() => {});

  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(500);
  check(await page.locator('[data-auto-root]').count() === 1, '전용 자동매매 화면 열림');
  check((await text(page, '[data-auto-badge]')) === '꺼짐', '기본 상태 = 꺼짐');
  check(await page.locator('[data-auto-mode="demo"].on').count() === 1, '기본 모드 = 모의투자');
  check((await text(page, '[data-auto-keys] .auto-tag')) === '미연결', '키 미연결 표시');
  const guide = await text(page, '.auto-guide');
  check(/출금 권한은 반드시 OFF/.test(guide) && /Secret/.test(guide), '출금 권한 OFF + 3줄 발급 가이드', guide.slice(0, 50));
  check(/1회 리스크/.test(await text(page, '[data-auto-guards]')), '안전장치 설정(1회 리스크·포지션·손실 한도) 표시');
  await page.screenshot({ path: `${OUT}/54-autotrade.png`, fullPage: true }).catch(() => {});

  // 실거래 모드 → 경고 체크 전에는 저장 버튼 비활성
  await page.locator('[data-auto-mode="live"]').click();
  await page.waitForTimeout(200);
  check(await page.locator('.auto-warn-check').count() === 1, '실거래 선택 시 위험 확인 체크박스');
  check(await page.locator('[data-auto-save]').isDisabled(), '확인 전에는 저장 버튼 비활성');
  await page.locator('[data-auto-mode="demo"]').click();
  await page.waitForTimeout(150);

  // 키 저장
  await page.fill('[data-auto-input="key"]', 'bg_livekey_9f3k2m8d7c6b5a4n3m2c7d');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(900);

  const saved = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'bitgetSaveKeys'));
  check(saved.length === 1 && saved[0].demo === true, '키 저장 → 네이티브 bitgetSaveKeys(demo=true)', JSON.stringify(saved[0] ?? {}));
  check((saved[0]?.secretLen ?? 0) >= 20, 'Secret 원문이 네이티브로 전달됨(화면에는 없음)', `len=${saved[0]?.secretLen}`);
  const keyPanel = await text(page, '[data-auto-keys]');
  check(/bg_liv••••••2c7d/.test(keyPanel), '저장 후 마스킹된 키만 표시', keyPanel.slice(0, 60));
  check(!keyPanel.includes('secretsecret'), 'Secret 원문은 화면에 없음');
  check(/모의투자 연결 · USDT \$1,235/.test(await text(page, '[data-auto-account]')), '연결 테스트 → USDT 잔고 표시', await text(page, '[data-auto-account]'));

  // 1회 리스크 50% — 사용자 요청(시드의 50%까지) · 고위험 경고
  await page.locator('[data-risk-preset="50"]').click();
  await page.waitForTimeout(300);
  const risk50 = await page.evaluate(() => ({
    warning: !!document.querySelector('[data-risk-warning]'),
    text: document.querySelector('[data-risk-warning]')?.textContent?.trim() ?? '',
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').riskPct,
    hint: document.querySelector('.auto-risk-block .num-hint')?.textContent ?? '',
  }));
  check(risk50.stored === 50 && risk50.warning, '1회 리스크 50% 프리셋 + 고위험 경고', `${risk50.stored}% · ${risk50.text}`);
  check(/50%/.test(risk50.hint) && /\$2,500/.test(risk50.hint), '50% = 시드 $5,000의 $2,500 로 계산', risk50.hint);

  // 자동매매 켜기
  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(900);
  const started = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'autoTradeStart'));
  check(started.length === 1, '자동매매 켜기 → 네이티브 서비스 start');
  check(started[0]?.enabled === true && started[0]?.mode === 'demo', 'start 설정: enabled=true · mode=demo', JSON.stringify(started[0] ?? {}));
  check(started[0]?.riskPct === 50 && started[0]?.maxPositions === 2, 'start 설정: 리스크 50% · 최대 2포지션');
  check(
    typeof started[0]?.planQty === 'number' && Math.abs(started[0].planQty - 0.819) < 0.002,
    '50% 리스크 수량 = 시드×50%÷손절거리(3,050) → 0.819 BTC (감시 목록에 전달)',
    `planQty=${started[0]?.planQty}`,
  );
  check((await text(page, '[data-auto-badge]')) === '모의투자 가동 중', '배지 = 모의투자 가동 중');
  await page.locator('[data-auto-guards]').screenshot({ path: `${OUT}/55-autotrade-guards.png` }).catch(() => {});

  // 네이티브 이벤트 — 체결 로그
  await page.evaluate(() =>
    window.__emitAuto({
      nativeLog: [
        { at: Date.now(), level: 'fill', text: '[모의] BTC 롱 0.025 주문 접수 · TP 62200 / SL 60400 · 주문 ord-77' },
        { at: Date.now() - 1000, level: 'reject', text: 'ETH 숏 거부 — 손익비 1.4R < 기준 1.5R' },
      ],
    }),
  );
  await page.waitForTimeout(500);
  const logs = await text(page, '[data-auto-logs]');
  check(/BTC 롱 0\.025 주문 접수/.test(logs), '네이티브 체결 이벤트가 로그에 표시', logs.slice(0, 80));
  check(/손익비 1\.4R < 기준 1\.5R/.test(logs), '거부 사유 로그 표시');

  // 1일 손실 한도 → 자동 잠금
  await page.evaluate(() => window.__emitAuto({ dailyPnl: -61.7, dailyLocked: true }));
  await page.waitForTimeout(800);
  const hero = await text(page, '[data-auto-hero]');
  check(/⛔ 잠김/.test(hero), '1일 손실 한도 도달 → 잠김 표시');
  check((await text(page, '[data-auto-badge]')) === '꺼짐', '한도 도달 시 자동매매 자동 정지');
  check(/1일 손실 한도 도달/.test(await text(page, '[data-auto-logs]')), '한도 도달 차단 로그');
  const stops = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'autoTradeStop').length);
  check(stops >= 1, '한도 도달 시 네이티브 서비스 stop 호출');

  // 즉시 중지 버튼
  await page.locator('[data-auto-stop]').click();
  await page.waitForTimeout(400);
  check(await page.locator('.auto-toast').count() === 1, '즉시 중지 토스트 표시');
  await page.screenshot({ path: `${OUT}/59-autotrade-full.png`, fullPage: true }).catch(() => {});
  check(errors.length === 0, '콘솔/페이지 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 2) 시그널 카드 ⚡ 원클릭 주문 (모의 → 실거래 라벨)
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  await page.waitForTimeout(800);
  // 원클릭 주문은 키가 연결돼 있어야 실제 주문 경로를 탄다 → 모의투자 키를 먼저 저장한다.
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  await page.fill('[data-auto-input="key"]', 'bg_demokey_1234567890abcdef');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"]')?.click());
  await page.waitForTimeout(500);
  const cards = await count(page, '[data-quick-order]');
  check(cards >= 1, '진행 중 시그널 카드에 ⚡ 원클릭 주문 버튼', `${cards}건`);

  await page.locator('[data-quick-order]').first().click();
  await page.waitForTimeout(800);
  const orders = await page.evaluate(() => window.__auto.orders);
  check(orders.length === 1, '클릭 → 네이티브 bitgetPlaceOrder 1건', JSON.stringify(orders[0] ?? {}).slice(0, 90));
  const o = orders[0] ?? {};
  check(o.symbol === 'BTCUSDT' && o.side === 'buy', '주문 방향: BTC 롱 → side=buy (one-way)');
  check(o.orderType === 'market', '시장가 주문');
  check(String(o.presetStopSurplusPrice) === '67000' && String(o.presetStopLossPrice) === '57950', 'TP/SL 동시 설정', `${o.presetStopSurplusPrice}/${o.presetStopLossPrice}`);
  // 수량 = 시드 5,000 × 리스크 1.5% ÷ |61000-57950| = 0.0245 → 거래소 3자리 내림 0.024
  check(Math.abs(Number(o.size) - 0.024) < 1e-9, '수량 = 시드×리스크÷손절거리 (0.024 BTC)', o.size);
  check(o.leverage >= 1 && o.leverage <= 10, '레버리지 상한 이내', `${o.leverage}x`);
  await page.locator('.signal-card [data-quick-order]').first().screenshot({ path: `${OUT}/56-auto-quick-order.png` }).catch(() => {});

  // 실거래 모드로 바꾸면 라벨·로그가 실거래로
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-auto-mode="live"]').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"], [data-tab="scanner"]')?.click());
  await page.waitForTimeout(500);
  check(/원클릭 실거래 주문/.test(await text(page, '[data-quick-order]')), '실거래 모드에서는 라벨이 실거래');
  await page.locator('[data-quick-order]').first().click();
  await page.waitForTimeout(700);
  const orders2 = await page.evaluate(() => window.__auto.orders);
  const dialogs = page.__dialogs;
  check(orders2.length === 1, '같은 시그널 재클릭은 중복 진입으로 막힘', `${orders2.length}건`);
  check(dialogs.some((m) => /이미 진입/.test(m)), '중복 진입 안내 문구', dialogs.slice(-1).join(' | '));
  check(errors.length === 0, '원클릭 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 3) 브라우저(네이티브 없음) — 모의 시뮬레이션
 * ================================================================== */
{
  const { ctx, page, errors } = await open({ native: false });
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  check(await page.locator('[data-auto-browser-note]').count() === 1, '브라우저 안내(모의 시뮬레이션) 표시');
  await page.locator('[data-auto-save], .auto-key-form button').first().click().catch(() => {});
  await page.waitForTimeout(300);
  check(/브라우저에서는 키를 저장할 수 없습니다/.test(await text(page, '[data-auto-error]')), '브라우저에서 키 저장 불가 안내');

  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(600);
  check((await text(page, '[data-auto-badge]')) === '모의투자 가동 중', '브라우저에서도 모의투자 가동 표시');
  await page.locator('[data-daily-preset="off"]').click();
  await page.waitForTimeout(300);
  const offLimit = await page.evaluate(() => ({
    metric: [...document.querySelectorAll('.auto-metric')].map((m) => m.textContent?.replace(/\s+/g, ' ').trim()),
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct,
  }));
  check(offLimit.stored === 0 && offLimit.metric.some((m) => m.includes('끔')), '1일 손실 한도 끄기(0%) 반영', JSON.stringify(offLimit.metric.slice(-2)));
  await page.locator('[data-daily-preset="4.5"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-auto-simulate]').click();
  await page.waitForTimeout(500);
  const logs = await text(page, '[data-auto-logs]');
  check(/\[모의 체결\]|\[모의\].*거부/.test(logs), '시뮬레이션 → 모의 체결/거부 로그', logs.slice(0, 70));
  await page.locator('[data-auto-root]').screenshot({ path: `${OUT}/57-autotrade-browser.png` }).catch(() => {});
  check(errors.length === 0, '브라우저 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 4) v1.5.0 이전 APK — 자동매매 브리지 없음 → 업데이트 안내
 * ================================================================== */
{
  const { ctx, page, errors } = await open({ oldApk: true });
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(1400);
  const bridgeCount = await page.locator('[data-auto-bridge-missing]').count();
  check(bridgeCount >= 1, '구버전 APK: 업데이트 필요 안내 표시', `${bridgeCount}개`);
  const note = await text(page, '[data-auto-bridge-missing]');
  check(/v1\.5\.0/.test(note) && /APK/.test(note), '업데이트 안내에 v1.5.0·APK 안내', note.slice(0, 60));
  check(/^(?!.*브라우저)/.test(note), '구버전 APK를 브라우저로 오해하지 않음');
  check(errors.length === 0, '구버전 APK 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${OUT}/62-autotrade-old-apk.png`, fullPage: true }).catch(() => {});
  await ctx.close();
}

/* ---------- 정리 ---------- */
await browser.close();
try {
  process.kill(-server.pid);
} catch {
  /* 이미 종료 */
}

const passed = checks.filter((c) => c.ok).length;
writeFileSync('.tmp/autotrade-report.json', JSON.stringify(checks, null, 2));
console.log('');
console.log(`자동매매 E2E: ${passed}/${checks.length} 통과`);
if (passed !== checks.length) process.exit(1);
