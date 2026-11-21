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
