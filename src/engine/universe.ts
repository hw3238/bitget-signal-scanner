import type { Contract, Ticker } from './types';

/** 원자재·금속·외환·지수 RWA (주식선물 아님) */
export const COMMODITY_BASES = new Set([
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
  'TMF', // 채권 ETF 성격이지만 금리 상품
]);

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

/** 코인 + 주식선물 주요 종목 + 거래대금 상위 코인을 합친 스캔 유니버스 */
export function pickUniverse(contracts: Contract[], tickers: Ticker[]): Contract[] {
  const bySymbol = new Map(contracts.map((c) => [c.symbol, c]));
  const vol = new Map(tickers.map((t) => [t.symbol, t.quoteVolume]));
  const picked: Contract[] = [];
  const seen = new Set<string>();

  for (const base of STOCK_WATCHLIST) {
    const c = bySymbol.get(`${base}USDT`);
    if (c && !seen.has(c.symbol)) {
      seen.add(c.symbol);
      picked.push(c);
    }
  }

  const cryptos = contracts
    .filter((c) => c.asset === 'crypto' && !seen.has(c.symbol))
    .sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0))
    .slice(0, CRYPTO_TOP_N);

  return [...picked, ...cryptos];
}
