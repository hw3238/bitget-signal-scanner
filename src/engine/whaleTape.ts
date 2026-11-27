/**
 * 🐋 고래 체결 테이프 — 순수 계산 로직
 *
 * 네트워크(WebSocket)·화면(React)과 분리해 여기서만 계산한다(단위 테스트 대상).
 *  · 한 고래가 주문을 쪼개 여러 번 체결하면 2초 창으로 한 줄로 묶는다(체결가·시각은 최신, 금액·건수는 합).
 *  · 필터는 달러 기준(5만/10만/25만/50만)만 쓴다 — 체결 수량은 코인마다 단위가 달라 비교가 안 된다.
 *  · 순매수 집계는 **방향 필터와 무관하게** 매수·매도 양쪽을 모두 모아 계산한다(비율의 의미가 유지되도록).
 */

export type WhaleSide = 'buy' | 'sell';

export interface WhaleTrade {
  /** 거래소 체결 고유 id — 중복 제거·React key */
  id: string;
  /** 거래소 심볼(BTCUSDT) */
  symbol: string;
  /** 표시용 코인 이름(BTC) */
  base: string;
  side: WhaleSide;
  /** 마지막 체결가 */
  price: number;
  /** 체결 금액 합(USDT) */
  usd: number;
  /** 마지막 체결 시각(ms) */
  at: number;
  /** 묶인 원본 체결 수 (1 = 단일 체결) */
  fills: number;
}

/** 같은 코인·같은 방향의 분할 체결을 한 줄로 묶는 시간 창 */
export const SWEEP_WINDOW_MS = 2000;

/** 테이프 필터 — 최소 체결 금액 */
export const WHALE_THRESHOLDS = [50_000, 100_000, 250_000, 500_000] as const;
export type WhaleThreshold = (typeof WHALE_THRESHOLDS)[number];

/**
 * 기본 기준 = **$50K**.
 *  실측(2026-11-27 17:20 KST, 비트겟 유동성 상위 20종목 · 1.5초 묶음) 결과
 *  $100K+ 는 분당 2건, $50K+ 는 분당 5건이었다. 한산한 시간대에 $100K 를 기본으로 두면
 *  화면이 거의 비어 '실시간 테이프'가 멈춘 것처럼 보여, 가장 낮은 기준을 기본으로 둔다.
 */
export const DEFAULT_WHALE_THRESHOLD: WhaleThreshold = 50_000;

/** 이 금액 이상은 초대형 체결로 강조한다 */
export const HUGE_WHALE_USD = 500_000;

export type WhaleSideFilter = 'all' | 'buy' | 'sell';

export function sweepKey(t: { symbol: string; side: WhaleSide }): string {
  return `${t.symbol}|${t.side}`;
}

/**
 * 새 체결을 기존 묶음에 합칠지 판단한다.
 * 같은 코인·같은 방향 · 마지막 체결에서 `windowMs` 안이면 같은 고래의 분할 체결로 본다.
 *  `id` 는 처음 체결의 것을 유지해 화면 행이 새로 생기지 않게 한다.
 */
export function absorbTrade(
  sweep: WhaleTrade | undefined,
  trade: WhaleTrade,
  windowMs = SWEEP_WINDOW_MS,
): { sweep: WhaleTrade; fresh: boolean } {
  if (!sweep) return { sweep: trade, fresh: true };
  if (sweep.symbol !== trade.symbol || sweep.side !== trade.side) return { sweep: trade, fresh: true };
  if (!(trade.at - sweep.at <= windowMs)) return { sweep: trade, fresh: true };
  return {
    sweep: {
      ...trade,
      id: sweep.id,
      usd: sweep.usd + trade.usd,
      fills: sweep.fills + trade.fills,
    },
    fresh: false,
  };
}

export interface WhaleFilter {
  minUsd: number;
  side: WhaleSideFilter;
  /** 코인 이름 부분 일치 (BTC·ETH…) */
  query: string;
}

export function filterWhaleRows(rows: WhaleTrade[], filter: WhaleFilter): WhaleTrade[] {
  const q = filter.query.trim().toUpperCase();
  return rows.filter((r) => {
    if (!(r.usd >= filter.minUsd)) return false;
    if (filter.side !== 'all' && r.side !== filter.side) return false;
    if (!q) return true;
    return r.base.toUpperCase().includes(q) || r.symbol.toUpperCase().includes(q);
  });
}

export interface WhaleCoinRank {
  base: string;
  /** 고래 체결 총액 */
  usd: number;
  /** 순매수(매수 − 매도) */
  netUsd: number;
  buyUsd: number;
  sellUsd: number;
}

export interface WhaleSummary {
  buyUsd: number;
  sellUsd: number;
  totalUsd: number;
  /** 매수 비중 0~1 — 총액이 0이면 0.5 */
  buyRatio: number;
  /** 집계에 쓰인 체결 수 */
  count: number;
  /** 가장 고래가 몰린 코인 TOP N (총액 기준) */
  top: WhaleCoinRank[];
  /** 가장 오래된 체결 시각(관측 구간 시작) */
  since: number | null;
  /** 초대형($500K+) 건수 */
  huge: number;
}

export function summarizeWhales(rows: WhaleTrade[], topN = 3): WhaleSummary {
  let buyUsd = 0;
  let sellUsd = 0;
  let huge = 0;
  let since: number | null = null;
  const byCoin = new Map<string, WhaleCoinRank>();
  for (const r of rows) {
    if (!(r.usd > 0)) continue;
    if (r.side === 'buy') buyUsd += r.usd;
    else sellUsd += r.usd;
    if (r.usd >= HUGE_WHALE_USD) huge += 1;
    if (since == null || r.at < since) since = r.at;
    const coin = byCoin.get(r.base) ?? { base: r.base, usd: 0, netUsd: 0, buyUsd: 0, sellUsd: 0 };
    coin.usd += r.usd;
    if (r.side === 'buy') {
      coin.buyUsd += r.usd;
      coin.netUsd += r.usd;
    } else {
      coin.sellUsd += r.usd;
      coin.netUsd -= r.usd;
    }
    byCoin.set(r.base, coin);
  }
  const totalUsd = buyUsd + sellUsd;
  const top = [...byCoin.values()].sort((a, b) => b.usd - a.usd).slice(0, topN);
  return {
    buyUsd,
    sellUsd,
    totalUsd,
    buyRatio: totalUsd > 0 ? buyUsd / totalUsd : 0.5,
    count: rows.filter((r) => r.usd > 0).length,
    top,
    since,
    huge,
  };
}

/** `$142K` · `$1.2M` · `$124` — 테이프 한 줄에 들어가는 짧은 표기 */
export function fmtUsdShort(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  const trim = (v: number) => v.toFixed(2).replace(/\.?0+$/, '');
  if (usd >= 1e9) return `$${trim(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${trim(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

/** 테이프 시각(HH:MM:SS · KST) */
export function fmtTapeTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '--:--:--';
  return new Date(at).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** 필터 목록의 한글 라벨 */
export function thresholdLabel(usd: number): string {
  return `$${Math.round(usd / 1000)}K+`;
}
