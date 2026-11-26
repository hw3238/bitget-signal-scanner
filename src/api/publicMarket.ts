import type { Candle, TF } from '../engine/types';
import type { Exchange } from '../lib/exchange';
import { fetchMarketCandles } from './market';

/**
 * COTA 공개 시장 데이터 — 브라우저에서 직접 호출해 CORS 통과를 확인한 엔드포인트만 쓴다.
 *  · Bitget USDT-M  : tickers / current-fund-rate / candles(limit 500) / open-interest
 *  · Upbit          : /v1/ticker (KRW 마켓) — Access-Control-Allow-Origin: *
 *  · Bithumb        : /public/ticker/{coin}_KRW — 보조(업비트 장애 시)
 *  · 환율           : open.er-api.com (USD→KRW) → 실패 시 fawazahmed0 currency-api
 *  · 공포·탐욕 지수 : api.alternative.me/fng
 */
const BG = 'https://api.bitget.com';

async function getJson<T>(url: string, attempt = 0, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 700 + attempt * 600));
      return getJson<T>(url, attempt + 1, timeoutMs);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 350));
      return getJson<T>(url, attempt + 1, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 여러 비동기 작업을 동시 수 제한으로 실행한다(거래소 요청 한도 보호). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------------- 비트겟 펀딩비 ---------------- */

export interface FundingInfo {
  /** 8시간 기준 펀딩비(%) */
  rate: number;
  /** 정산 주기(시간) — 대부분 8 */
  interval: number;
  /** 다음 정산 시각(ms) */
  nextUpdate: number;
}

interface RawFunding {
  symbol: string;
  fundingRate: string;
  fundingRateInterval: string;
  nextUpdate: string;
}

/** 전체 USDT-M 종목의 현재 펀딩비(정산 주기 포함) */
export async function fetchFundingRates(): Promise<Map<string, FundingInfo>> {
  const body = await getJson<{ code: string; data: RawFunding[] | null }>(
    `${BG}/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES`,
  );
  const map = new Map<string, FundingInfo>();
  for (const row of body.data ?? []) {
    const raw = Number(row.fundingRate);
    const interval = Number(row.fundingRateInterval) || 8;
    if (!Number.isFinite(raw)) continue;
    map.set(row.symbol, {
      rate: raw * 100,
      interval,
      nextUpdate: Number(row.nextUpdate) || 0,
    });
  }
  return map;
}

/* ---------------- 공포·탐욕 지수 ---------------- */

export interface FearGreed {
  value: number;
  /** 원문 등급 (Extreme Fear 등) */
  raw: string;
  /** 한글 등급 */
  label: string;
  at: number;
  /** 직전 값 — 흐름 비교용 */
  previous: number | null;
}

const FNG_KO: Record<string, string> = {
  'Extreme Fear': '극단적 공포',
  Fear: '공포',
  Neutral: '중립',
  Greed: '탐욕',
  'Extreme Greed': '극단적 탐욕',
};

export async function fetchFearGreed(): Promise<FearGreed> {
  const body = await getJson<{ data: Array<{ value: string; value_classification: string; timestamp: string }> }>(
    'https://api.alternative.me/fng/?limit=2&format=json',
  );
  const first = body.data?.[0];
  if (!first) throw new Error('공포·탐욕 지수 없음');
  const value = Number(first.value);
  const prev = body.data?.[1] ? Number(body.data[1].value) : null;
  return {
    value,
    raw: first.value_classification,
    label: FNG_KO[first.value_classification] ?? first.value_classification,
    at: Number(first.timestamp) * 1000,
    previous: Number.isFinite(prev as number) ? (prev as number) : null,
  };
}

/* ---------------- 환율 (USD → KRW) ---------------- */

export interface FxRate {
  usdKrw: number;
  at: number;
  source: string;
}

export async function fetchUsdKrw(): Promise<FxRate> {
  try {
    const body = await getJson<{ result: string; rates: Record<string, number>; time_last_update_unix: number }>(
      'https://open.er-api.com/v6/latest/USD',
    );
    const rate = Number(body.rates?.KRW);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('KRW 환율 없음');
    return { usdKrw: rate, at: (body.time_last_update_unix || Date.now() / 1000) * 1000, source: 'open.er-api.com' };
  } catch {
    const body = await getJson<{ usd?: { krw?: number }; date?: string }>(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    );
    const rate = Number(body.usd?.krw);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('환율을 불러오지 못했습니다');
    const at = body.date ? Date.parse(`${body.date}T00:00:00Z`) : Date.now();
    return { usdKrw: rate, at, source: 'currency-api' };
  }
}

/* ---------------- 국내 거래소 원화 시세 ---------------- */

export interface KrwQuote {
  /** 심볼(BTC 등) */
  base: string;
  krw: number;
  change24h: number;
  /** 24시간 누적 거래대금(원) */
  volumeKrw: number;
}

interface RawUpbit {
  market: string;
  trade_price: number;
  signed_change_rate: number;
  acc_trade_price_24h: number;
}

let upbitMarkets: Set<string> | null = null;

/** 업비트 KRW 마켓 목록 — 없는 종목을 요청해 404를 남기지 않도록 먼저 확인한다. */
async function upbitKrwMarkets(): Promise<Set<string>> {
  if (upbitMarkets) return upbitMarkets;
  const rows = await getJson<Array<{ market: string }>>('https://api.upbit.com/v1/market/all');
  upbitMarkets = new Set(rows.filter((r) => r.market.startsWith('KRW-')).map((r) => r.market));
  return upbitMarkets;
}

/** 업비트 원화 마켓 시세 — 없는 종목은 결과에서 빠진다. */
export async function fetchUpbitPrices(bases: string[]): Promise<Map<string, KrwQuote>> {
  const listed = await upbitKrwMarkets();
  const wanted = bases.filter((b) => listed.has(`KRW-${b}`));
  if (wanted.length === 0) throw new Error('업비트 원화 마켓에 해당 종목이 없습니다');
  const markets = wanted.map((b) => `KRW-${b}`).join(',');
  const rows = await getJson<RawUpbit[]>(`https://api.upbit.com/v1/ticker?markets=${markets}`);
  const map = new Map<string, KrwQuote>();
  for (const row of rows) {
    const base = row.market.replace(/^KRW-/, '');
    map.set(base, {
      base,
      krw: Number(row.trade_price),
      change24h: Number(row.signed_change_rate) * 100,
      volumeKrw: Number(row.acc_trade_price_24h),
    });
  }
  return map;
}

interface RawBithumb {
  status: string;
  data: Record<string, Record<string, string>> | null;
}

/** 업비트가 응답하지 않을 때 쓰는 빗썸 원화 시세(ALL_KRW). */
export async function fetchBithumbPrices(bases: string[]): Promise<Map<string, KrwQuote>> {
  const body = await getJson<RawBithumb>('https://api.bithumb.com/public/ticker/ALL_KRW');
  const map = new Map<string, KrwQuote>();
  const data = body.data ?? {};
  for (const base of bases) {
    const row = data[base];
    if (!row) continue;
    const krw = Number(row.closing_price);
    const open = Number(row.opening_price);
    if (!Number.isFinite(krw) || krw <= 0) continue;
    map.set(base, {
      base,
      krw,
      change24h: open > 0 ? ((krw - open) / open) * 100 : 0,
      volumeKrw: Number(row.acc_trade_value_24H) || 0,
    });
  }
  return map;
}

/* ---------------- 캔들 ---------------- */

export async function fetchBigCandles(
  exchange: Exchange,
  symbol: string,
  tf: TF,
  limit = 500,
): Promise<Candle[]> {
  return fetchMarketCandles(exchange, symbol, tf, limit);
}
