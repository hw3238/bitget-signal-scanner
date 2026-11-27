/**
 * 🔔 알림 센터 저장소 · 네이티브 동기화 · 앱이 열려 있을 때의 감시 (v1.5.8)
 *
 *  · 조건·설정은 localStorage(`cota.alerts.*`)에 남기고, 바뀔 때마다 안드로이드
 *    `AppShell.alertsSync` 로 넘겨 **앱이 꺼져 있어도** AlertMonitorService 가 이어서 감시한다.
 *  · 앱이 열려 있으면 웹이 같은 조건을 직접 판정해 즉시 알린다(네이티브가 없는 웹 배포본 포함).
 *  · 경제지표 알림은 이벤트 목록을 통째로 네이티브에 넘겨 두어, 앱을 다시 열지 않아도
 *    30분 전 알림이 나간다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, Ticker } from '../engine/types';
import { rsi } from '../engine/indicators';
import {
  activeAlerts,
  anyAlertOn,
  buildAlertMessage,
  DEFAULT_ALERT_SETTINGS,
  evaluateAlert,
  markTriggered,
  normalizeAlertSettings,
  type AlertQuote,
  type AlertSettings,
  type CoinAlert,
} from '../engine/alerts';
import { buildMacroMessage, dueMacroAlerts, MACRO_EVENTS } from '../engine/macroCalendar';
import { fetchFundingRates } from '../api/publicMarket';
import { fetchMarketCandles } from '../api/market';
import { fetchNewsFeed, mergeNews, NEWS_SOURCES, type NewsItem } from '../api/cryptoNews';
import { isNativeApp, showNativeNotification } from './native';
import type { Exchange } from './exchange';

const ALERTS_KEY = 'cota.alerts.v1';
const SETTINGS_KEY = 'cota.alertSettings.v1';
const MACRO_FIRED_KEY = 'cota.alerts.macroFired.v1';
const NEWS_SEEN_KEY = 'cota.alerts.newsSeen.v1';
const MUTED_KEY = 'cota.alerts.macroMuted.v1';
const ALERTS_LIMIT = 60;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장할 수 없는 환경 */
  }
}

export function loadCoinAlerts(): CoinAlert[] {
  const rows = readJson<CoinAlert[]>(ALERTS_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (a) =>
      !!a &&
      typeof a.id === 'string' &&
      typeof a.symbol === 'string' &&
      typeof a.kind === 'string' &&
      Number.isFinite(Number(a.value)),
  );
}

export function saveCoinAlerts(list: CoinAlert[]): void {
  writeJson(ALERTS_KEY, list.slice(0, ALERTS_LIMIT));
}

export function loadAlertSettings(): AlertSettings {
  return normalizeAlertSettings(readJson<Partial<AlertSettings>>(SETTINGS_KEY, {}));
}

export function saveAlertSettings(s: AlertSettings): void {
  writeJson(SETTINGS_KEY, s);
}

function loadFired(): string[] {
  const rows = readJson<string[]>(MACRO_FIRED_KEY, []);
  return Array.isArray(rows) ? rows.filter((v) => typeof v === 'string').slice(-80) : [];
}

function saveFired(ids: Iterable<string>): void {
  writeJson(MACRO_FIRED_KEY, [...ids].slice(-80));
}

function loadNewsSeen(): string[] {
  const rows = readJson<string[]>(NEWS_SEEN_KEY, []);
  return Array.isArray(rows) ? rows.filter((v) => typeof v === 'string').slice(-200) : [];
}

function saveNewsSeen(ids: Iterable<string>): void {
  writeJson(NEWS_SEEN_KEY, [...ids].slice(-200));
}

/** 지표별 알림 끔 목록 — 카드의 🔔/🔕 */
export function loadMacroMuted(): string[] {
  const rows = readJson<string[]>(MUTED_KEY, []);
  return Array.isArray(rows) ? rows.filter((v) => typeof v === 'string').slice(-60) : [];
}

export function saveMacroMuted(ids: string[]): void {
  writeJson(MUTED_KEY, ids.slice(-60));
}

/* ------------------------------------------------------------------ *
 * 네이티브 동기화 payload
 * ------------------------------------------------------------------ */

export interface NativeAlertsPayload {
  /** 맞춤 알림 JSON (CoinAlert[]) */
  alerts: string;
  /** 설정 JSON (AlertSettings) */
  settings: string;
  /** 경제지표 JSON — {id, at(ms), stars, title, body} */
  macro: string;
  /** 시그널 감시 범위 · 주기 (서비스가 읽는다) */
  target: string;
  refreshSec: number;
  master: boolean;
}

/** 서비스가 바로 쓰는 경제지표 이벤트 — 문구는 웹이 만든 그대로 넘긴다 */
export interface NativeMacroEvent {
  id: string;
  at: number;
  stars: number;
  title: string;
  body: string;
}

export function macroEventsForNative(now = Date.now(), muted: string[] = []): NativeMacroEvent[] {
  const skip = new Set(muted);
  return MACRO_EVENTS.filter((e) => Date.parse(e.at) > now - 3600_000 && !skip.has(e.id))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((e) => {
      const msg = buildMacroMessage(e);
      return { id: e.id, at: Date.parse(e.at), stars: e.stars, title: msg.title, body: msg.body };
    });
}

export function buildNativePayload(
  alerts: CoinAlert[],
  settings: AlertSettings,
  now = Date.now(),
  muted: string[] = [],
): NativeAlertsPayload {
  const active = alerts.filter((a) => !a.triggeredAt);
  return {
    alerts: JSON.stringify(
      active.map((a) => ({
        id: a.id,
        symbol: a.symbol,
        kind: a.kind,
        value: a.value,
        oneShot: a.oneShot,
        // 등록 시각 — '다시 감시'로 재등록하면 값이 바뀌어 같은 조건도 다시 알린다
        nonce: a.createdAt,
      })),
    ),
    settings: JSON.stringify(settings),
    macro: JSON.stringify(macroEventsForNative(now, muted)),
    target: settings.target,
    refreshSec: settings.refreshSec,
    master: settings.master,
  };
}

/** 네이티브 서비스에 조건·설정·지표 일정을 넘긴다 (웹에서는 조용히 무시) */
export async function syncAlertsToNative(
  alerts: CoinAlert[],
  settings: AlertSettings,
  muted: string[] = [],
): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { AppShellAlertsSync } = await import('./native');
    await AppShellAlertsSync(buildNativePayload(alerts, settings, Date.now(), muted));
  } catch {
    /* 구버전 APK — 웹 감시만 동작한다 */
  }
}

/** 네이티브 서비스 상태 — 구버전 APK 면 null */
export async function nativeAlertStatus(): Promise<{
  running: boolean;
  lastCheckAt?: number;
  checked?: number;
  sent?: number;
  error?: string;
  supported?: boolean;
} | null> {
  if (!isNativeApp()) return null;
  try {
    const { AppShellAlertStatus } = await import('./native');
    return await AppShellAlertStatus();
  } catch {
    return null;
  }
}

/** 테스트 폰 알림 — 네이티브면 4개 채널 모두 확인 가능한 문구로 */
export async function sendTestPhoneAlert(kind: 'signal' | 'custom' | 'macro' | 'news' = 'custom'): Promise<boolean> {
  const messages = {
    signal: {
      title: '[테스트] BTC 1H 롱 시그널',
      body: '진입가 $61,200 · 목표가 $62,400 · 손절가 $60,600 — 백그라운드 알림이 정상입니다 · COTA',
    },
    custom: { title: '🎯 [테스트] BTC $95,000 도달', body: '지정가 알림이 폰 상단에 뜨면 정상입니다 · COTA' },
    macro: { title: '📊 [테스트] 12/04(금) 22:30 NFP 발표', body: '예상 ▲ +90K · 상회→숏 유리 / 하회→롱 유리 · COTA' },
    news: { title: '📰 [테스트] ETF 순유입 전환', body: '호재 · 비트코인 현물 ETF에 3일 만에 순유입 · COTA' },
  } as const;
  const msg = messages[kind];
  try {
    await showNativeNotification(msg.title, msg.body, (Date.now() % 100000) + 1);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 앱이 열려 있을 때의 감시 (웹 폴백 — 네이티브가 있으면 서비스가 본다)
 * ------------------------------------------------------------------ */

interface AlertCenterInput {
  exchange: Exchange;
  /** 스캐너가 들고 있는 티커 — 있으면 가격 API 를 다시 부르지 않는다 */
  tickers: Ticker[];
  /** 로그인 후에만 감시(회원 전용 게이트와 같은 규칙) */
  enabled: boolean;
}

/** RSI 계산용 1H 캔들 캐시 — 같은 종목을 60초마다 다시 받지 않는다 */
const CANDLE_TTL = 3 * 60_000;

export function useAlertCenter({ exchange, tickers, enabled }: AlertCenterInput) {
  const [alerts, setAlerts] = useState<CoinAlert[]>(() => loadCoinAlerts());
  const [settings, setSettings] = useState<AlertSettings>(() => loadAlertSettings());
  const [macroMuted, setMacroMuted] = useState<string[]>(() => loadMacroMuted());
  const [lastCheckAt, setLastCheckAt] = useState<number>(0);
  const [lastFired, setLastFired] = useState<string>('');
  const alertRef = useRef(alerts);
  const settingsRef = useRef(settings);
  const mutedRef = useRef(macroMuted);
  alertRef.current = alerts;
  settingsRef.current = settings;
  mutedRef.current = macroMuted;

  const candleCache = useRef<Map<string, { at: number; rsi: number }>>(new Map());
  const firedMacro = useRef<Set<string>>(new Set(loadFired()));
  const newsSeen = useRef<Set<string>>(new Set(loadNewsSeen()));
  const newsBaseline = useRef(false);
  const firing = useRef(false);

  /* ---- 저장 + 네이티브 동기화 ---- */
  useEffect(() => {
    saveCoinAlerts(alerts);
  }, [alerts]);
  // 앱을 열 때 한 번 — 지난 세션의 조건·설정을 네이티브 서비스에 다시 넘긴다(서비스가 새로 살아났을 수 있다)
  useEffect(() => {
    void syncAlertsToNative(alertRef.current, settingsRef.current, mutedRef.current);
  }, []);
  useEffect(() => {
    saveAlertSettings(settings);
    void syncAlertsToNative(alertRef.current, settings, mutedRef.current);
  }, [settings]);

  /** 지표별 알림 끄기/켜기 — 네이티브 목록에서도 빼고 다시 넘긴다 */
  const toggleMacroMute = useCallback((id: string) => {
    setMacroMuted((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveMacroMuted(next);
      mutedRef.current = next;
      void syncAlertsToNative(alertRef.current, settingsRef.current, next);
      return next;
    });
  }, []);

  /** 조건 추가/삭제/발동 — 저장과 네이티브 동기화를 한 번에 */
  const commit = useCallback((next: CoinAlert[]) => {
    setAlerts(next);
    saveCoinAlerts(next);
    void syncAlertsToNative(next, settingsRef.current, mutedRef.current);
  }, []);

  const patchSettings = useCallback((patch: Partial<AlertSettings>) => {
    setSettings((prev) => {
      const next = normalizeAlertSettings({ ...prev, ...patch });
      saveAlertSettings(next);
      void syncAlertsToNative(alertRef.current, next, mutedRef.current);
      return next;
    });
  }, []);

  const tickerPrice = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tickers) {
      const price = Number(t.last);
      if (Number.isFinite(price) && price > 0) map.set(t.symbol, price);
    }
    return map;
  }, [tickers]);

  /** 조건별 현재 값 모으기 — 가격은 티커, RSI 는 1H 캔들, 펀딩은 공개 API */
  const collectQuotes = useCallback(
    async (list: CoinAlert[]): Promise<Map<string, AlertQuote>> => {
      const out = new Map<string, AlertQuote>();
      const need = (symbol: string) => {
        const q = out.get(symbol) ?? {};
        out.set(symbol, q);
        return q;
      };
      for (const a of list) need(a.symbol);
      // 가격 — 티커에 없으면 비트겟 공개 티커에서 찾는다
      for (const [symbol, q] of out) {
        const fromState = tickerPrice.get(symbol);
        if (Number.isFinite(fromState) && (fromState as number) > 0) q.price = fromState;
      }
      const missingPrice = [...out.entries()].filter(([, q]) => !q.price).map(([s]) => s);
      if (missingPrice.length) {
        try {
          const res = await import('../api/market').then((m) => m.fetchMarketTickers(exchange, missingPrice));
          for (const t of res.tickers) {
            const q = out.get(t.symbol);
            if (q && Number.isFinite(t.last) && t.last > 0) q.price = t.last;
          }
        } catch {
          /* 가격을 못 받으면 그 조건은 이번 주기 건너뛴다 */
        }
      }
      // RSI — 1H 60봉
      const rsiSymbols = [...new Set(list.filter((a) => a.kind === 'rsi_over' || a.kind === 'rsi_under').map((a) => a.symbol))];
      await Promise.all(
        rsiSymbols.map(async (symbol) => {
          const cached = candleCache.current.get(symbol);
          if (cached && Date.now() - cached.at < CANDLE_TTL) {
            const q = out.get(symbol);
            if (q) q.rsi = cached.rsi;
            return;
          }
          try {
            const candles: Candle[] = await fetchMarketCandles(exchange, symbol, '1H', 60);
            const closes = candles.map((c) => c.c);
            const series = rsi(closes, 14);
            const value = series[series.length - 2] ?? series[series.length - 1];
            if (Number.isFinite(value)) {
              candleCache.current.set(symbol, { at: Date.now(), rsi: value });
              const q = out.get(symbol);
              if (q) q.rsi = value;
            }
          } catch {
            /* 캔들 실패 — 다음 주기 */
          }
        }),
      );
      // 펀딩비 — 비트겟 공개 API (8시간 기준 %)
      if (list.some((a) => a.kind === 'funding_hot')) {
        try {
          const funding = await fetchFundingRates();
          for (const a of list) {
            if (a.kind !== 'funding_hot') continue;
            const info = funding.get(a.symbol);
            const q = out.get(a.symbol);
            if (q && info && Number.isFinite(info.rate)) q.fundingPct = info.rate;
          }
        } catch {
          /* 펀딩 실패 — 다음 주기 */
        }
      }
      return out;
    },
    [exchange, tickerPrice],
  );

  /** 한 주기 판정 — 맞춤 알림 */
  const runCustomCheck = useCallback(async () => {
    if (!enabled || firing.current) return;
    const s = settingsRef.current;
    if (!s.master || !s.custom) return;
    const list = activeAlerts(alertRef.current);
    if (!list.length) return;
    firing.current = true;
    try {
      const quotes = await collectQuotes(list);
      const fire: Array<{ alert: CoinAlert; actual: number | null }> = [];
      for (const a of list) {
        const q = quotes.get(a.symbol);
        if (!q) continue;
        const res = evaluateAlert(a, q);
        if (!res.hit) continue;
        fire.push({ alert: a, actual: res.actual });
        const msg = buildAlertMessage(a, res.actual);
        try {
          await showNativeNotification(msg.title, msg.body, hash(a.id));
        } catch {
          /* 네이티브 알림 실패 */
        }
      }
      if (fire.length) {
        // 1회성만 '발동 완료' 로 옮긴다 — 반복형은 감시 목록에 그대로 둔다
        let next = alertRef.current;
        for (const f of fire) {
          if (f.alert.oneShot) next = markTriggered(next, f.alert.id, f.actual ?? f.alert.value);
        }
        if (next !== alertRef.current) commit(next);
        setLastFired(buildAlertMessage(fire[0].alert, fire[0].actual).title);
      }
      setLastCheckAt(Date.now());
    } finally {
      firing.current = false;
    }
  }, [collectQuotes, commit, enabled]);

  /** 한 주기 판정 — 경제지표 30분 전 */
  const runMacroCheck = useCallback(async () => {
    if (!enabled) return;
    const s = settingsRef.current;
    if (!s.master || !s.macro) return;
    const due = dueMacroAlerts(Date.now(), s.macroLeadMin, firedMacro.current).filter(
      (e) => !mutedRef.current.includes(e.id),
    );
    if (!due.length) return;
    for (const event of due) {
      firedMacro.current.add(event.id);
      const msg = buildMacroMessage(event);
      try {
        await showNativeNotification(msg.title, msg.body, hash(`macro|${event.id}`));
      } catch {
        /* 알림 실패 */
      }
    }
    saveFired(firedMacro.current);
    setLastFired(buildMacroMessage(due[0]).title);
  }, [enabled]);

  /** 한 주기 판정 — 코인 뉴스 속보(호재·악재만) */
  const runNewsCheck = useCallback(async () => {
    if (!enabled) return;
    const s = settingsRef.current;
    if (!s.master || !s.news) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const sources = NEWS_SOURCES.filter((src) => src.id === 'blockmedia' || src.id === 'cointelegraph');
    const results = await Promise.all(sources.map((src) => fetchNewsFeed(src, 15)));
    const items: NewsItem[] = mergeNews(...results.filter((r) => r.ok).map((r) => r.items));
    const toneItems = items.filter((i) => i.tone !== 'neutral');
    if (!newsBaseline.current) {
      // 첫 확인은 기준선 — 지금 있는 기사를 모두 '본 것'으로 기록(앱 켤 때 폭탄 알림 방지)
      newsBaseline.current = true;
      for (const i of toneItems) newsSeen.current.add(i.id);
      saveNewsSeen(newsSeen.current);
      return;
    }
    const fresh = toneItems.filter((i) => !newsSeen.current.has(i.id)).slice(-3);
    for (const item of fresh) {
      newsSeen.current.add(item.id);
      const tone = item.tone === 'good' ? '🟢 호재' : '🔴 악재';
      const title = `📰 ${tone} · ${item.source}`;
      const body = `${item.title}${item.coins.length ? ` (${item.coins.slice(0, 3).join('·')})` : ''}`;
      try {
        await showNativeNotification(title, body.slice(0, 180), hash(`news|${item.id}`));
      } catch {
        /* 알림 실패 */
      }
    }
    if (fresh.length) {
      saveNewsSeen(newsSeen.current);
      setLastFired(fresh[fresh.length - 1].title);
    }
  }, [enabled]);

  // 주기 실행 — 앱이 보이는 동안만(가격·지표), 뉴스는 4분 간격
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void runCustomCheck();
      void runMacroCheck();
    };
    void tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, runCustomCheck, runMacroCheck]);

  useEffect(() => {
    if (!enabled) return;
    if (!settings.master || !settings.news) return;
    void runNewsCheck();
    const timer = window.setInterval(() => void runNewsCheck(), 4 * 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, settings.master, settings.news, runNewsCheck]);

  const active = useMemo(() => activeAlerts(alerts), [alerts]);
  return {
    alerts,
    active,
    settings,
    patchSettings,
    commit,
    macroMuted,
    toggleMacroMute,
    lastCheckAt,
    lastFired,
    anyOn: anyAlertOn(settings),
    /** 지금 켜진 감시 항목 */
    channels: {
      signal: settings.master && settings.signal,
      custom: settings.master && settings.custom,
      macro: settings.master && settings.macro,
      news: settings.master && settings.news,
    },
  };
}

/** 32비트 해시 — 알림 id */
export function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (Math.abs(h) % 100000) + 1;
}

export const ALERT_STORAGE_KEYS = { ALERTS_KEY, SETTINGS_KEY, MACRO_FIRED_KEY, NEWS_SEEN_KEY, MUTED_KEY };
export { DEFAULT_ALERT_SETTINGS };
