/**
 * 🎯 맞춤 알림 · 📊 경제지표 센터 + 새 메뉴 파인더 E2E (v1.5.8)
 *   실행: npm run build && npm run alerts-e2e
 *
 *  1) 메뉴: 16도구 · 4그룹(알림·시황 / 실전 레이더 / 리스크·계산기 / 분석·엔진)
 *     · 카테고리 칩(전체·알림·시황·실전 레이더·계산·리스크·분석) 필터
 *     · 검색(알림/김프/없는말) · 초기화 · 결과 0 안내
 *  2) 알림 센터: 마스터·4채널 토글 저장, 테스트 알림 안내
 *  3) 지정가·RSI 알림: 추가·중복·오류(현재가 반대편)·삭제·발동 완료 → 다시 감시
 *  4) 경제지표: 카드·예상/이전·카운트다운·필터·펼치기(근거·상회/부합/하회 롱숏)·지표별 🔕
 *  5) 설정 탭: 채널 칩 상태·토글 저장·`알림 · 지표 열기` 이동
 *  6) 390px 오버플로 0 · 콘솔/페이지 에러 0 · 스크린샷 177~186
 *
 *  ⚠️ DB 무접촉: 세션 시드 + 가짜 Supabase 로만 돈다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4187;
const SITE = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';

function waitForServer(url, timeoutMs = 40000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve(true);
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('preview server timed out'));
      setTimeout(tick, 400);
    };
    tick();
  });
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env },
  detached: true,
});

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const run = async () => {
  await waitForServer(SITE);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const consoleErrors = [];
  const pageErrors = [];

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await context.addInitScript(seedAuthSession);
  await installE2EStubs(context);
  await context.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    // 발동 완료 1건 + 감시 1건을 미리 심어 UI 동작을 확인한다(실제 시세 도달을 기다리지 않는다).
    localStorage.setItem(
      'cota.alerts.v1',
      JSON.stringify([
        {
          id: 'BTCUSDT|price_above|95000',
          symbol: 'BTCUSDT',
          kind: 'price_above',
          value: 95000,
          createdAt: Date.now() - 60_000,
          oneShot: true,
        },
        {
          id: 'ETHUSDT|rsi_under|25',
          symbol: 'ETHUSDT',
          kind: 'rsi_under',
          value: 25,
          createdAt: Date.now() - 3_600_000,
          triggeredAt: Date.now() - 1_800_000,
          triggerActual: 22.4,
          oneShot: true,
        },
      ]),
    );
    if (!localStorage.getItem('bgss.settings.v1')) localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
  });

  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const shot = async (name, fullPage = false) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  };

  await page.goto(SITE);
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 30000 });
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForSelector('.menu-hero', { timeout: 15000 });
  await page.waitForTimeout(500);

  /* ---------------- 1) 메뉴 파인더 ---------------- */
  const hub = await page.evaluate(() => ({
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    note: document.querySelector('.menu-hero p')?.textContent?.trim(),
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu).filter(Boolean),
    auto: document.querySelectorAll('[data-menu="auto"]').length,
    groups: [...document.querySelectorAll('.menu-group-title')].map((g) => g.textContent?.trim()),
    chips: [...document.querySelectorAll('[data-menu-chip]')].map((c) => c.textContent?.replace(/\d+$/, '').trim()),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('메뉴 16도구 · 문구', hub.hero === '16' && /16가지 도구/.test(hub.note ?? ''), `${hub.hero} · ${hub.note}`);
  check('메뉴 행 15 + 자동매매 1', hub.rows.length === 15 && hub.auto === 1, `${hub.rows.length}+${hub.auto}`);
  check(
    '그룹 4개 · 순서',
    hub.groups.join('|') === '알림 · 시황|실전 레이더|리스크 · 계산기|분석 · 엔진',
    hub.groups.join(' / '),
  );
  check(
    '칩 5개(전체·알림·시황·실전 레이더·계산·리스크·분석)',
    hub.chips.join('|') === '전체|알림·시황|실전 레이더|계산·리스크|분석',
    hub.chips.join(' / '),
  );
  check('390px 오버플로 0', !hub.overflow, '');
  await shot('177-menu-finder');

  // 알림·시황 칩 → 2개(+자동매매)
  await page.locator('[data-menu-chip="alert"]').click();
  await page.waitForTimeout(200);
  const alertOnly = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    groups: [...document.querySelectorAll('.menu-group-title')].map((g) => g.textContent?.trim()),
    summary: document.querySelector('[data-menu-summary]')?.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  check('칩 필터 — 알림·시황 2개만', alertOnly.rows.length === 2 && alertOnly.rows.includes('alerts'), alertOnly.rows.join(','));
  check('칩 필터 — 그룹도 1개', alertOnly.groups.length === 1, alertOnly.groups.join(','));
  check('칩 필터 — 결과 요약', /검색 결과 2개/.test(alertOnly.summary ?? ''), alertOnly.summary);
  await shot('178-menu-chip-filter');

  // 검색 — 김프
  await page.locator('[data-menu-chip="all"]').click();
  await page.locator('[data-menu-search]').fill('김프');
  await page.waitForTimeout(250);
  const searchKimchi = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
  );
  check('검색 — 김프 1건', searchKimchi.length === 1 && searchKimchi[0] === 'kimchi', searchKimchi.join(','));

  // 검색 — 없는 말 → 안내
  await page.locator('[data-menu-search]').fill('없는도구123');
  await page.waitForTimeout(250);
  const empty = await page.evaluate(() => ({
    rows: document.querySelectorAll('.menu-row').length,
    empty: document.querySelector('[data-menu-empty]')?.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  check('검색 결과 0 → 안내', empty.rows === 0 && /맞는 도구가 없습니다/.test(empty.empty ?? ''), empty.empty);
  await shot('179-menu-search-empty');
  await page.locator('[data-menu-empty] .ghost-btn').click();
  await page.waitForTimeout(200);
  const restored = await page.evaluate(() => document.querySelectorAll('.menu-row').length);
  check('초기화 → 전체 15개 복귀', restored === 15, `${restored}개`);

  /* ---------------- 2) 알림 센터 열기 ---------------- */
  await page.locator('[data-menu="alerts"]').click();
  await page.waitForSelector('[data-alerts-tab]', { timeout: 15000 });
  await page.waitForTimeout(400);
  const center = await page.evaluate(() => ({
    master: document.querySelector('[data-alert-master-switch]')?.getAttribute('aria-pressed'),
    channels: [...document.querySelectorAll('[data-alert-channel]')].map((c) => ({
      key: c.dataset.alertChannel,
      on: c.querySelector('.switch')?.getAttribute('aria-pressed'),
      label: c.querySelector('b')?.textContent?.trim(),
    })),
    service: document.querySelector('.alerts-service')?.textContent?.trim(),
  }));
  check('알림 센터 — 마스터 ON', center.master === 'true', center.master ?? '');
  check('알림 센터 — 채널 4종', center.channels.length === 4, center.channels.map((c) => c.label).join(','));
  check(
    '알림 센터 — 기본 시그널/지정가/지표 ON · 뉴스 OFF',
    center.channels.find((c) => c.key === 'signal')?.on === 'true' &&
      center.channels.find((c) => c.key === 'custom')?.on === 'true' &&
      center.channels.find((c) => c.key === 'macro')?.on === 'true' &&
      center.channels.find((c) => c.key === 'news')?.on === 'false',
    center.channels.map((c) => `${c.key}:${c.on}`).join(' '),
  );
  check('웹에서는 APK 안내', /APK/.test(center.service ?? ''), center.service);
  await shot('180-alerts-center');

  // 뉴스 채널 켜기 → localStorage
  await page.locator('[data-alert-channel="news"] .switch').click();
  await page.waitForTimeout(250);
  const newsOn = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.alertSettings.v1') ?? '{}').news);
  check('뉴스 채널 ON 저장', newsOn === true, String(newsOn));
  await page.locator('[data-alert-channel="news"] .switch').click();
  await page.waitForTimeout(200);

  // 테스트 알림 — 웹 안내 문구
  await page.locator('[data-alert-channel="custom"] .alerts-test-btn').click();
  await page.waitForTimeout(400);
  const testNote = await page.evaluate(() => document.querySelector('[data-alert-custom], .alerts-note')?.textContent?.trim());
  check('테스트 알림 안내', /테스트 알림을 보냈습니다|브라우저 알림/.test(testNote ?? ''), (testNote ?? '').slice(0, 60));

  /* ---------------- 3) 지정가 알림 추가/오류/삭제 ---------------- */
  const activeBefore = await page.evaluate(() => document.querySelectorAll('[data-alert-row]').length);
  await page.selectOption('[data-alert-symbol]', 'BTCUSDT');
  await page.selectOption('[data-alert-kind]', 'price_above');
  await page.locator('[data-alert-value]').fill('88000');
  await page.locator('[data-alert-add]').click();
  await page.waitForTimeout(300);
  const added = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-alert-row]').length,
    note: document.querySelector('[data-alert-form-note]')?.textContent?.trim(),
    stored: JSON.parse(localStorage.getItem('cota.alerts.v1') ?? '[]').length,
    text: document.querySelector('[data-alert-active-list]')?.textContent ?? '',
  }));
  check('알림 추가 — 행 증가', added.rows === activeBefore + 1, `${activeBefore} → ${added.rows}`);
  check('알림 추가 — 저장', added.stored >= 3, `${added.stored}건`);
  check('알림 추가 — 조건 문구', added.text.includes('BTC 가격 ≥ $88,000'), added.text.replace(/\s+/g, ' ').slice(0, 60));
  check('알림 추가 — 안내 문구', /추가됨/.test(added.note ?? ''), added.note);

  // 중복 추가
  await page.locator('[data-alert-value]').fill('88000');
  await page.locator('[data-alert-add]').click();
  await page.waitForTimeout(250);
  const dup = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-alert-row]').length,
    note: document.querySelector('[data-alert-form-note]')?.textContent?.trim(),
  }));
  check('중복 조건 — 행 그대로', dup.rows === added.rows, `${dup.rows}`);
  check('중복 조건 — 안내', /이미 같은 조건/.test(dup.note ?? ''), dup.note);

  // 오류 — 현재가보다 낮은 "가격 이상"
  await page.locator('[data-alert-value]').fill('1000');
  await page.locator('[data-alert-add]').click();
  await page.waitForTimeout(250);
  const bad = await page.evaluate(() => document.querySelector('[data-alert-form-note]')?.textContent?.trim());
  check('잘못된 값 — 오류 안내', /이미 현재가보다 낮습니다|1\/10/.test(bad ?? ''), bad);
  await shot('181-alert-custom');

  /* ---------------- 4) 경제지표 카드 ---------------- */
  const macro = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-macro-event]')];
    const first = cards[0];
    return {
      count: cards.length,
      firstId: first?.dataset.macroEvent,
      firstText: first?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120),
      countdown: first?.querySelector('[data-macro-countdown]')?.textContent?.trim(),
      nfp: cards.find((c) => c.dataset.macroEvent === 'nfp-2026-11')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      context: document.querySelector('.macro-context')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 400),
    };
  });
  check('경제지표 카드 8건 이상', macro.count >= 8, `${macro.count}건`);
  check('첫 카드 = ISM 제조업(12/02)', macro.firstId === 'ism-mfg-2026-11' && /12\/02/.test(macro.firstText ?? ''), macro.firstText?.slice(0, 50));
  check('카운트다운 표시', /일|시간|분/.test(macro.countdown ?? ''), macro.countdown);
  check('11월 NFP 카드 — 예상 +90K · 이전 +165K', /예상 ▲ \+90K/.test(macro.nfp) && /\+165K/.test(macro.nfp), '');
  check('시장 상황 카드 — 기준금리·BTC', /3\.75/.test(macro.context ?? '') && /BTC/.test(macro.context ?? ''), macro.context?.slice(0, 60));
  check('NFP 상회/하회 배지', /상회 → 숏 유리/.test(macro.nfp) && /하회 → 롱 유리/.test(macro.nfp), '');

  // 펼치기 — 근거·시나리오 3종·출처
  await page.locator('[data-macro-event="nfp-2026-11"] .macro-card-head').click();
  await page.waitForTimeout(300);
  const detail = await page.evaluate(() => {
    const card = document.querySelector('[data-macro-event="nfp-2026-11"]');
    return {
      open: card?.classList.contains('open'),
      basis: card?.querySelectorAll('.macro-block li').length,
      scenarios: [...(card?.querySelectorAll('.macro-scenario') ?? [])].map((s) => s.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40)),
      source: card?.querySelector('.macro-source')?.textContent?.trim(),
      playbook: card?.querySelector('.macro-block.playbook p')?.textContent?.trim(),
    };
  });
  check('지표 펼치기 — 근거 3개 이상', detail.open && (detail.basis ?? 0) >= 3, `${detail.basis}개`);
  check('지표 펼치기 — 상회/부합/하회 3종', detail.scenarios.length === 3, detail.scenarios.join(' / '));
  check('지표 펼치기 — 출처 표기', /BLS/.test(detail.source ?? ''), (detail.source ?? '').slice(0, 50));
  check('지표 펼치기 — 대응 요령', (detail.playbook ?? '').length > 10, (detail.playbook ?? '').slice(0, 40));
  await shot('182-macro-detail', true);

  // ★★★ 필터
  await page.locator('[data-macro-filter="star3"]').click();
  await page.waitForTimeout(250);
  const star3 = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-macro-event]').length,
    allThree: [...document.querySelectorAll('[data-macro-event]')].every((c) => c.textContent?.includes('★★★')),
  }));
  check('★★★ 필터', star3.cards >= 5 && star3.allThree, `${star3.cards}건`);
  await page.locator('[data-macro-filter="inflation"]').click();
  await page.waitForTimeout(200);
  const inflation = await page.evaluate(() => document.querySelectorAll('[data-macro-event]').length);
  check('물가 필터', inflation >= 3, `${inflation}건`);
  await page.locator('[data-macro-filter="all"]').click();
  await page.waitForTimeout(200);

  // 지표별 🔕
  await page.locator('[data-macro-event="ism-mfg-2026-11"] [data-macro-bell]').click();
  await page.waitForTimeout(200);
  const muted = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('cota.alerts.macroMuted.v1') ?? '[]'),
    bell: document.querySelector('[data-macro-event="ism-mfg-2026-11"] [data-macro-bell]')?.textContent?.trim(),
  }));
  check('지표 알림 끄기 — 저장', muted.stored.includes('ism-mfg-2026-11'), JSON.stringify(muted.stored));
  check('지표 알림 끄기 — 🔕', muted.bell === '🔕', muted.bell);
  await shot('183-macro-calendar');

  /* ---------------- 5) 발동 완료 → 다시 감시 ---------------- */
  const done = await page.evaluate(() => {
    const summary = [...document.querySelectorAll('.alert-done summary')][0];
    summary?.click();
    return {
      rows: document.querySelectorAll('[data-alert-done-row]').length,
      text: document.querySelector('[data-alert-done-row]')?.textContent?.replace(/\s+/g, ' ').trim(),
    };
  });
  check('발동 완료 1건 표시', done.rows === 1, `${done.rows}`);
  check('발동 완료 — 실제 값 표기', /22\.4/.test(done.text ?? ''), done.text);
  await page.locator('[data-alert-done-row] .ghost-btn').first().click();
  await page.waitForTimeout(300);
  const reactivated = await page.evaluate(() => ({
    active: document.querySelectorAll('[data-alert-row]').length,
    done: document.querySelectorAll('[data-alert-done-row]').length,
    list: document.querySelector('[data-alert-active-list]')?.textContent ?? '',
  }));
  check('다시 감시 → 감시 목록으로', reactivated.active >= 2 && reactivated.done === 0, `active=${reactivated.active} done=${reactivated.done}`);
  check('다시 감시 — ETH RSI 문구', reactivated.list.includes('ETH 1H RSI ≤ 25'), '');

  // 삭제 — BTC 88,000
  const beforeDelete = await page.evaluate(() => document.querySelectorAll('[data-alert-row]').length);
  const target = page.locator('[data-alert-row]', { hasText: 'BTC 가격 ≥ $88,000' }).first();
  await target.locator('.ghost-btn.danger').click();
  await page.waitForTimeout(300);
  const deleted = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-alert-row]').length,
    text: document.querySelector('[data-alert-active-list]')?.textContent ?? '',
  }));
  check('알림 삭제', deleted.rows === beforeDelete - 1 && !deleted.text.includes('$88,000'), `${beforeDelete} → ${deleted.rows}`);

  /* ---------------- 6) 설정 탭 연동 ---------------- */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('[data-settings-alert-channels]', { timeout: 15000 });
  await page.waitForTimeout(400);
  const settingsChips = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('[data-settings-alert-channel]')].map((c) => ({
      key: c.dataset.settingsAlertChannel,
      on: c.getAttribute('aria-pressed'),
    })),
  }));
  check('설정 — 채널 칩 5개', settingsChips.chips.length === 5, settingsChips.chips.map((c) => c.key).join(','));
  check(
    '설정 — 마스터/시그널/지정가/지표 ON',
    ['master', 'signal', 'custom', 'macro'].every((k) => settingsChips.chips.find((c) => c.key === k)?.on === 'true'),
    settingsChips.chips.map((c) => `${c.key}:${c.on}`).join(' '),
  );
  // 지정가 채널 끄기 → 저장
  await page.locator('[data-settings-alert-channel="custom"]').click();
  await page.waitForTimeout(250);
  const savedCustom = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.alertSettings.v1') ?? '{}').custom);
  check('설정 — 지정가 채널 OFF 저장', savedCustom === false, String(savedCustom));
  await page.locator('[data-settings-alert-channel="custom"]').click();
  await page.waitForTimeout(200);

  await page.locator('[data-settings-open-alerts]').click();
  await page.waitForSelector('[data-alerts-tab]', { timeout: 15000 });
  await page.waitForTimeout(400);
  const navigated = await page.evaluate(() => ({
    tab: document.querySelector('[data-tab="menu"]')?.className ?? '',
    title: document.querySelector('.subview-nav b')?.textContent?.trim(),
  }));
  check('설정 → 알림 센터 이동', /맞춤 알림/.test(navigated.title ?? ''), navigated.title);
  await shot('184-settings-to-alerts');

  /* ---------------- 7) 마스터 OFF → 채널 비활성 ---------------- */
  await page.locator('[data-alert-master-switch]').click();
  await page.waitForTimeout(300);
  const masterOff = await page.evaluate(() => ({
    master: document.querySelector('[data-alert-master-switch]')?.getAttribute('aria-pressed'),
    disabled: [...document.querySelectorAll('[data-alert-channel] .switch')].every((s) => s.disabled),
    hint: document.querySelector('.alerts-hint')?.textContent?.trim(),
    stored: JSON.parse(localStorage.getItem('cota.alertSettings.v1') ?? '{}').master,
  }));
  check('마스터 OFF — 저장', masterOff.stored === false, String(masterOff.stored));
  check('마스터 OFF — 개별 스위치 비활성', masterOff.disabled, '');
  check('마스터 OFF — 안내', /개별 알림도 나가지 않습니다/.test(masterOff.hint ?? ''), masterOff.hint);
  await shot('185-alert-master-off');
  await page.locator('[data-alert-master-switch]').click();
  await page.waitForTimeout(200);

  /* ---------------- 8) 데스크톱 ---------------- */
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await desk.addInitScript(seedAuthSession);
  await installE2EStubs(desk);
  await desk.addInitScript(() => localStorage.setItem('cota.exchange.v1', 'bitget'));
  const deskPage = await desk.newPage();
  await deskPage.goto(SITE);
  await deskPage.waitForSelector('.top-nav button[data-tab="menu"]', { timeout: 30000 });
  await deskPage.locator('.top-nav button[data-tab="menu"]').click();
  await deskPage.waitForTimeout(600);
  const deskHub = await deskPage.evaluate(() => ({
    rows: document.querySelectorAll('.menu-row').length,
    chips: document.querySelectorAll('[data-menu-chip]').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('데스크톱 — 15도구 · 칩 5 · 오버플로 0', deskHub.rows === 15 && deskHub.chips === 5 && !deskHub.overflow, JSON.stringify(deskHub));
  await deskPage.locator('[data-menu="alerts"]').click();
  await deskPage.waitForSelector('[data-alerts-tab]', { timeout: 15000 });
  await deskPage.waitForTimeout(600);
  const deskCenter = await deskPage.evaluate(() => ({
    channels: document.querySelectorAll('[data-alert-channel]').length,
    cards: document.querySelectorAll('[data-macro-event]').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('데스크톱 — 알림 센터 카드·오버플로 0', deskCenter.channels === 4 && deskCenter.cards >= 8 && !deskCenter.overflow, JSON.stringify(deskCenter));
  await deskPage.screenshot({ path: `${OUT}/186-alerts-desktop.png`, fullPage: true });
  await desk.close();

  await context.close();
  await browser.close();

  const realErrors = consoleErrors.filter((e) => !/Failed to load resource|net::ERR|429|500 \(Internal Server Error\)/.test(e));
  check('콘솔/페이지 에러 0건', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }));

  writeFileSync('.tmp/alerts-report.json', JSON.stringify({ hub, macro, checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n${failed.length ? '❌' : '✅'} 맞춤 알림·경제지표 E2E: ${checks.length - failed.length}/${checks.length} 통과${
      failed.length ? ` · 실패: ${failed.map((f) => f.name).join(' / ')}` : ''
    }`,
  );
  if (failed.length) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  });
