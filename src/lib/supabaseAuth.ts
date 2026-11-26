/**
 * 🔐 COTA 계정 — Supabase Auth + PostgREST 경량 래퍼 (v1.5.8 웹)
 *
 *  · 회원가입/로그인은 Supabase Auth(REST)로, 프로필·연결 내역은 PostgREST 로 다룬다.
 *    (`@supabase/supabase-js` 없이 fetch 만 쓴다 — 번들 크기·오프라인 안전)
 *  · 프론트엔드에는 **Publishable(anon) 키만** 들어간다. Secret/service_role 키는 절대 넣지 않는다.
 *  · 세션(액세스·리프레시 토큰)은 이 기기의 localStorage 에만 저장한다.
 *      - 저장 키: `cota.auth.session.v1`
 *      - 만료 60초 전이면 자동 갱신(refresh_token)한다.
 *  · **보안 절대 원칙**: 거래소 API Key / Secret / Passphrase 원문은 이 모듈로도, DB로도 보내지 않는다.
 *    연결 내역에는 `exchange·mode·api_connected·autotrade_enabled·account_equity·updated_at` 만 저장한다.
 *    (payload 는 `lib/accountSync.ts` 의 화이트리스트 함수가 만든다)
 *  · role 은 DB RLS 가 지킨다 — 앱은 가입 시 `role:'user'` 만 넣을 수 있고, 관리자 승격은 DB 에서만 가능하다.
 */

export const SUPABASE_URL = 'https://tqizfektekneuuoyxobp.supabase.co';
/** Publishable(anon) 키 — 공개되어도 되는 키. service_role/secret 키는 프론트엔드에 넣지 않는다. */
export const SUPABASE_KEY = 'sb_publishable_S7P3QAMsvZxS5fFLURA0Tg_NrtptwWV';

export const SESSION_STORAGE_KEY = 'cota.auth.session.v1';
/** 만료가 이 시간 안으로 들어오면 미리 갱신한다 */
const REFRESH_MARGIN_MS = 60_000;

export type Role = 'user' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  user: AuthUser;
}

export interface Profile {
  id: string;
  email: string;
  nickname: string;
  role: Role;
  preferredExchange: string;
  createdAt: string | null;
  lastSeenAt: string | null;
}

/** `cota_connections` 한 행 — API 키·시크릿은 이 구조에 존재하지 않는다. */
export interface ConnectionRow {
  userId: string;
  exchange: string;
  mode: 'demo' | 'live';
  apiConnected: boolean;
  autotradeEnabled: boolean;
  accountEquity: number | null;
  updatedAt: string;
}

export type AuthResult = { ok: true; session: AuthSession } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* 입력 검증 · 오류 문구 (단위 테스트 대상)                              */
/* ------------------------------------------------------------------ */

/** 이메일 형식 — 너무 엄격하면 실제 주소를 막는다. 기본형만 본다. */
export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return '이메일을 입력해 주세요.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return '이메일 형식이 맞지 않습니다.';
  if (value.length > 254) return '이메일이 너무 깁니다.';
  return null;
}

/** 비밀번호 — Supabase 최소 6자. */
export function validatePassword(password: string): string | null {
  if (!password) return '비밀번호를 입력해 주세요.';
  if (password.length < 6) return '비밀번호는 6자 이상이어야 합니다.';
  if (password.length > 72) return '비밀번호는 72자 이하로 정해 주세요.';
  return null;
}

/** 닉네임 — 2~12자, 공백만은 안 된다. */
export function validateNickname(nickname: string): string | null {
  const value = nickname.trim();
  if (!value) return '닉네임을 입력해 주세요.';
  if (value.length < 2) return '닉네임은 2자 이상이어야 합니다.';
  if (value.length > 12) return '닉네임은 12자 이하로 정해 주세요.';
  return null;
}

/**
 * Supabase 오류 → 한국어 안내.
 * GoTrue 는 `{ error_code, msg }`, PostgREST 는 `{ code, message }` 를 준다.
 */
export function authErrorMessage(input: unknown): string {
  const raw = String((input as { message?: string; msg?: string; error_description?: string })?.error_description ??
    (input as { msg?: string })?.msg ??
    (input as { message?: string })?.message ??
    input ??
    '');
  const code = String((input as { error_code?: string })?.error_code ?? '');
  const text = `${code} ${raw}`.toLowerCase();

  if (/invalid_credentials|invalid login credentials/.test(text)) return '이메일 또는 비밀번호가 맞지 않습니다.';
  if (/user_already_exists|email_exists|already registered|already been registered/.test(text))
    return '이미 가입된 이메일입니다. 로그인해 주세요.';
  if (/weak_password|password should be at least|password is too short/.test(text))
    return '비밀번호는 6자 이상이어야 합니다.';
  if (/email_address_invalid|invalid email|unable to validate email/.test(text))
    return '이메일 형식이 맞지 않습니다.';
  if (/over_email_send_rate_limit|rate limit|too many requests/.test(text))
    return '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.';
  if (/email_not_confirmed|email not confirmed/.test(text))
    return '이메일 인증이 끝나지 않았습니다. 메일함을 확인해 주세요.';
  if (/signup.*disabled|signups not allowed/.test(text)) return '지금은 새 가입을 받을 수 없습니다.';
  if (/failed to fetch|networkerror|load failed|network request failed/.test(text))
    return '인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  if (/jwt|token.*expired|invalid claim/.test(text)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (/permission denied|row-level security|42501/.test(text)) return '저장 권한이 없습니다. 다시 로그인해 주세요.';
  if (/password.*(incorrect|wrong)/.test(text)) return '이메일 또는 비밀번호가 맞지 않습니다.';
  return '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
}

/* ------------------------------------------------------------------ */
/* 세션 저장                                                            */
/* ------------------------------------------------------------------ */

export function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) return null;
    return {
      accessToken: String(parsed.accessToken),
      refreshToken: String(parsed.refreshToken),
      expiresAt: Number(parsed.expiresAt ?? 0) || 0,
      user: { id: String(parsed.user.id), email: String(parsed.user.email ?? '') },
    };
  } catch {
    return null;
  }
}

export function saveStoredSession(session: AuthSession | null): void {
  try {
    if (!session) localStorage.removeItem(SESSION_STORAGE_KEY);
    else localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

/** 만료가 임박했는가 — 이때는 요청 전에 refresh 를 먼저 한다. */
export function sessionNeedsRefresh(session: AuthSession, now = Date.now()): boolean {
  return !session.expiresAt || session.expiresAt - now < REFRESH_MARGIN_MS;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                 */
/* ------------------------------------------------------------------ */

interface GoTrueSessionBody {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id?: string; email?: string };
  error?: string;
  error_code?: string;
  msg?: string;
  message?: string;
}

function sessionOf(body: GoTrueSessionBody): AuthSession {
  const expiresAt = body.expires_at
    ? Number(body.expires_at) * 1000
    : Date.now() + Number(body.expires_in ?? 3600) * 1000;
  return {
    accessToken: String(body.access_token ?? ''),
    refreshToken: String(body.refresh_token ?? ''),
    expiresAt,
    user: { id: String(body.user?.id ?? ''), email: String(body.user?.email ?? '') },
  };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/** 회원가입 — Confirm email 이 꺼져 있어 응답에 바로 세션이 온다. */
export async function authSignUp(email: string, password: string, nickname: string): Promise<AuthResult> {
  const invalid = validateEmail(email) ?? validatePassword(password) ?? validateNickname(nickname);
  if (invalid) return { ok: false, message: invalid };
  try {
    const res = await authFetch('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password, data: { nickname: nickname.trim() } }),
    });
    const body = (await readJson(res)) as GoTrueSessionBody;
    if (!res.ok) return { ok: false, message: authErrorMessage(body) };
    const session = sessionOf(body);
    if (!session.accessToken || !session.user.id) {
      // 이메일 확인이 켜진 프로젝트에서는 세션 없이 user 만 온다 — 그 경우도 안내한다.
      return { ok: false, message: '가입은 접수됐지만 로그인되지 않았습니다. 이메일 인증을 확인해 주세요.' };
    }
    return { ok: true, session };
  } catch (err) {
    return { ok: false, message: authErrorMessage(err) };
  }
}

/** 로그인 */
export async function authSignIn(email: string, password: string): Promise<AuthResult> {
  const invalid = validateEmail(email) ?? validatePassword(password);
  if (invalid) return { ok: false, message: invalid };
  try {
    const res = await authFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const body = (await readJson(res)) as GoTrueSessionBody;
    if (!res.ok) {
      // 400 invalid_credentials 는 Supabase 가 가장 흔히 주는 응답이다.
      const message = authErrorMessage(body);
      return { ok: false, message: message === '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' ? '이메일 또는 비밀번호가 맞지 않습니다.' : message };
    }
    return { ok: true, session: sessionOf(body) };
  } catch (err) {
    return { ok: false, message: authErrorMessage(err) };
  }
}

/** 세션 갱신 — 실패하면 null(다시 로그인 필요) */
export async function authRefresh(session: AuthSession): Promise<AuthSession | null> {
  if (!session.refreshToken) return null;
  try {
    const res = await authFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!res.ok) return null;
    const next = sessionOf((await readJson(res)) as GoTrueSessionBody);
    if (!next.accessToken) return null;
    return { ...next, user: next.user.id ? next.user : session.user };
  } catch {
    return null;
  }
}

/** 로그아웃 — 서버 세션 폐기는 실패해도 로컬 세션은 지운다. */
export async function authSignOut(session: AuthSession): Promise<void> {
  try {
    await authFetch('/auth/v1/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
  } catch {
    /* 무시 — 로컬 정리는 아래에서 */
  }
  saveStoredSession(null);
}

/* ------------------------------------------------------------------ */
/* PostgREST — 프로필 · 연결 내역                                        */
/* ------------------------------------------------------------------ */

async function restFetch(
  path: string,
  session: AuthSession,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

interface ProfileApiRow {
  id: string;
  email: string;
  nickname: string;
  role: string;
  preferred_exchange: string;
  created_at?: string;
  last_seen_at?: string;
}

function profileOf(row: ProfileApiRow): Profile {
  return {
    id: row.id,
    email: row.email ?? '',
    nickname: row.nickname || row.email?.split('@')[0] || '트레이더',
    role: row.role === 'admin' ? 'admin' : 'user',
    preferredExchange: row.preferred_exchange || 'bitget',
    createdAt: row.created_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

const PROFILE_COLS = 'id,email,nickname,role,preferred_exchange,created_at,last_seen_at';

/** 내 프로필 — 없으면 null */
export async function fetchProfile(session: AuthSession): Promise<Profile | null> {
  const res = await restFetch(
    `/cota_profiles?select=${PROFILE_COLS}&id=eq.${encodeURIComponent(session.user.id)}&limit=1`,
    session,
  );
  if (!res.ok) throw new Error(authErrorMessage(await readJson(res)));
  const rows = (await readJson(res)) as ProfileApiRow[];
  return Array.isArray(rows) && rows.length ? profileOf(rows[0]) : null;
}

/** 프로필 생성 — 가입 직후 1회. role 은 항상 'user' (RLS 도 이를 강제한다). */
export async function createProfile(
  session: AuthSession,
  nickname: string,
  preferredExchange: string,
): Promise<Profile> {
  const row = {
    id: session.user.id,
    email: session.user.email,
    nickname: nickname.trim() || session.user.email.split('@')[0],
    role: 'user',
    preferred_exchange: preferredExchange,
  };
  const res = await restFetch(`/cota_profiles`, session, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(authErrorMessage(await readJson(res)));
  const rows = (await readJson(res)) as ProfileApiRow[];
  return profileOf(rows[0] ?? ({ ...row } as ProfileApiRow));
}

/**
 * 로그인 직후 프로필 확보.
 *  · 있으면 last_seen_at·닉네임(없을 때)·선호 거래소만 갱신한다 — role 은 건드리지 않는다(권한 승격 방지).
 *  · 없으면(예전에 만든 계정·트리거 없음) 지금 만든다.
 */
export async function ensureProfile(
  session: AuthSession,
  nickname: string | null,
  preferredExchange: string,
): Promise<Profile> {
  const existing = await fetchProfile(session);
  const now = new Date().toISOString();
  if (!existing) return createProfile(session, nickname ?? session.user.email.split('@')[0], preferredExchange);

  const patch: Record<string, unknown> = { last_seen_at: now, preferred_exchange: preferredExchange };
  if (nickname && nickname.trim() && nickname.trim() !== existing.nickname) patch.nickname = nickname.trim();
  const res = await restFetch(`/cota_profiles?id=eq.${encodeURIComponent(session.user.id)}`, session, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    // 갱신 실패는 로그인 자체를 막지 않는다 — 기존 프로필을 그대로 쓴다.
    return { ...existing, lastSeenAt: now, preferredExchange };
  }
  const rows = (await readJson(res)) as ProfileApiRow[];
  return rows.length ? profileOf(rows[0]) : { ...existing, lastSeenAt: now, preferredExchange };
}

/** 연결 내역 저장(upsert) — 이미 있는 payload 만 보낸다(키 원문 없음). */
export async function saveConnection(
  session: AuthSession,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await restFetch(`/cota_connections?on_conflict=user_id`, session, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([payload]),
  });
  if (!res.ok) throw new Error(authErrorMessage(await readJson(res)));
}

/** 관리자 대시보드용 전체 조회 — RLS 가 관리자에게만 전체를 돌려준다. */
export async function fetchAdminData(
  session: AuthSession,
): Promise<{ profiles: Profile[]; connections: ConnectionRow[] }> {
  const [profiles, connections] = await Promise.all([
    restFetch(`/cota_profiles?select=${PROFILE_COLS}&order=created_at.desc`, session),
    restFetch(
      `/cota_connections?select=user_id,exchange,mode,api_connected,autotrade_enabled,account_equity,updated_at`,
      session,
    ),
  ]);
  if (!profiles.ok) throw new Error(authErrorMessage(await readJson(profiles)));
  if (!connections.ok) throw new Error(authErrorMessage(await readJson(connections)));
  const profileRows = (await readJson(profiles)) as ProfileApiRow[];
  const connectionRows = (await readJson(connections)) as Array<{
    user_id: string;
    exchange: string;
    mode: string;
    api_connected: boolean;
    autotrade_enabled: boolean;
    account_equity: number | string | null;
    updated_at: string;
  }>;
  return {
    profiles: profileRows.map(profileOf),
    connections: connectionRows.map((c) => ({
      userId: c.user_id,
      exchange: c.exchange === 'binance' ? 'binance' : 'bitget',
      mode: c.mode === 'live' ? 'live' : 'demo',
      apiConnected: !!c.api_connected,
      autotradeEnabled: !!c.autotrade_enabled,
      accountEquity: c.account_equity === null ? null : Number(c.account_equity),
      updatedAt: c.updated_at,
    })),
  };
}
