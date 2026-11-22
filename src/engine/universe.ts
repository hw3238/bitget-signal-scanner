import type { Contract, Ticker } from './types';

/** 금·은·원유·지수·FX 같은 RWA 계약 base — 코인 스캐너에서는 제외한다. */
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
  'TMF',
]);

/** 비트겟 RWA 계약이 FX·금·지수 상품인지 */
export function isFxSymbol(symbol: string): boolean {
  const base = symbol.replace(/USDT$/, '').replace(/STOCK$/, '');
  return FX_BASES.has(base);
}

/** 코인 주력 3종목 — 스캔 큐 맨 앞에 고정 */
export const PRIORITY_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;

/** 주요 코인 — 알림 '주요 코인' 대상·시황 상단에 쓰는 대표 종목 */
export const MAJOR_COINS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'TONUSDT',
  'TRXUSDT',
  'DOTUSDT',
  'SUIUSDT',
  'APTUSDT',
  'NEARUSDT',
  'LTCUSDT',
  'BCHUSDT',
  'UNIUSDT',
  'ARBUSDT',
  'OPUSDT',
] as const;

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

export const CRYPTO_TOP_N = 36;

/** 1차 우선 스캔 대상 시장 수 — 즐겨찾기 + 주력 3종 + 거래대금 상위 */
export const PRIORITY_MARKET_COUNT = 25;

export function isStockSymbol(symbol: string): boolean {
  const base = symbol.replace(/USDT$/, '');
  if (base.endsWith('STOCK')) return true;
  return STOCK_WATCHLIST.includes(base);
}

export function displayBase(symbol: string, base: string): string {
  return (base || symbol.replace(/USDT$/, '')).replace(/STOCK$/, '');
}

/** 코인 주력 3종목 + 주식선물 워치리스트 + 거래대금 상위 코인.
 *  주력 코인(비트·이더·솔)은 거래대금·목록 순서와 무관하게 항상 맨 앞에 둔다. */
export function pickUniverse(contracts: Contract[], tickers: Ticker[]): Contract[] {
  const bySymbol = new Map(contracts.map((c) => [c.symbol, c]));
  const vol = new Map(tickers.map((t) => [t.symbol, t.quoteVolume]));
  const picked: Contract[] = [];
  const seen = new Set<string>();
  const add = (c: Contract | undefined) => {
    if (!c || seen.has(c.symbol)) return;
    seen.add(c.symbol);
    picked.push(c);
  };

  // 1) 비트·이더·솔 최우선
  for (const symbol of PRIORITY_COINS) add(bySymbol.get(symbol));

  // 2) 주식선물 워치리스트 (코인 스캐너에서 필터로 볼 수 있다)
  for (const base of STOCK_WATCHLIST) add(bySymbol.get(`${base}USDT`));

  // 3) 거래대금 상위 코인
  const cryptos = contracts
    .filter((c) => c.asset === 'crypto' && !seen.has(c.symbol))
    .sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0))
    .slice(0, CRYPTO_TOP_N);

  return [...picked, ...cryptos];
}

/**
 * 2단계 스캔의 1차 큐.
 *  - tier0: 즐겨찾기 종목 + 비트·이더·솔 (가장 먼저 → 0.5~1초 안에 핵심 시그널)
 *  - tier1: 주요 코인 · 거래대금 상위 25개 마켓 (2~3초 안에 화면에 표시)
 *  - 나머지 마켓은 2차 큐로 이어서 스캔한다.
 */
export function pickPrioritySymbols(
  contracts: Contract[],
  tickers: Ticker[],
  favorites: string[] = [],
): { tier0: string[]; tier1: string[] } {
  const known = new Set(contracts.map((c) => c.symbol));
  const vol = new Map(tickers.map((t) => [t.symbol, t.quoteVolume]));
  const tier0: string[] = [];
  const seen = new Set<string>();
  const push = (list: string[], symbol: string | undefined) => {
    if (!symbol || seen.has(symbol) || !known.has(symbol)) return;
    seen.add(symbol);
    list.push(symbol);
  };

  for (const symbol of favorites) push(tier0, symbol.endsWith('USDT') ? symbol : `${symbol}USDT`);
  for (const symbol of PRIORITY_COINS) push(tier0, symbol);

  const tier1: string[] = [];
  for (const symbol of MAJOR_COINS) push(tier1, symbol);
  const byVolume = contracts
    .filter((c) => c.asset === 'crypto')
    .sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  for (const c of byVolume) {
    if (tier1.length + tier0.length >= PRIORITY_MARKET_COUNT) break;
    push(tier1, c.symbol);
  }
  return { tier0, tier1 };
}
