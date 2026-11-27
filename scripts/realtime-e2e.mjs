/**
 * 🐋 고래 체결 테이프 · 📰 실시간 코인 뉴스 E2E 검증
 *   실행: npm run build && npm run realtime-e2e
 *
 *  1) 메뉴 허브: 도구 14개 + 자동매매 = 15개 · 🐋 고래 체결 테이프 · 📰 실시간 코인 뉴스(시장 그룹)
 *  2) 🐋 고래 체결 테이프 — **WebSocket 을 가짜로 물려** 정해진 체결을 흘려보내고
 *     · 2초 창 분할 체결이 한 줄로 합쳐지는지(120K + 72K = 192K)
 *     · 초대형(50만달러) 강조·매수/매도 색·시각(HH:MM:SS) 표기
 *     · 금액·방향·검색 필터, 순매수 비율(86%)과 TOP3 코인
 *     · 일시정지 → 새 체결이 안 보이고, 재개하면 그동안의 체결이 나오는지
 *  3) 📰 실시간 코인 뉴스 — rss2json 응답을 피드별로 가짜 응답(한국 2·글로벌 2, 1개 500·1개 429)
 *     · 한국/글로벌/호재·악재 필터, 코인·호재 배지, 부분 실패 안내, 원문 새 창 열기
 *     · 전부 실패하면 안내 배너 + `다시 시도` 로 회복
 *  4) 시황 탭 상단 `📰 실시간 코인 뉴스 보기` 바로가기
 *  5) 390px 오버플로 0 · 콘솔/페이지 에러 0(모의 실패 응답 제외) · 스크린샷 166~172
 *
 *  ⚠️ DB 무접촉: 세션 시드 + 가짜 Supabase 로만 돈다(실제 cota_profiles/cota_connections 에 행을 만들지 않는다).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4182;
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

/* ---------- 시각 표기(UTC) — rss2json 이 돌려주는 형식 ---------- */
const feedDate = (minutesAgo) => {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

/* ---------- 뉴스 피드 가짜 응답 (실제 기사 제목 아님 — 테스트 픽스처) ---------- */
const NEWS_FIXTURES = {
  'https://www.blockmedia.co.kr/feed': {
    status: 'ok',
    items: [
      {
        title: '비트코인 현물 ETF 승인… 기관 자금 유입 급증',
        link: 'https://www.blockmedia.co.kr/archives/900001',
        guid: 'fixture-bm-1',
        pubDate: feedDate(12),
        description: '<p>비트코인 현물 ETF가 승인되며 기관 자금이 유입됐다.</p>',
      },
      {
        title: '이더리움 브리지 해킹… 4억달러 유출',
        link: 'https://www.blockmedia.co.kr/archives/900002',
        guid: 'fixture-bm-2',
        pubDate: feedDate(40),
        description: '<p>브리지 해킹으로 대규모 자금이 빠져나갔다.</p>',
      },
      {
        title: '코인 시장 주간 리뷰',
        link: 'https://www.blockmedia.co.kr/archives/900003',
        guid: 'fixture-bm-3',
        pubDate: feedDate(90),
        description: '<p>한 주간 시장 흐름을 정리했다.</p>',
      },
    ],
  },
  'https://www.blockchaintoday.co.kr/rss/allArticle.xml': { fail: 500 },
  'https://cointelegraph.com/rss': {
    status: 'ok',
    items: [
      {
        title: 'Bitcoin ETF inflows hit record as SOL rallies',
        link: 'https://cointelegraph.com/news/fixture-1',
        guid: 'fixture-ct-1',
        pubDate: feedDate(20),
        description: '<p>Spot ETF inflows reached a record while SOL rallied.</p>',
      },
      {
        title: 'Exchange faces probe over custody rules',
        link: 'https://cointelegraph.com/news/fixture-2',
        guid: 'fixture-ct-2',
        pubDate: feedDate(65),
        description: '<p>Regulators opened an investigation into custody rules.</p>',
      },
    ],
  },
  'https://www.coindesk.com/arc/outboundfeeds/rss': { fail: 429 },
};

/* ---------- 비트겟 체결 REST 초기 병합 픽스처 ---------- */
const SEED_AT = Date.now() - 10_000;

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
    localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'conservative', updatedAt: Date.now() }));
    if (!localStorage.getItem('bgss.settings.v1')) localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    // 원문 기사는 새 창 대신 기록만 남긴다(테스트에서 실제 사이트를 열지 않는다).
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });

  /* --- 가짜 체결 REST/WS · 뉴스 피드 --- */
  let newsMode = 'mixed';
  const sockets = [];
  await context.route('**://api.bitget.com/api/v2/mix/market/fills?**', async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol') ?? '';
    const data =
      symbol === 'XRPUSDT'
        ? [{ tradeId: 'seed-xrp-1', price: '2', size: '30000', side: 'buy', ts: String(SEED_AT), symbol: 'XRPUSDT' }]
        : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '00000', data }) });
  });
  await context.route('**://api.rss2json.com/**', async (route) => {
    const rss = new URL(route.request().url()).searchParams.get('rss_url') ?? '';
    const fixture = NEWS_FIXTURES[rss];
    if (newsMode === 'fail') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 'error' }) });
      return;
    }
    if (!fixture || fixture.fail) {
      const status = fixture?.fail ?? 500;
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'fixture failure' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
  });
  await context.routeWebSocket('wss://ws.bitget.com/**', (ws) => {
    sockets.push(ws);
    ws.onMessage((message) => {
      let msg;
      try {
        msg = JSON.parse(String(message));
      } catch {
        return;
      }
      if (msg.op !== 'subscribe') return;
      // 구독 응답
      ws.send(JSON.stringify({ event: 'subscribe', arg: { instType: 'USDT-FUTURES', channel: 'trade', instId: 'BTCUSDT' } }));
      const push = (delay, instId, side, price, size, tradeId) =>
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              action: 'update',
              arg: { instType: 'USDT-FUTURES', channel: 'trade', instId },
              data: [{ ts: String(Date.now()), price, size, side, tradeId }],
            }),
          );
        }, delay);
      // 2초 창 안의 분할 체결 → 한 줄로 합쳐진다(120K + 72K = 192K)
      push(200, 'BTCUSDT', 'buy', '60000', '2', 'ws-btc-1');
      push(500, 'BTCUSDT', 'buy', '60000', '1.2', 'ws-btc-2');
      push(1100, 'ETHUSDT', 'sell', '2500', '60', 'ws-eth-1');
      push(1600, 'SOLUSDT', 'buy', '150', '400', 'ws-sol-1');
      push(2900, 'BTCUSDT', 'buy', '60000', '10', 'ws-btc-3');
    });
  });

  const page = await context.newPage();
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
  const sendTrade = (instId, side, price, size, tradeId) => {
    for (const ws of sockets) {
      ws.send(
        JSON.stringify({
          action: 'update',
          arg: { instType: 'USDT-FUTURES', channel: 'trade', instId },
          data: [{ ts: String(Date.now()), price, size, side, tradeId }],
        }),
      );
    }
  };
  const readRows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-whale-row]')].map((row) => ({
        base: row.dataset.base,
        side: row.dataset.side,
        usd: Number(row.dataset.usd),
        text: row.textContent.replace(/\s+/g, ' ').trim(),
        huge: row.classList.contains('huge'),
      })),
    );

  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 30000 });

  /* ---------- 1) 메뉴 허브 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    note: document.querySelector('.menu-hero p')?.textContent?.trim(),
    whale: document.querySelector('.menu-row[data-menu="whale"] .menu-emoji')?.textContent?.trim(),
    whaleTag: document.querySelector('.menu-row[data-menu="whale"] .menu-tag')?.textContent?.trim(),
    news: document.querySelector('.menu-row[data-menu="news"] .menu-emoji')?.textContent?.trim(),
    newsTag: document.querySelector('.menu-row[data-menu="news"] .menu-tag')?.textContent?.trim(),
    auto: document.querySelectorAll('.menu-auto').length,
    groups: [...document.querySelectorAll('.menu-group-title')].map((g) => g.textContent?.trim()),
  }));
  check(
    '메뉴: 도구 14개 + 자동매매 = 15개',
    hub.rows.length === 14 && hub.auto === 1,
    `${hub.rows.length}개: ${hub.rows.join(',')}`,
  );
  check('메뉴: 도구 수 15 · 문구', hub.hero === '15' && /15가지 도구/.test(hub.note ?? ''), `${hub.hero} · ${hub.note}`);
  check(
    '메뉴: 🐋 고래 체결 테이프 · 📰 실시간 코인 뉴스 카드',
    hub.whale === '🐋' && hub.news === '📰' && /4개 피드/.test(hub.newsTag ?? ''),
    `${hub.whale} ${hub.whaleTag} / ${hub.news} ${hub.newsTag}`,
  );
  check('메뉴: 시장 그룹 신설', hub.groups.includes('시장'), hub.groups.join(' · '));
  check('메뉴 허브 390px 오버플로 0건', !(await overflow()));
  await shot('166-menu-realtime');

  /* ---------- 2) 🐋 고래 체결 테이프 ---------- */
  await page.locator('.menu-row[data-menu="whale"]').click();
  await page.waitForSelector('[data-whale-tape]', { timeout: 20000 });
  await page.waitForTimeout(4200); // WS 체결 5건 + 0.4초 플러시
  const tape = await page.evaluate(() => ({
    status: document.querySelector('[data-whale-status]')?.textContent?.replace(/\s+/g, ' ').trim(),
    phase: document.querySelector('[data-whale-phase]')?.getAttribute('data-whale-phase'),
    top: [...document.querySelectorAll('[data-whale-top-coin]')].map((r) => r.getAttribute('data-whale-top-coin')),
    ratio: document.querySelector('.whale-ratio-pct')?.textContent?.trim(),
    barWidth: document.querySelector('.whale-ratio-fill')?.getAttribute('style'),
    ratioText: document.querySelector('[data-whale-ratio]')?.textContent?.replace(/\s+/g, ' ').trim(),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  const rows1 = await readRows();
  check('고래: 실시간 연결 표시', tape.phase === 'live' && /실시간/.test(tape.status ?? ''), `${tape.phase} · ${tape.status}`);
  check('고래: 15종목 구독', /유동성 상위 15종목/.test(tape.status ?? ''), tape.status);
  check(
    '고래: 초기 REST 병합(XRP $60K) + 실시간 체결',
    rows1.length === 5,
    rows1.map((r) => `${r.base}/${r.side}/$${r.usd}`).join(' · '),
  );
  check(
    '고래: 2초 창 분할 체결 합침(120K+72K=192K)',
    rows1.filter((r) => r.base === 'BTC' && r.side === 'buy' && r.usd < 500_000).map((r) => r.usd).join() === '192000',
    rows1.filter((r) => r.base === 'BTC').map((r) => r.usd).join(' / '),
  );
  check(
    '고래: 초대형($500K+) 강조',
    rows1.some((r) => r.usd === 600_000 && r.huge && /초대형/.test(r.text)),
    rows1.find((r) => r.usd === 600_000)?.text ?? '-',
  );
  check(
    '고래: 매수/매도 표기',
    rows1.find((r) => r.base === 'ETH')?.text.includes('매도') && rows1.find((r) => r.base === 'SOL')?.text.includes('매수'),
    rows1.map((r) => r.text.split(' ').slice(0, 4).join(' ')).join(' | '),
  );
  check('고래: 시각 HH:MM:SS', rows1.every((r) => /\d{2}:\d{2}:\d{2}/.test(r.text)), rows1[0]?.text);
  check('고래: 순매수 비율 86% (매수 912K / 매도 150K)', tape.ratio === '86%', `${tape.ratio} · ${tape.barWidth}`);
  check('고래: 순매수 바 폭 = 비율', /86%/.test(tape.barWidth ?? ''), String(tape.barWidth));
  check('고래: TOP3 코인(BTC → ETH)', tape.top[0] === 'BTC' && tape.top[1] === 'ETH' && tape.top.length === 3, tape.top.join(','));
  check('고래: 390px 오버플로 0건', !tape.overflow);
  await shot('167-whale-tape');

  /* 금액 필터 */
  await page.locator('[data-whale-threshold="250000"]').click();
  await page.waitForTimeout(300);
  const bigOnly = await readRows();
  check('고래: $250K 필터', bigOnly.length === 1 && bigOnly[0].usd === 600_000, bigOnly.map((r) => r.usd).join(','));
  await page.locator('[data-whale-threshold="50000"]').click();
  await page.waitForTimeout(250);

  /* 방향 필터 */
  await page.locator('[data-whale-side="sell"]').click();
  await page.waitForTimeout(300);
  const sells = await readRows();
  check('고래: 매도 필터', sells.length === 1 && sells[0].base === 'ETH', sells.map((r) => r.base).join(','));
  await page.locator('[data-whale-side="all"]').click();
  await page.waitForTimeout(250);

  /* 검색 */
  await page.locator('[data-whale-search]').fill('sol');
  await page.waitForTimeout(300);
  const searched = await readRows();
  check('고래: 코인 검색', searched.length === 1 && searched[0].base === 'SOL', searched.map((r) => r.base).join(','));
  await page.locator('[data-whale-search]').fill('');
  await page.waitForTimeout(250);
  await page.locator('[data-whale-threshold="250000"]').click();
  await page.waitForTimeout(250);
  await shot('168-whale-tape-filters');
  await page.locator('[data-whale-threshold="50000"]').click();
  await page.waitForTimeout(250);

  /* 일시정지 → 재개 */
  await page.locator('[data-whale-pause]').click();
  await page.waitForTimeout(300);
  sendTrade('XRPUSDT', 'buy', '2', '150000', 'ws-xrp-pause');
  await page.waitForTimeout(1200);
  const pausedRows = await readRows();
  check('고래: 일시정지 중 새 체결은 안 보임', pausedRows.length === 5, `${pausedRows.length}줄`);
  await page.locator('[data-whale-pause]').click();
  await page.waitForTimeout(700);
  const resumedRows = await readRows();
  check(
    '고래: 재개하면 그동안의 체결이 나옴',
    resumedRows.length === 6 && resumedRows.some((r) => r.base === 'XRP' && r.usd === 300_000),
    resumedRows.map((r) => `${r.base}/$${r.usd}`).join(' · '),
  );

  /* ---------- 3) 📰 실시간 코인 뉴스 ---------- */
  await page.locator('.menu-back').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-row[data-menu="news"]').click();
  await page.waitForSelector('[data-news-tab]', { timeout: 20000 });
  await page.waitForSelector('[data-news-item]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const news = await page.evaluate(() => ({
    count: document.querySelector('[data-news-count]')?.textContent?.trim(),
    status: document.querySelector('[data-news-status]')?.textContent?.replace(/\s+/g, ' ').trim(),
    items: [...document.querySelectorAll('[data-news-item]')].map((el) => ({
      source: el.getAttribute('data-source'),
      tone: el.getAttribute('data-tone'),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
    })),
    feeds: [...document.querySelectorAll('[data-news-feed]')].map((el) => `${el.getAttribute('data-news-feed')}:${el.classList.contains('off') ? 'off' : 'on'}`),
    partial: document.querySelector('[data-news-partial]')?.textContent?.replace(/\s+/g, ' ').trim(),
    error: !!document.querySelector('[data-news-error]'),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('뉴스: 2개 피드 5건 표시', news.count === '5건' && news.items.length === 5, `${news.count} · ${news.items.length}건`);
  check('뉴스: 피드 상태 표시(2 실패)', news.feeds.filter((f) => f.endsWith(':off')).length === 2, news.feeds.join(' '));
  check(
    '뉴스: 일부 실패 안내(나머지로 표시)',
    /블록체인투데이/.test(news.partial ?? '') && !news.error,
    news.partial,
  );
  check(
    '뉴스: 코인·호재·악재 배지',
    news.items.some((i) => i.tone === 'good' && /BTC/.test(i.text) && /ETF/.test(i.text)) &&
      news.items.some((i) => i.tone === 'bad' && /ETH/.test(i.text)),
    news.items.map((i) => `${i.source}/${i.tone}`).join(' '),
  );
  check('뉴스: 상대 시간 표기', news.items.some((i) => /\d+분 전/.test(i.text)), news.items[0]?.text.slice(0, 40));
  check('뉴스: 390px 오버플로 0건', !news.overflow);
  await shot('169-news-tab');

  /* 필터 */
  await page.locator('[data-news-filter="kr"]').click();
  await page.waitForTimeout(300);
  const kr = await page.evaluate(() => [...document.querySelectorAll('[data-news-item]')].map((el) => el.getAttribute('data-source')));
  check('뉴스: 한국 뉴스 필터', kr.length === 3 && kr.every((s) => s === 'blockmedia'), kr.join(','));
  await page.locator('[data-news-filter="global"]').click();
  await page.waitForTimeout(300);
  const global = await page.evaluate(() => [...document.querySelectorAll('[data-news-item]')].map((el) => el.getAttribute('data-source')));
  check('뉴스: 글로벌 필터', global.length === 2 && global.every((s) => s === 'cointelegraph'), global.join(','));
  await page.locator('[data-news-filter="signal"]').click();
  await page.waitForTimeout(300);
  const signal = await page.evaluate(() => [...document.querySelectorAll('[data-news-item]')].map((el) => el.getAttribute('data-tone')));
  check('뉴스: 호재·악재 필터(중립 제외)', signal.length === 4 && !signal.includes('neutral'), signal.join(','));
  await shot('170-news-filters');
  await page.locator('[data-news-filter="all"]').click();
  await page.waitForTimeout(250);

  /* 원문 새 창 */
  await page.locator('[data-news-item]').first().click();
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => window.__opened);
  check('뉴스: 원문 기사 새 창 열기', opened.some((u) => /blockmedia\.co\.kr/.test(u)), opened.join(','));

  /* ---------- 4) 시황 탭 바로가기 ---------- */
  await page.locator('.bottom-nav button[data-tab="market"]').click();
  await page.waitForSelector('[data-open-news]', { timeout: 20000 });
  const shortcut = await page.evaluate(() => document.querySelector('[data-open-news]')?.textContent?.replace(/\s+/g, ' ').trim());
  check('시황: 뉴스 바로가기 버튼', /실시간 코인 뉴스 보기/.test(shortcut ?? ''), shortcut);
  await shot('171-market-news-shortcut');
  await page.locator('[data-open-news]').click();
  await page.waitForSelector('[data-news-tab]', { timeout: 20000 });
  check('시황 → 뉴스 화면 이동', !!(await page.locator('[data-news-tab]').count()));

  /* ---------- 5) 전부 실패 → 다시 시도 ---------- */
  newsMode = 'fail';
  await page.locator('[data-tab="menu"]').last().click();
  await page.waitForTimeout(400);
  await page.locator('.menu-row[data-menu="news"]').click();
  await page.waitForSelector('[data-news-tab]', { timeout: 20000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 30000 });
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-row[data-menu="news"]').click();
  await page.waitForSelector('[data-news-error]', { timeout: 20000 });
  const failed = await page.evaluate(() => ({
    error: document.querySelector('[data-news-error]')?.textContent?.replace(/\s+/g, ' ').trim(),
    items: document.querySelectorAll('[data-news-item]').length,
    empty: !!document.querySelector('[data-news-empty]'),
  }));
  check('뉴스: 전부 실패 → 안내 배너 + 빈 목록', /불러오지 못했습니다/.test(failed.error ?? '') && failed.items === 0, failed.error?.slice(0, 60));
  await shot('172-news-error-retry');

  newsMode = 'mixed';
  await page.locator('[data-news-error] .ghost-btn').click();
  await page.waitForSelector('[data-news-item]', { timeout: 20000 });
  const recovered = await page.evaluate(() => document.querySelectorAll('[data-news-item]').length);
  check('뉴스: 다시 시도로 회복', recovered === 5, `${recovered}건`);

  await context.close();
  await browser.close();

  const realErrors = consoleErrors.filter(
    (e) => !/429|500 \(Internal Server Error\)|Failed to load resource|net::ERR/.test(e),
  );
  check(
    '콘솔/페이지 에러 0건 (모의 실패 응답 제외)',
    realErrors.length === 0 && pageErrors.length === 0,
    JSON.stringify({ consoleErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }),
  );

  const report = { hub, tape, rows1, news, checks };
  writeFileSync('.tmp/realtime-report.json', JSON.stringify(report, null, 2));
  const failedChecks = checks.filter((c) => !c.ok);
  console.log(
    `\n${failedChecks.length ? '❌' : '✅'} 고래 체결 테이프·실시간 코인 뉴스 E2E: ${checks.length - failedChecks.length}/${checks.length} 통과${
      failedChecks.length ? ` · 실패: ${failedChecks.map((f) => f.name).join(' / ')}` : ''
    }`,
  );
  if (failedChecks.length) process.exitCode = 1;
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
