/**
 * 인앱 APK 업데이트 검증 — Capacitor 네이티브 브리지를 모킹해
 * 1) 새 버전(v1.9.0) 배너 → '바로 업데이트' 클릭
 * 2) apkProgress 이벤트(0→100%)가 화면에 반영되는지
 * 3) 완료 후 "설치 화면을 열었습니다" 안내
 * 4) 설치 권한이 없을 때 설정 안내 + '다시 시도'
 * 를 헤드리스 Chromium에서 확인한다. (실기기 설치 자체는 여기서 재현 불가)
 *
 * 실행: node scripts/inapp-update-check.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4183;
const URL = `http://127.0.0.1:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(URL);
    if (r.ok) break;
  } catch {}
  await sleep(300);
}

const NATIVE_MOCK = (allowInstall) => {
  window.androidBridge = { postMessage: () => {} };
  const listeners = {};
  window.__apkLog = [];
  const methods = [
    'saveImage',
    'shareImage',
    'openExternal',
    'openBitgetFutures',
    'appInfo',
    'notificationPermission',
    'requestNotificationPermission',
    'notifySignal',
    'canInstallPackages',
    'openInstallPermissionSettings',
    'downloadAndInstallApk',
  ].map((name) => ({ name, rtype: 'promise' }));
  methods.push({ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' });

  const emit = (event, data) => {
    const cb = listeners[event];
    if (typeof cb === 'function') cb(data);
  };

  const handlers = {
    canInstallPackages: async () => ({ allowed: window.__allowInstall }),
    openInstallPermissionSettings: async () => {
      window.__apkLog.push('openInstallPermissionSettings');
      return { opened: true };
    },
    appInfo: async () => ({ versionName: '1.4.0', versionCode: 5, packageName: 'com.hw3238.bitgetscanner' }),
    notificationPermission: async () => ({ granted: true, supported: true }),
    downloadAndInstallApk: async (options) => {
      window.__apkLog.push(`download ${options?.url}`);
      for (const pct of [12, 38, 64, 92, 100]) {
        await new Promise((r) => setTimeout(r, 220));
        emit('apkProgress', { progress: pct, bytes: pct * 59713, total: 5971341 });
      }
      window.__apkLog.push('install-intent');
      return { started: true, needsPermission: false, bytes: 5971341, path: '/cache/apk-update/bitget-crt-scanner.apk' };
    },
  };

  window.Capacitor = {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
    PluginHeaders: [{ name: 'AppShell', methods }],
    nativePromise: (plugin, method, options) => {
      window.__apkLog.push(`call ${plugin}.${method}`);
      const fn = handlers[method];
      if (!fn) return Promise.resolve({});
      try {
        return Promise.resolve(fn(options));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    nativeCallback: (plugin, method, options, cb) => {
      if (method === 'addListener') {
        listeners[options?.eventName] = cb;
        cb('cb-1');
        return Promise.resolve('cb-1');
      }
      if (method === 'removeListener') {
        delete listeners[options?.eventName];
        return Promise.resolve();
      }
      return Promise.resolve();
    },
  };
  window.__allowInstall = allowInstall;
};

const RELEASE = {
  tag_name: 'v1.9.0',
  name: 'COTA v1.9.0',
  html_url: 'https://github.com/hw3238/bitget-signal-scanner/releases/tag/v1.9.0',
  published_at: new Date().toISOString(),
  assets: [
    {
      name: 'bitget-crt-scanner.apk',
      browser_download_url:
        'https://github.com/hw3238/bitget-signal-scanner/releases/download/v1.9.0/bitget-crt-scanner.apk',
    },
  ],
};

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: `/workspace/.deps/root/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH ?? ''}` },
});

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function scenario(allowInstall) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([allow]) => {
    localStorage.setItem('cota.profile.v1', JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }));
  }, [allowInstall]);
  await ctx.addInitScript(`(${NATIVE_MOCK.toString()})(${allowInstall});`);
  await ctx.route('**/api.github.com/repos/**/releases/latest', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RELEASE) }),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

/* ---------- 1) 권한 허용 상태: 진행률 → 설치 화면 ---------- */
{
  const { ctx, page, errors } = await scenario(true);
  const banner = await page.evaluate(() => ({
    visible: !!document.querySelector('.update-banner.app-wide'),
    text: document.querySelector('.update-banner.app-wide')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    button: document.querySelector('.update-banner.app-wide .update-banner-btn')?.textContent?.trim() ?? '',
  }));
  check(banner.visible, '상단 새 버전 배너 표시', banner.text.slice(0, 60));
  check(/바로 업데이트 \(v1\.9\.0\)/.test(banner.button), '배너 버튼 = 바로 업데이트 (v1.9.0)', banner.button);

  await page.locator('.update-banner.app-wide .update-banner-btn').click();
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const txt = await page.evaluate(
      () => document.querySelector('.update-banner.app-wide .update-banner-text')?.textContent?.replace(/\s+/g, ' ') ?? '',
    );
    const m = txt.match(/(\d+)%/);
    if (m) seen.add(Number(m[1]));
    if (/설치 화면을 열었습니다/.test(txt)) break;
    await page.waitForTimeout(80);
  }
  const finalText = await page.evaluate(
    () => document.querySelector('.update-banner.app-wide .update-banner-text')?.textContent?.replace(/\s+/g, ' ') ?? '',
  );
  const log = await page.evaluate(() => window.__apkLog);
  check(seen.size >= 2, '다운로드 진행률(%) 화면 반영', [...seen].join('% → ') + '%');
  check(/설치 화면을 열었습니다/.test(finalText), '완료 안내 = 설치 화면을 열었습니다', finalText.slice(0, 60));
  check(log.some((l) => l.startsWith('download https://github.com/')), 'APK URL로 다운로드 요청', log.find((l) => l.startsWith('download')) ?? '');
  check(log.includes('install-intent'), '다운로드 후 설치 인텐트 실행');
  check(errors.length === 0, '콘솔/페이지 에러 0건', errors.slice(0, 2).join(' | '));
  await page.locator('.update-banner.app-wide .update-banner-text').screenshot({ path: 'docs/screens/43-inapp-update.png' }).catch(() => {});
  await ctx.close();
}

/* ---------- 2) 설치 권한 없음: 설정 안내 ---------- */
{
  const { ctx, page, errors } = await scenario(false);
  await page.locator('.update-banner.app-wide .update-banner-btn').click();
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    text: document.querySelector('.update-banner.app-wide .update-banner-text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    log: window.__apkLog,
  }));
  check(/앱 설치 허용/.test(state.text), '권한 없음 → 설정 안내 문구', state.text.slice(0, 60));
  check(state.log.includes('openInstallPermissionSettings'), '설정 화면 열기 호출');
  check(!state.log.some((l) => l.startsWith('download')), '권한 없을 때 다운로드는 시작하지 않음');
  check(errors.length === 0, '권한 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ---------- 3) 설정 탭 인앱 업데이트 카드 ---------- */
{
  const { ctx, page, errors } = await scenario(true);
  await page.locator('button[data-tab="settings"]').first().click().catch(async () => {
    await page.locator('.bottom-nav button', { hasText: '설정' }).first().click();
  });
  await page.waitForTimeout(900);
  const settings = await page.evaluate(() => ({
    version: /COTA · 앱 v1\.4\.0/.test(document.body.innerText),
    updateBtn: [...document.querySelectorAll('button')].some((b) => /바로 업데이트 \(v1\.9\.0\)/.test(b.textContent ?? '')),
    hardReload: [...document.querySelectorAll('button')].some((b) => /웹 화면 즉시 새로고침/.test(b.textContent ?? '')),
  }));
  check(settings.version, '설정 탭 현재 버전 v1.4.0');
  check(settings.updateBtn, '설정 탭 인앱 업데이트 버튼');
  check(settings.hardReload, '설정 탭 웹 화면 즉시 새로고침 버튼');
  check(errors.length === 0, '설정 시나리오 콘솔 에러 0건', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
try {
  process.kill(-server.pid);
} catch {}
console.log(failures ? `\n❌ 인앱 업데이트 검증 실패 ${failures}건` : '\n✅ 인앱 업데이트 검증 통과');
process.exitCode = failures ? 1 : 0;
