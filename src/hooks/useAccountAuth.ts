/**
 * 🔐 계정 세션 훅 (v1.5.8)
 *
 * · 앱이 열릴 때 저장된 세션을 복원한다(만료 임박이면 refresh).
 * · 로그인/가입 직후 `cota_profiles` 를 확보하고 `last_seen_at` 을 갱신한다.
 * · 실패해도 앱 사용(비회원 둘러보기)은 막지 않는다 — 계정은 '있으면 좋은' 기능이다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Exchange } from '../lib/exchange';
import {
  authRefresh,
  authSignIn,
  authSignOut,
  authSignUp,
  ensureProfile,
  loadStoredSession,
  saveStoredSession,
  sessionNeedsRefresh,
  type AuthSession,
  type Profile,
} from '../lib/supabaseAuth';

export interface AuthActionResult {
  ok: boolean;
  message?: string;
}

export interface AccountAuthApi {
  /** 저장된 세션 복원이 끝났는가 — 끝나기 전에는 로그인 버튼을 깜빡이지 않게 한다 */
  ready: boolean;
  session: AuthSession | null;
  profile: Profile | null;
  /** 관리자 대시보드 메뉴는 이 값이 true 일 때만 보인다 */
  isAdmin: boolean;
  busy: boolean;
  error: string | null;
  signUp: (email: string, password: string, nickname: string) => Promise<AuthActionResult>;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export function useAccountAuth(exchange: Exchange | null): AccountAuthApi {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchangeRef = useRef<Exchange>('bitget');
  if (exchange) exchangeRef.current = exchange;

  /* 1) 저장된 세션 복원 (+ 필요하면 refresh → 프로필 확보) */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = loadStoredSession();
      if (!stored) {
        if (alive) setReady(true);
        return;
      }
      let active = stored;
      if (sessionNeedsRefresh(active)) {
        const next = await authRefresh(active);
        if (next) {
          active = next;
          saveStoredSession(next);
        } else {
          saveStoredSession(null);
          if (alive) setReady(true);
          return;
        }
      }
      if (!alive) return;
      setSession(active);
      try {
        const fetched = await ensureProfile(active, null, exchangeRef.current);
        if (alive) setProfile(fetched);
      } catch {
        /* 프로필 조회 실패 — 로그인 상태는 유지하고 다음 로그인에 다시 시도 */
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, nickname: string): Promise<AuthActionResult> => {
      setBusy(true);
      setError(null);
      try {
        const res = await authSignUp(email, password, nickname);
        if (!res.ok) {
          setError(res.message);
          return { ok: false, message: res.message };
        }
        saveStoredSession(res.session);
        setSession(res.session);
        try {
          const fetched = await ensureProfile(res.session, nickname, exchangeRef.current);
          setProfile(fetched);
        } catch (err) {
          setError(err instanceof Error ? err.message : '프로필을 저장하지 못했습니다.');
        }
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    setBusy(true);
    setError(null);
    try {
      const res = await authSignIn(email, password);
      if (!res.ok) {
        setError(res.message);
        return { ok: false, message: res.message };
      }
      saveStoredSession(res.session);
      setSession(res.session);
      try {
        const fetched = await ensureProfile(res.session, null, exchangeRef.current);
        setProfile(fetched);
      } catch (err) {
        setError(err instanceof Error ? err.message : '프로필을 불러오지 못했습니다.');
      }
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const current = session;
    setSession(null);
    setProfile(null);
    setError(null);
    saveStoredSession(null);
    if (current) await authSignOut(current);
  }, [session]);

  return {
    ready,
    session,
    profile,
    isAdmin: profile?.role === 'admin',
    busy,
    error,
    signUp,
    signIn,
    signOut,
    clearError: () => setError(null),
  };
}
