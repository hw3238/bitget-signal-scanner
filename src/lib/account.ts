/**
 * 연결된 비트겟 계좌의 실시간 잔고 — v1.5.5 부터 모든 시그널·주문 계산의 유일한 기준.
 *
 *  · 예전(v1.5.4 이하)에는 첫 실행 온보딩에서 사용자가 '내 시드($)'를 직접 입력했고,
 *    시그널 카드의 주문 수량·예상 손익은 그 숫자로 계산했다.
 *  · v1.5.5 부터는 자동매매에 연결한 **실계좌 잔고(equity)** 만 쓴다. 계좌가 연결되지
 *    않았으면 시드는 0 = "계산 불가"이며, 화면은 숫자 대신 연결 안내를 보여준다.
 *  · 가용 잔고(available)는 주문 여력의 상한이다 — 이미 잡힌 증거금·미실현 손실 때문에
 *    총 자산(equity)보다 작을 수 있으므로, 필요 증거금이 가용의 95%를 넘지 않게 수량을 줄인다.
 */

/** 가용 증거금의 몇 %까지 주문에 쓸 수 있는가 — 수수료·슬리피지 여유 */
export const AVAILABLE_MARGIN_RATIO = 0.95;

export interface AccountBase {
  /** 키가 저장되어 있고 잔고 숫자를 받아온 상태 */
  connected: boolean;
  /** 키는 있는데 잔고를 아직 못 읽은 상태(조회 중·일시 오류) */
  pending: boolean;
  /** 총 자산(USDT) — 리스크 계산 기준 */
  equity: number;
  /** 가용 잔고(USDT) — 주문 여력 상한. 모르면 equity 와 같게 둔다 */
  available: number;
  unrealizedPL: number;
  /** 마지막으로 잔고를 읽은 시각(ms) — 0 이면 모름 */
  updatedAt: number;
  /** 모의투자(Demo) 계좌인가 */
  demo: boolean;
  /** 리스크 계산 기준 자본 = equity. 0 이면 계좌 미연결 */
  seed: number;
}

export const EMPTY_ACCOUNT: AccountBase = {
  connected: false,
  pending: false,
  equity: 0,
  available: 0,
  unrealizedPL: 0,
  updatedAt: 0,
  demo: true,
  seed: 0,
};

export function accountBaseOf(input: {
  hasKeys: boolean;
  equity?: number | null;
  available?: number | null;
  unrealizedPL?: number | null;
  updatedAt?: number | null;
  demo?: boolean | null;
}): AccountBase {
  const equity = Number(input.equity ?? 0);
  const available = Number(input.available ?? 0);
  // 잔고 숫자가 있어도 키가 없으면 쓸 수 없다(웹 브라우저·키 삭제 직후).
  const hasEquity = !!input.hasKeys && Number.isFinite(equity) && equity > 0;
  return {
    connected: !!input.hasKeys && hasEquity,
    pending: !!input.hasKeys && !hasEquity,
    equity: hasEquity ? equity : 0,
    // 가용이 총 자산보다 크면(교차 증거금·버그) 총 자산을 상한으로 둔다.
    available: hasEquity
      ? available > 0
        ? Math.min(available, equity)
        : equity
      : 0,
    unrealizedPL: Number.isFinite(Number(input.unrealizedPL)) ? Number(input.unrealizedPL) : 0,
    updatedAt: Number(input.updatedAt ?? 0) || 0,
    demo: input.demo !== false,
    seed: hasEquity ? equity : 0,
  };
}

/** 계좌가 연결되기 전 화면 공통 안내 */
export const ACCOUNT_UNLINKED_HINT = '비트겟 자동매매에 계좌를 연결하면 실시간 잔고 기준으로 계산됩니다';

/** `$1,234.56` — 잔고 표기(소수 2자리 고정, 1,000 이상은 콤마) */
export function fmtUsdtBalance(value: number | null | undefined): string {
  const v = Number(value ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '$0.00';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
