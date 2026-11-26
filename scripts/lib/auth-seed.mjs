/**
 * 🔐 회원 전용 게이트(v1.5.8) 이후의 E2E 공통 준비물.
 *
 * COTA 는 이제 **세션이 없으면 앱을 그리지 않는다**(`AuthGate`). 그래서 기존 시나리오
 * (스캐너·자동매매·설정·기록…)를 검증하려면 먼저 **유효한 테스트 세션**을 심어야 한다.
 *
 *   const context = await browser.newContext({...});
 *   await context.addInitScript(seedAuthSession);   // cota.auth.session.v1 (만료 1시간 뒤)
 *   await installFakeSupabase(context);             // 프로필·연결 API 만 가짜로 응답(실 DB 접촉 0)
 *
 * · 실제 Supabase(Auth·PostgREST)로는 아무 요청도 나가지 않는다 — 테스트 계정이 DB 에 남지 않는다.
 * · 게이트 자체를 검증하는 `auth-e2e` 는 이 세션 시드를 **쓰지 않는다**(미로그인 상태가 출발점).
 */

export const SUPABASE_HOST = 'tqizfektekneuuoyxobp.supabase.co';

/** 테스트 세션 — 실제 토큰이 아니다(가짜 서버만 이 값을 안다). */
export const TEST_SESSION = {
  accessToken: 'e2e-access-token',
  refreshToken: 'e2e-refresh-token',
  user: { id: 'e2e-user', email: 'e2e@cota.app' },
};

/** 프로필 응답 — 닉네임/권한은 시나리오에 맞춰 바꿀 수 있다. */
export const TEST_PROFILE = {
  id: TEST_SESSION.user.id,
  email: TEST_SESSION.user.email,
  nickname: '이투이',
  role: 'user',
  preferred_exchange: 'bitget',
  created_at: '2026-11-20T01:00:00.000Z',
  last_seen_at: '2026-11-26T09:00:00.000Z',
};

/**
 * `context.addInitScript(seedAuthSession)` 으로 쓴다.
 * 페이지 스크립트에서 실행되므로 Date.now() 는 그 시점의 실제 시각이다.
 */
export function seedAuthSession() {
  try {
    localStorage.setItem(
      'cota.auth.session.v1',
      JSON.stringify({
        accessToken: 'e2e-access-token',
        refreshToken: 'e2e-refresh-token',
        expiresAt: Date.now() + 3600_000,
        user: { id: 'e2e-user', email: 'e2e@cota.app' },
      }),
    );
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,prefer,x-client-info',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

/**
 * Supabase 호스트를 가짜로 응답한다(프로필 조회/생성/갱신 + 연결 upsert).
 * 읽기 전용 시나리오가 실수로 실제 DB 를 건드리지 않도록 **모든 요청을 여기서 끝낸다**.
 */
export async function installFakeSupabase(context, profile = {}, session = {}) {
  const me = {
    ...TEST_PROFILE,
    ...(session.user ? { id: session.user.id, email: session.user.email } : {}),
    ...profile,
  };
  let row = { ...me };
  const bodyOf = (request) => {
    try {
      return request.postDataJSON();
    } catch {
      return null;
    }
  };
  await context.route(`**://${SUPABASE_HOST}/**`, async (route, request) => {
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (status, body) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify(body),
      });

    if (url.pathname === '/auth/v1/logout') return json(204, {});
    if (url.pathname.startsWith('/auth/v1/token')) {
      return json(200, {
        access_token: 'e2e-refreshed',
        refresh_token: 'e2e-refresh-2',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: row.id, email: row.email, role: 'authenticated' },
      });
    }
    if (url.pathname === '/rest/v1/cota_profiles') {
      if (method === 'POST') {
        const body = bodyOf(request);
        const posted = Array.isArray(body) ? body[0] : body;
        row = { ...row, ...(posted ?? {}) };
        return json(201, [row]);
      }
      if (method === 'PATCH') {
        const body = bodyOf(request);
        row = { ...row, ...(body ?? {}) };
        return json(200, [row]);
      }
      return json(200, [row]);
    }
    if (url.pathname === '/rest/v1/cota_connections') {
      return method === 'GET' ? json(200, []) : json(201, []);
    }
    return json(200, {});
  });
}

/**
 * 앱이 시작할 때 부르는 GitHub Releases 조회를 **최신 APK 가 없는 응답**으로 고정한다.
 *  · 실제 API 는 호출 한도(403)에 걸려 'Failed to load resource: 403' 콘솔 로그를 남긴다 — 앱 오류가 아니다.
 *  · 최신 태그를 현재보다 낮게(1.5.7 < 1.5.8) 줘서 업데이트 배너가 화면을 덮지 않게 한다.
 */
export async function installFakeReleases(context) {
  await context.route('**://api.github.com/repos/**/releases/latest', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        tag_name: 'v1.5.7',
        name: 'COTA v1.5.7',
        html_url: 'https://github.com/hw3238/bitget-signal-scanner/releases/tag/v1.5.7',
        published_at: '2026-11-25T00:00:00Z',
        assets: [],
      }),
    }),
  );
}

/** E2E 공통 스텁 — 가짜 Supabase + 고정된 릴리즈 응답. */
export async function installE2EStubs(context, options = {}) {
  await installFakeSupabase(context, options.profile ?? {});
  await installFakeReleases(context);
}
