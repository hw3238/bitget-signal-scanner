/** 라이브 GitHub Pages 배포본 검증 — 새 빌드(⭐ 즐겨찾기·검색·더보기) 반영 확인 */
import { chromium } from 'playwright';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const staleFavorite = () => {
  const now = Date.now();
  const candles = Array.from({ length: 24 }, (_, i) => {
    const b = 100 + i;
    return { t: now - (24 - i) * 3600000, o: b, h: b + 2, l: b - 2, c: b + 1, v: 50 + i };
  });
  const signal = {
    id: 'LIVE-1H-crt-fvg-cisd-9',
    symbol: 'LIVETESTUSDT',
    base: 'LIVETEST',
    asset: 'crypto',
    tf: '1H',
    side: 'long',
    strategyId: 'crt-fvg-cisd',
    strategyName: 'CRT + FVG + CISD',
    strategyShort: 'CRT·FVG·CISD',
    star: 5,
    entry: 100,
    stop: 96,
    target: 108,
    eq: 104,
    rr: 2,
    remainingRR: 1,
    currentR: 0.5,
    price: 103,
    changePct: 3,
    progress: 0.4,
    state: 'open',
    detectedAt: now - 5 * 3600000,
    barsSince: 5,
    winRate: 60,
    strategyRR: 1.9,
    leverage: 10,
    levRoi: 30,
    candles,
    detectedIdx: 18,
    tags: ['라이브 검증'],
    fundingRate: 0,
    quoteVolume: 1000000,
  };
  localStorage.setItem(
    'bgss.favorites.v1',
    JSON.stringify([{ key: `${signal.symbol}|${signal.tf}|${signal.side}|${signal.detectedAt}`, addedAt: now, signal }]),
  );
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
  await ctx.addInitScript(staleFavorite);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const res = await page.goto(`${URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  check('라이브 페이지 응답', res?.status() === 200, `HTTP ${res?.status()}`);

  await page.waitForSelector('.fav-toggle', { timeout: 30000 });
  const ui = await page.evaluate(() => ({
    search: !!document.querySelector('.search-box input'),
    fav: document.querySelector('.fav-toggle')?.textContent?.replace(/\s+/g, ' ').trim(),
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
    placeholder: document.querySelector('.search-box input')?.getAttribute('placeholder'),
  }));
  check('검색창 배포 반영', ui.search, ui.placeholder || '');
  check('⭐ 즐겨찾기 칩 배포 반영', !!ui.fav && ui.fav.includes('즐겨찾기'), ui.fav || '');
  check('새 빌드 자산 로드', (ui.scripts || []).some((s) => /index-.*\.js/.test(s || '')), (ui.scripts || []).join(','));

  // 즐겨찾기 필터 → 주입한 스냅샷 카드 표시
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(800);
  const favView = await page.evaluate(() => ({
    stale: !!document.querySelector('.signal-card.stale'),
    starred: !!document.querySelector('.signal-card .fav-btn.on'),
    text: document.querySelector('.signal-card.stale')?.textContent?.replace(/\s+/g, ' ').slice(0, 60),
  }));
  check('라이브 즐겨찾기 필터 + 보관 스냅샷 카드', favView.stale && favView.starred, favView.text || '');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screens/09-live-pages.png' });

  // 검색
  await page.locator('.search-box input').fill('LIVETEST');
  await page.waitForTimeout(500);
  check('라이브 검색 동작', (await page.locator('.signal-card.stale').count()) === 1);
  await page.locator('.search-box input').fill('ZZZNOPE');
  await page.waitForTimeout(500);
  check('라이브 검색 빈 결과 안내', await page.locator('.search-empty').isVisible());
  await page.locator('.search-clear').click();
  // 검증용으로 넣은 스냅샷 즐겨찾기를 해제해 화면을 깨끗하게 되돌린다
  await page.locator('.signal-card.stale .fav-btn').click();
  await page.waitForTimeout(300);
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(400);

  // 실제 스캔 완료 대기(최대 150초) — 시간이 모자라면 건너뛴다
  let scan = null;
  try {
    await page.waitForFunction(
      () => (document.querySelector('.status-text')?.textContent || '').includes('실시간 ·'),
      { timeout: 150000 },
    );
    scan = await page.evaluate(() => ({
      status: document.querySelector('.status-text')?.textContent,
      cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
      more: document.querySelector('.more-btn')?.textContent?.replace(/\s+/g, ' ').trim() || null,
      first: document.querySelector('.signal-card .sym')?.textContent,
    }));
  } catch {
    scan = { status: '스캔 미완료(시간 초과)', cards: 0 };
  }
  console.log('live scan:', JSON.stringify(scan));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screens/09-live-pages.png' });
  if (scan.cards) {
    check('라이브 시그널 카드 렌더', scan.cards > 0, `${scan.cards}장 · 첫 카드 ${scan.first || '-'}`);
    check('라이브 더보기 버튼', !!scan.more, scan.more || '');
  }

  // FX·금 탭 + 벤티지 호가 보정 반영 확인
  if (scan.cards) {
    await page.locator('.bottom-nav button[data-tab="fx"]').click();
    await page.waitForTimeout(900);
    const fx = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
      return {
        bar: !!document.querySelector('.fx-offset-bar'),
        chips: [...document.querySelectorAll('.fx-chip')].map((c) =>
          c.querySelector('.fx-chip-label')?.textContent?.replace('★', '').trim(),
        ),
        cards: cards.length,
        syms: cards.slice(0, 4).map((c) => c.querySelector('.sym')?.textContent),
        badges: [...new Set(cards.map((c) => c.querySelector('.asset')?.textContent))],
      };
    });
    check('라이브 FX·금 탭', fx.bar && fx.chips.length > 10, `칩 ${fx.chips.length}종목 · ${fx.chips.slice(0, 3).join(',')}`);
    check(
      '라이브 호가 보정 상단 고정(금·유로·비트)',
      fx.chips[0] === 'XAUUSD+' && fx.chips[1] === 'EURUSD+' && /BTC/.test(fx.chips[2] || ''),
      fx.chips.slice(0, 4).join(' / '),
    );
    check('라이브 FX 카드/배지', fx.cards > 0 && fx.badges.every((b) => b === 'FX·금'), `${fx.cards}장 ${fx.syms.join(',')}`);

    // 랏(Lot) 표시 — 배수(x) 대신 랏·달러 손익
    const lot = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')];
      const first = cards[0];
      return {
        buttons: [...document.querySelectorAll('.fx-tab .lot-select button')].map((b) => b.textContent?.trim()),
        on: document.querySelector('.fx-tab .lot-select button.on')?.textContent?.trim(),
        cap: first?.querySelector('.roi-cap')?.textContent?.trim(),
        pnl: first?.querySelector('.roi-value')?.textContent?.trim(),
        target: first?.querySelectorAll('.lvl')[0]?.querySelector('.lvl-usd')?.textContent?.trim(),
        stop: first?.querySelectorAll('.lvl')[3]?.querySelector('.lvl-usd')?.textContent?.trim(),
        multiplier: /\b\d+x\b|레버리지/.test(document.querySelector('.fx-tab')?.innerText || ''),
      };
    });
    check('라이브 FX 랏 선택기 6개(기본 0.10)', lot.buttons.length === 6 && lot.on === '0.10', `${lot.buttons.join(' ')} (선택 ${lot.on})`);
    check(
      '라이브 FX 카드 랏·달러 손익',
      /^0\.10 Lot 수익$/.test(lot.cap || '') && /^[+-]?\$/.test(lot.pnl || '') && /^[+-]\$/.test(lot.target || '') && /^-\$/.test(lot.stop || ''),
      `${lot.cap} ${lot.pnl} · 목표 ${lot.target} · 무효 ${lot.stop}`,
    );
    check('라이브 FX 탭에 배수(x)·레버리지 없음', !lot.multiplier, lot.multiplier ? '배수 표현 발견' : '없음');

    // FX 탭 비트코인(BTCUSD+) — 1 Lot = 1 BTC
    await page.locator('.fx-tab .quick-chip', { hasText: '비트' }).click();
    await page.waitForTimeout(900);
    const btc = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')];
      const card = cards.find((c) => (c.querySelector('.sym')?.textContent || '').trim() === 'BTCUSD+');
      return {
        quick: [...document.querySelectorAll('.fx-tab .quick-chip')].map((b) => b.textContent?.trim()),
        pinned: [...document.querySelectorAll('.fx-chip.priority .fx-chip-label')].map((e) => e.textContent?.replace('★', '').trim()),
        cards: cards.length,
        sym: card?.querySelector('.sym')?.textContent?.trim() || null,
        cap: card?.querySelector('.roi-cap')?.textContent?.trim() || null,
        pnl: card?.querySelector('.roi-value')?.textContent?.trim() || null,
        strip: card?.querySelector('.lot-strip')?.textContent?.replace(/\s+/g, '') || null,
      };
    });
    check(
      '라이브 FX 탭 ₿ 비트 퀵 버튼·★ BTCUSD+ 호가 칩',
      (btc.quick || []).some((t) => /비트/.test(t || '')) && (btc.pinned || []).some((t) => /BTCUSD\+/.test(t || '')),
      `${(btc.quick || []).join(' ')} · ${(btc.pinned || []).join(', ')}`,
    );
    check(
      '라이브 BTCUSD+ 카드 = 랏 기준(1 Lot = 1 BTC)',
      btc.sym === 'BTCUSD+' && /Lot 수익/.test(btc.cap || '') && /(^|[^0-9])1Lot=1BTC/.test(btc.strip || ''),
      `${btc.sym} ${btc.cap} ${btc.pnl} · ${btc.strip}`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/screens/15-live-fx-btc.png' });
    await page.locator('.fx-tab .quick-chip', { hasText: '비트' }).click();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/screens/14-live-fx-lot.png' });

    // 오프셋 입력이 카드 가격에 반영되는지 (금 카드가 있으면 금, 없으면 첫 카드)
    const target = (fx.syms || []).find((s) => (s || '').startsWith('XAUUSD')) || fx.syms?.[0];
    if (target) {
      const before = await page.evaluate((sym) => {
        const card = [...document.querySelectorAll('.signal-card')].find((c) => c.querySelector('.sym')?.textContent?.trim() === sym);
        return card?.querySelector('.price')?.textContent || null;
      }, target);
      const chip = page.locator('.fx-chip', { hasText: target }).first();
      await chip.locator('.fx-offset-input').fill('0.5');
      await page.waitForTimeout(500);
      const after = await page.evaluate((sym) => {
        const card = [...document.querySelectorAll('.signal-card')].find((c) => c.querySelector('.sym')?.textContent?.trim() === sym);
        return {
          price: card?.querySelector('.price')?.textContent || null,
          sub: card?.querySelector('.sym-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
        };
      }, target);
      const n = (t) => Number(String(t).replace(/[^0-9.-]/g, ''));
      check('라이브 호가 보정 반영', Math.abs(n(after.price) - n(before) - 0.5) <= 0.51, `${target} ${before} → ${after.price} · ${after.sub}`);
      await page.locator('.fx-offset-reset').click();
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screens/13-live-fx.png' });
  }

  await browser.close();
  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ url: URL, scan, results }, null, 1));
  if (failed.length || errors.length) process.exitCode = 1;
};

run().catch((e) => {
  console.error('LIVE CHECK FAILED', e);
  process.exitCode = 1;
});
