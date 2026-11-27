/**
 * 🧠 매매 DNA 데이터 소스 — 기록을 **있는 그대로** DNA 입력으로 바꾼다.
 *
 *  ① 매매일지(로컬)  : 시그널 이력(`bgss.history.v1`) + '내 진입' 표시(`bgss.mytrades.v1`)
 *  ② 실계좌 체결     : 비트겟 과거 포지션(네이티브 브리지가 있는 APK 에서만)
 *  ③ 데모            : 사용자가 '데모 보기'를 누를 때만, DEMO 표기와 함께
 *
 * 지켜야 할 선
 *  · 기록에 없는 값(배율·청산 시각)은 **추정해서 채우지 않는다**. 청산 시각은 봉 수 × 타임프레임으로
 *    '근사'하되, 봉 수가 없으면 null 로 두고 연패 쿨다운 같은 주문 차단 근거에서 뺀다.
 *  · 실계좌 연동이 불가능하면(브리지 없음) 그 사실을 그대로 돌려준다 — 매매일지로 조용히 섞지 않는다.
 */
import type { HistoryRecord, MyTrade } from './storage';
import { signalKey } from './storage';
import type { DnaTrade } from '../engine/tradeDna';
import { isNativeApp, bitgetHistory } from './native';

const TF_MS: Record<string, number> = { '1H': 3_600_000, '4H': 4 * 3_600_000 };

/** 기록 1건 → DNA 매매 1건. 봉 수로 청산 시각·보유 시간을 근사한다. */
export function tradeFromRecord(record: HistoryRecord, own: boolean): DnaTrade {
  const tfMs = TF_MS[record.tf] ?? 3_600_000;
  const bars = Number(record.bars);
  const holdMs = Number.isFinite(bars) && bars > 0 ? bars * tfMs : null;
  const open = record.state === 'open';
  return {
    id: record.id || signalKey(record),
    symbol: record.symbol,
    base: record.base || record.symbol.replace(/USDT$/, ''),
    side: record.side,
    openedAt: Number(record.detectedAt) || 0,
    closedAt: open || holdMs == null ? null : (Number(record.detectedAt) || 0) + holdMs,
    result: open ? 'open' : record.state === 'win' ? 'win' : 'loss',
    r: Number.isFinite(record.r) ? record.r : 0,
    leverage: Number.isFinite(record.leverage as number) ? (record.leverage as number) : null,
    holdMs,
    own,
  };
}

/**
 * 매매일지 → DNA 입력.
 *  · '내 진입'으로 표시한 기록은 `own: true` — 화면이 "내 실제 진입"과 "시그널 복기"를 구분한다.
 *  · 최근 90일만 쓴다(그 이전 기록은 시장 국면이 달라 습관 진단을 흐린다).
 */
export function tradesFromJournal(
  records: HistoryRecord[],
  myTrades: MyTrade[],
  opts: { days?: number; now?: number } = {},
): DnaTrade[] {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 90;
  const from = now - days * 86_400_000;
  const mine = new Set(myTrades.map((t) => t.key));
  return records
    .filter((r) => Number(r.detectedAt) >= from)
    .map((r) => tradeFromRecord(r, mine.has(signalKey(r))))
    .sort((a, b) => a.openedAt - b.openedAt);
}

/** '내 진입' 기록이 1건이라도 있으면 그것을, 없으면 시그널 복기 전체를 분석한다. */
export function pickJournalTrades(all: DnaTrade[]): { trades: DnaTrade[]; basis: 'own' | 'signal' } {
  const own = all.filter((t) => t.own);
  return own.length ? { trades: own, basis: 'own' } : { trades: all, basis: 'signal' };
}

/* ------------------------------------------------------------------ *
 * 실계좌(비트겟) 과거 체결
 * ------------------------------------------------------------------ */

export interface RealHistoryResult {
  status: 'ok' | 'unavailable' | 'none' | 'error';
  trades: DnaTrade[];
  /** unavailable · error 일 때 이유(사용자에게 그대로 보여준다) */
  reason: string;
  /** 브리지가 있는데 0건이면 none */
  days: number;
}

/**
 * 비트겟 과거 포지션을 불러와 DNA 입력으로 바꾼다.
 *
 *  · 네이티브 브리지(`AppShell.bitgetPositionHistory`)가 있는 APK 에서만 실제로 요청한다.
 *    이 메서드가 없는 APK·웹에서는 **불가능**을 그대로 돌려준다(네트워크 요청 0건).
 *  · R 은 `netProfit ÷ 증거금(marginSize)` 로 계산한다 — 증거금이 없는 행은 R 을 만들 수 없어 건너뛴다.
 *    (없는 값을 0R 로 세면 승률·손익이 왜곡된다)
 */
export async function loadRealAccountHistory(days = 90): Promise<RealHistoryResult> {
  if (!isNativeApp()) {
    return {
      status: 'unavailable',
      trades: [],
      reason: '웹 버전에서는 계좌의 과거 체결에 접근할 수 없습니다(키는 앱 안에만 저장됩니다).',
      days,
    };
  }
  const res = await bitgetHistory(days);
  if (!res.ok) {
    return {
      status: res.reason === 'bridge-missing' ? 'unavailable' : 'error',
      trades: [],
      reason:
        res.reason === 'bridge-missing'
          ? '이 앱 버전에는 과거 체결 조회 기능이 아직 없습니다. 앱을 최신 버전으로 올리면 자동으로 연결됩니다.'
          : res.error || '과거 체결을 불러오지 못했습니다.',
      days,
    };
  }
  const trades = parsePositionHistoryRows(res.rows ?? []);
  return {
    status: trades.length ? 'ok' : 'none',
    trades,
    reason: trades.length ? '' : '과거 체결이 0건입니다.',
    days,
  };
}

/**
 * 비트겟 V2 `position/history-position` 응답 행을 DNA 매매로 바꾼다.
 *  · `netProfit`(수수료·펀딩 반영) 우선, 없으면 `pnl`.
 *  · R = netProfit ÷ marginSize (증거금 대비 손익). marginSize 가 없으면 그 행은 건너뛴다.
 */
export function parsePositionHistoryRows(rows: Array<Record<string, unknown>>): DnaTrade[] {
  const out: DnaTrade[] = [];
  for (const [i, row] of rows.entries()) {
    const symbol = String(row.symbol ?? '');
    if (!symbol) continue;
    const sideRaw = String(row.holdSide ?? row.holdSideType ?? '').toLowerCase();
    const side: 'long' | 'short' = sideRaw === 'short' ? 'short' : 'long';
    const net = Number(row.netProfit ?? row.pnl ?? NaN);
    const margin = Number(row.marginSize ?? row.margin ?? NaN);
    const openedAt = Number(row.cTime ?? row.openTime ?? 0);
    const closedAt = Number(row.uTime ?? row.closeTime ?? row.utime ?? 0) || null;
    if (!Number.isFinite(net) || !(margin > 0) || !openedAt) continue;
    const leverage = Number(row.leverage ?? NaN);
    out.push({
      id: `bitget-${row.positionId ?? `${symbol}-${openedAt}-${i}`}`,
      symbol,
      base: String(row.baseCoin ?? symbol.replace(/USDT$/, '')),
      side,
      openedAt,
      closedAt,
      result: net > 0 ? 'win' : 'loss',
      r: net / margin,
      leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : null,
      holdMs: closedAt && closedAt > openedAt ? closedAt - openedAt : null,
      own: true,
    });
  }
  return out.sort((a, b) => a.openedAt - b.openedAt);
}

/* ------------------------------------------------------------------ *
 * 데모 — 실제 매매가 아니다. 화면·테스트에서 항상 'DEMO' 로 표시한다.
 * ------------------------------------------------------------------ */

/** KST 기준 dayOffset 일 전 hour 시 minute 분의 타임스탬프 */
function kstAt(now: number, dayOffset: number, hour: number, minute = 0): number {
  const day = 86_400_000;
  const kstNow = now + 9 * 3_600_000;
  const midnight = Math.floor(kstNow / day) * day - 9 * 3_600_000;
  return midnight - dayOffset * day + hour * 3_600_000 + minute * 60_000;
}

/**
 * 데모 매매 34건 — '고배·심야에서 지고, 오전·저배에서 버는' 전형적인 복수 매매 습관.
 * 값은 고정(난수 없음)이라 화면·테스트가 같은 숫자를 본다.
 */
export function demoDnaTrades(now = Date.now()): DnaTrade[] {
  const rows: Array<[number, number, number, number, 'long' | 'short', 'win' | 'loss', number, number]> = [];
  // [일 전, 시, 분, 배율, 방향, 결과, R, 보유(분)]
  for (let i = 0; i < 10; i += 1) rows.push([44 - i * 4, 9, 12, 8, 'long', 'win', 1.8, 240]); // 오전 승리
  for (let i = 0; i < 8; i += 1) rows.push([43 - i * 5, 23, 20, 25, 'short', 'loss', -1, 180]); // 심야 고배 손실
  for (let i = 0; i < 6; i += 1) rows.push([42 - i * 6, 15, 5, 20, 'long', 'loss', -1, 300]); // 오후 고배 손실
  for (let i = 0; i < 6; i += 1) rows.push([41 - i * 6, 16, 40, 3, 'long', 'win', 2.2, 600]); // 오후 저배 승리
  // 복수 매매 — 손실 청산 10분 뒤 5분 만에 재진입
  for (let i = 0; i < 4; i += 1) {
    const day = 38 - i * 7;
    rows.push([day, 22, 30, 25, 'short', 'loss', -1, 10]);
    rows.push([day, 22, 45, 25, 'short', 'loss', -1, 30]);
  }

  const trades = rows.map<DnaTrade>(([dayOffset, hour, minute, lev, side, result, r, holdMin], i) => {
    const openedAt = kstAt(now, dayOffset, hour, minute);
    const holdMs = holdMin * 60_000;
    return {
      id: `demo-${i + 1}`,
      symbol: side === 'long' ? 'BTCUSDT' : 'ETHUSDT',
      base: side === 'long' ? 'BTC' : 'ETH',
      side,
      openedAt,
      closedAt: openedAt + holdMs,
      result,
      r,
      leverage: lev,
      holdMs,
      own: true,
    };
  });
  // 진행 중 2건 — 승률 계산에서 빠지는지 화면·테스트가 함께 확인한다.
  trades.push({
    id: 'demo-open-1',
    symbol: 'SOLUSDT',
    base: 'SOL',
    side: 'long',
    openedAt: kstAt(now, 0, 10, 0),
    closedAt: null,
    result: 'open',
    r: 0.3,
    leverage: 10,
    holdMs: null,
    own: true,
  });
  trades.push({
    id: 'demo-open-2',
    symbol: 'XRPUSDT',
    base: 'XRP',
    side: 'short',
    openedAt: kstAt(now, 1, 21, 0),
    closedAt: null,
    result: 'open',
    r: -0.2,
    leverage: 20,
    holdMs: null,
    own: true,
  });
  return trades.sort((a, b) => a.openedAt - b.openedAt);
}
