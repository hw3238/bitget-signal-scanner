import type { AssetClass, Candle, Contract, TF, Ticker } from '../engine/types';
import { isFxSymbol, isStockSymbol } from '../engine/universe';
import { requestGate, sleep } from './rateLimiter';

const BASE = 'https://api.bitget.com';
const PRODUCT = 'USDT-FUTURES';

interface ApiEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

/** 한 번의 HTTP 호출 — 모든 요청은 전역 요청 게이트를 지나 간격·동시성이 조절된다. */
async function rawGet(path: string): Promise<Response> {
  await requestGate.acquire();
  try {
    return await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  } finally {
    requestGate.release();
  }
}

const isRateLimitBody = (code: string, msg: string): boolean =>
  code === '429' || code === '40034' || /rate ?limit|too many requests/i.test(msg || '');

async function getJson<T>(path: string, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await rawGet(path);
  } catch (err) {
    if (attempt < 2) {
      await sleep(320 * (attempt + 1));
      return getJson<T>(path, attempt + 1);
    }
    throw err;
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    requestGate.onThrottle(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
    if (attempt < 4) {
      await sleep(Math.min(2600, 320 * (attempt + 1)) + Math.random() * 160);
      return getJson<T>(path, attempt + 1);
    }
    throw new Error('요청 한도 초과(429)');
  }

  if (!res.ok) {
    if (attempt < 2 && res.status >= 500) {
      await sleep(300 * (attempt + 1));
      return getJson<T>(path, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const body = (await res.json()) as ApiEnvelope<T>;
  if (body.code !== '00000') {
    if (isRateLimitBody(String(body.code), String(body.msg ?? ''))) {
      requestGate.onThrottle();
      if (attempt < 4) {
        await sleep(Math.min(2600, 320 * (attempt + 1)) + Math.random() * 160);
        return getJson<T>(path, attempt + 1);
      }
    }
    throw new Error(body.msg || `code ${body.code}`);
  }
  requestGate.onSuccess();
  return body.data;
}

export function classifyContract(symbol: string, isRwa: boolean): AssetClass {
  // 금·은·원유·지수·FX 같은 RWA는 코인 스캐너에서 쓰지 않는다(fetchContracts에서 제외).
  if (isFxSymbol(symbol)) return 'fx';
  if (!isRwa) return 'crypto';
  if (isStockSymbol(symbol)) return 'stock';
  return 'stock';
}

export async function fetchContracts(): Promise<Contract[]> {
  const raw = await getJson<Array<Record<string, unknown>>>(
    `/api/v2/mix/market/contracts?productType=${PRODUCT}`,
  );
  return raw
    .filter((c) => c.symbolStatus === 'normal')
    // FX·금·원자재·지수 계약은 코인 스캐너 대상이 아니므로 목록에서 뺀다.
    .filter((c) => !isFxSymbol(String(c.symbol)))
    .map((c) => {
      const symbol = String(c.symbol);
      const isRwa = c.isRwa === 'YES';
      const decimals = Number(c.pricePlace);
      const priceEndStep = Number(c.priceEndStep);
      const minTradeNum = Number(c.minTradeNum);
      const volumePlace = Number(c.volumePlace);
      const minTradeUsdt = Number(c.minTradeUSDT);
      return {
        symbol,
        base: String(c.baseCoin ?? symbol.replace(/USDT$/, '')),
        asset: classifyContract(symbol, isRwa),
        isRwa,
        decimals: Number.isFinite(decimals) ? decimals : undefined,
        priceEndStep:
          Number.isFinite(priceEndStep) && priceEndStep > 0 ? Math.round(priceEndStep) : undefined,
        minTradeNum: Number.isFinite(minTradeNum) && minTradeNum > 0 ? minTradeNum : undefined,
        volumePlace: Number.isFinite(volumePlace) ? volumePlace : undefined,
        minTradeUsdt: Number.isFinite(minTradeUsdt) && minTradeUsdt > 0 ? minTradeUsdt : undefined,
      } satisfies Contract;
    });
}

export async function fetchTickers(): Promise<Ticker[]> {
  const raw = await getJson<Array<Record<string, string>>>(
    `/api/v2/mix/market/tickers?productType=${PRODUCT}`,
  );
  return raw.map((t) => ({
    symbol: t.symbol,
    last: Number(t.lastPr),
    change24h: Number(t.change24h) * 100,
    quoteVolume: Number(t.usdtVolume ?? t.quoteVolume),
    fundingRate: Number(t.fundingRate ?? 0) * 100,
    high24h: Number(t.high24h),
    low24h: Number(t.low24h),
    openInterestBase: Number(t.holdingAmount ?? 0) || undefined,
  }));
}

export async function fetchCandles(symbol: string, tf: TF, limit = 200): Promise<Candle[]> {
  const cap = Math.max(20, Math.min(500, Math.round(limit)));
  const raw = await getJson<string[][]>(
    `/api/v2/mix/market/candles?productType=${PRODUCT}&symbol=${symbol}&granularity=${tf}&limit=${cap}`,
  );
  return raw
    .map((row) => ({
      t: Number(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5]),
    }))
    .sort((a, b) => a.t - b.t);
}
