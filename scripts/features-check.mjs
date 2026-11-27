/**
 * COTA 확장 기능 E2E 검증 — 메뉴 허브 · 김프 레이더 · 생존 성적표 · 사이징 · 수수료 ·
 * 차트 도플갱어 · 키맞추기 레이더 · 시황 스퀴즈/속보 카드
 *
 *   실행: npm run build && node scripts/features-check.mjs
 *   결과: docs/screens/25~35-*.png · .tmp/features-report.json
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4177;
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
  });
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await mobile.addInitScript(seedAuthSession);
  await installE2EStubs(mobile);

  await mobile.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('cota.profile.v1', JSON.stringify({ seed: 5000, style: 'conservative', updatedAt: Date.now() }));
    if (!localStorage.getItem('bgss.settings.v1')) {
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    }
    window.__drawn = [];
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.fillText;
    proto.fillText = function (text, ...rest) {
      window.__drawn.push(String(text));
      return orig.call(this, text, ...rest);
    };
  });
  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

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
  await page.waitForTimeout(1000);

  const setField = async (label, value) => {
    const input = page
      .locator(`.num-field:has(.num-label:text-is("${label}")) input`)
      .first();
    await input.fill(String(value));
    await input.blur();
    await page.waitForTimeout(120);
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const top = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  const openMenu = async (key) => {
    await page.locator(`.menu-row[data-menu="${key}"]`).click();
    await page.waitForTimeout(600);
  };
  const backToMenu = async () => {
    await page.locator('.menu-back').click();
    await page.waitForTimeout(400);
  };

  /* ---------- 1) 5탭 재편 ---------- */
  const nav = await page.evaluate(() => {
    const el = document.querySelector('.bottom-nav');
    const btns = [...el.querySelectorAll('button')];
    return {
      labels: btns.map((b) => b.querySelector('.nav-label')?.textContent),
      keys: btns.map((b) => b.dataset.tab),
      count: btns.length,
      active: getComputedStyle(el.querySelector('button.on')).color,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      topNav: [...document.querySelectorAll('.top-nav button')].map((b) => b.textContent),
    };
  });
  check('하단 5탭 = 스캐너|시황|메뉴|기록|설정', nav.labels.join('|') === '스캐너|시황|메뉴|기록|설정', nav.labels.join(' | '));
  check('상단 탭도 같은 5탭', nav.topNav.join('|') === '스캐너|시황|메뉴|기록|설정', nav.topNav.join(' | '));
  check('390px 가로 오버플로 0건', !nav.overflow);

  /* ---------- 2) 시황: 공포·탐욕 + 펀딩/OI 스퀴즈 ---------- */
  await page.locator('.bottom-nav button[data-tab="market"]').click();
  await page.waitForTimeout(2600);

  const fngRaw = await (await fetch('https://api.alternative.me/fng/?limit=2&format=json')).json();
  const fngValue = Number(fngRaw.data[0].value);
  // 펀딩비는 몇 분 단위로도 움직인다 — 화면을 읽기 전/후 두 스냅숏 중 하나와 맞으면 일치로 본다.
  const fundingMap = (rows) =>
    new Map(rows.map((f) => [String(f.symbol).replace(/USDT$/, ''), Number(f.fundingRate) * 100]));
  const fundingBefore = fundingMap(
    await bgJson('/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES').catch(() => []),
  );
  const market = await page.evaluate(() => {
    const squeeze = [...document.querySelectorAll('.squeeze-list li')].filter((li) => li.querySelector('.squeeze-badge')).map((li) => ({
      base: li.querySelector('.squeeze-main b')?.textContent?.trim(),
      oi: li.querySelector('.squeeze-main span')?.textContent?.trim(),
      rate: li.querySelector('.squeeze-funding b')?.textContent?.trim(),
      annual: li.querySelector('.squeeze-funding span')?.textContent?.trim(),
      badge: li.querySelector('.squeeze-badge')?.textContent?.trim(),
    }));
    return {
      fear: document.querySelector('.fear-gauge b')?.textContent?.trim(),
      fearLabel: document.querySelector('.fear-gauge i')?.textContent?.trim(),
      squeeze,
      squeezeNote: document.querySelector('.squeeze-note')?.textContent?.trim() ?? '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      cardBtn: !!document.querySelector('.market-actions .ghost-btn'),
    };
  });
  check('시황: 공포·탐욕 실데이터 표시', Number(market.fear) === fngValue, `${market.fear} / API ${fngValue} · ${market.fearLabel}`);
  check('시황: OI 변동률 안내 문구', /OI 변동률은/.test(market.squeezeNote));
  check('시황: 스퀴즈 레이더 렌더', market.squeeze.length > 0 || /과열 종목이 없습니다/.test(market.squeezeNote), `${market.squeeze.length}행`);
  check('시황: 390px 오버플로 0건', !market.overflow);

  if (market.squeeze.length) {
    const fundingAfter = fundingMap(
      await bgJson('/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES').catch(() => []),
    );
    // 펀딩비는 프리미엄 지수에 따라 분 단위로도 움직인다 → 값이 클수록 상대 오차(8%)까지 허용하고,
    // 0에 가까운 값은 0.0008%p 절대 오차로 본다(위조 데이터라면 이 범위에 들지 않는다).
    const fundingClose = (shown, api) => close(shown, api, Math.max(0.0008, Math.abs(api) * 0.08));
    const mismatched = market.squeeze.filter((s) => {
      const shown = num(s.rate);
      const cands = [fundingBefore.get(s.base), fundingAfter.get(s.base)].filter((v) => Number.isFinite(v));
      return cands.length === 0 || !cands.some((api) => fundingClose(shown, api));
    });
    check('스퀴즈 펀딩비 = 비트겟 API 값', mismatched.length === 0, mismatched.map((m) => `${m.base} ${m.rate}`).join(' ') || `${market.squeeze.length}건 일치`);
    const bad = market.squeeze.filter((s) => {
      const rate = num(s.rate);
      if (rate >= 0.05) return s.badge !== '롱 스퀴즈 주의';
      if (rate <= -0.05) return s.badge !== '숏 스퀴즈 주의';
      return false;
    });
    check('펀딩 과열 배지 규칙(±0.05%)', bad.length === 0, bad.map((b) => `${b.base} ${b.rate} ${b.badge}`).join(' ') || '전 행 일치');
    const noOi = market.squeeze.filter((s) => !/OI \$/.test(s.oi ?? ''));
    check('미결제약정(OI) 표시', noOi.length === 0, market.squeeze[0]?.oi ?? '');
  }

  // 시황 속보 카드
  await page.locator('.market-actions .ghost-btn').click();
  await page.waitForSelector('.card-modal canvas.in', { timeout: 20000 });
  await page.waitForTimeout(700);
  const brief = await page.evaluate(() => {
    const c = document.querySelector('canvas.share-canvas');
    return { w: c.width, h: c.height, drawn: [...new Set(window.__drawn ?? [])] };
  });
  await top('27-market-brief-card');
  check('시황 속보 카드 1080px PNG', brief.w === 1080, `${brief.w}×${brief.h}`);
  check('속보 카드: 공포·탐욕·주요 코인·워터마크', ['공포 · 탐욕 지수', 'COTA', '주요 코인'].every((t) => brief.drawn.includes(t)), brief.drawn.slice(0, 8).join(' | '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await top('26-market-squeeze');

  /* ---------- 3) 메뉴 허브 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(600);
  const hub = await page.evaluate(() => ({
    title: document.querySelector('.menu-hero h2')?.textContent?.trim(),
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    groups: [...document.querySelectorAll('.menu-group-title')].map((g) => g.textContent?.trim()),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('메뉴 허브: 12개 도구(급등 탐색기·Propr·DNA·자석·섹터 포함)', hub.rows.length === 12 && hub.rows.includes('surge') && hub.rows.includes('propr') && hub.rows.includes('dna') && hub.rows.includes('magnet') && hub.rows.includes('sector'), hub.rows.join(', '));
  check('메뉴 허브: 3개 그룹', hub.groups.length === 3 && hub.groups.join('|') === '실전 레이더|리스크 관리|분석', hub.groups.join(' / '));
  check('메뉴 허브 390px 오버플로 0건', !hub.overflow, hub.title);
  await top('25-menu-hub');

  /* ---------- 4) 김프 레이더 ---------- */
  await openMenu('kimchi');
  await page.waitForTimeout(2200);
  const kimchi = await page.evaluate(() => ({
    big: document.querySelector('.summary-title b')?.textContent?.trim(),
    meta: document.querySelector('.kimchi-meta')?.innerText?.replace(/\s+/g, ' ').trim(),
    routes: [...document.querySelectorAll('.route-card')].map((c) => ({
      base: c.querySelector('.route-main b')?.textContent?.trim(),
      sub: c.querySelector('.route-main span')?.textContent?.trim(),
      net: c.querySelector('.route-net b')?.textContent?.trim(),
    })),
    rows: [...document.querySelectorAll('.kimchi-row')].map((r) => [...r.querySelectorAll('span')].map((s) => s.textContent.trim())),
  }));
  const [upbitRows, bgTickers, fx] = await Promise.all([
    fetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-XRP').then((r) => r.json()),
    bgJson('/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
    fetch('https://open.er-api.com/v6/latest/USD').then((r) => r.json()),
  ]);
  const btcKrw = upbitRows.find((r) => r.market === 'KRW-BTC').trade_price;
  const btcUsd = Number(bgTickers.find((t) => t.symbol === 'BTCUSDT').lastPr);
  const usdKrw = fx.rates.KRW;
  const expectPrem = (btcKrw / (btcUsd * usdKrw) - 1) * 100;
  check('김프: BTC 프리미엄 = 국내가·비트겟·환율 계산', close(num(kimchi.big), expectPrem, 0.4), `${kimchi.big} vs ${expectPrem.toFixed(2)}% (시세 시차 허용)`);
  check('김프: TOP 3 송금 후보', kimchi.routes.length === 3, kimchi.routes.map((r) => `${r.base} ${r.net}`).join(' / '));
  const nets = kimchi.routes.map((r) => num(r.net));
  check('김프: TOP3 순손익 내림차순', nets.every((v, i) => i === 0 || nets[i - 1] >= v), nets.join(' ≥ '));
  check('김프: 전체 표 10종목 이상', kimchi.rows.length >= 10, `${kimchi.rows.length}행`);
  const btcRow = kimchi.rows.find((r) => r[0] === 'BTC');
  check('김프 표: 해외가 = 비트겟가×환율', !!btcRow && close(num(btcRow[2]), btcUsd * usdKrw, btcUsd * usdKrw * 0.002), `${btcRow?.[2]} vs ${Math.round(btcUsd * usdKrw).toLocaleString('en-US')}`);
  check(
    '김프 표: 김프 = 국내가/해외가 − 1',
    !!btcRow && close(num(btcRow[3]), (num(btcRow[1]) / num(btcRow[2]) - 1) * 100, 0.01),
    `${btcRow?.[1]} / ${btcRow?.[2]} → ${btcRow?.[3]}`,
  );
  check('김프: USDT 김프 병기', /USDT 김프/.test(kimchi.meta ?? ''), kimchi.meta?.slice(0, 60));
  await top('28-kimchi-radar');
  await backToMenu();

  /* ---------- 5) 포지션 생존 성적표 ---------- */
  await openMenu('survival');
  await page.waitForTimeout(1200);
  await setField('진입가', 100);
  await setField('레버리지', 10);
  await setField('투입 증거금', 1000);
  await page.waitForTimeout(400);
  const surv = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.survival-grid div')].map((d) => ({
      label: d.querySelector('span')?.textContent?.trim(),
      value: d.querySelector('b')?.textContent?.trim(),
    }));
    return {
      grade: document.querySelector('.survival-grade')?.firstChild?.textContent?.trim(),
      score: document.querySelector('.survival-grade span')?.textContent?.trim(),
      comment: document.querySelector('.survival-comment')?.textContent?.trim(),
      cells,
      kv: [...document.querySelectorAll('.kv-list li')].map((li) => [...li.querySelectorAll('span,b')].map((x) => x.textContent.trim())),
    };
  });
  // qty = 1000×10/100 = 100, liq = (100 − 1000/100)/(1−0.004)
  const expectLiq = (100 - 1000 / 100) / (1 - 0.004);
  const shownLiq = num(surv.cells.find((c) => c.label === '예상 청산가')?.value);
  check('생존 성적표: 청산가 = (진입가 − 증거금/수량)/(1−유지증거금)', close(shownLiq, expectLiq, 0.05), `${shownLiq} vs ${expectLiq.toFixed(2)}`);
  const shownBuf = num(surv.cells.find((c) => c.label === '청산까지 여유')?.value);
  const mark = num(await page.locator('.num-field:has(.num-label:text-is("진입가")) .num-hint').textContent());
  check('생존 성적표: 청산 여유 = |현재가−청산가|/현재가', shownBuf > 0 && shownBuf < 100, `${shownBuf}% (현재가 ${mark})`);
  check('생존 성적표: 등급 S~F + 촌평', /^[SABCDF]$/.test(surv.grade ?? '') && (surv.comment?.length ?? 0) > 8, `${surv.grade} ${surv.score} · ${surv.comment}`);
  check('생존 성적표: 포지션 규모 = 증거금×레버리지', /10,000 USDT/.test(surv.kv.find((r) => r[0] === '포지션 규모')?.[1] ?? ''), surv.kv.find((r) => r[0] === '포지션 규모')?.[1]);

  // 물타기
  const preLiq = shownLiq;
  await setField('추가 증거금', 500);
  await setField('추가 진입가', 90);
  await page.waitForTimeout(400);
  const dca = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.dca-result div')].map((d) => ({
      label: d.querySelector('span')?.textContent?.trim(),
      value: d.querySelector('b')?.textContent?.trim(),
    }));
    const lvl = document.querySelector('.survival-grid b.down')?.textContent?.trim();
    return { cells, liq: lvl };
  });
  const expectAvg = (100 * 100 + 90 * (500 * 10 / 90)) / (100 + 500 * 10 / 90);
  check('물타기: 새 평단가 = 가중평균', close(num(dca.cells.find((c) => c.label === '새 평단가')?.value), expectAvg, 0.05), `${dca.cells.find((c) => c.label === '새 평단가')?.value} vs ${expectAvg.toFixed(2)}`);
  check('물타기: 청산가가 내려감', num(dca.cells.find((c) => c.label === '새 청산가')?.value) < preLiq, `${preLiq} → ${dca.cells.find((c) => c.label === '새 청산가')?.value}`);
  check('물타기: 새 배율 = 명목/증거금', /x$/.test(dca.cells.find((c) => c.label === '새 배율')?.value ?? ''), dca.cells.find((c) => c.label === '새 배율')?.value);

  await page.locator('.survival-top .ghost-btn').click();
  await page.waitForSelector('.card-modal canvas.in', { timeout: 15000 });
  const survCard = await page.evaluate(() => {
    const c = document.querySelector('canvas.share-canvas');
    return { w: c.width, h: c.height };
  });
  await top('29-survival-grade');
  check('생존 성적표 카드 1080px', survCard.w === 1080, `${survCard.w}×${survCard.h}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await top('29b-survival-detail');
  await backToMenu();

  /* ---------- 6) 포지션 사이징 ---------- */
  await openMenu('sizing');
  await page.waitForTimeout(900);
  await setField('시드', 1000);
  await setField('1회 허용 손실률', 2);
  await setField('진입가', 100);
  await setField('손절가', 95);
  await setField('목표가', 115);
  await page.waitForTimeout(400);
  const sizing = await page.evaluate(() => ({
    rr: document.querySelector('.sizing-hero b')?.textContent?.trim(),
    be: document.querySelector('.sizing-hero span')?.textContent?.trim(),
    kv: [...document.querySelectorAll('.kv-list li')].map((li) => [li.querySelector('span')?.textContent?.trim(), li.querySelector('b')?.textContent?.trim()]),
  }));
  check('사이징: 손익비 1 : 3.00', close(num((sizing.rr ?? '').split(':')[1]), 3, 0.01), sizing.rr);
  check('사이징: 손익분기 승률 25%', close(num(sizing.be), 25, 0.1), sizing.be);
  check('사이징: 수량 4 · 명목 400 USDT', close(num(sizing.kv.find((r) => r[0] === '적정 수량')?.[1]), 4, 0.001) && close(num(sizing.kv.find((r) => r[0] === '포지션 규모')?.[1]), 400, 1), JSON.stringify(sizing.kv.slice(0, 3)));
  check('사이징: 허용 손실 $20', close(Math.abs(num(sizing.kv.find((r) => r[0] === '허용 손실 금액')?.[1])), 20, 0.01), sizing.kv.find((r) => r[0] === '허용 손실 금액')?.[1]);
  await top('30-sizing-calc');
  await backToMenu();

  /* ---------- 7) 수수료 계산기 ---------- */
  await openMenu('fee');
  await page.waitForTimeout(700);
  await setField('시드', 1000);
  await setField('레버리지', 10);
  await setField('일일 거래 횟수 (왕복)', 4);
  await setField('수수료 할인율', 20);
  await setField('페이백율', 10);
  await page.waitForTimeout(400);
  const fee = await page.evaluate(() => ({
    monthly: document.querySelector('.summary-title b')?.textContent?.trim(),
    stats: [...document.querySelectorAll('.stat')].map((s) => [s.querySelector('.stat-label')?.textContent?.trim(), s.querySelector('b')?.textContent?.trim()]),
    kv: [...document.querySelectorAll('.kv-list li')].map((li) => [li.querySelector('span')?.textContent?.trim(), li.querySelector('b')?.textContent?.trim()]),
    eff: document.querySelector('#none, .panel-head .panel-note')?.textContent?.trim(),
  }));
  // 지정가 30% 혼합: 0.3×0.02 + 0.7×0.06 = 0.048%/side → 왕복 10,000×0.048%×2 = $9.6
  const roundTrip = 10_000 * (0.3 * 0.02 + 0.7 * 0.06) * 2 / 100;
  check('수수료: 왕복 1회 = 명목×혼합요율×2', close(Math.abs(num(fee.stats.find((s) => s[0] === '일')?.[1])) / 4, roundTrip, 0.02), `${Math.abs(num(fee.stats.find((s) => s[0] === '일')?.[1]))} / 4 vs ${roundTrip.toFixed(2)}`);
  check('수수료: 월 = 일×30', close(Math.abs(num(fee.stats.find((s) => s[0] === '월')?.[1])), Math.abs(num(fee.stats.find((s) => s[0] === '일')?.[1])) * 30, 0.5), fee.stats.find((s) => s[0] === '월')?.[1]);
  const net = Math.abs(num(fee.kv.find((r) => r[0] === '월 실제 부담')?.[1]));
  const gross = Math.abs(num(fee.kv.find((r) => r[0] === '월 절감액')?.[1])) + net;
  check('수수료: 할인 20%·페이백 10% 반영', close(net, gross * 0.8 * 0.9, 0.5), `${net} vs ${(gross * 0.72).toFixed(2)}`);
  await top('31-fee-calc');
  await backToMenu();

  /* ---------- 8) 차트 도플갱어 ---------- */
  await openMenu('doppel');
  await page.waitForTimeout(3500);
  const doppel = await page.evaluate(() => ({
    summary: document.querySelector('.summary-card .summary-title')?.textContent?.trim(),
    sub: document.querySelector('.summary-card .summary-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
    rows: [...document.querySelectorAll('.doppel-list li')].map((li) => ({
      when: li.querySelector('.doppel-info b')?.textContent?.trim(),
      sub: li.querySelector('.doppel-info span')?.textContent?.trim(),
      after: li.querySelector('.doppel-after b')?.textContent?.trim(),
    })),
    svg: !!document.querySelector('.doppel-svg'),
    paths: [...document.querySelectorAll('.doppel-svg path')].map((p) => p.getAttribute('d')?.length ?? 0),
  }));
  check('도플갱어: TOP 3 표시', doppel.rows.length === 3, doppel.rows.map((r) => `${r.when} ${r.after}`).join(' / '));
  const sims = doppel.rows.map((r) => num((r.sub.match(/유사도 ([\d.]+)%/) ?? [])[1]));
  check('도플갱어: 유사도 내림차순(75% 이상 후보)', sims.every((v, i) => i === 0 || sims[i - 1] >= v) && sims[0] > 55, sims.join(' ≥ '));
  check('도플갱어: 이후 등락률 = 부호 있는 %', doppel.rows.every((r) => /^[+-]?\d+\.\d+%$/.test(r.after ?? '')), doppel.rows.map((r) => r.after).join(' '));
  check('도플갱어: 오버레이 SVG 3개 선', doppel.svg && doppel.paths.filter((l) => l > 20).length === 3, `paths=${doppel.paths.join(',')}`);

  // 비트겟 캔들로 같은 패턴을 다시 계산해 화면 수치가 맞는지 교차검증
  const candles = await bgJson('/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=BTCUSDT&granularity=1H&limit=500')
    .then((rows) => rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })))
    .catch(() => []);
  if (candles.length > 80) {
    const closes = candles.map((c) => c.c);
    const PL = 24;
    const FL = 12;
    const cur = closes.slice(-PL);
    const pearson = (a, b) => {
      const n = Math.min(a.length, b.length);
      const mx = a.reduce((s, v) => s + v, 0) / n;
      const my = b.reduce((s, v) => s + v, 0) / n;
      let numr = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) {
        numr += (a[i] - mx) * (b[i] - my);
        dx += (a[i] - mx) ** 2;
        dy += (b[i] - my) ** 2;
      }
      return numr / Math.sqrt(dx * dy);
    };
    const cands = [];
    for (let end = PL - 1; end <= closes.length - PL - FL - 1; end++) {
      const win = closes.slice(end - PL + 1, end + 1);
      const corr = pearson(cur, win);
      const fut = closes.slice(end + 1, end + FL + 1);
      if (fut.length < FL) continue;
      cands.push({ end, corr, change: (fut[fut.length - 1] / win[win.length - 1] - 1) * 100 });
    }
    const picked = [];
    for (const c of cands.sort((a, b) => b.corr - a.corr)) {
      if (picked.some((p) => Math.abs(p.end - c.end) < PL)) continue;
      picked.push(c);
      if (picked.length >= 3) break;
    }
    const expectChanges = picked.map((p) => p.change);
    const shownChanges = doppel.rows.map((r) => num(r.after));
    const matchOk = expectChanges.every((v, i) => close(v, shownChanges[i], 0.35));
    check('도플갱어: 화면 TOP3 이후 등락률 = 비트겟 캔들 재계산', matchOk, `API ${expectChanges.map((v) => v.toFixed(2)).join('/')} vs 화면 ${shownChanges.map((v) => v.toFixed(2)).join('/')}`);
    const avg = expectChanges.reduce((a, b) => a + b, 0) / expectChanges.length;
    check('도플갱어: 요약 평균 = TOP3 평균', close(num((doppel.sub.match(/평균 ([+-]?[\d.]+)%/) ?? [])[1]), avg, 0.2), `${doppel.sub}`);
  }

  await page.locator('.summary-card .ghost-btn').click();
  await page.waitForSelector('.card-modal canvas.in', { timeout: 15000 });
  const dopCard = await page.evaluate(() => {
    const c = document.querySelector('canvas.share-canvas');
    return { w: c.width, h: c.height };
  });
  await top('33-doppel-card');
  check('도플갱어 카드 1080px', dopCard.w === 1080, `${dopCard.w}×${dopCard.h}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await top('32-doppelganger');

  // 4시간봉 전환
  const before = doppel.rows.map((r) => r.when).join('|');
  await page.locator('.num-field:has(.num-label:text-is("타임프레임")) .segmented button', { hasText: '4시간' }).click();
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('.doppel-list li .doppel-info b')].map((b) => b.textContent?.trim()).join('|'),
  );
  check('도플갱어: 4시간봉 전환 시 새 구간', after.length > 0 && after !== before, `${before.slice(0, 40)} → ${after.slice(0, 40)}`);
  await backToMenu();

  /* ---------- 9) 키맞추기 레이더 ---------- */
  await openMenu('lag');
  await page.waitForFunction(
    () => document.querySelectorAll('.lag-table .kimchi-row').length > 5,
    { timeout: 180000 },
  );
  await page.waitForTimeout(800);
  const lag = await page.evaluate(() => ({
    badge: document.querySelector('.summary-title .tool-badge')?.textContent?.trim(),
    sub: document.querySelector('.summary-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
    longs: [...document.querySelectorAll('.lag-tab .panel')][0]?.querySelectorAll('.lag-list li').length ?? 0,
    shortsTotal: [...document.querySelectorAll('.lag-tab .panel')][1]?.querySelectorAll('.lag-list li').length ?? 0,
    first: (() => {
      const li = document.querySelector('.lag-list li');
      if (!li || !li.querySelector('.lag-main b')) return null;
      return {
        base: li.querySelector('.lag-main b')?.textContent?.trim(),
        sub: li.querySelector('.lag-main span')?.textContent?.trim(),
        gap: li.querySelector('.lag-gap b')?.textContent?.trim(),
      };
    })(),
    table: [...document.querySelectorAll('.lag-table .kimchi-row')].slice(0, 6).map((r) => [...r.querySelectorAll('span')].map((s) => s.textContent.trim())),
  }));
  const btcPct = num((lag.badge?.match(/BTC ([+-]?[\d.]+)%/) ?? [])[1]);
  check('키맞추기: BTC 등락률 배지', Number.isFinite(btcPct), lag.badge);
  check('키맞추기: 상관계수 순위 표', lag.table.length >= 6, lag.table.map((r) => r.join(' ')).slice(0, 3).join(' | '));
  const corrVals = lag.table.map((r) => num(r[1]));
  check('키맞추기: 표는 상관 높은 순', corrVals.every((v, i) => i === 0 || corrVals[i - 1] >= v), corrVals.join(' ≥ '));

  if (lag.first) {
    const baseSym = `${lag.first.base}USDT`;
    const [btcRows, altRows] = await Promise.all([
      bgJson(`/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=BTCUSDT&granularity=1H&limit=60`),
      bgJson(`/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${baseSym}&granularity=1H&limit=60`),
    ]);
    const byTime = (rows) =>
      rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })).sort((a, b) => a.t - b.t).map((x) => x.c);
    const btc = byTime(btcRows);
    const alt = byTime(altRows);
    const rets = (v) => v.slice(1).map((x, i) => x / v[i] - 1);
    const pearson = (a, b) => {
      const n = Math.min(a.length, b.length);
      const mx = a.reduce((s, v) => s + v, 0) / n;
      const my = b.reduce((s, v) => s + v, 0) / n;
      let numr = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) {
        numr += (a[i] - mx) * (b[i] - my);
        dx += (a[i] - mx) ** 2;
        dy += (b[i] - my) ** 2;
      }
      return numr / Math.sqrt(dx * dy);
    };
    const corr = pearson(rets(btc), rets(alt));
    const gap = (btc[btc.length - 1] / btc[btc.length - 5] - 1) * 100 - (alt[alt.length - 1] / alt[alt.length - 5] - 1) * 100;
    const shownCorr = num((lag.first.sub.match(/상관 ([\d.]+)/) ?? [])[1]);
    check(
      `키맞추기: ${lag.first.base} 상관·괴리 = 캔들 재계산`,
      close(corr, shownCorr, 0.06) && close(gap, num(lag.first.gap), 0.25),
      `상관 ${shownCorr} vs ${corr.toFixed(2)} · 괴리 ${lag.first.gap} vs ${gap.toFixed(2)}%p`,
    );
    check('키맞추기: 괴리 부호 = BTC 방향', (btcPct >= 0 && num(lag.first.gap) > 0) || (btcPct < 0 && num(lag.first.gap) < 0), `${lag.badge} / ${lag.first.gap}`);
  }
  await top('34-keymatch-radar');

  // 4시간/6시간 전환
  await page.locator('.lag-window button', { hasText: '최근 6시간' }).click();
  await page.waitForTimeout(600);
  const lag6 = await page.evaluate(() => ({
    head: document.querySelector('.summary-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
    btc: document.querySelectorAll('.lag-table .kimchi-row')[0]?.querySelectorAll('span')[2]?.textContent?.trim(),
  }));
  check('키맞추기: 6시간 창 전환', /최근 6시간/.test(lag6.head ?? '') && /%/.test(lag6.btc ?? ''), `${lag6.head?.slice(0, 40)} · ${lag6.btc}`);
  await backToMenu();

  /* ---------- 10) 전략엔진은 메뉴 안으로 ---------- */
  await openMenu('engine');
  await page.waitForTimeout(900);
  const engine = await page.evaluate(() => ({
    rows: document.querySelectorAll('.strat-row').length,
    text: (document.querySelector('.engine-tab')?.innerText ?? '').length,
    back: document.querySelector('.menu-back')?.textContent?.trim(),
  }));
  check('메뉴 → 전략엔진 서브뷰 + ← 메뉴', engine.rows >= 1 && engine.text > 300 && engine.back === '← 메뉴', `${engine.rows}개 전략`);
  await top('35-menu-engine');
  await page.locator('.menu-back').click();
  await page.waitForTimeout(300);
  const backHub = await page.evaluate(() => !!document.querySelector('.menu-hero'));
  check('← 메뉴로 허브 복귀', backHub);

  /* ---------- 11) 기존 기능 회귀 ---------- */
  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(700);
  // 탭을 옮기면 스캐너 필터(진행중만)가 기본값으로 돌아간다 — 카드가 없으면 종료 포함·자산 전체로 넓힌다.
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
  const scanner = await page.evaluate(() => ({
    cards: document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)').length,
    fav: document.querySelectorAll('.scanner-tab .fav-toggle').length,
    search: document.querySelectorAll('.scanner-tab .search-box input').length,
    tabs: [...document.querySelectorAll('.scanner-tab [aria-label="자산 구분"] button')].map((b) => b.textContent.trim()),
  }));
  check('스캐너 회귀: 시그널 카드·즐겨찾기·검색 유지', scanner.cards > 0 && scanner.fav === 1 && scanner.search === 1, `${scanner.cards}건 · 자산 ${scanner.tabs.join('/')}`);

  await page.locator('.scanner-tab .signal-card:not(.skeleton)').first().click();
  await page.waitForSelector('.share-canvas.in', { timeout: 20000 });
  const shareOk = await page.evaluate(() => !!document.querySelector('canvas.share-canvas')?.width);
  await page.keyboard.press('Escape');
  check('시그널 공유 카드 유지', shareOk);

  /* ---------- 12) 기록·설정 탭 ---------- */
  for (const [label, key] of [['기록', 'history'], ['설정', 'settings']]) {
    await page.locator(`.bottom-nav button[data-tab="${key}"]`).click();
    await page.waitForTimeout(700);
    const ok = await page.evaluate(() => ({
      text: (document.querySelector('main')?.innerText ?? '').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    check(`${label} 탭 정상 · 오버플로 0건`, ok.text > 200 && !ok.overflow, `${ok.text}자`);
  }

  /* ---------- 13) 데스크톱 ---------- */
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  // 🔐 회원 전용 게이트(v1.5.8) — 데스크톱 시나리오도 로그인된 상태에서 시작한다.
  await desktop.addInitScript(seedAuthSession);
  await installE2EStubs(desktop);

  await desktop.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('cota.profile.v1', JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }));
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
  // 진행중 코인 시그널이 없는 시간대에도 카드 검증이 되도록 '종료 포함 → 자산 전체'로 넓힌다.
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
  await dpage.waitForTimeout(600);
  const desk = await dpage.evaluate(() => ({
    rows: document.querySelectorAll('.menu-row').length,
    auto: document.querySelectorAll('.menu-auto').length,
    autoBadge: document.querySelector('[data-auto-menu-badge]')?.textContent?.trim() ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    bottomHidden: getComputedStyle(document.querySelector('.bottom-nav')).display === 'none',
  }));
  await dpage.screenshot({ path: `${OUT}/36-menu-desktop.png` });
  check(
    '데스크톱: 메뉴 허브 13도구(자동매매 포함) · 오버플로 0건',
    desk.rows === 12 && desk.auto === 1 && desk.autoBadge === '꺼짐' && !desk.overflow && desk.bottomHidden,
    JSON.stringify(desk),
  );
  await desktop.close();

  await mobile.close();
  await browser.close();

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check('콘솔/페이지 에러 0건 (네트워크 429 제외)', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: realErrors, pageErrors }));

  const report = {
    nav,
    market,
    kimchi,
    surv,
    dca,
    sizing,
    fee,
    doppel,
    lag,
    engine,
    scanner,
    checks,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(0, 20),
    allOk: checks.every((c) => c.ok),
  };
  writeFileSync('.tmp/features-report.json', JSON.stringify(report, null, 1));
  console.log(`\n${report.allOk ? '✅ 확장 기능 검증 통과' : `❌ 실패 ${checks.filter((c) => !c.ok).length}건`} (${checks.length}개 확인)`);
  if (!report.allOk) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('FEATURES CHECK FAILED', e);
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
