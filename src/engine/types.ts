export type Side = 'long' | 'short';
export type AssetClass = 'crypto' | 'stock' | 'fx';
export type TF = '1H' | '4H';
export type SignalState = 'open' | 'win' | 'loss';

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Contract {
  symbol: string;
  base: string;
  asset: AssetClass;
  isRwa: boolean;
  /** 소수점 자리수(거래소 pricePlace). FX·금 표기 정밀도에 사용 */
  decimals?: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  change24h: number;
  quoteVolume: number;
  fundingRate: number;
  high24h: number;
  low24h: number;
}

export interface Setup {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  tags: string[];
}

export interface Trade {
  side: Side;
  entryIdx: number;
  entry: number;
  stop: number;
  target: number;
  exitIdx: number | null;
  result: 'win' | 'loss' | 'open';
  rResult: number;
  bars: number;
  tags: string[];
}

export interface StrategyStats {
  n: number;
  wins: number;
  losses: number;
  opens: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  rr: number;
  expectancy: number;
  totalR: number;
  score: number;
  /** rResult × 무효가까지 거리(%)의 합 — 레버리지 수익률 환산용 */
  movePct: number;
  avgRiskPct: number;
}

export interface StrategyMeta {
  id: string;
  name: string;
  short: string;
  desc: string;
  star: number;
  warmup: number;
}

export const STRATEGIES: StrategyMeta[] = [
  {
    id: 'crt-fvg-cisd',
    name: 'CRT + FVG + CISD',
    short: 'CRT·FVG·CISD',
    desc: '레인지 스윕 후 FVG·구조전환(CISD)이 겹치는 되돌림 구간을 잡는다.',
    star: 5,
    warmup: 34,
  },
  {
    id: 'sweep-ob',
    name: 'Liquidity Sweep + Order Block',
    short: '스윕·OB',
    desc: '유동성 스윕 뒤 오더블록(마지막 역방향 캔들) 리테스트 진입.',
    star: 5,
    warmup: 40,
  },
  {
    id: 'ema-pullback-rsi',
    name: 'EMA 20/50 Pullback + RSI Divergence',
    short: 'EMA 눌림·RSI',
    desc: '추세 방향 EMA20 눌림 + RSI 다이버전스에서 추세 지속 진입.',
    star: 4,
    warmup: 60,
  },
  {
    id: 'bb-squeeze-break',
    name: 'Bollinger Squeeze + Volume Breakout',
    short: 'BB 스퀴즈',
    desc: '볼린저 밴드 폭 수축 후 거래량 동반 이탈 돌파.',
    star: 3,
    warmup: 110,
  },
  {
    id: 'eq-engulfing',
    name: 'EQ Mean Reversion + Engulfing',
    short: 'EQ·장악형',
    desc: '스윙 구간 EQ(0.5) 지지/저항에서 장악형 캔들 반전 진입.',
    star: 2,
    warmup: 36,
  },
  {
    id: 'supertrend-donchian',
    name: 'SuperTrend / Donchian Momentum',
    short: 'ST·돈치안',
    desc: 'SuperTrend 방향 전환 또는 돈치안 20 돌파 모멘텀 추종.',
    star: 4,
    warmup: 46,
  },
];

export const STRATEGY_BY_ID: Record<string, StrategyMeta> = Object.fromEntries(
  STRATEGIES.map((s) => [s.id, s]),
);

export interface Replacement {
  at: number;
  symbol: string;
  base: string;
  tf: TF;
  asset: AssetClass;
  fromId: string;
  toId: string;
  fromWinRate: number;
  fromRR: number;
  toWinRate: number;
  toRR: number;
  reason: string;
  kind: 'auto-swap' | 'initial';
}

export interface Signal {
  id: string;
  symbol: string;
  base: string;
  asset: AssetClass;
  tf: TF;
  side: Side;
  strategyId: string;
  strategyName: string;
  strategyShort: string;
  star: number;
  entry: number;
  stop: number;
  target: number;
  eq: number;
  rr: number;
  remainingRR: number;
  currentR: number;
  price: number;
  changePct: number;
  progress: number;
  state: SignalState;
  detectedAt: number;
  barsSince: number;
  winRate: number;
  strategyRR: number;
  leverage: number;
  levRoi: number;
  candles: Candle[];
  detectedIdx: number;
  tags: string[];
  fundingRate: number;
  quoteVolume: number;
  /** FX·금처럼 고정 소수점 표기가 필요한 종목의 자리수 */
  decimals?: number;
}

export interface SymbolAnalysis {
  symbol: string;
  base: string;
  asset: AssetClass;
  tf: TF;
  activeStrategyId: string;
  activeWinRate: number;
  activeRR: number;
  activeN: number;
  activeStats: StrategyStats;
  candidates: { id: string; stats: StrategyStats }[];
  signals: Signal[];
  replacement: Replacement | null;
  candlesLoaded: number;
}
