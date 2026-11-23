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
  /**
   * 호가 스텝(거래소 priceEndStep). 실제 최소 호가 = priceEndStep × 10^(-pricePlace)
   *   예) BTC pricePlace=1·step=1 → 0.1 · 스텝 5 코인 pricePlace=4·step=5 → 0.0005
   * TP/SL 가 이 배수가 아니면 비트겟이 45115 로 거절한다.
   */
  priceEndStep?: number;
  /** 최소 주문 수량(코인 단위 · minTradeNum) */
  minTradeNum?: number;
  /** 주문 수량 소수 자리(거래소 volumePlace) */
  volumePlace?: number;
  /**
   * 수량 배수(거래소 sizeMultiplier). 실제 최소 주문 단위는 **max(10^-volumePlace, sizeMultiplier)** 다.
   *   BTC volumePlace=4 · sizeMultiplier=0.0001 → 0.0001 · MSTR volumePlace=2 · 0.01 → 0.01
   *   (sizeMultiplier 가 1 이면 volumePlace 와 무관하게 정수 단위)
   */
  sizeMultiplier?: number;
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
  /** 1건당 평균 익절 R (손익비 표기용) */
  avgWinR: number;
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
  universe: 'USDT-M 150개 마켓 × 1H/4H 500봉',
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
    bench: { n: 82, winRate: 53.7, exp: 0.36, pf: 1.71, avgWinR: 1.7, byTf: { '1H': 54.7, '4H': 51.7 } },
  },
  {
    id: 'sweep-ob',
    name: '유동성 스윕 + 오더블록 리테스트',
    short: '스윕·OB',
    desc: '유동성 스윕 뒤 오더블록(마지막 역방향 캔들) 리테스트에서 2.2R 목표 진입.',
    star: 5,
    warmup: 40,
    origin: 'Liquidity Sweep + Order Block Retest — ICT/SMC 실전 기법',
    bench: { n: 256, winRate: 47.7, exp: 0.439, pf: 1.77, avgWinR: 2.2, byTf: { '1H': 47.7, '4H': 47.6 } },
  },
  {
    id: 'ema-pullback-rsi',
    name: 'EMA 20/50 눌림 + 반등 확인',
    short: 'EMA 눌림·반등',
    desc: 'HTF 추세 방향에서 EMA20 눌림 뒤 거래량·종가 위치·RSI 반등이 모두 확인된 봉에 진입.',
    star: 4,
    warmup: 60,
    origin: 'EMA Pullback + RSI + Reclaim Confirmation — 추세 지속 눌림 매매',
    bench: { n: 1198, winRate: 47.0, exp: 0.253, pf: 1.45, avgWinR: 1.8, byTf: { '1H': 47.7, '4H': 46.1 } },
  },
  {
    id: 'supertrend-donchian',
    name: 'SuperTrend · 돈치안 모멘텀',
    short: 'ST·돈치안',
    desc: 'SuperTrend 전환·돈치안 20 돌파를 HTF 추세·거래량으로 확인해 모멘텀 추종.',
    star: 5,
    warmup: 52,
    origin: 'SuperTrend + Donchian Breakout — 추세 추종 모멘텀',
    bench: { n: 1151, winRate: 51.7, exp: 0.338, pf: 1.66, avgWinR: 1.7, byTf: { '1H': 57.1, '4H': 45.4 } },
  },
  {
    id: 'trap-bar-fade',
    name: 'HTF 추세 동조 트랩바 페이드',
    short: '트랩바·HTF',
    desc: 'HTF 추세 안에서 직전 12봉 유동성 스윕 후 몸통 복귀한 트랩바에 추세 방향 진입.',
    star: 4,
    warmup: 70,
    origin: 'Strat Trap-Bar Fade + HTF EMA50 Regime — 상위 트레이더 눌림 페이드',
    bench: { n: 358, winRate: 45.8, exp: 0.206, pf: 1.35, avgWinR: 1.8, byTf: { '1H': 44.3, '4H': 47.6 } },
  },
  {
    id: 'break-retest-20',
    name: '20봉 박스 Break & Retest',
    short: 'B&R 20',
    desc: '20봉 박스 상·하단 돌파 후 깨진 경계가 지지·저항으로 전환되는 리테스트 진입.',
    star: 4,
    warmup: 46,
    origin: 'Break & Retest (20-bar range) — 돌파 후 리테스트 추세 편승',
    bench: { n: 861, winRate: 45.5, exp: 0.302, pf: 1.52, avgWinR: 2.0, byTf: { '1H': 49.4, '4H': 40.7 } },
  },
  {
    id: 'momentum-climax',
    name: '모멘텀 정렬 + 볼륨 클라이맥스',
    short: '모멘텀·클라이맥스',
    desc: 'EMA 20>50>200 정렬에서 볼륨 클라이맥스 + RSI 과매도·과매수 탈출 첫 봉에 추세 방향 진입.',
    star: 5,
    warmup: 70,
    origin: 'MTF Momentum Alignment + Volume Climax — 멀티타임프레임 모멘텀',
    bench: { n: 51, winRate: 52.9, exp: 0.537, pf: 2.09, avgWinR: 2.0, byTf: { '1H': 42.3, '4H': 64.0 } },
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
  /** winRate 의 근거 — 'market': 이 마켓 최근 60봉 실측, 'bench': 기법 전수 백테스트 */
  winRateBasis: AdoptBasis;
  /** 전략 전수 백테스트 1건 기대값(R, 왕복 0.12% 차감) — 승률과 함께 판단 근거로 쓴다 */
  strategyExp: number;
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
  /** 호가 스텝 — TP/SL 을 호가 배수로 맞추는 데 쓴다(계약 priceEndStep) */
  priceEndStep?: number;
}

export type AdoptBasis = 'market' | 'bench';

export interface SymbolAnalysis {
  symbol: string;
  base: string;
  asset: AssetClass;
  tf: TF;
  activeStrategyId: string;
  /** 채택 근거 — 'market': 최근 60봉 표본 3건+ 로 검증, 'bench': 전수 검증 성적 + 마켓 반증 없음, 'none': 채택 없음 */
  activeBasis: AdoptBasis | 'none';
  /** 채택 우선순위 점수 (전수 기대값 × 승률 + 마켓 실측 가점) */
  activePriority: number;
  activeWinRate: number;
  activeRR: number;
  activeN: number;
  activeStats: StrategyStats;
  candidates: { id: string; stats: StrategyStats; proven?: boolean; priority?: number }[];
  signals: Signal[];
  replacement: Replacement | null;
  candlesLoaded: number;
  /** 이 분석을 만든 캔들을 받아온 시각(ms) — 캐시 유효기간 판정에 쓴다 */
  candleAt?: number;
}
