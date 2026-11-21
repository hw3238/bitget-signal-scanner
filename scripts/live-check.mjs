/**
 * 라이브 Pages 검증 — COTA (v1.3.0)
 *   - 배포본이 새 번들·COTA 브랜드·5탭 코인 스캐너를 실제로 내려주는지
 *   - 첫 실행 온보딩(프로필 없음) → 저장 → 메인 진입
 *   - 카드 한글 라벨·천단위 콤마·COTA 추천 배지·시드 예상 손익
 *   - 공유 카드 모달 · 즐겨찾기 · 콘솔/페이지 에러 0건
 *
 * 실행: node scripts/live-check.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';

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
await context.addInitScript(() => {
  window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));

const res = await page.goto(URL, { waitUntil: 'domcontentloaded' });
check(res?.status() === 200, '라이브 페이지 응답', `HTTP ${res?.status()}`);

await page.waitForSelector('.onboarding', { timeout: 30000 });
const onb = await page.evaluate(() => ({
  presets: [...document.querySelectorAll('.seed-chip')].map((b) => clean(b.textContent)),
  styles: [...document.querySelectorAll('.style-card b')].map((b) => clean(b.textContent)),
  title: clean(document.querySelector('.onboarding h2')?.textContent),
}));
check(onb.presets.join('|') === '$100|$500|$1,000|$5,000', '라이브 온보딩 시드 프리셋', onb.presets.join(' '));
check(onb.styles.join('|') === '보수적 매매|공격적 매매', '라이브 온보딩 매매 성향 2택', onb.styles.join(' / '));

// $1,000 · 보수적으로 시작
await page.locator('.seed-chip', { hasText: '$1,000' }).click();
await page.locator('.onb-start').click();
await page.waitForSelector('.onboarding', { state: 'detached', timeout: 15000 });
await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
await page.waitForFunction(
  () => {
    const b = document.querySelector('.rescan');
    return !!b && !b.classList.contains('busy');
  },
  { timeout: 180000 },
);
await page.waitForTimeout(1500);

const ui = await page.evaluate(() => {
  const nav = document.querySelector('.bottom-nav');
  const cards = [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')];
  const c = cards[0];
  return {
    brand: clean(document.querySelector('.brand-text b')?.textContent),
    title: document.title,
    tabs: [...nav.querySelectorAll('.nav-label')].map((b) => clean(b.textContent)),
    cards: cards.length,
    assets: [...new Set(cards.map((x) => clean(x.querySelector('.asset')?.textContent)))],
    side: clean(c?.querySelector('.badge.long, .badge.short')?.textContent),
    labels: [...c.querySelectorAll('.lvl-label')].map((l) => clean(l.textContent)),
    price: clean(c?.querySelector('.price')?.textContent),
    rec: clean(c?.querySelector('.badge.rec')?.textContent),
    seedCells: [...c.querySelectorAll('.seed-cell b')].map((b) => clean(b.textContent)),
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
    fxLeft: /FX|벤티지|Lot|랏/.test(document.querySelector('.scanner-tab')?.innerText || ''),
  };
});
check(ui.brand === 'COTA' && ui.title === 'COTA · 실시간 트레이딩 시그널', '라이브 COTA 브랜드·제목', `${ui.brand} · ${ui.title}`);
check(ui.tabs.join('|') === '스캐너|시황|전략엔진|기록|설정', '라이브 5탭', ui.tabs.join(' | '));
check((ui.scripts || []).some((s) => /index-.*\.js/.test(s || '')), '새 빌드 자산 로드', (ui.scripts || []).join(','));
check(ui.cards > 0 && ui.assets.every((a) => a === '코인'), '라이브 코인 시그널 카드', `${ui.cards}건 · ${ui.assets.join('/')}`);
check(!ui.fxLeft, '라이브 FX·랏 UI 없음');
check(/^(롱 · 매수|숏 · 매도)$/.test(ui.side), '라이브 방향 배지 한글', ui.side);
check(ui.labels.join('|') === '목표가|진입가|본전 (EQ)|손절가', '라이브 가격 박스 한글', ui.labels.join(' / '));
check(/^COTA 추천 \d+x$/.test(ui.rec), '라이브 COTA 추천 배지', ui.rec);
check(ui.seedCells.length === 2 && ui.seedCells.every((v) => /^[+-]?\$/.test(v)), '라이브 시드 예상 손익', ui.seedCells.join(' / '));
check(
  (ui.price || '').includes(',') || Number((ui.price || '').replace(/,/g, '')) < 1000,
  '라이브 천단위 콤마 가격',
  ui.price,
);

// 공유 카드
await page.evaluate(() => {
  window.__drawn = [];
  const proto = CanvasRenderingContext2D.prototype;
  if (!proto.__patched) {
    const orig = proto.fillText;
    proto.fillText = function (text, ...rest) {
      window.__drawn.push(String(text));
      return orig.call(this, text, ...rest);
    };
    proto.__patched = true;
  }
});
await page.locator('.scanner-tab .signal-card:not(.skeleton)').first().click();
await page.waitForSelector('.share-canvas.in', { timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/09-live-pages.png` });
const share = await page.evaluate(() => ({ drawn: [...new Set(window.__drawn)], w: document.querySelector('canvas.share-canvas').width }));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(
  ['진입가', '목표가', '손절가', 'COTA'].every((t) => share.drawn.includes(t)) && share.drawn.some((d) => /^COTA 추천 \d+x$/.test(d)),
  '라이브 공유 카드 한글 라벨·COTA',
  share.drawn.slice(0, 10).join(' | '),
);
check(share.w > 0, '라이브 공유 카드 캔버스', `${share.w}px`);

// 설정 탭
await page.locator('.bottom-nav button[data-tab="settings"]').click();
await page.waitForSelector('#settings-profile', { timeout: 30000 });
await page.waitForTimeout(800);
const settings = await page.evaluate(() => ({
  seed: clean(document.querySelector('#settings-profile .profile-cell b')?.textContent),
  headings: [...document.querySelectorAll('.settings-tab .panel h3')].map((h) => clean(h.textContent)),
  target: clean(document.querySelector('.notify-target button.on')?.textContent),
  ntfy: document.querySelector('.td-key-input')?.value,
  version: [...document.querySelectorAll('.setting-desc')].map((d) => d.textContent).find((t) => t?.includes('앱 v')),
}));
check(settings.seed === '$1,000' && settings.headings[0] === '💼 내 투자 프로필', '라이브 내 투자 프로필 카드', `${settings.seed} · ${settings.headings[0]}`);
check(settings.target === '주요 코인' && settings.ntfy === 'bgss-hw3238-9f4k2m', '라이브 알림 기본값', `${settings.target} · ${settings.ntfy}`);
check(/앱 v1\.3\.0/.test(settings.version || ''), '라이브 앱 버전 v1.3.0', settings.version);

check(errors.length === 0, '라이브 콘솔·페이지 에러 0건', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n✅ 라이브 COTA 검증 통과' : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
