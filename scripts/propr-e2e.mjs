/**
 * 🏆 Propr 5K 터보 시그널 E2E 검증 (실행: npm run build && npm run propr-e2e)
 *
 *  1) 메뉴 허브: `🏆 Propr 5K 터보 시그널` 카드(도구 10개) · 390px 오버플로 0건
 *  2) 진입 → 진행률 표시 → Hyperliquid 실시간 탐지 → 카드 렌더
 *  3) 5K 터보 계좌 트래커: 기본 잔고 $5,000 · 목표 $5,450 · 하한 $4,850 · 일일 −$150 · 리스크 칩 $25/$37.5/$50
 *  4) 잔고·리스크를 바꾸면 진행률과 카드 손익 금액이 즉시 다시 계산된다(localStorage 저장 포함)
 *  5) 카드 = 실데이터: 레버리지 ≤ Propr 상한, 리스크 ≤ 선택값, 진입/손절/목표 수식 일치,
 *     가격 = Hyperliquid 마크가(교차검증), 배지 = 자산군 상한
 *  6) 필터(자산군·4H·진행중만) · 복사 버튼 · 메뉴 복귀 배지(진행 건수)
 *  7) 데스크톱 · 콘솔 에러 0건 · 스크린샷(docs/screens 148~153)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4179;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const HL = 'https://api.hyperliquid.xyz/info';

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

/** Hyperliquid 실시간 마크가 — 화면 가격 교차검증용 */
async function hlPrices() {
  const post = async (body) => {
    const res = await fetch(HL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const map = new Map();
  const add = (raw) => {
    if (!Array.isArray(raw) || raw.length < 2) return;
    const [meta, ctxs] = raw;
    (meta.universe ?? []).forEach((asset, i) => {
      const ctx = ctxs[i];
      if (!asset || !ctx) return;
      map.set(asset.name, Number(ctx.markPx ?? 0));
    });
  };
  add(await post({ type: 'metaAndAssetCtxs' }));
  add(await post({ type: 'metaAndAssetCtxs', dex: 'xyz' }).catch(() => null));
  return map;
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
  await mobile.addInitScript(seedAuthSession);
  await installE2EStubs(mobile);
  await mobile.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    if (!localStorage.getItem('bgss.settings.v1')) localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
  });

  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  const shot = async (name, full = false) => {
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.scanner-tab .rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );

  /* ---------- 1) 메뉴 허브 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => {
    const row = document.querySelector('.menu-row[data-menu="propr"]');
    return {
      rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
      emoji: row?.querySelector('.menu-emoji')?.textContent?.trim(),
      title: row?.querySelector('.menu-copy b')?.textContent?.replace(/\s+/g, ' ').trim(),
      desc: row?.querySelector('.menu-copy span')?.textContent?.trim(),
      tag: row?.querySelector('.menu-tag')?.textContent?.trim(),
      badge: document.querySelector('[data-propr-menu-badge]')?.textContent?.trim() ?? null,
      hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
      heroNote: document.querySelector('.menu-hero p')?.textContent?.trim(),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('메뉴 허브: 도구 15개 + 자동매매 = 16개', hub.rows.length === 15 && hub.rows.includes('propr'), hub.rows.join(','));
  check(
    '메뉴 허브: 🏆 Propr 5K 터보 시그널 카드',
    hub.emoji === '🏆' && /Propr 5K 터보 시그널/.test(hub.title ?? '') && /프랍/.test(hub.desc ?? '') && /프랍/.test(hub.tag ?? ''),
    `${hub.emoji} ${hub.title} · ${hub.tag}`,
  );
  check('메뉴 허브: 도구 수 16', hub.hero === '16' && /16가지 도구/.test(hub.heroNote ?? ''), `${hub.hero} · ${hub.heroNote}`);
  check('메뉴 허브: 탐지 전에는 시그널 배지를 달지 않는다', hub.badge === null, String(hub.badge));
  check('메뉴 허브 390px 오버플로 0건', !hub.overflow);
  await shot('148-menu-propr');

  /* ---------- 2) 진입 · 진행률 · 결과 ---------- */
  await page.locator('.menu-row[data-menu="propr"]').click();
  const progressSeen = await page
    .waitForSelector('[data-propr-progress]', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const progressText = progressSeen
    ? (await page.locator('[data-propr-progress]').innerText()).replace(/\s+/g, ' ').trim()
    : '';
  check('진입: 진행률(종목·캔들 탐지) 표시', progressSeen && /캔들|시세| \d+\/\d+/.test(progressText), progressText);

  await page.waitForSelector('[data-propr-progress]', { state: 'detached', timeout: 240000 });
  await page.waitForTimeout(500);
  let cardCount = await page.locator('.propr-card').count();
  if (cardCount === 0) {
    const toggle = page.locator('[data-open-only]');
    if (((await toggle.innerText()) ?? '').includes('진행중만')) {
      await toggle.click();
      await page.waitForTimeout(600);
      cardCount = await page.locator('.propr-card').count();
    }
  }
  const emptyNotice = await page.locator('[data-propr-empty]').count();
  check('진입: 카드 또는 빈 상태 안내', cardCount > 0 || emptyNotice > 0, `카드 ${cardCount}장 · 빈 안내 ${emptyNotice}건`);

  /* ---------- 3) 계좌 트래커 ---------- */
  const acct = await page.evaluate(() => ({
    balance: document.querySelector('[data-propr-balance]')?.value,
    target: document.querySelector('[data-propr-target]')?.textContent?.replace(/\s+/g, ' ').trim(),
    floor: document.querySelector('[data-propr-floor]')?.textContent?.trim(),
    daily: document.querySelector('[data-propr-daily]')?.textContent?.trim(),
    riskUsd: document.querySelector('[data-propr-risk-usd]')?.textContent?.trim(),
    dayStart: document.querySelector('[data-propr-daystart]')?.value,
    chips: [...document.querySelectorAll('[data-propr-risk]')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim()),
    progressWidth: document.querySelector('[data-propr-progressbar]')?.style?.width,
    rules: document.querySelector('[data-propr-rules]')?.textContent?.replace(/\s+/g, ' ').trim(),
    sub: document.querySelector('[data-propr-sub]')?.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  check('계좌 트래커: 기본 잔고 $5,000 · 오늘 시작 잔고 $5,000', num(acct.balance) === 5000 && num(acct.dayStart) === 5000, `${acct.balance} / ${acct.dayStart}`);
  check(
    '계좌 트래커: 목표 $5,450(+$450) · 하한 $4,850 · 일일 −$150',
    /5,450/.test(acct.target ?? '') && /\+?\$450/.test(acct.target ?? '') && num(acct.floor) === 4850 && num(acct.daily) === 150,
    `${acct.target} / 하한 ${acct.floor} / 일일 ${acct.daily}`,
  );
  check('계좌 트래커: 1회 리스크 칩 3종(0.5% $25 추천 · 0.75% $37.5 · 1.0% $50)', acct.chips.length === 3 && /0\.5% \$25\.00 ?추천/.test(acct.chips[0] ?? '') && /0\.75% \$37\.50/.test(acct.chips[1] ?? '') && /1\.0% \$50\.00/.test(acct.chips[2] ?? ''), acct.chips.join(' | '));
  check('계좌 트래커: 현재 리스크 $25', num(acct.riskUsd) === 25, acct.riskUsd);
  check('계좌 트래커: 5K 터보 규정 요약(목표 9%·일일 3%·낙폭 3%·시간 제한 없음)', /\+9% \(\$450\)/.test(acct.rules ?? '') && /−3% \(\$150\)/.test(acct.rules ?? '') && /3% static/.test(acct.rules ?? '') && /없음/.test(acct.rules ?? ''), acct.rules);
  check('요약: Propr 상장 종목 수·탐지 기준 시각', /Propr 상장 \d+종목 중 \d+종목/.test(acct.sub ?? '') && /Hyperliquid 실시간/.test(acct.sub ?? ''), acct.sub);
  check('계좌 트래커: 시작 잔고에서 진행률 0%', acct.progressWidth === '0%', acct.progressWidth);

  /* ---------- 4) 카드 정합성 ---------- */
  const readCards = () =>
    page.evaluate(() => {
      const parseRisk = (txt) => Number(String(txt ?? '').replace(/[^0-9.-]/g, ''));
      return [...document.querySelectorAll('.propr-card')].map((c) => {
        const cells = [...c.querySelectorAll('.propr-plan-cell')].map((cell) => ({
          label: cell.querySelector('span')?.textContent?.trim(),
          value: cell.querySelector('b')?.textContent?.trim(),
          extra: cell.querySelector('em')?.textContent?.trim(),
        }));
        const guide = [...c.querySelectorAll('.propr-guide-cell')].map((cell) => ({
          label: cell.querySelector('span')?.textContent?.trim(),
          value: cell.querySelector('b')?.textContent?.trim(),
          extra: cell.querySelector('em')?.textContent?.trim(),
        }));
        return {
          symbol: c.dataset.symbol,
          coin: c.dataset.coin,
          tf: c.dataset.tf,
          side: c.dataset.side,
          state: c.dataset.state,
          cap: Number(c.dataset.cap),
          lev: Number(c.dataset.lev),
          notional: Number(c.dataset.notional),
          risk: Number(c.dataset.risk),
          badge: c.querySelector('[data-propr-badge]')?.textContent?.trim(),
          cells,
          guide,
          loss: Math.abs(parseRisk(c.querySelector('[data-guide-loss]')?.textContent)),
          profit: Math.abs(parseRisk(c.querySelector('[data-guide-profit]')?.textContent)),
          price: Number(c.dataset.price),
          openCount: document.querySelectorAll('.propr-card').length,
          hasCopy: !!c.querySelector('[data-copy]'),
          warns: [...c.querySelectorAll('.propr-warn')].map((w) => w.textContent?.trim()),
        };
      });
    });

  let cards = cardCount ? await readCards() : [];
  const CAP_BY_CLASS = { 'BTC·ETH·SOL': 10, 기타코인: 2, 주식: 4, 지수: 10, 원자재: 8, FX: 25 };
  const BADGE_EXPECT = (badge) => {
    const m = /^(BTC·ETH·SOL|기타코인|주식|지수|원자재|FX) (\d+)x$/.exec(badge ?? '');
    return m ? { group: m[1], cap: Number(m[2]) } : null;
  };
  const badCards = [];
  for (const c of cards) {
    const badge = BADGE_EXPECT(c.badge);
    const entry = num(c.cells[0]?.value);
    const stop = num(c.cells[1]?.value);
    const target = num(c.cells[2]?.value);
    const rr = num((c.cells[2]?.label ?? '').match(/([\d.]+)R/)?.[1]);
    const stopPct = Math.abs(num((c.cells[1]?.extra ?? '').match(/(-?[\d.]+)%/)?.[1]));
    const targetPct = Math.abs(num((c.cells[2]?.extra ?? '').match(/(-?[\d.]+)%/)?.[1]));
    const dirOk = c.side === 'long' ? stop < entry && entry < target : stop > entry && entry > target;
    const ok =
      !!badge &&
      badge.cap === c.cap &&
      CAP_BY_CLASS[badge.group] !== undefined &&
      badge.cap === CAP_BY_CLASS[badge.group] &&
      c.lev >= 1 &&
      c.lev <= c.cap &&
      c.risk > 0 &&
      c.risk <= 25.02 &&
      c.notional > 0 &&
      c.loss > 0 &&
      c.profit > 0 &&
      dirOk;
    const mathOk =
      dirOk &&
      close(stopPct, (Math.abs(stop - entry) / entry) * 100, 0.06) &&
      close(targetPct, (Math.abs(target - entry) / entry) * 100, 0.06) &&
      close(rr, Math.abs(target - entry) / Math.abs(entry - stop), 0.08) &&
      close(c.notional, c.risk / (stopPct / 100), Math.max(1, c.notional * 0.03)) &&
      close(c.loss, c.risk, 0.02) &&
      close(c.profit, c.risk * (Math.abs(target - entry) / Math.abs(entry - stop)), 0.6);
    if (!ok || !mathOk || !c.hasCopy) {
      badCards.push(
        `${c.symbol}: ${JSON.stringify({ badge: c.badge, cap: c.cap, lev: c.lev, risk: c.risk, notional: c.notional, loss: c.loss, profit: c.profit, cells: c.cells, mathOk }) }`,
      );
    }
  }
  check(
    `카드 ${cards.length}장: 레버리지 ≤ Propr 상한 · 리스크 ≤ $25 · 손익 수식 일치`,
    cards.length > 0 && badCards.length === 0,
    badCards.slice(0, 2).join(' | ') || cards.map((c) => `${c.symbol} ${c.lev}x/${c.cap}x $${c.risk.toFixed(0)}`).slice(0, 6).join(' · '),
  );
  check(
    '카드: 자산군 배지가 규정 상한과 일치',
    cards.every((c) => {
      const b = BADGE_EXPECT(c.badge);
      return !!b && b.cap === c.cap && c.cap === CAP_BY_CLASS[b.group];
    }),
    cards.map((c) => c.badge).slice(0, 6).join(' · '),
  );

  /* ---------- 5) Hyperliquid 실시간 가격 교차검증 ---------- */
  if (cards.length) {
    const prices = await hlPrices();
    const first = cards[0];
    const live = prices.get(first.coin);
    check(
      `교차검증 ${first.symbol}: 현재가 = Hyperliquid 마크가`,
      Number.isFinite(live) && close(first.price, live, Math.max(0.02, live * 0.004)),
      `${first.price} vs ${live}`,
    );
    const entry = num(first.cells[0]?.value);
    check(
      `교차검증 ${first.symbol}: 진입가는 최근 캔들 범위 안(마크가 대비 15% 이내)`,
      Number.isFinite(live) && Math.abs(entry / live - 1) < 0.15,
      `${entry} vs ${live}`,
    );
  } else {
    check('교차검증: 카드 없음 — 빈 상태로 대체 확인', emptyNotice > 0, 'no cards');
  }

  /* ---------- 6) 잔고·리스크 변경 → 재계산 ---------- */
  const balanceInput = page.locator('[data-propr-balance]');
  await balanceInput.fill('5300');
  await page.waitForTimeout(400);
  const afterUp = await page.evaluate(() => ({
    progress: document.querySelector('[data-propr-progressbar]')?.style?.width,
    risk: document.querySelector('[data-propr-risk-usd]')?.textContent?.trim(),
    target: document.querySelector('[data-propr-target]')?.textContent?.replace(/\s+/g, ' ').trim(),
    stored: localStorage.getItem('cota.propr.balance.v1'),
    dayStart: localStorage.getItem('cota.propr.daystart.v1'),
  }));
  check(
    '잔고 $5,300 입력: 진행률 66.7% · 리스크 $26.50 · localStorage 저장',
    close(num(afterUp.progress), 66.7, 0.6) && num(afterUp.risk) === 26.5 && afterUp.stored === '5300' && afterUp.dayStart === '5300',
    `${afterUp.progress} · ${afterUp.risk} · 저장 ${afterUp.stored}`,
  );

  await page.locator('[data-propr-risk="1"]').click();
  await page.waitForTimeout(400);
  const cardsRisk1 = await readCards();
  check(
    '리스크 1.0% 선택: 카드 손절 금액이 $53(잔고 1%) 이하로 다시 계산',
    cardsRisk1.every((c) => c.risk > 0 && c.risk <= 53.02) && cardsRisk1.some((c) => c.risk > 26.6),
    cardsRisk1.slice(0, 4).map((c) => `${c.symbol} $${c.risk.toFixed(1)}`).join(' · '),
  );
  await shot('149-propr-turbo');

  /* ---------- 7) 필터 ---------- */
  await page.locator('[data-group="majors"]').click();
  await page.waitForTimeout(400);
  const majors = await readCards();
  const majorsEmpty = await page.locator('[data-propr-empty]').count();
  check(
    '자산군 필터 BTC·ETH·SOL: 해당 종목만(없으면 빈 안내)',
    majors.every((c) => ['BTC', 'ETH', 'SOL'].includes(c.symbol)) &&
      majors.every((c) => c.cap === 10) &&
      (majors.length > 0 || majorsEmpty > 0),
    majors.map((c) => c.symbol).join(',') || `0장 · 빈 안내 ${majorsEmpty}건`,
  );
  await page.locator('[data-group="rwa"]').click();
  await page.waitForTimeout(400);
  const rwa = await readCards();
  const rwaEmpty = await page.locator('[data-propr-empty]').count();
  check(
    '자산군 필터 주식·원자재·지수·FX: 코인 제외(없으면 빈 안내)',
    rwa.every((c) => (c.coin ?? '').startsWith('xyz:') || ['XYZ100', 'SP500'].includes(c.symbol)) &&
      (rwa.length > 0 || rwaEmpty > 0),
    rwa.map((c) => `${c.symbol}(${c.cap}x)`).join(',') || `0장 · 빈 안내 ${rwaEmpty}건`,
  );
  await shot('150-propr-filters');
  await page.locator('[data-group="all"]').click();
  await page.waitForTimeout(300);

  // 4H 타임프레임 — 캔들을 새로 받아 다시 탐지한다
  await page.locator('[data-tf="4H"]').click();
  await page.waitForSelector('[data-propr-progress]', { timeout: 15000 }).catch(() => null);
  await page.waitForSelector('[data-propr-progress]', { state: 'detached', timeout: 240000 });
  await page.waitForTimeout(600);
  const tf4 = await page.evaluate(() => ({
    tf: [...document.querySelectorAll('[data-tf]')].filter((b) => b.className.includes('on')).map((b) => b.dataset.tf),
    cards: [...document.querySelectorAll('.propr-card')].map((c) => c.dataset.tf),
    empty: !!document.querySelector('[data-propr-empty]'),
  }));
  check('타임프레임 4H: 4H 캔들로 다시 탐지', tf4.tf.join() === '4H' && (tf4.cards.every((t) => t === '4H') || tf4.empty), `선택 ${tf4.tf} · 카드 tf ${[...new Set(tf4.cards)].join(',') || '없음'}`);
  await shot('151-propr-4h');
  await page.locator('[data-tf="1H"]').click();
  await page.waitForSelector('[data-propr-progress]', { state: 'detached', timeout: 240000 });
  await page.waitForTimeout(400);

  /* ---------- 8) 복사 ---------- */
  const cardsNow = cardCount ? await readCards() : [];
  if (cardsNow.length) {
    const copyBtn = page.locator('.propr-card [data-copy]').first();
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
      '복사: Propr 5K 터보 주문 가이드 문구',
      /🏆 Propr 5K 터보 · \S+ 1H (롱|숏)/.test(clip) && /레버리지 \d+x \(Propr 상한 \d+x\)/.test(clip) && /손절 -\$/.test(clip) && /목표 \+\$/.test(clip),
      clip.replace(/\n/g, ' / ').slice(0, 110),
    );
    check('복사: 버튼 피드백(복사됨)', /복사됨/.test(await copyBtn.innerText()), await copyBtn.innerText());
  }

  /* ---------- 9) 메뉴 복귀 · 배지 ---------- */
  // 카드가 보이는 위치로 스크롤해 실제 화면을 캡처한다(fullPage 는 고정 탭바가 중간에 겹쳐 보인다).
  const firstCard = page.locator('.propr-card').first();
  if (await firstCard.count()) {
    await firstCard.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -90));
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/152-propr-card.png`, animations: 'disabled', timeout: 30000 });
  await page.locator('.menu-back').click();
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({
    hub: !!document.querySelector('.menu-hero'),
    badge: document.querySelector('[data-propr-menu-badge]')?.textContent?.trim() ?? null,
  }));
  check('← 메뉴 복귀 + 진행 건수 배지', back.hub && /\d+건 진행/.test(back.badge ?? ''), `${back.badge}`);

  /* ---------- 10) 데스크톱 ---------- */
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await desktop.addInitScript(seedAuthSession);
  await installE2EStubs(desktop);
  await desktop.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
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
  await dpage.locator('.top-nav button', { hasText: '메뉴' }).click();
  await dpage.waitForTimeout(500);
  await dpage.locator('.menu-row[data-menu="propr"]').click();
  await dpage.waitForSelector('[data-propr-progress]', { state: 'detached', timeout: 240000 });
  await dpage.waitForTimeout(800);
  if ((await dpage.locator('.propr-card').count()) === 0) {
    // 진행중 시그널이 없는 시간대 — 종료된 셋업까지 포함해 레이아웃을 검증한다.
    const toggle = dpage.locator('[data-open-only]');
    if (((await toggle.innerText()) ?? '').includes('진행중만')) {
      await toggle.click();
      await dpage.waitForTimeout(700);
    }
  }
  const desk = await dpage.evaluate(() => ({
    cards: document.querySelectorAll('.propr-card').length,
    guideCols: document.querySelector('.propr-guide-grid') ? getComputedStyle(document.querySelector('.propr-guide-grid')).gridTemplateColumns.split(' ').length : 0,
    planCols: document.querySelector('.propr-plan') ? getComputedStyle(document.querySelector('.propr-plan')).gridTemplateColumns.split(' ').length : 0,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  await dpage.screenshot({ path: `${OUT}/153-propr-desktop.png` });
  check(
    '데스크톱: 카드 렌더 · 가이드 4열 · 오버플로 0건',
    desk.cards > 0 && desk.guideCols === 4 && desk.planCols === 4 && !desk.overflow,
    JSON.stringify(desk),
  );
  await desktop.close();

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check(
    '콘솔/페이지 에러 0건 (네트워크 429 제외)',
    realErrors.length === 0 && pageErrors.length === 0,
    JSON.stringify({ consoleErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 2) }),
  );

  await mobile.close();
  await browser.close();

  const report = { hub, acct, cards: cards.length, checks, consoleErrors, pageErrors, failedRequests: failedRequests.slice(0, 20), allOk: checks.every((c) => c.ok) };
  writeFileSync('.tmp/propr-report.json', JSON.stringify(report, null, 1));
  console.log(`\n${report.allOk ? '✅ Propr E2E 통과' : `❌ 실패 ${checks.filter((c) => !c.ok).length}건`} (${checks.length}개 확인)`);
  if (!report.allOk) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('PROPR E2E FAILED', e);
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
