/**
 * FX·금 탭 + 벤티지 호가 보정 검증 (모바일 390×844 / 데스크톱 1280×800)
 *   npm run build && node scripts/fx-check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4180;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

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
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});
const logs = [];
server.stdout.on('data', (d) => logs.push(`[server] ${d.toString().trim()}`));
server.stderr.on('data', (d) => logs.push(`[server:err] ${d.toString().trim()}`));

mkdirSync(OUT, { recursive: true });

const waitReady = async (page) => {
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.rescan');
      return !!btn && !btn.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1200);
};

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
  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const scanSec = Math.round((Date.now() - t0) / 1000);

  const overview = await page.evaluate(() => ({
    markets: document.querySelector('.summary-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
    counters: [...document.querySelectorAll('.counter')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim()),
    filters: [...document.querySelectorAll('.segmented[aria-label="자산 구분"] button')].map((b) => b.textContent?.trim()),
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
  }));
  check('자산 필터에 FX·금 탭', overview.filters.includes('FX·금'), overview.filters.join(' / '));
  check('FX·금 카운터 노출', overview.counters.some((c) => c?.startsWith('FX·금')), overview.counters.join(' | '));
  console.log(`scan ${scanSec}s · ${overview.cards} cards · ${overview.markets}`);

  /* ---------- FX·금 탭 ---------- */
  await page.locator('.segmented[aria-label="자산 구분"] button', { hasText: 'FX·금' }).click();
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/13-fx-scanner-top.png` });
  // 호가 보정 바 + 실제 FX 카드가 함께 보이도록 스크롤
  const firstFxCard = page.locator('.signal-card:not(.skeleton)').first();
  if (await firstFxCard.count()) {
    await page.evaluate(() => {
      const bar = document.querySelector('.fx-offset-bar');
      if (bar) window.scrollTo(0, bar.getBoundingClientRect().top + window.scrollY - 70);
    });
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/13-fx-scanner.png` });
  await page.screenshot({ path: `${OUT}/13-fx-scanner-full.png`, fullPage: true, scale: 'css' });

  const fxView = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
    return {
      cards: cards.length,
      rows: cards.slice(0, 8).map((c) => ({
        sym: c.querySelector('.sym')?.textContent,
        sub: c.querySelector('.sym-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
        badge: c.querySelector('.asset')?.textContent,
        price: c.querySelector('.price')?.textContent,
        levels: [...c.querySelectorAll('.lvl-value')].map((v) => v.textContent),
        chart: !!c.querySelector('svg.mini-candles'),
        tf: c.querySelector('.tf')?.textContent,
      })),
      assist: !!document.querySelector('.fx-offset-bar'),
      chips: [...document.querySelectorAll('.fx-chip')].map((c) =>
        c.querySelector('.fx-chip-label')?.textContent?.replace('★', '').trim(),
      ),
      chipCount: document.querySelectorAll('.fx-chip').length,
      targets: [...document.querySelectorAll('.signal-card .sym')].map((s) => s.textContent),
    };
  });

  check('FX·금 탭에서 카드 렌더', fxView.cards > 0, `${fxView.cards}장 · ${fxView.targets.slice(0, 6).join(', ')}`);
  check('FX·금 배지 표시', fxView.rows.every((r) => r.badge === 'FX·금'), fxView.rows.map((r) => r.badge).join(','));
  check('벤티지 표기(XAUUSD+·EURUSD+ …)', fxView.targets.every((t) => /\+$/.test(t || '')), fxView.targets.slice(0, 8).join(','));
  check('미니 캔들 차트 렌더', fxView.rows.every((r) => r.chart), `${fxView.rows.length}장 확인`);
  check('벤티지 호가 보정 바 노출', fxView.assist && fxView.chipCount > 0, `${fxView.chipCount}종목`);
  check('보정 바에 FX·금 종목', ['XAUUSD+', 'EURUSD+', 'USDJPY+'].every((l) => fxView.chips.includes(l)), fxView.chips.slice(0, 8).join(','));
  check(
    '호가 보정 상단 고정(금·유로·비트)',
    fxView.chips[0] === 'XAUUSD+' && fxView.chips[1] === 'EURUSD+' && /BTC/.test(fxView.chips[2] || ''),
    fxView.chips.slice(0, 4).join(' / '),
  );

  const WANT_DECIMALS = {
    XAUUSD: 2, XAGUSD: 2, XAUT: 2, PAXG: 2, XPTUSD: 2, XPDUSD: 2,
    EURUSD: 4, GBPUSD: 4, USDJPY: 2, USDBRL: 4,
    USOIL: 2, UKOIL: 2, NATGAS: 2, COPPER: 2, DXY: 2,
  };
  const decimalsOk = fxView.rows.map((r) => {
    const sym = (r.sym || '').replace(/\+$/, '');
    const price = (r.price || '').replace(/,/g, '');
    const frac = price.includes('.') ? price.split('.')[1].length : 0;
    const want = WANT_DECIMALS[sym];
    return { sym, price, frac, want };
  });
  check(
    'FX·금 소수점 자리수',
    decimalsOk.every((d) => (d.want == null ? d.frac <= 2 : d.frac === d.want)),
    decimalsOk.map((d) => `${d.sym}:${d.price}(${d.frac}/${d.want ?? '지수'})`).join(' '),
  );

  /* ---------- 오프셋 적용 ---------- */
  // 자리수가 있는 카드(우선: 금 → 유로 → 소수 2자리 이상)를 골라 0.5 이동을 검증한다.
  const pick = fxView.rows.find((r) => (r.sym || '').startsWith('XAUUSD')) ||
    fxView.rows.find((r) => (r.sym || '').startsWith('EURUSD')) ||
    fxView.rows.find((r) => /,\d{2}$|\d\.\d{2,}$/.test(r.price || ''));
  const first = pick || fxView.rows[0];
  const base = (first.sym || '').trim();
  const chip = page.locator('.fx-chip', { hasText: base }).first();
  await chip.locator('.fx-offset-input').fill('0.5');
  await page.waitForTimeout(500);
  const afterOffset = await page.evaluate((sym) => {
    const card = [...document.querySelectorAll('.signal-card:not(.skeleton)')].find(
      (c) => c.querySelector('.sym')?.textContent?.trim() === sym,
    );
    const chipEl = [...document.querySelectorAll('.fx-chip')].find(
      (c) => c.querySelector('.fx-chip-label')?.textContent?.trim() === sym,
    );
    return {
      price: card?.querySelector('.price')?.textContent,
      levels: [...(card?.querySelectorAll('.lvl-value') || [])].map((v) => v.textContent),
      sub: card?.querySelector('.sym-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
      applied: chipEl?.querySelector('.fx-chip-applied')?.textContent,
      count: document.querySelector('.fx-count')?.textContent,
      stored: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').fxOffsets,
    };
  }, base);

  const num = (t) => Number(String(t).replace(/[^0-9.-]/g, ''));
  const fracDigits = (t) => {
    const clean = String(t).replace(/,/g, '');
    return clean.includes('.') ? clean.split('.')[1].length : 0;
  };
  const tick = 10 ** -fracDigits(first.price);
  const delta = num(afterOffset.price) - num(first.price);
  check(
    '오프셋 입력이 카드 현재가에 반영',
    Math.abs(delta - 0.5) <= tick / 2 + 1e-6,
    `${base} ${first.price} → ${afterOffset.price} (Δ${delta.toFixed(4)}, 틱 ${tick})`,
  );
  const levelDelta = afterOffset.levels.map((v, i) => num(v) - num(first.levels[i]));
  check(
    '진입·목표·EQ·무효도 같이 이동',
    levelDelta.every((d) => Math.abs(d - 0.5) <= tick / 2 + 1e-6),
    levelDelta.map((d) => d.toFixed(3)).join(','),
  );
  check('오프셋 localStorage 저장', afterOffset.stored && Math.abs(afterOffset.stored[base] - 0.5) < 1e-9, JSON.stringify(afterOffset.stored));
  check('카드에 벤티지 보정 표기', /벤티지/.test(afterOffset.sub || ''), afterOffset.sub || '');
  await page.screenshot({ path: `${OUT}/13-fx-offset.png` });

  /* ---------- FX 공유 카드 ---------- */
  await page.locator('.signal-card', { hasText: base }).first().click();
  await page.waitForSelector('.share-canvas.in', { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/13-fx-share.png` });
  const shareCanvas = await page.evaluate(() => {
    const c = document.querySelector('canvas.share-canvas');
    if (!c) return null;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonEmpty = 0;
    for (let i = 3; i < data.length; i += 4000) if (data[i] > 0) nonEmpty++;
    return { w: c.width, h: c.height, nonEmpty };
  });
  check('FX 공유 카드 렌더', !!shareCanvas && shareCanvas.nonEmpty > 100, JSON.stringify(shareCanvas));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- 기존 기능 회귀 ---------- */
  await page.locator('.segmented[aria-label="자산 구분"] button', { hasText: '전체' }).click();
  await page.waitForTimeout(400);
  const allFilters = await page.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    badges: [...new Set([...document.querySelectorAll('.signal-card .asset')].map((b) => b.textContent))],
  }));
  check('전체 필터에 코인·주식선물·FX·금 공존', allFilters.badges.length >= 2, allFilters.badges.join(','));

  await page.locator('.segmented[aria-label="자산 구분"] button', { hasText: '코인' }).click();
  await page.waitForTimeout(400);
  const coinOnly = await page.evaluate(() => [...new Set([...document.querySelectorAll('.signal-card .asset')].map((b) => b.textContent))]);
  check('코인 필터', coinOnly.every((b) => b === '코인'), coinOnly.join(','));

  await page.locator('.segmented[aria-label="자산 구분"] button', { hasText: '주식선물' }).click();
  await page.waitForTimeout(400);
  const stockOnly = await page.evaluate(() => [...new Set([...document.querySelectorAll('.signal-card .asset')].map((b) => b.textContent))]);
  check('주식선물 필터', stockOnly.every((b) => b === '주식선물'), stockOnly.join(','));

  await page.locator('.segmented[aria-label="자산 구분"] button', { hasText: '전체' }).click();
  await page.waitForTimeout(400);

  // 즐겨찾기
  await page.locator('.signal-card:not(.skeleton) .fav-btn').first().click();
  await page.waitForTimeout(300);
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(500);
  const fav = await page.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card').length,
    starred: !!document.querySelector('.signal-card .fav-btn.on'),
  }));
  check('즐겨찾기 필터', fav.cards >= 1 && fav.starred, `${fav.cards}장`);
  await page.locator('.signal-card .fav-btn.on').first().click();
  await page.waitForTimeout(200);
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(300);

  // 더보기
  const moreBtn = page.locator('.more-btn');
  const hasMore = (await moreBtn.count()) > 0;
  if (hasMore) {
    const before = await page.locator('.signal-card:not(.skeleton)').count();
    await moreBtn.first().click();
    await page.waitForTimeout(500);
    const after = await page.locator('.signal-card:not(.skeleton)').count();
    check('이전 시그널 더보기', after > before, `${before} → ${after}`);
  } else {
    check('이전 시그널 더보기', true, '표시할 이전 시그널 없음(스킵)');
  }

  // 검색 — 현재 목록 첫 카드의 종목으로 검색해 결과가 남는지 확인
  const probe = ((await page.locator('.signal-card:not(.skeleton) .sym').first().textContent()) || 'BTC')
    .replace(/\+$/, '')
    .trim();
  await page.locator('.search-box input').fill(probe);
  await page.waitForTimeout(500);
  const searchView = await page.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    syms: [...document.querySelectorAll('.signal-card .sym')].map((s) => s.textContent),
  }));
  check(
    '검색으로 종목 필터',
    searchView.cards > 0 && searchView.syms.every((s) => (s || '').includes(probe)),
    `${probe} → ${searchView.cards}장 ${searchView.syms.join(',')}`,
  );
  await page.locator('.search-clear').click();
  await page.waitForTimeout(300);

  // 주력 3종목 퀵 필터
  const quick = await page.evaluate(() => [...document.querySelectorAll('.quick-chip')].map((b) => b.textContent?.trim()));
  check('주력 3종목 퀵 필터 칩', quick.length === 3, quick.join(' / '));
  await page.locator('.quick-chip', { hasText: '금' }).first().click();
  await page.waitForTimeout(600);
  const goldView = await page.evaluate(() => ({
    query: document.querySelector('.search-box input')?.value,
    asset: [...document.querySelectorAll('.segmented[aria-label="자산 구분"] button')].find((b) => b.className.includes('on'))?.textContent,
    active: !!document.querySelector('.quick-chip.gold.on'),
    syms: [...document.querySelectorAll('.signal-card .sym')].map((s) => s.textContent),
    fxBar: !!document.querySelector('.fx-offset-bar'),
  }));
  check(
    '🥇 금 퀵 필터',
    goldView.active && goldView.query === 'XAU' && goldView.asset === 'FX·금' && goldView.syms.every((s) => (s || '').startsWith('XAU')),
    `query=${goldView.query} asset=${goldView.asset} cards=${goldView.syms.join(',') || '없음'}`,
  );
  await page.screenshot({ path: `${OUT}/13-fx-quick-gold.png` });
  await page.locator('.quick-chip', { hasText: '금' }).first().click();
  await page.waitForTimeout(400);
  const goldOff = await page.evaluate(() => ({
    query: document.querySelector('.search-box input')?.value,
    active: !!document.querySelector('.quick-chip.gold.on'),
  }));
  check('퀵 필터 재탭 해제', goldOff.query === '' && !goldOff.active, JSON.stringify(goldOff));

  await page.locator('.quick-chip', { hasText: '유로' }).first().click();
  await page.waitForTimeout(500);
  const euroView = await page.evaluate(() => ({
    query: document.querySelector('.search-box input')?.value,
    syms: [...document.querySelectorAll('.signal-card .sym')].map((s) => s.textContent),
  }));
  check('💶 유로 퀵 필터', euroView.query === 'EURUSD' && euroView.syms.every((s) => (s || '').startsWith('EUR')), JSON.stringify(euroView));
  await page.locator('.quick-chip', { hasText: '유로' }).first().click();
  await page.waitForTimeout(300);

  await page.locator('.quick-chip', { hasText: '비트' }).first().click();
  await page.waitForTimeout(500);
  const btcView = await page.evaluate(() => ({
    query: document.querySelector('.search-box input')?.value,
    syms: [...document.querySelectorAll('.signal-card .sym')].map((s) => s.textContent),
  }));
  check('₿ 비트 퀵 필터', btcView.query === 'BTC' && btcView.syms.every((s) => (s || '').includes('BTC')), JSON.stringify(btcView));
  await page.locator('.quick-chip', { hasText: '비트' }).first().click();
  await page.waitForTimeout(300);

  // 설정 탭: 보정 표 + Twelve Data
  await page.locator('.bottom-nav button', { hasText: '설정' }).click();
  await page.waitForTimeout(700);
  const settings = await page.evaluate(() => ({
    table: document.querySelectorAll('.fx-tr').length,
    keyInput: !!document.querySelector('.td-key-input'),
    saved: document.querySelector('.panel-note')?.textContent,
    status: [...document.querySelectorAll('.update-status')].map((u) => u.textContent?.replace(/\s+/g, ' ').trim()),
  }));
  check('설정 탭 종목별 보정 표', settings.table > 10, `${settings.table}행`);
  check('Twelve Data 키 입력란', settings.keyInput, settings.status.join(' / ').slice(0, 120));
  await page.locator('.fx-tr').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/13-settings-fx.png` });
  await page.locator('.td-key-input').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/13-settings-twelvedata.png` });

  await page.locator('.bottom-nav button', { hasText: '기록' }).click();
  await page.waitForTimeout(600);
  const history = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.history-list li')];
    return { rows: rows.length, fx: rows.filter((r) => /\+/.test(r.querySelector('.h-sym')?.textContent || '')).length };
  });
  check('기록 탭에 FX 시그널', history.rows > 0, `${history.rows}행 중 FX ${history.fx}행`);
  await page.locator('.bottom-nav button', { hasText: '시황' }).click();
  await page.waitForTimeout(600);
  const market = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.segmented button')].map((b) => b.textContent?.trim());
    return { btns, sub: document.querySelector('.summary-sub')?.textContent?.replace(/\s+/g, ' ').trim() };
  });
  check('시황 탭 FX·금', market.btns.includes('FX·금'), market.sub || '');
  await page.locator('.segmented button', { hasText: 'FX·금' }).first().click();
  await page.waitForTimeout(500);
  const fxMarket = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.mv-list li')].slice(0, 6).map((l) => l.textContent?.replace(/\s+/g, ' ').trim()),
  }));
  check('시황 FX·금 목록', fxMarket.rows.some((r) => r.includes('+')), fxMarket.rows.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${OUT}/13-market-fx.png` });

  await mobile.close();

  /* ---------- 데스크톱 ---------- */
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const dpage = await desktop.newPage();
  dpage.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[desktop] ${m.text()}`);
  });
  dpage.on('pageerror', (e) => pageErrors.push(`[desktop] ${String(e)}`));
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitReady(dpage);
  await dpage.locator('.segmented[aria-label="자산 구분"] button', { hasText: 'FX·금' }).click();
  await dpage.waitForTimeout(700);
  await dpage.screenshot({ path: `${OUT}/13-fx-desktop.png` });
  const desktopInfo = await dpage.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    cols: getComputedStyle(document.querySelector('.card-grid')).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    chips: document.querySelectorAll('.fx-chip').length,
  }));
  check('데스크톱 FX·금 렌더', desktopInfo.cards > 0 && !desktopInfo.overflow, JSON.stringify(desktopInfo));

  await browser.close();
  check('콘솔/페이지 에러 0건', consoleErrors.length === 0 && pageErrors.length === 0, [...consoleErrors, ...pageErrors].slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.pass);
  writeFileSync('.tmp/fx-check.json', JSON.stringify({ overview, fxView, afterOffset, results }, null, 1));
  console.log(JSON.stringify({ scanSec, fxCards: fxView.cards, targets: fxView.targets.slice(0, 10), results, failed: failed.length }, null, 1));
  if (failed.length || consoleErrors.length || pageErrors.length) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('FX CHECK FAILED', e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
    server.stdout.destroy();
    server.stderr.destroy();
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
