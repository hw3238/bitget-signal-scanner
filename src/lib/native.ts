import { Capacitor, registerPlugin } from '@capacitor/core';

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
