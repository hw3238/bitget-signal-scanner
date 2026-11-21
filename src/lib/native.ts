import { Capacitor, registerPlugin } from '@capacitor/core';

interface AppShellPlugin {
  saveImage(options: { base64: string; fileName: string }): Promise<{ uri: string }>;
  shareImage(options: { base64: string; fileName: string }): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
  appInfo(): Promise<{ versionName: string; versionCode: number; packageName: string }>;
  /** 알림 권한 현재 상태 (Android 13+ POST_NOTIFICATIONS) */
  notificationPermission(): Promise<{ granted: boolean; supported: boolean }>;
  /** Android 13+ 런타임 알림 권한 요청 */
  requestNotificationPermission(): Promise<{ granted: boolean; supported: boolean }>;
  /** 상단 알림바에 시그널 알림 표시 (탭하면 앱 열림) */
  notifySignal(options: { title: string; body: string; id?: number }): Promise<void>;
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

/** 안드로이드 앱: 갤러리(Pictures/CRT-Scanner)에 PNG 저장 */
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
