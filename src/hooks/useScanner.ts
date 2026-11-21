import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCandles, fetchContracts, fetchTickers } from '../api/bitget';
import { fetchTdCandles, isTdSymbol, tdContracts, TD_PREFIX } from '../api/twelvedata';
import { analyzeSymbol } from '../engine/backtest';
import type { Contract, Signal, SymbolAnalysis, TF, Ticker } from '../engine/types';
import { pickUniverse } from '../engine/universe';
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
  /** Twelve Data 보조 페어 스캔 상태 (키가 있을 때만) */
  extra: { status: 'off' | 'scanning' | 'ready' | 'error'; done: number; total: number; error: string | null };
}

const INITIAL: ScanState = {
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
  extra: { status: 'off', done: 0, total: 0, error: null },
};

const TFS: TF[] = ['1H', '4H'];

const rankSignal = (a: Signal, b: Signal) => {
  const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
  return rank(a) - rank(b) || b.detectedAt - a.detectedAt;
};

interface Options {
  refreshSec: number;
  autoStart?: boolean;
  /** Twelve Data 무료 API 키 — 비어 있으면 보조 페어를 호출하지 않는다. */
  twelveDataKey?: string;
}

export function useScanner({ refreshSec, autoStart = true, twelveDataKey = '' }: Options) {
  const [state, setState] = useState<ScanState>(INITIAL);
  const [history, setHistory] = useState<HistoryRecord[]>(() => loadHistory());
  const [swapLog, setSwapLog] = useState<SwapLogEntry[]>(() => loadSwapLog());
  const running = useRef(false);
  const tdRunning = useRef(false);
  const tdRef = useRef<SymbolAnalysis[]>([]);
  const keyRef = useRef(twelveDataKey);
  keyRef.current = twelveDataKey;
  const cache = useRef<{ contracts?: Contract[]; tickers?: Ticker[]; contractAt: number; tickerAt: number }>({
    contractAt: 0,
    tickerAt: 0,
  });

  /** 현재 스캔 결과에 보조 페어 분석을 합쳐 넣는다. */
  const mergeAnalyses = useCallback(() => {
    setState((prev) => {
      const keep = prev.analyses.filter((a) => !a.symbol.startsWith(TD_PREFIX));
      if (!tdRef.current.length) return prev;
      const analyses = [...keep, ...tdRef.current];
      return { ...prev, analyses, signals: analyses.flatMap((a) => a.signals).sort(rankSignal) };
    });
  }, []);

  /** Twelve Data 보조 페어(AUD/USD 등) 스캔 — 본 스캔을 막지 않도록 따로 돌린다. */
  const scanExtraPairs = useCallback(async () => {
    const key = keyRef.current.trim();
    if (!key || tdRunning.current) return;
    const pairs = tdContracts();
    tdRunning.current = true;
    setState((prev) => ({
      ...prev,
      extra: { status: 'scanning', done: 0, total: pairs.length * TFS.length, error: null },
    }));
    const collected: SymbolAnalysis[] = [];
    let done = 0;
    let firstError: string | null = null;
    for (const c of pairs) {
      for (const tf of TFS) {
        try {
          const candles = await fetchTdCandles(c.symbol, tf, key);
          const analysis = analyzeSymbol(c.symbol, c.base, c.asset, tf, candles, c.decimals);
          if (analysis) collected.push(analysis);
        } catch (e) {
          firstError = firstError ?? (e instanceof Error ? e.message : 'Twelve Data 오류');
        }
        done++;
        setState((prev) => ({ ...prev, extra: { ...prev.extra, done } }));
      }
      tdRef.current = [...collected];
      mergeAnalyses();
    }
    tdRunning.current = false;
    setState((prev) => ({
      ...prev,
      extra: {
        status: firstError && !collected.length ? 'error' : 'ready',
        done: pairs.length * TFS.length,
        total: pairs.length * TFS.length,
        error: firstError,
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const startedAt = Date.now();
    setState((prev) => ({
      ...prev,
      status: 'scanning',
      error: null,
      startedAt,
      progress: { total: 0, done: 0, failed: 0 },
    }));

    try {
      const now = Date.now();
      if (!cache.current.contracts || now - cache.current.contractAt > 10 * 60_000) {
        cache.current.contracts = await fetchContracts();
        cache.current.contractAt = now;
      }
      const contracts = cache.current.contracts;
      const tickers = await fetchTickers();
      cache.current.tickers = tickers;
      cache.current.tickerAt = now;

      const universe = pickUniverse(contracts, tickers);
      const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
      const jobs: { symbol: string; tf: TF; base: string; asset: Contract['asset']; decimals?: number }[] = [];
      for (const c of universe) {
        for (const tf of TFS) {
          jobs.push({ symbol: c.symbol, tf, base: c.base, asset: c.asset, decimals: c.asset === 'fx' ? c.decimals : undefined });
        }
      }

      setState((prev) => ({
        ...prev,
        contracts,
        tickers,
        tickersAt: now,
        progress: { total: jobs.length, done: 0, failed: 0 },
      }));

      const collected: SymbolAnalysis[] = [];
      let done = 0;
      let failed = 0;
      let cursor = 0;
      let lastFlush = 0;

      const flush = () => {
        const combined = [...collected, ...tdRef.current];
        const flat = combined.flatMap((a) => a.signals).sort(rankSignal);
        setState((prev) => ({
          ...prev,
          analyses: [...collected, ...tdRef.current],
          signals: flat,
          progress: { total: jobs.length, done, failed },
        }));
      };

      const worker = async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          try {
            const candles = isTdSymbol(job.symbol)
              ? await fetchTdCandles(job.symbol, job.tf, keyRef.current)
              : await fetchCandles(job.symbol, job.tf);
            const analysis = analyzeSymbol(job.symbol, job.base, job.asset, job.tf, candles, job.decimals);
            if (analysis) {
              const t = tickerMap.get(job.symbol);
              if (t) {
                for (const s of analysis.signals) {
                  s.fundingRate = t.fundingRate;
                  s.quoteVolume = t.quoteVolume;
                }
              }
              collected.push(analysis);
            }
          } catch {
            failed++;
          }
          done++;
          const nowTs = Date.now();
          if (nowTs - lastFlush > 260) {
            lastFlush = nowTs;
            flush();
          }
          await new Promise((r) => setTimeout(r, 165));
        }
      };

      await Promise.all([worker(), worker(), worker()]);
      flush();

      // 시그널 이력 추적 갱신
      const flat = collected.flatMap((a) => a.signals);
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
        const next = [...map.values()]
          .sort((a, b) => b.detectedAt - a.detectedAt)
          .slice(0, 400);
        saveHistory(next);
        return next;
      });

      // 전략 교체 로그
      const swaps = collected.filter((a) => a.replacement).map((a) => a.replacement!);
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

      setState((prev) => ({
        ...prev,
        status: 'ready',
        finishedAt: Date.now(),
        passes: prev.passes + 1,
      }));

      // 본 스캔이 끝난 뒤 보조 페어(Twelve Data)를 이어서 받는다.
      if (keyRef.current.trim()) void scanExtraPairs();
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : '데이터를 불러오지 못했습니다',
        finishedAt: Date.now(),
      }));
    } finally {
      running.current = false;
    }
  }, [scanExtraPairs]);

  useEffect(() => {
    if (autoStart) void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 키를 새로 넣으면 보조 페어만 바로 한 번 받아 온다.
  useEffect(() => {
    if (!twelveDataKey.trim()) {
      tdRef.current = [];
      setState((prev) => ({
        ...prev,
        extra: { status: 'off', done: 0, total: 0, error: null },
        analyses: prev.analyses.filter((a) => !a.symbol.startsWith(TD_PREFIX)),
      }));
      return;
    }
    void scanExtraPairs();
  }, [twelveDataKey, scanExtraPairs]);

  useEffect(() => {
    if (!refreshSec) return;
    const id = window.setInterval(() => {
      if (!running.current) void scan();
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
