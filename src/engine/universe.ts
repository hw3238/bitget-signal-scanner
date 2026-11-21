import type { Contract, Ticker } from './types';

/** FX·금·원자재·지수 RWA (주식선물 아님) — 비트겟 base 심볼 */
export const FX_BASES = new Set([
  'XAU',
  'XAG',
  'XPT',
  'XPD',
  'PAXG',
  'XAUT',
  'COPPER',
  'CL',
  'BZ',
  'NATGAS',
  'DXY',
  'EURUSD',
  'USDJPY',
  'GBPUSD',
  'USDBRL',
  'NDX100',
  'SP500',
  'JP225',
  'HSI',
  'KR200',
  'TMF', // 채권 ETF 성격이지만 금리 상품
]);

/** 구버전 이름 호환 */
export const COMMODITY_BASES = FX_BASES;

export interface FxMeta {
  /** 비트겟 계약 심볼 */
  symbol: string;
  /** 벤티지 MT5에서 알아보기 쉬운 표기 */
  label: string;
  kind: 'fx' | 'metal' | 'energy' | 'index';
  note?: string;
}

/**
 * 비트겟 USDT-M에서 1H/4H 200봉이 실제로 열리는 FX·금·원자재·지수 계약 전수.
 * label은 벤티지 MT5 차트 이름(+ 접미사)에 맞춘 표기다.
 */
export const FX_UNIVERSE: FxMeta[] = [
  { symbol: 'XAUUSDT', label: 'XAUUSD+', kind: 'metal', note: '금 현물 프록시' },
  { symbol: 'EURUSDUSDT', label: 'EURUSD+', kind: 'fx', note: '유로/달러' },
  { symbol: 'XAGUSDT', label: 'XAGUSD+', kind: 'metal', note: '은' },
  { symbol: 'XAUTUSDT', label: 'XAUT+', kind: 'metal', note: 'Tether Gold' },
  { symbol: 'PAXGUSDT', label: 'PAXG+', kind: 'metal', note: 'Paxos Gold' },
  { symbol: 'XPTUSDT', label: 'XPTUSD+', kind: 'metal', note: '백금' },
  { symbol: 'XPDUSDT', label: 'XPDUSD+', kind: 'metal', note: '팔라듐' },
  { symbol: 'GBPUSDUSDT', label: 'GBPUSD+', kind: 'fx' },
  { symbol: 'USDJPYUSDT', label: 'USDJPY+', kind: 'fx' },
  { symbol: 'USDBRLUSDT', label: 'USDBRL+', kind: 'fx' },
  { symbol: 'CLUSDT', label: 'USOIL+', kind: 'energy', note: 'WTI 원유' },
  { symbol: 'BZUSDT', label: 'UKOIL+', kind: 'energy', note: '브렌트유' },
  { symbol: 'NATGASUSDT', label: 'NATGAS+', kind: 'energy' },
  { symbol: 'COPPERUSDT', label: 'COPPER+', kind: 'metal' },
  { symbol: 'DXYUSDT', label: 'DXY+', kind: 'index', note: '달러 인덱스' },
  { symbol: 'NDX100USDT', label: 'NAS100+', kind: 'index' },
  { symbol: 'SP500USDT', label: 'US500+', kind: 'index' },
  { symbol: 'JP225USDT', label: 'JP225+', kind: 'index' },
  { symbol: 'HSIUSDT', label: 'HK50+', kind: 'index' },
  { symbol: 'KR200USDT', label: 'KR200+', kind: 'index' },
];

/** 현우님 주력 3종목 — 스캔 큐 맨 앞에 고정 */
export const PRIORITY_SYMBOLS = ['XAUUSDT', 'EURUSDUSDT', 'BTCUSDT'] as const;

const FX_META_BY_SYMBOL = new Map(FX_UNIVERSE.map((m) => [m.symbol, m]));

/** 벤티지 MT5 표기(XAUUSD+, EURUSD+ …) — 호가 보정 UI·카드 라벨의 키 */
export const FX_LABELS: string[] = FX_UNIVERSE.map((m) => m.label);

export function fxMeta(symbol: string): FxMeta | undefined {
  return FX_META_BY_SYMBOL.get(symbol);
}

/** FX 계약의 표시 이름. 목록에 없는 RWA 계약도 `BASENAME+` 로 표기한다. */
export function fxLabel(symbol: string, base: string): string {
  const meta = FX_META_BY_SYMBOL.get(symbol);
  if (meta) return meta.label;
  const b = (base || symbol.replace(/USDT$/, '')).replace(/STOCK$/, '');
  return b.endsWith('+') ? b : `${b}+`;
}

/** 스캔 우선순위 주식/ETF 선물 */
export const STOCK_WATCHLIST = [
  'TSLA',
  'NVDA',
  'MSTR',
  'COIN',
  'AAPL',
  'AMD',
  'META',
  'MSFT',
  'GOOGL',
  'AMZN',
  'PLTR',
  'HOOD',
  'SOXL',
  'TQQQ',
  'QQQ',
  'SPY',
  'MU',
  'AVGO',
  'SMCI',
  'NFLX',
  'UBER',
  'IONQ',
  'BABA',
  'SQQQ',
  'SOXS',
  'MARA',
  'QCOM',
  'INTC',
  'ARM',
  'TSM',
  'ORCL',
  'WDC',
  'CRWV',
  'NBIS',
  'OKLO',
  'IONQ',
  'SOFI',
  'RIOT',
  'CLSK',
  'HUT',
  'CORZ',
  'RDDT',
  'APP',
  'DKNG',
  'SPCX',
];

export const CRYPTO_TOP_N = 30;

export function isStockSymbol(symbol: string): boolean {
  const base = symbol.replace(/USDT$/, '');
  if (base.endsWith('STOCK')) return true;
  return STOCK_WATCHLIST.includes(base);
}

export function displayBase(symbol: string, base: string): string {
  return (base || symbol.replace(/USDT$/, '')).replace(/STOCK$/, '');
}

/** FX·금·원자재·지수 계약을 벤티지 표기로 바꾼다 */
export function toFxDisplay(contract: Contract): Contract {
  return { ...contract, base: fxLabel(contract.symbol, contract.base) };
}

/** 코인 + 주식선물 주요 종목 + FX·금 전 종목 + 거래대금 상위 코인을 합친 스캔 유니버스
 *  주력 3종목(금·유로·비트)은 거래대금·목록 순서와 무관하게 항상 맨 앞에 둔다. */
export function pickUniverse(contracts: Contract[], tickers: Ticker[]): Contract[] {
  const bySymbol = new Map(contracts.map((c) => [c.symbol, c]));
  const vol = new Map(tickers.map((t) => [t.symbol, t.quoteVolume]));
  const picked: Contract[] = [];
  const seen = new Set<string>();
  const add = (c: Contract | undefined) => {
    if (!c || seen.has(c.symbol)) return;
    seen.add(c.symbol);
    picked.push(c.asset === 'fx' ? toFxDisplay(c) : c);
  };

  // 1) 주력 3종목 최우선
  for (const symbol of PRIORITY_SYMBOLS) add(bySymbol.get(symbol));

  // 2) FX·금 전 종목 (금 → 유로 → 나머지)
  for (const meta of FX_UNIVERSE) add(bySymbol.get(meta.symbol));
  for (const c of contracts) {
    if (c.asset === 'fx') add(c);
  }

  // 3) 주식선물 워치리스트
  for (const base of STOCK_WATCHLIST) add(bySymbol.get(`${base}USDT`));

  // 4) 거래대금 상위 코인
  const cryptos = contracts
    .filter((c) => c.asset === 'crypto' && !seen.has(c.symbol))
    .sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0))
    .slice(0, CRYPTO_TOP_N);

  return [...picked, ...cryptos];
}
