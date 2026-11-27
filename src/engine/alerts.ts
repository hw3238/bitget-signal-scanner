/**
 * 🎯 지정가 · 지표 맞춤 알림 — 조건 모델과 판정 규칙 (v1.5.8)
 *
 * 웹 화면과 안드로이드 백그라운드 서비스(AlertMonitorService)가 **같은 조건 정의**를 쓴다.
 *  · 웹: 앱이 열려 있을 때 localStorage 의 조건을 즉시 판정해 알림
 *  · 네이티브: AlertStore 에 같은 JSON 을 넘겨 앱이 꺼져 있어도 60~120초마다 판정
 *
 * 조건은 5종류뿐이다(가격 2 · RSI 2 · 펀딩 1). 값이 조건을 '처음' 통과한 순간 한 번 울리고,
 * 1회성 조건은 발동 완료로 옮긴다(사용자가 '재활성화'를 누르면 다시 감시).
 */

import { isFxSymbol } from './universe';

export type AlertKind = 'price_above' | 'price_below' | 'rsi_over' | 'rsi_under' | 'funding_hot';

export interface AlertKindMeta {
  key: AlertKind;
  label: string;
  /** 입력칸 단위·힌트 */
  unit: 'usd' | 'rsi' | 'percent';
  short: string;
  desc: string;
}

export const ALERT_KINDS: AlertKindMeta[] = [
  {
    key: 'price_above',
    label: '가격 이상',
    unit: 'usd',
    short: '≥',
    desc: '현재가가 목표가 이상으로 오르면 알림',
  },
  {
    key: 'price_below',
    label: '가격 이하',
    unit: 'usd',
    short: '≤',
    desc: '현재가가 목표가 이하로 내려가면 알림',
  },
  {
    key: 'rsi_over',
    label: '1H RSI 과매수',
    unit: 'rsi',
    short: 'RSI ≥',
    desc: '1시간봉 RSI(14)가 기준 이상(기본 70)이면 알림',
  },
  {
    key: 'rsi_under',
    label: '1H RSI 과매도',
    unit: 'rsi',
    short: 'RSI ≤',
    desc: '1시간봉 RSI(14)가 기준 이하(기본 30)이면 알림',
  },
  {
    key: 'funding_hot',
    label: '펀딩비 과열',
    unit: 'percent',
    short: '펀딩 ≥',
    desc: '8시간 펀딩비가 기준(%) 이상이면 알림 (롱 쏠림)',
  },
];

export const ALERT_KIND_MAP: Record<AlertKind, AlertKindMeta> = ALERT_KINDS.reduce(
  (acc, k) => {
    acc[k.key] = k;
    return acc;
  },
  {} as Record<AlertKind, AlertKindMeta>,
);

/** 등록된 맞춤 알림 1건 */
export interface CoinAlert {
  /** symbol|kind|value 순서로 만든 고유 키 — 같은 조건은 하나만 */
  id: string;
  symbol: string;
  kind: AlertKind;
  /** 조건 값 (가격 · RSI · 펀딩 %) */
  value: number;
  createdAt: number;
  /** 발동 시각 — 있으면 '발동 완료' 목록으로 */
  triggeredAt?: number;
  /** 발동 당시 실제 값(가격·RSI·펀딩) */
  triggerActual?: number;
  /** 1회성(기본) — 발동하면 완료. false 면 조건이 풀렸다 다시 차면 또 울린다 */
  oneShot: boolean;
}

/** 알림 조건별 기본값 */
export const ALERT_DEFAULTS: Record<AlertKind, number> = {
  price_above: 0,
  price_below: 0,
  rsi_over: 70,
  rsi_under: 30,
  funding_hot: 0.1,
};

/** 백그라운드 감시 4종 + 마스터 스위치 */
export interface AlertSettings {
  /** 백그라운드 폰 알림 마스터 — 꺼지면 네이티브 서비스도 멈춘다 */
  master: boolean;
  /** 전략 시그널 알림 */
  signal: boolean;
  /** 지정가 · 지표 맞춤 알림 */
  custom: boolean;
  /** 경제지표 발표 알림 */
  macro: boolean;
  /** 코인 뉴스 속보 알림 */
  news: boolean;
  /** 시그널 알림 대상 범위 */
  target: 'top3' | 'majors' | 'all';
  /** 경제지표 몇 분 전에 알릴지 */
  macroLeadMin: number;
  /** 백그라운드 점검 주기(초) — 60~120 (배터리 보호) */
  refreshSec: number;
  /** 매매 알림과 별개로 진동·소리를 낼지 */
  vibrate: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  master: true,
  signal: true,
  custom: true,
  macro: true,
  news: false,
  target: 'majors',
  macroLeadMin: 30,
  refreshSec: 90,
  vibrate: true,
};

export const ALERT_REFRESH_MIN = 60;
export const ALERT_REFRESH_MAX = 120;
export const MACRO_LEAD_MIN = 30;
export const MACRO_LEAD_MAX = 240;

/** 저장값 정리 — 알 수 없는 값·범위 밖은 기본값으로 되돌린다. */
export function normalizeAlertSettings(raw: Partial<AlertSettings> | null | undefined): AlertSettings {
  const src = raw ?? {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const target: AlertSettings['target'] =
    src.target === 'top3' || src.target === 'majors' || src.target === 'all'
      ? src.target
      : DEFAULT_ALERT_SETTINGS.target;
  const lead = Number(src.macroLeadMin);
  const refresh = Number(src.refreshSec);
  return {
    master: bool(src.master, DEFAULT_ALERT_SETTINGS.master),
    signal: bool(src.signal, DEFAULT_ALERT_SETTINGS.signal),
    custom: bool(src.custom, DEFAULT_ALERT_SETTINGS.custom),
    macro: bool(src.macro, DEFAULT_ALERT_SETTINGS.macro),
    news: bool(src.news, DEFAULT_ALERT_SETTINGS.news),
    target,
    // 숫자는 범위 안으로 당겨 넣고(10초 → 60초), 숫자가 아니면 기본값
    macroLeadMin: Number.isFinite(lead)
      ? Math.min(MACRO_LEAD_MAX, Math.max(MACRO_LEAD_MIN, Math.round(lead)))
      : DEFAULT_ALERT_SETTINGS.macroLeadMin,
    refreshSec: Number.isFinite(refresh)
      ? Math.min(ALERT_REFRESH_MAX, Math.max(ALERT_REFRESH_MIN, Math.round(refresh)))
      : DEFAULT_ALERT_SETTINGS.refreshSec,
    vibrate: bool(src.vibrate, DEFAULT_ALERT_SETTINGS.vibrate),
  };
}

/** 켜진 감시가 하나라도 있는가 — 네이티브 서비스를 띄울지 결정 */
export function anyAlertOn(s: AlertSettings): boolean {
  return s.master && (s.signal || s.custom || s.macro || s.news);
}

/** 서비스가 지금 실제로 감시해야 하는 항목(마스터 반영) — 화면 배지·서비스 상태 표기용 */
export function activeChannels(s: AlertSettings): { signal: boolean; custom: boolean; macro: boolean; news: boolean } {
  return {
    signal: s.master && s.signal,
    custom: s.master && s.custom,
    macro: s.master && s.macro,
    news: s.master && s.news,
  };
}

/* ------------------------------------------------------------------ *
 * 조건 판정
 * ------------------------------------------------------------------ */

export interface AlertQuote {
  /** 현재가(USDT) */
  price?: number;
  /** 1H RSI(14) */
  rsi?: number;
  /** 8시간 펀딩비(%) — 0.01 = 0.01% */
  fundingPct?: number;
}

export interface AlertEvaluation {
  /** 조건을 통과했는가 */
  hit: boolean;
  /** 판정에 쓴 실제 값 */
  actual: number | null;
  /** 판정할 자료가 없었는가(휴장·API 실패) */
  missing: boolean;
}

/** 조건 1건 판정 — 값이 없으면 missing(발동 아님). */
export function evaluateAlert(alert: Pick<CoinAlert, 'kind' | 'value'>, quote: AlertQuote): AlertEvaluation {
  const value = Number(alert.value);
  if (!Number.isFinite(value)) return { hit: false, actual: null, missing: true };
  switch (alert.kind) {
    case 'price_above': {
      const price = Number(quote.price);
      if (!Number.isFinite(price) || price <= 0) return { hit: false, actual: null, missing: true };
      return { hit: price >= value, actual: price, missing: false };
    }
    case 'price_below': {
      const price = Number(quote.price);
      if (!Number.isFinite(price) || price <= 0) return { hit: false, actual: null, missing: true };
      return { hit: price <= value, actual: price, missing: false };
    }
    case 'rsi_over': {
      const rsi = Number(quote.rsi);
      if (!Number.isFinite(rsi)) return { hit: false, actual: null, missing: true };
      return { hit: rsi >= value, actual: rsi, missing: false };
    }
    case 'rsi_under': {
      const rsi = Number(quote.rsi);
      if (!Number.isFinite(rsi)) return { hit: false, actual: null, missing: true };
      return { hit: rsi <= value, actual: rsi, missing: false };
    }
    case 'funding_hot': {
      const f = Number(quote.fundingPct);
      if (!Number.isFinite(f)) return { hit: false, actual: null, missing: true };
      return { hit: f >= value, actual: f, missing: false };
    }
    default:
      return { hit: false, actual: null, missing: true };
  }
}

/** 코인 이름 — BTCUSDT → BTC */
export function alertBase(symbol: string): string {
  return symbol.replace(/USDT$/, '').replace(/STOCK$/, '');
}

/** 알림 조건 문구 — 'BTC 가격 ≥ $95,000' */
export function alertConditionText(alert: Pick<CoinAlert, 'symbol' | 'kind' | 'value'>): string {
  const base = alertBase(alert.symbol);
  const meta = ALERT_KIND_MAP[alert.kind];
  switch (alert.kind) {
    case 'price_above':
      return `${base} 가격 ≥ ${fmtUsd(alert.value)}`;
    case 'price_below':
      return `${base} 가격 ≤ ${fmtUsd(alert.value)}`;
    case 'rsi_over':
      return `${base} 1H RSI ≥ ${fmtNum(alert.value, 0)} (과매수)`;
    case 'rsi_under':
      return `${base} 1H RSI ≤ ${fmtNum(alert.value, 0)} (과매도)`;
    case 'funding_hot':
      return `${base} 펀딩비 ≥ ${fmtNum(alert.value, 3)}% (롱 과열)`;
    default:
      return `${base} ${meta?.label ?? ''}`;
  }
}

/** 만든 알림의 고유 id — 같은 종목·조건·값은 하나로 합친다 */
export function alertId(symbol: string, kind: AlertKind, value: number): string {
  return `${symbol}|${kind}|${normalizeValue(kind, value)}`;
}

function normalizeValue(kind: AlertKind, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (kind === 'rsi_over' || kind === 'rsi_under') return Math.round(value);
  if (kind === 'funding_hot') return Math.round(value * 10000) / 10000;
  return Math.round(value * 1e8) / 1e8;
}

export interface AlertInputResult {
  ok: boolean;
  alert?: CoinAlert;
  error?: string;
}

/**
 * 입력값 검증 → 알림 1건.
 *  · 가격: 0보다 커야 하고, 현재가의 1/10 ~ 10배 안에서만 받는다(오타로 영원히 안 울리는 조건 방지).
 *  · RSI: 1~99 · 펀딩: 0.001~1%
 */
export function parseAlertInput(
  symbol: string,
  kind: AlertKind,
  raw: string | number,
  opts: { now?: number; price?: number; oneShot?: boolean } = {},
): AlertInputResult {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return { ok: false, error: '코인을 선택하세요.' };
  if (isFxSymbol(sym)) return { ok: false, error: '코인 종목만 지정할 수 있습니다.' };
  const text = String(raw).replace(/[,₩$\s]/g, '');
  const value = Number(text);
  if (!text || !Number.isFinite(value)) return { ok: false, error: '목표값을 숫자로 입력하세요.' };

  if (kind === 'price_above' || kind === 'price_below') {
    if (value <= 0) return { ok: false, error: '가격은 0보다 커야 합니다.' };
    const price = Number(opts.price);
    if (Number.isFinite(price) && price > 0) {
      if (value > price * 10) return { ok: false, error: '현재가의 10배를 넘는 값입니다. 가격을 확인하세요.' };
      if (value < price / 10) return { ok: false, error: '현재가의 1/10보다 낮은 값입니다. 가격을 확인하세요.' };
    }
    if (kind === 'price_above' && Number.isFinite(price) && price > 0 && value <= price) {
      return { ok: false, error: '이미 현재가보다 낮습니다. "가격 이하"를 쓰거나 값을 올리세요.' };
    }
    if (kind === 'price_below' && Number.isFinite(price) && price > 0 && value >= price) {
      return { ok: false, error: '이미 현재가보다 높습니다. "가격 이상"을 쓰거나 값을 내리세요.' };
    }
  }
  if (kind === 'rsi_over' || kind === 'rsi_under') {
    if (value < 1 || value > 99) return { ok: false, error: 'RSI 기준은 1~99 사이입니다.' };
  }
  if (kind === 'funding_hot') {
    if (value <= 0 || value > 1) return { ok: false, error: '펀딩비 기준은 0.001~1% 사이입니다.' };
  }

  const norm = normalizeValue(kind, value);
  return {
    ok: true,
    alert: {
      id: alertId(sym, kind, norm),
      symbol: sym,
      kind,
      value: norm,
      createdAt: opts.now ?? Date.now(),
      oneShot: opts.oneShot ?? true,
    },
  };
}

/** 목록에 추가 — 같은 id 는 새로 만들지 않고 기존 조건을 되살린다 */
export function addAlert(list: CoinAlert[], alert: CoinAlert): { list: CoinAlert[]; added: boolean } {
  const idx = list.findIndex((a) => a.id === alert.id);
  if (idx < 0) return { list: [alert, ...list].slice(0, 60), added: true };
  const next = list.slice();
  next[idx] = { ...list[idx], triggeredAt: undefined, triggerActual: undefined, createdAt: alert.createdAt };
  return { list: next, added: false };
}

/** 발동 완료 → 감시 중으로 되돌린다 */
export function reactivateAlert(list: CoinAlert[], id: string, now = Date.now()): CoinAlert[] {
  return list.map((a) => (a.id === id ? { ...a, triggeredAt: undefined, triggerActual: undefined, createdAt: now } : a));
}

/** 발동 처리 — 1회성이면 완료로, 반복형이면 발동 시각만 남긴다. */
export function markTriggered(list: CoinAlert[], id: string, actual: number, now = Date.now()): CoinAlert[] {
  return list.map((a) =>
    a.id === id ? { ...a, triggeredAt: now, triggerActual: actual } : a,
  );
}

export function activeAlerts(list: CoinAlert[]): CoinAlert[] {
  return list.filter((a) => !a.triggeredAt);
}

export function triggeredAlerts(list: CoinAlert[]): CoinAlert[] {
  return list.filter((a) => !!a.triggeredAt).sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));
}

/** 알림 문구 — 제목에 종목·조건, 본문에 실제 값과 행동 힌트 */
export function buildAlertMessage(alert: CoinAlert, actual: number | null): { title: string; body: string } {
  const base = alertBase(alert.symbol);
  const now = actual ?? alert.value;
  switch (alert.kind) {
    case 'price_above':
      return {
        title: `🎯 ${base} ${fmtUsd(alert.value)} 도달`,
        body: `현재가 ${fmtUsd(now)} — 지정가 알림이 발동했습니다 · COTA`,
      };
    case 'price_below':
      return {
        title: `🎯 ${base} ${fmtUsd(alert.value)} 이탈`,
        body: `현재가 ${fmtUsd(now)} — 지정가 알림이 발동했습니다 · COTA`,
      };
    case 'rsi_over':
      return {
        title: `📈 ${base} 1H RSI ${fmtNum(now, 1)} 과매수`,
        body: `기준 ${fmtNum(alert.value, 0)} 이상 — 단기 과열 구간입니다 · COTA`,
      };
    case 'rsi_under':
      return {
        title: `📉 ${base} 1H RSI ${fmtNum(now, 1)} 과매도`,
        body: `기준 ${fmtNum(alert.value, 0)} 이하 — 단기 침체 구간입니다 · COTA`,
      };
    case 'funding_hot':
      return {
        title: `🔥 ${base} 펀딩비 ${fmtNum(now, 3)}% 과열`,
        body: `기준 ${fmtNum(alert.value, 3)}% 이상 — 롱 쏠림, 숏 청산 위험 구간 · COTA`,
      };
    default:
      return { title: `🎯 ${base} 알림`, body: alertConditionText(alert) };
  }
}

/* ------------------------------------------------------------------ *
 * 표기 도우미
 * ------------------------------------------------------------------ */

export function fmtNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** 가격 표기 — 값 크기에 따라 소수 자리를 줄인다($95,000 · $0.4231) */
export function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 조건 비율 — 목표가까지 몇 % 남았는지 */
export function distancePct(value: number, price: number | undefined): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(Number(price)) || Number(price) <= 0) return null;
  return ((value - Number(price)) / Number(price)) * 100;
}
