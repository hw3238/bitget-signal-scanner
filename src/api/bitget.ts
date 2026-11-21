import type { AssetClass, Candle, Contract, TF, Ticker } from '../engine/types';
import { FX_BASES, isStockSymbol } from '../engine/universe';

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
  const base = symbol.replace(/USDT$/, '');
  const norm = base.replace(/STOCK$/, '');
  // FX·금·원자재·지수는 RWA 여부와 무관하게 FX 카테고리로 모은다.
  if (FX_BASES.has(base) || FX_BASES.has(norm)) return 'fx';
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
  }));
}

export async function fetchCandles(symbol: string, tf: TF): Promise<Candle[]> {
  const raw = await getJson<string[][]>(
    `/api/v2/mix/market/candles?productType=${PRODUCT}&symbol=${symbol}&granularity=${tf}&limit=200`,
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

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 10000) return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  if (abs >= 100) return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (abs >= 0.01) return value.toLocaleString('ko-KR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return value.toPrecision(4);
}

export function formatVolume(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
