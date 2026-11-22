/**
 * 매매 복기 집계 — 기록(HistoryRecord)과 내 진입 기록(MyTrade)을 실제 데이터로만 계산한다.
 *   · 승률·평균 R·누적 R·시드 기준 누적 손익($)
 *   · 시간순 누적 R 수익곡선 + 최대 낙폭(MDD) + 최장 연승/연패
 *   · 전략별 성적표
 * 가짜 데이터는 쓰지 않는다 — 입력이 비면 모든 값이 0/빈 배열이다.
 */
import type { HistoryRecord, MyTrade } from './storage';
import { signalKey } from './storage';

/** 집계 기준 — 시드(USDT) · 1회 허용 손실률(%) */
export interface JournalBasis {
  seed: number;
  riskPct: number;
}

export function recordKey(h: Pick<HistoryRecord, 'symbol' | 'tf' | 'side' | 'detectedAt'>): string {
  return signalKey(h);
}

/**
 * 같은 캔들에서 감지된 시그널은 한 건으로 센다.
 * 캔들 배열이 밀리면 신호 id(진입 인덱스 포함)가 바뀌어 같은 시그널이 두 번 쌓이므로,
 * 마지막(가장 최근 스캔) 상태를 남기고 detectedAt 최신순으로 돌려준다.
 */
export function dedupeHistory(list: HistoryRecord[]): HistoryRecord[] {
  const map = new Map<string, HistoryRecord>();
  for (const h of list) map.set(recordKey(h), h);
  return [...map.values()].sort((a, b) => b.detectedAt - a.detectedAt);
}

function closedAsc(list: HistoryRecord[]): HistoryRecord[] {
  return list
    .filter((h) => h.state !== 'open')
    .sort((a, b) => a.detectedAt - b.detectedAt || a.id.localeCompare(b.id));
}

export interface JournalStats {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  open: number;
  /** 종료 매매 승률(%) — 종료가 없으면 0 */
  winRate: number;
  cumR: number;
  avgR: number;
  /** 1회 허용 손실 금액(USDT) = 시드 × 리스크% */
  riskUsd: number;
  /** 누적 손익(USDT) = 누적 R × 1회 허용 손실 금액 */
  pnlUsd: number;
}

export function journalStats(list: HistoryRecord[], basis: JournalBasis): JournalStats {
  const closed = list.filter((h) => h.state !== 'open');
  const wins = closed.filter((h) => h.state === 'win').length;
  const cumR = closed.reduce((acc, h) => acc + (Number.isFinite(h.r) ? h.r : 0), 0);
  const riskUsd = (basis.seed * basis.riskPct) / 100;
  return {
    total: list.length,
    closed: closed.length,
    wins,
    losses: closed.length - wins,
    open: list.length - closed.length,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    cumR,
    avgR: closed.length ? cumR / closed.length : 0,
    riskUsd,
    pnlUsd: cumR * riskUsd,
  };
}

export interface EquityPoint {
  t: number;
  /** 이 매매의 R */
  r: number;
  /** 이 매매까지의 누적 R */
  cumR: number;
}

export interface EquityCurveData {
  /** 시작점(0R) + 매매마다 한 점 — 시간순 */
  points: EquityPoint[];
  trades: number;
  peakR: number;
  finalR: number;
  /** 최대 낙폭(R, 0 이하) — 고점 대비 가장 깊게 내려간 폭 */
  mddR: number;
  /** 낙폭이 시작된 고점의 누적 R */
  mddPeakR: number;
  mddPeakAt: number | null;
  mddTroughAt: number | null;
}

export function equityCurve(list: HistoryRecord[]): EquityCurveData {
  const closed = closedAsc(list);
  let cum = 0;
  let peak = 0;
  let peakAt: number | null = null;
  let mdd = 0;
  let mddPeakR = 0;
  let mddPeakAt: number | null = null;
  let mddTroughAt: number | null = null;

  const points: EquityPoint[] = closed.length ? [{ t: closed[0].detectedAt, r: 0, cumR: 0 }] : [];
  for (const h of closed) {
    cum += Number.isFinite(h.r) ? h.r : 0;
    points.push({ t: h.detectedAt, r: h.r, cumR: cum });
    if (cum > peak) {
      peak = cum;
      peakAt = h.detectedAt;
    }
    const dd = cum - peak;
    if (dd < mdd) {
      mdd = dd;
      mddPeakR = peak;
      mddPeakAt = peakAt;
      mddTroughAt = h.detectedAt;
    }
  }

  return {
    points,
    trades: closed.length,
    peakR: peak,
    finalR: cum,
    mddR: mdd,
    mddPeakR,
    mddPeakAt,
    mddTroughAt,
  };
}

export interface StreakInfo {
  maxWin: number;
  maxLoss: number;
  /** 마지막 매매의 연속 방향 */
  current: 'win' | 'loss' | null;
  currentLen: number;
}

export function streaks(list: HistoryRecord[]): StreakInfo {
  let maxWin = 0;
  let maxLoss = 0;
  let run = 0;
  let dir: 1 | -1 | 0 = 0;
  for (const h of closedAsc(list)) {
    const s: 1 | -1 = h.r > 0 ? 1 : -1;
    run = s === dir ? run + 1 : 1;
    dir = s;
    if (s === 1) maxWin = Math.max(maxWin, run);
    else maxLoss = Math.max(maxLoss, run);
  }
  return { maxWin, maxLoss, current: dir === 1 ? 'win' : dir === -1 ? 'loss' : null, currentLen: run };
}

export interface StrategyRow {
  strategyId: string;
  strategyShort: string;
  total: number;
  closed: number;
  open: number;
  wins: number;
  winRate: number;
  cumR: number;
  avgR: number;
}

/** 전략별 성적 — 종료 매매 누적 R 내림차순, 종료가 없는 전략은 뒤로 */
export function strategyBoard(list: HistoryRecord[]): StrategyRow[] {
  const acc = new Map<string, StrategyRow>();
  for (const h of list) {
    const row =
      acc.get(h.strategyId) ??
      {
        strategyId: h.strategyId,
        strategyShort: h.strategyShort,
        total: 0,
        closed: 0,
        open: 0,
        wins: 0,
        winRate: 0,
        cumR: 0,
        avgR: 0,
      };
    row.total += 1;
    row.strategyShort = h.strategyShort || row.strategyShort;
    if (h.state === 'open') {
      row.open += 1;
    } else {
      row.closed += 1;
      if (h.state === 'win') row.wins += 1;
      row.cumR += Number.isFinite(h.r) ? h.r : 0;
    }
    acc.set(h.strategyId, row);
  }
  const rows = [...acc.values()].map((r) => ({
    ...r,
    winRate: r.closed ? (r.wins / r.closed) * 100 : 0,
    avgR: r.closed ? r.cumR / r.closed : 0,
  }));
  return rows.sort((a, b) => {
    if ((a.closed > 0) !== (b.closed > 0)) return a.closed > 0 ? -1 : 1;
    if (b.cumR !== a.cumR) return b.cumR - a.cumR;
    return b.closed - a.closed || a.strategyShort.localeCompare(b.strategyShort);
  });
}

/** 내 진입으로 표시한 시그널의 기록만 — 기록이 지워진 진입은 orphans 로 센다 */
export function tradesIn(
  history: HistoryRecord[],
  trades: MyTrade[],
): { records: HistoryRecord[]; orphans: number } {
  const keys = new Set(trades.map((t) => t.key));
  const records = history.filter((h) => keys.has(recordKey(h)));
  const seen = new Set(records.map(recordKey));
  return { records, orphans: trades.filter((t) => !seen.has(t.key)).length };
}

/** `+2.40R` · `-1.00R` · `0.00R` */
export function fmtR(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}R`;
}
