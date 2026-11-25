import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PlaceOrderParams } from './autotrade';

interface AppShellPlugin {
  saveImage(options: { base64: string; fileName: string }): Promise<{ uri: string }>;
  shareImage(options: { base64: string; fileName: string }): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
  /** 비트겟 선물 화면을 비트겟 안드로이드 앱으로 바로 연다 */
  openBitgetFutures(options: { symbol: string; url: string }): Promise<{ via: string; installed?: boolean }>;
  appInfo(): Promise<{ versionName: string; versionCode: number; packageName: string }>;
  /** 알림 권한 현재 상태 (Android 13+ POST_NOTIFICATIONS) */
  notificationPermission(): Promise<{ granted: boolean; supported: boolean }>;
  /** Android 13+ 런타임 알림 권한 요청 */
  requestNotificationPermission(): Promise<{ granted: boolean; supported: boolean }>;
  /** 상단 알림바에 시그널 알림 표시 (탭하면 앱 열림) */
  notifySignal(options: { title: string; body: string; id?: number }): Promise<void>;
  /** Android 8.0+ '출처를 알 수 없는 앱 설치' 허용 여부 */
  canInstallPackages(): Promise<{ allowed: boolean; sdk?: number }>;
  /** 설치 허용 설정 화면으로 이동 */
  openInstallPermissionSettings(): Promise<{ opened: boolean }>;
  /** APK를 앱 캐시에 받아 설치 화면을 연다 */
  downloadAndInstallApk(options: { url: string; fileName?: string }): Promise<ApkInstallResult>;
  /** 네이티브 → 웹 진행률 이벤트 */
  addListener(
    eventName: 'apkProgress',
    listener: (data: ApkProgress) => void,
  ): Promise<{ remove: () => Promise<void> }>;

  /* ---------------- 🤖 비트겟 자동매매 (v1.5.0+) ---------------- */
  /** API Key·Secret·Passphrase를 앱 전용 저장소(SharedPreferences)에 저장 — JS로 원문이 돌아오지 않는다 */
  bitgetSaveKeys(options: { apiKey: string; secret: string; passphrase: string; demo: boolean }): Promise<BitgetKeyState>;
  bitgetHasKeys(): Promise<BitgetKeyState>;
  bitgetClearKeys(): Promise<BitgetKeyState>;
  /** 키 유효성 + USDT 잔고 */
  bitgetTestConnection(): Promise<BitgetAccount>;
  bitgetGetPositions(): Promise<BitgetPositionsResult>;
  bitgetPlaceOrder(options: PlaceOrderParams & { leverage: number; holdMode?: string }): Promise<BitgetOrderResult>;
  /** 보유 포지션 시장가 청산 — posSide/reduceOnly 규칙은 네이티브가 계좌 모드에 맞춰 고른다 */
  bitgetClosePosition(options: {
    symbol: string;
    holdSide: string;
    size: string;
    holdMode?: string;
    clientOid?: string;
  }): Promise<BitgetOrderResult>;
  /** 24시간 포그라운드 감시 서비스 */
  autoTradeStart(options: { config: string; plans: string; exitSignals?: string }): Promise<AutoTradeNativeStatus>;
  autoTradeStop(): Promise<AutoTradeNativeStatus>;
  /** 웹 엔진의 최신 설정·감시 목록·반대 시그널을 서비스에 넘긴다 */
  autoTradeSync(options: { config: string; plans: string; exitSignals?: string }): Promise<AutoTradeNativeStatus>;
  autoTradeStatus(): Promise<AutoTradeNativeStatus>;
  /** 1일 손실 한도 초기화 — 지금 잔고를 다시 조회해 오늘 기준선으로 잡고 잠금을 푼다(v1.5.4) */
  autoTradeResetDailyLimit(): Promise<AutoTradeNativeStatus & { ok: boolean; dayStartEquity?: number }>;
  addListener(
    eventName: 'autoTradeEvent',
    listener: (data: AutoTradeNativeStatus) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface ApkProgress {
  /** 0~100 */
  progress: number;
  bytes?: number;
  total?: number;
}

export interface ApkInstallResult {
  started: boolean;
  needsPermission?: boolean;
  bytes?: number;
  path?: string;
}

/* ------------------------------------------------------------------ *
 * 🤖 비트겟 자동매매 브리지 타입
 * ------------------------------------------------------------------ */

export interface BitgetKeyState {
  hasKeys: boolean;
  demo: boolean;
  /** 예: bg_9f3k••••••2c7d — 원문은 절대 JS로 오지 않는다 */
  apiKeyMasked?: string;
  /** Secret 저장 여부 — 원문은 절대 JS로 오지 않는다 */
  secretSet?: boolean;
  /** Passphrase 저장 여부 — 저장했는데 화면이 '—' 로 보이던 문제(v1.5.1)의 판정 값 */
  passphraseSet?: boolean;
  /** 판별된 비트겟 계정 종류 — "uta"(통합 v3) / "classic"(클래식 v2) / "unknown" */
  accountMode?: string;
  savedAt?: number;
}

export interface BitgetAccount {
  ok: boolean;
  demo?: boolean;
  /** USDT 자산(equity) */
  equity?: number;
  available?: number;
  unrealizedPL?: number;
  /** 포지션 모드: one_way_mode / hedge_mode */
  posMode?: string;
  /** 오늘의 손실 기준 equity — 네이티브가 저장한 값(v1.5.4) */
  dayStartEquity?: number;
  /** 기준선 날짜(KST YYYY-MM-DD) */
  dayKey?: string;
  /** 비트겟 계정 종류 — "uta"(통합계정, v3) / "classic"(클래식, v2) / "unknown" */
  accountMode?: string;
  error?: string;
  code?: string;
}

export interface BitgetPosition {
  symbol: string;
  holdSide: 'long' | 'short' | string;
  total: number;
  openPriceAvg: number;
  markPrice: number;
  unrealizedPL: number;
  leverage: number;
  marginSize: number;
  liquidationPrice: number;
  presetStopSurplusPrice?: number;
  presetStopLossPrice?: number;
  ctime: number;
}

export interface BitgetPositionsResult {
  ok: boolean;
  positions: BitgetPosition[];
  error?: string;
  code?: string;
}

export interface BitgetOrderResult {
  ok: boolean;
  orderId?: string;
  clientOid?: string;
  /** 서버가 돌려준 주문 파라미터(디버그용) */
  tradeSide?: string;
  /** 한글 설명(error)과 원문(거래소 영문 메시지) — 원문은 표기에만 쓴다(v1.5.5) */
  error?: string;
  raw?: string;
  code?: string;
  /** 실패 전에 네이티브가 스스로 했던 보정(한글) — 로그에 그대로 남긴다 */
  recovery?: string[];
}

export interface AutoTradeNativeStatus {
  running: boolean;
  /** 서비스가 살아 있는가(포그라운드 알림 표시 중) */
  service?: boolean;
  mode?: 'demo' | 'live';
  armed?: number;
  openPositions?: number;
  equity?: number | null;
  /** 가용 잔고 — 서비스가 주기마다 저장한 최신 값(v1.5.4) */
  available?: number | null;
  /** 미실현 손익 — 서비스가 주기마다 저장한 최신 값(v1.5.4) */
  unrealizedPL?: number | null;
  dailyPnl?: number | null;
  /** 오늘의 손실 기준 equity — 웹이 이 값으로 기준선을 맞춘다(v1.5.4) */
  dayStartEquity?: number | null;
  /** 기준선 날짜(KST YYYY-MM-DD) */
  dayKey?: string;
  dailyLocked?: boolean;
  lastTickAt?: number;
  /** 50% 반익절을 이미 마친 포지션 키(`SYMBOL|side`) — v1.5.6 */
  partialTpDone?: string[];
  /** 1일 손실 한도로 서비스가 스스로 꺼졌는지 — 웹 설정도 같이 꺼야 배지가 맞는다 */
  enabled?: boolean;
  log?: { at: number; level: string; text: string }[];
  error?: string;
}

const AppShell = registerPlugin<AppShellPlugin>('AppShell');

export const isNativeApp = () => Capacitor.isNativePlatform();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('이미지를 읽을 수 없습니다'));
    reader.readAsDataURL(blob);
  });
}

/** 안드로이드 앱: 갤러리(Pictures/COTA)에 PNG 저장 */
export async function saveImageToDevice(blob: Blob, fileName: string): Promise<void> {
  const base64 = await blobToDataUrl(blob);
  await AppShell.saveImage({ base64, fileName });
}

/** 안드로이드 앱: 공유 시트로 PNG 전달 */
export async function shareImageFromDevice(blob: Blob, fileName: string): Promise<void> {
  const base64 = await blobToDataUrl(blob);
  await AppShell.shareImage({ base64, fileName });
}

/** 안드로이드 앱: 외부 링크를 시스템 브라우저로 열기(APK 다운로드 등) */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    await AppShell.openExternal({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** 비트겟 선물 화면 열기 — 앱(안드로이드 APK)에서는 비트겟 앱으로, 웹에서는 새 탭으로.
 *  네이티브 경로: 앱 링크 → 커스텀 딥링크 → 비트겟 앱 실행 → (앱이 없을 때만) 브라우저 */
export async function openBitgetFutures(symbol: string, url: string): Promise<string> {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener');
    return 'web';
  }
  try {
    const res = await AppShell.openBitgetFutures({ symbol, url });
    return res?.via ?? 'browser';
  } catch {
    await AppShell.openExternal({ url });
    return 'browser';
  }
}

/** 안드로이드 앱: 알림 권한 상태 */
export async function nativeNotificationPermission(): Promise<{ granted: boolean; supported: boolean }> {
  if (!isNativeApp()) return { granted: false, supported: false };
  try {
    return await AppShell.notificationPermission();
  } catch {
    return { granted: false, supported: false };
  }
}

/** 안드로이드 앱: Android 13+ 런타임 알림 권한 요청 */
export async function requestNativeNotificationPermission(): Promise<{ granted: boolean; supported: boolean }> {
  if (!isNativeApp()) return { granted: false, supported: false };
  try {
    return await AppShell.requestNotificationPermission();
  } catch {
    return { granted: false, supported: false };
  }
}

/** 안드로이드 앱: 네이티브 알림바에 시그널 알림 표시 */
export async function showNativeNotification(title: string, body: string, id: number): Promise<void> {
  await AppShell.notifySignal({ title, body, id });
}

/** 안드로이드 앱: 설치된 APK 버전 */
export async function nativeAppInfo(): Promise<{ versionName: string; versionCode: number } | null> {
  if (!isNativeApp()) return null;
  try {
    const info = await AppShell.appInfo();
    return { versionName: info.versionName, versionCode: info.versionCode };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 앱 안에서 바로 업데이트 (v1.4.0+)
 * ------------------------------------------------------------------ */

/** Android 8.0+ 에서 패키지 설치 허용 여부. 웹에서는 false. */
export async function canInstallApk(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const res = await AppShell.canInstallPackages();
    return !!res?.allowed;
  } catch {
    return false;
  }
}

/** '출처를 알 수 없는 앱 설치' 허용 설정 화면 열기 */
export async function openInstallPermissionSettings(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await AppShell.openInstallPermissionSettings();
  } catch {
    /* 설정 화면을 열 수 없는 기기 */
  }
}

/**
 * 앱 안에서 APK 다운로드 → 설치 화면.
 * 진행률(0~100%)은 onProgress 로 흘려보낸다. 설치 권한이 없으면 needsPermission=true 로 돌아온다.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (pct: number) => void,
): Promise<ApkInstallResult> {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener');
    return { started: false };
  }
  let handle: { remove: () => Promise<void> } | null = null;
  if (onProgress) {
    try {
      handle = await AppShell.addListener('apkProgress', (data) => {
        if (typeof data?.progress === 'number') onProgress(Math.max(0, Math.min(100, data.progress)));
      });
    } catch {
      handle = null;
    }
  }
  try {
    return await AppShell.downloadAndInstallApk({ url, fileName: 'bitget-crt-scanner.apk' });
  } finally {
    if (handle) void handle.remove();
  }
}

/* ------------------------------------------------------------------ *
 * 🤖 비트겟 자동매매 (v1.5.0+)
 *
 *  Private API 서명·주문은 **안드로이드 네이티브**에서만 일어난다.
 *  웹은 명령과 결과(마스킹·잔고·포지션·로그)만 주고받고, Secret은 웹뷰로 내려오지 않는다.
 *  브라우저(웹 배포본)에서는 모든 함수가 `supported:false`로 끝나고, 화면은 모의 시뮬레이션으로 동작한다.
 * ------------------------------------------------------------------ */

export interface AutoTradeBridgeInfo {
  supported: boolean;
}

/** 자동매매 브리지 사용 가능 여부 — 앱(APK)에서만 true */
export function autoTradeSupported(): boolean {
  return isNativeApp();
}

export interface SaveKeysResult extends BitgetKeyState {
  supported: boolean;
  error?: string;
}

export async function bitgetSaveKeys(input: {
  apiKey: string;
  secret: string;
  passphrase: string;
  demo: boolean;
}): Promise<SaveKeysResult> {
  if (!isNativeApp()) return { supported: false, hasKeys: false, demo: input.demo };
  try {
    const res = await AppShell.bitgetSaveKeys(input);
    return { supported: true, ...res };
  } catch (e) {
    return { supported: true, hasKeys: false, demo: input.demo, error: errText(e) };
  }
}

/**
 * 이 설치본(APK)에 자동매매 브리지가 있는지 — v1.4.0 이하 앱은 메서드가 없어 호출이 거절된다.
 * (웹은 항상 최신이지만, 앱은 사용자가 업데이트해야 네이티브 기능이 생긴다)
 */
export async function bitgetBridgeAvailable(): Promise<boolean> {
  if (!isNativeApp()) return true;
  try {
    await AppShell.bitgetHasKeys();
    return true;
  } catch {
    return false;
  }
}

export async function bitgetKeyState(): Promise<BitgetKeyState & { supported: boolean }> {
  if (!isNativeApp()) return { supported: false, hasKeys: false, demo: true };
  try {
    return { supported: true, ...(await AppShell.bitgetHasKeys()) };
  } catch {
    return { supported: true, hasKeys: false, demo: true };
  }
}

export async function bitgetClearKeys(): Promise<BitgetKeyState & { supported: boolean }> {
  if (!isNativeApp()) return { supported: false, hasKeys: false, demo: true };
  try {
    return { supported: true, ...(await AppShell.bitgetClearKeys()) };
  } catch {
    return { supported: true, hasKeys: false, demo: true };
  }
}

export async function bitgetTestConnection(): Promise<BitgetAccount | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.bitgetTestConnection();
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

export async function bitgetPositions(): Promise<BitgetPositionsResult> {
  if (!isNativeApp()) return { ok: false, positions: [], error: '앱에서만 조회할 수 있습니다' };
  try {
    return await AppShell.bitgetGetPositions();
  } catch (e) {
    return { ok: false, positions: [], error: errText(e) };
  }
}

export async function bitgetPlaceOrder(
  params: PlaceOrderParams & { leverage: number; holdMode?: string },
): Promise<BitgetOrderResult> {
  if (!isNativeApp()) {
    return { ok: false, error: '브라우저에서는 실제 주문을 넣을 수 없습니다 (모의 시뮬레이션만)' };
  }
  try {
    return await AppShell.bitgetPlaceOrder(params);
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

export async function bitgetClosePosition(input: {
  symbol: string;
  holdSide: string;
  size: string;
  holdMode?: string;
  clientOid?: string;
}): Promise<BitgetOrderResult> {
  if (!isNativeApp()) {
    return { ok: false, error: '브라우저에서는 포지션을 청산할 수 없습니다 (앱에서만 가능)' };
  }
  try {
    return await AppShell.bitgetClosePosition(input);
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

export async function autoTradeStart(
  config: unknown,
  plans: unknown,
  exitSignals: unknown = [],
): Promise<AutoTradeNativeStatus | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.autoTradeStart({
      config: JSON.stringify(config),
      plans: JSON.stringify(plans),
      exitSignals: JSON.stringify(exitSignals),
    });
  } catch (e) {
    return { running: false, error: errText(e) };
  }
}

export async function autoTradeStop(): Promise<AutoTradeNativeStatus | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.autoTradeStop();
  } catch (e) {
    return { running: false, error: errText(e) };
  }
}

export async function autoTradeSync(
  config: unknown,
  plans: unknown,
  exitSignals: unknown = [],
): Promise<AutoTradeNativeStatus | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.autoTradeSync({
      config: JSON.stringify(config),
      plans: JSON.stringify(plans),
      exitSignals: JSON.stringify(exitSignals),
    });
  } catch (e) {
    return { running: false, error: errText(e) };
  }
}

export async function autoTradeStatus(): Promise<AutoTradeNativeStatus | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.autoTradeStatus();
  } catch {
    return null;
  }
}

/** 1일 손실 한도 초기화 — 네이티브가 계좌를 새로 조회해 기준선을 다시 잡는다(웹에서 잔고를 넘기지 않는다). */
export async function autoTradeResetDailyLimit(): Promise<
  (AutoTradeNativeStatus & { ok: boolean; dayStartEquity?: number; stale?: boolean }) | null
> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.autoTradeResetDailyLimit();
  } catch (e) {
    return { running: false, ok: false, error: errText(e) };
  }
}

export async function onAutoTradeEvent(
  listener: (state: AutoTradeNativeStatus) => void,
): Promise<{ remove: () => Promise<void> } | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.addListener('autoTradeEvent', listener);
  } catch {
    return null;
  }
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message ?? e);
  return String(e);
}
