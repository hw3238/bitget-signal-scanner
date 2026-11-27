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
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

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
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await context.addInitScript(seedAuthSession);
  await installE2EStubs(context);

await context.addInitScript(() => {
  localStorage.setItem('cota.exchange.v1', 'bitget');
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

// v1.5.7 — 온보딩(매매 성향)이 없어져 첫 화면이 바로 스캐너여야 한다.
await page.waitForSelector('.signal-card, .scanner-tab', { timeout: 60000 });
const firstRun = await page.evaluate(() => ({
  onboarding: !!document.querySelector('.onboarding'),
  styleCards: document.querySelectorAll('.style-card').length,
  scanner: !!document.querySelector('.scanner-tab'),
  profile: localStorage.getItem('cota.profile.v1'),
}));
check(!firstRun.onboarding && firstRun.scanner, '라이브 첫 화면 = 온보딩 없이 바로 스캐너', JSON.stringify(firstRun));
check(firstRun.styleCards === 0 && firstRun.profile === null, '라이브에 매매 성향 선택·저장값 없음', `styleCards=${firstRun.styleCards}`);
await page.waitForFunction(
  () => {
    const b = document.querySelector('.scanner-tab .rescan');
    return !!b && !b.classList.contains('busy');
  },
  { timeout: 180000 },
);
// 진행중 코인 시그널이 없는 시간대에도 카드 검증이 되도록 '종료 포함 → 자산 전체'로 넓힌다.
if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
  const toggle = page.locator('.scanner-tab .ghost-toggle').first();
  if (((await toggle.textContent()) ?? '').includes('진행중만')) {
    await toggle.click();
    await page.waitForTimeout(900);
  }
  if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
    const all = page.locator('.scanner-tab [data-asset-filter] button[data-asset="all"]');
    if (await all.count()) {
      await all.first().click();
      await page.waitForTimeout(900);
    }
  }
}
await page.waitForSelector('.scanner-tab .signal-card:not(.skeleton)', { timeout: 60000 });
await page.waitForTimeout(1500);

/** 스캐너 탭에 다녀오면 필터가 기본값(진행중·코인)으로 돌아간다 — 카드가 없으면 넓혀서 다시 찾는다. */
const ensureCard = async () => {
  if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) > 0) return true;
  const toggle = page.locator('.scanner-tab .ghost-toggle').first();
  if (((await toggle.textContent()) ?? '').includes('진행중만')) {
    await toggle.click();
    await page.waitForTimeout(900);
  }
  if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) > 0) return true;
  const all = page.locator('.scanner-tab [data-asset-filter] button[data-asset="all"]');
  if (await all.count()) {
    await all.first().click();
    await page.waitForTimeout(900);
  }
  return (await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) > 0;
};

const ui = await page.evaluate(() => {
  const nav = document.querySelector('.bottom-nav');
  const cards = [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')];
  // 진행 중(현재 수익률) 카드가 있으면 그 카드를 대표로 본다 — 없으면(시장에 진행 중 코인 시그널 0건) 첫 카드.
  const c = cards.find((x) => /현재 수익률/.test(x.querySelector('.roi-cap')?.textContent || '')) ?? cards[0];
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
    openCard: /현재 수익률/.test(c?.querySelector('.roi-cap')?.textContent || ''),
    state: clean(c?.querySelector('.badge.state')?.textContent),
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
  !ui.openCard ||
    (ui.cockpitCells.length === 0 && ui.cockpitRisk === '실계좌 미연결' && /계좌를 연결하면 실시간 잔고 기준/.test(ui.unlinked)),
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
check(/앱 v1\.5\.8/.test(settings.version || ''), '라이브 앱 버전 v1.5.8', settings.version);

// v1.5.7 — 설정 항목별 저장 버튼 · 매매 스타일 제거
const saveUi = await page.evaluate(() => ({
  names: [...document.querySelectorAll('.settings-tab [data-save]')].map((b) => b.getAttribute('data-save')),
  disabled: [...document.querySelectorAll('.settings-tab [data-save]')].every((b) => b.disabled),
  stylePicks: [...document.querySelectorAll('[data-style-pick]')].length,
  presetNote: [...document.querySelectorAll('[data-style-preset-note]')].length,
  riskChips: [...document.querySelectorAll('#settings-profile [data-risk-preset]')].map((b) => clean(b.textContent)),
  levRec: clean(document.querySelector('#settings-profile [data-settings-levrec] b')?.textContent),
}));
check(
  saveUi.names.length === 9 && saveUi.disabled,
  '라이브 설정 항목별 저장 버튼 9개(초기 비활성)',
  saveUi.names.join(','),
);
check(saveUi.stylePicks === 0 && saveUi.presetNote === 0, '라이브 설정에 매매 스타일·프리셋 없음', `style=${saveUi.stylePicks} preset=${saveUi.presetNote}`);
check(saveUi.levRec === 'COTA 유동 추천' && saveUi.riskChips.join('|') === '1%|2%|3%|5%|10%|20%|30%|50%', '라이브 설정 = 추천 레버리지 안내 · 리스크 숫자 칩', `${saveUi.levRec} · ${saveUi.riskChips.join(',')}`);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/92-live-settings-save.png` });

// 내 진입 원탭 → 기록 대시보드
await page.locator('.bottom-nav button[data-tab="scanner"]').click();
await page.waitForTimeout(700);
await ensureCard();
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

// 🚀 급등 탐색기 (v1.5.6 웹 기능)
await page.locator('.bottom-nav button[data-tab="menu"]').click();
await page.waitForTimeout(600);
const menu = await page.evaluate(() => ({
  surge: !!document.querySelector('.menu-row[data-menu="surge"]'),
  label: clean(document.querySelector('.menu-row[data-menu="surge"] .menu-copy b')?.textContent),
  hero: clean(document.querySelector('.menu-hero-count b')?.textContent),
  tools: document.querySelectorAll('.menu-row').length,
}));
check(menu.surge && /급등 탐색기/.test(menu.label) && menu.tools === 15 && menu.hero === '16', '라이브 메뉴: 🚀 급등 탐색기(도구 16)', `${menu.label} · ${menu.tools}+자동매매=${menu.hero}`);

await page.locator('.menu-row[data-menu="surge"]').click();
await page.waitForSelector('.surge-card', { timeout: 240000 });
await page.waitForFunction(() => !document.querySelector('[data-surge-progress]'), { timeout: 240000 });
await page.waitForTimeout(800);
const surge = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.surge-card')];
  const first = cards[0];
  return {
    count: cards.length,
    sub: clean(document.querySelector('[data-surge-sub]')?.textContent),
    top: clean(document.querySelector('[data-surge-top]')?.textContent),
    prime: clean(document.querySelector('[data-surge-prime-count]')?.textContent),
    first: first
      ? {
          base: clean(first.querySelector('.surge-name b')?.firstChild?.textContent),
          score: Number(first.dataset.score),
          scoreText: clean(first.querySelector('.surge-score')?.textContent),
          reqs: first.querySelectorAll('.surge-reqs li').length,
          cells: [...first.querySelectorAll('.surge-cell b')].map((b) => clean(b.textContent)),
          why: clean(first.querySelector('.surge-why')?.textContent),
        }
      : null,
  };
});
check(surge.count >= 3 && surge.first?.reqs === 6, '라이브 급등 탐색기: 카드·6요건 배지', `${surge.count}장 · ${surge.first?.base} ${surge.first?.scoreText}`);
check(
  surge.first?.score >= 1 &&
    surge.first.score <= 100 &&
    surge.first.cells?.length === 4 &&
    surge.first.cells.every((v) => v && v !== '-'),
  '라이브 급등 탐색기: 점수·진입/목표/손절/레버리지 4칸',
  `${surge.first?.score}점 · ${surge.first?.cells?.join(' / ')}`,
);
check(/코인 선물 \d+개 중/.test(surge.sub ?? '') && surge.top === surge.first?.base, '라이브 급등 탐색기: 유니버스·TOP 요약', `${surge.sub} · TOP ${surge.top} · 요건4+ ${surge.prime}`);
await page.screenshot({ path: `${OUT}/87-live-surge-explorer.png` });
await page.locator('.menu-back').click();
await page.waitForTimeout(300);

// 💾 자동매매 ② 저장 버튼 (v1.5.7 — 프리셋 없음)
await page.waitForSelector('.menu-auto[data-menu="auto"]', { timeout: 30000 });
await page.locator('.menu-auto[data-menu="auto"]').click();
await page.waitForSelector('[data-auto-root]', { timeout: 30000 });
await page.waitForTimeout(900);
await page.locator('[data-auto-guards]').scrollIntoViewIfNeeded();
const autoSaveUi = await page.evaluate(() => ({
  styleCard: !!document.querySelector('[data-auto-style]'),
  apply: !!document.querySelector('[data-style-apply]'),
  saveDisabled: document.querySelector('[data-auto-config-save]')?.disabled !== false,
  state: clean(document.querySelector('[data-auto-guard-state]')?.textContent),
  levCap: clean(document.querySelector('[data-lev-cap-label]')?.textContent),
  stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}'),
}));
check(
  !autoSaveUi.styleCard && !autoSaveUi.apply && autoSaveUi.saveDisabled && autoSaveUi.state === '저장됨',
  '라이브 자동매매: 매매 스타일 카드 없음 · 저장 버튼 초기 비활성',
  `카드=${autoSaveUi.styleCard} · ${autoSaveUi.state}`,
);
check(
  autoSaveUi.stored.minWinRate === 45 || autoSaveUi.stored.minWinRate != null,
  '라이브 자동매매 설정: 최소 승률 값 존재',
  `${autoSaveUi.stored.minWinRate}% · ${autoSaveUi.stored.minRR}R · ${autoSaveUi.stored.entryTtlMin}분 · ${autoSaveUi.levCap}`,
);
await page.locator('[data-daily-preset="7"]').click();
await page.waitForTimeout(350);
const liveDirty = await page.evaluate(() => ({
  state: clean(document.querySelector('[data-auto-guard-state]')?.textContent),
  saveOn: document.querySelector('[data-auto-config-save]')?.disabled === false,
  stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct,
}));
check(
  liveDirty.state === '저장 안 됨' && liveDirty.saveOn && liveDirty.stored === 4.5,
  '라이브 자동매매: 값 변경 → 저장 안 됨(설정은 그대로)',
  `${liveDirty.state} · 저장 ${liveDirty.stored}%`,
);
await page.locator('[data-auto-config-save]').click();
await page.waitForTimeout(700);
const liveSaved = await page.evaluate(() => ({
  state: clean(document.querySelector('[data-auto-guard-state]')?.textContent),
  stored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct,
  link: clean(document.querySelector('[data-style-linked]')?.textContent),
}));
check(
  liveSaved.state === '✓ 저장됨' && liveSaved.stored === 7,
  '라이브 자동매매: 저장 → ✓ 저장됨 · 7% 반영',
  `${liveSaved.state} · ${liveSaved.stored}%`,
);
check(liveSaved.stored === 7, '라이브 자동매매: 저장 → 7% 반영(덮어쓰는 프리셋 없음)', `${liveSaved.stored}%`);
await page.screenshot({ path: `${OUT}/97-live-autotrade-save.png` });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
await page.locator('.bottom-nav button[data-tab="menu"]').click();
await page.waitForTimeout(500);
await page.waitForSelector('.menu-auto[data-menu="auto"]', { timeout: 30000 });
await page.locator('.menu-auto[data-menu="auto"]').click();
await page.waitForSelector('[data-auto-root]', { timeout: 30000 });
await page.waitForTimeout(1000);
const liveKept = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct);
check(liveKept === 7, '라이브 자동매매: 새로고침 뒤에도 저장값 유지(7%)', `${liveKept}%`);
// 원래 기본값(4.5%)으로 되돌려 둔다 — 실사용 설정을 바꿔 두지 않는다.
await page.locator('[data-daily-preset="4.5"]').click();
await page.waitForTimeout(300);
await page.locator('[data-auto-config-save]').click();
await page.waitForTimeout(600);
const liveRestored = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').dailyLossPct);
check(liveRestored === 4.5, '라이브 자동매매: 기본 4.5% 로 복원', `${liveRestored}%`);

check(errors.length === 0, '라이브 콘솔·페이지 에러 0건', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n✅ 라이브 COTA 검증 통과' : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
