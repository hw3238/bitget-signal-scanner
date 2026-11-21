/** 라이브 Pages FX 탭 비트코인(BTCUSD+) 랏 카드 검증 — 짧게 끝나는 집중 점검
 *   실행: LD_LIBRARY_PATH=... node scripts/live-btc-check.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await ctx.addInitScript(() => {
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    if (!localStorage.getItem('bgss.settings.v1')) localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const res = await page.goto(`${URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  check('라이브 페이지 응답', res?.status() === 200, `HTTP ${res?.status()}`);
  const script = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')));
  check('새 빌드 자산 로드', script.some((s) => /index-.*\.js/.test(s || '')), script.join(','));

  // 스캔 완료 대기(FX 탭 진입 전) — 비트겟 실스캔이라 시간이 걸린다.
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 200000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 200000 },
  );
  await page.waitForTimeout(1200);

  await page.locator('.bottom-nav button[data-tab="fx"]').click();
  await page.waitForTimeout(900);
  const top = await page.evaluate(() => ({
    title: clean(document.querySelector('.fx-tab .summary-title')?.textContent),
    quick: [...document.querySelectorAll('.fx-tab .quick-chip')].map((b) => clean(b.textContent)),
    pinned: [...document.querySelectorAll('.fx-chip.priority .fx-chip-label')].map((e) => e.textContent.replace('★', '').trim()),
    badge: document.querySelector('.bottom-nav button[data-tab="fx"]')?.querySelector('.nav-badge')?.textContent,
    counter: clean(document.querySelector('.fx-tab .counter.fx')?.textContent),
    lotHint: clean(document.querySelector('.fx-tab .lot-hint')?.textContent),
    multiplier: /레버리지/.test(clean(document.querySelector('.fx-tab')?.innerText)),
  }));
  check('라이브 FX 탭 요약·퀵 필터(금·유로·비트)', /FX·금·비트/.test(top.title) && top.quick.length === 3, `${top.title} · ${top.quick.join(' ')}`);
  check('라이브 ★ BTCUSD+ 호가 보정 칩', top.pinned.some((t) => /BTCUSD\+/.test(t)), top.pinned.join(' / '));
  check('라이브 FX 배지 = FX·금·비트 진행중 수', !!top.badge && top.counter.endsWith(top.badge), `배지 ${top.badge} · ${top.counter}`);
  check('라이브 랏 힌트에 비트 1 Lot = 1 BTC', /비트 1 Lot = 1 BTC/.test(top.lotHint), top.lotHint);

  await page.locator('.fx-tab .quick-chip', { hasText: '비트' }).click();
  await page.waitForTimeout(900);
  const btc = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')];
    const card = cards.find((c) => (c.querySelector('.sym')?.textContent || '').trim() === 'BTCUSD+');
    const lv = card ? [...card.querySelectorAll('.lvl')].map((l) => clean(l.querySelector('.lvl-usd')?.textContent)) : [];
    return {
      count: cards.length,
      sym: card?.querySelector('.sym')?.textContent?.trim() || null,
      asset: card?.querySelector('.asset')?.textContent?.trim() || null,
      price: card?.querySelector('.price')?.textContent?.trim() || null,
      cap: card?.querySelector('.roi-cap')?.textContent?.trim() || null,
      pnl: card?.querySelector('.roi-value')?.textContent?.trim() || null,
      usds: lv,
      strip: card?.querySelector('.lot-strip')?.textContent?.replace(/\s+/g, '') || null,
      multiplier: card ? /레버리지|\b\d+x\b/.test(clean(card.textContent)) : null,
    };
  });
  check('라이브 ₿ 비트 필터 → BTCUSD+ 카드', btc.sym === 'BTCUSD+' && btc.asset === 'FX·금', `${btc.count}건 · ${btc.sym} ${btc.price}`);
  check('라이브 BTCUSD+ 랏 달러 손익 표시', /^0\.10 Lot 수익$/.test(btc.cap || '') && /^[+-]?\$/.test(btc.pnl || ''), `${btc.cap} ${btc.pnl} · ${btc.usds.join(' / ')}`);
  check('라이브 BTCUSD+ 1 Lot = 1 BTC', /1Lot=1BTC/.test(btc.strip || ''), btc.strip || '');
  check('라이브 BTCUSD+ 카드 배수(x) 없음', btc.multiplier === false, String(btc.multiplier));

  await page.setViewportSize({ width: 390, height: 1240 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const grid = document.querySelector('.fx-tab .filter-grid');
    if (grid) window.scrollTo(0, grid.getBoundingClientRect().top + window.scrollY - 122);
  });
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => {
    const grid = document.querySelector('.fx-tab .filter-grid');
    const card = document.querySelector('.fx-tab .signal-card:not(.skeleton)');
    const top = Math.max(0, (grid?.getBoundingClientRect().top ?? 0) - 8);
    const bottom = Math.min(window.innerHeight, (card?.getBoundingClientRect().bottom ?? 0) + 12);
    return { x: 0, y: Math.round(top), width: window.innerWidth, height: Math.round(bottom - top) };
  });
  await page.screenshot({ path: 'docs/screens/15-live-fx-btc.png', clip });
  await page.setViewportSize({ width: 390, height: 844 });

  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ url: URL, btc, results }, null, 1));
  if (failed.length || errors.length) process.exitCode = 1;
};

run().catch((e) => {
  console.error('LIVE BTC CHECK FAILED', e);
  process.exitCode = 1;
});
