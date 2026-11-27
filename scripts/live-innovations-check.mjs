/**
 * 🧠🧲🌊 매매 DNA · 청산 자석 · 섹터 순환 레이더 라이브(배포본) 검증
 *   실행: node scripts/live-innovations-check.mjs
 *
 *  배포된 https://hw3238.github.io/bitget-signal-scanner/ 에서 실제로
 *   ① 메뉴에 세 카드(🧠🧲🌊)와 도구 13개가 보이고
 *   ② 청산 자석이 실시간 캔들로 카드를 그리며(점수 0~100 · 상방>현재가>하방)
 *   ③ 섹터 레이더가 7섹터 순위와 대장주/후발주를 계산하고
 *   ④ 매매 DNA 가 기록 0건이면 안내만, 데모를 켜면 DEMO 표기와 함께 계산되는지 확인한다.
 *  세션·Supabase 는 가짜로 응답해 실제 DB 는 건드리지 않는다.
 */
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const URL = 'https://hw3238.github.io/bitget-signal-scanner/';
const OUT = 'docs/screens';

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const num = (t) => Number(String(t ?? '').replace(/[^0-9.-]/g, ''));

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
    localStorage.removeItem('bgss.history.v1');
    localStorage.removeItem('bgss.mytrades.v1');
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // 전체 스캔 완료를 기다리지 않는다 — 세 화면은 각자 필요한 데이터만 쓴다.
  await page.waitForSelector('.bottom-nav button[data-tab="menu"]', { timeout: 60000 });
  const bundle = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(','));

  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(700);
  const hub = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.menu-row')].map((r) => r.dataset.menu),
    hero: document.querySelector('.menu-hero-count b')?.textContent?.trim(),
    emojis: ['dna', 'magnet', 'sector'].map((k) => document.querySelector(`.menu-row[data-menu="${k}"] .menu-emoji`)?.textContent?.trim()),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check(
    '라이브 메뉴: 도구 12 + 자동매매 = 13 · 🧠🧲🌊 카드',
    hub.rows.length === 12 && hub.hero === '13' && hub.emojis.join('') === '🧠🧲🌊' && !hub.overflow,
    `${hub.rows.length}+1=${hub.hero} · ${hub.emojis.join('')}`,
  );
  await page.screenshot({ path: `${OUT}/162-live-menu-innovations.png` });

  /* 🧲 청산 자석 */
  await page.locator('.menu-row[data-menu="magnet"]').click();
  await page.waitForSelector('[data-magnet] [data-card]', { timeout: 150000 });
  await page.waitForTimeout(500);
  const mag = await page.evaluate(() => {
    const card = document.querySelector('[data-magnet] [data-card]');
    const levels = [...document.querySelectorAll('.magnet-levels-row')].map((r) => [...r.querySelectorAll('span')].map((c) => c.textContent.trim()));
    return {
      cards: document.querySelectorAll('[data-magnet] [data-card]').length,
      symbol: card?.getAttribute('data-card'),
      squeeze: Number(card?.getAttribute('data-squeeze')),
      up: Number(card?.querySelector('[data-up-score]')?.getAttribute('data-up-score')),
      down: Number(card?.querySelector('[data-down-score]')?.getAttribute('data-down-score')),
      priceRaw: (card?.querySelector('.magnet-name span')?.textContent ?? '').split('·')[0],
      levels: levels.length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(
    '라이브 청산 자석: 카드 렌더 · 점수 0~100 · squeeze = 큰 쪽',
    mag.cards >= 2 && mag.up >= 0 && mag.up <= 100 && mag.down >= 0 && mag.down <= 100 && mag.squeeze === Math.max(mag.up, mag.down) && !mag.overflow,
    `${mag.cards}장 · ${mag.symbol} ${mag.up}/${mag.down} → ${mag.squeeze}`,
  );
  await page.locator('[data-magnet] [data-card]').first().click();
  await page.waitForSelector('[data-magnet-detail]', { timeout: 5000 });
  const table = await page.evaluate(() =>
    [...document.querySelectorAll('.magnet-levels-row')].map((r) => {
      const cells = [...r.querySelectorAll('span')].map((c) => c.textContent.trim());
      return { lev: Number(cells[0].replace(/[^0-9]/g, '')), up: Number(cells[1].split('(')[0].replace(/[^0-9.-]/g, '')), down: Number(cells[2].split('(')[0].replace(/[^0-9.-]/g, '')) };
    }),
  );
  const price = num(mag.priceRaw);
  check(
    '라이브 청산 자석: 레버리지 4단 · 상방 > 현재가 > 하방',
    table.length === 4 && table.every((l) => l.up > price && l.down < price) && table[0].up > table[3].up,
    table.map((l) => `${l.lev}x ${l.up}/${l.down}`).join(' · ') + ` (현재 ${price})`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/163-live-liquidation-magnet.png` });
  await page.locator('.menu-back').click();
  await page.waitForTimeout(300);

  /* 🌊 섹터 */
  await page.locator('.menu-row[data-menu="sector"]').click();
  await page.waitForSelector('[data-sector] [data-row]', { timeout: 60000 });
  await page.waitForFunction(
    () => Number(document.querySelector('[data-sector] .sec-item')?.getAttribute('data-score') ?? 0) > 0,
    { timeout: 60000 },
  );
  const sec = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('[data-sector] .sec-item')].map((r) => Number(r.getAttribute('data-score'))),
    top: document.querySelector('[data-sector-top]')?.textContent?.trim(),
    sub: document.querySelector('[data-sector-sub]')?.textContent?.replace(/\s+/g, ' ').trim(),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check(
    '라이브 섹터: 7섹터 · 점수 내림차순 · 매핑 종목 수',
    sec.rows.length === 7 && sec.rows.every((v, i) => v >= 0 && v <= 100 && (i === 0 || sec.rows[i - 1] >= v)) && /\d+종목 매핑/.test(sec.sub ?? '') && !sec.overflow,
    `${sec.top} · ${sec.rows.join(' > ')}`,
  );
  await page.locator('[data-sector] .sec-row').first().click();
  await page.waitForSelector('[data-sector-detail]', { timeout: 5000 });
  const pair = await page.evaluate(() => ({
    leader: document.querySelector('.sec-coin.leader')?.getAttribute('data-coin'),
    lags: [...document.querySelectorAll('.sec-coin.lag')].map((c) => c.getAttribute('data-coin')),
  }));
  check('라이브 섹터: 대장주/후발주 구분 표시', !!pair.leader, `대장 ${pair.leader} · 후발 ${pair.lags.join(',') || '없음'}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/164-live-sector-radar.png` });
  await page.locator('.menu-back').click();
  await page.waitForTimeout(300);

  /* 🧠 매매 DNA — 기록 0건 안내 → 데모 */
  await page.locator('.menu-row[data-menu="dna"]').click();
  await page.waitForSelector('[data-dna]', { timeout: 20000 });
  const empty = await page.evaluate(() => ({
    empty: document.querySelector('[data-dna-empty]')?.textContent?.replace(/\s+/g, ' ').trim(),
    cumR: document.querySelector('[data-dna-cumr]')?.textContent?.trim(),
  }));
  check('라이브 DNA: 기록 0건이면 안내만(가짜 수치 없음)', /매매 기록이 없습니다/.test(empty.empty ?? '') && empty.cumR === '—', empty.cumR);
  await page.locator('[data-dna-mode="demo"]').click();
  await page.waitForTimeout(500);
  const demo = await page.evaluate(() => ({
    badge: [...document.querySelectorAll('[data-dna] .tool-badge')].map((b) => b.textContent.trim()).join('|'),
    cumR: document.querySelector('[data-dna-cumr]')?.textContent?.trim(),
    revenge: document.querySelector('[data-dna-revenge-count]')?.textContent?.trim(),
    note: document.querySelector('[data-dna-demo-note]')?.textContent?.replace(/\s+/g, ' ').trim(),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check(
    '라이브 DNA: 데모 = DEMO 표기 · 38건 계산',
    /DEMO/.test(demo.badge) && /가짜 기록/.test(demo.note ?? '') && demo.cumR === '+9.20R' && !demo.overflow,
    `${demo.cumR} · 재진입 ${demo.revenge}`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/165-live-trade-dna.png` });

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource/.test(e));
  check('라이브 콘솔/페이지 에러 0건', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ realErrors: realErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }));

  await context.close();
  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n배포 번들: ${bundle}`);
  console.log(`${failed.length ? '❌' : '✅'} 라이브 DNA·청산 자석·섹터 검증 ${failed.length ? `실패 ${failed.length}건: ${failed.map((f) => f.name).join(' / ')}` : `통과 (${checks.length}개 확인)`}`);
  if (failed.length) process.exitCode = 1;
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
