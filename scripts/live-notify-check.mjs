/**
 * 라이브 Pages 검증 — 🔔 핸드폰 알림 (v1.1.0)
 *   - 배포본이 새 번들(index-*.js)과 설정 탭 🔔 핸드폰 알림 섹션을 실제로 내려주는지
 *   - 앱 버전 v1.1.0 표기 · 업데이트 확인이 최신(v1.1.0)으로 응답하는지
 *   - 알림 토글 기본 ON, 알림 대상 기본 주력 3종목, ntfy 기본 토픽
 *   - 라이브 시그널 렌더링 · 콘솔/페이지 에러 0건 · 17-live-settings-notify.png 저장
 *
 * 실행: LD_LIBRARY_PATH=... node scripts/live-notify-check.mjs
 */
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens/17-live-settings-notify.png';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
});
// 첫 실행 온보딩을 건너뛰도록 프로필을 미리 저장한다.
await context.addInitScript(() => {
  localStorage.setItem(
    'cota.profile.v1',
    JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }),
  );
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
await page.waitForFunction(
  () => {
    const btn = document.querySelector('.rescan');
    return !!btn && !btn.classList.contains('busy');
  },
  { timeout: 180000 },
);
await page.waitForTimeout(1500);

const cards = await page.locator('.signal-card:not(.skeleton)').count();
check(cards > 0, '라이브 시그널 렌더링', `${cards}건`);

await page.locator('.bottom-nav button[data-tab="settings"]').click();
await page.waitForSelector('#settings-notify', { timeout: 30000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const panel = document.querySelector('#settings-notify');
  return {
    panels: [...document.querySelectorAll('.settings-tab .panel')].map((p) =>
      p.querySelector('h3')?.textContent?.trim(),
    ),
    heading: panel.querySelector('h3')?.textContent?.trim(),
    switchOn: panel.querySelector('.switch')?.classList.contains('on'),
    target: panel.querySelector('.notify-target button.on')?.textContent?.trim(),
    targets: [...panel.querySelectorAll('.notify-target button')].map((b) => b.textContent?.trim()),
    ntfy: panel.querySelector('.td-key-input')?.value,
    version: [...document.querySelectorAll('.setting-desc')]
      .map((d) => d.textContent)
      .find((t) => t?.includes('앱 v')),
    update: document.querySelector('.update-status')?.textContent?.trim(),
    scripts: [...document.querySelectorAll('script')].map((s) => s.src.split('/').pop()),
  };
});

check(info.heading === '🔔 핸드폰 알림', '설정 탭 🔔 핸드폰 알림 섹션', info.heading);
check(info.switchOn === true, '알림 토글 기본 ON');
check(
  info.targets?.length === 3 && info.target === '주요 코인',
  '알림 대상 3개 · 기본 주요 코인',
  info.targets?.join(' / '),
);
check(info.ntfy === 'bgss-hw3238-9f4k2m', 'ntfy 기본 전용 토픽', info.ntfy);
check(/앱 v1\.5\.5/.test(info.version || ''), '앱 버전 표기 v1.5.5', info.version);
check((info.update ?? '').includes('최신 버전입니다 (v1.5.5)'), '업데이트 확인 = 최신 v1.5.5', info.update);

await page.evaluate(() => {
  const panel = document.querySelector('#settings-notify');
  window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 60);
});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT });

check(errors.filter((e) => !/429/.test(e)).length === 0, '콘솔·페이지 에러 0건 (429 레이트리밋 제외)', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? `\n✅ 라이브 알림 UI 검증 통과 (${OUT})` : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
