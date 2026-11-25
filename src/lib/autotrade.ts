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
import { isFxSymbol, isStockSymbol } from '../engine/universe';
import { copyQtyText, planOrder, type ContractSpec, type OrderPlan } from './orderCockpit';
import { exchangeLeverageCap } from './profile';

/* ------------------------------------------------------------------ *
 * 설정
 * ------------------------------------------------------------------ */

export type AutoMode = 'demo' | 'live';
/**
 * 허용 종목 범위
 *  · 'crypto' — 주식선물·FX(금·지수)를 뺀 **모든 비트겟 코인 USDT-M 선물** (기본값)
 *  · 'majors' — 메이저 4종(BTC·ETH·SOL·XRP)만
 *  · 'all'    — 주식선물까지 포함한 비트겟 USDT-M 전 종목
 */
export type SymbolScope = 'crypto' | 'majors' | 'all';

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
  /** 허용 종목 — 전체 코인(기본) / 메이저 4종 / 주식선물 포함 */
  symbols: SymbolScope;
  /** 진입에 필요한 최근 승률(%) — 기본 45%. 전수 기대값 플러스 기법은 이 기준을 우회한다 */
  minWinRate: number;
  /** 진입에 필요한 손익비 — 기본 1.2R */
  minRR: number;
  /**
   * 레버리지 상한 — **0 = 상한 없음(유동)** (기본값).
   *  · 0 이면 손절 폭·품질·실시간 잔고로 계산한 추천 배율을 청산 안전마진·거래소 최대 배율까지만 보고 쓴다.
   *  · 양수면 그 값이 상한이 된다(거래소 최대 배율보다 크면 거래소 쪽이 이긴다).
   */
  maxLeverage: number;
  /** 백그라운드 감시 주기(초) */
  intervalSec: number;
  /** 시그널(진입 대기) 유효 시간(분) — 봉 마감 시점부터 센다(기본 240분) */
  entryTtlMin: number;
  /** SL 도달 전 반대 신호·구조 붕괴 시 선제 청산 (v1.5.4 · 기본 ON) */
  earlyStop: boolean;
  /** 목표가 50% 또는 +1.0R 도달 시 보유의 50% 분할 익제 (v1.5.6 · 기본 ON) */
  partialTp: boolean;
}

/** 메이저 4종 — 'majors' 범위에서 허용하는 종목 */
export const MAJOR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'] as const;

export const DEFAULTS: AutoTradeConfig = {
  enabled: false,
  mode: 'demo',
  autoEntry: true,
  riskPct: 1.5,
  maxPositions: 2,
  dailyLossPct: 4.5,
  symbols: 'crypto',
  // 실전 진입이 실제로 이루어지도록 완화한 기본값(v1.5.7) — 전수 기대값 플러스 기법은 승률 기준을 우회한다.
  minWinRate: 45,
  minRR: 1.2,
  // 상한 없음 · 유동 — 추천 배율을 청산 안전마진·거래소 최대 배율까지만 본다.
  maxLeverage: 0,
  intervalSec: 60,
  // 1H·4H 시그널 모두 봉 마감 뒤 충분히 감시하도록 4시간
  entryTtlMin: 240,
  earlyStop: true,
  partialTp: true,
};

/** 레버리지 상한 '0' = 상한 없음(유동) — 청산 안전마진·거래소 최대 배율만 지킨다 */
export const UNLIMITED_LEVERAGE = 0;

/** 설정 입력 허용 범위 — 오타 한 번으로 계좌를 걸지 않게 한다. */
export const LIMITS = {
  /** 1회 리스크 — 0.5%~50% (사용자 요청으로 50%까지) */
  riskPct: [0.5, 50] as const,
  maxPositions: [1, 6] as const,
  /** 1일 손실 한도 — 0 = 끄기, 1~100% */
  dailyLossPct: [0, 100] as const,
  minWinRate: [0, 90] as const,
  minRR: [0.5, 5] as const,
  /** 레버리지 상한 — 1~100 · 0 = 상한 없음(유동) */
  maxLeverage: [1, 100] as const,
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
    // 미지정·구버전 저장본은 새 기본값 'crypto'(주식선물 제외 전체 코인)로 읽는다.
    symbols: src.symbols === 'majors' ? 'majors' : src.symbols === 'all' ? 'all' : 'crypto',
    minWinRate: num(src.minWinRate, DEFAULTS.minWinRate),
    minRR: num(src.minRR, DEFAULTS.minRR),
    maxLeverage: num(src.maxLeverage, DEFAULTS.maxLeverage),
    intervalSec: num(src.intervalSec, DEFAULTS.intervalSec),
    entryTtlMin: num(src.entryTtlMin, DEFAULTS.entryTtlMin),
    earlyStop: src.earlyStop !== false,
    partialTp: src.partialTp !== false,
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
    // 0 = 상한 없음(유동). 1~100 은 그대로, 그 밖은 경계로 정리한다.
    maxLeverage:
      num(src.maxLeverage, DEFAULTS.maxLeverage) === 0
        ? UNLIMITED_LEVERAGE
        : Math.round(clamp(merged.maxLeverage, LIMITS.maxLeverage[0], LIMITS.maxLeverage[1])),
    intervalSec: Math.round(clamp(merged.intervalSec, LIMITS.intervalSec[0], LIMITS.intervalSec[1])),
    entryTtlMin: Math.round(clamp(merged.entryTtlMin, LIMITS.entryTtlMin[0], LIMITS.entryTtlMin[1])),
  };
}

function round(v: number, digits: number) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/* ------------------------------------------------------------------ *
 * 구버전 저장본 정리 — 매매 스타일 프리셋이 없어지면서(v1.5.7)
 *  · `stylePresetActive` 필드는 읽지 않고 버린다.
 *  · 예전 기본값(승률 55% · 1.5R · 120분 · 10x 상한)만 새 기본값으로 **한 번** 완화한다.
 *    사용자가 직접 조정한 값(그 밖의 숫자)은 건드리지 않는다.
 * ------------------------------------------------------------------ */

/** 진입 게이트 완화 1회 마이그레이션 키 — 앱(localStorage)에 남긴다. */
export const ENTRY_GATE_MIGRATION_KEY = 'cota.autotrade.migrated.entryGate.v157';

/** v1.5.6 까지의 기본값 — 이 값 그대로면 사용자가 손대지 않은 기본값으로 본다. */
export const LEGACY_DEFAULTS = {
  minWinRate: 55,
  minRR: 1.5,
  entryTtlMin: 120,
  maxLeverage: 10,
} as const;

/**
 * 예전 기본값 → 완화된 새 기본값 1회 마이그레이션.
 *  · 승률 55 → 45 · 손익비 1.5 → 1.2 · 유효시간 120 → 240분 · 레버리지 상한 10 → 0(유동).
 *  · 이미 한 번 옮긴 뒤 사용자가 직접 '55%' 로 되돌리면 그 선택은 유지한다(`alreadyMigrated`).
 */
export function migrateEntryGateOnce(
  raw: Partial<AutoTradeConfig> | null | undefined,
  alreadyMigrated: boolean,
): { config: Partial<AutoTradeConfig> | null; changed: boolean; fields: string[] } {
  const src = raw ?? null;
  if (alreadyMigrated || !src) return { config: src, changed: false, fields: [] };
  const patch: Partial<AutoTradeConfig> = {};
  const fields: string[] = [];
  if (Number(src.minWinRate) === LEGACY_DEFAULTS.minWinRate) {
    patch.minWinRate = DEFAULTS.minWinRate;
    fields.push('최소 승률');
  }
  if (Number(src.minRR) === LEGACY_DEFAULTS.minRR) {
    patch.minRR = DEFAULTS.minRR;
    fields.push('최소 손익비');
  }
  if (Number(src.entryTtlMin) === LEGACY_DEFAULTS.entryTtlMin) {
    patch.entryTtlMin = DEFAULTS.entryTtlMin;
    fields.push('시그널 유효시간');
  }
  if (Number(src.maxLeverage) === LEGACY_DEFAULTS.maxLeverage) {
    patch.maxLeverage = UNLIMITED_LEVERAGE;
    fields.push('레버리지 상한(유동)');
  }
  if (!fields.length) return { config: src, changed: false, fields };
  return { config: { ...src, ...patch }, changed: true, fields };
}


/* ------------------------------------------------------------------ *
 * ② 리스크 · 안전장치 초안 → 저장 (v1.5.6)
 *   화면에서 값을 바꿔도 `저장`을 누르기 전에는 설정·네이티브 감시가 바뀌지 않는다.
 *   (현우님: "손실한도를 바꿨는데 프리셋에 적용되지가 않아. 저장 버튼 추가하고 작동하게 만들어")
 *   v1.5.7 — 매매 스타일 프리셋이 없어져 초안 12항목만 정규화해 저장한다.
 * ------------------------------------------------------------------ */

/** `② 리스크 · 안전장치`에서 직접 편집하는 항목 — 저장 버튼을 눌러야 설정에 반영된다. */
export const GUARD_FIELDS = [
  'riskPct',
  'maxPositions',
  'dailyLossPct',
  'maxLeverage',
  'minWinRate',
  'minRR',
  'intervalSec',
  'entryTtlMin',
  'symbols',
  'earlyStop',
  'partialTp',
  'autoEntry',
] as const;

export type GuardField = (typeof GUARD_FIELDS)[number];

export const GUARD_FIELD_LABEL: Record<GuardField, string> = {
  riskPct: '1회 리스크',
  maxPositions: '최대 동시 포지션',
  dailyLossPct: '1일 손실 한도',
  maxLeverage: '레버리지 상한',
  minWinRate: '최소 승률',
  minRR: '최소 손익비',
  intervalSec: '감시 주기',
  entryTtlMin: '시그널 유효시간',
  symbols: '허용 종목',
  earlyStop: '조기 손절 보호',
  partialTp: '50% 반익절',
  autoEntry: '새 시그널 자동 진입',
};

/** 초안에서 **저장할 항목만** 뽑는다 — 켜짐·모의/실거래는 이 카드가 건드리지 않는다. */
export function guardPatchOf(draft: AutoTradeConfig): Pick<AutoTradeConfig, GuardField> {
  const patch = {} as Pick<AutoTradeConfig, GuardField>;
  for (const field of GUARD_FIELDS) {
    (patch as Record<string, unknown>)[field] = draft[field];
  }
  return patch;
}

/** 저장값과 초안이 다른 항목 — `저장 안 됨` 배지·저장 버튼 활성화 판정 */
export function guardFieldsChanged(saved: AutoTradeConfig, draft: AutoTradeConfig): GuardField[] {
  return GUARD_FIELDS.filter((field) => saved[field] !== draft[field]);
}

/**
 * `②` 저장 적용 — 초안을 정규화(범위 클램프)해 저장값에 얹는다.
 * 반환값은 정규화된 새 설정이며 화면이 초안을 이 값으로 다시 맞춘다(클램프 반영).
 */
export function applyGuardSave(
  saved: AutoTradeConfig,
  patch: Partial<Pick<AutoTradeConfig, GuardField>>,
): AutoTradeConfig {
  return normalizeConfig({ ...saved, ...patch });
}

/** 레버리지 상한 문구 — `상한 없음 · 유동` / `12x` */
export function leverageCapLabel(maxLeverage: number): string {
  return maxLeverage > 0 ? `${maxLeverage}x` : '상한 없음 · 유동';
}

/**
 * 실제 레버리지 상한 — 0(무제한)이면 거래소 종목 최대 배율, 그것도 모르면 안전 상한 100x.
 * 주문 계획·진입 게이트가 **같은 상한**을 쓰도록 한 곳에 모았다.
 */
export function leverageCapOf(
  config: Pick<AutoTradeConfig, 'maxLeverage'>,
  maxLever?: number | null,
): number {
  const exchangeCap = exchangeLeverageCap(maxLever);
  const configured = Number(config.maxLeverage ?? 0);
  if (!Number.isFinite(configured) || configured <= 0) return exchangeCap;
  return Math.min(configured, exchangeCap);
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

/**
 * 코인 USDT-M 선물인가 — 주식선물(TSLA·MSTR…)과 FX/RWA(금·은·지수·환율)를 뺀 나머지.
 * 판정은 스캐너가 계약을 분류할 때 쓰는 것과 같은 규칙(`engine/universe`)이다.
 */
export function isCryptoSymbol(symbol: string): boolean {
  const s = (symbol ?? '').toUpperCase();
  if (!s) return false;
  return !isStockSymbol(s) && !isFxSymbol(s);
}

/** 이 종목을 자동매매가 건드려도 되는가 — 설정 범위에 따라 */
export function symbolAllowed(config: AutoTradeConfig, symbol: string): boolean {
  const s = (symbol ?? '').toUpperCase();
  if (config.symbols === 'all') return true;
  if (!isCryptoSymbol(s)) return false;
  if (config.symbols === 'majors') return isMajorSymbol(s);
  return true; // 'crypto'
}

/** 허용 종목 1회 마이그레이션 키 — 앱(localStorage)에 남긴다. */
export const SYMBOL_MIGRATION_KEY = 'cota.autotrade.migrated.cryptoDefault.v1';

export interface SymbolScopeMigration {
  /** 마이그레이션 후 설정 (바꿀 것이 없으면 입력 그대로) */
  config: Partial<AutoTradeConfig> | null;
  /** 'majors' → 'crypto' 로 바꿨는가 */
  changed: boolean;
}

/**
 * 허용 종목 기본값 1회 마이그레이션.
 *  · 예전 기본값 `'majors'`(메이저 4종)가 저장된 사용자는 알트 코인 시그널이 전부 걸러져
 *    자동매매가 사실상 돌지 않았다 → 새 기본값 `'crypto'`(주식선물 제외 전체 코인)로 **한 번만** 옮긴다.
 *  · 한 번 옮긴 뒤 사용자가 직접 '메이저 4종'을 고르면 그 선택은 그대로 둔다(`alreadyMigrated`).
 */
export function migrateSymbolScopeOnce(
  raw: Partial<AutoTradeConfig> | null | undefined,
  alreadyMigrated: boolean,
): SymbolScopeMigration {
  const src = raw ?? null;
  if (alreadyMigrated || !src) return { config: src, changed: false };
  if (src.symbols !== 'majors') return { config: src, changed: false };
  return { config: { ...src, symbols: 'crypto' }, changed: true };
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
    const reason =
      config.symbols === 'crypto'
        ? `${base}는 코인 종목이 아니어서 제외합니다(주식선물 제외).`
        : config.symbols === 'majors'
          ? `${base}는 허용 종목(메이저 4종)이 아닙니다.`
          : `${base}는 허용 종목이 아닙니다.`;
    return { allowed: false, code: 'symbol', reason };
  }
  // 승률 기준 — 전수 검증 채택 신호는 표본 부족으로 승률이 낮게 표기되므로,
  // 기대값이 확실한 기법(전수 0.2R 이상 = 플러스 기대값)은 승률 기준을 우회해 진입한다.
  const highExpectancy = signal.winRateBasis === 'bench' && (signal.strategyExp ?? 0) >= 0.2;
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
  if (!manual && signalAgeMin(signal, ctx.now) > config.entryTtlMin) {
    return {
      allowed: false,
      code: 'stale',
      reason: `봉 마감 후 ${Math.round(signalAgeMin(signal, ctx.now))}분이 지나 진입을 취소했습니다(유효시간 ${config.entryTtlMin}분).`,
    };
  }
  if (plan && plan.leverage > leverageCapOf(config)) {
    return {
      allowed: false,
      code: 'leverage',
      reason:
        config.maxLeverage > 0
          ? `${plan.leverage}x > 레버리지 상한 ${config.maxLeverage}x`
          : `${plan.leverage}x > 안전 상한 ${leverageCapOf(config)}x`,
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
  /** 연결된 계좌의 총 자산(equity) — v1.5.5 부터 시드의 유일한 기준 */
  seed: number;
  config: AutoTradeConfig;
  leverage: number;
  spec?: ContractSpec | null;
  /** 가용 잔고 — 필요 증거금이 가용의 95%를 넘지 않게 수량을 줄인다 */
  available?: number | null;
}

/** 시그널 + 설정 → 실제 주문 계획. 레버리지는 상한(0=무제한 → 거래소 최대·안전 100x)까지 자른다. */
export function planAutoOrder(input: AutoPlanInput): OrderPlan {
  const cap = leverageCapOf(input.config, input.spec?.maxLever);
  const leverage = Math.max(1, Math.min(cap, Math.round(input.leverage) || 1));
  return planOrder({
    seed: Math.max(1, input.seed),
    riskPct: input.config.riskPct,
    leverage,
    side: input.signal.side,
    entry: input.signal.entry,
    stop: input.signal.stop,
    target: input.signal.target,
    spec: input.spec ?? undefined,
    available: input.available ?? null,
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
  /** 1회 허용 손실률(%) — 네이티브가 잔고로 수량을 다시 계산할 때 쓴다(v1.5.5) */
  riskPct: number;
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

/* ------------------------------------------------------------------ *
 * 진입 구간 · 유효시간 (v1.5.7)
 *
 * 기존 진입 조건은 `현재가가 진입가 ±0.05% 안으로 터치`였다. 60초 감시에서 가격이
 * 그 좁은 띠를 스쳐 지나가면 영원히 진입하지 못했고, 시그널이 뜬 뒤 가격이 조금만
 * 움직여도 감시 목록 전체가 '대기'로 남았다. 그래서 실제 체결이 일어나는 구간으로 넓힌다.
 *   롱  : entry × 0.992 ~ entry × 1.005
 *   숏  : entry × 0.995 ~ entry × 1.008
 *  · 진입가보다 유리한 쪽으로 0.8%(롱)/0.5%(숏) 넘게 벗어나도 **손익비가 기준 이상이면** 들어간다.
 *  · 손절가·목표가 방어선(0.1%)은 그대로 — 즉시 손절·TP 방향 오류를 막는다.
 *  · 유효시간은 '감지 봉이 마감된 시점'부터 센다. 4H 시그널은 봉이 마감돼야 확정되므로
 *    detectedAt(봉 시작)만으로 재면 태어나자마자 만료되는 문제가 있었다.
 * ------------------------------------------------------------------ */

/** 진입가보다 불리한(추격) 쪽 허용 — 롱은 위 0.5%, 숏은 아래 0.5% */
export const ENTRY_CHASE = 0.005;
/** 진입가보다 유리한 쪽 허용 — 롱은 아래 0.8%, 숏은 위 0.8% (넘으면 손익비로 판정) */
export const ENTRY_FAVOR = 0.008;
/** 현재가 기준 손익비 하한 — 이보다 나쁘면 진입하지 않는다(설정 minRR 과 별개의 안전선) */
export const MIN_ENTRY_RR = 1.0;
/** 호환 상수 — 예전 '터치 허용 오차' 표기(0.05%). 실제 진입 판정은 ENTRY_CHASE/FAVOR 를 쓴다. */
export const TOUCH_TOLERANCE = 0.0005;

/** 봉 길이(ms) — 1H·4H */
export function tfMs(tf?: string | null): number {
  return tf === '4H' ? 4 * 3600_000 : 3600_000;
}

/** 시그널이 실제로 확정된 시각 = 감지 봉의 마감 시각 */
export function signalReadyAt(signal: Pick<Signal, 'tf' | 'detectedAt'>): number {
  return Number(signal.detectedAt || 0) + tfMs(signal.tf);
}

/** 유효시간 판정용 나이(분) — 봉 마감 뒤부터 센다(음수는 0) */
export function signalAgeMin(signal: Pick<Signal, 'tf' | 'detectedAt'>, now: number): number {
  return Math.max(0, (now - signalReadyAt(signal)) / 60_000);
}

export interface EntryZone {
  low: number;
  high: number;
}

/** 지금 들어가도 되는 가격 구간 */
export function entryZoneOf(plan: Pick<ArmedPlan, 'side' | 'entry'>): EntryZone {
  const entry = Number(plan.entry) || 0;
  if (plan.side === 'long') {
    return { low: entry * (1 - ENTRY_FAVOR), high: entry * (1 + ENTRY_CHASE) };
  }
  return { low: entry * (1 - ENTRY_CHASE), high: entry * (1 + ENTRY_FAVOR) };
}

/** 현재가 기준 손익비 — 위험(현재가→손절) 대비 보상(현재가→목표) */
export function rrAtPrice(side: Side, price: number, stop: number, target: number): number {
  const risk = side === 'long' ? price - stop : stop - price;
  const reward = side === 'long' ? target - price : price - target;
  if (!(risk > 0) || !(reward > 0)) return 0;
  return reward / risk;
}

/** 가격 표기 — 지수 표기 없이 최대 8자리 */
export function fmtPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const fixed = value.toFixed(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return fixed === '-0' ? '0' : fixed;
}

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
  // 봉 마감 시점부터 유효시간을 센다 — 4H 시그널이 태어나자마자 만료되지 않게.
  const expiresAt = Math.max(now + 60_000, signalReadyAt(signal) + ttlMin * 60_000);
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
    riskPct: plan.riskPct,
    decimals: signal.decimals ?? null,
    pricePlace,
    priceEndStep,
    tpStr: orderPriceText(signal.target, pricePlace, priceEndStep),
    slStr: orderPriceText(signal.stop, pricePlace, priceEndStep),
    winRate: signal.winRate,
    rr: signal.rr,
    detectedAt: signal.detectedAt,
    expiresAt,
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
 *  - 롱: 진입 구간(entry×0.992~1.005) 안이면 진입. 그보다 더 싸면 손익비가 기준 이상일 때 진입.
 *  - 숏: 진입 구간(entry×0.995~1.008) 안이면 진입. 그보다 더 비싸면 손익비가 기준 이상일 때 진입.
 *  - 손절가를 먼저 깨면 셋업 무효 · 유효시간이 지나면 취소.
 *  - 손절·목표가에 이미 붙었거나 지나쳤으면 진입하지 않는다(TP/SL 방향 오류·즉시 손절 방지).
 */
export function planTrigger(
  plan: Pick<ArmedPlan, 'side' | 'entry' | 'stop' | 'expiresAt'> & { target?: number },
  price: number,
  now: number,
  /** 현재가 기준 최소 손익비 — 설정 minRR 을 넘기면 그 값을 쓴다 */
  minRR: number = MIN_ENTRY_RR,
): PlanTrigger {
  if (!(price > 0)) return 'wait';
  if (now >= plan.expiresAt) return 'expired';
  const target = Number(plan.target ?? 0);
  const zone = entryZoneOf(plan);
  // 경계값 부동소수 오차(100 × 1.005 = 100.4999…)로 경계에서 한 틱씩 새지 않게 아주 작은 여유를 둔다.
  const eps = Math.max(1e-12, (Number(plan.entry) || 0) * 1e-9);
  const rrFloor = Math.max(MIN_ENTRY_RR, Number.isFinite(minRR) ? minRR : MIN_ENTRY_RR);
  if (plan.side === 'long') {
    if (price <= plan.stop) return 'invalidated';
    if (target > 0 && price >= target * (1 - MIN_TARGET_GAP)) return 'target-passed';
    if (price <= plan.stop * (1 + MIN_STOP_DISTANCE)) return 'near-stop';
    if (price <= zone.high + eps && price >= zone.low - eps) return 'enter';
    // 진입가보다 더 유리하게 내려온 자리 — 손익비가 기준 이상이면 그대로 들어간다.
    if (price < zone.low - eps && target > 0 && rrAtPrice('long', price, plan.stop, target) >= rrFloor) return 'enter';
    return 'wait';
  }
  if (price >= plan.stop) return 'invalidated';
  if (target > 0 && price <= target * (1 + MIN_TARGET_GAP)) return 'target-passed';
  if (price >= plan.stop * (1 - MIN_STOP_DISTANCE)) return 'near-stop';
  if (price >= zone.low - eps && price <= zone.high + eps) return 'enter';
  if (price > zone.high + eps && target > 0 && rrAtPrice('short', price, plan.stop, target) >= rrFloor) return 'enter';
  return 'wait';
}

/** 감시 주기 로그에 남길 한 줄 — 왜 지금 진입하지 않는지(또는 들어가는지) 사용자가 바로 읽게 */
export function planTriggerReason(
  plan: Pick<ArmedPlan, 'side' | 'entry' | 'stop' | 'expiresAt'> & { target?: number },
  price: number,
  now: number,
  minRR: number = MIN_ENTRY_RR,
): string {
  const trigger = planTrigger(plan, price, now, minRR);
  const zone = entryZoneOf(plan);
  const target = Number(plan.target ?? 0);
  const sideKo = plan.side === 'long' ? '롱' : '숏';
  const rrFloor = Math.max(MIN_ENTRY_RR, Number.isFinite(minRR) ? minRR : MIN_ENTRY_RR);
  switch (trigger) {
    case 'enter':
      return `진입 조건 충족 — ${sideKo} 현재가 ${fmtPrice(price)} (진입 구간 ${fmtPrice(zone.low)}~${fmtPrice(zone.high)})`;
    case 'expired':
      return `진입 대기 만료 — 유효시간이 지나 감시에서 제외합니다 (현재가 ${fmtPrice(price)})`;
    case 'invalidated':
      return `셋업 무효 — 현재가 ${fmtPrice(price)} 가 손절가 ${fmtPrice(plan.stop)} 를 먼저 깼습니다`;
    case 'target-passed':
      return `진입 건너뜀 — 현재가 ${fmtPrice(price)} 가 이미 목표가 ${fmtPrice(target)} 에 닿았습니다`;
    case 'near-stop':
      return `진입 건너뜀 — 현재가 ${fmtPrice(price)} 가 손절가 ${fmtPrice(plan.stop)} 에 0.1% 이내로 붙었습니다`;
    case 'wait':
    default: {
      if (!(price > 0)) return '시세를 받지 못해 다음 주기에 다시 확인합니다';
      if (plan.side === 'long') {
        if (price > zone.high) {
          return `진입가 대기 중 — 현재가 ${fmtPrice(price)} 가 진입 상단 ${fmtPrice(zone.high)} 보다 ${(
            ((price - zone.high) / (plan.entry || 1)) * 100
          ).toFixed(2)}% 위(추격 금지)`;
        }
        const rr = target > 0 ? rrAtPrice('long', price, plan.stop, target) : 0;
        return `진입가 대기 중 — 현재가 ${fmtPrice(price)} 는 유리한 자리지만 손익비 ${rr.toFixed(2)}R < 기준 ${rrFloor.toFixed(1)}R`;
      }
      if (price < zone.low) {
        return `진입가 대기 중 — 현재가 ${fmtPrice(price)} 가 진입 하단 ${fmtPrice(zone.low)} 보다 ${(
          ((zone.low - price) / (plan.entry || 1)) * 100
        ).toFixed(2)}% 아래(추격 금지)`;
      }
      const rr = target > 0 ? rrAtPrice('short', price, plan.stop, target) : 0;
      return `진입가 대기 중 — 현재가 ${fmtPrice(price)} 는 유리한 자리지만 손익비 ${rr.toFixed(2)}R < 기준 ${rrFloor.toFixed(1)}R`;
    }
  }
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

/**
 * 💰 50% 반익절 — v1.5.6
 *  · 목표가 진행률 50% 이상 **또는** +1.0R 이상이면 보유 수량의 50%를 시장가로 분할 익절한다.
 *  · 실제 주문은 네이티브(`AutoTradeService`)가 계약 단위로 내림해 넣고, 웹은 같은 규칙으로
 *    포지션 카드에 진행 상태를 보여준다.
 */
export const PARTIAL_TP_PROGRESS = 0.5;
export const PARTIAL_TP_R = 1.0;
export const PARTIAL_TP_SPLIT = 0.5;

export interface PartialTpPosition {
  symbol: string;
  holdSide?: string;
  total: number;
  openPriceAvg: number;
  markPrice?: number;
  presetStopSurplusPrice?: number;
  presetStopLossPrice?: number;
}

export interface PartialTpState {
  /** 반익절 설정이 켜져 있고 방향·가격이 계산 가능한가 */
  applicable: boolean;
  /** 이미 반익절을 마쳤는가(네이티브 기록) */
  done: boolean;
  /** 지금 목표가 50% 또는 +1.0R 에 도달했는가 */
  reached: boolean;
  /** 목표가 진행률(0~1) — 목표가를 모르면 -1 */
  progress: number;
  r: number;
  /** 포지션 카드 배지 문구 */
  label: string;
}

/** 보유 포지션의 반익절 진행 상태 — 웹·네이티브 같은 기준(50% / +1.0R) */
export function partialTpState(
  pos: PartialTpPosition,
  opts: { enabled: boolean; done: boolean },
): PartialTpState {
  const longSide = (pos.holdSide ?? 'long').toLowerCase() !== 'short';
  const entry = Number(pos.openPriceAvg ?? 0);
  const price = Number(pos.markPrice ?? 0);
  const target = Number(pos.presetStopSurplusPrice ?? 0);
  const stop = Number(pos.presetStopLossPrice ?? 0);
  const risk = Math.abs(entry - stop);
  const span = Math.abs((target || 0) - entry);
  const progress = entry > 0 && price > 0 && span > 0 && (longSide ? target > entry : target < entry)
    ? Math.max(0, Math.min(1, (longSide ? price - entry : entry - price) / (longSide ? span : -span)))
    : -1;
  const r = entry > 0 && price > 0 && risk > 0 ? (longSide ? price - entry : entry - price) / risk : 0;
  const applicable = !!opts.enabled && !opts.done && entry > 0 && price > 0 && (risk > 0 || span > 0);
  const reached = applicable && (progress >= PARTIAL_TP_PROGRESS || r >= PARTIAL_TP_R);
  const label = !opts.enabled
    ? '반익절 끔'
    : opts.done
      ? '반익절 50% 완료'
      : !applicable
        ? '반익절 대기'
        : reached
          ? '반익절 조건 도달'
          : progress >= 0
            ? `반익절 ${Math.round(progress * 100)}%`
            : `반익절 ${r.toFixed(2)}R`;
  return { applicable, done: opts.done, reached, progress, r, label };
}

/* ------------------------------------------------------------------ *
 * 상태·로그
 * ------------------------------------------------------------------ */

export type AutoLogLevel = 'fill' | 'reject' | 'block' | 'info' | 'error' | 'exit' | 'partial';

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

/**
 * 실시간 잔고 자동 갱신 주기(v1.5.4) — 자동매매 화면이 열려 있는 동안 12초마다.
 * 10초 미만으로 줄이면 비트겟 계좌·포지션 조회가 겹쳐 429(레이트리밋) 위험이 커진다.
 */
export const LIVE_REFRESH_MS = 12_000;
/**
 * 자동매매 화면을 닫아 두었을 때의 잔고 갱신 주기(v1.5.5).
 * 스캐너 시그널 카드도 계좌 잔고 기준으로 계산하므로 앱이 열려 있는 동안은 계속 읽는다.
 * 60초면 잔고 변동을 충분히 따라가면서 계좌 조회 한도(초당 10회)를 건드리지 않는다.
 */
export const IDLE_REFRESH_MS = 60_000;
/** 네이티브 서비스 스냅숏을 '신선하다'고 보는 시간 — 이보다 오래됐으면 웹이 직접 계좌를 조회한다. */
export const SNAPSHOT_FRESH_MS = 45_000;

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

/* ------------------------------------------------------------------ *
 * 1일 손실 한도 초기화 (v1.5.4)
 * ------------------------------------------------------------------ */

export interface DailyResetPlan {
  ok: boolean;
  dayKey: string;
  /** 초기화 후 오늘의 기준 equity — 잔고를 모르면 null */
  dayStartEquity: number | null;
  reason?: string;
}

/**
 * 손실 한도 초기화 계획 — '지금 잔고'를 오늘의 기준선으로 다시 잡는다.
 * 잔고를 확인하지 못했으면 기준선을 0/null 로 덮어쓰지 않고 초기화를 거부한다(다음 손실 한도가 꺼지는 것 방지).
 */
export function planDailyReset(equity: number | null | undefined, now: number): DailyResetPlan {
  const value = Number(equity ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      dayKey: dayKeyKst(now),
      dayStartEquity: null,
      reason: '잔고를 확인하지 못해 손실 한도를 초기화하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
    };
  }
  return { ok: true, dayKey: dayKeyKst(now), dayStartEquity: round(value, 4) };
}

/**
 * 초기화 적용 — 기준선을 현재 잔고로 바꾸고 오늘 손익을 0%부터 다시 센다.
 * 중복 진입 키(tradedKeys)는 남긴다: 같은 시그널로 두 번 들어가 수량이 겹치는 쪽이 더 위험하다.
 */
export function applyDailyReset(
  runtime: AutoRuntime,
  now: number,
  equity: number | null,
  source: 'native' | 'web' = 'web',
): AutoRuntime {
  const plan = planDailyReset(equity, now);
  if (!plan.ok) return runtime;
  return {
    ...runtime,
    dayKey: plan.dayKey,
    dayStartEquity: plan.dayStartEquity,
    logs: [
      {
        at: now,
        level: 'info' as AutoLogLevel,
        text: `1일 손실 한도 초기화 — 기준 equity ${fmtUsdt(plan.dayStartEquity)} (${
          source === 'native' ? '계좌에서 새로 조회' : '화면 잔고'
        }) · 오늘 손익은 0%부터 다시 셉니다.`,
      },
      ...runtime.logs,
    ].slice(0, LOG_LIMIT),
  };
}

/** 마지막 갱신 표시 — 방금 전 / N초 전 / N분 전 / 시:분:초 */
export function fmtSince(ts: number | null | undefined, now: number): string {
  if (!ts) return '—';
  const diff = now - ts;
  if (!Number.isFinite(diff) || diff < 0) return fmtClock(ts);
  if (diff < 5_000) return '방금 전';
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  return fmtClock(ts);
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

/**
 * 리스크 계산 기준 자본 — **연결된 계좌의 총 자산(equity)뿐**이다(v1.5.5).
 * 사용자가 직접 넣던 '내 시드'는 없어졌다. 계좌가 없으면 0 = 계산 불가.
 */
export function planSeed(accountEquity: number | null | undefined): number {
  const equity = Number(accountEquity ?? 0);
  return Number.isFinite(equity) && equity > 0 ? equity : 0;
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
