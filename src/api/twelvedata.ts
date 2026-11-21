import type { Candle, Contract, TF } from '../engine/types';

/**
 * Twelve Data 무료 API 보조 어댑터.
 * 비트겟에는 없는 FX 페어(AUD/USD·USD/CAD 등)를 1H 캔들로 받아 4H는 로컬 리샘플링해
 * 분당 8회 제한을 넘지 않게 한다. 키가 없으면 전혀 호출되지 않는다.
 */

const ENDPOINT = 'https://api.twelvedata.com/time_series';
/** 무료 플랜: 분당 8회 → 7.8초 간격, 60초 창 안에서 8회까지만 */
const MIN_INTERVAL_MS = 7800;
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 8;
const CACHE_TTL_MS = 5 * 60_000;
const OUTPUT_SIZE = 500;

export const TD_PREFIX = 'TD:';

export interface TdPair {
  /** Twelve Data 심볼 */
  symbol: string;
  /** 벤티지 표기(카드·호가 보정 키) */
  label: string;
  decimals: number;
}

export const TD_PAIRS: TdPair[] = [
  { symbol: 'AUD/USD', label: 'AUDUSD+', decimals: 5 },
  { symbol: 'USD/CAD', label: 'USDCAD+', decimals: 5 },
  { symbol: 'USD/CHF', label: 'USDCHF+', decimals: 5 },
  { symbol: 'NZD/USD', label: 'NZDUSD+', decimals: 5 },
  { symbol: 'EUR/JPY', label: 'EURJPY+', decimals: 3 },
  { symbol: 'GBP/JPY', label: 'GBPJPY+', decimals: 3 },
];

export function isTdSymbol(symbol: string): boolean {
  return symbol.startsWith(TD_PREFIX);
}

export function tdSymbol(pair: TdPair): string {
  return `${TD_PREFIX}${pair.symbol}`;
}

/** TD 페어를 스캔 유니버스용 계약으로 바꾼다 */
export function tdContracts(): Contract[] {
  return TD_PAIRS.map(
    (p) =>
      ({
        symbol: tdSymbol(p),
        base: p.label,
        asset: 'fx',
        isRwa: true,
        decimals: p.decimals,
      }) satisfies Contract,
  );
}

export function pairOf(symbol: string): TdPair | undefined {
  const raw = symbol.startsWith(TD_PREFIX) ? symbol.slice(TD_PREFIX.length) : symbol;
  return TD_PAIRS.find((p) => p.symbol === raw);
}

/* ---------------- 요청 스케줄러 (분당 8회) ---------------- */

const recent: number[] = [];
let chain: Promise<unknown> = Promise.resolve();

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
    const last = recent[recent.length - 1] ?? 0;
    const waitForInterval = last ? MIN_INTERVAL_MS - (now - last) : 0;
    const waitForWindow = recent.length >= WINDOW_LIMIT ? WINDOW_MS - (now - recent[0]) + 50 : 0;
    const delay = Math.max(0, waitForInterval, waitForWindow);
    if (delay <= 0) {
      recent.push(Date.now());
      return;
    }
    await wait(Math.min(delay, 5000));
  }
}

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    await acquireSlot();
    return task();
  });
  chain = next.catch(() => undefined);
  return next;
}

/* ---------------- 캔들 캐시 + 리샘플 ---------------- */

const cache = new Map<string, { at: number; candles: Candle[] }>();

function resample4H(candles: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const bucket = Math.floor(c.t / (4 * 3600_000)) * 4 * 3600_000;
    const cur = buckets.get(bucket);
    if (!cur) {
      buckets.set(bucket, { t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function parseTime(text: string): number {
  // "2026-11-21 10:00:00" (UTC)
  const iso = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(withZone);
}

interface TdResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
}

/** 1H 캔들만 요청하고 4H는 로컬에서 만든다 (요청 1회로 2개 타임프레임 확보) */
async function fetch1H(pair: TdPair, apiKey: string): Promise<Candle[]> {
  const cached = cache.get(pair.symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.candles;

  const url =
    `${ENDPOINT}?symbol=${encodeURIComponent(pair.symbol)}&interval=1h&outputsize=${OUTPUT_SIZE}` +
    `&timezone=UTC&order=ASC&format=JSON&apikey=${encodeURIComponent(apiKey)}`;
  const res = await schedule(() => fetch(url, { headers: { accept: 'application/json' } }));
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const body = (await res.json()) as TdResponse;
  if (body.status === 'error' || !body.values) {
    const msg = body.message || (body.code ? `code ${body.code}` : '응답 없음');
    throw new Error(`Twelve Data: ${msg}`);
  }
  const candles = body.values
    .map((v) => ({
      t: parseTime(v.datetime),
      o: Number(v.open),
      h: Number(v.high),
      l: Number(v.low),
      c: Number(v.close),
      v: Number(v.volume ?? 0),
    }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);
  if (!candles.length) throw new Error('Twelve Data: 캔들 없음');
  cache.set(pair.symbol, { at: Date.now(), candles });
  return candles;
}

export async function fetchTdCandles(symbol: string, tf: TF, apiKey: string): Promise<Candle[]> {
  const pair = pairOf(symbol);
  if (!pair) throw new Error(`알 수 없는 Twelve Data 심볼: ${symbol}`);
  if (!apiKey.trim()) throw new Error('Twelve Data API 키가 없습니다');
  const h1 = await fetch1H(pair, apiKey);
  const out = tf === '1H' ? h1 : resample4H(h1);
  return out.slice(-200);
}

/** 설정 화면 안내용 — 남은 요청 여유 */
export function tdRateState(): { usedInWindow: number; limit: number; minGapSec: number } {
  const now = Date.now();
  return {
    usedInWindow: recent.filter((t) => now - t <= WINDOW_MS).length,
    limit: WINDOW_LIMIT,
    minGapSec: MIN_INTERVAL_MS / 1000,
  };
}
