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
 *  · **회원가입 직후 재시도**: `cota_connections.user_id` 는 `cota_profiles.id` 를 참조한다.
 *    세션이 프로필 INSERT 보다 먼저 서므로 첫 upsert 가 FK 오류(23503)로 실패할 수 있다 →
 *    실패하면 1.5·3·4.5초 간격으로 최대 3회 다시 보낸다(프로필이 생긴 뒤 성공).
 *  · 로그인하지 않았으면 아무것도 보내지 않는다(비회원 둘러보기).
 *  · API Key/Secret/Passphrase 는 `connectionPayload` 의 화이트리스트 밖이라 절대 나가지 않는다.
 */
import { useEffect, useRef } from 'react';
import type { Exchange } from '../lib/exchange';
import type { AccountAuthApi } from './useAccountAuth';
import { connectionChanged, connectionPayload, type ConnectionPayload } from '../lib/accountSync';
import { saveConnection } from '../lib/supabaseAuth';

const DEBOUNCE_MS = 1200;
/** FK(프로필 생성) 경합 등 일시 실패 재시도 간격 — 최대 3회 */
const RETRY_MS = 1500;

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

    let cancelled = false;
    let attempt = 0;
    let handle = 0;

    const send = () => {
      void saveConnection(session, payload)
        .then(() => {
          if (!cancelled) last.current = payload;
        })
        .catch(() => {
          if (cancelled || attempt >= 3) return;
          attempt += 1;
          handle = window.setTimeout(send, RETRY_MS * attempt);
        });
    };

    // 첫 저장(로그인·가입 직후 초기 행)은 바로, 이후 변화는 디바운스
    handle = window.setTimeout(send, last.current ? DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      if (handle) window.clearTimeout(handle);
    };
  }, [session, exchange, mode, apiConnected, autotradeEnabled, equity]);
}
