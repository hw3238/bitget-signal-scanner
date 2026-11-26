/**
 * 🔗 계정 연결 내역 동기화 · 관리자 대시보드 집계 (v1.5.8)
 *
 * 두 가지를 순수 함수로 모아 화면(App·MenuTab·AdminDashboard)과 검증 스크립트가 같은 규칙을 쓴다.
 *
 * 1) `connectionPayload` — DB(`cota_connections`)로 보낼 행을 **화이트리스트로만** 만든다.
 *    · 절대 원칙: API Key / Secret / Passphrase 원문은 여기서도, 네트워크로도 나가지 않는다.
 *      입력 객체에 키가 섞여 있어도 아래 6개 필드만 골라 새 객체를 만든다(spread 금지).
 *    · 잔고는 0 이하·NaN 이면 null(모름)로 둔다 — 관리자 화면에서 '—' 로 보인다.
 * 2) `buildAdminRows`/`adminSummary`/`filterAdminRows` — 관리자 대시보드의 표·요약 카드 계산.
 */
import type { ConnectionRow, Profile } from './supabaseAuth';

/** `cota_connections` 에 저장을 허용하는 컬럼 — 이 목록 밖의 값은 절대 나가지 않는다. */
export const CONNECTION_FIELDS = [
  'user_id',
  'exchange',
  'mode',
  'api_connected',
  'autotrade_enabled',
  'account_equity',
  'updated_at',
] as const;

export interface ConnectionInput {
  exchange: string;
  mode: 'demo' | 'live';
  /** 비트겟 API 키가 이 기기에 저장돼 있는가 (원문 아님, 불리언) */
  apiConnected: boolean;
  /** 자동매매 스위치가 켜져 있는가 */
  autotradeEnabled: boolean;
  /** 계좌 총 자산(USDT) — 모르면 0/null */
  equity: number | null;
}

export type ConnectionPayload = {
  user_id: string;
  exchange: string;
  mode: 'demo' | 'live';
  api_connected: boolean;
  autotrade_enabled: boolean;
  account_equity: number | null;
  updated_at: string;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 동기화 payload.
 *  · exchange 는 bitget/binance 만, mode 는 demo/live 만 저장한다.
 *  · 잔고는 소수 2자리, 0 이하면 null.
 */
export function connectionPayload(
  userId: string,
  input: ConnectionInput,
  updatedAt: string,
): ConnectionPayload {
  const equity = Number(input.equity ?? 0);
  return {
    user_id: userId,
    exchange: input.exchange === 'binance' ? 'binance' : 'bitget',
    mode: input.mode === 'live' ? 'live' : 'demo',
    api_connected: !!input.apiConnected,
    autotrade_enabled: !!input.autotradeEnabled,
    account_equity: Number.isFinite(equity) && equity > 0 ? round2(equity) : null,
    updated_at: updatedAt,
  };
}

/** payload 에 실제로 담긴 키 — 검증·디버깅용 (항상 CONNECTION_FIELDS) */
export function connectionKeys(payload: object): string[] {
  return Object.keys(payload).sort();
}

/**
 * 다시 보낼 필요가 있는가 — 의미 있는 값이 바뀌었을 때만 true.
 *  · updated_at 만 다른 경우는 false (같은 상태를 30초마다 다시 쓰지 않게)
 */
export function connectionChanged(prev: ConnectionPayload | null, next: ConnectionPayload): boolean {
  if (!prev) return true;
  return (
    prev.exchange !== next.exchange ||
    prev.mode !== next.mode ||
    prev.api_connected !== next.api_connected ||
    prev.autotrade_enabled !== next.autotrade_enabled ||
    prev.account_equity !== next.account_equity
  );
}

export function connectionSignature(payload: ConnectionPayload | null): string {
  if (!payload) return '';
  return [payload.exchange, payload.mode, payload.api_connected, payload.autotrade_enabled, payload.account_equity].join('|');
}

/* ------------------------------------------------------------------ */
/* 관리자 대시보드                                                      */
/* ------------------------------------------------------------------ */

export interface AdminUserRow {
  id: string;
  nickname: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string | null;
  lastSeenAt: string | null;
  exchange: 'bitget' | 'binance' | null;
  mode: 'demo' | 'live' | null;
  apiConnected: boolean;
  autotradeEnabled: boolean;
  equity: number | null;
  updatedAt: string | null;
}

/** 프로필 + 연결 내역을 유저 한 줄로 합친다(연결 행이 없어도 프로필은 보인다). */
export function buildAdminRows(profiles: Profile[], connections: ConnectionRow[]): AdminUserRow[] {
  const byUser = new Map(connections.map((c) => [c.userId, c]));
  return profiles.map((p) => {
    const c = byUser.get(p.id) ?? null;
    return {
      id: p.id,
      nickname: p.nickname || p.email.split('@')[0] || '트레이더',
      email: p.email,
      role: p.role,
      createdAt: p.createdAt,
      lastSeenAt: p.lastSeenAt,
      exchange: (c?.exchange as 'bitget' | 'binance' | undefined) ?? null,
      mode: c?.mode ?? null,
      apiConnected: !!c?.apiConnected,
      autotradeEnabled: !!c?.autotradeEnabled,
      equity: c && Number.isFinite(c.accountEquity ?? NaN) ? c.accountEquity : null,
      updatedAt: c?.updatedAt ?? null,
    };
  });
}

export interface AdminSummary {
  total: number;
  admins: number;
  apiConnected: number;
  autotradeOn: number;
  live: number;
  bitget: number;
  binance: number;
}

export function adminSummary(rows: AdminUserRow[]): AdminSummary {
  const summary: AdminSummary = {
    total: rows.length,
    admins: 0,
    apiConnected: 0,
    autotradeOn: 0,
    live: 0,
    bitget: 0,
    binance: 0,
  };
  for (const row of rows) {
    if (row.role === 'admin') summary.admins += 1;
    if (row.apiConnected) summary.apiConnected += 1;
    if (row.autotradeEnabled) summary.autotradeOn += 1;
    if (row.mode === 'live') summary.live += 1;
    if (row.exchange === 'bitget') summary.bitget += 1;
    if (row.exchange === 'binance') summary.binance += 1;
  }
  return summary;
}

export type AdminFilter = 'all' | 'api' | 'autotrade' | 'admin';

export const ADMIN_FILTERS: Array<{ key: AdminFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'api', label: 'API 연결' },
  { key: 'autotrade', label: '자동매매 ON' },
  { key: 'admin', label: '관리자' },
];

/** 검색(닉네임·이메일, 대소문자 무시) + 필터 */
export function filterAdminRows(rows: AdminUserRow[], query: string, filter: AdminFilter): AdminUserRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'api' && !row.apiConnected) return false;
    if (filter === 'autotrade' && !row.autotradeEnabled) return false;
    if (filter === 'admin' && row.role !== 'admin') return false;
    if (!q) return true;
    return row.nickname.toLowerCase().includes(q) || row.email.toLowerCase().includes(q);
  });
}

/* ------------------------------------------------------------------ */
/* 표시용 날짜                                                          */
/* ------------------------------------------------------------------ */

function parts(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `2026.11.26` (KST 기준 날짜) */
export function fmtDay(iso: string | null): string {
  const d = parts(iso);
  if (!d) return '—';
  const kst = new Date(d.getTime() + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/** `방금 전 · 5분 전 · 3시간 전 · 2일 전` (그 이상은 날짜) */
export function fmtAgo(iso: string | null, now = Date.now()): string {
  const d = parts(iso);
  if (!d) return '—';
  const diff = now - d.getTime();
  if (diff < 0) return '방금 전';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return fmtDay(iso);
}

/** 관리자 목록의 거래소 표기 */
export function exchangeLabel(exchange: 'bitget' | 'binance' | null): string {
  if (exchange === 'bitget') return '비트겟';
  if (exchange === 'binance') return '바이낸스';
  return '미선택';
}

/** 연결 상태 한 줄 — `연결됨 · 실거래` / `미연결` */
export function connectionLabel(row: Pick<AdminUserRow, 'apiConnected' | 'mode'>): string {
  if (!row.apiConnected) return '미연결';
  return row.mode === 'live' ? '연결됨 · 실거래' : '연결됨 · 모의';
}
