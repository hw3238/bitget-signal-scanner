/**
 * 🧠🧲🌊 매매 DNA · 청산 자석 · 섹터 순환 레이더 E2E 검증
 *   실행: npm run build && npm run innovations-e2e
 *
 *  1) 메뉴 허브: 도구 12개 + 자동매매 = 13개 · 세 카드(🧠🧲🌊) · 390px 오버플로 0건
 *  2) 🧠 매매 DNA: 심어 둔 매매일지(8건)로 승률·누적 R·시간대·배율·복수매매를 **직접 재계산해 비교**
 *     · 쿨다운 토글 → 자동매매 설정에 저장 · 데모 모드(DEMO 표기) · 기록 0건 안내
 *  3) 🧲 청산 자석: 카드 현재가 = 비트겟 실시간 티커 · 점수 0~100 · 상방 청산가 > 현재가 > 하방 청산가
 *     · 레버리지 표 단조성(숏 10x > 20x > 25x > 50x, 롱 반대) · 펀딩/OI 칩
 *  4) 🌊 섹터: 7섹터 · 점수 내림차순 · 1위 = 상단 KPI · 대장주 등락률 = 거래소 티커 실데이터
 *  5) 데스크톱 · 콘솔 에러 0건 · 스크린샷(156~161)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4181;
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

/* 매매일지 시드 — 8건 종료(4승 4패) · 오전 승리 / 심야·고배 손실 / 손실 15분 뒤 재진입 1건 */
function seedJournal() {
  const H = 3_600_000;
  const now = Date.now();
  const kstAt = (daysAgo, hour, minute = 0) => {
    const d = new Date(now - daysAgo * 86_400_000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), hour - 9, minute, 0);
  };
  const mk = (id, patch) => ({
    id,
    symbol: patch.symbol ?? 'BTCUSDT',
    base: patch.base ?? 'BTC',
    asset: 'crypto',
    tf: '1H',
    side: patch.side ?? 'long',
    strategyId: 'crt-fvg-cisd',
    strategyShort: 'CRT·FVG·CISD',
    entry: 100,
    stop: 98,
    target: 104,
    rr: 2,
    riskPct: 2,
    detectedAt: patch.at,
    firstSeen: patch.at,
    state: patch.state,
    r: patch.r,
    bars: patch.bars ?? 2,
    ...(patch.lev ? { leverage: patch.lev } : {}),
  });
  const rows = [
    mk('w1', { at: kstAt(6, 9), state: 'win', r: 1.8, lev: 8, bars: 3 }),
    mk('w2', { at: kstAt(5, 9), state: 'win', r: 1.8, lev: 8, bars: 3 }),
    mk('w3', { at: kstAt(3, 9), state: 'win', r: 1.8, lev: 8, bars: 3 }),
    mk('w4', { at: kstAt(2, 9), state: 'win', r: 1.8, lev: 8, bars: 3 }),
    mk('l1', { at: kstAt(4, 22, 30), state: 'loss', r: -1, lev: 25, bars: 1, side: 'short' }),
    mk('l2', { at: kstAt(4, 23, 45), state: 'loss', r: -1, lev: 25, bars: 1, side: 'short' }),
    mk('l3', { at: kstAt(7, 16), state: 'loss', r: -1, lev: 20, side: 'long' }),
    mk('l4', { at: kstAt(8, 21), state: 'loss', r: -1, lev: 3, side: 'long' }),
  ];
  const mine = rows.map((r) => ({ key: `${r.symbol}|${r.tf}|${r.side}|${r.detectedAt}`, enteredAt: r.detectedAt, memo: '' }));
  localStorage.setItem('bgss.history.v1', JSON.stringify(rows));
  localStorage.setItem('bgss.mytrades.v1', JSON.stringify(mine));
  return { rows, mine };
}

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const consoleErrors = [];
  const pageErrors = [];

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await mobile.addInitScript(seedAuthSession);
  await installE2EStubs(mobile);
  await mobile.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'conservative', updatedAt: Date.now() }));
    if (!localStorage.getItem('bgss.settings.v1')) localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
  });
  await mobile.addInitScript(seedJournal);

  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const shot = async (name, fullPage = false) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  };
  const openMenu = async (key) => {
    await page.locator(`.menu-row[data-menu="${key}"]`).click();
    await page.waitForTimeout(500);
  };
  const backToMenu = async () => {
    await page.locator('.menu-back').click();
    await page.waitForTimeout(300);
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // 전체 스캔(모든 마켓) 완료를 기다리지 않는다 — 세 화면 중 DNA 는 기록만, 섹터는 티커만,
  // 청산 자석은 자기 캔들을 직접 받는다. 스캔은 뒤에서 계속 돌아도 무방하다.
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 30000 });

  /* ---------- 1) 메뉴 허브 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    note: document.querySelector('.menu-hero p')?.textContent?.trim(),
    dna: document.querySelector('.menu-row[data-menu="dna"] .menu-emoji')?.textContent?.trim(),
    magnet: document.querySelector('.menu-row[data-menu="magnet"] .menu-emoji')?.textContent?.trim(),
    sector: document.querySelector('.menu-row[data-menu="sector"] .menu-emoji')?.textContent?.trim(),
    magnetDesc: document.querySelector('.menu-row[data-menu="magnet"] .menu-copy span')?.textContent?.trim(),
    auto: document.querySelectorAll('.menu-auto').length,
  }));
  check(
    '메뉴: 도구 12개 + 자동매매 = 13개 · 🧠🧲🌊 카드',
    hub.rows.length === 12 && hub.auto === 1 && hub.dna === '🧠' && hub.magnet === '🧲' && hub.sector === '🌊',
    hub.rows.join(','),
  );
  check('메뉴: 도구 수 13 · 문구', hub.hero === '13' && /13가지 도구/.test(hub.note ?? ''), `${hub.hero} · ${hub.note}`);
  check('메뉴: 청산 자석 설명(스윙·펀딩·OI)', /청산/.test(hub.magnetDesc ?? ''), hub.magnetDesc);
  check('메뉴 허브 390px 오버플로 0건', !(await overflow()));
  await shot('156-menu-innovations');

  /* ---------- 2) 🧠 매매 DNA ---------- */
  await openMenu('dna');
  await page.waitForSelector('[data-dna]', { timeout: 20000 });
  const dna = await page.evaluate(() => ({
    basis: document.querySelector('[data-dna-basis]')?.textContent?.trim(),
    headline: document.querySelector('[data-dna-headline]')?.textContent?.trim(),
    cumR: document.querySelector('[data-dna-cumr]')?.textContent?.trim(),
    revenge: document.querySelector('[data-dna-revenge-count]')?.textContent?.trim(),
    buckets: [...document.querySelectorAll('.dna-heat-row')].map((r) => [r.dataset.bucket, Number(r.dataset.n), r.textContent.replace(/\s+/g, ' ').trim()]),
    levs: [...document.querySelectorAll('.dna-lev-row')].map((r) => [r.dataset.lev, Number(r.dataset.n), r.textContent.replace(/\s+/g, ' ').trim()]),
    facts: [...document.querySelectorAll('.dna-fact')].map((f) => f.textContent.replace(/\s+/g, ' ').trim()),
    sides: [...document.querySelectorAll('.dna-side-card')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    cooldown: document.querySelector('[data-dna-cooldown]')?.getAttribute('data-dna-cooldown'),
    empty: !!document.querySelector('[data-dna-empty]'),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('DNA: 내 진입 기록 8건으로 분석', /내 진입 기록 8건/.test(dna.basis ?? '') && !dna.empty, dna.basis);
  check('DNA: 승률 50% · 누적 +3.20R', close(num(dna.cumR), 3.2, 0.001), dna.cumR);
  check('DNA: 히트맵 5구간 · 오전 4건 · 심야 2건', dna.buckets.length === 5 && dna.buckets.find((b) => b[0] === 'morning')?.[1] === 4 && dna.buckets.find((b) => b[0] === 'night')?.[1] === 2, dna.buckets.map((b) => `${b[0]}:${b[1]}`).join(','));
  check(
    'DNA: 오전 100% · 심야 0%',
    /100%/.test(dna.buckets.find((b) => b[0] === 'morning')?.[2] ?? '') && /0%/.test(dna.buckets.find((b) => b[0] === 'night')?.[2] ?? ''),
  );
  check('DNA: 배율 4구간 · 중배 4건 +7.20R · 고배 3건', dna.levs.length === 4 && dna.levs.find((l) => l[0] === 'mid')?.[1] === 4 && /7\.20R/.test(dna.levs.find((l) => l[0] === 'mid')?.[2] ?? '') && dna.levs.find((l) => l[0] === 'high')?.[1] === 3, dna.levs.map((l) => `${l[0]}:${l[1]}`).join(','));
  check('DNA: 복수 매매 = 15분 창 1건', num(dna.revenge) === 1, dna.revenge);
  check('DNA: 진단 문장에 고배 또는 심야 손실', dna.facts.some((f) => /고배|심야/.test(f)), dna.facts[0]?.slice(0, 40));
  check('DNA: 롱·숏 카드 + 보유 시간', dna.sides.length === 2 && /롱/.test(dna.sides[0]) && /숏/.test(dna.sides[1]));
  check('DNA: 쿨다운 기본 꺼짐', dna.cooldown === 'off', dna.cooldown);
  check('DNA 390px 오버플로 0건', !dna.overflow);
  await shot('157-trade-dna', true);

  /* 쿨다운 토글 → 자동매매 설정 저장 */
  await page.locator('[data-dna-cooldown-toggle]').click();
  await page.waitForTimeout(400);
  const cd = await page.evaluate(() => ({
    state: document.querySelector('[data-dna-cooldown]')?.getAttribute('data-dna-cooldown'),
    copy: document.querySelector('.dna-cooldown-copy')?.textContent?.replace(/\s+/g, ' ').trim(),
    status: document.querySelector('[data-dna-cooldown-state]')?.textContent?.trim(),
    cfg: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') ?? '{}'),
  }));
  check('DNA: 쿨다운 토글 ON → 2연패 · 60분', cd.state === 'on' && cd.cfg.cooldownLosses === 2 && cd.cfg.cooldownMin === 60, `losses ${cd.cfg.cooldownLosses} · ${cd.cfg.cooldownMin}분`);
  check('DNA: 지금은 쿨다운 아님(오래된 손실)', /쿨다운 아님/.test(cd.status ?? ''), cd.status);
  await page.locator('[data-dna-cooldown-toggle]').click();
  await page.waitForTimeout(300);
  const cdOff = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.autotrade.config.v1') ?? '{}').cooldownLosses);
  check('DNA: 쿨다운 토글 OFF → 0 저장', cdOff === 0, String(cdOff));

  /* 데모 모드 — 가짜 기록임을 숨기지 않는다 */
  await page.locator('[data-dna-mode="demo"]').click();
  await page.waitForTimeout(400);
  const demo = await page.evaluate(() => ({
    badge: document.querySelector('[data-dna] .tool-badge.down')?.textContent?.trim(),
    basis: document.querySelector('[data-dna-basis]')?.textContent?.trim(),
    note: document.querySelector('[data-dna-demo-note]')?.textContent?.replace(/\s+/g, ' ').trim(),
    revenge: document.querySelector('[data-dna-revenge-count]')?.textContent?.trim(),
    cumR: document.querySelector('[data-dna-cumr]')?.textContent?.trim(),
  }));
  check('DNA 데모: DEMO 배지 + 안내', demo.badge === 'DEMO' && /가짜 기록/.test(demo.note ?? ''), demo.basis);
  check('DNA 데모: 누적 +9.20R(38건) · 복수매매 5회', close(num(demo.cumR), 9.2, 0.01) && num(demo.revenge) === 5, `${demo.cumR} · ${demo.revenge}`);
  await shot('158-trade-dna-demo');
  await page.locator('[data-dna-mode="auto"]').click();
  await page.waitForTimeout(300);
  const backAuto = await page.evaluate(() => document.querySelector('[data-dna-basis]')?.textContent?.trim());
  check('DNA: 데모 → 내 기록 복귀', /내 진입 기록 8건/.test(backAuto ?? ''), backAuto);
  await backToMenu();

  /* ---------- 3) 🧲 청산 자석 ---------- */
  await openMenu('magnet');
  await page.waitForSelector('[data-magnet] [data-card]', { timeout: 180000 });
  await page.waitForTimeout(600);
  const mag = await page.evaluate(() => {
    const card = document.querySelector('[data-magnet] [data-card]');
    const price = card?.querySelector('.magnet-name span')?.textContent ?? '';
    return {
      symbol: card?.getAttribute('data-card'),
      squeeze: Number(card?.getAttribute('data-squeeze')),
      bias: card?.getAttribute('data-bias'),
      priceRaw: price.split('·')[0],
      upScore: Number(card?.querySelector('[data-up-score]')?.getAttribute('data-up-score')),
      downScore: Number(card?.querySelector('[data-down-score]')?.getAttribute('data-down-score')),
      gauges: [...card.querySelectorAll('.magnet-gauge em')].map((e) => e.textContent.trim()),
      chips: [...card.querySelectorAll('.magnet-chips span')].map((e) => e.textContent.trim()),
      cards: document.querySelectorAll('[data-magnet] [data-card]').length,
      top: document.querySelector('[data-magnet] .summary-title .tool-badge:last-child')?.textContent?.trim(),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  const tickerRaw = await bgJson(`/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${mag.symbol}`);
  const ticker = Array.isArray(tickerRaw) ? tickerRaw[0] : tickerRaw;
  const livePrice = Number(ticker.lastPr);
  check('자석: 카드 2개 이상 · 상단 TOP 배지', mag.cards >= 2 && /TOP/.test(mag.top ?? ''), `${mag.cards}장 · ${mag.top}`);
  check(
    `자석: ${mag.symbol} 현재가 = 비트겟 티커`,
    close(num(mag.priceRaw), livePrice, livePrice * 0.004),
    `${num(mag.priceRaw)} vs ${livePrice}`,
  );
  check('자석: 상·하방 점수 0~100 · squeeze = 더 큰 쪽', mag.upScore >= 0 && mag.upScore <= 100 && mag.downScore >= 0 && mag.downScore <= 100 && mag.squeeze === Math.max(mag.upScore, mag.downScore), `${mag.upScore}/${mag.downScore} → ${mag.squeeze}`);
  check('자석: 펀딩·OI 칩', mag.chips.some((c) => /펀딩/.test(c)) && mag.chips.some((c) => /OI/.test(c)), mag.chips.join(' · '));
  check('자석 390px 오버플로 0건', !mag.overflow);
  await shot('159-liquidation-magnet', true);

  /* 카드 펼침 — 레버리지 표 */
  await page.locator('[data-magnet] [data-card]').first().click();
  await page.waitForSelector('[data-magnet-detail]', { timeout: 5000 });
  const levels = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.magnet-levels-row')];
    return rows.map((r) => ({
      cells: [...r.querySelectorAll('span')].map((c) => c.textContent.trim()),
    }));
  });
  const table = levels.map((l) => ({
    lev: num(l.cells[0]),
    up: num((l.cells[1] ?? '').split('(')[0]),
    down: num((l.cells[2] ?? '').split('(')[0]),
  }));
  check('자석: 레버리지 4단 표(10·20·25·50x)', table.length === 4 && table.map((l) => l.lev).join(',') === '10,20,25,50', table.map((l) => l.lev).join(','));
  const upMonotone = table.every((l, i) => i === 0 || (l.up > 0 && table[i - 1].up > l.up));
  const downMonotone = table.every((l, i) => i === 0 || (l.down > 0 && table[i - 1].down < l.down));
  check('자석: 숏 청산가는 배율이 높을수록 진입가에 가깝다(10x 최대)', upMonotone, table.map((l) => l.up).join(' > '));
  check('자석: 롱 청산가는 배율이 높을수록 진입가에 가깝다(10x 최소)', downMonotone, table.map((l) => l.down).join(' < '));
  const above = table.every((l) => l.up > livePrice);
  const below = table.every((l) => l.down > 0 && l.down < livePrice);
  check('자석: 상방 청산가 > 현재가 > 하방 청산가', above && below, `${table[0]?.up} > ${livePrice} > ${table[0]?.down}`);
  await backToMenu();

  /* ---------- 4) 🌊 섹터 ---------- */
  await openMenu('sector');
  await page.waitForSelector('[data-sector] [data-row]', { timeout: 30000 });
  // 티커가 도착해 첫 섹터 점수가 계산될 때까지
  await page.waitForFunction(
    () => Number(document.querySelector('[data-sector] .sec-item')?.getAttribute('data-score') ?? 0) > 0,
    { timeout: 60000 },
  );
  await page.waitForTimeout(300);
  const sec = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-sector] .sec-item')];
    return {
      rows: rows.map((r) => ({
        key: r.getAttribute('data-row'),
        score: Number(r.getAttribute('data-score')),
        text: r.querySelector('.sec-row')?.textContent?.replace(/\s+/g, ' ').trim(),
        name: r.querySelector('.sec-name b')?.textContent?.replace(/\s+/g, ' ').trim(),
      })),
      top: document.querySelector('[data-sector-top]')?.textContent?.trim(),
      sub: document.querySelector('[data-sector-sub]')?.textContent?.replace(/\s+/g, ' ').trim(),
      hints: document.querySelectorAll('[data-sector] .sec-hint').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('섹터: 7개 섹터 표시', sec.rows.length === 7, sec.rows.map((r) => r.key).join(','));
  check('섹터: 점수 내림차순 · 0~100', sec.rows.every((r, i) => r.score >= 0 && r.score <= 100 && (i === 0 || sec.rows[i - 1].score >= r.score)), sec.rows.map((r) => r.score).join(' > '));
  check('섹터: 1위 = 상단 KPI', (sec.top ?? '').includes((sec.rows[0]?.name ?? '').replace(/^\S+\s/, '')), `${sec.top} vs ${sec.rows[0]?.name}`);
  check('섹터: 매핑 종목 수 표시', /\d+종목 매핑/.test(sec.sub ?? ''), sec.sub);
  check('섹터 390px 오버플로 0건', !sec.overflow);
  await shot('160-sector-radar', true);

  /* 첫 섹터 펼침 — 대장주 등락률 = 거래소 티커 */
  await page.locator('[data-sector] .sec-row').first().click();
  await page.waitForSelector('[data-sector-detail]', { timeout: 5000 });
  const sectorDetail = await page.evaluate(() => {
    const leader = document.querySelector('.sec-coin.leader');
    return {
      base: leader?.getAttribute('data-coin'),
      changeText: leader?.querySelector('.sec-coin-change')?.textContent?.trim(),
      laggards: [...document.querySelectorAll('.sec-coin.lag')].map((c) => c.getAttribute('data-coin')),
      foot: document.querySelector('.sec-detail-foot')?.textContent?.replace(/\s+/g, ' ').trim(),
    };
  });
  if (sectorDetail.base) {
    const tRaw = await bgJson(`/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${sectorDetail.base}USDT`);
    const t = Array.isArray(tRaw) ? tRaw[0] : tRaw;
    check(
      `섹터: 대장주 ${sectorDetail.base} 등락률 = 티커`,
      close(num(sectorDetail.changeText), Number(t.change24h) * 100, 0.6),
      `${sectorDetail.changeText} vs ${(Number(t.change24h) * 100).toFixed(2)}`,
    );
  }
  check('섹터: 대장주·후발주 구분 표시', !!(sectorDetail.foot ?? '').length && (sectorDetail.laggards.length >= 0), `후발 ${sectorDetail.laggards.join(',')}`);
  await backToMenu();

  /* ---------- 5) 데스크톱 + 기록 0건 안내 ---------- */
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await desktop.addInitScript(seedAuthSession);
  await installE2EStubs(desktop);
  await desktop.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'conservative', updatedAt: Date.now() }));
    localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    // 매매일지 0건 — DNA 는 안내만 보여줘야 한다(가짜 수치 금지)
    localStorage.removeItem('bgss.history.v1');
    localStorage.removeItem('bgss.mytrades.v1');
  });
  const dpage = await desktop.newPage();
  dpage.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[desktop] ${m.text()}`);
  });
  dpage.on('pageerror', (e) => pageErrors.push(`[desktop] ${String(e)}`));
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await dpage.waitForSelector('.top-nav button[data-tab="menu"]', { timeout: 30000 });
  await dpage.locator('.top-nav button', { hasText: '메뉴' }).click();
  await dpage.waitForTimeout(600);
  const desk = await dpage.evaluate(() => ({
    rows: document.querySelectorAll('.menu-row').length,
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    bottomHidden: getComputedStyle(document.querySelector('.bottom-nav')).display === 'none',
  }));
  check('데스크톱: 메뉴 12도구 + 13 · 오버플로 0건', desk.rows === 12 && desk.hero === '13' && !desk.overflow && desk.bottomHidden, JSON.stringify(desk));
  await dpage.screenshot({ path: `${OUT}/161-menu-innovations-desktop.png` });

  await dpage.locator('.menu-row[data-menu="dna"]').click();
  await dpage.waitForSelector('[data-dna]', { timeout: 20000 });
  const emptyDna = await dpage.evaluate(() => ({
    empty: document.querySelector('[data-dna-empty]')?.textContent?.replace(/\s+/g, ' ').trim(),
    cumR: document.querySelector('[data-dna-cumr]')?.textContent?.trim(),
    demoBtn: !!document.querySelector('[data-dna-mode="demo"]'),
    facts: document.querySelectorAll('.dna-fact').length,
  }));
  check('DNA: 기록 0건이면 안내 + 데모 버튼(가짜 수치 없음)', /매매 기록이 없습니다/.test(emptyDna.empty ?? '') && emptyDna.demoBtn && emptyDna.cumR === '—' && emptyDna.facts === 0, `${emptyDna.cumR} · ${emptyDna.facts}건 진단`);
  await desktop.close();

  await mobile.close();
  await browser.close();

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check('콘솔/페이지 에러 0건 (네트워크 429 제외)', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }));

  const report = { hub, dna, cd, demo, mag, levels, sec, sectorDetail, desk, emptyDna, checks };
  writeFileSync('.tmp/innovations-report.json', JSON.stringify(report, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length ? '❌' : '✅'} 매매 DNA·청산 자석·섹터 레이더 E2E: ${checks.length - failed.length}/${checks.length} 통과${failed.length ? ` · 실패: ${failed.map((f) => f.name).join(' / ')}` : ''}`);
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
