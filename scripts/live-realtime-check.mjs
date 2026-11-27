/**
 * 🐋 고래 체결 테이프 · 📰 실시간 코인 뉴스 라이브(배포본) 검증
 *   실행: node scripts/live-realtime-check.mjs
 *
 *  배포된 https://hw3238.github.io/bitget-signal-scanner/ 에서 실제로
 *   ① 메뉴에 🐋 고래 체결 테이프 · 📰 실시간 코인 뉴스 카드와 도구 15개가 보이고
 *   ② 고래 테이프가 **실제 비트겟 체결 스트림**에 붙어 체결을 흘려보내며(초당 체결 수 > 0),
 *      기준을 넘는 체결이 테이프에 쌓이고 가격이 비트겟 티커와 맞는지
 *   ③ 뉴스 화면이 **실제 RSS 피드**에서 기사를 받아 출처·코인·호재 배지와 함께 그리는지
 *   ④ 시황 탭의 `📰 실시간 코인 뉴스 보기` 바로가기가 동작하는지 확인한다.
 *  세션·Supabase 는 가짜로 응답해 실제 DB 는 건드리지 않는다.
 */
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const SITE = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function bitgetLast(symbol) {
  try {
    const res = await fetch(`https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${symbol}`);
    const body = await res.json();
    return Number(body?.data?.[0]?.last);
  } catch {
    return NaN;
  }
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
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
    localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
  const bundle = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(','));

  /* 1) 메뉴 */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    note: document.querySelector('.menu-hero p')?.textContent?.trim(),
    whale: document.querySelector('.menu-row[data-menu="whale"] .menu-emoji')?.textContent?.trim(),
    news: document.querySelector('.menu-row[data-menu="news"] .menu-emoji')?.textContent?.trim(),
    groups: [...document.querySelectorAll('.menu-group-title')].map((g) => g.textContent?.trim()),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check(
    '라이브 메뉴: 도구 14 + 자동매매 = 15 · 🐋📰 카드',
    hub.rows.length === 14 && hub.hero === '15' && /15가지 도구/.test(hub.note ?? '') && hub.whale === '🐋' && hub.news === '📰',
    `${hub.rows.length}+1=${hub.hero} · ${hub.whale}${hub.news}`,
  );
  check('라이브 메뉴: 시장 그룹', hub.groups.join('|') === '실전 레이더|시장|리스크 관리|분석', hub.groups.join(' · '));
  check('라이브 메뉴 오버플로 0건', !hub.overflow);
  await page.screenshot({ path: `${OUT}/173-live-menu-realtime.png` });

  /* 2) 고래 체결 테이프 — 실제 스트림 */
  await page.locator('.menu-row[data-menu="whale"]').click();
  await page.waitForSelector('[data-whale-tape]', { timeout: 30000 });
  // 실시간 체결이 테이프에 쌓일 때까지(최대 130초) 기다린다 — 시장이 한산하면 $50K 체결이 드물다.
  const waited = await page
    .waitForFunction(() => document.querySelectorAll('[data-whale-row]').length > 0, { timeout: 130000 })
    .then(() => true)
    .catch(() => false);
  // 초당 체결 수는 2초마다 갱싱된다 — 순간값 0 에 걸리지 않게 '0보다 커지는 순간'을 기다린다.
  const rateSeen = await page
    .waitForFunction(
      () => /초당 [1-9]/.test(document.querySelector('[data-whale-status]')?.textContent ?? ''),
      { timeout: 60000 },
    )
    .then(() => true)
    .catch(() => false);
  const tape = await page.evaluate(() => ({
    phase: document.querySelector('[data-whale-phase]')?.getAttribute('data-whale-phase'),
    status: document.querySelector('[data-whale-status]')?.textContent?.replace(/\s+/g, ' ').trim(),
    rows: [...document.querySelectorAll('[data-whale-row]')].map((r) => ({
      base: r.getAttribute('data-base'),
      side: r.getAttribute('data-side'),
      usd: Number(r.getAttribute('data-usd')),
      text: r.textContent.replace(/\s+/g, ' ').trim(),
    })),
    ratio: document.querySelector('.whale-ratio-pct')?.textContent?.trim(),
    top: [...document.querySelectorAll('[data-whale-top-coin]')].map((r) => r.getAttribute('data-whale-top-coin')),
    empty: document.querySelector('[data-whale-empty]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  const rate = Number((/초당 ([\d.]+)건/.exec(tape.status ?? '') ?? [])[1] ?? 0);
  check('라이브 고래: 실제 스트림 연결', tape.phase === 'live' && /유동성 상위 15종목/.test(tape.status ?? ''), tape.status);
  check('라이브 고래: 초당 체결 관측 > 0', rateSeen && rate > 0, `초당 ${rate}건`);
  check('라이브 고래: 테이프에 체결이 쌓임', waited && tape.rows.length > 0, `${tape.rows.length}줄${tape.empty ? ` · ${tape.empty.slice(0, 40)}` : ''}`);
  check(
    '라이브 고래: 모든 줄이 $50K 이상 · 시각·방향 표기',
    tape.rows.every((r) => r.usd >= 50_000 && /\d{2}:\d{2}:\d{2}/.test(r.text) && /매수|매도/.test(r.text)),
    tape.rows.slice(0, 3).map((r) => `${r.base}/${r.side}/$${r.usd}`).join(' · '),
  );
  const btcRow = tape.rows.find((r) => r.base === 'BTC');
  if (btcRow) {
    const price = Number((btcRow.text.match(/([\d,]+\.\d+)\s*$/)?.[1] ?? '').replace(/,/g, ''));
    const live = await bitgetLast('BTCUSDT');
    check(
      '라이브 고래: 체결가 = 비트겟 BTC 티커(±3%)',
      Number.isFinite(price) && Number.isFinite(live) && Math.abs(price - live) / live < 0.03,
      `${price} / ${live}`,
    );
  } else {
    check('라이브 고래: 체결가 교차검증(BTC 줄 없음 — 건너뜀)', true, 'BTC 체결 없음');
  }
  check('라이브 고래: 순매수 비율 표시', /^\d+%$/.test(tape.ratio ?? ''), tape.ratio);
  check('라이브 고래 오버플로 0건', !tape.overflow);
  await page.screenshot({ path: `${OUT}/174-live-whale-tape.png` });

  /* 3) 뉴스 — 실제 RSS */
  await page.locator('.menu-back').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-row[data-menu="news"]').click();
  await page.waitForSelector('[data-news-tab]', { timeout: 30000 });
  await page.waitForSelector('[data-news-item]', { timeout: 40000 });
  await page.waitForTimeout(600);
  const news = await page.evaluate(() => ({
    count: document.querySelector('[data-news-count]')?.textContent?.trim(),
    status: document.querySelector('[data-news-status]')?.textContent?.replace(/\s+/g, ' ').trim(),
    items: [...document.querySelectorAll('[data-news-item]')].map((el) => ({
      source: el.getAttribute('data-source'),
      tone: el.getAttribute('data-tone'),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
    })),
    feeds: [...document.querySelectorAll('[data-news-feed]')].map((el) => `${el.getAttribute('data-news-feed')}:${el.classList.contains('off') ? 'off' : 'on'}`),
    error: !!document.querySelector('[data-news-error]'),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  const sources = [...new Set(news.items.map((i) => i.source))];
  check('라이브 뉴스: 실제 피드에서 기사 표시', news.items.length >= 3 && !news.error, `${news.count} · ${news.items.length}건`);
  check('라이브 뉴스: 한국·글로벌 출처', sources.length >= 2, news.feeds.join(' '));
  check(
    '라이브 뉴스: 코인·호재 태그 계산',
    news.items.some((i) => /\b(BTC|ETH|SOL|XRP)\b/.test(i.text)) && news.items.some((i) => i.tone !== 'neutral'),
    news.items.slice(0, 2).map((i) => i.text.slice(0, 34)).join(' | '),
  );
  check('라이브 뉴스 오버플로 0건', !news.overflow);
  await page.screenshot({ path: `${OUT}/175-live-news-tab.png` });

  // 필터 동작(한국 뉴스)
  await page.locator('[data-news-filter="kr"]').click();
  await page.waitForTimeout(400);
  const kr = await page.evaluate(() => [...document.querySelectorAll('[data-news-item]')].map((el) => el.getAttribute('data-source')));
  check('라이브 뉴스: 한국 뉴스 필터', kr.length > 0 && kr.every((s) => ['blockmedia', 'blockchaintoday'].includes(s)), kr.join(','));
  await page.screenshot({ path: `${OUT}/176-live-news-kr.png` });

  /* 4) 시황 바로가기 */
  await page.locator('.bottom-nav button[data-tab="market"]').click();
  await page.waitForSelector('[data-open-news]', { timeout: 40000 });
  await page.locator('[data-open-news]').click();
  await page.waitForSelector('[data-news-tab]', { timeout: 30000 });
  check('라이브 시황 → 실시간 코인 뉴스 바로가기', (await page.locator('[data-news-tab]').count()) === 1);

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check('라이브 콘솔/페이지 에러 0건', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ realErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }));

  await context.close();
  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n배포 번들: ${bundle}`);
  console.log(`${failed.length ? '❌' : '✅'} 라이브 고래 체결 테이프·실시간 코인 뉴스 검증 ${failed.length ? `실패 ${failed.length}건: ${failed.map((f) => f.name).join(' / ')}` : `통과 (${checks.length}개 확인)`}`);
  if (failed.length) process.exitCode = 1;
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
