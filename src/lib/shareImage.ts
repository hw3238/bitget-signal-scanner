import { isNativeApp, saveImageToDevice, shareImageFromDevice } from './native';

/** 캔버스 → PNG Blob (오염된 캔버스는 null) */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/** PNG 저장 — 앱(WebView)이면 갤러리, 웹이면 다운로드 */
export async function saveCanvasPng(canvas: HTMLCanvasElement, fileName: string): Promise<boolean> {
  const blob = await canvasToBlob(canvas);
  if (!blob) return false;
  if (isNativeApp()) {
    try {
      await saveImageToDevice(blob, fileName);
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** 공유 시트 — 지원하지 않는 브라우저는 저장으로 대체 */
export async function shareCanvasPng(canvas: HTMLCanvasElement, fileName: string, title: string): Promise<boolean> {
  const blob = await canvasToBlob(canvas);
  if (!blob) return false;
  if (isNativeApp()) {
    try {
      await shareImageFromDevice(blob, fileName);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const file = new File([blob], fileName, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return true;
    }
  } catch {
    /* 공유 취소 */
  }
  return saveCanvasPng(canvas, fileName);
}
