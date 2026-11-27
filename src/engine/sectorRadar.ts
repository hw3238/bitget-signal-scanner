/**
 * 🌊 섹터(테마) 자금 순환 레이더 엔진 — "지금 돈이 어느 테마로 들어오는가"를 실시간 티커로 계산한다.
 *
 * 원칙
 *  1) 섹터는 **검증된 대표 코인 목록**으로만 매핑한다(추측으로 끼워 넣지 않는다).
 *     한 코인은 한 섹터에만 들어간다 — 여러 섹터에 겹치면 점수가 두 번 세어지기 때문.
 *  2) 쓰는 데이터는 거래소 24h 티커뿐이다: 등락률 · 거래대금 · 펀딩비 + BTC 대비 상대강도(RS).
 *     과거 시계열이 없으므로 "24h 기준"임을 화면에 명시한다.
 *  3) 대장주(먼저 쏜 코인)와 후발주(거래대금은 붙는데 아직 덜 오른 코인)를 같은 표에서 뽑아
 *     키맞추기·순환매 후보를 바로 고를 수 있게 한다.
 */
import type { Contract, Ticker } from './types';

export type SectorKey = 'ai' | 'meme' | 'l1' | 'l2' | 'defi' | 'rwa' | 'sol';

export interface SectorDef {
  key: SectorKey;
  label: string;
  emoji: string;
  /** 대표 코인(베이스 심볼) — 거래소에 없으면 자동으로 빠진다 */
  coins: string[];
}

/** 검증된 대표 구성 — 겹치는 코인은 **앞 섹터 우선**(first-match)으로 한 곳에만 센다. */
export const SECTORS: SectorDef[] = [
  {
    key: 'ai',
    label: 'AI',
    emoji: '🤖',
    coins: ['FET', 'RENDER', 'TAO', 'WLD', 'GRT', 'ARKM', 'VIRTUAL', 'AI16Z', 'AIXBT', 'NMR', 'AGI', 'SWARMS'],
  },
  {
    key: 'meme',
    label: '밈',
    emoji: '🐶',
    coins: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'TRUMP', 'FARTCOIN', 'POPCAT', 'BRETT', 'MOG', 'TURBO', 'NEIRO', 'MOODENG', 'PNUT', 'GOAT'],
  },
  {
    key: 'l1',
    label: '레이어1',
    emoji: '🧱',
    coins: [
      'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'AVAX', 'TRX', 'TON', 'SUI', 'APT', 'NEAR', 'DOT', 'ATOM',
      'SEI', 'INJ', 'ALGO', 'HBAR', 'ETC', 'LTC', 'BCH', 'KAS', 'ICP', 'XLM', 'STX', 'EGLD', 'FLOW',
      'MINA', 'ROSE', 'KAVA', 'CELO', 'OSMO', 'QNT',
    ],
  },
  {
    key: 'l2',
    label: '레이어2',
    emoji: '🧩',
    coins: ['ARB', 'OP', 'POL', 'MATIC', 'STRK', 'ZK', 'MNT', 'BLAST', 'METIS', 'LRC', 'IMX', 'SKL', 'BOBA'],
  },
  {
    key: 'defi',
    label: 'DeFi',
    emoji: '🏦',
    coins: ['UNI', 'AAVE', 'CRV', 'MKR', 'LDO', 'SUSHI', 'COMP', 'SNX', 'PENDLE', 'ENA', 'JUP', 'RAY', 'GMX', 'DYDX', 'CAKE', '1INCH', 'AERO', 'HYPE', 'MORPHO', 'EIGEN', 'ETHFI', 'LISTA'],
  },
  {
    key: 'rwa',
    label: 'RWA·인프라',
    emoji: '🏗',
    coins: ['ONDO', 'LINK', 'PYTH', 'RSR', 'OM', 'POLYX', 'CFG', 'FIL', 'AR', 'XDC', 'TRB', 'BAND', 'API3'],
  },
  {
    key: 'sol',
    label: '솔라나',
    emoji: '🌞',
    coins: ['SOL', 'JTO', 'ORCA', 'DRIFT', 'TNSR', 'KMNO', 'MNDE', 'W', 'LAYER'],
  },
];

/** 베이스 심볼 → 섹터 (first-match, 한 코인 한 섹터) */
export const SECTOR_BY_COIN: Record<string, SectorKey> = (() => {
  const map: Record<string, SectorKey> = {};
  for (const s of SECTORS) for (const c of s.coins) if (!map[c]) map[c] = s.key;
  return map;
})();

/** 이보다 거래대금이 얇으면 순위를 흔들어서 뺀다(기본 $200K) */
export const SECTOR_MIN_VOLUME = 200_000;

export interface SectorInput {
  contracts: Contract[];
  tickers: Ticker[];
  /** BTC 24h 등락률(%) — 없으면 0 */
  btcChange24h: number;
  minVolume?: number;
}

export interface SectorCoinRow {
  symbol: string;
  base: string;
  change24h: number;
  quoteVolume: number;
  fundingRate: number;
  /** BTC 대비 상대강도(%p) = 등락률 − BTC 등락률 */
  rs: number;
  /** 섹터 거래대금 비중(%) */
  volumeSharePct: number;
  decimals?: number;
}

export interface SectorRow {
  key: SectorKey;
  label: string;
  emoji: string;
  coins: SectorCoinRow[];
  n: number;
  /** 24h 등락률 평균(%) */
  avgChange: number;
  /** 중앙값(%) — 대형주 한 개에 끌려가지 않게 */
  medianChange: number;
  /** BTC 대비 평균 상대강도(%p) */
  avgRs: number;
  volumeUsd: number;
  /** 전체 매핑 거래대금에서 차지하는 비중(%) */
  volumeSharePct: number;
  /** 상승 종목 비율(0~1) */
  breadth: number;
  /** 0~100 */
  score: number;
  rank: number;
  /** 먼저 쏜 코인 */
  leader: SectorCoinRow | null;
  /** 거래대금은 붙는데 아직 덜 오른 코인 */
  laggards: SectorCoinRow[];
  /** 자금이 들어오는 중 / 빠지는 중 */
  momentum: 'in' | 'out' | 'flat';
  note: string;
}

export interface SectorBoard {
  sectors: SectorRow[];
  btcChange24h: number;
  totalVolumeUsd: number;
  /** 섹터에 매핑된 종목 수 */
  mapped: number;
  /** 매핑되지 않은 종목이 전체 거래대금에서 차지하는 비중(%) */
  unmappedVolumeSharePct: number;
  at: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function median(values: number[]): number {
  const list = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

const usd = (v: number): string =>
  !Number.isFinite(v) || v <= 0
    ? '$0'
    : v >= 1e9
      ? `$${(v / 1e9).toFixed(2)}B`
      : v >= 1e6
        ? `$${(v / 1e6).toFixed(1)}M`
        : v >= 1e3
          ? `$${(v / 1e3).toFixed(0)}K`
          : `$${v.toFixed(0)}`;

/**
 * 섹터 보드 계산 — 화면·테스트가 같은 함수를 쓴다.
 * 후발주 조건: 섹터 최대 거래대금의 25% 이상인데 등락률이 (섹터 평균 − 1%p) 미만.
 * 점수에는 **표본 보정**을 곱한다 — 코인 1~2개짜리 섹터의 평균은 대표성이 약하기 때문.
 */
export function buildSectorBoard(input: SectorInput): SectorBoard {
  const minVolume = input.minVolume ?? SECTOR_MIN_VOLUME;
  const btc = Number.isFinite(input.btcChange24h) ? input.btcChange24h : 0;
  const baseBySymbol = new Map<string, string>();
  for (const c of input.contracts) if (c.asset === 'crypto') baseBySymbol.set(c.symbol, c.base);
  const decimalsBySymbol = new Map<string, number | undefined>();
  for (const c of input.contracts) decimalsBySymbol.set(c.symbol, c.decimals);

  const all: SectorCoinRow[] = [];
  for (const t of input.tickers) {
    const base = baseBySymbol.get(t.symbol) ?? t.symbol.replace(/USDT$/, '');
    if (!SECTOR_BY_COIN[base]) continue;
    if (!(t.quoteVolume >= minVolume) || !(t.last > 0)) continue;
    all.push({
      symbol: t.symbol,
      base,
      change24h: Number.isFinite(t.change24h) ? t.change24h : 0,
      quoteVolume: t.quoteVolume,
      fundingRate: Number.isFinite(t.fundingRate) ? t.fundingRate : 0,
      rs: (Number.isFinite(t.change24h) ? t.change24h : 0) - btc,
      volumeSharePct: 0,
      decimals: decimalsBySymbol.get(t.symbol),
    });
  }

  const mappedVolume = all.reduce((acc, c) => acc + c.quoteVolume, 0);
  const totalVolume = input.tickers.reduce((acc, t) => acc + (Number.isFinite(t.quoteVolume) ? t.quoteVolume : 0), 0);

  const rows: SectorRow[] = SECTORS.map((def) => {
    const coins = all.filter((c) => SECTOR_BY_COIN[c.base] === def.key);
    const volumeUsd = coins.reduce((acc, c) => acc + c.quoteVolume, 0);
    const shares = coins.map((c) => ({ ...c, volumeSharePct: volumeUsd > 0 ? (c.quoteVolume / volumeUsd) * 100 : 0 }));
    const changes = shares.map((c) => c.change24h);
    const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    const avgRs = changes.length ? changes.reduce((a, b) => a + (b - btc), 0) / changes.length : 0;
    const breadth = shares.length ? shares.filter((c) => c.change24h > 0).length / shares.length : 0;
    const maxVol = shares.reduce((acc, c) => Math.max(acc, c.quoteVolume), 0);
    // 유동성 있는 코인만 대장주·후발주 후보 (거래대금 25% 이상)
    const liquid = shares.filter((c) => maxVol > 0 && c.quoteVolume >= maxVol * 0.25 && c.quoteVolume >= minVolume);
    const leader =
      [...liquid].sort((a, b) => b.change24h - a.change24h || b.quoteVolume - a.quoteVolume)[0] ?? null;
    const laggards = liquid
      .filter((c) => c.base !== leader?.base)
      .filter((c) => c.change24h < avgChange - 1)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 3);
    const momentum: SectorRow['momentum'] =
      avgRs >= 1 && breadth >= 0.6 ? 'in' : avgRs <= -1 && breadth <= 0.4 ? 'out' : 'flat';
    return {
      key: def.key,
      label: def.label,
      emoji: def.emoji,
      coins: [...shares].sort((a, b) => b.change24h - a.change24h),
      n: shares.length,
      avgChange,
      medianChange: median(changes),
      avgRs,
      volumeUsd,
      volumeSharePct: mappedVolume > 0 ? (volumeUsd / mappedVolume) * 100 : 0,
      breadth,
      score: 0,
      rank: 0,
      leader,
      laggards,
      momentum,
      note: shares.length
        ? `24h 평균 ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}% (BTC ${btc >= 0 ? '+' : ''}${btc.toFixed(2)}%) · 상승 ${Math.round(breadth * 100)}% · ${usd(volumeUsd)}`
        : '거래소에 대표 코인이 없습니다',
    };
  });

  /* 점수 — 등락 35% · 상대강도 25% · 상승폭(breadth) 20% · 거래대금 비중 20%, 표본이 적으면 감점 */
  const maxShare = Math.max(1e-9, ...rows.map((r) => r.volumeSharePct));
  for (const r of rows) {
    if (!r.n) continue;
    const changeScore = clamp((r.avgChange + 6) / 12, 0, 1);
    const rsScore = clamp((r.avgRs + 4) / 8, 0, 1);
    const volScore = r.volumeSharePct / maxShare;
    const sampleFactor = r.n >= 4 ? 1 : r.n === 3 ? 0.85 : r.n === 2 ? 0.7 : 0.55;
    r.score = Math.round(
      100 * sampleFactor * (0.35 * changeScore + 0.25 * rsScore + 0.2 * r.breadth + 0.2 * volScore),
    );
  }

  const ranked = [...rows].sort((a, b) => b.score - a.score || b.volumeUsd - a.volumeUsd);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  return {
    sectors: ranked,
    btcChange24h: btc,
    totalVolumeUsd: totalVolume,
    mapped: all.length,
    unmappedVolumeSharePct: totalVolume > 0 ? Math.max(0, (1 - mappedVolume / totalVolume) * 100) : 0,
    at: Date.now(),
  };
}

/** 순환매 힌트 — 자금이 들어오는 상위 섹터의 후발주를 한 줄로 모은다 */
export function rotationHints(board: SectorBoard, limit = 3): Array<{ sector: SectorRow; coin: SectorCoinRow }> {
  const out: Array<{ sector: SectorRow; coin: SectorCoinRow }> = [];
  for (const s of board.sectors.filter((x) => x.n > 0 && (x.momentum === 'in' || x.avgRs > 0))) {
    for (const c of s.laggards) {
      out.push({ sector: s, coin: c });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
