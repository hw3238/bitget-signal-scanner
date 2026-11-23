import type { Candle, Signal, StrategyStats, SymbolAnalysis, Trade, AssetClass, TF, AdoptBasis, StrategyMeta } from './types';
import { STRATEGIES, STRATEGY_BY_ID } from './types';
import { buildSeries } from './indicators';
import { DETECTORS } from './strategies';
import { validateSetup, riskPctOf, STOP_WIDTH } from './risk';

export { STOP_WIDTH, riskPctOf };

export const MIN_WINRATE = 55;
export const MIN_RR = 1.5;
export const MIN_TRADES = 3;
export const RECENT_BARS = 60;

/** 마켓별 채택 기준 — 실측 기대값까지 함께 보는 게이트 */
export interface GateOptions {
  minTrades: number;
  minWinRate: number;
  minRR: number;
  /** 1건당 최소 기대값(R) — 0 이면 미적용 */
  minExpectancy: number;
}

export const DEFAULT_GATE: GateOptions = {
  minTrades: MIN_TRADES,
  minWinRate: MIN_WINRATE,
  minRR: MIN_RR,
  minExpectancy: 0,
};
/**
 * 전략 단위(전수 백테스트) 채택 게이트.
 * 마켓 하나의 최근 60봉만 보면 표본 3건을 못 채우는 고승률 기법이 영원히 탈락한다.
 * 전수 검증(150마켓 × 1H/4H 500봉 · 테이커 왕복 0.12% 차감)에서 이 선을 넘은 기법은
 * 마켓 표본이 모자라도 채택 후보가 된다 — 단 최근 마켓 표본에 반증이 없을 때만.
 */
export const BENCH_GATE = {
  /** 전수 표본 하한 */
  minN: 40,
  /** 전수 승률 하한(%) — 45% 아래면 기대값이 수수료에 잠식된다 */
  minWinRate: 45,
  /** 수수료 차감 후 1건 기대값 하한(R) */
  minExp: 0.2,
} as const;

/** 진행중 시그널 강조 구간(봉) */
export const SCAN_SIGNAL_BARS = 10;
/** 이전(종료) 시그널까지 함께 수집하는 최근 구간(봉) — 200봉 백테스트 안에서 넉넉히 노출 */
export const RECENT_SIGNAL_BARS = 160;
/** 마켓·타임프레임당 최대로 노출하는 시그널 수(진행중 우선 + 최근 종료 순) */
export const MAX_SIGNALS_PER_MARKET = 18;
export const HORIZON = 42;

export function emptyStats(): StrategyStats {
  return {
    n: 0,
    wins: 0,
    losses: 0,
    opens: 0,
    winRate: 0,
    avgWinR: 0,
    avgLossR: 0,
    rr: 0,
    expectancy: 0,
    totalR: 0,
    score: 0,
    movePct: 0,
    avgRiskPct: 0,
  };
}

export function resolveTrade(candles: Candle[], entryIdx: number, side: Trade['side'], entry: number, stop: number, target: number, tags: string[]): Trade {
  const last = candles.length - 1;
  const end = Math.min(entryIdx + HORIZON, last);
  for (let j = entryIdx + 1; j <= end; j++) {
    const c = candles[j];
    if (side === 'long') {
      if (c.l <= stop) {
        return { side, entryIdx, entry, stop, target, exitIdx: j, result: 'loss', rResult: -1, bars: j - entryIdx, tags };
      }
      if (c.h >= target) {
        const r = (target - entry) / (entry - stop);
        return { side, entryIdx, entry, stop, target, exitIdx: j, result: 'win', rResult: r, bars: j - entryIdx, tags };
      }
    } else {
      if (c.h >= stop) {
        return { side, entryIdx, entry, stop, target, exitIdx: j, result: 'loss', rResult: -1, bars: j - entryIdx, tags };
      }
      if (c.l <= target) {
        const r = (entry - target) / (stop - entry);
        return { side, entryIdx, entry, stop, target, exitIdx: j, result: 'win', rResult: r, bars: j - entryIdx, tags };
      }
    }
  }
  return { side, entryIdx, entry, stop, target, exitIdx: null, result: 'open', rResult: 0, bars: last - entryIdx, tags };
}

export function runBacktest(candles: Candle[], series: ReturnType<typeof buildSeries>, strategyId: string, tf: TF, from: number, to: number): Trade[] {
  const detect = DETECTORS[strategyId];
  if (!detect) return [];
  const meta = STRATEGY_BY_ID[strategyId];
  const trades: Trade[] = [];
  let blockedUntil = -1;
  for (let i = Math.max(from, meta.warmup); i <= to; i++) {
    if (i <= blockedUntil) continue;
    const raw = detect(candles, series, i, tf);
    if (!raw) continue;
    // 손절폭 상한·정밀 타점 필터를 백테스트에도 동일 적용 (통과한 셋업만 집계)
    const setup = validateSetup(raw, tf);
    if (!setup) continue;
    const trade = resolveTrade(candles, i, setup.side, setup.entry, setup.stop, setup.target, setup.tags);
    trades.push(trade);
    blockedUntil = trade.exitIdx ?? i + HORIZON;
  }
  return trades;
}

export function aggregate(trades: Trade[]): StrategyStats {
  const closed = trades.filter((t) => t.result !== 'open');
  const wins = closed.filter((t) => t.result === 'win');
  const losses = closed.filter((t) => t.result === 'loss');
  const n = closed.length;
  const winRate = n ? (wins.length / n) * 100 : 0;
  const avgWinR = wins.length ? wins.reduce((a, t) => a + t.rResult, 0) / wins.length : 0;
  const avgLossR = 1;
  const rr = avgLossR ? avgWinR / avgLossR : 0;
  const totalR = closed.reduce((a, t) => a + t.rResult, 0);
  const expectancy = n ? totalR / n : 0;
  const score = n ? (winRate / 100) * Math.min(rr, 4) * Math.min(Math.sqrt(n), 2.8) : 0;
  let movePct = 0;
  let riskSum = 0;
  for (const t of trades) {
    const riskPct = Math.abs(t.entry - t.stop) / (t.entry || 1) * 100;
    riskSum += riskPct;
    if (t.result !== 'open') movePct += t.rResult * riskPct;
  }
  const avgRiskPct = trades.length ? riskSum / trades.length : 0;
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    opens: trades.length - n,
    winRate,
    avgWinR,
    avgLossR,
    rr,
    expectancy,
    totalR,
    score,
    movePct,
    avgRiskPct,
  };
}

export function entryRR(entry: number, stop: number, target: number): number {
  const risk = Math.abs(entry - stop);
  if (!risk) return 0;
  return Math.abs(target - entry) / risk;
}

function qualifies(stats: StrategyStats, gate: GateOptions = DEFAULT_GATE): boolean {
  if (stats.n < gate.minTrades) return false;
  if (stats.winRate < gate.minWinRate) return false;
  if (stats.rr < gate.minRR) return false;
  if (gate.minExpectancy > 0 && stats.expectancy < gate.minExpectancy) return false;
  return true;
}

export function benchProven(meta: StrategyMeta, tf?: TF): boolean {
  const b = meta.bench;
  if (!(b.n >= BENCH_GATE.minN && b.winRate >= BENCH_GATE.minWinRate && b.exp >= BENCH_GATE.minExp)) return false;
  // 타임프레임별 검증 승률도 같은 하한을 넘어야 한다 — 전수 전체는 통과해도
  // 특정 타임프레임에서 승률이 낮으면 그 TF에는 채택하지 않는다.
  if (tf && Number.isFinite(b.byTf?.[tf]) && b.byTf[tf] < BENCH_GATE.minWinRate) return false;
  return true;
}

/**
 * 마켓의 최근 60봉 표본이 '검증된 기법' 채택을 뒤집을 만큼 나쁜지 판정한다.
 *  · 표본 3건 이상: 최근 2건 연속 손실 또는 승률 33% 이하 → 반증
 *  · 표본 1~2건: 마지막 매매가 손실 → 반증
 *  · 표본 0건: 반증 없음(전수 성적만으로 채택)
 */
export function localCounterEvidence(local: StrategyStats, trades: Trade[]): boolean {
  const closed = trades.filter((t) => t.result !== 'open');
  const n = closed.length;
  if (!n) return false;
  if (n >= 3) {
    if (closed.slice(-2).every((t) => t.result === 'loss')) return true;
    return local.winRate <= 33;
  }
  return closed[n - 1].result === 'loss';
}

/**
 * 채택 우선순위 = (전수 기대값 × 전수 승률) × 타임프레임 가중 + 마켓 실측 가점.
 * 기대값×승률을 중심에 두는 이유: 표본이 많다는 이유만으로 저승률·고빈도 기법이
 * 고승률 기법을 밀어내지 못하게 하기 위해서다. 마켓 실측이 기준을 넘으면 가점을 준다.
 */
export function adoptionPriority(meta: StrategyMeta, tf: TF, local: StrategyStats, basis: AdoptBasis): number {
  const b = meta.bench;
  const tfWr = Number.isFinite(b.byTf?.[tf]) ? b.byTf[tf] : b.winRate;
  const tfWeight = b.winRate > 0 ? Math.max(0.6, Math.min(1.2, tfWr / b.winRate)) : 1;
  let score = b.exp * b.winRate * tfWeight;
  if (basis === 'market' && local.n) {
    // 마켓 실측 가점은 최대 18점 — 표본 3~5건짜리 최근 성적이 전수 최상위 기법을 통째로 뒤집지는 못하게 한다.
    const wrEdge = Math.max(0, Math.min(local.winRate - 50, 25));
    const expEdge = Math.max(0, Math.min(local.expectancy, 1.5));
    score += Math.min(18, wrEdge * 0.6 + expEdge * 5);
  }
  return score;
}

export interface AnalyzeOptions {
  minRR: number;
  leverage: number;
  riskPct: number;
}

export function analyzeSymbol(
  symbol: string,
  base: string,
  asset: AssetClass,
  tf: TF,
  candles: Candle[],
  decimals?: number,
  gate: GateOptions = DEFAULT_GATE,
): SymbolAnalysis | null {
  if (candles.length < 80) return null;
  const series = buildSeries(candles);
  const last = candles.length - 1;
  const isEnd = Math.max(0, last - RECENT_BARS);

  // 전략별 평가 — 마켓 실측(최근 60봉)과 전수 검증(전략 단위) 성적을 함께 본다.
  const evaluated = STRATEGIES.map((meta) => {
    const trades = runBacktest(candles, series, meta.id, tf, 0, last);
    const isTrades = trades.filter((t) => t.entryIdx <= isEnd);
    const oosTrades = trades.filter((t) => t.entryIdx > isEnd);
    const isStats = aggregate(isTrades);
    const stats = aggregate(oosTrades);
    const localOk = qualifies(stats, gate);
    const proven = benchProven(meta, tf);
    // 전수 검증 기법은 마켓 표본이 모자라도 채택한다 — 단 최근 마켓 표본이 반증하면 제외.
    const contradicted = proven && !localOk && localCounterEvidence(stats, oosTrades);
    const eligible = localOk || (proven && !contradicted);
    const basis: AdoptBasis = localOk ? 'market' : 'bench';
    const priority = eligible ? adoptionPriority(meta, tf, stats, basis) : -1;
    const pastOk = qualifies(isStats, gate) || proven;
    const pastPriority = pastOk ? adoptionPriority(meta, tf, isStats, qualifies(isStats, gate) ? 'market' : 'bench') : -1;
    return { meta, trades, isStats, stats, localOk, proven, contradicted, eligible, basis, priority, pastPriority };
  });

  const ranked = [...evaluated].sort(
    (a, b) => b.priority - a.priority || b.stats.n - a.stats.n || b.meta.bench.exp - a.meta.bench.exp,
  );
  const chosen = ranked[0]?.eligible ? ranked[0] : null;

  // 워크포워드 교체 로그 — 과거 구간 1순위와 최근 채택이 다르고, 과거 1순위가 최근 근거로 밀렸을 때만 기록
  const pastLeader = [...evaluated].filter((e) => e.pastPriority >= 0).sort((a, b) => b.pastPriority - a.pastPriority)[0] ?? null;
  let replacement: SymbolAnalysis['replacement'] = null;
  if (pastLeader && chosen && pastLeader.meta.id !== chosen.meta.id) {
    const hasEvidence = pastLeader.stats.n >= gate.minTrades;
    const failsThreshold = hasEvidence && !pastLeader.localOk && !pastLeader.proven;
    const clearlyWorse = hasEvidence && chosen.localOk && chosen.priority - pastLeader.priority >= 8;
    if (failsThreshold || clearlyWorse) {
      const isStat = pastLeader.stats;
      const toWinRate = chosen.basis === 'market' ? chosen.stats.winRate : chosen.meta.bench.winRate;
      const toRR = chosen.basis === 'market' ? chosen.stats.rr : chosen.meta.bench.avgWinR;
      const reasonParts: string[] = [];
      if (isStat.winRate < gate.minWinRate) reasonParts.push(`최근 승률 ${isStat.winRate.toFixed(1)}% < 기준 ${gate.minWinRate}%`);
      if (isStat.wins > 0 && isStat.rr < gate.minRR) reasonParts.push(`손익비 ${isStat.rr.toFixed(2)}R < 기준 ${gate.minRR}R`);
      if (!isStat.wins) reasonParts.push(`최근 표본 ${isStat.n}건 전패`);
      if (!reasonParts.length) reasonParts.push(`전수 검증 성적 상위 전략 우선 채택(기대값 × 승률)`);
      replacement = {
        at: Date.now(),
        symbol,
        base,
        tf,
        asset,
        fromId: pastLeader.meta.id,
        toId: chosen.meta.id,
        fromWinRate: isStat.winRate,
        fromRR: isStat.rr,
        toWinRate,
        toRR,
        reason: reasonParts.join(' · '),
        kind: 'auto-swap',
      };
    }
  }

  const candidates = evaluated.map((e) => ({ id: e.meta.id, stats: e.stats, proven: e.proven, priority: e.priority }));

  if (!chosen) {
    return {
      symbol,
      base,
      asset,
      tf,
      activeStrategyId: '',
      activeBasis: 'none',
      activePriority: 0,
      activeWinRate: 0,
      activeRR: 0,
      activeN: 0,
      activeStats: emptyStats(),
      candidates,
      signals: [],
      replacement,
      candlesLoaded: candles.length,
    };
  }

  const price = candles[last].c;
  const signals: Signal[] = [];
  // 같은 마켓·타임프레임에서 진행 중 신호는 우선순위가 가장 높은 전략 1건만 노출한다.
  let openTaken = false;

  const pushSignals = (entry: (typeof evaluated)[number]) => {
    const bench = entry.meta.bench;
    const displayWinRate =
      entry.basis === 'market' ? entry.stats.winRate : Number.isFinite(bench.byTf?.[tf]) ? bench.byTf[tf] : bench.winRate;
    const displayRR = entry.basis === 'market' ? entry.stats.rr : bench.avgWinR;
    for (const t of entry.trades) {
      // 진행중 시그널은 최근 10봉 안에서 감지된 것만, 종료(적중/무효) 시그널은 최근 160봉까지 수집한다.
      const windowBars = t.result === 'open' ? SCAN_SIGNAL_BARS : RECENT_SIGNAL_BARS;
      if (t.entryIdx < last - windowBars) continue;
      if (t.result === 'open' && openTaken) continue;
      const rr = entryRR(t.entry, t.stop, t.target);
      const changePct = ((price - t.entry) / t.entry) * 100 * (t.side === 'long' ? 1 : -1);
      const risk = Math.abs(price - t.stop);
      let remainingRR = 0;
      const dir = t.side === 'long' ? 1 : -1;
      const riskDen = Math.abs(t.entry - t.stop) || 1;
      const currentR = t.result === 'win' ? rr : t.result === 'loss' ? -1 : ((price - t.entry) * dir) / riskDen;
      if (t.result === 'open' && risk > 0) {
        const reward = t.side === 'long' ? t.target - price : price - t.target;
        remainingRR = Math.max(0, reward / risk);
      }
      const span = Math.abs(t.target - t.entry) || 1;
      const moved = t.side === 'long' ? price - t.entry : t.entry - price;
      const progress = t.result === 'win' ? 1 : t.result === 'loss' ? 0 : Math.max(0, Math.min(1, moved / span));
      if (t.result === 'open') openTaken = true;
      signals.push({
        id: `${symbol}-${tf}-${entry.meta.id}-${t.entryIdx}`,
        symbol,
        base,
        asset,
        tf,
        side: t.side,
        strategyId: entry.meta.id,
        strategyName: entry.meta.name,
        strategyShort: entry.meta.short,
        star: entry.meta.star,
        entry: t.entry,
        stop: t.stop,
        target: t.target,
        eq: t.entry + (t.target - t.entry) * 0.5,
        rr,
        remainingRR,
        currentR,
        price,
        changePct,
        progress,
        state: t.result === 'open' ? 'open' : t.result === 'win' ? 'win' : 'loss',
        detectedAt: candles[t.entryIdx].t,
        barsSince: last - t.entryIdx,
        winRate: displayWinRate,
        winRateBasis: entry.basis,
        strategyExp: bench.exp,
        strategyRR: displayRR,
        leverage: 10,
        levRoi: changePct * 10,
        candles: candles.slice(Math.max(0, t.entryIdx - 34), last + 1),
        detectedIdx: t.entryIdx - Math.max(0, t.entryIdx - 34),
        tags: t.tags,
        fundingRate: 0,
        quoteVolume: 0,
        decimals,
      });
    }
  };

  // 우선순위(기대값 × 승률)가 높은 전략부터 채운다 — 고승률 기법이 먼저 자리를 잡는다.
  for (const entry of [...evaluated].filter((e) => e.eligible).sort((a, b) => b.priority - a.priority)) pushSignals(entry);

  // 진행중 시그널을 먼저, 그 다음 최근에 종료된 시그널 순으로 마켓당 상한까지 노출
  const trimmed = signals
    .sort((a, b) => {
      const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
      return rank(a) - rank(b) || b.detectedAt - a.detectedAt;
    })
    .slice(0, MAX_SIGNALS_PER_MARKET);

  // 마켓 대표 전략 = 가장 먼저 실린 신호의 전략(없으면 전략 채택 없음)
  const lead = trimmed[0]
    ? evaluated.find((e) => e.meta.id === trimmed[0].strategyId)!
    : chosen;
  const leadBench = lead?.meta.bench;
  const leadWinRate = lead
    ? lead.basis === 'market'
      ? lead.stats.winRate
      : Number.isFinite(leadBench!.byTf?.[tf])
        ? leadBench!.byTf[tf]
        : leadBench!.winRate
    : 0;

  return {
    symbol,
    base,
    asset,
    tf,
    activeStrategyId: lead ? lead.meta.id : '',
    activeBasis: lead ? lead.basis : 'none',
    activePriority: lead ? lead.priority : 0,
    activeWinRate: leadWinRate,
    activeRR: lead ? (lead.basis === 'market' ? lead.stats.rr : leadBench!.avgWinR) : 0,
    activeN: lead ? (lead.basis === 'market' ? lead.stats.n : leadBench!.n) : 0,
    activeStats: lead ? lead.stats : emptyStats(),
    candidates,
    signals: trimmed,
    replacement,
    candlesLoaded: candles.length,
  };
}
