/**
 * 바이낸스 마켓 데이터 어댑터 — COTA 의 두 번째 거래소.
 *
 * 바이낸스는 지역(IP)에 따라 `fapi.binance.com`(USDT-M 선물)이 **HTTP 451** 을 돌려준다.
 * (한국 유저 기기에서는 200, 해외 데이터센터·클라우드 IP 에서는 451 확인됨.)
 * 그래서 항상 두 경로를 준비하고 **실제로 응답한 쪽**을 쓴다.
 *
 *   ① 선물  https://fapi.binance.com/fapi/v1/…            (ticker/24hr · exchangeInfo · klines · premiumIndex)
 *   ② 현물  https://data-api.binance.vision/api/v3/…      (지역 무관 공식 마켓 데이터, 200 확인)
 *
 * 451·CORS·네트워크 실패가 나면 자동으로 ②로 넘어가고, 화면 배지는 어느 쪽에 붙었는지
 * (`바이낸스 선물` / `바이낸스 현물 데이터`)를 솔직하게 표시한다(MARKET_SOURCE_LABEL).
 *
 * 주문은 하지 않는다 — 바이낸스 모드는 시그널 탐지 전용이고 자동매매·원클릭 주문은 비트겟 계좌 전용.
 */
import type { Candle, Contract, TF, Ticker } from '../engine/types';
import { requestGate, sleep } from './rateLimiter';

export type BinanceSource = 'futures' | 'spot';

const FAPI = 'https://fapi.binance.com';
const SPOT = 'https://data-api.binance.vision';

/** 계약 스펙(호가·수량 단위)을 받아 둘 마켓 수 — 거래대금 상위 */
export const SPOT_SPEC_LIMIT = 180;

/** 451·CORS 로 이 출처를 쓸 수 없음 — 다음 출처로 넘어간다. */
class SourceBlocked extends Error {}

let preferred: BinanceSource | null = null;
let futuresBlocked = false;

/** 지금 붙어 있는 출처 (아직 확인 전이면 null) */
export const binanceSource = (): BinanceSource | null => preferred;
export function resetBinanceSource(): void {
  preferred = null;
  futuresBlocked = false;
}

/** 시도할 출처 순서 — 이미 붙은 곳 → (막히지 않았으면) 선물 → 현물 */
export function planSources(state: { preferred: BinanceSource | null; futuresBlocked: boolean }): BinanceSource[] {
  if (state.preferred) return [state.preferred];
  return state.futuresBlocked ? ['spot'] : ['futures', 'spot'];
}

/* ------------------------------------------------------------------ *
 * HTTP — 모든 요청은 비트겟과 같은 전역 게이트를 지나 간격이 조절된다.
 * ------------------------------------------------------------------ */

function urlOf(source: BinanceSource, path: string): string {
  return source === 'futures' ? `${FAPI}/fapi/v1/${path}` : `${SPOT}/api/v3/${path}`;
}

async function getJson<T>(source: BinanceSource, path: string, attempt = 0): Promise<T> {
  const url = urlOf(source, path);
  await requestGate.acquire();
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (attempt < 1) {
      await sleep(340);
      return getJson<T>(source, path, attempt + 1);
    }
    // CORS·네트워크·시간초과 — 이 출처는 쓸 수 없다.
    throw new SourceBlocked(`${source} 연결 실패: ${err instanceof Error ? err.message : 'network'}`);
  } finally {
    requestGate.release();
  }

  if (res.status === 451 || res.status === 403) {
    throw new SourceBlocked(`${source} HTTP ${res.status}`);
  }
  if (res.status === 429) {
    requestGate.onThrottle(Number(res.headers.get('retry-after')) * 1000 || 0);
    if (attempt < 3) {
      await sleep(600 + attempt * 600);
      return getJson<T>(source, path, attempt + 1);
    }
    throw new Error('바이낸스 요청 한도 초과(429)');
  }
  if (!res.ok) {
    if (res.status >= 500 && attempt < 1) {
      await sleep(320);
      return getJson<T>(source, path, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  requestGate.onSuccess();
  return (await res.json()) as T;
}

/** 준비된 출처를 차례로 시도하고, 성공한 출처를 기억한다. */
async function withSource<T>(run: (source: BinanceSource) => Promise<T>): Promise<{ data: T; source: BinanceSource }> {
  const order = planSources({ preferred, futuresBlocked });
  let last: unknown = null;
  for (const source of order) {
    try {
      const data = await run(source);
      preferred = source;
      if (source === 'futures') futuresBlocked = false;
      return { data, source };
    } catch (err) {
      last = err;
      if (source === 'futures') futuresBlocked = true;
    }
  }
  throw last instanceof Error ? last : new Error('바이낸스 마켓 데이터에 연결하지 못했습니다');
}

/* ------------------------------------------------------------------ *
 * 파싱(순수 함수) — `scripts/exchange-check.ts` 가 경계값을 검증한다.
 * ------------------------------------------------------------------ */

/** 1H·4H → 바이낸스 interval 문자열 */
export const intervalOf = (tf: TF): string => (tf === '4H' ? '4h' : '1h');

/**
 * 호가 단위 문자열 → COTA 계약 스펙.
 *   tickSize `0.01000000` → {decimals:2, priceEndStep:1}  (실제 최소 호가 0.01)
 *   tickSize `5.00000000` → {decimals:0, priceEndStep:5}  (실제 최소 호가 5)
 */
export function tickSpec(tickSize: string | null | undefined): { decimals: number; priceEndStep: number } {
  const raw = String(tickSize ?? '').trim();
  if (!raw) return { decimals: 2, priceEndStep: 1 };
  const trimmed = raw.replace(/0+$/, '').replace(/\.$/, '');
  const [intPart, frac = ''] = trimmed.split('.');
  const decimals = frac.length;
  const mantissa = Number(`${intPart || '0'}${frac}` || '1');
  return { decimals, priceEndStep: Number.isFinite(mantissa) && mantissa > 0 ? mantissa : 1 };
}

/** 수량 단위 문자열 → 최소 주문 단위·소수 자리 */
export function stepSpec(stepSize: string | null | undefined): { volumePlace: number; step: number } {
  const spec = tickSpec(stepSize);
  return { volumePlace: spec.decimals, step: spec.priceEndStep * 10 ** -spec.decimals };
}

interface FilterLike {
  filterType?: string;
  tickSize?: string;
  minQty?: string;
  stepSize?: string;
  notional?: string;
  minNotional?: string;
}

export interface BinanceSymbolLike {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  status?: string;
  contractType?: string;
  filters?: FilterLike[];
}

/**
 * 법정화폐 기초자산 — 바이낸스 현물에는 EURUSDT·GBPUSDT 같은 통화쌍도 있다.
 * 코인 스캐너(코인 시그널·급등 탐색)에는 넣지 않는다.
 */
export const FIAT_BASES = new Set([
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'BRL',
  'TRY',
  'JPY',
  'ZAR',
  'UAH',
  'RON',
  'ARS',
  'RUB',
  'IDRT',
]);

const filterOf = (info: BinanceSymbolLike, type: string): FilterLike | undefined =>
  (info.filters ?? []).find((f) => f?.filterType === type);

/** 거래소 심볼 정보 → COTA 계약. USDT 마켓이 아니거나 거래 정지면 null. */
export function contractOf(info: BinanceSymbolLike, source: BinanceSource): Contract | null {
  const symbol = String(info.symbol ?? '').trim().toUpperCase();
  if (!symbol || (info.quoteAsset ?? 'USDT') !== 'USDT') return null;
  if ((info.status ?? 'TRADING') !== 'TRADING') return null;
  if (source === 'futures' && info.contractType && info.contractType !== 'PERPETUAL') return null;
  const base = String(info.baseAsset ?? symbol.replace(/USDT$/, '')).toUpperCase();
  if (!base || FIAT_BASES.has(base)) return null;
  const price = tickSpec(filterOf(info, 'PRICE_FILTER')?.tickSize);
  const lot = stepSpec(filterOf(info, 'LOT_SIZE')?.stepSize);
  const minQty = Number(filterOf(info, 'LOT_SIZE')?.minQty);
  const notional = Number(
    filterOf(info, 'MIN_NOTIONAL')?.notional ?? filterOf(info, 'NOTIONAL')?.minNotional ?? NaN,
  );
  return {
    symbol,
    base,
    asset: 'crypto',
    isRwa: false,
    decimals: price.decimals,
    priceEndStep: price.priceEndStep,
    minTradeNum: Number.isFinite(minQty) && minQty > 0 ? minQty : undefined,
    volumePlace: lot.volumePlace,
    minTradeUsdt: Number.isFinite(notional) && notional > 0 ? notional : undefined,
  };
}

export function contractsFromInfo(symbols: BinanceSymbolLike[], source: BinanceSource): Contract[] {
  const list: Contract[] = [];
  for (const info of symbols) {
    const c = contractOf(info, source);
    if (c) list.push(c);
  }
  return list;
}

/** 24h 티커 행 (선물·현물 동일 필드) → COTA 티커 */
export interface BinanceTickerLike {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  highPrice?: string;
  lowPrice?: string;
}

export function tickersFrom24h(rows: BinanceTickerLike[], funding: Map<string, number> = new Map()): Ticker[] {
  const out: Ticker[] = [];
  for (const row of rows) {
    const symbol = String(row.symbol ?? '').trim().toUpperCase();
    if (!symbol.endsWith('USDT')) continue;
    if (FIAT_BASES.has(symbol.replace(/USDT$/, ''))) continue;
    const last = Number(row.lastPrice);
    if (!Number.isFinite(last) || last <= 0) continue;
    out.push({
      symbol,
      last,
      change24h: Number(row.priceChangePercent) || 0,
      quoteVolume: Number(row.quoteVolume) || 0,
      fundingRate: funding.get(symbol) ?? 0,
      high24h: Number(row.highPrice) || 0,
      low24h: Number(row.lowPrice) || 0,
    });
  }
  return out;
}

export interface PremiumIndexLike {
  symbol?: string;
  lastFundingRate?: string;
}

/** premiumIndex → 심볼별 펀딩비(%) */
export function fundingFromPremium(rows: PremiumIndexLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const symbol = String(row.symbol ?? '').trim().toUpperCase();
    const rate = Number(row.lastFundingRate);
    if (symbol && Number.isFinite(rate)) map.set(symbol, rate * 100);
  }
  return map;
}

/** klines 행 → 캔들 (시간 오름차순) */
export function candlesFromRows(rows: unknown[][]): Candle[] {
  const out: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    const v = Number(row[5]);
    if (![t, o, h, l, c].every((n) => Number.isFinite(n))) continue;
    out.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 계약 스펙을 요청할 심볼 — 거래대금 상위 N개 */
export function topSymbols(tickers: Ticker[], limit = SPOT_SPEC_LIMIT): string[] {
  return [...tickers]
    .filter((t) => t.symbol.endsWith('USDT') && t.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, Math.max(1, limit))
    .map((t) => t.symbol);
}

const symbolsParam = (symbols: string[]): string => `symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

/* ------------------------------------------------------------------ *
 * 공개 API
 * ------------------------------------------------------------------ */

/** 선물 펀딩비 — 5분 캐시 (여러 스캔에서 재사용) */
let fundingCache: { at: number; map: Map<string, number> } = { at: 0, map: new Map() };

export async function fetchBinanceFunding(): Promise<Map<string, number>> {
  if (Date.now() - fundingCache.at < 5 * 60_000) return fundingCache.map;
  try {
    const { data, source } = await withSource((src) => {
      if (src === 'spot') return Promise.resolve<PremiumIndexLike[]>([]);
      return getJson<PremiumIndexLike[]>('futures', 'premiumIndex');
    });
    const map = source === 'futures' ? fundingFromPremium(data) : new Map<string, number>();
    fundingCache = { at: Date.now(), map };
    return map;
  } catch {
    return fundingCache.map;
  }
}

/**
 * 24h 티커. `symbols` 를 주면 그 종목만 받는다(재스캔 시 전 종목 1.9MB 를 매번 받지 않게).
 * 반환하는 `source` 가 화면 배지의 실제 출처다.
 */
export async function fetchBinanceTickers(symbols?: string[]): Promise<{ tickers: Ticker[]; source: BinanceSource }> {
  const batch = symbols && symbols.length ? symbols.slice(0, 240) : null;
  const funding = await fetchBinanceFunding();
  const { data, source } = await withSource(async (src) => {
    const path = batch ? `ticker/24hr?${symbolsParam(batch)}` : 'ticker/24hr';
    try {
      return await getJson<BinanceTickerLike[]>(src, path);
    } catch (err) {
      // 출처가 막힌 것이면 그대로 넘겨 다음 출처로 간다.
      if (err instanceof SourceBlocked) throw err;
      // 배치 파라미터를 거절하는 응답이면 전 종목으로 한 번 더.
      if (batch) return getJson<BinanceTickerLike[]>(src, 'ticker/24hr');
      throw err;
    }
  });
  const rows = Array.isArray(data) ? data : [];
  return { tickers: tickersFrom24h(rows, funding), source };
}

/**
 * USDT 마켓 계약 목록.
 *  · 선물: exchangeInfo 전체(계약 스펙 포함)
 *  · 현물: 거래대금 상위 종목만 `symbols=` 로 묶어 요청(전체는 18MB 라 쓰지 않는다)
 */
export async function fetchBinanceContracts(
  tickers: Ticker[],
  source: BinanceSource,
): Promise<Contract[]> {
  if (source === 'futures') {
    const { data } = await withSource((src) =>
      getJson<{ symbols?: BinanceSymbolLike[] }>(src, 'exchangeInfo'),
    );
    return contractsFromInfo(data.symbols ?? [], 'futures');
  }

  const wanted = topSymbols(tickers);
  const base = tickers.filter((t) => t.symbol.endsWith('USDT')).map((t) => ({
    symbol: t.symbol,
    base: t.symbol.replace(/USDT$/, ''),
    asset: 'crypto' as const,
    isRwa: false,
  }));
  if (!wanted.length) return base;
  try {
    const { data } = await withSource((src) =>
      getJson<{ symbols?: BinanceSymbolLike[] }>(src, `exchangeInfo?${symbolsParam(wanted)}`),
    );
    const rich = contractsFromInfo(data.symbols ?? [], 'spot');
    const bySymbol = new Map(rich.map((c) => [c.symbol, c]));
    // 스펙을 못 받은 종목도 스캔 대상에서는 빠지지 않게 최소 정보로 채운다.
    return base.map((c) => bySymbol.get(c.symbol) ?? c);
  } catch {
    return base;
  }
}

/** 캔들 — 실패하면 캔들 캐시가 빈 상태로 남지 않도록 그대로 예외를 던진다. */
export async function fetchBinanceCandles(symbol: string, tf: TF, limit = 200): Promise<Candle[]> {
  const cap = Math.max(20, Math.min(500, Math.round(limit)));
  const sym = symbol.trim().toUpperCase();
  const { data } = await withSource((src) =>
    getJson<unknown[][]>(src, `klines?symbol=${encodeURIComponent(sym)}&interval=${intervalOf(tf)}&limit=${cap}`),
  );
  return candlesFromRows(Array.isArray(data) ? data : []);
}
