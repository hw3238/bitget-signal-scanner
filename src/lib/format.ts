/** 천단위 콤마 고정 표기 (en-US 그룹핑 = 한국 화면에서 쓰는 1,234,567 표기와 동일) */
function group(value: number, min: number, max: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
}

/**
 * 가격 표기 — 항상 천단위 콤마를 넣고, 종목 특성에 맞는 소수점을 쓴다.
 *   · 거래소/호가 자리수(decimals)가 있으면 그 자리수 그대로 (금 3,642.50 · EURUSD 1.0842 · BTC 56,699.6)
 *   · 없으면 금액대별 규칙: 10,000↑ 소수 1자리 · 1,000↑ 1~2자리 · 1↑ 2~3자리 · 0.01↑ 4자리 · 그 아래 유효숫자
 */
export function fmtPrice(value: number, decimals?: number): string {
  if (!Number.isFinite(value)) return '-';
  if (decimals != null && Number.isFinite(decimals)) {
    const d = Math.max(0, Math.min(8, Math.round(decimals)));
    return group(value, d, d);
  }
  const abs = Math.abs(value);
  if (abs >= 10000) return group(value, 1, 1);
  if (abs >= 1000) return group(value, 1, 2);
  if (abs >= 1) return group(value, 2, 3);
  if (abs >= 0.01) return group(value, 4, 4);
  if (abs >= 0.0001) return group(value, 6, 6);
  const fixed = value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '-0' ? '0' : fixed;
}

export function fmtPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtVolume(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** 손익비 — `1 : 2.3` (R:R 표기를 한국 트레이딩 표기로) */
export function fmtRR(rr: number, digits = 1): string {
  if (!Number.isFinite(rr)) return '-';
  return `1 : ${Math.max(0, rr).toFixed(digits)}`;
}

const KST = 'Asia/Seoul';

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', {
    timeZone: KST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: KST,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

export function tfLabel(tf: string): string {
  return tf === '1H' ? '1시간' : '4시간';
}

export function sideLabel(side: 'long' | 'short'): string {
  return side === 'long' ? '롱' : '숏';
}

/** 배지용 — 방향을 매수/매도까지 붙여 혼동 없이 */
export function sideFullLabel(side: 'long' | 'short'): string {
  return side === 'long' ? '롱 · 매수' : '숏 · 매도';
}

export type SignalState = 'open' | 'win' | 'loss';

/** 상태 표기 — 진행 중 / 목표 달성 / 손절 종료 */
export function stateLabel(state: SignalState): string {
  return state === 'open' ? '진행 중' : state === 'win' ? '목표 달성' : '손절 종료';
}
