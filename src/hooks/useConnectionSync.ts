/**
 * 🔗 거래소 · API 연결 내역 실시간 동기화 (v1.5.8)
 *
 * 로그인한 유저의 아래 변화를 `cota_connections` 한 행으로 모아 upsert 한다.
 *   · 거래소 선택·전환(bitget/binance)
 *   · 모의 / 실거래 모드
 *   · 비트겟 API 키 연결·해제 (불리언만 — 원문 아님)
 *   · 자동매매 ON/OFF
 *   · 계좌 잔고(equity) 갱신
 *
 *  · 값이 실제로 바뀔 때만 보낸다(`connectionChanged`) — 같은 상태를 주기적으로 다시 쓰지 않는다.
 *  · 1.2초 디바운스로 잔고·모드가 연달아 바뀌어도 요청은 한 번만 나간다.
 *  · 로그인하지 않았으면 아무것도 보내지 않는다(비회원 둘러보기).
 *  · API Key/Secret/Passphrase 는 `connectionPayload` 의 화이트리스트 밖이라 절대 나가지 않는다.
 */
import { useEffect, useRef } from 'react';
import type { Exchange } from '../lib/exchange';
import type { AccountAuthApi } from './useAccountAuth';
import { connectionChanged, connectionPayload, type ConnectionPayload } from '../lib/accountSync';
import { saveConnection } from '../lib/supabaseAuth';

const DEBOUNCE_MS = 1200;

export interface ConnectionSyncInput {
  auth: AccountAuthApi;
  exchange: Exchange | null;
  mode: 'demo' | 'live';
  /** 비트겟 키가 이 기기에 저장돼 있는가 */
  apiConnected: boolean;
  /** 자동매매 스위치 */
  autotradeEnabled: boolean;
  /** 계좌 총 자산(USDT) — 모르면 0 */
  equity: number | null;
}

export function useConnectionSync({
  auth,
  exchange,
  mode,
  apiConnected,
  autotradeEnabled,
  equity,
}: ConnectionSyncInput): void {
  const last = useRef<ConnectionPayload | null>(null);
  const lastUser = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const session = auth.session;

  useEffect(() => {
    if (!session || !exchange) return;
    if (lastUser.current !== session.user.id) {
      lastUser.current = session.user.id;
      last.current = null;
    }
    const payload = connectionPayload(
      session.user.id,
      { exchange, mode, apiConnected, autotradeEnabled, equity },
      new Date().toISOString(),
    );
    if (!connectionChanged(last.current, payload)) return;
    if (timer.current) window.clearTimeout(timer.current);
    // 첫 저장(로그인 직후 초기 행)은 바로, 이후 변화는 디바운스
    const delay = last.current ? DEBOUNCE_MS : 0;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void saveConnection(session, payload)
        .then(() => {
          last.current = payload;
        })
        .catch(() => {
          /* 네트워크·권한 오류는 조용히 넘긴다 — 다음 변화에서 다시 시도 */
        });
    }, delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [session, exchange, mode, apiConnected, autotradeEnabled, equity]);
}
