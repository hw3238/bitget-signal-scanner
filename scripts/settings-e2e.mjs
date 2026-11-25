/**
 * ⚙️ 설정 탭 항목별 저장 버튼 E2E (v1.5.6 웹)
 *
 *  1) 설정 탭의 매매 기준·알림·스캐너 항목마다 `저장` 버튼이 있고, 바꾸기 전에는 비활성이다.
 *  2) 항목을 눌러도 저장 전에는 localStorage 가 바뀌지 않고, `저장`을 누르면 `✓ 저장됨` + 저장된다.
 *  3) 1회 리스크 저장 → 설정(bgss.settings.v1)과 자동매매(cota.autotrade.config.v1)가 같은 값,
 *     자동매매 화면에도 그 값이 표시된다.
 *  4) 매매 스타일 저장 → 자동매매에 프리셋 적용(리스크·레버리지 상한·포지션·진입 기준·반익절),
 *     켜짐·모의/실거래·주기·허용 종목은 유지, 설정 탭 리스크도 프리셋 값으로 동기화.
 *  5) 새로고침 후에도 저장값 유지 · 초안이 없으면 저장 버튼 비활성.
 *
 * 실행: npm run build && node scripts/settings-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

const PORT = 4190;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';

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
  } catch {
    /* 아직 안 떴다 */
  }
  await sleep(300);
}

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
/** 검증 결과 — (이름, 조건, 상세) 또는 (조건, 이름, 상세) 둘 다 받는다. */
const check = (a, b, detail) => {
  const name = typeof a === 'string' ? a : String(b);
  const ok = typeof a === 'string' ? !!b : !!a;
  checks.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** 앱이 복원하는 스캔 스냅숏 — 실 API 없이도 시그널 카드가 결정적으로 뜬다. */
function snapshotScript() {
  const now = Date.now();
  const signal = {
    id: `BTCUSDT|1H|long|${now}`,
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    tf: '4H',
    side: 'long',
    strategyId: 'sweep-ob',
    strategyName: '유동성 스윕 + 오더블록 리테스트',
    strategyShort: '스윕·OB',
    star: 5,
    entry: 61000,
    stop: 57950,
    target: 67000,
    eq: 60000,
    rr: 2,
    remainingRR: 2,
    currentR: 0,
    price: 61100,
    changePct: 0.1,
    progress: 0.3,
    state: 'open',
    detectedAt: now - 5 * 60_000,
    barsSince: 1,
    winRate: 62,
    strategyRR: 2,
    leverage: 10,
    levRoi: 1,
    candles: [],
    detectedIdx: 0,
    tags: ['유동성 스윕', 'OB 리테스트'],
    fundingRate: 0.0001,
    quoteVolume: 3000000000,
    decimals: 1,
  };
  const contract = {
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    isRwa: false,
    decimals: 1,
    minTradeNum: 0.001,
    volumePlace: 3,
    minTradeUsdt: 5,
  };
  const stats = {
    n: 12,
    wins: 8,
    losses: 4,
    opens: 0,
    winRate: 62,
    avgWinR: 2.4,
    avgLossR: 0.9,
    rr: 2,
    expectancy: 0.95,
    totalR: 11.4,
    score: 7,
    movePct: 12,
    avgRiskPct: 1.2,
  };
  const analysis = {
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    tf: '4H',
    activeStrategyId: 'sweep-ob',
    activeWinRate: 62,
    activeRR: 2,
    activeN: 12,
    activeStats: stats,
    candidates: [{ id: 'sweep-ob', stats }],
    signals: [signal],
    replacement: null,
    candlesLoaded: 0,
    candleAt: now,
  };
  // 첫 로딩에만 심는다 — 새로고침 뒤에는 사용자가 저장한 값이 그대로 남아야 한다.
  if (localStorage.getItem('cota.e2e.seeded.v1') === '1') return;
  localStorage.setItem('cota.e2e.seeded.v1', '1');
  localStorage.setItem(
    'cota.scan.snapshot.v1',
    JSON.stringify({ v: 1, at: now, contracts: [contract], markets: 1, analyses: [analysis], signals: [signal], tickers: [] }),
  );
  localStorage.setItem(
    'bgss.settings.v1',
    JSON.stringify({ refreshSec: 120, leverageMode: 'auto', leverage: 10, minRR: 1.5, riskPct: 1.5, sound: false }),
  );
  // 사용자가 직접 만진 자동매매 설정 — 스타일 저장이 프리셋 필드만 바꾸고 나머지는 유지하는지 본다.
  localStorage.setItem(
    'cota.autotrade.config.v1',
    JSON.stringify({
      enabled: false,
      mode: 'demo',
      autoEntry: true,
      riskPct: 1.5,
      maxPositions: 3,
      dailyLossPct: 6,
      symbols: 'all',
      minWinRate: 50,
      minRR: 1.6,
      maxLeverage: 8,
      intervalSec: 120,
      entryTtlMin: 240,
      earlyStop: false,
      partialTp: false,
    }),
  );
  localStorage.setItem('cota.autotrade.migrated.cryptoDefault.v1', '1');
  localStorage.setItem('cota.autotrade.migrated.entryGate.v157', '1');
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
  await context.addInitScript(snapshotScript);
  const page = await context.newPage();
  // 설정 화면 검증만 한다 — 거래소·GitHub API 호출은 끊어 스캔이 화면을 흔들지 않게 한다.
  await page.route('**://api.bitget.com/**', (route) => route.abort());
  await page.route('**://api.github.com/**', (route) => route.abort());
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const read = (fn, arg) => page.evaluate(fn, arg);
  const storage = () =>
    read(() => ({
      settings: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}'),
      auto: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}'),
      profile: JSON.parse(localStorage.getItem('cota.profile.v1') || '{}'),
    }));
  const saveState = (name) =>
    read((n) => {
      const btn = document.querySelector(`.settings-tab [data-save="${n}"]`);
      return btn
        ? { text: btn.textContent.trim(), state: btn.getAttribute('data-save-state'), disabled: btn.disabled }
        : null;
    }, name);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav button[data-tab="settings"]', { timeout: 60000 });
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-profile', { timeout: 30000 });
  await page.waitForTimeout(500);

  /* ---------- 1) 항목별 저장 버튼 ---------- */
  const base = await read(() => {
    const btns = [...document.querySelectorAll('.settings-tab [data-save]')];
    return {
      names: btns.map((b) => b.getAttribute('data-save')),
      disabled: btns.every((b) => b.disabled),
      labels: [...new Set(btns.map((b) => b.textContent.trim()))],
      stylePick: [...document.querySelectorAll('.settings-tab [data-style-pick]')].map((b) => b.getAttribute('data-style-pick')),
      riskChips: [...document.querySelectorAll('#settings-profile [data-risk-preset]')].map((b) => b.getAttribute('data-risk-preset')),
      riskValue: document.querySelector('#settings-profile [data-risk-input]')?.value,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(
    '항목별 저장 버튼 9개(레버리지 모드·리스크·알림 3종·스캐너 4종)',
    base.names.join(',') === 'leverage-mode,risk,notify-enabled,notify-target,ntfy,leverage,min-rr,refresh,sound',
    base.names.join(','),
  );
  check('바꾸기 전에는 모든 저장 버튼 비활성 · 라벨 = 저장', base.disabled && base.labels.join('|') === '저장', base.labels.join('|'));
  check('매매 스타일 선택·프리셋이 설정 탭에서 사라졌다', base.stylePick.length === 0, base.stylePick.join('|'));
  check('리스크는 숫자 칩 + 직접 입력만', base.riskChips.join(',') === '1,2,3,5,10,20,30,50' && base.riskValue === '1.5', `${base.riskChips.join(',')} · ${base.riskValue}`);
  check('390px 가로 오버플로 0건', !base.overflow);
  await page.screenshot({ path: `${OUT}/88-settings-save-buttons.png` });

  /* ---------- 2) 초안 → 저장 (알림 대상) ---------- */
  await page.locator('#settings-notify .notify-target button', { hasText: '전체 종목' }).click();
  await page.waitForTimeout(250);
  const drafted = await storage();
  const targetBtn = await saveState('notify-target');
  check('알림 대상 클릭만으로는 저장되지 않음', drafted.settings.notifyTarget !== 'all', String(drafted.settings.notifyTarget));
  check('초안이 생기면 저장 버튼 활성 + "저장 안 됨"', !targetBtn.disabled && targetBtn.state === 'dirty' && targetBtn.text === '저장', JSON.stringify(targetBtn));
  await page.locator('[data-save="notify-target"]').click();
  await page.waitForTimeout(250);
  const targetSaved = await saveState('notify-target');
  const targetStored = await storage();
  check('저장 클릭 → ✓ 저장됨', targetSaved.text === '✓ 저장됨' && targetSaved.state === 'saved', JSON.stringify(targetSaved));
  check('저장 클릭 → localStorage notifyTarget = all', targetStored.settings.notifyTarget === 'all', String(targetStored.settings.notifyTarget));

  /* ---------- 3) 리스크 저장 → 자동매매 동기화 ---------- */
  await page.locator('#settings-profile [data-risk-preset="5"]').click();
  await page.waitForTimeout(200);
  const riskDraftStorage = await storage();
  check('리스크 5% 선택만으로는 저장되지 않음', riskDraftStorage.settings.riskPct === 1.5, String(riskDraftStorage.settings.riskPct));
  check('리스크 저장 버튼 활성', !(await saveState('risk')).disabled);
  await page.locator('#settings-profile [data-save="risk"]').click();
  await page.waitForTimeout(300);
  const risk5 = await storage();
  const riskBtn = await saveState('risk');
  check('리스크 5% 저장 → ✓ 저장됨', riskBtn.text === '✓ 저장됨', JSON.stringify(riskBtn));
  check(
    '리스크 5% → 설정·자동매매 모두 5%',
    risk5.settings.riskPct === 5 && risk5.auto.riskPct === 5,
    `settings=${risk5.settings.riskPct} auto=${risk5.auto.riskPct}`,
  );

  // 직접 입력 2.5%
  const riskInput = page.locator('#settings-profile [data-risk-input]');
  await riskInput.fill('2.5');
  await page.waitForTimeout(150);
  await page.locator('#settings-profile [data-save="risk"]').click();
  await page.waitForTimeout(300);
  const risk25 = await storage();
  check(
    '직접 입력 2.5% 저장 → 설정·자동매매 모두 2.5%',
    risk25.settings.riskPct === 2.5 && risk25.auto.riskPct === 2.5,
    `settings=${risk25.settings.riskPct} auto=${risk25.auto.riskPct}`,
  );

  // 자동매매 화면에도 즉시 반영
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-auto[data-menu="auto"]').click();
  await page.waitForSelector('[data-auto-hero]', { timeout: 20000 });
  await page.waitForTimeout(400);
  const autoHero = clean(await page.locator('[data-auto-hero]').innerText());
  const autoRiskField = await read(() => document.querySelector('[data-auto-guards] .num-field input')?.value ?? '');
  check(
    '자동매매 화면 리스크 필드에 저장한 2.5% 표시',
    autoRiskField === '2.5',
    `field=${autoRiskField} · hero=${autoHero.slice(0, 70)}`,
  );
  await page.screenshot({ path: `${OUT}/89-autotrade-risk-synced.png` });

  /* ---------- 4) 매매 스타일·프리셋 제거 — 숫자만 남는다 ---------- */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-profile', { timeout: 20000 });
  await page.waitForTimeout(400);
  const noStyle = await read(() => ({
    styleRows: [...document.querySelectorAll('.settings-tab .setting-name')].filter((el) => /매매 스타일|매매 성향/.test(el.textContent ?? '')).length,
    stylePick: document.querySelectorAll('.settings-tab [data-style-pick]').length,
    presetNote: document.querySelectorAll('.settings-tab [data-style-preset-note]').length,
    profileCell: [...document.querySelectorAll('#settings-profile .profile-cell span')].map((e) => e.textContent?.trim()),
    settingRequired: !!document.querySelector('#settings-profile [data-settings-levrec]'),
  }));
  check('설정 탭에 매매 스타일·매매 성향 다시 설정 행이 없다', noStyle.styleRows === 0, String(noStyle.styleRows));
  check('설정 탭에 스타일 선택·프리셋 요약이 없다', noStyle.stylePick === 0 && noStyle.presetNote === 0);
  check('내 매매 기준 카드 = 계좌 잔고 · 추천 레버리지', noStyle.settingRequired && noStyle.profileCell.includes('추천 레버리지'), noStyle.profileCell.join(' / '));

  // ②에서 저장한 리스크·안전장치는 다른 화면이 덮어쓰지 않는다
  const autoBefore = (await storage()).auto;
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-auto[data-menu="auto"]').click();
  await page.waitForSelector('[data-auto-guards]', { timeout: 20000 });
  await page.waitForTimeout(400);
  const afterOpen = (await storage()).auto;
  check(
    '자동매매 화면을 열어도 저장값이 그대로(프리셋 덮어쓰기 없음)',
    JSON.stringify(autoBefore) === JSON.stringify(afterOpen),
    `${afterOpen.riskPct}% · ${afterOpen.maxLeverage}x · ${afterOpen.dailyLossPct}%`,
  );

  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-profile', { timeout: 20000 });
  await page.waitForTimeout(400);

  /* ---------- 5) 알림 토글·ntfy ---------- */
  await page.locator('#settings-notify .switch').click();
  await page.waitForTimeout(200);
  check('알림 토글만으로는 저장되지 않음', (await storage()).settings.notifyEnabled !== false);
  await page.locator('[data-save="notify-enabled"]').click();
  await page.waitForTimeout(250);
  check('알림 OFF 저장', (await storage()).settings.notifyEnabled === false);
  await page.locator('#settings-notify .switch').click();
  await page.waitForTimeout(150);
  await page.locator('[data-save="notify-enabled"]').click();
  await page.waitForTimeout(250);
  check('알림 ON 저장', (await storage()).settings.notifyEnabled === true);

  const ntfyInput = page.locator('#settings-notify .td-key-input');
  await ntfyInput.fill('cota-e2e-topic');
  await page.waitForTimeout(150);
  await page.locator('[data-save="ntfy"]').click();
  await page.waitForTimeout(250);
  const ntfySaved = await saveState('ntfy');
  check('ntfy 토픽 저장 → ✓ 저장됨 · localStorage', ntfySaved.text === '✓ 저장됨' && (await storage()).settings.notifyNtfy === 'cota-e2e-topic', JSON.stringify(ntfySaved));
  await page.locator('#settings-notify .ghost-btn', { hasText: '삭제' }).click();
  await page.waitForTimeout(250);
  check('ntfy 삭제 → 빈 값 저장', (await storage()).settings.notifyNtfy === '');

  /* ---------- 6) 스캐너 항목 ---------- */
  for (const [name, label] of [
    ['leverage', '20x'],
    ['min-rr', '2.0R'],
    ['refresh', '꺼짐'],
  ]) {
    const row = page.locator('.setting-row', { has: page.locator(`[data-save="${name}"]`) });
    await row.scrollIntoViewIfNeeded();
    await row.locator('.segmented button', { hasText: label }).click();
    await page.waitForTimeout(150);
    await page.locator(`[data-save="${name}"]`).click();
    await page.waitForTimeout(250);
  }
  const soundRow = page.locator('.setting-row', { has: page.locator('[data-save="sound"]') });
  await soundRow.scrollIntoViewIfNeeded();
  await soundRow.locator('.switch').click();
  await page.waitForTimeout(150);
  await page.locator('[data-save="sound"]').click();
  await page.waitForTimeout(300);
  const scanner = await storage();
  check(
    '스캐너 설정 저장(레버리지 20x · 손익비 2.0R · 갱신 꺼짐 · 알림음 ON)',
    scanner.settings.leverage === 20 &&
      scanner.settings.minRR === 2 &&
      scanner.settings.refreshSec === 0 &&
      scanner.settings.sound === true,
    `${scanner.settings.leverage}x · ${scanner.settings.minRR}R · ${scanner.settings.refreshSec} · sound=${scanner.settings.sound}`,
  );
  check('스캐너 저장 버튼도 ✓ 저장됨', (await saveState('leverage')).text === '✓ 저장됨');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/91-settings-saved-all.png`, fullPage: true, scale: 'css' });

  /* ---------- 7) 새로고침 후 유지 ---------- */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav button[data-tab="settings"]', { timeout: 60000 });
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-profile', { timeout: 30000 });
  await page.waitForTimeout(700);
  const afterReload = await read(() => {
    const flat = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
    return {
      riskChipOn: flat(document.querySelector('#settings-profile [data-risk-preset].on')?.textContent),
      riskInput: document.querySelector('#settings-profile [data-risk-input]')?.value,
      levCell: flat(document.querySelectorAll('#settings-profile .profile-cell b')[1]?.textContent),
      targetOn: flat(document.querySelector('#settings-notify .notify-target button.on')?.textContent),
      ntfy: document.querySelector('#settings-notify .td-key-input')?.value,
      dirty: [...document.querySelectorAll('.settings-tab [data-save]')].filter((b) => !b.disabled).length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(
    '새로고침 후 저장값 유지(리스크 2.5% · 추천 레버리지 · 알림 전체 · ntfy 빈 값)',
    afterReload.riskInput === '2.5' && afterReload.levCell === 'COTA 유동 추천' && afterReload.targetOn === '전체 종목' && afterReload.ntfy === '',
    JSON.stringify(afterReload),
  );
  check('저장 직후에는 모든 저장 버튼 다시 비활성', afterReload.dirty === 0, `${afterReload.dirty}개 활성`);
  check('새로고침 후에도 가로 오버플로 0건', !afterReload.overflow);

  /* ---------- 8) 오류 ---------- */
  const ignorable = (t) => /api\.github\.com|rate limit|Failed to fetch|net::ERR|401|403/i.test(t);
  const realErrors = consoleErrors.filter((t) => !ignorable(t));
  check('콘솔 에러 0건', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  check('페이지 에러 0건', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  writeFileSync('.tmp/settings-e2e-report.json', JSON.stringify({ checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log('');
  console.log(`설정 저장 E2E: ${checks.length - failed.length}/${checks.length} 통과`);
  if (failed.length) {
    console.log(`실패: ${failed.map((c) => c.name).join(' · ')}`);
    process.exitCode = 1;
  }
  await browser.close();
};

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      process.kill(-server.pid);
    } catch {
      /* 이미 종료 */
    }
  });
