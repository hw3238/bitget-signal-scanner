/**
 * 🔒 회원 전용 게이트 · 회원가입 · 로그아웃 E2E (v1.5.8)
 *
 * Supabase(Auth·PostgREST)는 **가짜 서버로 가로챈다**(page.route) — 실제 DB에 테스트 계정을 남기지 않고,
 * 요청 본문을 그대로 검사해 보안 규칙(API 키 원문 전송 금지)을 증명한다.
 *
 *  1) 미로그인 방문 → **회원가입/로그인 게이트만** 뜬다.
 *     스캐너·시그널 카드·상단 헤더·하단 탭바·메뉴·설정·거래소 선택이 DOM 에 **하나도 없다**
 *     (스냅숏이 localStorage 에 있어도 그리지 않는다). 닫기·'로그인 없이 둘러보기'·게스트 배너도 없다.
 *     미로그인 동안 거래소 마켓 API 호출 0건(백그라운드 스캔 차단).
 *  2) 게이트 안에서 잘못된 비밀번호 → 한국어 안내 + 게이트 유지.
 *  3) 회원가입 → **즉시 게이트 해제** → 거래소 미선택이면 거래소 선택 화면 → 선택하면
 *     스캐너·시황·메뉴·기록·설정이 그 자리에서 모두 열린다(마켓 API 호출 재개).
 *  4) 설정에서 로그아웃 → **다시 게이트로 잠김**(탭바·헤더 DOM 소멸).
 *  5) 게이트에서 로그인 → 즉시 앱(저장된 거래소로 바로 스캐너).
 *  6) 새로고침 후에도 세션 유지(게이트 안 뜸) · 연결 동기화는 7개 화이트리스트 필드만 전송.
 *  7) 관리자 계정: 메뉴에만 🛡️ 관리자 대시보드 · 요약·목록·검색·필터·새로고침.
 *
 * 실행: npm run build && npm run auth-e2e
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

const PORT = 4191;
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const SUPABASE_HOST = 'tqizfektekneuuoyxobp.supabase.co';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 가짜 Supabase (Auth + PostgREST)                                     */
/* ------------------------------------------------------------------ */

let seq = 0;
function freshState() {
  const now = Date.now();
  const users = [
    {
      id: 'u-boss',
      email: 'boss@cota.app',
      password: 'boss1234',
      nickname: '보스',
      role: 'admin',
      preferred_exchange: 'bitget',
      created_at: new Date(now - 6 * 86400_000).toISOString(),
      last_seen_at: new Date(now - 5 * 60_000).toISOString(),
    },
    {
      id: 'u-trader',
      email: 'trader@cota.app',
      password: 'trader1234',
      nickname: '트레이더',
      role: 'user',
      preferred_exchange: 'binance',
      created_at: new Date(now - 4 * 86400_000).toISOString(),
      last_seen_at: new Date(now - 3 * 3600_000).toISOString(),
    },
    {
      id: 'u-new',
      email: 'new@cota.app',
      password: 'new12345',
      nickname: '뉴비',
      role: 'user',
      preferred_exchange: 'bitget',
      created_at: new Date(now - 2 * 86400_000).toISOString(),
      last_seen_at: new Date(now - 2 * 86400_000).toISOString(),
    },
  ];
  const connections = [
    { user_id: 'u-boss', exchange: 'bitget', mode: 'live', api_connected: true, autotrade_enabled: true, account_equity: 5000, updated_at: new Date(now - 60_000).toISOString() },
    { user_id: 'u-trader', exchange: 'binance', mode: 'demo', api_connected: false, autotrade_enabled: false, account_equity: null, updated_at: new Date(now - 3600_000).toISOString() },
  ];
  return { users, connections, tokens: new Map(), requests: [], nextId: 1, market: 0 };
}

function json(route, status, body, extraHeaders = {}) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,apikey,content-type,prefer,x-client-info',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      ...extraHeaders,
    },
    body: status === 204 ? '' : JSON.stringify(body),
  });
}

function makeSession(state, user) {
  seq += 1;
  const access = `at-${user.id}-${seq}`;
  const refresh = `rt-${user.id}-${seq}`;
  state.tokens.set(access, user.id);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' },
  };
}

function publicProfile(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    preferred_exchange: user.preferred_exchange,
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
  };
}

async function handleSupabase(route, request, state) {
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();

  if (method === 'OPTIONS') {
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,apikey,content-type,prefer,x-client-info',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      },
    });
  }

  const body = request.postData() ? JSON.parse(request.postData()) : null;
  const auth = request.headers()['authorization'] ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const userId = state.tokens.get(token) ?? null;
  const me = state.users.find((u) => u.id === userId) ?? null;
  const isAdmin = me?.role === 'admin';

  state.requests.push({ method, path, search: url.search, body, token });

  /* ---------------- Auth ---------------- */
  if (path === '/auth/v1/signup') {
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (state.users.some((u) => u.email.toLowerCase() === email)) {
      return json(route, 400, { error_code: 'user_already_exists', msg: 'User already registered' });
    }
    const user = {
      id: `u-${state.nextId++}`,
      email,
      password: String(body?.password ?? ''),
      nickname: String(body?.data?.nickname ?? email.split('@')[0]),
      role: 'user',
      preferred_exchange: 'bitget',
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      // 실제 Supabase 는 가입만으로 프로필 행을 만들지 않는다(트리거 없음) — 클라이언트 INSERT 를 검증한다.
      hasProfile: false,
    };
    state.users.push(user);
    return json(route, 200, makeSession(state, user));
  }

  if (path === '/auth/v1/token' || path === '/auth/v1/token/') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const email = String(body?.email ?? '').trim().toLowerCase();
      const user = state.users.find((u) => u.email.toLowerCase() === email && u.password === body?.password);
      if (!user) return json(route, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(route, 200, makeSession(state, user));
    }
    if (grant === 'refresh_token') {
      // refresh 토큰은 세션을 다시 발급한다(만료 시뮬레이션 없이도 동작 확인용)
      const user = state.users[0];
      return json(route, 200, makeSession(state, user));
    }
    return json(route, 400, { error_code: 'unsupported_grant_type', msg: 'unsupported grant_type' });
  }

  if (path === '/auth/v1/logout') {
    state.tokens.delete(token);
    return json(route, 204, {});
  }

  /* ---------------- PostgREST ---------------- */
  if (!me) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });

  if (path === '/rest/v1/cota_profiles') {
    if (method === 'GET') {
      const idFilter = url.searchParams.get('id');
      const withProfile = state.users.filter((u) => u.hasProfile !== false);
      const rows = idFilter
        ? withProfile.filter((u) => u.id === idFilter.replace(/^eq\./, ''))
        : isAdmin
          ? withProfile
          : withProfile.filter((u) => u.id === me.id);
      return json(route, 200, rows.map(publicProfile));
    }
    if (method === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      if (row?.role === 'admin' && !isAdmin) {
        return json(route, 403, { code: '42501', message: 'new row violates row-level security policy for table "cota_profiles"' });
      }
      // 가입(auth.users)만 된 유저는 프로필 행이 아직 없다 — 클라이언트 INSERT 가 그 행을 만든다.
      const existing = state.users.find((u) => u.id === row?.id && u.hasProfile !== false);
      if (existing) return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      const authUser = state.users.find((u) => u.id === row?.id);
      const user = authUser ?? { id: row.id, password: me.password };
      Object.assign(user, {
        email: row.email,
        nickname: row.nickname,
        role: 'user',
        preferred_exchange: row.preferred_exchange ?? 'bitget',
        created_at: user.created_at ?? new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        hasProfile: true,
      });
      if (!authUser) state.users.push(user);
      return json(route, 201, [publicProfile(user)]);
    }
    if (method === 'PATCH') {
      const idFilter = url.searchParams.get('id')?.replace(/^eq\./, '');
      const user = state.users.find((u) => u.id === idFilter);
      if (!user) return json(route, 200, []);
      if (body?.role !== undefined) {
        return json(route, 403, { code: '42501', message: 'permission denied for table cota_profiles' });
      }
      if (body?.nickname) user.nickname = body.nickname;
      if (body?.preferred_exchange) user.preferred_exchange = body.preferred_exchange;
      if (body?.last_seen_at) user.last_seen_at = body.last_seen_at;
      return json(route, 200, [publicProfile(user)]);
    }
  }

  if (path === '/rest/v1/cota_connections') {
    if (method === 'GET') {
      const rows = isAdmin ? state.connections : state.connections.filter((c) => c.user_id === me.id);
      return json(route, 200, rows);
    }
    if (method === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      if (!row?.user_id) return json(route, 400, { message: 'user_id required' });
      // 실제 DB 처럼 profiles FK 를 강제한다 — 가입 직후 첫 동기화가 프로필 INSERT 보다 먼저 오면 409.
      const owner = state.users.find((u) => u.id === row.user_id);
      if (!owner || owner.hasProfile === false) {
        return json(route, 409, { code: '23503', message: 'insert or update on table "cota_connections" violates foreign key constraint' });
      }
      const idx = state.connections.findIndex((c) => c.user_id === row.user_id);
      if (idx >= 0) state.connections[idx] = { ...state.connections[idx], ...row };
      else state.connections.push({ ...row });
      return json(route, 201, []);
    }
  }

  return json(route, 404, { message: `unhandled ${method} ${path}` });
}

/* ---------------- 서버 ---------------- */
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(APP_URL);
    if (r.ok) break;
  } catch {
    /* 아직 안 떴다 */
  }
  await sleep(300);
}

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (a, b, detail) => {
  const name = typeof a === 'string' ? a : String(b);
  const ok = typeof a === 'string' ? !!b : !!a;
  checks.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** 앱이 복원하는 스캔 스냅숏 — 실 API 없이도 시그널 카드가 결정적으로 뜬다. */
function seedScript({ exchange = null, snapshot = true } = {}) {
  const now = Date.now();
  const signal = {
    id: `BTCUSDT|1H|long|${now}`,
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
  const contract = { symbol: 'BTCUSDT', base: 'BTC', asset: 'crypto', isRwa: false, decimals: 1, minTradeNum: 0.001, volumePlace: 3, minTradeUsdt: 5 };
  const stats = { n: 12, wins: 8, losses: 4, opens: 0, winRate: 62, avgWinR: 2.4, avgLossR: 0.9, rr: 2, expectancy: 0.95, totalR: 11.4, score: 7, movePct: 12, avgRiskPct: 1.2 };
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
  if (exchange) localStorage.setItem('cota.exchange.v1', exchange);
  localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0, leverageMode: 'auto', leverage: 10, minRR: 1.5, riskPct: 1.5, sound: false, notifyEnabled: false }));
  localStorage.setItem('cota.autotrade.migrated.cryptoDefault.v1', '1');
  localStorage.setItem('cota.autotrade.migrated.entryGate.v157', '1');
  if (!snapshot) return;
  localStorage.setItem(
    'cota.scan.snapshot.v2',
    JSON.stringify({ v: 2, exchange: exchange ?? 'bitget', at: now, contracts: [contract], markets: 1, analyses: [analysis], signals: [signal], tickers: [] }),
  );
}

/** 화면에 그려진 '앱' 조각 — 게이트 상태에서는 전부 0 이어야 한다. */
const DOM_PROBE = () => ({
  gate: document.querySelectorAll('[data-auth-gate]').length,
  gateState: document.querySelector('[data-auth-gate]')?.getAttribute('data-auth-state') ?? null,
  boot: document.querySelectorAll('[data-auth-boot]').length,
  tabs: document.querySelectorAll('[data-tab]').length,
  bottomNav: document.querySelectorAll('.bottom-nav').length,
  appBar: document.querySelectorAll('.app-bar').length,
  scanner: document.querySelectorAll('.scanner-tab').length,
  signalCards: document.querySelectorAll('.signal-card').length,
  market: document.querySelectorAll('.market-tab').length,
  menu: document.querySelectorAll('.menu-tab, .menu-hub').length,
  settings: document.querySelectorAll('.settings-tab').length,
  history: document.querySelectorAll('.history-tab').length,
  exchangeGate: document.querySelectorAll('[data-exchange-gate]').length,
  exchangeChip: document.querySelectorAll('[data-exchange-chip]').length,
  guestBtn: document.querySelectorAll('[data-auth-guest]').length,
  banner: document.querySelectorAll('[data-auth-banner]').length,
  closeBtn: document.querySelectorAll('[data-auth-close]').length,
  guestRow: [...document.querySelectorAll('button')].filter((b) => /둘러보기|게스트/.test(b.textContent ?? '')).length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
});

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const newContext = async (state, { exchange = null, snapshot = true, desktop = false } = {}) => {
    const context = await browser.newContext({
      viewport: desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 },
      deviceScaleFactor: 2,
      ...(desktop ? {} : { isMobile: true, hasTouch: true }),
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    await context.addInitScript(seedScript, { exchange, snapshot });
    await context.route(`**://${SUPABASE_HOST}/**`, (route, request) => handleSupabase(route, request, state));
    // 마켓 API 는 끊되 **호출 횟수는 센다** — 게이트 동안 0건, 로그인 뒤 재개를 증명한다.
    for (const host of ['api.bitget.com', 'api.binance.com', 'fapi.binance.com']) {
      await context.route(`**://${host}/**`, (route) => {
        state.market += 1;
        return route.abort();
      });
    }
    await context.route('**://api.github.com/**', (route) => route.abort());
    return context;
  };

  const waitState = async (fn, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() < start + timeout) {
      if (fn()) return true;
      await sleep(60);
    }
    return false;
  };

  /* ================= 1. 미로그인 = 잠금 게이트 ================= */
  const state = freshState();
  const context = await newContext(state); // 거래소 선택값 없음 · 스냅숏은 심어 둔다
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-auth-gate]', { timeout: 60000 });
  await page.waitForTimeout(900);

  const locked = await page.evaluate(DOM_PROBE);
  check('미로그인: 회원가입/로그인 게이트가 전체 화면으로 뜬다', locked.gate === 1 && locked.gateState === 'locked', `gate=${locked.gate}`);
  check('미로그인: 하단 탭바 DOM 없음', locked.bottomNav === 0);
  check('미로그인: 상단 헤더 DOM 없음', locked.appBar === 0);
  check('미로그인: 탭 버튼 0개(스캐너·시황·메뉴·기록·설정 접근 불가)', locked.tabs === 0);
  check('미로그인: 스캐너 화면 없음', locked.scanner === 0);
  check('미로그인: 시그널 카드 0장(스냅숏이 있어도 그리지 않는다)', locked.signalCards === 0);
  check('미로그인: 시황·메뉴·설정·기록 화면 모두 없음', locked.market === 0 && locked.menu === 0 && locked.settings === 0 && locked.history === 0);
  check('미로그인: 거래소 선택 화면·헤더 칩 없음', locked.exchangeGate === 0 && locked.exchangeChip === 0);
  check('미로그인: 닫기 버튼 없음(게이트를 닫을 수 없다)', locked.closeBtn === 0, String(locked.closeBtn));
  check('미로그인: "로그인 없이 둘러보기"·게스트 문구 없음', locked.guestBtn === 0 && locked.guestRow === 0);
  check('미로그인: 게스트 배너 없음', locked.banner === 0);
  check('미로그인: 390px 가로 오버플로 0건', !locked.overflow);
  const gateText = clean(await page.locator('[data-auth-gate]').innerText());
  check('게이트 문구: 회원 전용 안내 + 회원가입 폼', /회원 전용/.test(gateText) && gateText.includes('닉네임') && gateText.includes('이메일') && gateText.includes('비밀번호'));
  check('미로그인: 마켓 API 호출 0건(백그라운드 스캔 차단)', state.market === 0, `${state.market}건`);
  check('미로그인: 저장된 세션 없음', (await page.evaluate(() => localStorage.getItem('cota.auth.session.v1'))) === null);
  await page.screenshot({ path: `${OUT}/130-auth-gate-locked.png` });

  /* 게이트는 Escape·배경 클릭으로 닫히지 않는다 */
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  await page.waitForTimeout(250);
  check('미로그인: Escape·배경 클릭으로도 게이트가 닫히지 않는다', (await page.locator('[data-auth-gate]').count()) === 1);

  /* ================= 2. 게이트 안 로그인 오류 ================= */
  await page.locator('[data-auth-tab="login"]').click();
  await page.locator('[data-auth-field="email"]').fill('trader@cota.app');
  await page.locator('[data-auth-field="password"]').fill('wrongpass1');
  await page.locator('[data-auth-submit]').click();
  await page.waitForSelector('[data-auth-error]', { timeout: 15000 });
  const wrong = clean(await page.locator('[data-auth-error]').innerText());
  check('게이트 로그인: 잘못된 비밀번호 → 한국어 안내', wrong.includes('이메일 또는 비밀번호가 맞지 않습니다'), wrong);
  check('게이트 로그인 실패 → 게이트 유지(앱 DOM 여전히 0)', (await page.evaluate(DOM_PROBE)).tabs === 0);
  await page.screenshot({ path: `${OUT}/131-auth-gate-login.png` });

  /* ================= 3. 회원가입 → 즉시 해제 ================= */
  await page.locator('[data-auth-tab="signup"]').click();
  await page.locator('[data-auth-submit]').click();
  await page.waitForTimeout(250);
  check('가입 검증: 빈 값 → 닉네임 안내', clean(await page.locator('[data-auth-error]').innerText()).includes('닉네임'));

  await page.locator('[data-auth-field="nickname"]').fill('테스터');
  await page.locator('[data-auth-field="email"]').fill('tester@cota.app');
  await page.locator('[data-auth-field="password"]').fill('cota1234');
  await page.screenshot({ path: `${OUT}/132-auth-gate-signup.png` });
  await page.locator('[data-auth-submit]').click();
  await page.waitForSelector('[data-auth-gate]', { state: 'detached', timeout: 20000 });
  check('가입 성공 → 게이트가 그 자리에서 사라진다', true);

  // 거래소를 고르지 않았으므로 다음 화면은 거래소 선택 — 앱 탭은 아직 없다.
  await page.waitForSelector('[data-exchange-gate]', { timeout: 15000 });
  const afterSignup = await page.evaluate(DOM_PROBE);
  check('가입 직후: 거래소 미선택이면 거래소 선택 화면', afterSignup.exchangeGate === 1 && afterSignup.tabs === 0);
  check('가입 직후: 세션이 저장됐다', !!(await page.evaluate(() => localStorage.getItem('cota.auth.session.v1'))));
  check('가입 직후: 아직 거래소를 고르기 전에는 마켓 호출 0건', state.market === 0, `${state.market}건`);
  await page.screenshot({ path: `${OUT}/133-after-signup-exchange.png` });

  await page.locator('[data-exchange-option="bitget"]').click();
  await page.waitForSelector('.scanner-tab', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const unlocked = await page.evaluate(DOM_PROBE);
  check('거래소 선택 → 게이트 없이 스캐너가 열린다', unlocked.gate === 0 && unlocked.scanner === 1);
  check('거래소 선택 → 상단 헤더·하단 탭바 복귀', unlocked.appBar === 1 && unlocked.bottomNav === 1);
  const tabKeys = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-tab]')].map((el) => el.getAttribute('data-tab')))]);
  check(
    '거래소 선택 → 상단·하단 탭(스캐너·시황·메뉴·기록·설정) 모두 복귀',
    ['scanner', 'market', 'menu', 'history', 'settings'].every((k) => tabKeys.includes(k)) && unlocked.tabs >= 9,
    `${unlocked.tabs}개 · ${tabKeys.join(',')}`,
  );
  check('로그인 뒤: 백그라운드 스캔 재개(마켓 API 호출 발생)', state.market > 0, `${state.market}건`);
  await page.screenshot({ path: `${OUT}/134-member-scanner.png` });

  /* 모든 메뉴가 즉시 열린다 */
  const tabsWork = {};
  for (const [key, sel] of [
    ['market', '.market-tab'],
    ['menu', '[data-account-card]'],
    ['history', '.history-tab'],
    ['settings', '.settings-tab'],
  ]) {
    await page.locator(`.bottom-nav button[data-tab="${key}"]`).click();
    await page.waitForSelector(sel, { timeout: 20000 });
    tabsWork[key] = true;
  }
  check('가입 직후: 시황·메뉴·기록·설정이 모두 그 자리에서 열린다', Object.values(tabsWork).every(Boolean));

  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForSelector('[data-account-card]', { timeout: 10000 });
  const memberCard = await page.evaluate(() => {
    const card = document.querySelector('[data-account-card]');
    return {
      state: card?.getAttribute('data-account-state'),
      role: card?.getAttribute('data-account-role'),
      text: card?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });
  check('메뉴 계정 카드 = 회원(테스터 · 일반)', memberCard.state === 'member' && memberCard.role === 'user' && memberCard.text.includes('테스터'), memberCard.text.slice(0, 50));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/135-member-menu.png` });

  const signupReq = state.requests.find((r) => r.path === '/auth/v1/signup');
  check('요청: 가입 닉네임을 metadata 로 전송', signupReq?.body?.data?.nickname === '테스터', JSON.stringify(signupReq?.body));
  const insertReq = state.requests.find((r) => r.path === '/rest/v1/cota_profiles' && r.method === 'POST');
  const insertRow = Array.isArray(insertReq?.body) ? insertReq?.body?.[0] : insertReq?.body;
  check('요청: 프로필 INSERT = role user · 선호 거래소 bitget', insertRow?.role === 'user' && insertRow?.preferred_exchange === 'bitget', JSON.stringify(insertRow));

  /* ================= 4. 연결 동기화 (7개 필드) ================= */
  await page.locator('.menu-auto[data-menu="auto"]').click();
  await page.waitForSelector('[data-auto-hero]', { timeout: 20000 });
  await page.locator('[data-auto-toggle]').click();
  const autoSynced = await waitState(
    () => state.requests.some((r) => r.path === '/rest/v1/cota_connections' && r.body?.[0]?.autotrade_enabled === true),
    8000,
  );
  check('자동매매 ON → cota_connections.autotrade_enabled = true', autoSynced);

  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-exchange-chip]').click();
  await page.waitForSelector('[data-exchange-option="binance"]', { timeout: 10000 });
  await page.locator('[data-exchange-option="binance"]').click();
  const exSynced = await waitState(
    () => state.requests.some((r) => r.path === '/rest/v1/cota_connections' && r.body?.[0]?.exchange === 'binance'),
    8000,
  );
  check('거래소 전환(바이낸스) → cota_connections.exchange = binance', exSynced);

  const connBodies = state.requests.filter((r) => r.path === '/rest/v1/cota_connections' && r.method === 'POST').map((r) => JSON.stringify(r.body));
  const firstConn = state.requests.find((r) => r.path === '/rest/v1/cota_connections' && r.method === 'POST');
  const connKeys = Object.keys(firstConn?.body?.[0] ?? {}).sort();
  check(
    '연결 행 키 = user_id·exchange·mode·api_connected·autotrade_enabled·account_equity·updated_at',
    connKeys.join(',') === 'account_equity,api_connected,autotrade_enabled,exchange,mode,updated_at,user_id',
    connKeys.join(','),
  );
  check('보안: 어떤 연결 요청에도 API Key·Secret·Passphrase 원문이 없다', connBodies.every((b) => !/secret|passphrase|api[_-]?key|bg_/i.test(b)), `${connBodies.length}건 검사`);

  /* ================= 5. 로그아웃 → 다시 잠김 ================= */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('.settings-tab [data-account-card]', { timeout: 20000 });
  await page.locator('.settings-tab [data-account-logout]').click();
  await page.waitForSelector('[data-auth-gate]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const afterLogout = await page.evaluate(DOM_PROBE);
  check('로그아웃 → 즉시 게이트로 잠긴다', afterLogout.gate === 1 && afterLogout.gateState === 'locked');
  check('로그아웃 → 탭바·헤더·스캐너·설정 DOM 소멸', afterLogout.tabs === 0 && afterLogout.bottomNav === 0 && afterLogout.appBar === 0 && afterLogout.scanner === 0 && afterLogout.settings === 0);
  check('로그아웃 → 세션 삭제', (await page.evaluate(() => localStorage.getItem('cota.auth.session.v1'))) === null);
  await page.screenshot({ path: `${OUT}/136-logout-locked.png` });

  await page.waitForTimeout(1500);
  const marketAtLogout = state.market;
  await page.waitForTimeout(2500);
  check('로그아웃 뒤: 마켓 API 호출이 멈춘다', state.market === marketAtLogout, `${marketAtLogout} → ${state.market}`);

  /* ================= 6. 게이트에서 로그인 → 즉시 앱 ================= */
  await page.locator('[data-auth-tab="login"]').click();
  await page.locator('[data-auth-field="email"]').fill('tester@cota.app');
  await page.locator('[data-auth-field="password"]').fill('cota1234');
  await page.locator('[data-auth-submit]').click();
  await page.waitForSelector('[data-auth-gate]', { state: 'detached', timeout: 20000 });
  // 거래소는 저장돼 있다(마지막에 바이낸스로 전환) → 거래소 선택 없이 바로 앱.
  await page.waitForSelector('.scanner-tab', { timeout: 20000 });
  const relogin = await page.evaluate(DOM_PROBE);
  check('게이트 로그인 → 즉시 앱(저장된 거래소로 스캐너)', relogin.scanner === 1 && relogin.tabs >= 9 && relogin.gate === 0, `tab ${relogin.tabs}`);
  check('게이트 로그인 → 마지막 거래소 유지(바이낸스)', (await page.evaluate(() => localStorage.getItem('cota.exchange.v1'))) === 'binance');

  /* ================= 7. 새로고침 후 세션 유지 ================= */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.scanner-tab', { timeout: 60000 });
  await page.waitForTimeout(600);
  const persisted = await page.evaluate(DOM_PROBE);
  check('새로고침 후에도 세션 유지 → 게이트가 뜨지 않는다', persisted.gate === 0 && persisted.scanner === 1);

  const ignorable = (t) =>
    /api\.github\.com|api\.bitget\.com|api\.binance\.com|fapi\.binance\.com|rate limit|Failed to fetch|net::ERR|400|401|403|409/i.test(t);
  const realErrors = consoleErrors.filter((t) => !ignorable(t));
  check('콘솔 오류 0건(거래소 API 차단 로그 제외)', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  check('페이지 예외 0건', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await context.close();

  /* ================= 8. 가입 직후 '바로 사용' 화면(거래소 기억) ================= */
  const quickState = freshState();
  const quickCtx = await newContext(quickState, { exchange: 'bitget' });
  const quick = await quickCtx.newPage();
  await quick.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await quick.waitForSelector('[data-auth-gate]', { timeout: 60000 });
  const beforeSignupCards = await quick.evaluate(() => document.querySelectorAll('.signal-card').length);
  check('게이트 상태: 스냅숏이 있어도 시그널 카드는 0장', beforeSignupCards === 0, String(beforeSignupCards));
  await quick.locator('[data-auth-field="nickname"]').fill('바로시작');
  await quick.locator('[data-auth-field="email"]').fill('quick@cota.app');
  await quick.locator('[data-auth-field="password"]').fill('cota1234');
  await quick.locator('[data-auth-submit]').click();
  await quick.waitForSelector('[data-auth-gate]', { state: 'detached', timeout: 20000 });
  await quick.waitForSelector('.scanner-tab', { timeout: 20000 });
  await quick.waitForTimeout(1200);
  const instant = await quick.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    tabs: document.querySelectorAll('[data-tab]').length,
  }));
  check('거래소가 기억된 기기: 가입 직후 게이트 없이 스캐너 + 시그널 카드', instant.tabs >= 9 && instant.cards >= 1, `탭 ${instant.tabs} · 카드 ${instant.cards}장`);
  await quick.screenshot({ path: `${OUT}/137-member-instant.png` });
  await quickCtx.close();

  /* ================= 9. 데스크톱 게이트 ================= */
  const deskState = freshState();
  const deskCtx = await newContext(deskState, { desktop: true });
  const desk = await deskCtx.newPage();
  await desk.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('[data-auth-gate]', { timeout: 60000 });
  await desk.waitForTimeout(600);
  const deskProbe = await desk.evaluate(DOM_PROBE);
  check('데스크톱(1280px): 게이트만 · 탭 0 · 가로 오버플로 0', deskProbe.gate === 1 && deskProbe.tabs === 0 && !deskProbe.overflow);
  await desk.screenshot({ path: `${OUT}/138-auth-gate-desktop.png` });
  await deskCtx.close();

  /* ================= 10. 관리자 ================= */
  const adminState = freshState();
  const adminCtx = await newContext(adminState, { exchange: 'bitget' });
  const admin = await adminCtx.newPage();
  const adminErrors = [];
  admin.on('pageerror', (e) => adminErrors.push(String(e)));
  admin.on('console', (m) => {
    if (m.type() === 'error') adminErrors.push(m.text());
  });
  await admin.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('[data-auth-gate]', { timeout: 60000 });
  await admin.locator('[data-auth-tab="login"]').click();
  await admin.locator('[data-auth-field="email"]').fill('boss@cota.app');
  await admin.locator('[data-auth-field="password"]').fill('boss1234');
  await admin.locator('[data-auth-submit]').click();
  await admin.waitForSelector('[data-auth-gate]', { state: 'detached', timeout: 20000 });
  await admin.waitForSelector('.scanner-tab', { timeout: 20000 });
  check('관리자 로그인 → 게이트 해제(거래소 기억 → 스캐너)', (await admin.locator('.scanner-tab').count()) === 1);

  // 관리자 본인 기기의 상태(모의·API 미연결)가 본인 연결 행을 덮어쓰는 것은 실제 동작이다.
  // 대시보드 기대값을 고정하기 위해, 동기화가 끝난 뒤 시드 상태로 되돌리고 새로고침으로 읽는다.
  await waitState(
    () => adminState.requests.some((r) => r.path === '/rest/v1/cota_connections' && r.method === 'POST' && r.body?.[0]?.user_id === 'u-boss'),
    6000,
  );
  adminState.connections = [
    { user_id: 'u-boss', exchange: 'bitget', mode: 'live', api_connected: true, autotrade_enabled: true, account_equity: 5000, updated_at: new Date().toISOString() },
    { user_id: 'u-trader', exchange: 'binance', mode: 'demo', api_connected: false, autotrade_enabled: false, account_equity: null, updated_at: new Date().toISOString() },
  ];
  await admin.locator('.bottom-nav button[data-tab="menu"]').click();
  await admin.waitForSelector('[data-admin-group]', { timeout: 15000 });
  const adminMenu = await admin.evaluate(() => ({
    role: document.querySelector('[data-account-card]')?.getAttribute('data-account-role'),
    group: document.querySelector('[data-admin-group]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    row: !!document.querySelector('[data-menu="admin"]'),
    normal: !!document.querySelector('[data-menu="surge"]'),
  }));
  check('관리자: 계정 카드 role=admin · 관리자 배지', adminMenu.role === 'admin');
  check('관리자: 메뉴에 🛡️ 관리자 대시보드가 생긴다', adminMenu.row && adminMenu.group.includes('관리자 대시보드'), adminMenu.group.slice(0, 40));
  check('관리자: 기존 실전 레이더 메뉴는 그대로', adminMenu.normal);
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.waitForTimeout(200);
  await admin.screenshot({ path: `${OUT}/139-admin-menu.png` });

  await admin.locator('[data-menu="admin"]').click();
  await admin.waitForSelector('[data-admin-dashboard]', { timeout: 20000 });
  await admin.waitForTimeout(600);

  const dash = await admin.evaluate(() => ({
    total: document.querySelector('[data-admin-total]')?.getAttribute('data-admin-total'),
    api: document.querySelector('[data-admin-api]')?.getAttribute('data-admin-api'),
    auto: document.querySelector('[data-admin-auto]')?.getAttribute('data-admin-auto'),
    dist: document.querySelector('[data-admin-exchanges]')?.getAttribute('data-admin-exchanges'),
    rows: [...document.querySelectorAll('[data-admin-row]')].map((el) => el.getAttribute('data-admin-email')),
    text: document.querySelector('[data-admin-dashboard]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('대시보드 요약: 총 가입 3명', dash.total === '3', String(dash.total));
  check('대시보드 요약: API 연결 1명', dash.api === '1', String(dash.api));
  check('대시보드 요약: 자동매매 ON 1명', dash.auto === '1', String(dash.auto));
  check('대시보드 요약: 거래소 분포 비트겟 1 · 바이낸스 1', dash.dist === '1:1', String(dash.dist));
  check('대시보드 목록: 유저 3명', dash.rows.length === 3, dash.rows.join(','));
  check(
    '대시보드: 닉네임·이메일·권한·연결 상태 표시',
    dash.text.includes('보스') && dash.text.includes('boss@cota.app') && dash.text.includes('관리자') && dash.text.includes('연결됨 · 실거래'),
  );
  check('대시보드 390px 가로 오버플로 0건', !dash.overflow);
  await admin.screenshot({ path: `${OUT}/140-admin-dashboard.png` });

  await admin.locator('[data-admin-search]').fill('trader');
  await admin.waitForTimeout(250);
  const filtered = await admin.evaluate(() =>
    [...document.querySelectorAll('[data-admin-row]')].map((el) => el.getAttribute('data-admin-email')),
  );
  check('검색: "trader" → 1명', filtered.length === 1 && filtered[0] === 'trader@cota.app', filtered.join(','));
  await admin.locator('[data-admin-search]').fill('');
  await admin.locator('[data-admin-filter="admin"]').click();
  await admin.waitForTimeout(250);
  const adminOnly = await admin.evaluate(() =>
    [...document.querySelectorAll('[data-admin-row]')].map((el) => el.getAttribute('data-admin-email')),
  );
  check('필터: 관리자만 → 1명', adminOnly.length === 1 && adminOnly[0] === 'boss@cota.app', adminOnly.join(','));

  await admin.locator('[data-admin-filter="all"]').click();
  const beforeRefresh = adminState.requests.filter((r) => r.path === '/rest/v1/cota_profiles' && r.method === 'GET').length;
  await admin.locator('[data-admin-refresh]').click();
  const refreshed = await waitState(
    () => adminState.requests.filter((r) => r.path === '/rest/v1/cota_profiles' && r.method === 'GET').length > beforeRefresh,
    6000,
  );
  check('새로고침 → Supabase 재조회', refreshed);
  check('관리자 화면 콘솔/예외 0건', adminErrors.filter((t) => !ignorable(t)).length === 0, adminErrors.slice(0, 2).join(' | '));
  await adminCtx.close();

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log('');
  console.log(`COTA 회원 전용 게이트 E2E: ${checks.length - failed.length}/${checks.length} 통과`);
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
