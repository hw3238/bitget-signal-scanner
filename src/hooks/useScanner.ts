import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCandles, fetchContracts, fetchTickers } from '../api/bitget';
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
  type ScanSnapshot,
} from '../lib/scanCache';
import { loadHistory, loadSwapLog, saveHistory, saveSwapLog, type HistoryRecord, type SwapLogEntry } from '../lib/storage';

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
  };
}

const rankSignal = (a: Signal, b: Signal) => {
  const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
  return rank(a) - rank(b) || b.detectedAt - a.detectedAt;
};

/** 앱 재진입: 직전 스캔 스냅숏이 있으면 기다림 없이 바로 그 상태로 시작한다. */
function initialStateFrom(snap: ScanSnapshot | null): ScanState {
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
  hydrateAnalyses(analyses);
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
}

interface Job {
  symbol: string;
  tf: TF;
  base: string;
  asset: Contract['asset'];
  decimals?: number;
  tier: number;
}

export function useScanner({ refreshSec, autoStart = true, favoriteSymbols = [] }: Options) {
  const boot = useRef<ScanState | null>(null);
  if (boot.current === null) boot.current = initialStateFrom(loadSnapshot());
  const initial = boot.current ?? baseState();
  const [state, setState] = useState<ScanState>(initial);
  const [history, setHistory] = useState<HistoryRecord[]>(() => loadHistory());
  const [swapLog, setSwapLog] = useState<SwapLogEntry[]>(() => loadSwapLog());
  const running = useRef(false);
  const analysesRef = useRef<SymbolAnalysis[]>(initial.analyses);
  const contractsRef = useRef<{ list: Contract[]; at: number } | null>(null);
  const favoritesRef = useRef<string[]>(favoriteSymbols);
  favoritesRef.current = favoriteSymbols;

  const scan = useCallback(async (force = false) => {
    if (running.current) return;
    running.current = true;
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
      /* ---------- 0) 계약 목록(10분 캐시) + 실시간 티커 ---------- */
      const now = Date.now();
      if (!contractsRef.current || now - contractsRef.current.at > 10 * 60_000) {
        contractsRef.current = { list: await fetchContracts(), at: now };
      }
      const contracts = contractsRef.current.list;
      const tickers = await fetchTickers();
      const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));

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
        }));
      } else {
        setState((prev) => ({ ...prev, contracts, tickers, tickersAt: now }));
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
          let candles = readCandles(job.symbol, job.tf, ttl);
          let analysis: SymbolAnalysis | null = null;
          if (candles) {
            cacheHits += 1;
            analysis = readAnalysis(job.symbol, job.tf, candles);
          } else {
            // 캔들 데이터는 없어도(앱 재진입 직후) TTL 안이면 직전 분석을 그대로 쓴다.
            analysis = readFreshAnalysis(job.symbol, job.tf, ttl);
            if (analysis) cacheHits += 1;
          }
          if (!candles && !analysis) {
            candles = await fetchCandles(job.symbol, job.tf);
            writeCandles(job.symbol, job.tf, candles);
            candleFetches += 1;
            analysis = readAnalysis(job.symbol, job.tf, candles);
          }
          if (!analysis) {
            if (!candles) {
              candles = await fetchCandles(job.symbol, job.tf);
              writeCandles(job.symbol, job.tf, candles);
              candleFetches += 1;
            }
            analysis = analyzeSymbol(job.symbol, job.base, job.asset, job.tf, candles, job.decimals);
            if (analysis) writeAnalysis(analysis, candles);
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
          const job = jobs[cursor++];
          await runJob(job);
        }
      };
      await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, () => worker()));
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
      }));

      /* ---------- 3) 다음 앱 진입용 스냅숏 ---------- */
      const snapshot: ScanSnapshot = {
        v: 1,
        at: Date.now(),
        elapsedMs,
        contracts,
        tickers,
        analyses,
        signals: analyses.flatMap((a) => a.signals),
        markets: universe.length,
      };
      saveSnapshot(snapshot);

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
        const next = [...map.values()].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 400);
        saveHistory(next);
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
          saveSwapLog(next);
          return next;
        });
      }
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : '데이터를 불러오지 못했습니다',
        finishedAt: Date.now(),
        elapsedMs: Date.now() - startedAt,
      }));
    } finally {
      running.current = false;
    }
  }, []);

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
    saveHistory([]);
  }, []);

  const clearSwapLog = useCallback(() => {
    setSwapLog([]);
    saveSwapLog([]);
  }, []);

  return { state, history, swapLog, scan, clearHistory, clearSwapLog };
}
