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
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

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
  localStorage.setItem('cota.exchange.v1', 'bitget');
  localStorage.setItem(
    'cota.scan.snapshot.v2',
    JSON.stringify({
      v: 2,
      exchange: 'bitget',
      at: now,
      contracts: [contract],
      markets: 1,
      analyses: [analysis],
      signals: [signal],
      tickers: [],
    }),
  );
  // v1.5.5 — 프로필에는 성향만 남는다(시드는 연결된 계좌 잔고)
  localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'conservative', updatedAt: now }));
  // 10x 고정 — 50% 리스크가 가용 잔고 안에서 가능한 조건
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
    // 네이티브 설정의 enabled — 1일 손실 한도로 서비스가 스스로 끄면 웹도 같이 꺼진다(v1.5.3)
    enabled: window.__auto.config ? window.__auto.config.enabled === true : false,
    mode: window.__auto.demo ? 'demo' : 'live',
    armed: window.__auto.plans.length,
    openPositions: window.__auto.positions.length,
    equity: window.__auto.equity ?? 1234.56,
    // v1.5.4 — 가용·미실현·오늘 기준선도 서비스 스냅숏에서 내려온다
    available: window.__auto.available ?? 1000.5,
    unrealizedPL: 12.34,
    dayStartEquity: window.__auto.dayStartEquity ?? 1234.56,
    partialTpDone: window.__auto.partialTpDone ?? [],
    dayKey: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
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
    'bitgetClosePosition',
    'autoTradeStart',
    'autoTradeStop',
    'autoTradeSync',
    'autoTradeStatus',
    'autoTradeResetDailyLimit',
  ].map((name) => ({ name, rtype: 'promise' }));
  methods.push({ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' });
  // v1.4.0 이하 APK 흉내 — 자동매매 메서드가 아예 없다
  if (window.__oldApk) methods = methods.filter((m) => !/^(bitget|autoTrade)/.test(m.name));

  const handlers = {
    appInfo: async () => ({ versionName: '1.5.2', versionCode: 8, packageName: 'com.hw3238.bitgetscanner' }),
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
        equity: window.__auto.equity ?? 1234.56,
        available: window.__auto.available ?? 1000.5,
        unrealizedPL: 12.34,
        posMode: 'one_way_mode',
        // v1.5.1 — 비트겟 통합계정(UTA) 자동 판별 결과
        accountMode: 'uta',
      };
    },
    bitgetGetPositions: async () => ({ ok: true, positions: window.__auto.positions }),
    bitgetPlaceOrder: async (o) => {
      // 주문 실패 주입 — 거래소가 영문 코드만 돌려주는 상황을 재현한다(v1.5.5 한글 사유 검증).
      if (window.__auto.failOnce) {
        const f = window.__auto.failOnce;
        window.__auto.failOnce = null;
        window.__auto.calls.push({ method: 'bitgetPlaceOrder', failed: f.code });
        return { ok: false, code: f.code, error: f.error ?? f.raw ?? '', raw: f.raw ?? '', recovery: f.recovery ?? [] };
      }
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
    bitgetClosePosition: async (o) => {
      window.__auto.closes = window.__auto.closes || [];
      window.__auto.closes.push(o);
      window.__auto.positions = (window.__auto.positions || []).filter(
        (p) => !(p.symbol === o.symbol && p.holdSide === o.holdSide),
      );
      return { ok: true, orderId: `close-${window.__auto.closes.length}`, clientOid: o.clientOid };
    },
    autoTradeStart: async (o) => {
      const config = JSON.parse(o.config);
      const plans = JSON.parse(o.plans);
      const exitSignals = o.exitSignals ? JSON.parse(o.exitSignals) : [];
      window.__auto.exitSignals = exitSignals;
      window.__auto.calls.push({
        method: 'autoTradeStart',
        enabled: config.enabled,
        mode: config.mode,
        plans: plans.length,
        planQty: plans[0]?.qty ?? null,
        planRiskPct: plans[0]?.riskPct ?? null,
        planMargin:
          plans[0] == null ? null : (Number(plans[0].qty) * Number(plans[0].entry)) / Math.max(1, Number(plans[0].leverage)),
        riskPct: config.riskPct,
        maxPositions: config.maxPositions,
        earlyStop: config.earlyStop,
        partialTp: config.partialTp,
        maxLeverage: config.maxLeverage,
        exitSignals: exitSignals.length,
      });
      window.__auto.config = config;
      window.__auto.plans = plans;
      window.__auto.running = true;
      return statusOf();
    },
    autoTradeSync: async (o) => {
      const plans = JSON.parse(o.plans);
      window.__auto.plans = plans;
      window.__auto.config = JSON.parse(o.config);
      window.__auto.exitSignals = o.exitSignals ? JSON.parse(o.exitSignals) : window.__auto.exitSignals;
      window.__auto.calls.push({
        method: 'autoTradeSync',
        earlyStop: window.__auto.config?.earlyStop,
        exitSignals: (window.__auto.exitSignals ?? []).length,
        // v1.5.6 — ② 저장이 네이티브 감시에 곧바로 반영됐는지 확인용
        riskPct: window.__auto.config?.riskPct,
        dailyLossPct: window.__auto.config?.dailyLossPct,
        maxPositions: window.__auto.config?.maxPositions,
        stylePresetActive: window.__auto.config?.stylePresetActive,
      });
      return statusOf();
    },
    autoTradeStop: async () => {
      window.__auto.calls.push({ method: 'autoTradeStop' });
      window.__auto.running = false;
      if (window.__auto.config) window.__auto.config.enabled = false;
      return statusOf();
    },
    autoTradeStatus: async () => statusOf(),
    // v1.5.4 — 손실한도 초기화: 네이티브가 계좌를 새로 조회해 기준선을 다시 잡고 잠금을 푼다
    autoTradeResetDailyLimit: async () => {
      window.__auto.calls.push({ method: 'autoTradeResetDailyLimit' });
      window.__auto.dailyLocked = false;
      window.__auto.dailyPnl = 0;
      window.__auto.dayStartEquity = 1234.56;
      window.__auto.nativeLog = [
        { at: Date.now(), level: 'info', text: '1일 손실 한도 초기화 — 기준 equity $1,234.56 (일일 손익 0%부터 다시 계산)' },
        ...window.__auto.nativeLog,
      ];
      return { ...statusOf(), ok: true, equity: 1234.56, available: 1000.5, unrealizedPL: 12.34, dayStartEquity: 1234.56 };
    },
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

async function open({ native = true, blockMarket = true, oldApk = false, seedConfig = null, altSignal = false, profileStyle = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await ctx.addInitScript(seedAuthSession);
  await installE2EStubs(ctx);

  await ctx.addInitScript(`(${snapshotScript.toString()})();`);
  // 알트 코인(DOGE) 시그널을 하나 더 심어 '전체 코인' 기본값이 실제 감시 목록에 들어가는지 본다.
  if (altSignal) {
    await ctx.addInitScript(() => {
      const raw = localStorage.getItem('cota.scan.snapshot.v2');
      if (!raw) return;
      const snap = JSON.parse(raw);
      const now = Date.now();
      const sig = snap.signals[0];
      const doge = {
        ...sig,
        id: `DOGEUSDT|1H|long|${now}`,
        symbol: 'DOGEUSDT',
        base: 'DOGE',
        entry: 0.4,
        stop: 0.38,
        target: 0.45,
        eq: 0.39,
        price: 0.4,
        decimals: 4,
      };
      snap.signals = [...snap.signals, doge];
      snap.analyses = [...snap.analyses, { ...snap.analyses[0], symbol: 'DOGEUSDT', base: 'DOGE', signals: [doge] }];
      snap.contracts = [
        ...snap.contracts,
        { ...snap.contracts[0], symbol: 'DOGEUSDT', base: 'DOGE', decimals: 4, minTradeNum: 1, volumePlace: 0, minTradeUsdt: 5 },
      ];
      localStorage.setItem('cota.scan.snapshot.v2', JSON.stringify(snap));
    });
  }
  // 예전 버전이 저장해 둔 설정을 심는다 — 새로고침 때 다시 덮지 않도록 없을 때만 쓴다.
  if (seedConfig) {
    await ctx.addInitScript(
      `if (!localStorage.getItem('cota.autotrade.config.v1')) localStorage.setItem('cota.autotrade.config.v1', JSON.stringify(${JSON.stringify(
        seedConfig,
      )}));`,
    );
  }
  // 성향을 바꿔서 시작하고 싶을 때(업그레이드 마이그레이션 검증) — 스냅숏 스크립트 뒤에 덮어쓴다.
  if (profileStyle) {
    await ctx.addInitScript(
      `localStorage.setItem('cota.profile.v1', JSON.stringify({ style: ${JSON.stringify(profileStyle)}, updatedAt: Date.now() }));`,
    );
  }
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

/** ② 리스크·안전장치 — 초안을 저장한다(저장 버튼이 켜져 있을 때만) */
const saveGuards = async (page) => {
  const btn = page.locator('[data-auto-config-save]');
  if (await btn.isEnabled()) {
    await btn.click();
    await page.waitForTimeout(400);
  }
};

/** 저장된 자동매매 설정 */
const storedConfig = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}'));

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
  // v1.5.1 회귀 — 저장 직후 passphraseSet 이 화면 상태로 넘어오지 않아 `Passphrase: —` 로 보이던 문제
  check(/Passphrase ?•••••••• 저장됨/.test(keyPanel), 'Passphrase 저장됨 표시(— 아님)', keyPanel.slice(0, 120));
  check(!/Passphrase[^•]{0,6}—/.test(keyPanel), 'Passphrase 에 — 표시 없음');
  const accountLine = await text(page, '[data-auto-account]');
  check(/모의투자 연결 · USDT \$1,235/.test(accountLine), '연결 테스트 → USDT 잔고 표시', accountLine);
  check(/통합계정\(UTA\)/.test(accountLine), '계정 모드 표시 = 통합계정(UTA)', accountLine);

  // 1회 리스크 50% — 사용자 요청(시드의 50%까지) · 고위험 경고
  // v1.5.6 — ②는 초안(draft)이다: 저장을 누르기 전에는 설정이 바뀌지 않는다.
  await page.locator('[data-risk-preset="50"]').click();
  await page.waitForTimeout(300);
  const riskDraft = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').riskPct,
    state: document.querySelector('[data-auto-guard-state]')?.textContent?.trim() ?? '',
    saveOn: document.querySelector('[data-auto-config-save]')?.disabled === false,
    dirtyList: document.querySelector('[data-auto-dirty-fields]')?.textContent?.trim() ?? '',
  }));
  check(
    riskDraft.stored === 1.5 && riskDraft.state === '저장 안 됨' && riskDraft.saveOn,
    '② 값 변경 → 저장 전: 저장 안 됨 · 설정은 그대로(1.5%)',
    `${riskDraft.stored}% · ${riskDraft.state}`,
  );
  check(/1회 리스크/.test(riskDraft.dirtyList), '바뀐 항목 안내(1회 리스크)', riskDraft.dirtyList);
  await saveGuards(page);
  const risk50 = await page.evaluate(() => ({
    warning: !!document.querySelector('[data-risk-warning]'),
    text: document.querySelector('[data-risk-warning]')?.textContent?.trim() ?? '',
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').riskPct,
    hint: document.querySelector('.auto-risk-block .num-hint')?.textContent ?? '',
  }));
  check(risk50.stored === 50 && risk50.warning, '1회 리스크 50% 프리셋 + 고위험 경고', `${risk50.stored}% · ${risk50.text}`);
  check(
    (await page.evaluate(() => document.querySelector('[data-auto-config-save]')?.textContent?.trim())) === '✓ 저장됨',
    '저장 버튼 = ✓ 저장됨 피드백',
    await page.evaluate(() => document.querySelector('[data-auto-config-save]')?.textContent?.trim()),
  );
  check(
    /50%/.test(risk50.hint) && /\$617/.test(risk50.hint) && /계좌/.test(risk50.hint),
    '50% = 연결된 계좌 $1,234.56의 $617.28 로 계산',
    risk50.hint,
  );

  // 자동매매 켜기
  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(900);
  const started = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'autoTradeStart'));
  check(started.length === 1, '자동매매 켜기 → 네이티브 서비스 start');
  check(started[0]?.enabled === true && started[0]?.mode === 'demo', 'start 설정: enabled=true · mode=demo', JSON.stringify(started[0] ?? {}));
  check(started[0]?.riskPct === 50 && started[0]?.maxPositions === 2, 'start 설정: 리스크 50% · 최대 2포지션');
  // 수량 = 1,234.56 × 50% ÷ 3,050 = 0.2024 → 가용 $1,000.50·5x 증거금 캡(0.0779)으로 0.077
  check(
    typeof started[0]?.planQty === 'number' && Math.abs(started[0].planQty - 0.155) < 0.003,
    '50% 리스크 수량 = 계좌×50%÷손절거리, 가용 95%·10x 캡 적용 → 0.155 BTC (감시 목록에 전달)',
    `planQty=${started[0]?.planQty}`,
  );
  check(
    started[0]?.planMargin == null || started[0].planMargin <= 1000.5 * 0.95 + 1,
    '감시 수량의 필요 증거금 ≤ 가용의 95%',
    String(started[0]?.planMargin),
  );
  check((await text(page, '[data-auto-badge]')) === '모의투자 가동 중', '배지 = 모의투자 가동 중');
  await page.locator('[data-auto-guards]').screenshot({ path: `${OUT}/55-autotrade-guards.png` }).catch(() => {});

  // v1.5.4 — 조기 손절 보호 토글 (기본 ON) · 반대 시그널 전달
  check(started[0]?.earlyStop === true, '자동매매 시작 설정에 조기 손절 ON 포함', String(started[0]?.earlyStop));
  check(started[0]?.partialTp === true, '자동매매 시작 설정에 50% 반익절 ON 포함', String(started[0]?.partialTp));
  check(started[0]?.maxLeverage === 0, '자동매매 시작 설정에 레버리지 상한 없음(0 = 유동)', `${started[0]?.maxLeverage}x`);
  check(
    started[0]?.exitSignals === 1,
    '감시 시작 시 진행 중 시그널을 네이티브로 전달(반대 시그널 판단용)',
    `${started[0]?.exitSignals}건`,
  );
  check(await page.locator('[data-auto-earlystop="on"].on').count() === 1, '조기 손절 보호 기본값 = 켜기');
  const earlyText = await page.textContent('[data-auto-guards]');
  check(/SL 전 반대 시그널·추세 붕괴/.test(earlyText ?? ''), '안전장치 카드에 조기 손절 설명', (earlyText ?? '').slice(0, 100));
  await page.locator('[data-auto-earlystop="off"]').click();
  await page.waitForTimeout(300);
  await saveGuards(page);
  const earlyOff = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').earlyStop,
    hint: [...document.querySelectorAll('.auto-option em')].map((e) => e.textContent).join(' '),
  }));
  check(earlyOff.stored === false, '조기 손절 끄기 → 설정에 저장', String(earlyOff.stored));
  check(/SL에서만 청산/.test(earlyOff.hint), '끄면 SL에서만 청산한다고 안내', earlyOff.hint.slice(0, 80));
  await page.locator('[data-auto-earlystop="on"]').click();
  await page.waitForTimeout(250);
  await saveGuards(page);
  check(
    (await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').earlyStop)) === true,
    '다시 켜기 → 설정 ON',
  );
  await page.locator('.auto-options').screenshot({ path: `${OUT}/70-auto-early-stop.png` }).catch(() => {});

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
  // v1.5.4 — 조기 손절 이벤트가 '조기 손절' 배지로 로그에 남는다
  await page.evaluate(() =>
    window.__emitAuto({
      nativeLog: [
        { at: Date.now(), level: 'exit', text: '🛡 조기 손절 [모의] BTC 롱 0.025 @ 61000 — 반대 방향 시그널 감지 · -0.42R' },
        ...(window.__auto.nativeLog ?? []),
      ],
    }),
  );
  await page.waitForTimeout(500);
  check(await page.locator('.auto-log.exit').count() >= 1, '조기 손절 로그가 전용 배지로 표시');
  check(/조기 손절/.test(await text(page, '[data-auto-logs]')), '조기 손절 사유가 로그에 남는다');
  check(/반대 방향 시그널 감지/.test(await text(page, '[data-auto-logs]')), '조기 손절 사유 문구 표시');
  // v1.5.3 — `0건 진입` 오해 방지: 오늘 실제 체결 수 + 감시 건수
  const fillBadge = await text(page, '[data-auto-fillcount]');
  check(/오늘 체결 1건/.test(fillBadge) && /감시 \d+건/.test(fillBadge), '로그 배지 = 오늘 체결 수 · 감시 건수', fillBadge);

  // 1일 손실 한도 → 자동 잠금
  await page.evaluate(() => window.__emitAuto({ dailyPnl: -61.7, dailyLocked: true }));
  await page.waitForTimeout(800);
  const hero = await text(page, '[data-auto-hero]');
  check(/⛔ 잠김/.test(hero), '1일 손실 한도 도달 → 잠김 표시');
  check((await text(page, '[data-auto-badge]')) === '꺼짐', '한도 도달 시 자동매매 자동 정지');
  check(/1일 손실 한도 도달/.test(await text(page, '[data-auto-logs]')), '한도 도달 차단 로그');
  const stops = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'autoTradeStop').length);
  check(stops >= 1, '한도 도달 시 네이티브 서비스 stop 호출');

  /* ---------- v1.5.4: 손실한도 초기화 ---------- */
  check(await page.locator('[data-auto-reset]').count() === 1, '한도 잠김 → 손실한도 초기화 버튼 표시');
  check(await page.locator('[data-auto-reset-guard]').count() === 1, '안전장치 카드에도 초기화 버튼');
  await page.locator('[data-auto-hero]').screenshot({ path: `${OUT}/64-auto-daily-locked.png` }).catch(() => {});
  await page.locator('[data-auto-reset]').click();
  await page.waitForTimeout(900);
  const resets = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'autoTradeResetDailyLimit'));
  check(resets.length === 1, '초기화 클릭 → 네이티브 autoTradeResetDailyLimit 1건', `${resets.length}건`);
  check(
    page.__dialogs.some((m) => /현재 잔고 기준으로 오늘 손실 한도를 초기화할까요/.test(m)),
    '초기화 전 확인 모달(실수 방지)',
    page.__dialogs.slice(-1).join(' | '),
  );
  const heroAfterReset = await text(page, '[data-auto-hero]');
  check(!/⛔ 잠김/.test(heroAfterReset), '초기화 후 잠김 해제', heroAfterReset.slice(0, 60));
  check(/손실 한도를 지금 잔고/.test(await text(page, '.auto-toast')), '초기화 성공 토스트', await text(page, '.auto-toast'));
  const resetRuntime = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.runtime.v1') || '{}'));
  check(
    Math.abs((resetRuntime.dayStartEquity ?? 0) - 1234.56) < 1e-6,
    '초기화 후 웹 기준선 = 지금 잔고(즉시 다시 잠기지 않게)',
    String(resetRuntime.dayStartEquity),
  );
  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(900);
  const restarted = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'autoTradeStart'));
  check(restarted.length === 2, '초기화 후 자동매매를 다시 켤 수 있다(start 2번째)', `${restarted.length}회`);
  check(!/⛔ 잠김/.test(await text(page, '[data-auto-hero]')), '다시 켠 뒤에도 잠김으로 돌아가지 않는다');
  await page.locator('[data-auto-hero]').screenshot({ path: `${OUT}/65-auto-daily-reset.png` }).catch(() => {});

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
  // 수량 = 계좌 1,234.56 × 리스크 1.5% ÷ |61000-57950| = 0.00607 → 거래소 3자리 내림 0.006
  check(Math.abs(Number(o.size) - 0.006) < 1e-9, '수량 = 계좌×리스크÷손절거리 (0.006 BTC)', o.size);
  check(o.leverage >= 1 && o.leverage <= 10, '레버리지 상한 이내', `${o.leverage}x`);
  await page.locator('.signal-card [data-quick-order]').first().screenshot({ path: `${OUT}/56-auto-quick-order.png` }).catch(() => {});

  // 실거래 모드로 바꾸면 라벨·로그가 실거래로
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-auto-mode="live"]').click();
  await page.waitForTimeout(400);
  // v1.5.3 — 저장된 키가 모의투자 키면 `실거래`를 골라도 실제 주문은 모의 계좌로 나간다.
  // 라벨을 실거래로 바꿔 버리면 사용자가 실제 돈이 나간다고 오해한다 — 키를 따른다.
  const cfgMode = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').mode);
  check(cfgMode === 'live', '실거래 선택이 설정에 저장', cfgMode);
  const modeNote = await text(page, '[data-auto-mode-note]');
  check(/모의투자 키/.test(modeNote), '모의 키 + 실거래 설정 → 안내 문구', modeNote.slice(0, 80));
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"], [data-tab="scanner"]')?.click());
  await page.waitForTimeout(500);
  check(/원클릭 모의 주문/.test(await text(page, '[data-quick-order]')), '실거래를 골라도 키가 모의면 라벨은 모의');
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
  await saveGuards(page);
  const offLimit = await page.evaluate(() => ({
    metric: [...document.querySelectorAll('.auto-metric')].map((m) => m.textContent?.replace(/\s+/g, ' ').trim()),
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct,
  }));
  check(offLimit.stored === 0 && offLimit.metric.some((m) => m.includes('끔')), '1일 손실 한도 끄기(0%) 반영', JSON.stringify(offLimit.metric.slice(-2)));
  await page.locator('[data-daily-preset="4.5"]').click();
  await page.waitForTimeout(200);
  await saveGuards(page);
  await page.locator('[data-auto-simulate]').click();
  await page.waitForTimeout(500);
  const logs = await text(page, '[data-auto-logs]');
  // v1.5.5 — 브라우저는 실계좌가 없어 계산 기준이 없다. 숫자를 지어내지 않고 연결 안내를 남긴다.
  check(/실계좌 잔고가 없어 계산할 수 없습니다|\[모의 체결\]|\[모의\].*거부/.test(logs), '시뮬레이션 → 계좌 미연결 안내(또는 모의 체결/거부)', logs.slice(0, 90));
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

/* ================================================================== *
 * 5) 실거래 키 — 라벨·경고가 실거래로 (v1.5.3)
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-auto-mode="live"]').click();
  await page.waitForTimeout(200);
  await page.locator('.auto-warn-check input').check();
  await page.fill('[data-auto-input="key"]', 'bg_livekey_9f3k2m8d7c6b5a4n3m2c7d');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'bitgetSaveKeys').pop());
  check(saved?.demo === false, '실거래 키 저장 → 네이티브 demo=false', JSON.stringify(saved ?? {}));
  const keyTag = await text(page, '[data-auto-keys] .auto-tag');
  check(/연결됨 · 실거래/.test(keyTag), '실거래 키 연결 표시', keyTag);
  const modeTag = JSON.parse(await page.evaluate(() => localStorage.getItem('cota.autotrade.config.v1') || '{}')).mode;
  check(modeTag === 'live', '저장 후 설정 모드 = 실거래', modeTag);
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"], [data-tab="scanner"]')?.click());
  await page.waitForTimeout(600);
  check(/원클릭 실거래 주문/.test(await text(page, '[data-quick-order]')), '실거래 키 → 원클릭 라벨 실거래');
  check(await page.locator('.quick-order-btn.live').count() >= 1, '실거래 버튼 스타일(live)');
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  check((await text(page, '[data-auto-pill]')).includes('대기') || (await text(page, '[data-auto-pill]')).includes('OFF'), '가동 전 상태 표시', await text(page, '[data-auto-pill]'));
  check(errors.length === 0, '실거래 키 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 6) 보유 포지션 시장가 청산 (v1.5.3)
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  await page.fill('[data-auto-input="key"]', 'bg_demokey_1234567890abcdef');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(900);
  // 보유 포지션을 네이티브 목록에 심고 새로고침으로 가져온다
  await page.evaluate(() => {
    window.__auto.positions = [
      {
        symbol: 'BTCUSDT',
        holdSide: 'long',
        total: 0.025,
        openPriceAvg: 61100,
        markPrice: 61200,
        unrealizedPL: 2.5,
        leverage: 10,
        marginSize: 152.75,
        liquidationPrice: 55000,
        presetStopSurplusPrice: 67000,
        presetStopLossPrice: 57950,
        ctime: Date.now(),
      },
    ];
  });
  await page.locator('[data-auto-positions] button').first().click();
  await page.waitForTimeout(700);
  const posText = await text(page, '[data-auto-positions]');
  check(/BTC/.test(posText) && /롱/.test(posText), '포지션 목록에 BTC 롱 표시', posText.slice(0, 80));
  check(await page.locator('[data-auto-close="BTCUSDT"]').count() === 1, '포지션에 시장가 청산 버튼');
  await page.locator('[data-auto-close="BTCUSDT"]').click();
  await page.waitForTimeout(900);
  const closes = await page.evaluate(() => window.__auto.closes ?? []);
  check(closes.length === 1, '청산 클릭 → 네이티브 bitgetClosePosition 1건', JSON.stringify(closes[0] ?? {}));
  const c = closes[0] ?? {};
  check(c.symbol === 'BTCUSDT' && c.holdSide === 'long', '청산 대상: BTC 롱(포지션 방향 그대로)', `${c.symbol}/${c.holdSide}`);
  check(Math.abs(Number(c.size) - 0.025) < 1e-9, '청산 수량 = 보유 수량', c.size);
  check(!!c.clientOid, '청산 clientOid 전달(중복 청산 방지)', c.clientOid);
  check(/청산/.test(await text(page, '[data-auto-logs]')), '청산 결과가 로그에 남는다');
  await page.waitForTimeout(300);
  check(/보유 중인 USDT-M 포지션이 없습니다/.test(await text(page, '[data-auto-positions]')), '청산 후 포지션 목록 갱신');
  check(errors.length === 0, '청산 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 7) 실시간 잔고 자동 갱신 (v1.5.4) — 화면이 열려 있으면 10~15초 주기, 나가면 정리
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
  await page.fill('[data-auto-input="key"]', 'bg_demokey_1234567890abcdef');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(1200);

  const sec = await page.getAttribute('[data-auto-balance]', 'data-auto-refresh-sec');
  check(Number(sec) >= 10 && Number(sec) <= 15, '실시간 갱신 주기 10~15초', `${sec}초`);
  const balance = await text(page, '[data-auto-balance]');
  check(/가용 \$1,001/.test(balance) && /미실현/.test(balance), '가용 잔고·미실현 손익 표시', balance.slice(0, 80));
  check(/실시간 · (방금 전|\d+초 전)/.test(await text(page, '[data-auto-refresh]')), '실시간 갱신 표시(방금 전)', await text(page, '[data-auto-refresh]'));

  const before = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'bitgetTestConnection').length);
  await page.waitForTimeout(13_000);
  const after = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'bitgetTestConnection').length);
  check(after > before, '화면이 열려 있으면 잔고를 주기적으로 다시 조회', `${before} → ${after}회`);
  check(/초 전|방금 전/.test(await text(page, '[data-auto-refresh]')), '갱신 시각이 계속 따라온다', await text(page, '[data-auto-refresh]'));
  await page.locator('[data-auto-balance]').screenshot({ path: `${OUT}/63-auto-live-balance.png` }).catch(() => {});
  await page.locator('[data-auto-hero]').screenshot({ path: `${OUT}/66-auto-hero-live.png` }).catch(() => {});
  await page.locator('[data-auto-guards]').screenshot({ path: `${OUT}/67-auto-reset-guard.png` }).catch(() => {});

  // 화면을 나가면 interval 정리 → 더 이상 계좌를 조회하지 않는다
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"]')?.click());
  await page.waitForTimeout(700);
  const left = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'bitgetTestConnection').length);
  await page.waitForTimeout(13_000);
  const leftAfter = await page.evaluate(() => window.__auto.calls.filter((c) => c.method === 'bitgetTestConnection').length);
  check(leftAfter === left, '자동매매 화면을 나가면 실시간 갱신 중지', `${left} → ${leftAfter}회`);
  check(errors.length === 0, '실시간 갱신 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 8) v1.5.5 — 시드 입력 제거 · 실계좌 잔고 기준 표시 · 계좌 미연결 안내
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  // 계좌 미연결 상태의 스캐너 카드 — 시드 숫자 대신 연결 안내(계산 불가)
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"]')?.click());
  await page.waitForTimeout(900);
  const unlinked = await page.evaluate(() => ({
    notice: !!document.querySelector('[data-cockpit-unlinked]'),
    text: document.querySelector('[data-cockpit-unlinked]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    connectBtn: !!document.querySelector('.cockpit-connect'),
    cockpit: !!document.querySelector('.cockpit:not(.unlinked)'),
    seedInput: document.querySelectorAll('.seed-input, .seed-chip').length,
    quick: document.querySelectorAll('[data-quick-order]').length,
  }));
  check(unlinked.notice && /계좌를 연결하면 실시간 잔고 기준/.test(unlinked.text), '계좌 미연결 카드: 시드 대신 연결 안내', unlinked.text.slice(0, 70));
  check(!unlinked.cockpit && unlinked.quick === 0, '계좌 미연결이면 주문 수량·원클릭 주문을 만들지 않는다');
  check(unlinked.seedInput === 0, '수동 시드 입력 UI 없음(온보딩·카드)');
  await page.locator('[data-cockpit-unlinked]').first().screenshot({ path: `${OUT}/71-cockpit-unlinked.png` }).catch(() => {});
  // 안내 버튼 → 자동매매(계좌 연결) 화면
  await page.locator('.cockpit-connect').first().click();
  await page.waitForTimeout(600);
  check(await page.locator('[data-auto-root]').count() === 1, '카드의 계좌 연결 버튼 → 비트겟 자동매매 화면');

  // 키 연결 → 카드·히어로가 계좌 잔고 기준으로 바뀐다
  await page.fill('[data-auto-input="key"]', 'bg_demokey_1234567890abcdef');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(1000);
  const heroSeed = await text(page, '[data-auto-seed]');
  check(/계좌 기준 \$1,235/.test(heroSeed), '자동매매 히어로: 시드 → 계좌 기준 잔고', heroSeed);
  const riskHint = await text(page, '.auto-risk-block .num-hint');
  check(/계좌 \$1,235/.test(riskHint) && /\$18\.52|\$19/.test(riskHint), '1회 리스크 = 계좌 잔고의 %로 금액 표시', riskHint);
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"]')?.click());
  await page.waitForTimeout(900);
  const live = await page.evaluate(() => ({
    cockpit: !!document.querySelector('.cockpit:not(.unlinked)'),
    risk: document.querySelector('[data-cockpit-risk]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    cells: [...document.querySelectorAll('.cockpit-cell b')].map((b) => b.textContent?.trim()),
    quick: document.querySelectorAll('[data-quick-order]').length,
  }));
  check(live.cockpit && /^계좌 \$1,234\.56의 1\.5%/.test(live.risk), '카드 콕핏 = 계좌 잔고 기준', live.risk);
  check(live.cells.length === 4 && live.quick >= 1, '연결되면 주문 수량·원클릭 주문이 바로 뜬다', JSON.stringify(live.cells));
  await page.locator('.scanner-tab .signal-card:not(.skeleton)').first().screenshot({ path: `${OUT}/72-cockpit-account.png` }).catch(() => {});

  // 설정 탭 — '내 시드' 대신 '계좌 잔고'
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="settings"]')?.click());
  await page.waitForTimeout(800);
  const settings = await page.evaluate(() => ({
    balance: document.querySelector('[data-settings-balance] b')?.textContent?.trim() ?? '',
    sub: document.querySelector('[data-settings-balance] i')?.textContent?.trim() ?? '',
    heading: document.querySelector('#settings-profile h3')?.textContent?.trim() ?? '',
    seedWords: /내 시드/.test(document.querySelector('#settings-profile')?.innerText ?? ''),
    connectNote: !!document.querySelector('[data-settings-connect]'),
  }));
  check(settings.balance === '$1,234.56' && /가용/.test(settings.sub), '설정: 계좌 잔고·가용 표시', `${settings.balance} · ${settings.sub}`);
  check(!settings.seedWords && /내 매매 기준/.test(settings.heading) && !settings.connectNote, '설정: 내 시드 문구·연결 안내 없음(연결됨)', settings.heading);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator('#settings-profile').screenshot({ path: `${OUT}/73-settings-account.png` }).catch(() => {});

  // 잔고가 바뀌면 카드 수량도 따라온다(포그라운드 복귀·주기 갱신)
  await page.evaluate(() => {
    window.__auto.equity = 300;
    window.__auto.available = 300;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(900);
  check(/\$300\.00/.test(await text(page, '[data-settings-balance]')), '잔고 변경 → 화면이 새 잔고로 갱신', await text(page, '[data-settings-balance]'));
  check(errors.length === 0, '계좌 기준 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 9) v1.5.5 — 주문 오류 한글 사유 · 자동 보정 기록(사용자에게 묻지 않는다)
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
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
  await page.waitForTimeout(700);

  // 거래소가 영문 코드만 돌려준 경우 — 한글 사유 + 원문 코드 + 자동 보정 기록
  await page.evaluate(() => {
    window.__auto.failOnce = {
      code: '40774',
      error: 'The order type for unilateral position must also be the unilateral position type.',
      raw: 'The order type for unilateral position must also be the unilateral position type.',
      recovery: ['포지션 모드에 맞춰 주문 형식 변경(단방향)'],
    };
  });
  await page.locator('[data-quick-order]').first().click();
  await page.waitForTimeout(900);
  const failDialog = page.__dialogs.slice(-1).join(' ');
  check(/포지션 모드/.test(failDialog) && /코드 40774/.test(failDialog), '실패 사유가 한글(코드 포함)로 안내된다', failDialog.slice(0, 100));
  // 메뉴 탭 → 허브 → 자동매매 화면에서 로그를 확인한다.
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="menu"]')?.click());
  await page.waitForTimeout(400);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(600);
  const logText = await text(page, '[data-auto-logs]');
  check(/주문 실패 — .*포지션 모드/.test(logText), '로그: 한글 실패 사유', logText.slice(0, 100));
  check(/자동 보정: .*포지션 모드/.test(logText), '로그: 자동 보정 내역까지 남는다', logText.slice(0, 140));
  await page.locator('[data-auto-logs]').screenshot({ path: `${OUT}/74-order-error-ko.png` }).catch(() => {});

  // 다음 주문은 성공 — 화면이 오류로 굳지 않는다
  await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="scanner"]')?.click());
  await page.waitForTimeout(700);
  await page.locator('[data-quick-order]').first().click();
  await page.waitForTimeout(800);
  const okOrders = await page.evaluate(() => window.__auto.orders.length);
  check(okOrders >= 1, '실패 뒤 다음 주문은 정상 접수', `${okOrders}건`);

  // 같은 시그널 재클릭은 중복 진입으로 막힌다 — 실패해도 화면이 굳지 않고 한글 사유로 알린다
  await page.locator('[data-quick-order]').first().click().catch(() => {});
  await page.waitForTimeout(600);
  const dupDialog = page.__dialogs.slice(-1).join(' ');
  check(/이미 진입/.test(dupDialog), '같은 시그널 재주문은 중복 진입으로 막힘', dupDialog.slice(0, 80));
  check(errors.length === 0, '오류 안내 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 10) 허용 종목 기본값 = '전체 코인' · 구 'majors' 1회 마이그레이션
 *     (현우님: "자동매매가 이루어지지 않는데 왜 그러는 거야?" → 기본 허용 종목이 메이저 4종)
 * ================================================================== */
const openAuto = async (page) => {
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(400);
};

const readSymbolUi = (page) =>
  page.evaluate(() => {
    const option = [...document.querySelectorAll('.auto-option')].find((o) =>
      o.textContent?.includes('허용 종목'),
    );
    return {
      stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').symbols,
      buttons: document.querySelectorAll('[data-auto-symbols]').length,
      onCrypto: !!document.querySelector('[data-auto-symbols="crypto"].on'),
      onMajors: !!document.querySelector('[data-auto-symbols="majors"].on'),
      onAll: !!document.querySelector('[data-auto-symbols="all"].on'),
      hint: option?.querySelector('em')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });

{
  // (a) 저장된 설정이 없으면 기본값은 '전체 코인'
  const { ctx, page, errors } = await open();
  await openAuto(page);
  const fresh = await readSymbolUi(page);
  check(fresh.stored === 'crypto' && fresh.onCrypto, '허용 종목 기본값 = 전체 코인(crypto)', fresh.stored);
  check(fresh.buttons === 3, '허용 종목 3택(전체 코인·메이저 4종·주식선물 포함)', `${fresh.buttons}개`);
  check(/주식선물 제외 모든 비트겟 코인 선물/.test(fresh.hint), '전체 코인 설명 = 주식선물 제외 모든 코인 선물', fresh.hint);
  await page.locator('.auto-options').screenshot({ path: `${OUT}/75-auto-symbol-scope.png` }).catch(() => {});

  await page.locator('[data-auto-symbols="majors"]').click();
  await page.waitForTimeout(250);
  await saveGuards(page);
  const majors = await readSymbolUi(page);
  check(
    majors.stored === 'majors' && majors.onMajors && !majors.onCrypto,
    '메이저 4종 선택 → 설정 저장',
    majors.stored,
  );
  check(/비트 · 이더 · 솔 · 리플 4종만/.test(majors.hint), '메이저 4종 설명', majors.hint);

  await page.locator('[data-auto-symbols="all"]').click();
  await page.waitForTimeout(250);
  await saveGuards(page);
  const all = await readSymbolUi(page);
  check(all.stored === 'all' && all.onAll, '주식선물 포함 선택 → 설정 저장', all.stored);
  check(/주식선물 포함 모든 비트겟 USDT-M 종목/.test(all.hint), '주식선물 포함 설명', all.hint);
  check(errors.length === 0, '허용 종목 UI 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

{
  // (b) 예전 버전이 저장한 'majors'(구 기본값)는 1회만 'crypto' 로 옮긴다 — 나머지 설정은 그대로
  const { ctx, page, errors } = await open({
    seedConfig: { enabled: false, mode: 'demo', autoEntry: true, riskPct: 2.5, maxPositions: 3, symbols: 'majors', earlyStop: true },
  });
  await openAuto(page);
  const migrated = await page.evaluate(() => ({
    config: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}'),
    flag: localStorage.getItem('cota.autotrade.migrated.cryptoDefault.v1'),
    onCrypto: !!document.querySelector('[data-auto-symbols="crypto"].on'),
  }));
  check(migrated.config.symbols === 'crypto' && migrated.onCrypto, '저장된 majors → crypto 로 1회 전환', migrated.config.symbols);
  check(migrated.config.riskPct === 2.5 && migrated.config.maxPositions === 3, '마이그레이션은 허용 종목만 바꾼다(다른 설정 유지)', `${migrated.config.riskPct}% · ${migrated.config.maxPositions}포지션`);
  check(migrated.flag === '1', '마이그레이션 완료 표시 저장', String(migrated.flag));

  // 다시 '메이저 4종'을 고르면 새로고침해도 유지되어야 한다(1회성)
  await page.locator('[data-auto-symbols="majors"]').click();
  await page.waitForTimeout(250);
  await saveGuards(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await openAuto(page);
  const kept = await readSymbolUi(page);
  check(kept.stored === 'majors' && kept.onMajors, '마이그레이션 후 직접 고른 메이저 4종은 유지', kept.stored);
  check(errors.length === 0, '마이그레이션 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

{
  // (c) 실제 감시 목록 — 기본 '전체 코인'이면 알트(DOGE) 시그널도 네이티브로 넘어간다
  const { ctx, page, errors } = await open({ altSignal: true });
  await openAuto(page);
  await page.fill('[data-auto-input="key"]', 'bg_demokey_1234567890abcdef');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(900);
  const cryptoStart = await page.evaluate(() => ({
    plans: (window.__auto.plans ?? []).map((p) => p.symbol),
    labels: (window.__auto.plans ?? []).map((p) => p.base),
  }));
  check(
    cryptoStart.plans.includes('BTCUSDT') && cryptoStart.plans.includes('DOGEUSDT'),
    '전체 코인 기본값: 알트(DOGE) 시그널도 감시 목록에 들어간다',
    cryptoStart.plans.join(' / '),
  );
  await page.locator('[data-auto-stop]').click();
  await page.waitForTimeout(400);

  // '메이저 4종'으로 바꾸면 같은 시그널에서 알트는 빠진다(사용자가 직접 고른 범위는 그대로 존중)
  await openAuto(page);
  await page.locator('[data-auto-symbols="majors"]').click();
  await page.waitForTimeout(300);
  await saveGuards(page);
  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(900);
  const majorsStart = await page.evaluate(() => (window.__auto.plans ?? []).map((p) => p.symbol));
  check(
    majorsStart.includes('BTCUSDT') && !majorsStart.includes('DOGEUSDT'),
    '메이저 4종을 고르면 알트 시그널은 감시하지 않는다',
    majorsStart.join(' / '),
  );
  check(errors.length === 0, '감시 목록 범위 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 10) v1.5.7 — 매매 스타일·프리셋 제거 · 50% 반익절 · 유동 레버리지
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  await page.evaluate(() => document.querySelector('[data-tab="menu"]')?.click());
  await page.waitForTimeout(300);
  await page.locator('[data-menu="auto"]').click();
  await page.waitForTimeout(600);

  // 매매 스타일 카드·적용/해제 버튼·성향 선택이 화면에서 완전히 사라졌다
  check((await page.locator('[data-auto-style]').count()) === 0, '자동매매 화면에 매매 스타일 카드 없음');
  check((await page.locator('[data-style-apply]').count()) === 0 && (await page.locator('[data-style-release]').count()) === 0, '프리셋 적용/해제 버튼 없음');
  check((await page.locator('[data-style-linked]').count()) === 0, '프리셋 연동 배지 없음');
  const guardsText = await text(page, '[data-auto-guards]');
  check(!/프리셋/.test(guardsText) && !/매매 스타일/.test(guardsText), '② 리스크·안전장치에 프리셋·매매 스타일 문구 없음', guardsText.slice(0, 120));
  check(/최소 승률/.test(guardsText) && /시그널 유효시간/.test(guardsText), '② 저장 버튼 구조 유지(최소 승률·유효시간 항목)');
  check((await page.locator('[data-auto-config-save]').count()) === 1, '② 저장 버튼 유지', 'data-auto-config-save');

  // 새 기본값이 화면·저장값에 반영된다 (승률 45% · 1.2R · 유효 240분 · 상한 유동)
  const defaults = await storedConfig(page);
  check(
    defaults.minWinRate === 45 && defaults.minRR === 1.2 && defaults.entryTtlMin === 240 && defaults.maxLeverage === 0,
    '기본값: 승률 45% · 1.2R · 유효 240분 · 레버리지 상한 없음',
    JSON.stringify({ w: defaults.minWinRate, rr: defaults.minRR, ttl: defaults.entryTtlMin, lev: defaults.maxLeverage }),
  );
  check(/현재 상한 없음 · 유동/.test(await text(page, '[data-lev-cap-label]')), '레버리지 상한 = 상한 없음 · 유동', await text(page, '[data-lev-cap-label]'));

  // 초안 변경 → 저장 전에는 설정이 바뀌지 않는다
  await page.locator('[data-lev-cap="10"]').click();
  await page.waitForTimeout(400);
  check((await text(page, '[data-auto-guard-state]')) === '저장 안 됨', '초안 변경 = 저장 안 됨 배지', await text(page, '[data-auto-guard-state]'));
  check((await storedConfig(page)).maxLeverage === 0, '저장 전에는 설정도 바뀌지 않는다(유동)', String((await storedConfig(page)).maxLeverage));
  await saveGuards(page);
  check((await storedConfig(page)).maxLeverage === 10, '저장 → 레버리지 상한 10x', String((await storedConfig(page)).maxLeverage));

  // 다시 유동으로 되돌려 저장 (자동매매 기본 = 유동)
  await page.locator('[data-lev-cap="0"]').click();
  await page.waitForTimeout(300);
  await saveGuards(page);
  const levCfg = await storedConfig(page);
  check(levCfg.maxLeverage === 0, '유동 선택 → maxLeverage 0 저장', String(levCfg.maxLeverage));
  check(/상한 없음 · 유동/.test(await text(page, '[data-lev-cap-label]')), '유동이면 상한 없음 표시', await text(page, '[data-lev-cap-label]'));
  await page.locator('[data-lev-cap-label]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/79-auto-unlimited-leverage.png` });

  // 50% 반익절 토글
  check((await page.locator('[data-auto-partialtp="on"].on').count()) === 1, '50% 반익절 기본 ON');
  check(/목표가 50% 또는 \+1\.0R/.test(await text(page, '[data-auto-guards]')), '반익절 규칙(50% · +1.0R) 안내');
  await page.locator('[data-auto-partialtp="off"]').click();
  await page.waitForTimeout(300);
  await saveGuards(page);
  check(
    (await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').partialTp)) === false,
    '반익절 끄기 → 저장',
  );
  await page.locator('[data-auto-partialtp="on"]').click();
  await page.waitForTimeout(250);
  await saveGuards(page);
  await page.locator('[data-auto-partialtp="on"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/78-auto-partial-tp.png` });

  // 포지션 카드의 반익절 진행 상태 — 키를 연결해야 포지션 조회가 열린다
  await page.locator('[data-auto-input="key"]').fill('bg_live_key_1234562c7d');
  await page.locator('[data-auto-input="secret"]').fill('secretsecretsecretsecret12');
  await page.locator('[data-auto-input="passphrase"]').fill('passphrase123');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__auto.positions = [
      {
        symbol: 'BTCUSDT',
        holdSide: 'long',
        total: 0.01,
        openPriceAvg: 61000,
        markPrice: 64000,
        unrealizedPL: 30,
        leverage: 10,
        marginSize: 100,
        liquidationPrice: 55000,
        presetStopSurplusPrice: 67000,
        presetStopLossPrice: 57950,
        ctime: Date.now() - 600000,
      },
    ];
    window.__emitAuto({});
  });
  await page.waitForTimeout(300);
  await page.locator('[data-auto-positions] .auto-mini').click();
  await page.waitForTimeout(600);
  check(/반익절 조건 도달/.test(await text(page, '[data-pos-partial="BTCUSDT"]')), '포지션 카드: 반익절 조건 도달', await text(page, '[data-pos-partial="BTCUSDT"]'));

  await page.evaluate(() => window.__emitAuto({ partialTpDone: ['BTCUSDT|long'] }));
  await page.waitForTimeout(400);
  check(/반익절 50% 완료/.test(await text(page, '[data-pos-partial="BTCUSDT"]')), '포지션 카드: 반익절 완료 표시', await text(page, '[data-pos-partial="BTCUSDT"]'));
  await page.locator('[data-auto-positions]').screenshot({ path: `${OUT}/80-auto-partial-position.png` }).catch(() => {});

  check(errors.length === 0, 'v1.5.7 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 11) v1.5.7 업그레이드 — 예전 기본값(승률 55·1.5R·120분·10x)만 1회 완화
 * ================================================================== */
{
  const { ctx, page, errors } = await open({
    seedConfig: { enabled: false, mode: 'demo', autoEntry: true, minWinRate: 55, minRR: 1.5, entryTtlMin: 120, maxLeverage: 10 },
  });
  await page.waitForTimeout(500);
  const upgraded = await page.evaluate(() => ({
    config: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}'),
    migrated: localStorage.getItem('cota.autotrade.migrated.entryGate.v157'),
  }));
  check(
    upgraded.config.minWinRate === 45 && upgraded.config.minRR === 1.2 && upgraded.config.entryTtlMin === 240 && upgraded.config.maxLeverage === 0,
    '업그레이드: 예전 기본값 → 승률 45% · 1.2R · 240분 · 유동',
    JSON.stringify({ w: upgraded.config.minWinRate, rr: upgraded.config.minRR, ttl: upgraded.config.entryTtlMin, lev: upgraded.config.maxLeverage }),
  );
  check(upgraded.migrated === '1', '업그레이드: 1회 마이그레이션 표시 저장', String(upgraded.migrated));
  check(!('stylePresetActive' in upgraded.config), '업그레이드: stylePresetActive 필드는 버린다', JSON.stringify(upgraded.config).slice(0, 80));

  await openAuto(page);
  check(/현재 상한 없음 · 유동/.test(await text(page, '[data-lev-cap-label]')), '업그레이드 후 레버리지 상한 = 유동', await text(page, '[data-lev-cap-label]'));
  check((await page.locator('[data-auto-style]').count()) === 0, '업그레이드 후에도 매매 스타일 카드 없음');
  await page.screenshot({ path: `${OUT}/81-auto-dynamic-leverage.png` });
  check(errors.length === 0, '업그레이드 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 11-2) 직접 조정한 값은 마이그레이션이 건드리지 않는다
 * ================================================================== */
{
  const { ctx, page, errors } = await open({
    seedConfig: { enabled: false, mode: 'demo', autoEntry: true, minWinRate: 60, minRR: 1.5, entryTtlMin: 300, maxLeverage: 25 },
  });
  await page.waitForTimeout(500);
  const kept = await storedConfig(page);
  check(
    kept.minWinRate === 60 && kept.minRR === 1.2 && kept.entryTtlMin === 300 && kept.maxLeverage === 25,
    '직접 조정값 유지 · 예전 기본값(1.5R)만 완화',
    JSON.stringify({ w: kept.minWinRate, rr: kept.minRR, ttl: kept.entryTtlMin, lev: kept.maxLeverage }),
  );
  check(errors.length === 0, '부분 마이그레이션 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ================================================================== *
 * 12) v1.5.7 — ② 리스크·안전장치 저장 버튼 (프리셋 없음)
 *     (현우님: "손실한도를 바꿈는데 프리셋에 적용되지가 않아. 저장 버튼 추가하고 작동하게 만들어")
 * ================================================================== */
{
  const { ctx, page, errors } = await open();
  await openAuto(page);
  // 네이티브 autoTradeSync 반영까지 보려면 자동매매가 켜져 있어야 한다.
  await page.fill('[data-auto-input="key"]', 'bg_demokey_1234567890abcdef');
  await page.fill('[data-auto-input="secret"]', 'secretsecretsecretsecretsecret12');
  await page.fill('[data-auto-input="passphrase"]', 'cota-passphrase');
  await page.locator('[data-auto-save]').click();
  await page.waitForTimeout(1100);
  await page.locator('[data-auto-toggle]').click();
  await page.waitForTimeout(1000);

  const heroLimit = () =>
    page.evaluate(() => {
      const m = [...document.querySelectorAll('.auto-metric')].find((el) => el.textContent?.includes('1일 손실 한도'));
      return m?.querySelector('b')?.textContent?.trim() ?? '';
    });

  check((await heroLimit()) === '−4.5%', '상단 1일 손실 한도 = −4.5%', await heroLimit());

  /* 1일 손실 한도 변경 → 저장 전 → 저장 → 즉시 반영 */
  await page.locator('.auto-daily-limit input').fill('8');
  await page.waitForTimeout(350);
  const pending = await page.evaluate(() => ({
    state: document.querySelector('[data-auto-guard-state]')?.textContent?.trim() ?? '',
    saveOn: document.querySelector('[data-auto-config-save]')?.disabled === false,
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct,
    dirty: document.querySelector('[data-auto-dirty-fields]')?.textContent?.trim() ?? '',
  }));
  check(pending.state === '저장 안 됨' && /저장 안 됨/.test(await text(page, '.auto-guard-save')), '변경 직후 = 저장 안 됨 배지', pending.state);
  check(pending.saveOn, '저장 버튼이 켜진다(파란 저장)', String(pending.saveOn));
  check(/1일 손실 한도/.test(pending.dirty), '바뀐 항목 = 1일 손실 한도', pending.dirty);
  check(pending.stored === 4.5, '저장 전에는 설정이 바뀌지 않는다(4.5%)', `${pending.stored}%`);
  check((await heroLimit()) === '−4.5%', '저장 전 상단 지표도 그대로(−4.5%)', await heroLimit());
  await page.locator('[data-auto-config-save]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/94-auto-guards-dirty.png` }).catch(() => {});

  await page.locator('[data-auto-config-save]').click();
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}'),
    state: document.querySelector('[data-auto-guard-state]')?.textContent?.trim() ?? '',
    saveLabel: document.querySelector('[data-auto-config-save]')?.textContent?.trim() ?? '',
    syncs: window.__auto.calls.filter((c) => c.method === 'autoTradeSync'),
    styleCard: !!document.querySelector('[data-auto-style]'),
  }));
  check(saved.stored.dailyLossPct === 8, '저장 → cota.autotrade.config.v1 에 8% 저장', `${saved.stored.dailyLossPct}%`);
  check((await heroLimit()) === '−8%', '저장 → 상단 1일 손실 한도가 즉시 −8%', await heroLimit());
  check(saved.state === '✓ 저장됨' && saved.saveLabel === '✓ 저장됨', '✓ 저장됨 피드백(배지·버튼)', `${saved.state} / ${saved.saveLabel}`);
  const lastSync = saved.syncs[saved.syncs.length - 1] ?? {};
  check(
    lastSync.dailyLossPct === 8 && lastSync.riskPct === saved.stored.riskPct,
    '저장 → 네이티브 감시(autoTradeSync)에 즉시 반영',
    JSON.stringify({ dailyLossPct: lastSync.dailyLossPct, riskPct: lastSync.riskPct }),
  );
  check(!saved.styleCard, '저장 카드 옆에 프리셋 카드가 생기지 않는다');
  await page.locator('[data-auto-config-save]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/96-auto-guards-saved.png` }).catch(() => {});

  /* 저장값은 새로고침 뒤에도 그대로 — 덮어쓰는 프리셋이 없다 */
  await page.locator('.auto-daily-limit input').fill('9');
  await page.waitForTimeout(300);
  await saveGuards(page);
  check((await storedConfig(page)).dailyLossPct === 9, '9% 저장 → 그대로', `${(await storedConfig(page)).dailyLossPct}%`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await openAuto(page);
  check((await storedConfig(page)).dailyLossPct === 9, '새로고침 뒤에도 커스텀 손실 한도 유지(9%)', `${(await storedConfig(page)).dailyLossPct}%`);
  check((await storedConfig(page)).minWinRate === 45, '새로고침 뒤에도 최소 승률 45% 유지');
  await page.locator('[data-auto-guards]').screenshot({ path: `${OUT}/95-auto-guards-saved.png` }).catch(() => {});

  check(errors.length === 0, '저장 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
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
