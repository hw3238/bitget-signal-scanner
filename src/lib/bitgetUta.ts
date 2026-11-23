/**
 * 비트겟 **통합 거래 계정(UTA, v3)** 규격의 참조 구현.
 *
 * 비트겟은 계정 종류가 둘로 나뉜다.
 *   · 클래식 계정 : v2 `/api/v2/mix/...` (예전부터 COTA가 쓰던 경로)
 *   · 통합 계정   : v3 `/api/v3/...`  (지금 새로 만든 계정의 기본값)
 * 서명 규격(HMAC-SHA256 + Base64, `timestamp + METHOD + requestPath(+query) + body`)과
 * 모의투자 헤더(`paptrading: 1`)는 두 계정이 완전히 같고, **경로·필드 이름·에러 코드만** 다르다.
 *
 * 실제 주문은 안드로이드 네이티브(`BitgetApi.java`)가 서명한다 — Secret은 웹뷰로 내려오지 않는다.
 * 이 파일은 그 변환·판별 규칙을 문서화하고, 네이티브와 **같은 입력 → 같은 페이로드**가 나오는지
 * 단위 테스트(`scripts/autotrade-check.ts`)로 고정하기 위해 존재한다.
 *
 * 계정 판별 (v1.5.1)
 *   1) `GET /api/v3/account/settings` → `00000` 이면 **UTA(v3)**
 *   2) 같은 호출이 `40084`("You are in Classic Account mode...") → **클래식(v2)**
 *   3) v2 엔드포인트가 `40085`("You are in Unified Account mode...") → **UTA(v3)로 전환**
 */
import type { PosMode } from './autotrade';

/** v2(클래식) 엔드포인트가 통합 계정에서 돌려주는 코드 — UTA 힌트 */
export const UTA_MODE_ERROR = '40085';
/** v3(통합) 엔드포인트가 클래식 계정에서 돌려주는 코드 — Classic 힌트 */
export const CLASSIC_MODE_ERROR = '40084';
/** 가격이 호가 단위의 배수가 아님(v2·v3 공통 문구, v3 는 25244 도 같은 의미) */
export const PRICE_STEP_ERROR = '45115';
/** v3 에서 같은 의미의 코드 */
export const PRICE_STEP_ERROR_V3 = '25244';
/** 같은 clientOid 로 이미 주문이 접수됨 — 재시도하면 중복 주문이 되므로 성공으로 본다 */
export const DUPLICATE_CLIENT_OID = '25212';
/** UTA 상품 구분 — USDT 무기한 선물 */
export const V3_CATEGORY = 'USDT-FUTURES';

export type BitgetAccountKind = 'uta' | 'classic';

/**
 * 주문 파라미터(정규형). 웹·서비스가 만드는 값은 v2 모양 그대로 두고,
 * 실제 전송 body는 네이티브가 계정 종류에 맞춰 조립한다.
 */
export interface CanonicalOrder {
  symbol: string;
  /** 계약 수량 (v2 `size` / v3 `qty`) */
  size: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  price?: string;
  clientOid?: string;
  /** v2 전용: 헤지 모드에서 open/close */
  tradeSide?: 'open' | 'close';
  /** v3 전용: 헤지 모드에서 long/short */
  posSide?: 'long' | 'short';
  /** v2 'true'/'false', v3 'yes'/'no' */
  reduceOnly?: string;
  presetStopSurplusPrice?: string;
  presetStopLossPrice?: string;
  marginMode?: string;
  productType?: string;
  marginCoin?: string;
}

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/** v3 마진 모드는 `crossed` / `isolated` (v2 는 `cross` / `isolated`) */
export function v3MarginMode(raw: string | null | undefined): 'crossed' | 'isolated' {
  const v = text(raw).toLowerCase();
  return v === 'isolated' ? 'isolated' : 'crossed';
}

/** v3 clientOid 규칙: `^[.A-Z:/a-z0-9_-]{1,32}$` — v2 의 36자와 다르다. */
export function clientOidV3(raw: string | null | undefined): string {
  const cleaned = text(raw).replace(/[^.A-Z:/a-z0-9_-]/gi, '');
  if (!cleaned) return 'cota';
  return cleaned.length > 32 ? cleaned.slice(0, 32) : cleaned;
}

/**
 * v2(클래식) 주문 body — 예전 그대로. `size` · `productType` · `presetStopSurplusPrice`.
 * limit 주문은 `force: gtc` 를 함께 보낸다.
 */
export function v2OrderBody(p: CanonicalOrder): Record<string, string> {
  const body: Record<string, string> = {
    symbol: p.symbol,
    productType: p.productType || V3_CATEGORY,
    // v2·v3 모두 마진 모드 표기는 `crossed` / `isolated` 로 같다.
    marginMode: v3MarginMode(p.marginMode),
    marginCoin: p.marginCoin || 'USDT',
    size: p.size,
    side: p.side,
    orderType: p.orderType,
  };
  if (p.orderType === 'limit' && p.price) body.price = p.price;
  if (p.clientOid) body.clientOid = p.clientOid;
  if (p.orderType === 'limit') body.force = 'gtc';
  if (p.tradeSide) body.tradeSide = p.tradeSide;
  if (p.reduceOnly === 'true' || p.reduceOnly === 'yes') body.reduceOnly = 'true';
  if (p.presetStopSurplusPrice) body.presetStopSurplusPrice = p.presetStopSurplusPrice;
  if (p.presetStopLossPrice) body.presetStopLossPrice = p.presetStopLossPrice;
  return body;
}

/**
 * v3(통합) 주문 body — `category` · `qty`(v2 의 size 아님) · `takeProfit`/`stopLoss`.
 *  · 헤지 모드(hedge_mode)면 `posSide`(long/short) 가 **필수**
 *  · 단방향(one_way_mode)이면 `posSide` 생략, 청산은 `reduceOnly: yes`
 *  · TP/SL 은 시장가(market) 트리거로 함께 건다
 */
export function v3OrderBody(
  p: CanonicalOrder,
  ctx: { holdMode: PosMode; marginMode?: string | null },
): Record<string, string> {
  const hedge = ctx.holdMode === 'hedge_mode';
  const body: Record<string, string> = {
    category: V3_CATEGORY,
    symbol: p.symbol,
    qty: p.size,
    side: p.side,
    orderType: p.orderType,
  };
  if (p.orderType === 'limit' && p.price) body.price = p.price;
  body.marginMode = v3MarginMode(ctx.marginMode ?? p.marginMode);
  if (hedge) {
    body.posSide = p.posSide ?? (p.side === 'buy' ? 'long' : 'short');
  }
  body.clientOid = clientOidV3(p.clientOid);
  if (!hedge && (p.reduceOnly === 'true' || p.reduceOnly === 'yes')) body.reduceOnly = 'yes';
  if (p.presetStopSurplusPrice) {
    body.takeProfit = p.presetStopSurplusPrice;
    body.tpOrderType = 'market';
  }
  if (p.presetStopLossPrice) {
    body.stopLoss = p.presetStopLossPrice;
    body.slOrderType = 'market';
  }
  if (p.orderType === 'limit') body.timeInForce = 'gtc';
  return body;
}

/* ------------------------------------------------------------------ *
 * 청산(close) — 주문 방향 규칙
 * ------------------------------------------------------------------ */

/**
 * 비트겟 문서의 포지션 청산 규칙 (UTA v3 Place Order · Classic v2 동일)
 *   헤지 모드 : 롱 청산 = side=sell + posSide=long · 숏 청산 = side=buy + posSide=short
 *              (v2 는 posSide 대신 tradeSide=close 를 쓴다)
 *   단방향    : 롱 청산 = side=sell + reduceOnly · 숏 청산 = side=buy + reduceOnly
 * `posSide` 는 **청산할 포지션의 방향**이다 — 주문 side 로 추론하면 롱 청산이 숏 진입으로 뒤집힌다.
 */
export interface CloseIntent {
  symbol: string;
  /** 청산할 포지션 방향 */
  holdSide: 'long' | 'short';
  /** 청산 수량(코인 단위) */
  size: string;
  posMode: PosMode;
  clientOid?: string;
  marginMode?: string | null;
}

/** 청산 주문의 side/posSide/reduceOnly — 웹·네이티브가 같은 값을 쓴다 */
export function closeOrderFields(input: Pick<CloseIntent, 'holdSide' | 'posMode'>): {
  side: 'buy' | 'sell';
  posSide?: 'long' | 'short';
  tradeSide?: 'close';
  reduceOnly: 'yes' | null;
} {
  const side: 'buy' | 'sell' = input.holdSide === 'long' ? 'sell' : 'buy';
  if (input.posMode === 'hedge_mode') {
    return { side, posSide: input.holdSide, tradeSide: 'close', reduceOnly: null };
  }
  return { side, reduceOnly: 'yes' };
}

/** v2(클래식) 청산 body — 헤지=tradeSide:close, 단방향=reduceOnly:true */
export function v2CloseBody(p: CloseIntent): Record<string, string> {
  const f = closeOrderFields(p);
  const body: Record<string, string> = {
    symbol: p.symbol,
    productType: V3_CATEGORY,
    marginMode: v3MarginMode(p.marginMode),
    marginCoin: 'USDT',
    size: p.size,
    side: f.side,
    orderType: 'market',
  };
  if (p.clientOid) body.clientOid = p.clientOid;
  // 헤지 모드는 tradeSide=close, 단방향은 reduceOnly — 둘을 같이 보내면 25238 로 거절된다.
  if (f.tradeSide) body.tradeSide = f.tradeSide;
  else body.reduceOnly = 'true';
  return body;
}

/** v3(통합) 청산 body — 헤지=posSide(청산할 포지션), 단방향=reduceOnly:yes */
export function v3CloseBody(p: CloseIntent): Record<string, string> {
  const f = closeOrderFields(p);
  const body: Record<string, string> = {
    category: V3_CATEGORY,
    symbol: p.symbol,
    qty: p.size,
    side: f.side,
    orderType: 'market',
    marginMode: v3MarginMode(p.marginMode),
  };
  if (p.posMode === 'hedge_mode' && f.posSide) body.posSide = f.posSide;
  else body.reduceOnly = 'yes';
  // clientOid 는 있을 때만 — 빈 값으로 'cota' 를 넣으면 두 번째 청산이 25212(중복)로 거절된다.
  if (p.clientOid) body.clientOid = clientOidV3(p.clientOid);
  return body;
}

/** v3 레버리지 설정 body — `category`+`symbol`, 격리·헤지면 `posSide`, 방향별 레버리지 */
export function v3LeverageBody(input: {
  symbol: string;
  leverage: string;
  holdMode: PosMode;
  marginMode?: string | null;
  posSide?: 'long' | 'short' | null;
}): Record<string, string> {
  const body: Record<string, string> = {
    category: V3_CATEGORY,
    symbol: input.symbol,
    leverage: input.leverage,
  };
  body.marginMode = v3MarginMode(input.marginMode);
  if (input.holdMode === 'hedge_mode') {
    if (input.posSide) body.posSide = input.posSide;
    body.longLeverage = input.leverage;
    body.shortLeverage = input.leverage;
  }
  return body;
}

/* ------------------------------------------------------------------ *
 * 계정 판별
 * ------------------------------------------------------------------ */

/**
 * 계정 종류 판정 — 시도한 호출의 결과(코드)로 정한다. `null` = 아직 모름.
 *  · v3 settings 성공 → UTA
 *  · v3 settings `40084` → Classic
 *  · v2 호출 `40085` → UTA
 *  · v2 호출 성공 → Classic
 */
export function resolveAccountKind(input: {
  settingsOk?: boolean;
  settingsCode?: string | null;
  v2Ok?: boolean;
  v2Code?: string | null;
}): BitgetAccountKind | null {
  if (input.settingsOk) return 'uta';
  if (text(input.settingsCode) === CLASSIC_MODE_ERROR) return 'classic';
  if (input.v2Ok) return 'classic';
  if (text(input.v2Code) === UTA_MODE_ERROR) return 'uta';
  return null;
}

/** 오류 코드가 "다른 계정 API로 다시 시도" 신호인지 */
export function modeSwitchTarget(code: string | null | undefined): BitgetAccountKind | null {
  const c = text(code);
  if (c === UTA_MODE_ERROR) return 'uta';
  if (c === CLASSIC_MODE_ERROR) return 'classic';
  return null;
}

export function accountKindLabel(kind: string | null | undefined): string {
  if (kind === 'uta') return '통합계정(UTA)';
  if (kind === 'classic') return '클래식 계정';
  return '확인 중';
}

/* ------------------------------------------------------------------ *
 * 응답 파싱 — v3 는 필드 이름이 다르고 숫자를 문자열로 준다
 * ------------------------------------------------------------------ */

const num = (v: unknown): number => {
  const n = Number(text(v));
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** GET /api/v3/account/assets → 화면·안전장치가 쓰는 잔고 */
export function parseAssetsV3(data: unknown): { equity: number; available: number; unrealizedPL: number } {
  const d = obj(data);
  const assets = Array.isArray(d.assets) ? d.assets.map(obj) : [];
  const usdt = assets.find((a) => text(a.coin).toUpperCase() === 'USDT') ?? {};
  const equity = num(usdt.equity) > 0 ? num(usdt.equity) : num(d.usdtEquity) || num(d.accountEquity);
  const available =
    usdt.available != null && text(usdt.available) !== '' ? num(usdt.available) : num(d.effEquity);
  return {
    equity,
    available,
    unrealizedPL: num(d.usdtUnrealisedPnl) || num(d.unrealisedPnl),
  };
}

/** 한 포지션 — 네이티브가 웹으로 돌려주는 모양(v2 와 동일하게 통일) */
export interface PositionRow {
  symbol: string;
  holdSide: string;
  total: number;
  openPriceAvg: number;
  markPrice: number;
  unrealizedPL: number;
  leverage: number;
  marginSize: number;
  liquidationPrice: number;
  presetStopSurplusPrice: number;
  presetStopLossPrice: number;
  ctime: number;
}

/** GET /api/v3/position/current-position?category=USDT-FUTURES → v2 모양으로 통일 */
export function parsePositionsV3(data: unknown): PositionRow[] {
  const d = obj(data);
  const list = Array.isArray(d.list) ? d.list.map(obj) : Array.isArray(data) ? (data as unknown[]).map(obj) : [];
  const out: PositionRow[] = [];
  for (const p of list) {
    const total = num(p.total);
    if (Math.abs(total) <= 0) continue;
    out.push({
      symbol: text(p.symbol),
      holdSide: text(p.posSide) || text(p.holdSide),
      total,
      openPriceAvg: num(p.avgPrice) || num(p.openPriceAvg),
      markPrice: num(p.markPrice),
      unrealizedPL: num(p.unrealisedPnl) || num(p.unrealizedPnl),
      leverage: num(p.leverage),
      marginSize: num(p.positionBalance) || num(p.marginSize),
      liquidationPrice: num(p.liquidationPrice),
      presetStopSurplusPrice: num(p.presetStopSurplusPrice),
      presetStopLossPrice: num(p.presetStopLossPrice),
      ctime: Math.round(num(p.createdTime) || num(p.ctime)),
    });
  }
  return out;
}

/** GET /api/v3/account/settings → 보유 모드 + 종목별 마진 모드 */
export function parseSettingsV3(data: unknown): {
  holdMode: PosMode;
  marginModes: Record<string, 'crossed' | 'isolated'>;
} {
  const d = obj(data);
  const marginModes: Record<string, 'crossed' | 'isolated'> = {};
  const list = Array.isArray(d.symbolConfigList) ? d.symbolConfigList.map(obj) : [];
  for (const row of list) {
    const sym = text(row.symbol).toUpperCase();
    if (!sym) continue;
    if (text(row.category) && text(row.category).toUpperCase() !== V3_CATEGORY) continue;
    marginModes[sym] = v3MarginMode(text(row.marginMode));
  }
  const holdMode: PosMode = text(d.holdMode).toLowerCase().includes('hedge') ? 'hedge_mode' : 'one_way_mode';
  return { holdMode, marginModes };
}

/**
 * v3 주문 성공 응답 — `data.orderId` / `data.clientOid`
 */
export function parseOrderResultV3(data: unknown, fallbackOid = ''): { orderId: string; clientOid: string } {
  const d = obj(data);
  return {
    orderId: text(d.orderId),
    clientOid: text(d.clientOid) || fallbackOid,
  };
}
