import type { Candle, Signal, StrategyStats, SymbolAnalysis, Trade, AssetClass, TF } from './types';
import { STRATEGIES, STRATEGY_BY_ID } from './types';
import { buildSeries } from './indicators';
import { DETECTORS } from './strategies';

export const MIN_WINRATE = 55;
export const MIN_RR = 1.5;
export const MIN_TRADES = 2;
export const RECENT_BARS = 60;
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

export function runBacktest(candles: Candle[], series: ReturnType<typeof buildSeries>, strategyId: string, from: number, to: number): Trade[] {
  const detect = DETECTORS[strategyId];
  if (!detect) return [];
  const meta = STRATEGY_BY_ID[strategyId];
  const trades: Trade[] = [];
  let blockedUntil = -1;
  for (let i = Math.max(from, meta.warmup); i <= to; i++) {
    if (i <= blockedUntil) continue;
    const setup = detect(candles, series, i);
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

function qualifies(stats: StrategyStats): boolean {
  return stats.n >= MIN_TRADES && stats.winRate >= MIN_WINRATE && stats.rr >= MIN_RR;
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
): SymbolAnalysis | null {
  if (candles.length < 80) return null;
  const series = buildSeries(candles);
  const last = candles.length - 1;
  const isEnd = Math.max(0, last - RECENT_BARS);

  const perStrategy = STRATEGIES.map((meta) => {
    const trades = runBacktest(candles, series, meta.id, 0, last);
    const isTrades = trades.filter((t) => t.entryIdx <= isEnd);
    const oosTrades = trades.filter((t) => t.entryIdx > isEnd);
    return {
      meta,
      trades,
      isStats: aggregate(isTrades),
      stats: aggregate(oosTrades),
    };
  });

  const best = (list: { meta: { id: string }; stats: StrategyStats }[]) => {
    let acc: { meta: { id: string }; stats: StrategyStats } | null = null;
    for (const cur of list) {
      if (!acc) {
        acc = cur;
        continue;
      }
      const curOk = qualifies(cur.stats);
      const accOk = qualifies(acc.stats);
      if (curOk && !accOk) acc = cur;
      else if (curOk === accOk && cur.stats.score > acc.stats.score) acc = cur;
    }
    return acc ? { id: acc.meta.id, stats: acc.stats } : null;
  };

  const oosBest = best(perStrategy.map((p) => ({ meta: p.meta, stats: p.stats })));
  const isBest = best(perStrategy.map((p) => ({ meta: p.meta, stats: p.isStats })));

  let active = oosBest;
  let replacement: SymbolAnalysis['replacement'] = null;
  if (isBest && oosBest && isBest.id !== oosBest.id && qualifies(oosBest.stats)) {
    // 워크포워드: 과거 구간 1위 전략을 최근 구간에서 다시 채점
    const isStat = perStrategy.find((p) => p.meta.id === isBest.id)!.stats;
    // 최근 구간 표본이 MIN_TRADES 이상이면서 기준 미달일 때만 '성과 저조 교체'로 기록
    const hasEvidence = isStat.n >= MIN_TRADES;
    const failsThreshold = hasEvidence && !qualifies(isStat);
    const clearlyWorse =
      hasEvidence && qualifies(isStat) && oosBest.stats.winRate - isStat.winRate >= 8;
    if (failsThreshold || clearlyWorse) {
      const reasonParts: string[] = [];
      if (isStat.winRate < MIN_WINRATE) reasonParts.push(`최근 승률 ${isStat.winRate.toFixed(1)}% < 기준 ${MIN_WINRATE}%`);
      if (isStat.wins > 0 && isStat.rr < MIN_RR) reasonParts.push(`손익비 ${isStat.rr.toFixed(2)}R < 기준 ${MIN_RR}R`);
      if (!isStat.wins) reasonParts.push(`최근 표본 ${isStat.n}건 전패`);
      if (!reasonParts.length) reasonParts.push(`상위 전략 대비 승률 ${(oosBest.stats.winRate - isStat.winRate).toFixed(1)}%p 열위`);
      replacement = {
        at: Date.now(),
        symbol,
        base,
        tf,
        asset,
        fromId: isBest.id,
        toId: oosBest.id,
        fromWinRate: isStat.winRate,
        fromRR: isStat.rr,
        toWinRate: oosBest.stats.winRate,
        toRR: oosBest.stats.rr,
        reason: reasonParts.join(' · '),
        kind: 'auto-swap',
      };
    }
  }
  if (!active) {
    return {
      symbol,
      base,
      asset,
      tf,
      activeStrategyId: STRATEGIES[0].id,
      activeWinRate: 0,
      activeRR: 0,
      activeN: 0,
      activeStats: emptyStats(),
      candidates: perStrategy.map((p) => ({ id: p.meta.id, stats: p.stats })),
      signals: [],
      replacement,
      candlesLoaded: candles.length,
    };
  }

  const activeEntry = perStrategy.find((p) => p.meta.id === active!.id)!;
  const activeStats = activeEntry.stats;
  const qualified = qualifies(activeStats);
  const price = candles[last].c;
  const signals: Signal[] = [];

  if (qualified) {
    for (const t of activeEntry.trades) {
      // 진행중 시그널은 최근 10봉 안에서 감지된 것만, 종료(적중/무효) 시그널은 최근 160봉까지 수집한다.
      const windowBars = t.result === 'open' ? SCAN_SIGNAL_BARS : RECENT_SIGNAL_BARS;
      if (t.entryIdx < last - windowBars) continue;
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
      signals.push({
        id: `${symbol}-${tf}-${activeEntry.meta.id}-${t.entryIdx}`,
        symbol,
        base,
        asset,
        tf,
        side: t.side,
        strategyId: activeEntry.meta.id,
        strategyName: activeEntry.meta.name,
        strategyShort: activeEntry.meta.short,
        star: activeEntry.meta.star,
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
        winRate: activeStats.winRate,
        strategyRR: activeStats.rr,
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
  }

  // 진행중 시그널을 먼저, 그 다음 최근에 종료된 시그널 순으로 마켓당 상한까지 노출
  const trimmed = signals
    .sort((a, b) => {
      const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
      return rank(a) - rank(b) || b.detectedAt - a.detectedAt;
    })
    .slice(0, MAX_SIGNALS_PER_MARKET);

  return {
    symbol,
    base,
    asset,
    tf,
    activeStrategyId: activeEntry.meta.id,
    activeWinRate: activeStats.winRate,
    activeRR: activeStats.rr,
    activeN: activeStats.n,
    activeStats,
    candidates: perStrategy.map((p) => ({ id: p.meta.id, stats: p.stats })),
    signals: trimmed,
    replacement,
    candlesLoaded: candles.length,
  };
}
