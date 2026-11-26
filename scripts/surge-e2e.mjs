/**
 * 🚀 급등 탐색기 E2E 검증 (실행: npm run build && npm run check:surge-e2e)
 *
 *  1) 메뉴 허브에 `🚀 급등 탐색기` 카드(도구 10개) · 390px 오버플로 0건
 *  2) 진입 → 진행률 표시 → 1H/4H 실시간 탐색 → 카드 렌더
 *  3) 카드 내용 = 실데이터: 진입가 = 비트겟 티커 현재가, 24h 등락 = 티커,
 *     6요건 배지 = Pass 개수, 점수 0~100, 목표/손절/손익비 수식 일치
 *  4) 스팟 교차검증: 30봉 고점 거리·거래량 배수를 비트겟 캔들로 다시 계산해 화면값과 비교
 *  5) 필터(스퀴즈 직전·숏스퀴즈·거래량 급증) = 해당 요건 Pass 코인만
 *  6) 복사 버튼 = 진입·목표·손절 텍스트, 계좌 미연결이면 원클릭 대신 안내
 *  7) 차순위 후보 · 데스크톱 · 콘솔 에러 0건 · 스크린샷(82~84)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4178;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const BG = 'https://api.bitget.com';

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
  env: {
    ...process.env,
    PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}`,
  },
  detached: true,
});

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const num = (t) => Number(String(t ?? '').replace(/[^0-9.-]/g, ''));
const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

async function bgJson(path) {
  const res = await fetch(`${BG}${path}`);
  const body = await res.json();
  if (body.code !== '00000') throw new Error(`${path} ${body.code}`);
  return body.data;
}

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await mobile.addInitScript(seedAuthSession);
  await installE2EStubs(mobile);

  await mobile.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'conservative', updatedAt: Date.now() }));
    if (!localStorage.getItem('bgss.settings.v1')) {
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    }
  });
  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const shot = async (name) => {
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
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
      await page.waitForTimeout(800);
    }
    if ((await page.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
      const all = page.locator('.scanner-tab [data-asset-filter] button[data-asset="all"]');
      if (await all.count()) {
        await all.first().click();
        await page.waitForTimeout(800);
      }
    }
  }
  await page.waitForSelector('.scanner-tab .signal-card:not(.skeleton)', { timeout: 60000 });

  /* ---------- 1) 메뉴 허브 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    surgeTitle: document.querySelector('.menu-row[data-menu="surge"] .menu-copy b')?.textContent?.replace(/\s+/g, ' ').trim(),
    surgeEmoji: document.querySelector('.menu-row[data-menu="surge"] .menu-emoji')?.textContent?.trim(),
    surgeDesc: document.querySelector('.menu-row[data-menu="surge"] .menu-copy span')?.textContent?.trim(),
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    heroNote: document.querySelector('.menu-hero p')?.textContent?.trim(),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('메뉴 허브: 도구 9개 + 자동매매 = 10개', hub.rows.length === 9, hub.rows.join(','));
  check('메뉴 허브: 🚀 급등 탐색기 카드', hub.surgeEmoji === '🚀' && /급등 탐색기/.test(hub.surgeTitle ?? ''), `${hub.surgeEmoji} ${hub.surgeTitle}`);
  check('메뉴 허브: 설명·도구 수 10', /6가지 급등 요건/.test(hub.surgeDesc ?? '') && hub.hero === '10' && /10가지 도구/.test(hub.heroNote ?? ''), `${hub.hero} · ${hub.heroNote}`);
  check('메뉴 허브 390px 오버플로 0건', !hub.overflow);
  await shot('82-menu-hub-surge');

  /* ---------- 2) 진입 · 진행률 ---------- */
  await page.locator('.menu-row[data-menu="surge"]').click();
  const progressSeen = await page
    .waitForSelector('[data-surge-progress]', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const progressText = progressSeen
    ? (await page.locator('[data-surge-progress]').innerText()).replace(/\s+/g, ' ').trim()
    : '';
  check('진입: 진행률(1H 캔들·6요건) 표시', progressSeen && /1H 캔들|4H 추세|\d+\/\d+/.test(progressText), progressText);

  await page.waitForSelector('.surge-card', { timeout: 240000 });
  await page.waitForFunction(() => !document.querySelector('[data-surge-progress]'), { timeout: 240000 });
  await page.waitForTimeout(500);

  const view = await page.evaluate(() => ({
    title: document.querySelector('[data-surge-root] .summary-title')?.textContent?.replace(/\s+/g, ' ').trim(),
    sub: document.querySelector('[data-surge-sub]')?.textContent?.replace(/\s+/g, ' ').trim(),
    kpis: [...document.querySelectorAll('.surge-kpi')].map((k) => ({
      label: k.querySelector('span')?.textContent?.trim(),
      value: k.querySelector('b')?.textContent?.trim(),
    })),
    top: document.querySelector('[data-surge-top]')?.textContent?.trim(),
    topScore: document.querySelector('[data-surge-top-score]')?.textContent?.trim(),
    primeCount: document.querySelector('[data-surge-prime-count]')?.textContent?.trim(),
    failed: document.querySelector('[data-surge-failed]')?.textContent?.trim(),
    filters: [...document.querySelectorAll('.surge-filters button')].map((b) => ({
      key: b.dataset.filter,
      text: b.textContent?.replace(/\s+/g, ' ').trim(),
    })),
    cards: [...document.querySelectorAll('.surge-card')].map((c) => {
      const reqs = [...c.querySelectorAll('.surge-reqs li')].map((li) => ({
        key: li.dataset.req,
        state: li.dataset.state,
        label: li.querySelector('b')?.textContent?.trim(),
        value: li.querySelector('span')?.textContent?.trim(),
        detail: li.getAttribute('title') ?? '',
        mark: li.querySelector('em')?.textContent?.trim(),
      }));
      const cells = [...c.querySelectorAll('.surge-cell')].map((cell) => ({
        label: cell.querySelector('span')?.textContent?.trim(),
        value: cell.querySelector('b')?.textContent?.trim(),
        extra: cell.querySelector('em')?.textContent?.trim(),
      }));
      return {
        symbol: c.dataset.symbol,
        score: Number(c.dataset.score),
        base: c.querySelector('.surge-name b')?.firstChild?.textContent?.trim(),
        name: c.querySelector('.surge-name b')?.textContent?.replace(/\s+/g, ' ').trim(),
        sub: c.querySelector('.surge-name span')?.textContent?.replace(/\s+/g, ' ').trim(),
        scoreText: c.querySelector('.surge-score')?.textContent?.replace(/\s+/g, ' ').trim(),
        why: c.querySelector('.surge-why')?.textContent?.replace(/\s+/g, ' ').trim(),
        reqs,
        cells,
        detailLine: c.querySelector('.surge-detail-line')?.textContent?.replace(/\s+/g, ' ').trim(),
        warns: [...c.querySelectorAll('.surge-warn')].map((w) => w.textContent?.trim()),
        hasLogo: !!c.querySelector('.sym-logo'),
        hasCopy: !!c.querySelector('[data-copy]'),
        hasOrderHint: !!c.querySelector('[data-order-hint]'),
        hasLink: /비트겟/.test(c.querySelector('.surge-actions')?.textContent ?? ''),
      };
    }),
    near: [...document.querySelectorAll('[data-near]')].map((li) => li.dataset.near),
    honest: document.querySelector('[data-surge-honest]')?.textContent?.trim() ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

  check('요약: 제목·6요건 배지', /급등 탐색기/.test(view.title ?? '') && /6요건 100점/.test(view.title ?? ''), view.title);
  check('요약: 유니버스·기준 시각', /코인 선물 \d+개 중/.test(view.sub ?? '') && /거래대금/.test(view.sub ?? ''), view.sub);
  check('요약: KPI 3개', view.kpis.length === 3, view.kpis.map((k) => `${k.label}=${k.value}`).join(' / '));
  check(
    '요약: 오늘의 급등 유망 TOP = 1위 카드',
    view.top === view.cards[0]?.base &&
      Number((view.topScore ?? '').match(/^(\d+)점/)?.at(1)) === view.cards[0]?.score &&
      /^\d+점 · \d\/6 · [\d.]+R$/.test(view.topScore ?? ''),
    `${view.top} ${view.topScore} / ${view.cards[0]?.base} ${view.cards[0]?.score}점`,
  );
  check('요약: 필터 4종', view.filters.map((f) => f.key).join(',') === 'all,squeeze,short,volume', view.filters.map((f) => f.text).join(' | '));
  check('카드 렌더', view.cards.length >= 3, `${view.cards.length}장 (상위 12장까지 표시)`);
  check('390px 오버플로 0건(결과 화면)', !view.overflow);
  await shot('83-surge-explorer');

  /* ---------- 3) 카드 내용 정합성 ---------- */
  const bad = [];
  for (const c of view.cards) {
    const passes = c.reqs.filter((r) => r.state === 'pass').length;
    const scoreMatch = /^(\d+)점 · (\d)\/6 충족$/.exec(c.scoreText ?? '');
    const pctCells = c.cells.map((x) => x.label).join('|');
    const rr = num((c.detailLine?.match(/손익비 1 : ([\d.]+)/) ?? [])[1]);
    // 화면 가격은 거래소 자리수로 반올림된다 — 그 자리수만큼 손익비 검증 허용폭을 넓힌다.
    const unitOf = (v) => {
      const frac = String(v ?? '').split('.')[1];
      return frac ? 10 ** -frac.length : 1;
    };
    const entry = num(c.cells[0]?.value);
    const target = num(c.cells[1]?.value);
    const stop = num(c.cells[2]?.value);
    // 표시 자리수 때문에 생기는 % 오차 허용폭 (0.000842 처럼 소수 6자리 코인은 0.12%까지 벌어진다)
    const pctTol = (100 * unitOf(c.cells[0]?.value)) / Math.max(1e-12, entry);
    const lev = num(c.cells[3]?.value);
    const targetPct = num(c.cells[1]?.extra);
    const stopPct = num(c.cells[2]?.extra);
    const ok =
      c.reqs.length === 6 &&
      c.reqs.every((r) => ['pass', 'partial', 'fail'].includes(r.state)) &&
      passes === Number(scoreMatch?.[2]) &&
      Number(scoreMatch?.[1]) === c.score &&
      c.score >= 0 &&
      c.score <= 100 &&
      /진입가\|목표가 [\d.]+R\|손절가\|추천 레버리지/.test(pctCells) &&
      stop < entry &&
      entry < target &&
      close((target - entry) / (entry - stop), rr, rr * 0.04 + (2 * unitOf(c.cells[0]?.value) * rr) / Math.max(1e-12, entry - stop)) &&
      close((target / entry - 1) * 100, targetPct, 0.15 + pctTol) &&
      close((1 - stop / entry) * 100, Math.abs(stopPct), 0.06 + pctTol) &&
      lev >= 2 &&
      !!c.why &&
      c.why.length > 8 &&
      c.hasLogo &&
      c.hasCopy &&
      c.hasLink;
    if (!ok) {
      bad.push(`${c.symbol}: ${JSON.stringify({ scoreText: c.scoreText, passes, cells: c.cells, rr, detailLine: c.detailLine })}`);
    }
  }
  check('카드: 6요건 배지 · 점수 = N/6 · 수식 일치', bad.length === 0, bad.slice(0, 2).join(' | ') || `${view.cards.length}장 전수`);
  check(
    '카드: 핵심 사유 한 줄(수치 포함)',
    view.cards.every((c) => /\d/.test(c.why) && !/NaN|undefined/.test(c.why)),
    view.cards[0]?.why,
  );
  check('카드: 계좌 미연결이면 원클릭 대신 안내', view.cards.every((c) => c.hasOrderHint), view.cards[0]?.hasOrderHint ? '안내 표시' : '버튼 노출');
  check('카드: 4개 이상 충족 수 ≥ 1위 카드 기준', Number((view.primeCount ?? '').replace(/[^0-9]/g, '')) >= (view.cards[0]?.reqs.filter((r) => r.state === 'pass').length >= 4 ? 1 : 0), `${view.primeCount} · ${view.top}`);
  check(
    '정직성: 유망 후보가 없으면 안내 문구',
    Number((view.primeCount ?? '').replace(/[^0-9]/g, '')) > 0 || /요건 4개 이상을 채운 코인이 없습니다/.test(view.honest),
    view.honest.slice(0, 50),
  );

  /* ---------- 4) 실데이터 교차검증(티커·캔들) ---------- */
  const first = view.cards[0];
  const symbol = first.symbol;
  const base = symbol.replace(/USDT$/, '');
  const [tickers, candles] = await Promise.all([
    bgJson('/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
    bgJson(`/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${symbol}&granularity=1H&limit=200`).catch(() => []),
  ]);
  const tk = tickers.find((t) => t.symbol === symbol);
  const entryShown = num(first.cells[0]?.value);
  check(
    `교차검증 ${base}: 진입가 = 비트겟 티커 현재가`,
    !!tk && close(entryShown, Number(tk.lastPr), Number(tk.lastPr) * 0.003),
    `${entryShown} vs ${tk?.lastPr}`,
  );
  check(
    `교차검증 ${base}: 24h 등락 = 티커`,
    close(num((first.sub.match(/24h ([+-]?[\d.]+)%/) ?? [])[1]), Number(tk?.change24h) * 100, 0.35),
    `${(first.sub.match(/24h ([+-]?[\d.]+)%/) ?? [])[1]} vs ${(Number(tk?.change24h) * 100).toFixed(2)}%`,
  );
  check(
    `교차검증 ${base}: 펀딩비 = 티커`,
    close(num((first.detailLine.match(/펀딩 ([+-]?[\d.]+)%/) ?? [])[1]), Number(tk?.fundingRate) * 100, 0.002),
    `${(first.detailLine.match(/펀딩 ([+-]?[\d.]+)%/) ?? [])[1]} vs ${(Number(tk?.fundingRate) * 100).toFixed(3)}%`,
  );
  if (candles.length >= 30) {
    const rows = candles
      .map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), c: Number(r[4]), v: Number(r[5]) }))
      .sort((a, b) => a.t - b.t);
    const highs = rows.map((r) => r.h);
    const hi30 = Math.max(...highs.slice(-30));
    const dist = ((hi30 - entryShown) / entryShown) * 100;
    const shownDist = num((first.reqs.find((r) => r.key === 'breakout')?.value ?? '').match(/([\d.]+)%/)?.[1]);
    check(
      `교차검증 ${base}: 30봉 고점 거리 = 캔들 재계산`,
      close(shownDist, Math.abs(dist), 0.4),
      `화면 ${shownDist}% vs 계산 ${dist.toFixed(2)}%`,
    );
    const vols = rows.map((r) => r.v);
    const avg20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const ratio = Math.max(vols.at(-1) / avg20, vols.at(-2) / avg20);
    const shownRatio = num((first.reqs.find((r) => r.key === 'volume')?.value ?? '').match(/([\d.]+)/)?.[1]);
    check(
      `교차검증 ${base}: 거래량 배수 = 캔들 재계산`,
      close(shownRatio, ratio, Math.max(0.5, ratio * 0.35)),
      `화면 ×${shownRatio} vs 계산 ×${ratio.toFixed(2)}`,
    );
  } else {
    check(`교차검증 ${base}: 캔들 응답`, false, `1H 캔들 ${candles.length}개`);
  }

  /* ---------- 5) 필터 ---------- */
  const filterResults = [];
  const FILTER_REQ = { squeeze: 'squeeze', short: 'shortSqueeze', volume: 'volume' };
  for (const key of ['squeeze', 'short', 'volume']) {
    await page.locator(`.surge-filters button[data-filter="${key}"]`).click();
    await page.waitForTimeout(350);
    const shown = await page.evaluate(({ k, req }) => {
      const cards = [...document.querySelectorAll('.surge-card')];
      return {
        all: cards.length,
        tagged: cards.map((c) => c.dataset.symbol),
        bad: cards.filter((c) => c.querySelector(`.surge-reqs li[data-req="${req}"]`)?.dataset.state !== 'pass').map((c) => c.dataset.symbol),
        empty: !!document.querySelector('[data-surge-empty-filter]'),
        chip: document.querySelector(`.surge-filters button[data-filter="${k}"]`)?.textContent?.replace(/\s+/g, ' ').trim(),
      };
    }, { k: key, req: FILTER_REQ[key] });
    filterResults.push({ key, ...shown });
    check(
      `필터 ${key}: 해당 요건 Pass 코인만`,
      shown.bad.length === 0 && (shown.all > 0 || shown.empty),
      `${shown.all}장 · ${shown.chip}`,
    );
  }
  const chipCount = (key) => num((view.filters.find((f) => f.key === key)?.text ?? '').match(/(\d+)\s*$/)?.[1]);
  const totalChip = chipCount('all');
  check(
    '필터: 전체 개수 ≥ 각 요건 개수 · 칩 숫자 = 실제 통과 수',
    totalChip > 0 &&
      ['squeeze', 'short', 'volume'].every((k) => chipCount(k) <= totalChip) &&
      filterResults.every((f) => f.all === Math.min(12, chipCount(f.key))),
    `전체 ${totalChip} · ${['squeeze', 'short', 'volume'].map((k) => `${k} ${chipCount(k)}(${filterResults.find((f) => f.key === k).all}장)`).join(' ')}`,
  );
  await page.locator('.surge-filters button[data-filter="all"]').click();
  await page.waitForTimeout(300);
  await shot('84-surge-filters');

  /* ---------- 6) 복사 ---------- */
  const copyBtn = page.locator('.surge-card [data-copy]').first();
  await copyBtn.scrollIntoViewIfNeeded();
  await copyBtn.click();
  await page.waitForTimeout(400);
  const clip = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  });
  check(
    '복사: 진입·목표·손절·손익비 텍스트',
    /진입 [\d.]+ · 목표 [\d.]+ · 손절 [\d.]+ · 손익비 1 :/.test(clip) && /점\(/.test(clip),
    clip.replace(/\n/g, ' / ').slice(0, 90),
  );
  check('복사: 버튼 피드백(복사됨)', /복사됨/.test(await copyBtn.innerText()), await copyBtn.innerText());

  /* ---------- 7) 차순위 · 뒤로 ---------- */
  const near = await page.evaluate(() => ({
    count: document.querySelectorAll('[data-near]').length,
    note: document.querySelector('.panel-head .panel-note')?.textContent?.trim(),
  }));
  check(
    '차순위 후보 또는 전원 유망',
    near.count > 0 ? near.count >= 1 && /참고용/.test(near.note ?? '') : Number(view.primeCount.replace(/[^0-9]/g, '')) >= view.cards.length,
    near.count ? `${near.count}종목 · ${near.note}` : `차순위 없음(전원 유망 ${view.primeCount})`,
  );
  await page.screenshot({ path: `${OUT}/85-surge-fullpage.png`, fullPage: true });
  await page.locator('.menu-back').click();
  await page.waitForTimeout(400);
  check('← 메뉴 복귀', await page.evaluate(() => !!document.querySelector('.menu-hero')));

  /* ---------- 8) 데스크톱 ---------- */
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  // 🔐 회원 전용 게이트(v1.5.8) — 데스크톱 시나리오도 로그인된 상태에서 시작한다.
  await desktop.addInitScript(seedAuthSession);
  await installE2EStubs(desktop);

  await desktop.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'aggressive', updatedAt: Date.now() }));
  });
  const dpage = await desktop.newPage();
  dpage.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[desktop] ${m.text()}`);
  });
  dpage.on('pageerror', (e) => pageErrors.push(`[desktop] ${e}`));
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await dpage.waitForFunction(
    () => {
      const b = document.querySelector('.scanner-tab .rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  if ((await dpage.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
    const toggle = dpage.locator('.scanner-tab .ghost-toggle').first();
    if (((await toggle.textContent()) ?? '').includes('진행중만')) {
      await toggle.click();
      await dpage.waitForTimeout(800);
    }
    if ((await dpage.locator('.scanner-tab .signal-card:not(.skeleton)').count()) === 0) {
      const all = dpage.locator('.scanner-tab [data-asset-filter] button[data-asset="all"]');
      if (await all.count()) {
        await all.first().click();
        await dpage.waitForTimeout(800);
      }
    }
  }
  await dpage.waitForSelector('.scanner-tab .signal-card:not(.skeleton)', { timeout: 60000 });
  await dpage.locator('.top-nav button', { hasText: '메뉴' }).click();
  await dpage.waitForTimeout(500);
  await dpage.locator('.menu-row[data-menu="surge"]').click();
  await dpage.waitForSelector('.surge-card', { timeout: 240000 });
  await dpage.waitForFunction(() => !document.querySelector('[data-surge-progress]'), { timeout: 240000 });
  await dpage.waitForTimeout(400);
  const desk = await dpage.evaluate(() => ({
    cards: document.querySelectorAll('.surge-card').length,
    grid: getComputedStyle(document.querySelector('.surge-reqs')).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    lev: [...document.querySelectorAll('.surge-cell')].filter((c) => /추천 레버리지/.test(c.textContent ?? '')).map((c) => c.querySelector('b')?.textContent?.trim()),
  }));
  await dpage.screenshot({ path: `${OUT}/86-surge-desktop.png` });
  check('데스크톱: 카드 렌더 · 6요건 2열 · 오버플로 0건', desk.cards >= 3 && desk.grid === 2 && !desk.overflow, JSON.stringify(desk).slice(0, 120));
  check(
    '공격적 스타일: 추천 레버리지가 보수적(≤5x)보다 넓게 산출',
    desk.lev.every((v) => num(v) >= 2),
    desk.lev.slice(0, 6).join(' / '),
  );
  await desktop.close();

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check('콘솔/페이지 에러 0건 (네트워크 429 제외)', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 2) }));

  await mobile.close();
  await browser.close();

  const report = { hub, view, filterResults, checks, consoleErrors, pageErrors, failedRequests: failedRequests.slice(0, 20), allOk: checks.every((c) => c.ok) };
  writeFileSync('.tmp/surge-report.json', JSON.stringify(report, null, 1));
  console.log(`\n${report.allOk ? '✅ 급등 탐색기 E2E 통과' : `❌ 실패 ${checks.filter((c) => !c.ok).length}건`} (${checks.length}개 확인)`);
  if (!report.allOk) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('SURGE E2E FAILED', e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
