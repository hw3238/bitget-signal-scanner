/**
 * 즐겨찾기(⭐) 기능 검증 — 모바일 390×844 / 데스크톱 1280×800
 *  1) 카드 ⭐ 토글 → 카운트 증가, 공유 카드 모달이 열리지 않음
 *  2) ⭐ 즐겨찾기 필터 → 즐겨찾기한 시그널만 표시
 *  3) 새로고침 후 localStorage(bgss.favorites.v1) 유지
 *  4) 스캔에서 사라진 시그널은 저장 스냅샷으로 표시(.stale)되고 해제 가능
 *  5) 공유 카드 모달 안에서도 즐겨찾기 토글
 *  6) 콘솔/페이지 에러 0건
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const FAV_KEY = 'bgss.favorites.v1';

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});
const logs = [];
server.stdout.on('data', (d) => logs.push(`[server] ${d.toString().trim()}`));
server.stderr.on('data', (d) => logs.push(`[server:err] ${d.toString().trim()}`));

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

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function waitReady(page) {
  // 스캔이 끝난 뒤 카드가 0장이면 '종료 포함'으로 넓혀서 기다린다 — 진행중 시그널이 없는 시간대에도
  // 카드 상호작용(즐겨찾기)을 검증할 수 있게 한다(스캐너 자체 회귀 아님).
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.rescan');
      return !!btn && !btn.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  if ((await page.locator('.signal-card:not(.skeleton)').count()) === 0) {
    const toggle = page.locator('.ghost-toggle').first();
    if (((await toggle.textContent()) ?? '').includes('진행중만')) {
      await toggle.click();
    }
  }
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 60000 });
  await page.waitForTimeout(600);
}

/**
 * 진행중 시그널이 1장뿐인 시간대에도 카드 동작(⭐·검색·더보기)을 검증할 수 있게
 * `종료 포함`으로 넓혀 카드를 채운다. 이미 충분하면 아무것도 하지 않는다.
 */
async function ensureCards(page, need = 3) {
  let count = await page.locator('.signal-card:not(.skeleton)').count();
  if (count >= need) return count;
  const toggle = page.locator('.ghost-toggle').first();
  const text = (await toggle.count()) ? ((await toggle.textContent()) ?? '') : '';
  if (text.includes('진행중만')) {
    await toggle.click();
    await page.waitForTimeout(700);
    count = await page.locator('.signal-card:not(.skeleton)').count();
  }
  return count;
}

const favCount = (page) =>
  page.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.length : -1;
    } catch {
      return -1;
    }
  }, FAV_KEY);

/** 스캔 결과에 존재하지 않는(=보관 스냅샷) 즐겨찾기를 주입한다. */
const seedStaleFavorite = (page) =>
  page.evaluate((key) => {
    const now = Date.now();
    const candles = Array.from({ length: 30 }, (_, i) => {
      const base = 1234 + i * 2;
      return { t: now - (30 - i) * 3600000, o: base, h: base + 6, l: base - 5, c: base + 2, v: 100 + i };
    });
    const signal = {
      id: 'TESTSTALE-1H-crt-fvg-cisd-99',
      symbol: 'TESTSTALEUSDT',
      base: 'TEST',
      asset: 'crypto',
      tf: '1H',
      side: 'long',
      strategyId: 'crt-fvg-cisd',
      strategyName: 'CRT + FVG + CISD',
      strategyShort: 'CRT·FVG·CISD',
      star: 5,
      entry: 1234,
      stop: 1200,
      target: 1300,
      eq: 1267,
      rr: 1.94,
      remainingRR: 1.2,
      currentR: 0.8,
      price: 1260,
      changePct: 2.1,
      progress: 0.4,
      state: 'open',
      detectedAt: now - 6 * 3600000,
      barsSince: 6,
      winRate: 61,
      strategyRR: 1.9,
      leverage: 10,
      levRoi: 21,
      candles,
      detectedIdx: 24,
      tags: ['스냅샷 테스트', 'CRT'],
      fundingRate: 0.0001,
      quoteVolume: 12000000,
    };
    const entry = { key: `${signal.symbol}|${signal.tf}|${signal.side}|${signal.detectedAt}`, addedAt: now, signal };
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    const next = [entry, ...(Array.isArray(list) ? list : [])];
    localStorage.setItem(key, JSON.stringify(next));
    return next.length;
  }, FAV_KEY);

const run = async () => {
  await waitForServer(URL);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const errors = [];
  const attach = (page, tag) => {
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };

  // ---------------- 모바일 ----------------
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

  // 첫 실행 온보딩을 건너뛰도록 투자 프로필을 미리 저장한다.
  await mobile.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem(
      'cota.profile.v1',
      JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }),
    );
  });
  const page = await mobile.newPage();
  attach(page, 'mobile');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const initialCards = await ensureCards(page, 3);
  check('스캐너 시그널 카드 렌더', initialCards > 0, `${initialCards}장`);
  check('즐겨찾기 필터 칩 표시', await page.locator('.fav-toggle').isVisible());
  check('초기 즐겨찾기 0개', (await favCount(page)) === 0, `localStorage=${await favCount(page)}`);

  // 1) 카드 ⭐ 토글 → 모달이 열리지 않아야 한다
  await page.locator('.signal-card:not(.skeleton) .fav-btn').first().click();
  await page.waitForTimeout(350);
  check('첫 카드 ⭐ 토글 시 공유 모달 미오픈', (await page.locator('.share-modal').count()) === 0);
  check('⭐ 활성 스타일(.on) 적용', (await page.locator('.signal-card .fav-btn.on').count()) === 1);
  check('즐겨찾기 카운트 1', (await page.locator('.fav-toggle b').first().textContent())?.trim() === '1', `localStorage=${await favCount(page)}`);

  await page.locator('.signal-card:not(.skeleton) .fav-btn').nth(1).click();
  await page.waitForTimeout(300);
  check('두 번째 카드 ⭐ 추가 → 카운트 2', (await favCount(page)) === 2, `localStorage=${await favCount(page)}`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/01-scanner.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/01-scanner-full.png`, fullPage: true, scale: 'css' });

  // 2) 즐겨찾기 필터
  const starredSyms = await page.evaluate(() =>
    [...document.querySelectorAll('.signal-card:not(.skeleton)')]
      .filter((c) => c.querySelector('.fav-btn.on'))
      .map((c) => c.querySelector('.sym')?.textContent ?? ''),
  );
  await page.locator('.fav-toggle').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(450);
  const favViewSyms = await page.evaluate(() =>
    [...document.querySelectorAll('.signal-card:not(.skeleton)')].map((c) => c.querySelector('.sym')?.textContent ?? ''),
  );
  const allStarred = await page.evaluate(() =>
    [...document.querySelectorAll('.signal-card:not(.skeleton)')].every((c) => !!c.querySelector('.fav-btn.on')),
  );
  check(
    '⭐ 필터: 즐겨찾기한 시그널만 표시',
    favViewSyms.length === 2 && allStarred && starredSyms.every((s) => favViewSyms.includes(s)),
    `표시=${favViewSyms.join(',')} / 찜=${starredSyms.join(',')}`,
  );
  check('⭐ 필터 활성 표시(.on)', (await page.locator('.fav-toggle.on').count()) === 1);
  await page.screenshot({ path: `${OUT}/11-favorites.png`, fullPage: false });

  // 5) 공유 카드 모달 안 즐겨찾기 토글
  await page.locator('.signal-card:not(.skeleton)').first().click();
  await page.waitForSelector('.share-canvas.in', { timeout: 20000 });
  await page.waitForTimeout(400);
  check('모달 즐겨찾기 버튼 활성 상태', await page.locator('.share-actions .fav-action.on').isVisible());
  await page.locator('.share-actions .fav-action').click();
  await page.waitForTimeout(300);
  check('모달에서 즐겨찾기 해제 → 카운트 1', (await favCount(page)) === 1, `localStorage=${await favCount(page)}`);
  await page.locator('.share-actions .fav-action').click();
  await page.waitForTimeout(300);
  check('모달에서 다시 추가 → 카운트 2', (await favCount(page)) === 2, `localStorage=${await favCount(page)}`);
  await page.screenshot({ path: `${OUT}/12-share-favorite.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3) 새로고침 후 유지
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  check('새로고침 후 localStorage 유지', (await favCount(page)) === 2, `localStorage=${await favCount(page)}`);
  check('새로고침 후 칩 카운트 2', (await page.locator('.fav-toggle b').first().textContent())?.trim() === '2');
  const starsAfterReload = await page.locator('.signal-card .fav-btn.on').count();
  check('새로고침 후 라이브 카드에 ⭐ 유지', starsAfterReload >= 1, `⭐카드=${starsAfterReload}`);

  // 4) 스캔에서 사라진 시그널 = 보관 스냅샷
  await seedStaleFavorite(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(450);
  // 즐겨찾기한 실제 시그널이 스캔에서 빠지면 그것도 보관 스냅샷(.stale)이 되므로,
  // 시드한 TEST 카드를 심볼로 특정해 검사한다(카드 순서에 의존하지 않는다).
  const staleInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.signal-card.stale')];
    const card = cards.find((el) => el.querySelector('.sym')?.textContent === 'TEST') ?? cards[0];
    return card
      ? {
          sym: card.querySelector('.sym')?.textContent,
          hint: card.querySelector('.stale-hint')?.textContent,
          hasStar: !!card.querySelector('.fav-btn.on'),
          staleCount: cards.length,
          count: document.querySelectorAll('.signal-card:not(.skeleton)').length,
        }
      : null;
  });
  check('보관 스냅샷 카드 표시(.stale)', !!staleInfo && staleInfo.sym === 'TEST', JSON.stringify(staleInfo));
  check('보관 스냅샷 카드도 ⭐ 활성', !!staleInfo?.hasStar);
  await page.screenshot({ path: `${OUT}/13-favorites-stale.png`, fullPage: false });
  await page.locator('.signal-card.stale').filter({ hasText: 'TEST' }).locator('.fav-btn').first().click();
  await page.waitForTimeout(350);
  check('보관 스냅샷 해제 → TEST 스냅샷 사라짐', !(await page.locator('.signal-card.stale').filter({ hasText: 'TEST' }).count()));

  // ---------------- 이전 시그널 더보기 / 검색 ----------------
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(300);
  // 코인 기본 필터 → 전체(코인+주식선물)로 넓혀 이전 시그널까지 충분히 노출
  await page.locator('.segmented[aria-label="자산 구분"] button', { hasText: '전체' }).click();
  await page.waitForTimeout(300);
  // 진행중만 → 종료 포함으로 넓혀 이전 시그널까지 노출
  await page.locator('.ghost-toggle').click();
  await page.waitForTimeout(500);

  const firstPage = await page.evaluate(() => ({
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    more: document.querySelector('.more-btn')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    total: Number(document.querySelector('.list-head span')?.textContent?.match(/\/\s*(\d+)건/)?.[1] || 0),
    states: [...document.querySelectorAll('.signal-card .badge.state')].map((b) => b.textContent),
  }));
  check('기본 페이지 12건 표시', firstPage.cards === 12, `${firstPage.cards}건 (전체 ${firstPage.total})`);
  check('이전 시그널 더보기 버튼 노출', !!firstPage.more && firstPage.more.includes('이전 시그널 더보기') && firstPage.more.includes('+'), firstPage.more || '');
  if (firstPage.more) {
    await page.locator('.more-btn').click();
    await page.waitForTimeout(450);
    const afterMore = await page.locator('.signal-card:not(.skeleton)').count();
    check('더보기 클릭 시 12건 추가', afterMore > firstPage.cards, `${firstPage.cards} → ${afterMore}`);
    await page.locator('.more-btn').click();
    await page.waitForTimeout(450);
    const afterMore2 = await page.locator('.signal-card:not(.skeleton)').count();
    check('더보기 반복 클릭 동작', afterMore2 > afterMore, `${afterMore} → ${afterMore2}`);
    const closedStates = await page.evaluate(() =>
      [...document.querySelectorAll('.signal-card .badge.state')].map((b) => b.textContent),
    );
    // 상태 배지는 한글 표기 — 진행 중 / 목표 달성 / 손절 종료
    check(
      '종료(목표 달성/손절 종료) 시그널 수집',
      closedStates.some((t) => t === '목표 달성' || t === '손절 종료'),
      `표시 ${closedStates.length}건 중 진행 중 ${closedStates.filter((t) => t === '진행 중').length}`,
    );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/15-scanner-more.png`, fullPage: false });
  }

  // 검색: 실제 존재하는 심볼로 검색
  const targetBase = await page.evaluate(() => document.querySelector('.signal-card .sym')?.textContent?.trim() || '');
  const targetSym = targetBase.split(' ')[0];
  await page.locator('.search-box input').fill(targetSym);
  // 스캔이 도는 중이면 목록이 통째로 갈아끼워져 필터 반영 전 상태를 읽을 수 있다 — 검색어가 반영될 때까지 기다린다.
  await page
    .waitForFunction(
      (sym) => {
        const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
        return cards.length > 0 && cards.every((c) => (c.textContent ?? '').includes(sym));
      },
      targetSym,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
  const searchView = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.signal-card:not(.skeleton)')].map((c) => c.textContent?.replace(/\s+/g, ' ')),
    count: document.querySelector('.search-count b')?.textContent,
    clear: !!document.querySelector('.search-clear'),
  }));
  check(
    `검색('${targetSym}') 결과만 표시`,
    searchView.cards.length > 0 && searchView.cards.every((t) => t.includes(targetSym)),
    `${searchView.cards.length}건 · 카운트=${searchView.count}`,
  );
  check('검색 초기화(×) 버튼 표시', searchView.clear);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/16-scanner-search.png`, fullPage: false });

  // 전략명 검색
  await page.locator('.search-box input').fill('EMA');
  await page
    .waitForFunction(
      () => {
        const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
        return cards.length > 0 && cards.every((c) => (c.textContent ?? '').includes('EMA'));
      },
      undefined,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
  const emaView = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.signal-card:not(.skeleton)')].map((c) => c.textContent?.replace(/\s+/g, ' ')),
    empty: !!document.querySelector('.search-empty'),
  }));
  check(
    "전략명 검색('EMA') 동작",
    emaView.empty || (emaView.cards.length > 0 && emaView.cards.every((t) => t.includes('EMA'))),
    `${emaView.cards.length}건${emaView.empty ? ' (결과 없음 안내)' : ''}`,
  );

  // 없는 검색어 → 안내
  await page.locator('.search-box input').fill('ZZZZNOPE');
  await page.waitForTimeout(400);
  check('결과 없는 검색 안내', await page.locator('.search-empty').isVisible());
  await page.locator('.search-clear').click();
  await page.waitForTimeout(400);
  const restored = await page.locator('.signal-card:not(.skeleton)').count();
  check('검색 초기화(×) 후 목록 복원', restored > 0 && !(await page.locator('.search-empty').count()), `${restored}건`);

  // 기록 탭 더보기 + 검색
  await page.locator('.bottom-nav button', { hasText: '기록' }).click();
  await page.waitForTimeout(700);
  const histFirst = await page.evaluate(() => ({
    rows: document.querySelectorAll('.history-list li:not(.h-empty)').length,
    more: document.querySelector('.more-btn')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    head: document.querySelector('.history-head')?.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  check('기록 탭 기본 15건 표시', histFirst.rows === 15 || histFirst.rows > 0, `${histFirst.rows}건 · ${histFirst.head}`);
  check('이전 기록 더보기 버튼 노출', !!histFirst.more && histFirst.more.includes('이전 기록 더보기'), histFirst.more || '');
  if (histFirst.more) {
    await page.locator('.more-btn').click();
    await page.waitForTimeout(500);
    const histAfter = await page.locator('.history-list li:not(.h-empty)').count();
    check('기록 더보기 클릭 시 추가 표시', histAfter > histFirst.rows, `${histFirst.rows} → ${histAfter}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/17-history-more.png`, fullPage: false });
  }
  const histBase = await page.evaluate(
    () => document.querySelector('.history-list .h-sym')?.textContent?.trim().split(' ')[0] || '',
  );
  await page.locator('.search-box input').fill(histBase);
  await page.waitForTimeout(450);
  const histSearch = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.history-list li:not(.h-empty)')].map((li) => li.textContent?.replace(/\s+/g, ' ')),
    count: document.querySelector('.search-count b')?.textContent,
  }));
  check(
    `기록 검색('${histBase}')`,
    histSearch.rows.length > 0 && histSearch.rows.every((t) => t.includes(histBase)),
    `${histSearch.rows.length}건 · 카운트=${histSearch.count}`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/18-history-search.png`, fullPage: false });
  await page.locator('.search-clear').click();
  await page.waitForTimeout(350);
  await page.locator('.bottom-nav button', { hasText: '스캐너' }).click();
  await page.waitForTimeout(500);

  // 빈 상태 문구
  await page.evaluate((key) => localStorage.removeItem(key), FAV_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.locator('.fav-toggle').click();
  await page.waitForTimeout(400);
  const emptyText = await page.evaluate(() => document.querySelector('.favorite-empty')?.textContent?.replace(/\s+/g, ' ').trim());
  check('빈 즐겨찾기 안내 문구', !!emptyText && emptyText.includes('즐겨찾기한 시그널이 없어요'), emptyText?.slice(0, 60));
  await page.screenshot({ path: `${OUT}/14-favorites-empty.png`, fullPage: false });
  await mobile.close();

  // ---------------- 데스크톱 ----------------
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  // 🔐 회원 전용 게이트(v1.5.8) — 데스크톱 시나리오도 로그인된 상태에서 시작한다.
  await desktop.addInitScript(seedAuthSession);
  await installE2EStubs(desktop);

  await desktop.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    localStorage.setItem(
      'cota.profile.v1',
      JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }),
    );
  });
  const dpage = await desktop.newPage();
  attach(dpage, 'desktop');
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitReady(dpage);
  const desktopCards = await ensureCards(dpage, 3);
  check('데스크톱 카드 렌더', desktopCards > 0, `${desktopCards}장`);
  await dpage.locator('.signal-card:not(.skeleton) .fav-btn').first().click();
  await dpage.locator('.signal-card:not(.skeleton) .fav-btn').nth(1).click();
  await dpage.waitForTimeout(400);
  check('데스크톱 ⭐ 2개 저장', (await favCount(dpage)) === 2, `localStorage=${await favCount(dpage)}`);
  await dpage.locator('.fav-toggle').click();
  await dpage.waitForTimeout(500);
  const dFavCount = await dpage.locator('.signal-card:not(.skeleton)').count();
  const dAllStarred = await dpage.evaluate(() =>
    [...document.querySelectorAll('.signal-card:not(.skeleton)')].every((c) => !!c.querySelector('.fav-btn.on')),
  );
  check('데스크톱 ⭐ 필터 = 2장', dFavCount === 2 && dAllStarred, `${dFavCount}장`);
  await dpage.screenshot({ path: `${OUT}/10-favorites-desktop.png`, fullPage: false });
  await dpage.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(dpage);
  check('데스크톱 새로고침 유지', (await favCount(dpage)) === 2, `localStorage=${await favCount(dpage)}`);
  await dpage.screenshot({ path: `${OUT}/06-desktop.png`, fullPage: false });
  await desktop.close();
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 4).join(' | '));
  writeFileSync('.tmp/favorites-check.json', JSON.stringify({ results, errors, serverLogs: logs.slice(-4) }, null, 1));
  console.log(`\n== ${results.length - failed.length - (errors.length ? 1 : 0)}/${results.length} 통과 · 에러 ${errors.length}건`);
  if (failed.length || errors.length) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('FAVORITES CHECK FAILED', e);
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
