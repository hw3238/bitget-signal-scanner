/**
 * 시그널 핸드폰 알림.
 *
 * - 안드로이드 앱(Capacitor): AppShell 플러그인의 네이티브 알림(알림바 + 소리/진동, 탭하면 앱 열림)
 * - 웹 브라우저: Notification API 폴백
 * - 선택: ntfy.sh 토픽으로도 동시 전송
 *
 * 같은 시그널(symbol|tf|side|detectedAt)은 localStorage에 기록해 60초 자동 갱신마다 중복으로
 * 울리지 않게 하고, 앱을 켠 뒤 첫 스캔에 이미 떠 있던 시그널은 알림 없이 '이미 본 것'으로 기록한다.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Signal } from '../engine/types';
import { MAJOR_COINS, PRIORITY_COINS } from '../engine/universe';
import { fmtPrice, sideLabel, tfLabel } from './format';
import {
  isNativeApp,
  nativeNotificationPermission,
  requestNativeNotificationPermission,
  showNativeNotification,
} from './native';
import type { Settings } from './storage';

/** 알림 대상 범위 — 코인 중심 3택 */
export type NotifyTarget = 'top3' | 'majors' | 'all';

export const NOTIFY_TARGETS: { key: NotifyTarget; label: string; desc: string }[] = [
  { key: 'top3', label: '비트·이더·솔', desc: 'BTC · ETH · SOL 세 종목만 알립니다' },
  { key: 'majors', label: '주요 코인', desc: '비트·이더·솔을 포함한 주요 코인 20종목' },
  { key: 'all', label: '전체 종목', desc: '코인과 주식선물 전 종목' },
];

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export const NOTIFIED_KEY = 'bgss.notified.v1';
const NOTIFIED_MAX = 600;
/** 한 번의 갱신에서 한꺼번에 너무 많이 울리지 않도록 실제 알림은 최근 N건만 */
const MAX_ALERTS_PER_BATCH = 3;

export interface NotifyMessage {
  title: string;
  body: string;
}

/* ------------------------------------------------------------------ *
 * 순수 로직 — 중복 방지 · 대상 필터 · 메시지 만들기
 * ------------------------------------------------------------------ */

/** 중복 판정 키: symbol|tf|side|detectedAt */
export function signalKey(signal: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>): string {
  return `${signal.symbol}|${signal.tf}|${signal.side}|${signal.detectedAt}`;
}

/** 알림에 쓰는 종목 이름 — 카드와 같은 표기(BTC · ETH …) */
export function notifyLabel(signal: Pick<Signal, 'symbol' | 'base'>): string {
  return signal.base.replace(/STOCK$/, '');
}

/** 알림 대상 범위에 들어가는 시그널인지 (진행중 시그널만) */
export function matchesNotifyTarget(
  signal: Pick<Signal, 'symbol' | 'asset' | 'state'>,
  target: NotifyTarget,
): boolean {
  if (signal.state !== 'open') return false;
  // FX는 스캔·알림 대상에서 제외 — 앱은 코인·주식선물만 다룬다.
  if (signal.asset === 'fx') return false;
  if (target === 'all') return true;
  if (target === 'top3') return (PRIORITY_COINS as readonly string[]).includes(signal.symbol);
  return (MAJOR_COINS as readonly string[]).includes(signal.symbol);
}

/** 아직 알림을 보내지 않은 새 시그널만 — 오래된 감지 순으로 정렬 */
export function pickNewSignals(
  signals: Signal[],
  seen: ReadonlySet<string>,
  target: NotifyTarget,
): Signal[] {
  const out: Signal[] = [];
  const batch = new Set<string>();
  for (const signal of signals) {
    if (!matchesNotifyTarget(signal, target)) continue;
    const key = signalKey(signal);
    if (seen.has(key) || batch.has(key)) continue;
    batch.add(key);
    out.push(signal);
  }
  return out.sort((a, b) => a.detectedAt - b.detectedAt);
}

/** 실제 알림 문구 — 한글 라벨(진입가·목표가·손절가) */
export function buildSignalMessage(signal: Signal, options: { test?: boolean } = {}): NotifyMessage {
  const name = notifyLabel(signal);
  const title = `${options.test ? '[테스트] ' : ''}${name} ${tfLabel(signal.tf)} ${sideLabel(signal.side)} 시그널`;
  const body = `진입가 ${fmtPrice(signal.entry, signal.decimals)} · 목표가 ${fmtPrice(
    signal.target,
    signal.decimals,
  )} · 손절가 ${fmtPrice(signal.stop, signal.decimals)} · ${signal.winRateBasis === 'bench' ? '전수' : '최근'} 승률 ${Math.round(signal.winRate)}%`;
  return { title, body };
}

/** 테스트 알림 — 실제 코인 시그널이 있으면 그 값으로, 없으면 안내 문구로 */
export function buildTestMessage(signal?: Signal | null): NotifyMessage {
  if (signal) {
    const msg = buildSignalMessage(signal, { test: true });
    return { title: `${msg.title} 감지`, body: msg.body };
  }
  return {
    title: '[테스트] COTA 시그널 알림 감지',
    body: '이 알림이 폰 상단에 뜨면 정상입니다 · COTA 실시간 시그널',
  };
}

/* ------------------------------------------------------------------ *
 * 기록(localStorage)
 * ------------------------------------------------------------------ */

export function loadNotified(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function saveNotified(keys: Iterable<string>): void {
  try {
    const list = [...keys];
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(list.slice(-NOTIFIED_MAX)));
  } catch {
    /* 저장할 수 없는 환경 */
  }
}

/* ------------------------------------------------------------------ *
 * 권한 · 전송
 * ------------------------------------------------------------------ */

export async function notificationPermission(): Promise<NotifyPermission> {
  if (isNativeApp()) {
    const status = await nativeNotificationPermission();
    if (!status.supported) return 'unsupported';
    return status.granted ? 'granted' : 'default';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/** 사용자 동작(토글·테스트 버튼) 안에서 호출해야 브라우저가 권한 창을 띄운다. */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (isNativeApp()) {
    const status = await requestNativeNotificationPermission();
    if (!status.supported) return 'unsupported';
    return status.granted ? 'granted' : 'denied';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result as NotifyPermission;
  } catch {
    return 'denied';
  }
}

/** 32비트 안정 해시 — 안드로이드 알림 id(같은 시그널은 같은 id로 교체) */
export function hashId(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100000 + 1;
}

/** 핸드폰 알림 1건 전송 — 네이티브 알림바, 없으면 브라우저 Notification */
export async function showPhoneNotification(msg: NotifyMessage, key?: string): Promise<boolean> {
  if (isNativeApp()) {
    try {
      await showNativeNotification(msg.title, msg.body, hashId(key ?? `${msg.title}|${Date.now()}`));
      return true;
    } catch {
      /* 네이티브 알림 실패 → 웹 폴백 시도 */
    }
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(msg.title, { body: msg.body, tag: key });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** ntfy 토픽 입력값 → 게시 URL (토픽 이름만 넣으면 ntfy.sh) */
export function ntfyEndpoint(topic: string): string | null {
  const value = topic.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://ntfy.sh/${encodeURIComponent(value)}`;
}

/** 선택형 ntfy 외부 푸시 — 비어 있으면 호출하지 않는다. */
export async function sendNtfy(msg: NotifyMessage, topic: string): Promise<boolean> {
  const endpoint = ntfyEndpoint(topic);
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    // ntfy 알림 제목에도 앱 브랜드를 붙인다.
    url.searchParams.set('title', `[COTA] ${msg.title}`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      body: msg.body,
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 앱에서 쓰는 훅
 * ------------------------------------------------------------------ */

interface NotifyHookInput {
  /** 현재 스캔 시그널 */
  signals: Signal[];
  /** 첫 스캔이 끝났는지 (state.passes > 0) */
  ready: boolean;
  settings: Settings;
}

/**
 * 새 시그널 감지 → 핸드폰 알림.
 * 첫 스캔 결과는 기준선으로만 기록하고, 그 뒤로 새로 감지된 시그널부터 알림을 보낸다.
 */
export function useSignalNotifications({ signals, ready, settings }: NotifyHookInput) {
  const baseline = useRef(false);
  const seen = useRef<Set<string>>(new Set(loadNotified()));
  const askedPermission = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 앱 첫 실행: 알림이 켜져 있으면 Android 13+ 런타임 권한을 한 번 요청한다.
  useEffect(() => {
    if (askedPermission.current) return;
    askedPermission.current = true;
    if (!settingsRef.current.notifyEnabled) return;
    if (!isNativeApp()) return; // 브라우저는 사용자 동작(테스트 버튼)에서만 권한을 요청한다.
    void requestNotificationPermission();
  }, []);

  // 기준선: 첫 스캔에서 이미 떠 있던 시그널은 알림 없이 '본 것'으로 기록
  useEffect(() => {
    if (!ready || baseline.current) return;
    baseline.current = true;
    for (const signal of signals) {
      if (signal.state === 'open') seen.current.add(signalKey(signal));
    }
    saveNotified(seen.current);
  }, [ready, signals]);

  // 이후 새로 감지된 시그널만 알림
  useEffect(() => {
    if (!ready || !baseline.current) return;
    const current = settingsRef.current;
    if (!current.notifyEnabled) return;
    const fresh = pickNewSignals(signals, seen.current, current.notifyTarget);
    if (!fresh.length) return;

    for (const signal of fresh) seen.current.add(signalKey(signal));
    saveNotified(seen.current);

    const toAlert = fresh.slice(-MAX_ALERTS_PER_BATCH);
    for (const signal of toAlert) {
      const msg = buildSignalMessage(signal);
      void showPhoneNotification(msg, signalKey(signal));
      if (current.notifyNtfy.trim()) void sendNtfy(msg, current.notifyNtfy);
    }
  }, [signals, ready]);

  /** 설정 화면에서 직접 쓰는 테스트 전송 */
  const sendTest = useCallback(async (signal?: Signal | null) => {
    const current = settingsRef.current;
    const msg = buildTestMessage(signal);
    const permission = await requestNotificationPermission();
    const shown = await showPhoneNotification(msg, `test-${Date.now()}`);
    const ntfy = current.notifyNtfy.trim() ? await sendNtfy(msg, current.notifyNtfy) : false;
    return { permission, shown, ntfy };
  }, []);

  return { sendTest };
}
