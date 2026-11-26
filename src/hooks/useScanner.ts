import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMarketCandles, fetchMarketContracts, fetchMarketTickers, resetMarket } from '../api/market';
import { analyzeSymbol } from '../engine/backtest';
import type { Contract, Signal, SymbolAnalysis, TF, Ticker } from '../engine/types';
import { pickPrioritySymbols, pickUniverse } from '../engine/universe';
import {
  hydrateAnalyses,
  loadSnapshot,
  readAnalysis,
  readCandles,
  readFreshAnalysis,
  repriceAnalysis,
  saveSnapshot,
  ttlFor,
  writeAnalysis,
  writeCandles,
} from '../lib/scanCache';
import type { Exchange, MarketSource } from '../lib/exchange';
import { HISTORY_LIMIT, loadHistory, loadSwapLog, saveHistory, saveSwapLog, type HistoryRecord, type SwapLogEntry } from '../lib/storage';

export interface ScanState {
  status: 'idle' | 'scanning' | 'ready' | 'error';
  error: string | null;
  contracts: Contract[];
  tickers: Ticker[];
  analyses: SymbolAnalysis[];
  signals: Signal[];
  progress: { total: number; done: number; failed: number };
  startedAt: number;
  finishedAt: number;
  tickersAt: number;
  passes: number;
  /** 마지막 스캔에 실제로 걸린 시간(ms) */
  elapsedMs: number;
  /** 마지막 스캔에서 네트워크로 새로 받은 캔들 수 */
  candleFetches: number;
  /** 캐시에서 그대로 쓴 캔들 수 */
  cacheHits: number;
  /** 1차(핵심 마켓) 큐가 끝나 핵심 시그널이 먼저 떠 있는 상태 */
  priorityDone: boolean;
  /** 직전 스캔 스냅숏을 즉시 복원한 상태(뒤에서 갱신 중) */
  restored: boolean;
  markets: number;
  /** 이 결과를 만든 실제 데이터 출처 — `바이낸스 선물` / `바이낸스 현물 데이터` 등 */
  source: MarketSource | null;
}

const TFS: TF[] = ['1H', '4H'];

function baseState(): ScanState {
  return {
    status: 'idle',
    error: null,
    contracts: [],
    tickers: [],
    analyses: [],
    signals: [],
    progress: { total: 0, done: 0, failed: 0 },
    startedAt: 0,
    finishedAt: 0,
    tickersAt: 0,
    passes: 0,
    elapsedMs: 0,
    candleFetches: 0,
    cacheHits: 0,
    priorityDone: false,
    restored: false,
    markets: 0,
    source: null,
  };
}

const rankSignal = (a: Signal, b: Signal) => {
  const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
  return rank(a) - rank(b) || b.detectedAt - a.detectedAt;
};

/** 앱 재진입: 직전 스캔 스냅숏이 있으면 기다림 없이 바로 그 상태로 시작한다. */
function initialStateFrom(exchange: Exchange): ScanState {
  const snap = loadSnapshot(exchange);
  if (!snap) return baseState();
  // 스냅숏은 용량 때문에 분석의 signals 를 비워 저장한다 → 저장된 시그널을 다시 붙여 복원한다.
  const byMarket = new Map<string, Signal[]>();
  for (const s of snap.signals) {
    const key = `${s.symbol}|${s.tf}`;
    const list = byMarket.get(key) ?? [];
    list.push(s);
    byMarket.set(key, list);
  }
  const analyses = snap.analyses.map((a) => {
    const own = byMarket.get(`${a.symbol}|${a.tf}`) ?? [];
    return own.length ? { ...a, signals: own.sort(rankSignal) } : a;
  });
  hydrateAnalyses(exchange, analyses);
  return {
    ...baseState(),
    status: 'ready',
    contracts: snap.contracts,
    tickers: snap.tickers,
    analyses,
    signals: analyses.flatMap((a) => a.signals).sort(rankSignal),
    finishedAt: snap.at,
    tickersAt: snap.at,
    // 스냅숏은 '즉시 표시'라 걸린 시간은 비워 두고, 실제 갱신 시간(캐시 0.3초)만 표시한다.
    elapsedMs: 0,
    restored: true,
    markets: snap.markets,
    progress: { total: snap.markets * 2, done: snap.markets * 2, failed: 0 },
  };
}

interface Options {
  refreshSec: number;
  autoStart?: boolean;
  /** 1차 우선 큐에 넣을 즐겨찾기 심볼 */
  favoriteSymbols?: string[];
  /** 현재 선택된 거래소 — null 이면 아직 고르지 않음(선택 화면) */
  exchange: Exchange | null;
}

interface Job {
  symbol: string;
  tf: TF;
  base: string;
  asset: Contract['asset'];
  decimals?: number;
  tier: number;
}

export function useScanner({ refreshSec, autoStart = true, favoriteSymbols = [], exchange }: Options) {
  const exRef = useRef<Exchange | null>(exchange);
  const lastEx = useRef<Exchange | null>(exchange);
  const [state, setState] = useState<ScanState>(() => (exchange ? initialStateFrom(exchange) : baseState()));
  const [history, setHistory] = useState<HistoryRecord[]>(() => loadHistory(exchange ?? 'bitget'));
  const [swapLog, setSwapLog] = useState<SwapLogEntry[]>(() => loadSwapLog(exchange ?? 'bitget'));
  const running = useRef(false);
  const pending = useRef(false);
  /** 스캔 세대 — 거래소를 바꾸면 올려서 진행 중인 스캔의 결과가 화면을 덮지 않게 한다. */
  const runId = useRef(0);
  const analysesRef = useRef<SymbolAnalysis[]>(state.analyses);
  const contractsRef = useRef<{ list: Contract[]; at: number; exchange: Exchange } | null>(
    // 스냅숏으로 복원한 계약 목록은 이번 세션에서도 그대로 쓴다(재진입 시 계약 재요청 0건).
    exchange && state.contracts.length ? { list: state.contracts, at: Date.now(), exchange } : null,
  );
  const favoritesRef = useRef<string[]>(favoriteSymbols);
  favoritesRef.current = favoriteSymbols;

  const scan = useCallback(async (force = false) => {
    if (running.current) {
      pending.current = true;
      return;
    }
    const ex = exRef.current;
    if (!ex) return;
    running.current = true;
    const myRun = ++runId.current;
    const stale = () => runId.current !== myRun;
    const startedAt = Date.now();
    setState((prev) => ({
      ...prev,
      status: 'scanning',
      error: null,
      startedAt,
      restored: false,
      priorityDone: false,
      progress: { total: 0, done: 0, failed: 0 },
    }));

    try {
      /* ---------- 0) 실시간 티커 → 계약 목록(10분 캐시) ---------- */
      const now = Date.now();
      const cached = contractsRef.current;
      const contractCacheFresh =
        !!cached && cached.exchange === ex && now - cached.at <= 10 * 60_000;
      const { tickers, source } = await fetchMarketTickers(
        ex,
        contractCacheFresh && cached ? cached.list.map((c) => c.symbol) : undefined,
      );
      if (stale()) return;
      const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));

      let contracts: Contract[];
      if (contractCacheFresh && cached) {
        contracts = cached.list;
      } else {
        contracts = await fetchMarketContracts(ex, tickers, source);
        if (stale()) return;
        contractsRef.current = { list: contracts, at: Date.now(), exchange: ex };
      }

      /* ---------- 1) 티커만으로 기존 결과 즉시 새로고침(현재가·수익률 0.3초 반영) ---------- */
      if (analysesRef.current.length) {
        const repriced = analysesRef.current.map((a) => repriceAnalysis(a, tickerMap.get(a.symbol)?.last ?? NaN));
        analysesRef.current = repriced;
        setState((prev) => ({
          ...prev,
          tickers,
          tickersAt: now,
          analyses: repriced,
          signals: repriced.flatMap((a) => a.signals).sort(rankSignal),
          elapsedMs: Date.now() - startedAt,
          source,
        }));
      } else {
        setState((prev) => ({ ...prev, contracts, tickers, tickersAt: now, source }));
      }

      /* ---------- 2) 스캔 큐 — 1차(핵심 마켓) → 2차(나머지) ---------- */
      const universe = pickUniverse(contracts, tickers);
      const priority = pickPrioritySymbols(contracts, tickers, favoritesRef.current);
      const tier0 = new Set(priority.tier0);
      const tier1 = new Set(priority.tier1);
      const jobs: Job[] = [];
      for (const c of universe) {
        for (const tf of TFS) {
          const tier = tier0.has(c.symbol) ? 0 : tier1.has(c.symbol) ? 1 : 2;
          jobs.push({ symbol: c.symbol, tf, base: c.base, asset: c.asset, decimals: c.decimals, tier });
        }
      }
      jobs.sort((a, b) => a.tier - b.tier);
      const total = jobs.length;

      setState((prev) => ({
        ...prev,
        contracts,
        progress: { total, done: 0, failed: 0 },
        markets: universe.length,
      }));

      const results = new Map<string, SymbolAnalysis>();
      let done = 0;
      let failed = 0;
      let candleFetches = 0;
      let cacheHits = 0;
      let lastFlush = 0;

      const flush = (immediate = false) => {
        if (stale()) return;
        const ts = Date.now();
        if (!immediate && ts - lastFlush < 140) return;
        lastFlush = ts;
        const analyses = [...results.values()];
        analysesRef.current = analyses;
        setState((prev) => ({
          ...prev,
          analyses,
          signals: analyses.flatMap((a) => a.signals).sort(rankSignal),
          progress: { total, done, failed },
        }));
      };

      const runJob = async (job: Job) => {
        try {
          const ttl = force ? 0 : ttlFor(job.tf);
          let candles = readCandles(ex, job.symbol, job.tf, ttl);
          let analysis: SymbolAnalysis | null = null;
          if (candles) {
            cacheHits += 1;
            analysis = readAnalysis(ex, job.symbol, job.tf, candles);
          } else {
            // 캔들 데이터는 없어도(앱 재진입 직후) TTL 안이면 직전 분석을 그대로 쓴다.
            analysis = readFreshAnalysis(ex, job.symbol, job.tf, ttl);
            if (analysis) cacheHits += 1;
          }
          if (!candles && !analysis) {
            candles = await fetchMarketCandles(ex, job.symbol, job.tf);
            if (stale()) return;
            writeCandles(ex, job.symbol, job.tf, candles);
            candleFetches += 1;
            analysis = readAnalysis(ex, job.symbol, job.tf, candles);
          }
          if (!analysis) {
            if (!candles) {
              candles = await fetchMarketCandles(ex, job.symbol, job.tf);
              if (stale()) return;
              writeCandles(ex, job.symbol, job.tf, candles);
              candleFetches += 1;
            }
            analysis = analyzeSymbol(job.symbol, job.base, job.asset, job.tf, candles, job.decimals);
            if (analysis) writeAnalysis(ex, analysis, candles);
          }
          if (analysis) {
            const t = tickerMap.get(job.symbol);
            const candleAt = analysis.candleAt ?? Date.now();
            let next = analysis;
            if (t) {
              const stamped = analysis.signals.map((s) => ({
                ...s,
                fundingRate: t.fundingRate,
                quoteVolume: t.quoteVolume,
              }));
              next = { ...analysis, signals: stamped };
              next = repriceAnalysis(next, t.last);
            }
            results.set(`${job.symbol}|${job.tf}`, next.candleAt === candleAt ? next : { ...next, candleAt });
          }
        } catch {
          failed += 1;
        }
        done += 1;
        flush();
      };

      // 게이트가 요청 간격을 조절하므로 워커는 조금 넉넉하게 둔다.
      const WORKERS = 8;
      let cursor = 0;
      const worker = async () => {
        while (cursor < jobs.length) {
          if (stale()) return;
          const job = jobs[cursor++];
          await runJob(job);
        }
      };
      await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, () => worker()));
      if (stale()) return;
      flush(true);

      const analyses = [...results.values()];
      const elapsedMs = Date.now() - startedAt;
      setState((prev) => ({
        ...prev,
        status: 'ready',
        analyses,
        signals: analyses.flatMap((a) => a.signals).sort(rankSignal),
        finishedAt: Date.now(),
        passes: prev.passes + 1,
        elapsedMs,
        candleFetches,
        cacheHits,
        priorityDone: true,
        progress: { total, done, failed },
        markets: universe.length,
        source,
      }));

      /* ---------- 3) 다음 앱 진입용 스냅숏 ---------- */
      saveSnapshot({
        v: 2,
        exchange: ex,
        at: Date.now(),
        elapsedMs,
        contracts,
        tickers,
        analyses,
        signals: analyses.flatMap((a) => a.signals),
        markets: universe.length,
      });

      /* ---------- 4) 시그널 이력 추적 ---------- */
      const flat = analyses.flatMap((a) => a.signals);
      setHistory((prev) => {
        const map = new Map(prev.map((h) => [h.id, h]));
        for (const s of flat) {
          const existing = map.get(s.id);
          map.set(s.id, {
            id: s.id,
            symbol: s.symbol,
            base: s.base,
            asset: s.asset,
            tf: s.tf,
            side: s.side,
            strategyId: s.strategyId,
            strategyShort: s.strategyShort,
            entry: s.entry,
            stop: s.stop,
            target: s.target,
            rr: s.rr,
            riskPct: (Math.abs(s.entry - s.stop) / (s.entry || 1)) * 100,
            detectedAt: s.detectedAt,
            firstSeen: existing?.firstSeen ?? Date.now(),
            state: s.state,
            r: s.currentR,
            bars: s.barsSince,
            decimals: s.decimals,
          });
        }
        const next = [...map.values()].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, HISTORY_LIMIT);
        saveHistory(next, ex);
        return next;
      });

      /* ---------- 5) 전략 교체 로그 ---------- */
      const swaps = analyses.filter((a) => a.replacement).map((a) => a.replacement!);
      if (swaps.length) {
        setSwapLog((prev) => {
          const seen = new Set(prev.map((p) => `${p.symbol}-${p.tf}-${p.fromId}-${p.toId}`));
          const fresh = swaps
            .filter((s) => !seen.has(`${s.symbol}-${s.tf}-${s.fromId}-${s.toId}`))
            .map<SwapLogEntry>((s) => ({
              at: s.at,
              symbol: s.symbol,
              base: s.base,
              tf: s.tf,
              fromId: s.fromId,
              toId: s.toId,
              fromWinRate: s.fromWinRate,
              fromRR: s.fromRR,
              toWinRate: s.toWinRate,
              toRR: s.toRR,
              reason: s.reason,
            }));
          const next = [...fresh, ...prev].slice(0, 200);
          saveSwapLog(next, ex);
          return next;
        });
      }
    } catch (e) {
      if (stale()) return;
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : '데이터를 불러오지 못했습니다',
        finishedAt: Date.now(),
        elapsedMs: Date.now() - startedAt,
      }));
    } finally {
      running.current = false;
      if (pending.current) {
        pending.current = false;
        void scan(force);
      }
    }
  }, []);

  /** 거래소 전환 — 이전 거래소의 시그널·계약·캐시를 비우고 새 거래소 마켓만 다시 스캔한다. */
  useEffect(() => {
    if (lastEx.current === exchange) return;
    lastEx.current = exchange;
    exRef.current = exchange;
    runId.current += 1;
    contractsRef.current = null;
    analysesRef.current = [];
    resetMarket();
    if (!exchange) {
      setState(baseState());
      return;
    }
    setState({ ...baseState(), status: 'scanning', startedAt: Date.now() });
    setHistory(loadHistory(exchange));
    setSwapLog(loadSwapLog(exchange));
    void scan(true);
  }, [exchange, scan]);

  useEffect(() => {
    if (autoStart) void scan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!refreshSec) return;
    const id = window.setInterval(() => {
      if (!running.current) void scan(false);
    }, refreshSec * 1000);
    return () => window.clearInterval(id);
  }, [refreshSec, scan]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([], exRef.current ?? 'bitget');
  }, []);

  const clearSwapLog = useCallback(() => {
    setSwapLog([]);
    saveSwapLog([], exRef.current ?? 'bitget');
  }, []);

  return { state, history, swapLog, scan, clearHistory, clearSwapLog };
}
