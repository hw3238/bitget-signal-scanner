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

/**
 * 출처 기억 — 한 번 '이 기기에서 막힘'을 확인하면 저장해 두고, 다음 실행·거래소 전환에서
 * **같은 실패를 반복하지 않는다**(CORS 오류 로그·지연 0). 30분 뒤 다시 확인한다(망/VPN 이 바뀔 수 있다).
 */
const SOURCE_STORAGE_KEY = 'cota.binance.source.v1';
const BLOCK_TTL_MS = 30 * 60_000;
const PREFERRED_TTL_MS = 6 * 60 * 60_000;

interface SourceMemory {
  preferred: BinanceSource | null;
  futuresBlocked: boolean;
  at: number;
}

function loadMemory(): SourceMemory {
  try {
    const raw = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) ?? 'null') as Partial<SourceMemory> | null;
    if (!raw || typeof raw !== 'object') return { preferred: null, futuresBlocked: false, at: 0 };
    const at = Number(raw.at) || 0;
    const age = Date.now() - at;
    const preferred =
      (raw.preferred === 'futures' || raw.preferred === 'spot') && age < PREFERRED_TTL_MS ? raw.preferred : null;
    return { preferred, futuresBlocked: !!raw.futuresBlocked && age < BLOCK_TTL_MS, at };
  } catch {
    return { preferred: null, futuresBlocked: false, at: 0 };
  }
}

function saveMemory(): void {
  try {
    localStorage.setItem(
      SOURCE_STORAGE_KEY,
      JSON.stringify({ preferred, futuresBlocked, at: Date.now() } satisfies SourceMemory),
    );
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

const memory = loadMemory();
let preferred: BinanceSource | null = memory.preferred;
let futuresBlocked = memory.futuresBlocked;

/** 지금 붙어 있는 출처 (아직 확인 전이면 null) */
export const binanceSource = (): BinanceSource | null => preferred;
/** 기억까지 지우고 처음부터 다시 확인한다(검증·문제 해결용). */
export function resetBinanceSource(): void {
  preferred = null;
  futuresBlocked = false;
  saveMemory();
}

/**
 * 시도할 출처 순서 — 붙어 있는 곳을 먼저, 나머지를 뒤에(그 출처가 일시적으로 막히면 넘어간다).
 *  · 선물이 이 기기에서 막혔으면(futuresBlocked) 현물만 남긴다.
 */
export function planSources(state: { preferred: BinanceSource | null; futuresBlocked: boolean }): BinanceSource[] {
  const usable: BinanceSource[] = state.futuresBlocked ? ['spot'] : ['futures', 'spot'];
  if (!state.preferred) return usable;
  return [state.preferred, ...usable.filter((source) => source !== state.preferred)];
}

/**
 * 이 출처를 이 기기에서 쓸 수 없다 — 451(지역 차단)·403·CORS·DNS. 다음 출처로 넘어가고 기억한다.
 */
class SourceBlocked extends Error {}

/**
 * 일시적 한도(418 IP 밴 · 429 레이트리밋) — **출처를 막지 않는다**.
 * 잠시 쉬었다 다시 보내고, 그래도 안 되면 그때만 다른 출처를 쓴다.
 */
class Throttled extends Error {}

/* ------------------------------------------------------------------ *
 * HTTP — 모든 요청은 비트겟과 같은 전역 게이트를 지나 간격이 조절된다.
 * ------------------------------------------------------------------ */

function urlOf(source: BinanceSource, path: string): string {
  return source === 'futures' ? `${FAPI}/fapi/v1/${path}` : `${SPOT}/api/v3/${path}`;
}

async function getJson<T>(source: BinanceSource, path: string, attempt = 0): Promise<T> {
  const url = urlOf(source, path);
  await requestGate.acquire();
  let res: Response | null = null;
  let netErr: unknown = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    netErr = err;
  } finally {
    requestGate.release();
  }

  if (!res || netErr) {
    // 시간 초과는 일시적일 수 있어 한 번만 다시 보낸다.
    // CORS·DNS 차단은 몇 번을 보내도 같으므로 재시도하지 않고 곧바로 다른 출처로 넘어간다(로그·지연 최소화).
    const timedOut = netErr instanceof DOMException && netErr.name === 'AbortError';
    if (timedOut && attempt < 1) {
      await sleep(300);
      return getJson<T>(source, path, attempt + 1);
    }
    throw new SourceBlocked(`${source} 연결 실패: ${netErr instanceof Error ? netErr.message : 'network'}`);
  }

  if (res.status === 451 || res.status === 403) {
    throw new SourceBlocked(`${source} HTTP ${res.status}`);
  }
  if (res.status === 418 || res.status === 429) {
    // 418 = IP 자동 차단, 429 = 호출 한도. 요청 게이트를 물러나게 하고 잠시 뒤 다시.
    const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
    requestGate.onThrottle(res.status === 418 ? Math.max(retryAfter, 4000) : retryAfter);
    if (attempt < 2) {
      await sleep(800 + attempt * 1200);
      return getJson<T>(source, path, attempt + 1);
    }
    throw new Throttled(`${source} 요청 한도 초과(${res.status})`);
  }
  if (!res.ok) {
    if (res.status >= 500 && attempt < 1) {
      await sleep(320);
      return getJson<T>(source, path, attempt + 1);
    }
    // 400·404 는 '이 요청'의 문제(없는 심볼 등) — 출처를 막지 않는다.
    throw new Error(`HTTP ${res.status}`);
  }
  requestGate.onSuccess();
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error('응답을 읽지 못했습니다');
  }
}

/**
 * 준비된 출처를 차례로 시도하고, 성공한 출처를 기억한다.
 *  · SourceBlocked(451·403·CORS) → 그 출처를 이 기기에서 못 쓴다고 기억하고 다음 출처로.
 *  · Throttled(418·429) → 출처를 막지 않고 다음 출처로(둘 다 막히면 그때만 실패).
 *  · 그 밖의 오류(400·404 등) → 다음 출처를 시도하되 '막힘'으로 기록하지 않는다.
 */
async function withSource<T>(
  run: (source: BinanceSource) => Promise<T>,
  what = '마켓 데이터',
): Promise<{ data: T; source: BinanceSource }> {
  const order = planSources({ preferred, futuresBlocked });
  let last: unknown = null;
  for (const source of order) {
    try {
      const data = await run(source);
      preferred = source;
      if (source === 'futures') futuresBlocked = false;
      saveMemory();
      return { data, source };
    } catch (err) {
      last = err;
      if (err instanceof SourceBlocked && source === 'futures') {
        futuresBlocked = true;
        saveMemory();
      }
    }
  }
  const reason = last instanceof Error ? last.message : '';
  throw new Error(
    reason.includes('HTTP 4') || reason.includes('HTTP 5') || reason.includes('응답')
      ? `바이낸스 ${what}을 받지 못했습니다 (${reason})`
      : `바이낸스 ${what}에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.`,
  );
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

/** 선물 펀딩비 — 5분 캐시 (여러 스캔에서 재사용). 실패도 5분 기억해 매 스캔 재시도하지 않는다. */
let fundingCache: { at: number; map: Map<string, number>; failedAt: number } = { at: 0, map: new Map(), failedAt: 0 };

/** 거래소 전환 — 펀딩비 캐시만 비운다(출처 기억은 기기·망의 성질이라 유지 → 같은 실패를 반복하지 않는다). */
export function resetBinanceCache(): void {
  fundingCache = { at: 0, map: new Map(), failedAt: 0 };
}

export async function fetchBinanceFunding(): Promise<Map<string, number>> {
  const now = Date.now();
  if (now - fundingCache.at < 5 * 60_000) return fundingCache.map;
  if (now - fundingCache.failedAt < 5 * 60_000) return fundingCache.map;
  try {
    const { data, source } = await withSource((src) => {
      // 현물 데이터에는 펀딩비가 없다 — 요청 자체를 보내지 않는다(불필요한 실패·로그 방지).
      if (src === 'spot') return Promise.resolve<PremiumIndexLike[]>([]);
      return getJson<PremiumIndexLike[]>('futures', 'premiumIndex');
    }, '펀딩비');
    const map = source === 'futures' ? fundingFromPremium(data) : new Map<string, number>();
    fundingCache = { at: Date.now(), map, failedAt: 0 };
    return map;
  } catch {
    fundingCache = { ...fundingCache, failedAt: Date.now() };
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
  const tickers = tickersFrom24h(rows, funding);
  // 티커가 한 건도 없으면 '빈 마켓'으로 스캔을 끝내지 않는다 — 다음 출처·재시도로 넘긴다.
  if (!tickers.length) throw new Error('바이낸스 티커 응답이 비어 있습니다');
  return { tickers, source };
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
  const base = tickers.filter((t) => t.symbol.endsWith('USDT')).map((t) => ({
    symbol: t.symbol,
    base: t.symbol.replace(/USDT$/, ''),
    asset: 'crypto' as const,
    isRwa: false,
  }));

  if (source === 'futures') {
    try {
      const { data } = await withSource((src) => getJson<{ symbols?: BinanceSymbolLike[] }>(src, 'exchangeInfo'), '계약 정보');
      const list = contractsFromInfo(data.symbols ?? [], 'futures');
      // 계약 목록이 비어 오면(빈 데이터) 최소 정보로라도 스캔이 돌게 한다.
      return list.length ? list : base;
    } catch {
      // 계약 스펙을 못 받아도 **스캔 자체를 실패시키지 않는다** — 종목·티커만으로 계속 간다.
      return base;
    }
  }

  const wanted = topSymbols(tickers);
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
