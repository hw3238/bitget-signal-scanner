/**
 * 라이브 Pages 검증 — COTA (v1.5.3)
 *   - 배포본이 새 번들·COTA 브랜드·5탭 코인 스캐너를 실제로 내려주는지
 *   - 첫 실행 온보딩(프로필 없음) → 저장 → 메인 진입
 *   - 카드 한글 라벨·천단위 콤마·COTA 추천 배지·시드 예상 손익
 *   - 공유 카드 모달 · 즐겨찾기 · 콘솔/페이지 에러 0건
 *
 * 실행: node scripts/live-check.mjs
 */
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

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
  seedInputs: document.querySelectorAll('.seed-input, .seed-chip').length,
  styles: [...document.querySelectorAll('.style-card b')].map((b) => clean(b.textContent)),
  title: clean(document.querySelector('.onboarding h2')?.textContent),
}));
check(onb.seedInputs === 0, '라이브 온보딩에 수동 시드 입력 없음(v1.5.5)', String(onb.seedInputs));
check(onb.styles.join('|') === '보수적 매매|공격적 매매', '라이브 온보딩 매매 성향 2택', onb.styles.join(' / '));

// 보수적 성향으로 시작 (v1.5.5 — 시드 입력 없음)
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
    cockpitCells: [...c.querySelectorAll('.cockpit-cell b')].map((b) => clean(b.textContent)),
    cockpitRisk: clean(c?.querySelector('.cockpit-risk')?.textContent),
    unlinked: clean(c?.querySelector('[data-cockpit-unlinked]')?.textContent),
    chartLabels: [...c.querySelectorAll('.mini-label')].map((l) => clean(l.textContent)),
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
    fxLeft: /FX|벤티지|Lot|랏/.test(document.querySelector('.scanner-tab')?.innerText || ''),
  };
});
check(ui.brand === 'COTA' && ui.title === 'COTA · 실시간 트레이딩 시그널', '라이브 COTA 브랜드·제목', `${ui.brand} · ${ui.title}`);
check(ui.tabs.join('|') === '스캐너|시황|메뉴|기록|설정', '라이브 5탭', ui.tabs.join(' | '));
check((ui.scripts || []).some((s) => /index-.*\.js/.test(s || '')), '새 빌드 자산 로드', (ui.scripts || []).join(','));
check(ui.cards > 0 && ui.assets.every((a) => a === '코인'), '라이브 코인 시그널 카드', `${ui.cards}건 · ${ui.assets.join('/')}`);
check(!ui.fxLeft, '라이브 FX·랏 UI 없음');
check(/^(롱 · 매수|숏 · 매도)$/.test(ui.side), '라이브 방향 배지 한글', ui.side);
check(ui.labels.join('|') === '목표가|진입가|본전 (EQ)|손절가', '라이브 가격 박스 한글', ui.labels.join(' / '));
check(/^COTA 추천 \d+x$/.test(ui.rec), '라이브 COTA 추천 배지', ui.rec);
check(
  ui.cockpitCells.length === 0 && ui.cockpitRisk === '실계좌 미연결' && /계좌를 연결하면 실시간 잔고 기준/.test(ui.unlinked),
  '라이브 실전 주문 콕핏 = 실계좌 미연결 안내(수동 시드 없음)',
  `${ui.cockpitRisk} · ${ui.unlinked.slice(0, 40)}`,
);
check(ui.chartLabels.length === 3, '라이브 차트 목표·진입·손절 라벨', ui.chartLabels.join(' / '));
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
check(
  settings.seed === '실계좌 미연결' && settings.headings[0] === '💼 내 매매 기준',
  '라이브 내 매매 기준 카드(계좌 잔고)',
  `${settings.seed} · ${settings.headings[0]}`,
);
check(settings.target === '주요 코인' && settings.ntfy === 'bgss-hw3238-9f4k2m', '라이브 알림 기본값', `${settings.target} · ${settings.ntfy}`);
check(/앱 v1\.5\.6/.test(settings.version || ''), '라이브 앱 버전 v1.5.6', settings.version);

// 내 진입 원탭 → 기록 대시보드
await page.locator('.bottom-nav button[data-tab="scanner"]').click();
await page.waitForTimeout(700);
const pinBtn = page.locator('.scanner-tab .signal-card:not(.skeleton) .pin-btn').first();
await pinBtn.scrollIntoViewIfNeeded();
const pinLabel = (await pinBtn.innerText()).replace(/\s+/g, ' ').trim();
await pinBtn.click();
await page.waitForTimeout(500);
const pinned = await page.evaluate(() => ({
  label: clean(document.querySelector('.scanner-tab .signal-card:not(.skeleton) .pin-btn')?.textContent),
  stored: JSON.parse(localStorage.getItem('bgss.mytrades.v1') || '[]').length,
  shareOpen: !!document.querySelector('.share-canvas.in'),
}));
check(pinLabel === '📌 내 진입' && pinned.label === '✓ 진입함' && pinned.stored === 1, '라이브 카드 원탭 내 진입', `${pinLabel} → ${pinned.label} · ${pinned.stored}건`);
check(!pinned.shareOpen, '내 진입 탭은 공유 모달을 열지 않음');

await page.locator('.bottom-nav button[data-tab="history"]').click();
await page.waitForSelector('.history-tab .equity-panel', { timeout: 30000 });
await page.waitForTimeout(700);
const dash = await page.evaluate(() => {
  const tab = document.querySelector('.history-tab');
  return {
    modes: [...tab.querySelectorAll('.trade-mode button')].map((b) => clean(b.textContent)),
    curve: !!tab.querySelector('.equity-svg') || !!tab.querySelector('.equity-empty'),
    clip: tab.querySelectorAll('.equity-svg g[clip-path]').length,
    above: (() => {
      const el = tab.querySelector('.equity-line.above');
      return el ? getComputedStyle(el).stroke : null;
    })(),
    strat: [...tab.querySelectorAll('.strat-chip')].map((s) => ({
      name: s.querySelector('.sc-main b')?.textContent?.trim(),
      r: s.querySelector('.sc-result b')?.textContent?.trim(),
    })),
    kpi: [...tab.querySelectorAll('.equity-kpi span')].map((s) => clean(s.textContent)),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check(dash.modes.length === 2 && /전체 시그널/.test(dash.modes[0]) && /내 진입 매매 1/.test(dash.modes[1]), '라이브 기록 세그먼트', dash.modes.join(' / '));
check(dash.curve && (dash.clip === 2 || dash.clip === 0) && (dash.above === 'rgb(49, 130, 246)' || dash.above === null), '라이브 누적 R 수익곡선', `${dash.clip}클립 · ${dash.above}`);
check(dash.strat.length > 0 && dash.strat.every((s) => /[+-]?\d+\.\d{2}R$/.test(s.r ?? '')), '라이브 전략별 성적', dash.strat.slice(0, 3).map((s) => `${s.name} ${s.r}`).join(' / '));
check(dash.kpi.length >= 3 && !dash.overflow, '라이브 곡선 KPI · 390px 오버플로 0건', dash.kpi.join(' / '));
await page.screenshot({ path: `${OUT}/52-live-history-dashboard.png`, fullPage: true });

check(errors.length === 0, '라이브 콘솔·페이지 에러 0건', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n✅ 라이브 COTA 검증 통과' : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
