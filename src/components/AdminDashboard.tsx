/**
 * 🛡️ 관리자 대시보드 (v1.5.8)
 *
 * `cota_profiles`(전체 유저) + `cota_connections`(거래소·API 연결 내역)을 Supabase 에서 읽어 보여준다.
 *  · 이 화면은 `cota_profiles.role === 'admin'` 인 계정에게만 열린다(메뉴 자체가 숨겨짐).
 *    데이터도 RLS 가 관리자에게만 전체 행을 돌려주므로, 일반 유저가 URL/상태로 열어도 자기 행만 보인다.
 *  · API Key/Secret/Passphrase 는 DB 에 없으므로 화면에도 없다 — 연결 여부(불리언)만 보여준다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountAuthApi } from '../hooks/useAccountAuth';
import {
  ADMIN_FILTERS,
  adminSummary,
  buildAdminRows,
  connectionLabel,
  exchangeLabel,
  filterAdminRows,
  fmtAgo,
  fmtDay,
  type AdminFilter,
  type AdminUserRow,
} from '../lib/accountSync';
import { fetchAdminData } from '../lib/supabaseAuth';
import { fmtUsdtBalance } from '../lib/account';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function AdminDashboard({ auth }: { auth: AccountAuthApi }) {
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [message, setMessage] = useState('');
  const [loadedAt, setLoadedAt] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AdminFilter>('all');

  const load = useCallback(async () => {
    if (!auth.session) return;
    setStatus('loading');
    setMessage('');
    try {
      const data = await fetchAdminData(auth.session);
      setRows(buildAdminRows(data.profiles, data.connections));
      setLoadedAt(Date.now());
      setStatus('ready');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '유저 목록을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [auth.session]);

  useEffect(() => {
    if (auth.isAdmin) void load();
  }, [auth.isAdmin, load]);

  const summary = useMemo(() => adminSummary(rows), [rows]);
  const shown = useMemo(() => filterAdminRows(rows, query, filter), [rows, query, filter]);

  if (!auth.isAdmin) {
    return (
      <div className="admin-locked" data-admin-locked>
        <b>🛡️ 관리자 전용</b>
        <p>이 메뉴는 관리자 계정에만 보입니다. 관리자 권한은 운영자가 계정을 승격해야 열려요.</p>
      </div>
    );
  }

  return (
    <div className="admin-dash" data-admin-dashboard>
      <div className="admin-head">
        <div>
          <b>실시간 유저 현황</b>
          <span>
            {loadedAt ? `${fmtAgo(new Date(loadedAt).toISOString())} 갱신 · ${summary.total}명` : 'Supabase에서 불러오는 중'}
          </span>
        </div>
        <button
          type="button"
          className="admin-refresh"
          onClick={() => void load()}
          disabled={status === 'loading'}
          data-admin-refresh
        >
          {status === 'loading' ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      <div className="admin-summary" data-admin-summary>
        <div className="admin-stat" data-admin-total={summary.total}>
          <span>총 가입 유저</span>
          <b>
            {summary.total}
            <i>명</i>
          </b>
          <em>관리자 {summary.admins}명</em>
        </div>
        <div className="admin-stat" data-admin-api={summary.apiConnected}>
          <span>API 연결</span>
          <b>
            {summary.apiConnected}
            <i>명</i>
          </b>
          <em>실거래 {summary.live}명</em>
        </div>
        <div className="admin-stat" data-admin-auto={summary.autotradeOn}>
          <span>자동매매 ON</span>
          <b>
            {summary.autotradeOn}
            <i>명</i>
          </b>
          <em>{summary.total ? `${Math.round((summary.autotradeOn / summary.total) * 100)}%` : '0%'}</em>
        </div>
        <div className="admin-stat wide" data-admin-exchanges={`${summary.bitget}:${summary.binance}`}>
          <span>거래소 분포</span>
          <div className="admin-split">
            <div>
              <b>{summary.bitget}</b>
              <em>비트겟</em>
            </div>
            <div>
              <b>{summary.binance}</b>
              <em>바이낸스</em>
            </div>
          </div>
        </div>
      </div>

      <div className="admin-tools">
        <div className="admin-search">
          <span aria-hidden>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="닉네임 · 이메일 검색"
            data-admin-search
            inputMode="search"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="검색 지우기">
              ✕
            </button>
          )}
        </div>
        <div className="admin-filters" role="tablist">
          {ADMIN_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={filter === f.key ? 'on' : ''}
              onClick={() => setFilter(f.key)}
              data-admin-filter={f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'error' ? (
        <div className="admin-empty error" data-admin-error>
          <b>목록을 불러오지 못했어요</b>
          <p>{message}</p>
          <button type="button" className="account-btn primary" onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      ) : status !== 'ready' && !rows.length ? (
        <div className="admin-empty" data-admin-loading>
          <b>유저 목록을 불러오는 중…</b>
          <p>잠시만 기다려 주세요.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="admin-empty" data-admin-empty>
          <b>{rows.length ? '조건에 맞는 유저가 없어요' : '아직 가입한 유저가 없어요'}</b>
          <p>{rows.length ? '검색어나 필터를 바꿔 보세요.' : '누군가 회원가입하면 여기에 바로 나타납니다.'}</p>
        </div>
      ) : (
        <ul className="admin-list" data-admin-count={shown.length}>
          {shown.map((row) => (
            <li key={row.id} className="admin-user" data-admin-row data-admin-email={row.email}>
              <div className="admin-user-top">
                <span className={`admin-avatar ${row.role === 'admin' ? 'admin' : ''}`} aria-hidden>
                  {row.nickname.slice(0, 1).toUpperCase()}
                </span>
                <div className="admin-user-id">
                  <b>
                    {row.nickname}
                    <i className={`account-role ${row.role === 'admin' ? 'admin' : ''}`}>{row.role === 'admin' ? '관리자' : '일반'}</i>
                  </b>
                  <span>{row.email}</span>
                </div>
                <em className={`admin-auto ${row.autotradeEnabled ? 'on' : 'off'}`}>
                  {row.autotradeEnabled ? '자동매매 ON' : 'OFF'}
                </em>
              </div>
              <div className="admin-user-meta">
                <span className={`admin-chip ${row.exchange ?? 'none'}`} data-admin-exchange={row.exchange ?? 'none'}>
                  {exchangeLabel(row.exchange)}
                </span>
                <span className={`admin-chip ${row.apiConnected ? 'connected' : ''}`} data-admin-api-state={row.apiConnected ? 'on' : 'off'}>
                  {connectionLabel(row)}
                </span>
                {row.equity !== null && <span className="admin-chip equity">{fmtUsdtBalance(row.equity)}</span>}
              </div>
              <div className="admin-user-foot">
                <span>가입 {fmtDay(row.createdAt)}</span>
                <span>최근 접속 {fmtAgo(row.lastSeenAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="admin-note">
        🔒 API Key · Secret · Passphrase 원문은 저장하지 않습니다. 연결 여부·모드·자동매매 상태·잔고만 표시돼요.
        {' '}관리자 승격은 DB에서만 가능합니다.
      </p>
    </div>
  );
}
