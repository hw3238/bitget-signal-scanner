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
  /** 최소 주문 수량(코인 단위 · minTradeNum) */
  minTradeNum?: number;
  /** 주문 수량 소수 자리(거래소 volumePlace) */
  volumePlace?: number;
  /** 최소 주문 금액(USDT · minTradeUSDT) */
  minTradeUsdt?: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  change24h: number;
  quoteVolume: number;
  fundingRate: number;
  high24h: number;
  low24h: number;
  /** 미결제약정(코인 수량) — holdingAmount. USDT 환산은 last × 이 값 */
  openInterestBase?: number;
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

/** 전수 백테스트 실측 성적 — `npm run bench:strategies` 로 재측정한다. */
export interface StrategyBench {
  /** 체결 표본(건) */
  n: number;
  /** 승률(%) */
  winRate: number;
  /** 테이커 왕복 수수료 0.12% 차감 후 1건당 기대값(R) */
  exp: number;
  /** Profit Factor */
  pf: number;
  /** 타임프레임별 승률(%) */
  byTf: Record<TF, number>;
}

export interface StrategyMeta {
  id: string;
  name: string;
  short: string;
  desc: string;
  star: number;
  warmup: number;
  /** 원본 기법(상위 코인 트레이더 레퍼런스) */
  origin: string;
  /** 전수 백테스트 실측치 */
  bench: StrategyBench;
}

/** 전수 백테스트 기준일·표본 — UI 표기용 */
export const BENCH_INFO = {
  at: '2026-11-23',
  universe: 'USDT-M 60개 마켓 × 1H/4H 500봉',
  fee: '테이커 왕복 0.12% 차감',
};

export const STRATEGIES: StrategyMeta[] = [
  {
    id: 'crt-fvg-cisd',
    name: 'CRT 레인지 스윕 + FVG + CISD',
    short: 'CRT·FVG·CISD',
    desc: '레인지 스윕 후 FVG·구조전환(CISD)이 겹치는 되돌림을 HTF 추세 방향에서만 잡는다.',
    star: 5,
    warmup: 46,
    origin: 'CRT(Consolidation-Range-Truth) + FVG + CISD — 상위 스캘퍼 역추세 진입',
    bench: { n: 39, winRate: 61.5, exp: 0.577, pf: 2.41, byTf: { '1H': 66.7, '4H': 53.3 } },
  },
  {
    id: 'sweep-ob',
    name: '유동성 스윕 + 오더블록 리테스트',
    short: '스윕·OB',
    desc: '유동성 스윕 뒤 오더블록(마지막 역방향 캔들) 리테스트에서 2.2R 목표 진입.',
    star: 5,
    warmup: 40,
    origin: 'Liquidity Sweep + Order Block Retest — ICT/SMC 실전 기법',
    bench: { n: 112, winRate: 49.1, exp: 0.479, pf: 1.87, byTf: { '1H': 54.0, '4H': 45.2 } },
  },
  {
    id: 'ema-pullback-rsi',
    name: 'EMA 20/50 눌림 + RSI 다이버전스',
    short: 'EMA 눌림·RSI',
    desc: 'HTF 추세 방향에서 EMA20 눌림 + RSI 다이버전스/회복 + 거래량 확인 진입.',
    star: 4,
    warmup: 60,
    origin: 'EMA Pullback + RSI Divergence — 추세 지속 눌림 매매',
    bench: { n: 2863, winRate: 42.3, exp: 0.097, pf: 1.15, byTf: { '1H': 41.7, '4H': 42.9 } },
  },
  {
    id: 'eq-engulfing',
    name: 'EQ 평균회귀 + 장악형 캔들',
    short: 'EQ·장악형',
    desc: '스윙 EQ(0.5) 지지·저항에서 장악형 캔들 반전을 HTF 추세 방향으로 받는다.',
    star: 3,
    warmup: 36,
    origin: 'EQ(0.5) Mean Reversion + Engulfing — 구간 회귀 매매',
    bench: { n: 136, winRate: 47.1, exp: 0.338, pf: 1.6, byTf: { '1H': 46.8, '4H': 47.3 } },
  },
  {
    id: 'supertrend-donchian',
    name: 'SuperTrend · 돈치안 모멘텀',
    short: 'ST·돈치안',
    desc: 'SuperTrend 전환·돈치안 20 돌파를 HTF 추세·거래량으로 확인해 모멘텀 추종.',
    star: 5,
    warmup: 52,
    origin: 'SuperTrend + Donchian Breakout — 추세 추종 모멘텀',
    bench: { n: 451, winRate: 51.4, exp: 0.334, pf: 1.66, byTf: { '1H': 59.7, '4H': 42.3 } },
  },
  {
    id: 'trap-bar-fade',
    name: 'HTF 추세 동조 트랩바 페이드',
    short: '트랩바·HTF',
    desc: 'HTF 추세 안에서 직전 12봉 유동성 스윕 후 몸통 복귀한 트랩바에 추세 방향 진입.',
    star: 4,
    warmup: 70,
    origin: 'Strat Trap-Bar Fade + HTF EMA50 Regime — 상위 트레이더 눌림 페이드',
    bench: { n: 159, winRate: 51.6, exp: 0.368, pf: 1.71, byTf: { '1H': 51.2, '4H': 51.9 } },
  },
  {
    id: 'break-retest-20',
    name: '20봉 박스 Break & Retest',
    short: 'B&R 20',
    desc: '20봉 박스 상·하단 돌파 후 깨진 경계가 지지·저항으로 전환되는 리테스트 진입.',
    star: 4,
    warmup: 46,
    origin: 'Break & Retest (20-bar range) — 돌파 후 리테스트 추세 편승',
    bench: { n: 324, winRate: 43.5, exp: 0.246, pf: 1.41, byTf: { '1H': 47.2, '4H': 38.9 } },
  },
  {
    id: 'momentum-climax',
    name: '모멘텀 정렬 + 볼륨 클라이맥스',
    short: '모멘텀·클라이맥스',
    desc: 'EMA 20>50>200 정렬에서 볼륨 클라이맥스 + RSI 과매도·과매수 탈출 첫 봉에 추세 방향 진입.',
    star: 5,
    warmup: 70,
    origin: 'MTF Momentum Alignment + Volume Climax — 멀티타임프레임 모멘텀',
    bench: { n: 33, winRate: 57.6, exp: 0.674, pf: 2.52, byTf: { '1H': 50.0, '4H': 63.2 } },
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
  /** 이 분석을 만든 캔들을 받아온 시각(ms) — 캐시 유효기간 판정에 쓴다 */
  candleAt?: number;
}
