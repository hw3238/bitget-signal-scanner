/** 앱 버전과 업데이트 확인 (GitHub Releases 연동) */

export const APP_VERSION = '1.5.8';
export const REPO = 'hw3238/bitget-signal-scanner';
export const PAGES_URL = 'https://hw3238.github.io/bitget-signal-scanner/';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
/** 최신 릴리즈 APK 직접 다운로드 (항상 releases/latest 를 가리킨다) */
export const APK_DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/bitget-crt-scanner.apk`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  apkUrl: string | null;
  htmlUrl: string;
  publishedAt: string;
}

function normalize(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/** a > b 이면 양수, 같으면 0, 작으면 음수 */
export function compareVersions(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function fetchLatestRelease(): Promise<{ status: number; release: ReleaseInfo | null }> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) return { status: res.status, release: null };
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const assets = data.assets ?? [];
    const apk = assets.find((a) => (a.name ?? '').toLowerCase().endsWith('.apk'));
    return {
      status: res.status,
      release: {
        version: String(data.tag_name ?? '').replace(/^v/i, ''),
        tag: String(data.tag_name ?? ''),
        name: String(data.name ?? data.tag_name ?? ''),
        apkUrl: apk?.browser_download_url ?? null,
        htmlUrl: String(data.html_url ?? RELEASES_PAGE),
        publishedAt: String(data.published_at ?? ''),
      },
    };
  } catch {
    return { status: 0, release: null };
  }
}

export interface UpdateCheckResult {
  ok: boolean;
  current: string;
  latest?: string;
  updateAvailable?: boolean;
  apkUrl?: string | null;
  htmlUrl?: string;
  message: string;
}

/** 현재 앱 버전과 최신 릴리즈를 비교한다. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const { status, release } = await fetchLatestRelease();
  if (!release || !release.version) {
    return {
      ok: false,
      current: APP_VERSION,
      message:
        status === 404
          ? '아직 등록된 APK 릴리즈가 없어요. 아래 릴리즈 페이지에서 확인할 수 있습니다.'
          : '최신 릴리즈 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
    };
  }
  const newer = compareVersions(release.version, APP_VERSION) > 0;
  return {
    ok: true,
    current: APP_VERSION,
    latest: release.version,
    updateAvailable: newer,
    apkUrl: release.apkUrl,
    htmlUrl: release.htmlUrl,
    message: newer
      ? `새 버전 v${release.version}이 있어요. 아래 버튼으로 APK를 받아 설치하면 됩니다.`
      : `최신 버전입니다 (v${APP_VERSION}).`,
  };
}

/** 캐시를 비우고 최신 배포본을 다시 불러온다. */
export async function hardReload(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* 캐시 API를 지원하지 않는 환경 */
  }
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      /* service worker 미지원 */
    }
  }
  window.location.replace(`${PAGES_URL}?v=${Date.now()}`);
}
