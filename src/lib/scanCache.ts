/**
 * 스캔 캐시 — 캔들 TTL · 분석 결과 재사용 · localStorage 스냅숏.
 *
 * 1) 캔들: 같은 봉이 아직 진행 중이면 다시 받을 필요가 없다. 1H 90초 · 4H 180초 동안 재사용.
 * 2) 분석: 캔들(마지막 봉 시각 + 개수)이 같으면 6전략 백테스트 결과도 같다 → 재계산 없이 재사용.
 * 3) 실시간 가격: 티커만 새로 받아 시그널의 현재가·수익률·진행도를 다시 계산한다(0.3초).
 * 4) 스냅숏: 앱을 다시 열면 직전 결과를 즉시 그리고, 뒤에서 최신 데이터로 조용히 갱신한다.
 */
import type { Candle, Contract, Signal, SymbolAnalysis, TF, Ticker } from '../engine/types';

export const CANDLE_TTL_MS: Record<TF, number> = { '1H': 90_000, '4H': 180_000 };

const SNAPSHOT_KEY = 'cota.scan.snapshot.v1';
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface CandleEntry {
  at: number;
  candles: Candle[];
}

const candleStore = new Map<string, CandleEntry>();
const analysisStore = new Map<string, { stamp: string; analysis: SymbolAnalysis }>();

const keyOf = (symbol: string, tf: TF) => `${symbol}|${tf}`;
const stampOf = (candles: Candle[]): string =>
  candles.length
    ? `${candles.length}:${candles[candles.length - 1].t}:${candles[candles.length - 1].c}`
    : '0';

export function ttlFor(tf: TF): number {
  return CANDLE_TTL_MS[tf] ?? 90_000;
}

/** TTL 안에 받아 둔 캔들이면 그대로 쓴다. maxAgeMs=0 이면 항상 새로 받는다. */
export function readCandles(symbol: string, tf: TF, maxAgeMs = ttlFor(tf)): Candle[] | null {
  const entry = candleStore.get(keyOf(symbol, tf));
  if (!entry) return null;
  if (maxAgeMs <= 0) return null;
  if (Date.now() - entry.at > maxAgeMs) return null;
  return entry.candles;
}

export function writeCandles(symbol: string, tf: TF, candles: Candle[]): void {
  candleStore.set(keyOf(symbol, tf), { at: Date.now(), candles });
}

export function candleAgeMs(symbol: string, tf: TF): number {
  const entry = candleStore.get(keyOf(symbol, tf));
  return entry ? Date.now() - entry.at : Number.POSITIVE_INFINITY;
}

/** 같은 캔들로 계산한 분석이 있으면 재사용(지표·백테스트 재계산 생략). */
export function readAnalysis(symbol: string, tf: TF, candles: Candle[]): SymbolAnalysis | null {
  const entry = analysisStore.get(keyOf(symbol, tf));
  if (!entry) return null;
  if (!entry.stamp) return null;
  return entry.stamp === stampOf(candles) ? entry.analysis : null;
}

/**
 * 캔들 없이도 TTL 안이면 분석을 그대로 쓴다.
 * 앱을 다시 열었을 때 직전 스냅숏의 분석을 그대로 이어 쓰기 위한 경로(재요청 0건).
 */
export function readFreshAnalysis(symbol: string, tf: TF, maxAgeMs = ttlFor(tf)): SymbolAnalysis | null {
  const entry = analysisStore.get(keyOf(symbol, tf));
  if (!entry) return null;
  const at = entry.analysis.candleAt ?? 0;
  if (!at || maxAgeMs <= 0) return null;
  return Date.now() - at <= maxAgeMs ? entry.analysis : null;
}

export function writeAnalysis(analysis: SymbolAnalysis, candles: Candle[], at = Date.now()): void {
  analysisStore.set(keyOf(analysis.symbol, analysis.tf), {
    stamp: stampOf(candles),
    analysis: { ...analysis, candleAt: at },
  });
}

/** 스냅숏에서 복원한 분석을 캐시에 올린다 — 캔들 재요청 없이 이어 쓴다. */
export function hydrateAnalyses(list: SymbolAnalysis[]): void {
  for (const a of list) {
    if (!a?.symbol || !a.tf) continue;
    analysisStore.set(keyOf(a.symbol, a.tf), { stamp: '', analysis: a });
  }
}

export function clearScanCache(): void {
  candleStore.clear();
  analysisStore.clear();
}

/** 시그널에 실시간 가격을 반영 — 현재가·진입가 대비 수익률·진행도·잔여 R을 다시 계산한다. */
export function repriceSignal(signal: Signal, price: number): Signal {
  if (!Number.isFinite(price) || price <= 0) return signal;
  const dir = signal.side === 'long' ? 1 : -1;
  const entry = signal.entry || 1;
  const changePct = ((price - entry) / entry) * 100 * dir;
  const riskDen = Math.abs(signal.entry - signal.stop) || 1;
  const span = Math.abs(signal.target - signal.entry) || 1;
  const moved = signal.side === 'long' ? price - signal.entry : signal.entry - price;
  const isOpen = signal.state === 'open';
  const progress = signal.state === 'win' ? 1 : signal.state === 'loss' ? 0 : Math.max(0, Math.min(1, moved / span));
  const risk = Math.abs(price - signal.stop);
  const reward = signal.side === 'long' ? signal.target - price : price - signal.target;
  const remainingRR = isOpen && risk > 0 ? Math.max(0, reward / risk) : 0;
  const currentR =
    signal.state === 'win' ? signal.rr : signal.state === 'loss' ? -1 : ((price - signal.entry) * dir) / riskDen;
  if (
    signal.price === price &&
    signal.changePct === changePct &&
    signal.progress === progress &&
    signal.remainingRR === remainingRR
  ) {
    return signal;
  }
  return {
    ...signal,
    price,
    changePct,
    progress,
    remainingRR,
    currentR,
    levRoi: changePct * (signal.leverage || 10),
  };
}

/** 분석 하나의 시그널에 실시간 가격을 반영한다(변경 없으면 원본 유지). */
export function repriceAnalysis(analysis: SymbolAnalysis, price: number): SymbolAnalysis {
  if (!analysis.signals.length || !Number.isFinite(price) || price <= 0) return analysis;
  let changed = false;
  const signals = analysis.signals.map((s) => {
    const next = repriceSignal(s, price);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...analysis, signals } : analysis;
}

/* ------------------------------------------------------------------ *
 * 스냅숏 — 앱 재진입 시 즉시 그리기
 * ------------------------------------------------------------------ */

export interface ScanSnapshot {
  v: 1;
  at: number;
  elapsedMs: number;
  contracts: Contract[];
  tickers: Ticker[];
  /** 분석 요약(시그널 배열은 비움 — 용량 절약) */
  analyses: SymbolAnalysis[];
  /** 화면에 그릴 시그널(진행중 위주, 캔들 포함) */
  signals: Signal[];
  /** 스캔한 마켓 수 */
  markets: number;
}

/** localStorage 한도(약 5MB) 안에 들어가도록 시그널을 줄여 저장한다. */
function pack(snapshot: ScanSnapshot): ScanSnapshot {
  const keep = (sig: Signal, candleTrim: number): Signal => ({
    ...sig,
    candles: sig.candles.slice(-candleTrim),
    detectedIdx: Math.min(sig.detectedIdx, candleTrim - 1),
  });
  const open = snapshot.signals.filter((s) => s.state === 'open');
  const closed = snapshot.signals.filter((s) => s.state !== 'open').slice(0, 60);
  const packed = [...open.slice(0, 60).map((s) => keep(s, 36)), ...closed.map((s) => keep(s, 14))];
  return {
    ...snapshot,
    analyses: snapshot.analyses.map((a) => ({ ...a, signals: [] })),
    signals: packed,
  };
}

export function loadSnapshot(): ScanSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScanSnapshot;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.signals)) return null;
    if (Date.now() - parsed.at > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: ScanSnapshot): void {
  const attempts: (() => ScanSnapshot)[] = [
    () => pack(snapshot),
    () => pack({ ...snapshot, signals: snapshot.signals.filter((s) => s.state === 'open').slice(0, 30) }),
    () => ({ ...pack(snapshot), analyses: [], signals: snapshot.signals.filter((s) => s.state === 'open').slice(0, 12) }),
  ];
  for (const make of attempts) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(make()));
      return;
    } catch {
      /* 용량 초과 — 더 작은 형태로 재시도 */
    }
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}
