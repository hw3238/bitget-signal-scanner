import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchHlCandles, fetchProprMarkets } from '../api/hyperliquid';
import { mapLimit } from '../api/publicMarket';
import { analyzeSymbol } from '../engine/backtest';
import { proprGroupOf, rankProprHits, type ProprGroup, type ProprHit, type ProprMarket } from '../engine/propr';
import type { Candle, Signal, TF } from '../engine/types';
import { proprBadgeLabel } from '../engine/proprUniverse';

/**
 * 🏆 Propr 5K 터보 전용 탐지 훅
 *
 * · 종목·시세는 Hyperliquid 공개 API 에서, 상장 여부는 Propr 유니버스 스냅숏에서 가져온다.
 * · 기존 전략 엔진(`analyzeSymbol`)을 **Propr 종목 캔들**에 그대로 돌려 시그널을 만든다.
 *   → 메인 스캐너(비트겟/바이낸스)와 상태·캐시·자동매매가 완전히 분리된다(주문 버튼 없음).
 * · 기본은 거래대금 상위 28종목(자산군별 최소 3종목)만 훑는다 — Hyperliquid 캔들 API 가
 *   분당 1200 weight(캔들 1회 ≈ 20+)라 146종목을 매번 받으면 한도에 걸린다.
 *   '전체 146종목' 은 사용자가 요청할 때만(진행률 표시) 돈다.
 */

const FAST_UNIVERSE = 28;
/** 자산군별 최소 탐지 종목 수 — 주식·원자재 신호가 코인에 밀려 사라지지 않게 */
const MIN_PER_GROUP = 3;
/** 캔들 메모리 캐시 유효시간 — 1H 봉은 6분, 4H 봉은 12분이면 같은 봉을 다시 받지 않는다. */
const CANDLE_TTL: Record<TF, number> = { '1H': 6 * 60_000, '4H': 12 * 60_000 };
/** 캔들 동시 요청 수 — 게이트가 간격을 조절하고 429 는 재시도한다. */
const FETCH_WORKERS = 3;
const LAST_KEY = 'cota.propr.last.v1';

export interface ProprRunSummary {
  openCount: number;
  at: number;
  tf: TF;
  scanned: number;
  hitCount: number;
}

export interface ProprState {
  status: 'idle' | 'scanning' | 'ready' | 'error';
  error: string | null;
  tf: TF;
  hits: ProprHit[];
  markets: ProprMarket[];
  progress: { done: number; total: number; failed: number };
  at: number;
  elapsedMs: number;
  scanned: number;
  allMode: boolean;
  listingCount: number;
  /** 세션·재진입 배지용 — 마지막 탐지의 진행중 건수 */
  lastRun: ProprRunSummary | null;
}

const candleCache = new Map<string, { at: number; candles: Candle[] }>();
let marketCache: { at: number; markets: ProprMarket[] } | null = null;

function loadLastRun(): ProprRunSummary | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const body = JSON.parse(raw) as ProprRunSummary;
    if (!body || typeof body.at !== 'number' || typeof body.openCount !== 'number') return null;
    return body;
  } catch {
    return null;
  }
}

function saveLastRun(run: ProprRunSummary): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(run));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

function baseState(tf: TF = '1H', lastRun: ProprRunSummary | null = null): ProprState {
  return {
    status: 'idle',
    error: null,
    tf,
    hits: [],
    markets: [],
    progress: { done: 0, total: 0, failed: 0 },
    at: 0,
    elapsedMs: 0,
    scanned: 0,
    allMode: false,
    listingCount: 0,
    lastRun,
  };
}

/**
 * 이번 탐지에 훑을 종목 — 거래대금 상위 N + 자산군별 최소 3종목 보장.
 * (전체 모드면 Propr 상장 종목 전부)
 */
export function pickProprScanSet(markets: ProprMarket[], all = false): ProprMarket[] {
  const byVolume = [...markets].sort((a, b) => b.volume24h - a.volume24h);
  if (all) return byVolume;
  const picked = byVolume.slice(0, FAST_UNIVERSE);
  const countOf = (group: Exclude<ProprGroup, 'all'>) => picked.filter((m) => proprGroupOf(m) === group).length;
  for (const group of ['majors', 'alt', 'rwa'] as const) {
    if (countOf(group) >= MIN_PER_GROUP) continue;
    for (const m of byVolume) {
      if (proprGroupOf(m) !== group) continue;
      if (picked.some((p) => p.coin === m.coin)) continue;
      picked.push(m);
      if (countOf(group) >= MIN_PER_GROUP) break;
    }
  }
  return picked;
}

/** 캔들 → 종목별 시그널 (기존 전략 엔진 그대로) */
export function analyzeProprMarket(
  market: ProprMarket,
  tf: TF,
  candles: Candle[],
): Signal[] {
  const analysis = analyzeSymbol(market.coin, market.base, market.asset, tf, candles, market.decimals);
  return analysis?.signals ?? [];
}

interface Options {
  /** 회원 게이트 — 로그인 전에는 아무 요청도 보내지 않는다 */
  enabled: boolean;
}

export function usePropr({ enabled }: Options) {
  const [state, setState] = useState<ProprState>(() => baseState('1H', loadLastRun()));
  const running = useRef(false);
  const pending = useRef<{ force: boolean; all: boolean; tf: TF } | null>(null);
  const tfRef = useRef<TF>(state.tf);
  const runId = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const scan = useCallback(async (opts: { force?: boolean; all?: boolean; tf?: TF } = {}) => {
    if (!enabledRef.current) return;
    const tf = opts.tf ?? tfRef.current;
    tfRef.current = tf;
    if (running.current) {
      pending.current = { force: !!opts.force, all: !!opts.all, tf };
      return;
    }
    running.current = true;
    const myRun = ++runId.current;
    const stale = () => runId.current !== myRun;
    const startedAt = Date.now();
    setState((prev) => ({
      ...prev,
      status: 'scanning',
      error: null,
      tf,
      progress: { done: 0, total: 0, failed: 0 },
      elapsedMs: 0,
    }));

    try {
      /* ---------- 1) Propr 상장 종목 + 실시간 시세 ---------- */
      let markets: ProprMarket[];
      if (!opts.force && marketCache && Date.now() - marketCache.at < 60_000) {
        markets = marketCache.markets;
      } else {
        markets = await fetchProprMarkets();
        marketCache = { at: Date.now(), markets };
      }
      if (stale()) return;
      if (!markets.length) throw new Error('Propr 상장 종목의 Hyperliquid 시세를 받지 못했습니다.');

      const set = pickProprScanSet(markets, !!opts.all);
      const total = set.length;
      setState((prev) => ({
        ...prev,
        markets,
        allMode: !!opts.all,
        listingCount: markets.length,
        progress: { total, done: 0, failed: 0 },
      }));

      /* ---------- 2) 캔들 → 전략 엔진 → 시그널 ---------- */
      const hits: ProprHit[] = [];
      let done = 0;
      let failed = 0;
      let lastFlush = 0;

      const flush = (immediate = false) => {
        if (stale()) return;
        const ts = Date.now();
        if (!immediate && ts - lastFlush < 160) return;
        lastFlush = ts;
        setState((prev) => ({
          ...prev,
          hits: rankProprHits(hits),
          progress: { total, done, failed },
        }));
      };

      await mapLimit(set, FETCH_WORKERS, async (market) => {
        try {
          const key = `${market.coin}|${tf}`;
          const cached = candleCache.get(key);
          const fresh = cached && Date.now() - cached.at < CANDLE_TTL[tf];
          const candles = !opts.force && fresh ? cached.candles : await fetchHlCandles(market.coin, tf);
          if (!candles.length) failed += 1;
          else {
            candleCache.set(key, { at: Date.now(), candles });
            for (const signal of analyzeProprMarket(market, tf, candles)) {
              hits.push({ signal, market, badge: proprBadgeLabel(market.base, market.type) });
            }
          }
        } catch {
          failed += 1;
        }
        done += 1;
        flush();
      });
      if (stale()) return;
      flush(true);

      const ranked = rankProprHits(hits);
      const openCount = ranked.filter((h) => h.signal.state === 'open').length;
      const summary: ProprRunSummary = {
        openCount,
        at: Date.now(),
        tf,
        scanned: set.length,
        hitCount: ranked.length,
      };
      saveLastRun(summary);
      setState((prev) => ({
        ...prev,
        status: 'ready',
        hits: ranked,
        markets,
        progress: { total, done, failed },
        at: summary.at,
        elapsedMs: Date.now() - startedAt,
        scanned: set.length,
        allMode: !!opts.all,
        listingCount: markets.length,
        lastRun: summary,
      }));
    } catch (e) {
      if (stale()) return;
      setState((prev) => ({
        ...prev,
        status: prev.hits.length ? 'ready' : 'error',
        error: e instanceof Error && e.message ? e.message : 'Propr 시그널을 탐지하지 못했습니다.',
        elapsedMs: Date.now() - startedAt,
      }));
    } finally {
      running.current = false;
      const next = pending.current;
      pending.current = null;
      if (next) void scan(next);
    }
  }, []);

  /** 로그인 뒤 처음 열 때 1회 자동 탐지 */
  const startedRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return;
    startedRef.current = true;
    void scan({ tf: tfRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  /** 타임프레임 전환 — 그 TF 캔들은 아직 없으므로 다시 탐지한다. */
  const setTf = useCallback(
    (tf: TF) => {
      if (tf === tfRef.current && state.status === 'ready') return;
      tfRef.current = tf;
      setState((prev) => ({ ...prev, tf }));
      void scan({ tf });
    },
    [scan, state.status],
  );

  /** 앱을 다시 열었을 때 이전 결과가 남아 있지 않으면 배지용 요약만 보여준다(자동 탐지가 곧 채운다). */
  const openCount = useMemo(() => state.hits.filter((h) => h.signal.state === 'open').length, [state.hits]);

  return { state, scan, setTf, openCount };
}
