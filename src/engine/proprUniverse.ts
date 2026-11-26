import type { AssetClass } from './types';

/**
 * Propr 유니버스 스냅숏 — propr.xyz 가 **실제로 거래를 받는 종목**과 종목별 최대 배율·수수료.
 *
 * 출처(읽기 전용, 2026-11-26 확인):
 *  · `https://www.propr.xyz/universe` — 146종목 표(종목 · 타입 CRYPTO/EQ/IDX/CMDTY · Max Leverage · M/T 수수료)
 *  · `https://www.propr.xyz/api/universe/config` — whitelisted 146 / blacklisted 280
 *  · 규정집 `https://www.propr.xyz/rules` — "Hyperliquid perps with more than $1M open interest" 상장 규칙
 *
 * 왜 스냅숏인가: propr.xyz 의 유니버스/설정 API 는 `Access-Control-Allow-Origin` 을 주지 않아
 *   브라우저(그리고 원격 URL 을 로드하는 APK WebView)에서 직접 읽을 수 없다. 실시간 시세·캔들은
 *   CORS 가 열린 Hyperliquid `api.hyperliquid.xyz/info` 에서 그대로 받고, **어떤 종목이 Propr 에
 *   상장돼 있는지**만 이 스냅숏으로 판단한다. 상장 목록이 바뀌면 이 파일만 갱신하면 된다
 *   (매시간 개선 루틴의 점검 항목).
 *
 * 형식: `종목|타입|최대배율|테이커수수료(%)`
 *   타입 CRYPTO = 코인 무기한, EQ = 주식, IDX = 지수, CMDTY = 원자재, FX = 외환
 *   최대배율은 Propr 표의 종목별 값(BTC·ETH·SOL 10x, XYZ100·SP500 10x, 금·은·원유 8x,
 *   구리 5x, 주식 4x, 기타 코인 2x)과 1:1 이다.
 */
export const PROPR_UNIVERSE_AT = '2026-11-26';

const SNAPSHOT_RAW =
    'BTC|CRYPTO|10|0.045;ETH|CRYPTO|10|0.045;XYZ100|IDX|10|0.009;SKHX|EQ|4|0.009;HYPE|CRYPTO|2|0.045;' +
    'SP500|IDX|10|0.009;NVDA|EQ|4|0.009;SOXL|EQ|4|0.009;ANT|EQ|4|0.009;ZEC|CRYPTO|2|0.045;SPCX|EQ|4|0.009;' +
    'SILVER|CMDTY|8|0.009;MU|EQ|4|0.009;SOL|CRYPTO|10|0.045;GOLD|CMDTY|8|0.009;SNDK|EQ|4|0.009;SKHY|EQ|4|0.009;' +
    'DRAM|EQ|4|0.009;VVV|CRYPTO|2|0.045;BRENTOIL|CMDTY|8|0.009;GOOGL|EQ|4|0.009;NEAR|CRYPTO|2|0.045;' +
    'CL|CMDTY|8|0.009;NBIS|EQ|4|0.009;AAPL|EQ|4|0.009;XMR|CRYPTO|2|0.045;SMSN|EQ|4|0.009;XRP|CRYPTO|2|0.045;' +
    'AMD|EQ|4|0.009;TSLA|EQ|4|0.009;EWY|EQ|4|0.009;INTC|EQ|4|0.009;PUMP|CRYPTO|2|0.045;META|EQ|4|0.009;' +
    'MSTR|EQ|4|0.09;CXMT|EQ|4|0.009;CRCL|EQ|4|0.009;LIT|CRYPTO|2|0.045;UNITREE|EQ|4|0.009;ENA|CRYPTO|2|0.045;' +
    'CRWV|EQ|4|0.009;SNXX|EQ|4|0.009;COPPER|CMDTY|5|0.009;DELL|EQ|4|0.009;MSFT|EQ|4|0.009;kPEPE|CRYPTO|2|0.045;' +
    'AAVE|CRYPTO|2|0.045;ZRO|CRYPTO|2|0.045;AMZN|EQ|4|0.009;MRVL|EQ|4|0.009;TRUMP|CRYPTO|2|0.045;RKLB|EQ|4|0.009;' +
    'ADA|CRYPTO|2|0.045;BNB|CRYPTO|2|0.045;MON|CRYPTO|2|0.045;IREN|EQ|4|0.009;ZHIPU|EQ|4|0.009;' +
    'LINK|CRYPTO|2|0.045;HOOD|EQ|4|0.009;UNI|CRYPTO|2|0.045;ORCL|EQ|4|0.009;TSM|EQ|4|0.009;COIN|EQ|4|0.009;' +
    'SUI|CRYPTO|2|0.045;DOGE|CRYPTO|2|0.045;BE|EQ|4|0.009;CBRS|EQ|4|0.009;XPL|CRYPTO|2|0.045;PURRDAT|EQ|4|0.09;' +
    'LITE|EQ|4|0.009;PONS|CRYPTO|2|0.045;MRNA|EQ|4|0.009;AVGO|EQ|4|0.009;FARTCOIN|CRYPTO|2|0.045;' +
    'WLD|CRYPTO|2|0.045;TRX|CRYPTO|2|0.045;PLTR|EQ|4|0.009;PAXG|CRYPTO|2|0.045;MOVE|CRYPTO|2|0.045;' +
    'INIT|CRYPTO|2|0.045;GRAM|CRYPTO|2|0.045;LTC|CRYPTO|2|0.045;INJ|CRYPTO|2|0.045;CRV|CRYPTO|2|0.045;' +
    'EWZ|EQ|4|0.009;COST|EQ|4|0.009;DOT|CRYPTO|2|0.045;TAO|CRYPTO|2|0.045;GIGADEV|EQ|4|0.009;JUP|CRYPTO|2|0.045;' +
    'ONDO|CRYPTO|2|0.045;AERO|CRYPTO|2|0.045;AVAX|CRYPTO|2|0.045;ARB|CRYPTO|2|0.045;BABA|EQ|4|0.009;BB|EQ|4|0.009;' +
    'kSHIB|CRYPTO|2|0.045;TTWO|EQ|4|0.009;CASHCAT|CRYPTO|2|0.045;SOFTBANK|EQ|4|0.009;FET|CRYPTO|2|0.045;' +
    'ETHFI|CRYPTO|2|0.045;PURR|CRYPTO|2|0.045;KR200|EQ|4|0.009;XLM|CRYPTO|2|0.045;TLT|EQ|4|0.009;' +
    'STRK|CRYPTO|2|0.045;BCH|CRYPTO|2|0.045;CHIP|CRYPTO|2|0.045;CRWD|EQ|4|0.009;BMNR|EQ|4|0.09;' +
    'HBAR|CRYPTO|2|0.045;ASTER|CRYPTO|2|0.045;USELESS|CRYPTO|2|0.045;MELANIA|CRYPTO|2|0.045;WLFI|CRYPTO|2|0.045;' +
    'APT|CRYPTO|2|0.045;MEGA|CRYPTO|2|0.045;XTEN|CRYPTO|2|0.045;RUNE|CRYPTO|2|0.045;RENDER|CRYPTO|2|0.045;' +
    'TIA|CRYPTO|2|0.045;SYRUP|CRYPTO|2|0.045;WIF|CRYPTO|2|0.045;CC|CRYPTO|2|0.045;FIL|CRYPTO|2|0.045;' +
    'kLUNC|CRYPTO|2|0.045;ICP|CRYPTO|2|0.045;GRASS|CRYPTO|2|0.045;ATOM|CRYPTO|2|0.045;SEI|CRYPTO|2|0.045;' +
    'PENDLE|CRYPTO|2|0.045;MORPHO|CRYPTO|2|0.045;LDO|CRYPTO|2|0.045;PENGU|CRYPTO|2|0.045;kBONK|CRYPTO|2|0.045;' +
    'SPX|CRYPTO|2|0.045;NET|EQ|4|0.009;OP|CRYPTO|2|0.045;DASH|CRYPTO|2|0.045;NIL|CRYPTO|2|0.045;' +
    'EIGEN|CRYPTO|2|0.045;REZ|CRYPTO|2|0.045;JIO|EQ|4|0.009;GLW|EQ|4|0.009;AZTEC|CRYPTO|2|0.045;'

export type ProprAssetType = 'CRYPTO' | 'EQ' | 'IDX' | 'CMDTY' | 'FX';

export interface ProprListing {
  /** Propr 표기 종목명 (xyz: 접두어 없음) */
  name: string;
  type: ProprAssetType;
  /** Propr 종목별 최대 레버리지 */
  maxLever: number;
  /** 테이커 수수료(%) — 한쪽 기준 */
  takerPct: number;
}

/** `TAKER` 는 왕복(진입+청산) 테이커 수수료(%) */
export const PROPR_LISTINGS: ProprListing[] = SNAPSHOT_RAW.split(';')
  .filter(Boolean)
  .map((row) => {
    const [name, type, lev, taker] = row.split('|');
    return {
      name,
      type: type as ProprAssetType,
      maxLever: Number(lev),
      takerPct: Number(taker) * 2,
    };
  });

export const PROPR_LISTING_BY_NAME: Record<string, ProprListing> = Object.fromEntries(
  PROPR_LISTINGS.map((l) => [l.name.toUpperCase(), l]),
);

/** 코인 메이저 — Propr 규정상 10x 상한 */
export const PROPR_MAJORS = ['BTC', 'ETH', 'SOL'] as const;

/** 지수 중 10x 인 종목 (나머지 지수는 5x) */
export const PROPR_INDEX_10X = ['XYZ100', 'SP500'] as const;

/** 금·은·원유 8x (다른 원자재는 5x) */
export const PROPR_COMMODITY_8X = ['GOLD', 'SILVER', 'CL', 'BRENTOIL'] as const;

/** 화면 필터용 자산군 */
export type ProprGroup = 'majors' | 'alt' | 'rwa';

/** UI 자산군 배지에 쓰는 5분류 */
export type ProprBadge = 'BTC/ETH/SOL' | '기타코인' | '주식' | '지수' | '원자재' | 'FX';

export function proprBadgeOf(type: ProprAssetType, name: string): ProprBadge {
  const up = name.toUpperCase();
  if (type === 'CRYPTO') return (PROPR_MAJORS as readonly string[]).includes(up) ? 'BTC/ETH/SOL' : '기타코인';
  if (type === 'EQ') return '주식';
  if (type === 'IDX') return '지수';
  if (type === 'CMDTY') return '원자재';
  return 'FX';
}

/**
 * 자산군별 레버리지 상한 — Propr 규정(2026-11-26 확인).
 *  · BTC/ETH/SOL 10x · 기타 코인 2x · 주식 4x
 *  · SP500·XYZ100 10x · 기타 지수 5x
 *  · 금·은·CL·브렌트 8x · 기타 원자재 5x · FX 25x
 *  · 상장 스냅숏에 종목별 값이 있으면 그 값과의 **최솟값**을 쓴다(더 낮은 쪽이 안전).
 */
export function proprLeverageCap(name: string, type: ProprAssetType): number {
  const up = name.toUpperCase();
  let cap: number;
  if (type === 'CRYPTO') cap = (PROPR_MAJORS as readonly string[]).includes(up) ? 10 : 2;
  else if (type === 'EQ') cap = 4;
  else if (type === 'IDX') cap = (PROPR_INDEX_10X as readonly string[]).includes(up) ? 10 : 5;
  else if (type === 'CMDTY') cap = (PROPR_COMMODITY_8X as readonly string[]).includes(up) ? 8 : 5;
  else cap = 25;
  const listed = PROPR_LISTING_BY_NAME[up];
  return listed ? Math.min(cap, listed.maxLever) : cap;
}

/** 자산군 배지 문구 (카드 상단) — 예: `BTC·ETH·SOL 10x` */
export function proprBadgeLabel(name: string, type: ProprAssetType): string {
  const cap = proprLeverageCap(name, type);
  switch (proprBadgeOf(type, name)) {
    case 'BTC/ETH/SOL':
      return `BTC·ETH·SOL ${cap}x`;
    case '기타코인':
      return `기타코인 ${cap}x`;
    case '주식':
      return `주식 ${cap}x`;
    case '지수':
      return `지수 ${cap}x`;
    case '원자재':
      return `원자재 ${cap}x`;
    default:
      return `FX ${cap}x`;
  }
}

/** Propr 는 xyz(HIP-3) 덱을 `xyz:TSLA` 처럼 부른다 — 표시용 기본 심볼 */
export function proprBase(coin: string): string {
  return coin.replace(/^xyz:/i, '').toUpperCase();
}

/** Hyperliquid 코인 id → Propr 상장 정보 (없으면 null) */
export function proprListingOf(coin: string): ProprListing | null {
  return PROPR_LISTING_BY_NAME[proprBase(coin)] ?? null;
}

/** 시그널 카드가 쓰는 기존 AssetClass 로의 매핑(로고·표기용) */
export function proprAssetClass(type: ProprAssetType): AssetClass {
  if (type === 'FX') return 'fx';
  if (type === 'CRYPTO') return 'crypto';
  return 'stock';
}
