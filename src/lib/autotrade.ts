/**
 * 🤖 비트겟 자동매매 — 규칙·안전장치·상태의 단일 기준.
 *
 * 원칙
 *  1) 기본값은 **꺼짐 + 모의투자**. 실거래는 사용자가 직접 API 키를 넣고, 실거래를 고르고,
 *     스위치를 켜야만 일어난다.
 *  2) 주문 수량은 `orderCockpit.ts`의 리스크 계산(시드 × 리스크% ÷ 손절거리)을 그대로 쓰고,
 *     거래소 수량 단위로 **내림**한다 — 계획한 손실을 넘기지 않는다.
 *  3) 진입 전에 통과해야 하는 문(게이트)을 한 곳(`evaluateEntry`)에 모은다:
 *     꺼짐 · 시그널 종료 · 허용 종목 · 최소 승률/손익비 · 중복 진입 · 동시 포지션 · 1일 손실 한도 ·
 *     시그널 유효시간 · 수량/최소주문금액 · 레버리지 상한.
 *  4) 화면에 보이는 모든 판단 문구는 이 파일의 순수 함수가 만든다(`scripts/autotrade-check.ts`).
 */
import type { Signal, Side } from '../engine/types';
import { copyQtyText, planOrder, type ContractSpec, type OrderPlan } from './orderCockpit';
import type { Profile } from './profile';

/* ------------------------------------------------------------------ *
 * 설정
 * ------------------------------------------------------------------ */

export type AutoMode = 'demo' | 'live';
export type SymbolScope = 'majors' | 'all';

export interface AutoTradeConfig {
  /** 자동매매 스위치 (기본 OFF) */
  enabled: boolean;
  /** 모의투자(Demo) / 실거래 */
  mode: AutoMode;
  /** 새 시그널을 자동으로 주문할지 (false = 원클릭 주문만) */
  autoEntry: boolean;
  /** 1회 허용 손실률(%) */
  riskPct: number;
  /** 최대 동시 포지션 수 */
  maxPositions: number;
  /** 1일 최대 손실 한도(% of 계좌) */
  dailyLossPct: number;
  /** 허용 종목 — 메이저 4종 / 전체 */
  symbols: SymbolScope;
  /** 진입에 필요한 최근 승률(%) */
  minWinRate: number;
  /** 진입에 필요한 손익비 */
  minRR: number;
  /** 레버리지 상한 */
  maxLeverage: number;
  /** 백그라운드 감시 주기(초) */
  intervalSec: number;
  /** 시그널(진입 대기) 유효 시간(분) */
  entryTtlMin: number;
}

/** 메이저 4종 — 기본 허용 종목 */
export const MAJOR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'] as const;

export const DEFAULTS: AutoTradeConfig = {
  enabled: false,
  mode: 'demo',
  autoEntry: true,
  riskPct: 1.5,
  maxPositions: 2,
  dailyLossPct: 4.5,
  symbols: 'majors',
  minWinRate: 55,
  minRR: 1.5,
  maxLeverage: 10,
  intervalSec: 60,
  entryTtlMin: 120,
};

/** 설정 입력 허용 범위 — 오타 한 번으로 계좌를 걸지 않게 한다. */
export const LIMITS = {
  /** 1회 리스크 — 0.5%~50% (사용자 요청으로 50%까지) */
  riskPct: [0.5, 50] as const,
  maxPositions: [1, 6] as const,
  /** 1일 손실 한도 — 0 = 끄기, 1~100% */
  dailyLossPct: [0, 100] as const,
  minWinRate: [0, 90] as const,
  minRR: [0.5, 5] as const,
  maxLeverage: [1, 25] as const,
  intervalSec: [30, 600] as const,
  entryTtlMin: [5, 1440] as const,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 1회 리스크 빠른 선택 — 자주 쓰는 값(50%까지) */
export const RISK_PRESET_CHOICES = [1, 2, 3, 5, 10, 20, 30, 50] as const;
/** 이 값 이상이면 고위험 경고 */
export const RISK_HIGH_WARN = 10;
const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeConfig(raw: Partial<AutoTradeConfig> | null | undefined): AutoTradeConfig {
  const src = raw ?? {};
  const merged: AutoTradeConfig = {
    enabled: src.enabled === true,
    mode: src.mode === 'live' ? 'live' : 'demo',
    autoEntry: src.autoEntry !== false,
    riskPct: num(src.riskPct, DEFAULTS.riskPct),
    maxPositions: num(src.maxPositions, DEFAULTS.maxPositions),
    dailyLossPct: num(src.dailyLossPct, DEFAULTS.dailyLossPct),
    symbols: src.symbols === 'all' ? 'all' : 'majors',
    minWinRate: num(src.minWinRate, DEFAULTS.minWinRate),
    minRR: num(src.minRR, DEFAULTS.minRR),
    maxLeverage: num(src.maxLeverage, DEFAULTS.maxLeverage),
    intervalSec: num(src.intervalSec, DEFAULTS.intervalSec),
    entryTtlMin: num(src.entryTtlMin, DEFAULTS.entryTtlMin),
  };
  return {
    ...merged,
    riskPct: round(clamp(merged.riskPct, LIMITS.riskPct[0], LIMITS.riskPct[1]), 1),
    maxPositions: Math.round(clamp(merged.maxPositions, LIMITS.maxPositions[0], LIMITS.maxPositions[1])),
    // 0 = 1일 손실 한도 끄기. 그 외는 1~100%
    dailyLossPct:
      num(src.dailyLossPct, DEFAULTS.dailyLossPct) === 0
        ? 0
        : round(clamp(merged.dailyLossPct, 1, LIMITS.dailyLossPct[1]), 1),
    minWinRate: round(clamp(merged.minWinRate, LIMITS.minWinRate[0], LIMITS.minWinRate[1]), 0),
    minRR: round(clamp(merged.minRR, LIMITS.minRR[0], LIMITS.minRR[1]), 2),
    maxLeverage: Math.round(clamp(merged.maxLeverage, LIMITS.maxLeverage[0], LIMITS.maxLeverage[1])),
    intervalSec: Math.round(clamp(merged.intervalSec, LIMITS.intervalSec[0], LIMITS.intervalSec[1])),
    entryTtlMin: Math.round(clamp(merged.entryTtlMin, LIMITS.entryTtlMin[0], LIMITS.entryTtlMin[1])),
  };
}

function round(v: number, digits: number) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * 실제 거래 모드 — 화면 설정(config.mode)이 아니라 **저장된 키가 어느 계좌의 키인지**가 기준이다.
 *  · 모의투자 키를 넣고 `실거래`를 골라도 실제로는 모의 계좌로 나간다(라벨만 틀리면 위험한 쪽은 반대).
 *  · 실거래 키를 넣고 `모의투자`를 골랐다면 **실제 돈이 나가므로** 실거래로 취급해 확인 절차를 태운다.
 */
export interface TradeModeState {
  mode: AutoMode;
  /** 설정과 키가 어긋났는가 */
  mismatch: boolean;
  note: string | null;
}

export function resolveTradeMode(
  config: Pick<AutoTradeConfig, 'mode'>,
  keys: { hasKeys: boolean; demo: boolean } | null | undefined,
): TradeModeState {
  const wanted: AutoMode = config.mode === 'live' ? 'live' : 'demo';
  if (!keys || !keys.hasKeys) return { mode: wanted, mismatch: false, note: null };
  const actual: AutoMode = keys.demo ? 'demo' : 'live';
  if (actual === wanted) return { mode: actual, mismatch: false, note: null };
  return {
    mode: actual,
    mismatch: true,
    note:
      actual === 'live'
        ? '실거래 계좌 키가 저장되어 있어 실거래로 실행합니다. 실제 USDT가 나갑니다.'
        : '모의투자 키가 저장되어 있어 모의투자로 실행합니다. 실거래는 실거래 계좌에서 만든 키를 넣어 주세요.',
  };
}

export function isMajorSymbol(symbol: string): boolean {
  const s = (symbol ?? '').toUpperCase();
  return (MAJOR_SYMBOLS as readonly string[]).includes(s);
}

export function symbolAllowed(config: AutoTradeConfig, symbol: string): boolean {
  if (config.symbols === 'all') return true;
  return isMajorSymbol(symbol);
}

/* ------------------------------------------------------------------ *
 * 하루 손실 한도
 * ------------------------------------------------------------------ */

/** 한국 시간(KST) 기준 날짜 키 — 거래소·사용자 모두 KST로 하루를 끊는다. */
export function dayKeyKst(ts: number): string {
  const kst = new Date(ts + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DailyGuardInput {
  dayStartEquity: number | null;
  equity: number | null;
  dailyLossPct: number;
}

export interface DailyGuardResult {
  pnlUsd: number;
  pnlPct: number;
  limitUsd: number;
  locked: boolean;
  /** 잠금까지 남은 손실 여유(USDT) */
  remainingUsd: number;
}

/** 계좌 equity 하락이 한도에 닿았는지 — unrealized를 포함한 현재 equity 기준 */
export function checkDailyLoss(input: DailyGuardInput): DailyGuardResult {
  const start = Number(input.dayStartEquity ?? 0);
  const now = Number(input.equity ?? Number.NaN);
  // 한도 끄기(0%) 또는 계좌·기준선을 아직 모를 때는 잠그지 않는다.
  if (input.dailyLossPct <= 0) return { pnlUsd: 0, pnlPct: 0, limitUsd: 0, locked: false, remainingUsd: 0 };
  if (!(start > 0) || !Number.isFinite(now) || now <= 0) {
    return { pnlUsd: 0, pnlPct: 0, limitUsd: 0, locked: false, remainingUsd: 0 };
  }
  const pnlUsd = now - start;
  const limitUsd = (start * input.dailyLossPct) / 100;
  return {
    pnlUsd: round(pnlUsd, 4),
    pnlPct: round((pnlUsd / start) * 100, 3),
    limitUsd: round(limitUsd, 2),
    locked: pnlUsd <= -limitUsd + 1e-9,
    remainingUsd: round(Math.max(0, limitUsd + pnlUsd), 4),
  };
}

/* ------------------------------------------------------------------ *
 * 진입 게이트
 * ------------------------------------------------------------------ */

export type EntryVerdict =
  | 'ok'
  | 'off'
  | 'manual-only'
  | 'no-keys'
  | 'not-open'
  | 'symbol'
  | 'winrate'
  | 'rr'
  | 'duplicate'
  | 'same-symbol'
  | 'max-positions'
  | 'daily-locked'
  | 'stale'
  | 'plan'
  | 'leverage';

export interface EntryDecision {
  allowed: boolean;
  code: EntryVerdict;
  reason: string;
}

export interface EntryContext {
  config: AutoTradeConfig;
  signal: Signal;
  /** 이미 진입/주문한 시그널 키 */
  tradedKeys: string[];
  /** 현재 보유 포지션 수 */
  openPositions: number;
  /** 이미 보유 중인 종목(코인) — 같은 종목에 또 진입하면 수량이 겁쳐 리스크가 두 배가 된다 */
  openSymbols?: string[];
  /** 오늘 손실 한도 잠금 여부 */
  dailyLocked: boolean;
  /** 자동 진입용 주문 계획 (수량·최소주문 확인) */
  plan: OrderPlan | null;
  now: number;
  /** API 키 연결 여부 — 네이티브 미연결(브라우저)이면 false */
  hasKeys: boolean;
  /** 원클릭 수동 주문은 게이트 일부를 건너뛴다(사용자가 직접 누름) */
  manual?: boolean;
}

/** 시그널 키 — 즐겨찾기·내 진입 기록과 같은 규칙(symbol|tf|side|detectedAt) */
export function signalKeyOf(s: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>): string {
  return `${s.symbol}|${s.tf}|${s.side}|${s.detectedAt}`;
}

const won = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * 진입 게이트 — 자동 진입은 모든 문을 통과해야 주문한다.
 * 문구는 그대로 로그·화면에 남으므로 "왜 안 들어갔는지"가 사용자에게 설명된다.
 */
export function evaluateEntry(ctx: EntryContext): EntryDecision {
  const { config, signal, plan, manual } = ctx;
  const base = signal.base || signal.symbol;

  if (!config.enabled) return { allowed: false, code: 'off', reason: '자동매매가 꺼져 있습니다.' };
  if (!manual && !config.autoEntry) {
    return { allowed: false, code: 'manual-only', reason: '자동 진입이 꺼져 있어 원클릭 주문만 가능합니다.' };
  }
  if (!ctx.hasKeys) {
    return {
      allowed: false,
      code: 'no-keys',
      reason: '비트겟 API 키가 연결되지 않았습니다. (브라우저에서는 모의 시뮬레이션만 가능)',
    };
  }
  if (signal.state !== 'open') {
    return { allowed: false, code: 'not-open', reason: `${base} 시그널이 이미 종료되어 진입하지 않습니다.` };
  }
  if (!symbolAllowed(config, signal.symbol)) {
    return { allowed: false, code: 'symbol', reason: `${base}는 허용 종목(메이저 4종)이 아닙니다.` };
  }
  // 승률 기준 — 전수 검증 채택 신호는 표본 부족으로 승률이 낮게 표기되므로,
  // 기대값이 확실한 기법(전수 0.30R 이상)은 승률 기준을 우회해 진입한다.
  const highExpectancy = signal.winRateBasis === 'bench' && (signal.strategyExp ?? 0) >= 0.3;
  if (!highExpectancy && signal.winRate < config.minWinRate) {
    return {
      allowed: false,
      code: 'winrate',
      reason: `${signal.winRateBasis === 'bench' ? '전수' : '최근'} 승률 ${signal.winRate.toFixed(0)}% < 기준 ${config.minWinRate}%`,
    };
  }
  if (signal.rr < config.minRR) {
    return { allowed: false, code: 'rr', reason: `손익비 ${signal.rr.toFixed(1)}R < 기준 ${config.minRR.toFixed(1)}R` };
  }
  const key = signalKeyOf(signal);
  if (ctx.tradedKeys.includes(key)) {
    return { allowed: false, code: 'duplicate', reason: `${base} 같은 시그널에 이미 진입했습니다(중복 진입 방지).` };
  }
  if ((ctx.openSymbols ?? []).includes(signal.symbol)) {
    return {
      allowed: false,
      code: 'same-symbol',
      reason: `${base} 포지션을 이미 보유 중입니다 — 같은 종목 중복 진입은 리스크가 2배가 되어 막습니다.`,
    };
  }
  if (ctx.openPositions >= config.maxPositions) {
    return {
      allowed: false,
      code: 'max-positions',
      reason: `동시 포지션 ${ctx.openPositions}/${config.maxPositions} — 새 진입을 멈춥니다.`,
    };
  }
  if (ctx.dailyLocked && config.dailyLossPct > 0) {
    return {
      allowed: false,
      code: 'daily-locked',
      reason: `1일 손실 한도 −${config.dailyLossPct}%에 도달해 오늘은 진입하지 않습니다.`,
    };
  }
  if (!manual && ctx.now - signal.detectedAt > config.entryTtlMin * 60_000) {
    return {
      allowed: false,
      code: 'stale',
      reason: `감지 후 ${config.entryTtlMin}분이 지나 진입을 취소했습니다.`,
    };
  }
  if (plan && plan.leverage > config.maxLeverage) {
    return {
      allowed: false,
      code: 'leverage',
      reason: `${plan.leverage}x > 레버리지 상한 ${config.maxLeverage}x`,
    };
  }
  if (!plan || !plan.valid) {
    return { allowed: false, code: 'plan', reason: plan?.error ?? '주문 계획을 만들 수 없습니다.' };
  }
  if (plan.belowMinQty) {
    return {
      allowed: false,
      code: 'plan',
      reason: `주문 수량이 비트겟 최소 수량보다 작습니다(최소 ${plan.minQty ?? 0} ${base}). 리스크 % 또는 시드를 키워야 합니다.`,
    };
  }
  if (plan.belowMinNotional) {
    return {
      allowed: false,
      code: 'plan',
      reason: `주문 금액 ${won(plan.notional)}이 비트겟 최소 주문 금액보다 작습니다.`,
    };
  }
  if (plan.overSeed) {
    return { allowed: false, code: 'plan', reason: '필요 증거금이 계좌보다 큽니다. 레버리지나 리스크 %를 조정하세요.' };
  }
  return {
    allowed: true,
    code: 'ok',
    reason: `${base} ${signal.side === 'long' ? '롱' : '숏'} · ${copyQtyText(plan.qty, plan.qtyDecimals)} ${base} · 리스크 ${won(plan.riskUsd)}`,
  };
}

/* ------------------------------------------------------------------ *
 * 주문 계획 / 주문 파라미터
 * ------------------------------------------------------------------ */

export interface AutoPlanInput {
  signal: Signal;
  seed: number;
  config: AutoTradeConfig;
  leverage: number;
  spec?: ContractSpec | null;
}

/** 시그널 + 설정 → 실제 주문 계획. 레버리지는 상한으로 자른다. */
export function planAutoOrder(input: AutoPlanInput): OrderPlan {
  const leverage = Math.max(1, Math.min(input.config.maxLeverage, Math.round(input.leverage) || 1));
  return planOrder({
    seed: Math.max(1, input.seed),
    riskPct: input.config.riskPct,
    leverage,
    side: input.signal.side,
    entry: input.signal.entry,
    stop: input.signal.stop,
    target: input.signal.target,
    spec: input.spec ?? undefined,
  });
}

/** 비트겟 포지션 모드 — 헤지 모드에서만 tradeSide 가 필요하다. */
export type PosMode = 'one_way_mode' | 'hedge_mode';

export function normalizePosMode(raw: string | null | undefined): PosMode {
  return String(raw ?? '').toLowerCase().includes('hedge') ? 'hedge_mode' : 'one_way_mode';
}

/**
 * 주문 방향 — 비트겟 v2 mix
 *   one-way: side=buy/sell, tradeSide 없음
 *   hedge  : open long = buy/open, open short = sell/open, close = 반대 side + close
 */
export function orderSideFor(side: Side, action: 'open' | 'close', posMode: PosMode): { side: 'buy' | 'sell'; tradeSide?: 'open' | 'close' } {
  if (action === 'open') {
    return posMode === 'hedge_mode'
      ? { side: side === 'long' ? 'buy' : 'sell', tradeSide: 'open' }
      : { side: side === 'long' ? 'buy' : 'sell' };
  }
  return posMode === 'hedge_mode'
    ? { side: side === 'long' ? 'sell' : 'buy', tradeSide: 'close' }
    : { side: side === 'long' ? 'sell' : 'buy' };
}

export interface PlaceOrderParams {
  symbol: string;
  productType: 'USDT-FUTURES';
  marginMode: 'isolated';
  marginCoin: 'USDT';
  size: string;
  side: 'buy' | 'sell';
  tradeSide?: 'open' | 'close';
  orderType: 'market' | 'limit';
  price?: string;
  clientOid: string;
  presetStopSurplusPrice?: string;
  presetStopLossPrice?: string;
}

/**
 * 수량 → 거래소 수량 단위로 **내림**한 문자열.
 *  · 단위 = max(10^-volumePlace, sizeMultiplier) — Bitget `sizeMultiplier` 는 BTC 0.0001 · MSTR 0.01 처럼
 *    10^-volumePlace 와 같은 값이거나, 1·10 처럼 **더 큰** 단위다. 둘 중 **큰쪽**을 지켜야 거래소가 받는다.
 *  · 지수 표기(1e-5) 없이 고정 소수로 씀다 — 비트겟이 `1e-5` 문자열을 거절한다.
 *  · 내림이므로 계획한 리스크를 넘기지 않는다(올림하면 손실이 커진다).
 *    qtyToStep(40762.5, 0) → '40762'   qtyToStep(1.2345, 2) → '1.23'   qtyToStep(25, 0, 10) → '20'
 * 네이티브 `BitgetApi.floorToStep` 과 같은 규칙이다.
 */
export function qtyToStep(qty: number, volumePlace?: number | null, sizeMultiplier?: number | null): string {
  if (!Number.isFinite(qty) || qty <= 0) return '';
  const vp = volumePlace != null && Number.isFinite(volumePlace) ? clamp(Math.round(volumePlace), 0, 8) : 8;
  const mult =
    sizeMultiplier != null && Number.isFinite(sizeMultiplier) && sizeMultiplier > 0 ? sizeMultiplier : 0;
  const scale = 10 ** vp;
  // 10^-vp 단위의 개수로 환산한 최소 주문 단위(1 이상 정수)
  const stepUnits = Math.max(1, Math.round(mult * scale));
  const units = Math.floor((qty * scale) / stepUnits + 1e-9);
  if (!(units > 0)) return '';
  const fixed = ((units * stepUnits) / scale).toFixed(vp);
  if (vp === 0) return fixed;
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** 주문 가격·수량 문자열 — 지수 표기 없이, 거래소 자리수 이하로 반올림(정수는 그대로) */
export function priceText(value: number, decimals?: number | null): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const d = decimals != null && Number.isFinite(decimals) ? clamp(Math.round(decimals), 0, 8) : 8;
  const fixed = value.toFixed(d);
  if (d === 0 || !fixed.includes('.')) return fixed;
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/* ------------------------------------------------------------------ *
 * 호가 단위(tick) — 비트겟 45115 의 원인
 * ------------------------------------------------------------------ */

/**
 * 최소 호가 = priceEndStep × 10^(-pricePlace).
 *   예) BTC(1,1) = 0.1 · ETH/BNB/MSTR(2,1) = 0.01 · 스텝5 코인(4,5) = 0.0005
 */
export function tickSizeOf(pricePlace?: number | null, priceEndStep?: number | null): number {
  const pp = pricePlace != null && Number.isFinite(pricePlace) ? clamp(Math.round(pricePlace), 0, 8) : 0;
  const step =
    priceEndStep != null && Number.isFinite(priceEndStep) && priceEndStep > 0 ? Math.round(priceEndStep) : 1;
  return step / 10 ** pp;
}

/**
 * 가격 → 호가 배수로 반올림한 고정 문자열.
 * 비트겟은 TP/SL·지정가가 호가 단위의 배수가 아니면 `45115 The price you enter should be a multiple of 0.01`
 * 처럼 거절한다. 신호의 목표가·손절가는 진입가 ± ATR 로 계산돼 소수 꼬리가 남기 때문에 주문 직전에 여기서 맞춘다.
 *   roundToTick(91234.567, 1, 1) → '91234.6'  (BTC 0.1)
 *   roundToTick(3456.789, 2, 1)  → '3456.79'  (ETH 0.01)
 *   roundToTick(0.00062, 4, 5)   → '0.0005'   (0.0005 배수)
 */
export function roundToTick(value: number, pricePlace?: number | null, priceEndStep?: number | null): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (pricePlace == null || !Number.isFinite(pricePlace)) return priceText(value, null);
  const pp = clamp(Math.round(pricePlace), 0, 8);
  const step =
    priceEndStep != null && Number.isFinite(priceEndStep) && priceEndStep > 0 ? Math.round(priceEndStep) : 1;
  const scale = 10 ** pp;
  // 정수 스케일에서 반올림 — 부동소수 곱셈 오차가 문자열로 새지 않게 한다.
  let ticks = Math.round((value * scale) / step);
  if (!(ticks > 0)) ticks = 1; // 0 호가 방지 — 최소 한 틱
  const digits = String(ticks * step).padStart(pp + 1, '0');
  const intPart = digits.slice(0, digits.length - pp);
  const frac = pp > 0 ? digits.slice(digits.length - pp).replace(/0+$/, '') : '';
  return frac ? `${intPart}.${frac}` : intPart;
}

/** 주문에 넣는 가격 — 호가 정보가 있으면 배수로 맞추고, 없으면 종전 표기(네이티브가 계약 호가로 보정한다) */
export function orderPriceText(
  value: number,
  pricePlace?: number | null,
  priceEndStep?: number | null,
): string {
  if (pricePlace == null || !Number.isFinite(pricePlace)) return priceText(value, null);
  return roundToTick(value, pricePlace, priceEndStep);
}

/** 주문 body — 네이티브 `bitgetPlaceOrder` 로 그대로 넘긴다. */
export function buildOrderParams(input: {
  signal: Pick<Signal, 'symbol' | 'side' | 'target' | 'stop' | 'decimals' | 'priceEndStep'>;
  plan: Pick<OrderPlan, 'qty' | 'qtyDecimals'>;
  posMode: PosMode;
  orderType?: 'market' | 'limit';
  limitPrice?: number;
  clientOid?: string;
  /** 계약 호가 정보 — 없으면 signal 의 decimals/priceEndStep 을 쓴다 */
  pricePlace?: number | null;
  priceEndStep?: number | null;
  /** 계약 수량 배수(거래소 sizeMultiplier) */
  sizeMultiplier?: number | null;
}): PlaceOrderParams {
  const { signal, plan, posMode } = input;
  const orderType = input.orderType ?? 'market';
  const dir = orderSideFor(signal.side, 'open', posMode);
  const pricePlace = input.pricePlace ?? signal.decimals;
  const priceEndStep = input.priceEndStep ?? signal.priceEndStep;
  const params: PlaceOrderParams = {
    symbol: signal.symbol,
    productType: 'USDT-FUTURES',
    marginMode: 'isolated',
    marginCoin: 'USDT',
    size: qtyToStep(plan.qty, plan.qtyDecimals ?? 8, input.sizeMultiplier),
    side: dir.side,
    orderType,
    clientOid: input.clientOid ?? clientOidFor(signal.symbol),
    presetStopSurplusPrice: orderPriceText(signal.target, pricePlace, priceEndStep),
    presetStopLossPrice: orderPriceText(signal.stop, pricePlace, priceEndStep),
  };
  if (dir.tradeSide) params.tradeSide = dir.tradeSide;
  if (orderType === 'limit') params.price = orderPriceText(input.limitPrice ?? 0, pricePlace, priceEndStep);
  return params;
}

/** 비트겟 clientOid — 36자 이내 영숫자 */
export function clientOidFor(symbol: string, at = Date.now()): string {
  const base = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  return `cota${base}${at.toString(36)}`.slice(0, 36);
}

/* ------------------------------------------------------------------ *
 * 감시 목록(armed plans) — 서비스가 화면 꺼짐 상태에서 지켜보는 진입 조건
 * ------------------------------------------------------------------ */

export interface ArmedPlan {
  key: string;
  symbol: string;
  base: string;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  qtyDecimals: number | null;
  leverage: number;
  decimals: number | null;
  /** 거래소 호가 정보(pricePlace) — 네이티브가 없을 때 보정용으로도 쓴다 */
  pricePlace: number | null;
  /** 호가 스텝(priceEndStep) — TP/SL 을 호가 배수로 맞춘다 */
  priceEndStep: number;
  /** 이미 호가 배수로 맞춘 TP/SL 문자열 — 네이티브가 손대지 않고 그대로 보낸다 */
  tpStr: string;
  slStr: string;
  winRate: number;
  rr: number;
  detectedAt: number;
  expiresAt: number;
}

/** 진입가 터치 허용 오차(0.05%) — 시장가 즉시 체결이 목표가·손절가를 망치지 않게. */
export const TOUCH_TOLERANCE = 0.0005;

export function toArmedPlan(input: {
  signal: Signal;
  plan: OrderPlan;
  now: number;
  ttlMin: number;
  /** 계약 호가 정보 — 없으면 signal 의 decimals/priceEndStep 을 쓴다 */
  pricePlace?: number | null;
  priceEndStep?: number | null;
}): ArmedPlan {
  const { signal, plan, now, ttlMin } = input;
  const pricePlace = input.pricePlace ?? signal.decimals ?? null;
  const priceEndStep = input.priceEndStep ?? signal.priceEndStep ?? 1;
  return {
    key: signalKeyOf(signal),
    symbol: signal.symbol,
    base: signal.base,
    side: signal.side,
    entry: signal.entry,
    stop: signal.stop,
    target: signal.target,
    qty: plan.qty,
    qtyDecimals: plan.qtyDecimals,
    leverage: plan.leverage,
    decimals: signal.decimals ?? null,
    pricePlace,
    priceEndStep,
    tpStr: orderPriceText(signal.target, pricePlace, priceEndStep),
    slStr: orderPriceText(signal.stop, pricePlace, priceEndStep),
    winRate: signal.winRate,
    rr: signal.rr,
    detectedAt: signal.detectedAt,
    expiresAt: now + ttlMin * 60_000,
  };
}

export type PlanTrigger =
  | 'enter'
  | 'wait'
  | 'invalidated'
  | 'expired'
  /** 현재가가 이미 목표가에 닿아(지나) 목표가를 걸 수 없다 — 거래소 25585/25587 */
  | 'target-passed'
  /** 현재가가 손절가에 너무 붙어(0.1% 이내) 시장가 체결 즉시 손절될 자리 */
  | 'near-stop';

/**
 * 진입 직전 방어선 — 시장가 체결가가 목표가·손절가를 잠식하는 자리는 들어가지 않는다.
 *  · 거래소는 TP/SL 을 **현재가(최근가·지정가) 기준**으로 검사해 방향이 틀리면
 *    `25585`(롱 TP > 최근가) · `25586`(롱 SL < 최근가) · `25587`/`25588`(숏) 로 거절한다.
 *  · 손절가에 0.1% 이내로 붙은 자리는 체결 직후 손절 → 수수료만 잃는다.
 */
export const MIN_STOP_DISTANCE = 0.001; // 현재가 대비 손절가 최소 거리 0.1%
export const MIN_TARGET_GAP = 0.001; // 현재가 대비 목표가 최소 여유 0.1%

/**
 * 지금 가격이 진입 조건을 만족하는가.
 *  - 롱: 진입가 이하로 내려오면 진입(되돌림 매수). 손절가를 먼저 깨면 셋업 무효.
 *  - 숏: 진입가 이상으로 올라오면 진입. 손절가를 먼저 깨면 무효.
 *  - 유효시간이 지나면 취소.
 *  - 손절·목표가에 이미 붙었거나 지나쳤으면 진입하지 않는다(TP/SL 방향 오류·즉시 손절 방지).
 */
export function planTrigger(
  plan: Pick<ArmedPlan, 'side' | 'entry' | 'stop' | 'expiresAt'> & { target?: number },
  price: number,
  now: number,
): PlanTrigger {
  if (!(price > 0)) return 'wait';
  if (now >= plan.expiresAt) return 'expired';
  const target = Number(plan.target ?? 0);
  if (plan.side === 'long') {
    if (price <= plan.stop) return 'invalidated';
    if (target > 0 && price >= target * (1 - MIN_TARGET_GAP)) return 'target-passed';
    if (price <= plan.stop * (1 + MIN_STOP_DISTANCE)) return 'near-stop';
    if (price <= plan.entry * (1 + TOUCH_TOLERANCE)) return 'enter';
    return 'wait';
  }
  if (price >= plan.stop) return 'invalidated';
  if (target > 0 && price <= target * (1 + MIN_TARGET_GAP)) return 'target-passed';
  if (price >= plan.stop * (1 - MIN_STOP_DISTANCE)) return 'near-stop';
  if (price >= plan.entry * (1 - TOUCH_TOLERANCE)) return 'enter';
  return 'wait';
}

/** 같은 시그널이 다시 와도 중복으로 쌓이지 않게 키 기준 병합 */
export function mergeArmedPlans(prev: ArmedPlan[], next: ArmedPlan[], max = 12): ArmedPlan[] {
  const map = new Map<string, ArmedPlan>();
  for (const p of prev) map.set(p.key, p);
  for (const p of next) {
    if (!map.has(p.key)) map.set(p.key, p);
  }
  return [...map.values()].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, max);
}

/* ------------------------------------------------------------------ *
 * 상태·로그
 * ------------------------------------------------------------------ */

export type AutoLogLevel = 'fill' | 'reject' | 'block' | 'info' | 'error';

export interface AutoLogEntry {
  at: number;
  level: AutoLogLevel;
  text: string;
  symbol?: string;
  side?: Side;
}

export interface AutoRuntime {
  /** KST 날짜 키 — 날이 바뀌면 하루 손실 집계를 새로 시작한다 */
  dayKey: string;
  dayStartEquity: number | null;
  tradedKeys: string[];
  logs: AutoLogEntry[];
  /** 마지막으로 반영된 포지션 수 */
  openPositions: number;
}

export const LOG_LIMIT = 60;

export function emptyRuntime(now: number, dayStartEquity: number | null = null): AutoRuntime {
  return { dayKey: dayKeyKst(now), dayStartEquity, tradedKeys: [], logs: [], openPositions: 0 };
}

/** 날짜가 바뀌면 tradedKeys·로그는 남기고 하루 손실 기준선만 새로 잡는다. */
export function rollDay(runtime: AutoRuntime, now: number, equity: number | null): AutoRuntime {
  const key = dayKeyKst(now);
  if (runtime.dayKey === key) return runtime;
  return {
    ...runtime,
    dayKey: key,
    dayStartEquity: equity ?? runtime.dayStartEquity,
    logs: [
      { at: now, level: 'info' as AutoLogLevel, text: `새 거래일(${key}) — 하루 손실 기준 equity를 다시 잡았습니다.` },
      ...runtime.logs,
    ].slice(0, LOG_LIMIT),
  };
}

export function pushLog(runtime: AutoRuntime, entry: AutoLogEntry): AutoRuntime {
  return { ...runtime, logs: [entry, ...runtime.logs].slice(0, LOG_LIMIT) };
}

export function markTraded(runtime: AutoRuntime, key: string): AutoRuntime {
  if (runtime.tradedKeys.includes(key)) return runtime;
  return { ...runtime, tradedKeys: [...runtime.tradedKeys, key].slice(-200) };
}

/* ------------------------------------------------------------------ *
 * 표시 도우미
 * ------------------------------------------------------------------ */

export function statusBadge(config: AutoTradeConfig, running: boolean): { label: string; tone: 'off' | 'demo' | 'live' } {
  if (!config.enabled) return { label: '꺼짐', tone: 'off' };
  if (!running) return { label: '대기 중 (앱 열림)', tone: config.mode === 'live' ? 'live' : 'demo' };
  return { label: config.mode === 'live' ? '실거래 가동 중' : '모의투자 가동 중', tone: config.mode === 'live' ? 'live' : 'demo' };
}

/** 프로필 시드 — 없으면 계좌 잔고, 둘 다 없으면 0 */
export function planSeed(profile: Profile | null, accountEquity: number | null): number {
  if (profile && profile.seed > 0) return profile.seed;
  if (accountEquity && accountEquity > 0) return accountEquity;
  return 0;
}

export function fmtUsdt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const body = abs >= 1000 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(digits);
  return `${v < 0 ? '−' : ''}$${body}`;
}

/** 오늘(KST) 체결로 기록된 로그 수 — 화면의 `N건 진입` 배지가 실제 체결만 세도록 */
export function todayFillCount(logs: AutoLogEntry[], now: number): number {
  const key = dayKeyKst(now);
  return logs.filter((l) => l.level === 'fill' && dayKeyKst(Number(l.at) || 0) === key).length;
}

export function fmtClock(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
