import type { AssetClass, Candle, Contract, TF, Ticker } from '../engine/types';
import { isFxSymbol, isStockSymbol } from '../engine/universe';

const BASE = 'https://api.bitget.com';
const PRODUCT = 'USDT-FUTURES';

interface ApiEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

async function getJson<T>(path: string, attempt = 0): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
    if (res.status === 429) {
      const wait = 700 + 550 * attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
      if (attempt < 4) return getJson<T>(path, attempt + 1);
      throw new Error('요청 한도 초과(429)');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as ApiEnvelope<T>;
    if (body.code !== '00000') throw new Error(body.msg || `code ${body.code}`);
    return body.data;
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return getJson<T>(path, attempt + 1);
    }
    throw err;
  }
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
      return {
        symbol,
        base: String(c.baseCoin ?? symbol.replace(/USDT$/, '')),
        asset: classifyContract(symbol, isRwa),
        isRwa,
        decimals: Number.isFinite(decimals) ? decimals : undefined,
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
