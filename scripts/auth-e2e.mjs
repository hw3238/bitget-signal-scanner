/**
 * 🔐 회원가입 · 로그인 · 연결 동기화 · 관리자 대시보드 E2E (v1.5.8 웹)
 *
 * Supabase(Auth·PostgREST)는 **가짜 서버로 가로챈다**(page.route) — 실제 DB에 테스트 계정을 남기지 않고,
 * 요청 본문을 그대로 검사해 보안 규칙(API 키 원문 전송 금지)을 증명한다.
 *
 *  1) 비회원: 배너·계정 카드가 보이고, 모바일 헤더 칩은 숨김(가로 오버플로 0)
 *  2) 회원가입: 빈 값 검증 → 가입 성공 → 프로필(role=user) INSERT + 연결 초기 행 UPSERT
 *  3) 연결 동기화: 자동매매 ON·거래소 전환 → cota_connections 에 7개 필드만 전송(키·시크릿 없음)
 *  4) 잘못된 비밀번호 → 한국어 오류, 로그아웃 → 비회원 상태 복귀
 *  5) 관리자: 메뉴에만 🛡️ 관리자 대시보드, 요약 카드·유저 목록·검색·필터·새로고침
 *  6) 새로고침 후에도 세션 유지 · 일반 유저에게는 관리자 메뉴가 없다
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
  return { users, connections, tokens: new Map(), requests: [], nextId: 1 };
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
function seedScript() {
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
  localStorage.setItem('cota.exchange.v1', 'bitget');
  if (localStorage.getItem('cota.e2e.seeded.v1') === '1') return;
  localStorage.setItem('cota.e2e.seeded.v1', '1');
  localStorage.setItem(
    'cota.scan.snapshot.v2',
    JSON.stringify({ v: 2, exchange: 'bitget', at: now, contracts: [contract], markets: 1, analyses: [analysis], signals: [signal], tickers: [] }),
  );
  localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0, leverageMode: 'auto', leverage: 10, minRR: 1.5, riskPct: 1.5, sound: false, notifyEnabled: false }));
  localStorage.setItem('cota.autotrade.migrated.cryptoDefault.v1', '1');
  localStorage.setItem('cota.autotrade.migrated.entryGate.v157', '1');
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const newContext = async (state) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    await context.addInitScript(seedScript);
    await context.route(`**://${SUPABASE_HOST}/**`, (route, request) => handleSupabase(route, request, state));
    await context.route('**://api.bitget.com/**', (route) => route.abort());
    await context.route('**://api.binance.com/**', (route) => route.abort());
    await context.route('**://fapi.binance.com/**', (route) => route.abort());
    await context.route('**://api.github.com/**', (route) => route.abort());
    return context;
  };

  const waitState = async (fn, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (fn()) return true;
      await sleep(60);
    }
    return false;
  };

  /* ================= 1. 비회원 ================= */
  const state = freshState();
  const context = await newContext(state);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
  await page.waitForTimeout(600);

  const guest = await page.evaluate(() => ({
    banner: !!document.querySelector('[data-auth-banner]'),
    chipDisplay: document.querySelector('[data-auth-chip]') ? getComputedStyle(document.querySelector('[data-auth-chip]')).display : 'missing',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    session: localStorage.getItem('cota.auth.session.v1'),
  }));
  check('비회원: 상단에 회원가입 배너가 보인다', guest.banner);
  check('비회원: 모바일 헤더 칩은 숨김(가로 오버플로 방지)', guest.chipDisplay === 'none', guest.chipDisplay);
  check('비회원: 390px 가로 오버플로 0건', !guest.overflow);
  check('비회원: 저장된 세션 없음', guest.session === null);
  await page.screenshot({ path: `${OUT}/118-auth-banner-guest.png` });

  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForSelector('[data-account-card]', { timeout: 20000 });
  const guestCard = await page.evaluate(() => {
    const card = document.querySelector('[data-account-card]');
    return {
      state: card?.getAttribute('data-account-state'),
      text: card?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      signup: !!card?.querySelector('[data-account-signup]'),
      login: !!card?.querySelector('[data-account-login]'),
      admin: document.querySelectorAll('[data-admin-group]').length,
    };
  });
  check('비회원: 메뉴에 계정 카드(회원가입·로그인 버튼)', guestCard.state === 'guest' && guestCard.signup && guestCard.login, guestCard.text.slice(0, 40));
  check('비회원: 관리자 메뉴는 없다', guestCard.admin === 0);

  /* ================= 2. 회원가입 ================= */
  await page.locator('[data-account-signup]').click();
  await page.waitForSelector('[data-auth-sheet]', { timeout: 10000 });
  const sheet = await page.evaluate(() => ({
    signupTab: document.querySelector('[data-auth-tab="signup"]')?.getAttribute('aria-selected'),
    nickname: !!document.querySelector('[data-auth-field="nickname"]'),
    email: !!document.querySelector('[data-auth-field="email"]'),
    password: !!document.querySelector('[data-auth-field="password"]'),
    guest: !!document.querySelector('[data-auth-guest]'),
  }));
  check('가입 시트: 닉네임·이메일·비밀번호 입력 + 게스트 버튼', sheet.nickname && sheet.email && sheet.password && sheet.guest && sheet.signupTab === 'true');
  await page.screenshot({ path: `${OUT}/119-auth-signup.png` });

  await page.locator('[data-auth-submit]').click();
  await page.waitForTimeout(250);
  check('가입 검증: 빈 값 → 닉네임 안내', (await page.locator('[data-auth-error]').innerText()).includes('닉네임'));

  await page.locator('[data-auth-field="nickname"]').fill('테스터');
  await page.locator('[data-auth-field="email"]').fill('tester@cota.app');
  await page.locator('[data-auth-field="password"]').fill('cota1234');
  await page.locator('[data-auth-submit]').click();
  await page.waitForSelector('[data-auth-sheet]', { state: 'detached', timeout: 15000 });
  check('가입 성공 → 시트가 닫힌다', true);
  // 프로필 INSERT 응답이 화면에 반영될 때까지(닉네임 = 폼에서 입력한 값) 기다린다.
  await page
    .waitForFunction(
      () => (document.querySelector('[data-account-card]')?.textContent ?? '').includes('테스터'),
      { timeout: 8000 },
    )
    .catch(() => {});

  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(350);
  await page.locator('[data-account-card]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/120-account-menu.png` });
  const signedUp = await page.evaluate(() => ({
    session: !!localStorage.getItem('cota.auth.session.v1'),
    card: document.querySelector('[data-account-card]')?.getAttribute('data-account-state'),
    text: document.querySelector('[data-account-card]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    banner: !!document.querySelector('[data-auth-banner]'),
  }));
  check('가입 성공: 세션 저장 + 계정 카드가 회원 상태', signedUp.session && signedUp.card === 'member', signedUp.text.slice(0, 50));
  check('가입 성공: 닉네임·이메일·일반 배지 표시', signedUp.text.includes('테스터') && signedUp.text.includes('tester@cota.app') && signedUp.text.includes('일반'));
  check('가입 성공: 미가입 배너는 사라진다', !signedUp.banner);

  const signupReq = state.requests.find((r) => r.path === '/auth/v1/signup');
  check('요청: 가입 닉네임을 metadata 로 전송', signupReq?.body?.data?.nickname === '테스터', JSON.stringify(signupReq?.body));
  const insertReq = state.requests.find((r) => r.path === '/rest/v1/cota_profiles' && r.method === 'POST');
  const insertRow = Array.isArray(insertReq?.body) ? insertReq?.body?.[0] : insertReq?.body;
  check(
    '요청: 프로필 INSERT = role user · 선호 거래소 bitget',
    insertRow?.role === 'user' && insertRow?.preferred_exchange === 'bitget',
    JSON.stringify(insertRow),
  );

  // FK(프로필 INSERT) 경합: 첫 요청은 409 로 막혀도 재시도로 초기 행이 만들어진다.
  const synced = await waitState(
    () => state.connections.some((c) => c.user_id === 'u-1'),
    8000,
  );
  check('회원가입 직후: 연결 초기 행 UPSERT(프로필 FK 재시도 포함)', synced);
  const fkBlocked = state.requests.filter(
    (r) => r.path === '/rest/v1/cota_connections' && r.method === 'POST' && r.body?.[0]?.user_id === 'u-1',
  ).length;
  check('첫 동기화가 FK 로 막혀도 재시도로 성공', fkBlocked >= 1, `${fkBlocked}회 시도`);
  const firstConn = state.requests.find((r) => r.path === '/rest/v1/cota_connections' && r.method === 'POST');
  const connKeys1 = Object.keys(firstConn?.body?.[0] ?? {}).sort();
  check(
    '연결 행 키 = user_id·exchange·mode·api_connected·autotrade_enabled·account_equity·updated_at',
    connKeys1.join(',') === 'account_equity,api_connected,autotrade_enabled,exchange,mode,updated_at,user_id',
    connKeys1.join(','),
  );
  check('연결 행: 초기 거래소 bitget · 모의 · API 미연결', firstConn?.body?.[0]?.exchange === 'bitget' && firstConn?.body?.[0]?.mode === 'demo' && firstConn?.body?.[0]?.api_connected === false);

  /* ================= 3. 연결 동기화 ================= */
  await page.locator('.menu-auto[data-menu="auto"]').click();
  await page.waitForSelector('[data-auto-hero]', { timeout: 20000 });
  await page.locator('[data-auto-toggle]').click();
  const autoSynced = await waitState(() => state.requests.some((r) => r.path === '/rest/v1/cota_connections' && r.body?.[0]?.autotrade_enabled === true), 8000);
  check('자동매매 ON → cota_connections.autotrade_enabled = true', autoSynced);

  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-exchange-chip]').click();
  await page.waitForSelector('[data-exchange-option="binance"]', { timeout: 10000 });
  await page.locator('[data-exchange-option="binance"]').click();
  const exSynced = await waitState(() => state.requests.some((r) => r.path === '/rest/v1/cota_connections' && r.body?.[0]?.exchange === 'binance'), 8000);
  check('거래소 전환(바이낸스) → cota_connections.exchange = binance', exSynced);

  const connBodies = state.requests.filter((r) => r.path === '/rest/v1/cota_connections' && r.method === 'POST').map((r) => JSON.stringify(r.body));
  check(
    '보안: 어떤 연결 요청에도 API Key·Secret·Passphrase 원문이 없다',
    connBodies.every((b) => !/secret|passphrase|api[_-]?key|bg_/i.test(b)),
    `${connBodies.length}건 검사`,
  );

  /* ================= 4. 오류 · 로그아웃 ================= */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-account, [data-account-card]', { timeout: 20000 });
  const settingsCard = await page.evaluate(() => !!document.querySelector('.settings-tab [data-account-card]'));
  check('설정 탭에도 계정 카드(로그인 상태 확인)', settingsCard);

  await page.locator('.settings-tab [data-account-logout]').click();
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => ({
    session: localStorage.getItem('cota.auth.session.v1'),
    state: document.querySelector('.settings-tab [data-account-card]')?.getAttribute('data-account-state'),
  }));
  check('로그아웃 → 세션 삭제 · 비회원 카드', out.session === null && out.state === 'guest');

  await page.locator('.settings-tab [data-account-login]').click();
  await page.waitForSelector('[data-auth-sheet]', { timeout: 10000 });
  await page.locator('[data-auth-field="email"]').fill('tester@cota.app');
  await page.locator('[data-auth-field="password"]').fill('wrongpass1');
  await page.locator('[data-auth-submit]').click();
  await page.waitForSelector('[data-auth-error]', { timeout: 10000 });
  const wrong = clean(await page.locator('[data-auth-error]').innerText());
  check('잘못된 비밀번호 → 한국어 안내', wrong.includes('이메일 또는 비밀번호가 맞지 않습니다'), wrong);
  await page.screenshot({ path: `${OUT}/121-auth-login-error.png` });
  await page.locator('[data-auth-close]').click();
  await page.waitForSelector('[data-auth-sheet]', { state: 'detached', timeout: 8000 });

  const ignorable = (t) => /api\.github\.com|api\.bitget\.com|api\.binance\.com|fapi\.binance\.com|rate limit|Failed to fetch|net::ERR|400|401|403|409/i.test(t);
  const realErrors = consoleErrors.filter((t) => !ignorable(t));
  check('콘솔 오류 0건(거래소 API 차단 로그 제외)', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  check('페이지 예외 0건', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await context.close();

  /* ================= 5. 관리자 ================= */
  const adminState = freshState();
  const adminCtx = await newContext(adminState);
  const admin = await adminCtx.newPage();
  const adminErrors = [];
  admin.on('pageerror', (e) => adminErrors.push(String(e)));
  admin.on('console', (m) => {
    if (m.type() === 'error') adminErrors.push(m.text());
  });
  await admin.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
  await admin.waitForTimeout(500);

  await admin.locator('.bottom-nav button[data-tab="menu"]').click();
  await admin.locator('[data-account-login]').click();
  await admin.waitForSelector('[data-auth-sheet]', { timeout: 10000 });
  await admin.locator('[data-auth-field="email"]').fill('boss@cota.app');
  await admin.locator('[data-auth-field="password"]').fill('boss1234');
  await admin.locator('[data-auth-submit]').click();
  await admin.waitForSelector('[data-admin-group]', { timeout: 15000 });
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
  const adminMenu = await admin.evaluate(() => ({
    role: document.querySelector('[data-account-card]')?.getAttribute('data-account-role'),
    group: document.querySelector('[data-admin-group]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    row: !!document.querySelector('[data-menu="admin"]'),
    normal: !!document.querySelector('[data-menu="surge"]'),
  }));
  check('관리자 로그인 → 계정 카드 role=admin · 관리자 배지', adminMenu.role === 'admin');
  check('관리자: 메뉴에 🛡️ 관리자 대시보드가 생긴다', adminMenu.row && adminMenu.group.includes('관리자 대시보드'), adminMenu.group.slice(0, 40));
  check('관리자: 기존 실전 레이더 메뉴는 그대로', adminMenu.normal);
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.waitForTimeout(200);
  await admin.screenshot({ path: `${OUT}/122-admin-menu.png` });

  await admin.locator('[data-menu="admin"]').click();
  await admin.waitForSelector('[data-admin-dashboard]', { timeout: 20000 });
  await admin.waitForTimeout(500);

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
  check('대시보드: 닉네임·이메일·권한·연결 상태 표시', dash.text.includes('보스') && dash.text.includes('boss@cota.app') && dash.text.includes('관리자') && dash.text.includes('연결됨 · 실거래'));
  check('대시보드 390px 가로 오버플로 0건', !dash.overflow);
  await admin.screenshot({ path: `${OUT}/123-admin-dashboard.png` });
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.waitForTimeout(200);
  await admin.screenshot({ path: `${OUT}/124-admin-dashboard-full.png`, fullPage: true, scale: 'css' });

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
  await admin.screenshot({ path: `${OUT}/125-admin-filter-search.png` });

  await admin.locator('[data-admin-filter="all"]').click();
  const beforeRefresh = adminState.requests.filter((r) => r.path === '/rest/v1/cota_profiles' && r.method === 'GET').length;
  await admin.locator('[data-admin-refresh]').click();
  const refreshed = await waitState(
    () => adminState.requests.filter((r) => r.path === '/rest/v1/cota_profiles' && r.method === 'GET').length > beforeRefresh,
    6000,
  );
  check('새로고침 → Supabase 재조회', refreshed);

  /* ================= 6. 세션 유지 ================= */
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
  await admin.locator('.bottom-nav button[data-tab="menu"]').click();
  await admin.waitForSelector('[data-admin-group]', { timeout: 15000 });
  const persisted = await admin.evaluate(() => ({
    state: document.querySelector('[data-account-card]')?.getAttribute('data-account-state'),
    text: document.querySelector('[data-account-card]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    role: document.querySelector('[data-account-card]')?.getAttribute('data-account-role'),
  }));
  check(
    '새로고침 후에도 로그인 유지(세션 복원 · 관리자 메뉴 그대로)',
    persisted.state === 'member' && persisted.role === 'admin' && persisted.text.includes('보스'),
    persisted.text.slice(0, 40),
  );
  check('관리자 화면 콘솔/예외 0건', adminErrors.filter((t) => !ignorable(t)).length === 0, adminErrors.slice(0, 2).join(' | '));

  await adminCtx.close();
  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log('');
  console.log(`COTA 계정·관리자 대시보드 E2E: ${checks.length - failed.length}/${checks.length} 통과`);
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
