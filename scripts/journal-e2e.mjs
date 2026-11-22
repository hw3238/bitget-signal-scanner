/**
 * 기록 탭 — 실전 복기 & 수익곡선 대시보드 E2E 검증
 *   A) 고정 기록(localStorage 주입 · 네트워크 차단)으로 정확한 수치 검증
 *      - 전체 시그널 / 📌 내 진입 매매 세그먼트 집계(승률·평균 R·누적 R·시드 기준 누적 손익)
 *      - 누적 R 수익곡선 SVG(이익 구간 토스 블루 · 손실 구간 빨강 · 0선 클리핑) · MDD · 연승/연패
 *      - 전략별 성적(누적 R 순) · 한 줄 복기 저장 · 내 진입 해제/복원 · 중복 기록 정리
 *   B) 실시간 스캔: 카드 원탭 `내 진입` → 저장·표시 유지(새로고침) → 기록 탭 내 매매 집계 · 390px 오버플로 0건
 *   C) 기록이 없을 때의 빈 상태
 *
 *   실행: npm run build && node scripts/journal-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

/* 컨테이너에 libnss3 등 시스템 라이브러리가 없을 때 — 추출해 둔 로컬 라이브러리를 먼저 쓴다 */

const PORT = 4178;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const HISTORY_KEY = 'bgss.history.v1';
const TRADES_KEY = 'bgss.mytrades.v1';

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
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const T = (min) => Date.UTC(2026, 10, 20, 0, 0) + min * 60_000;
const key = (symbol, tf, side, t) => `${symbol}|${tf}|${side}|${t}`;

/* ---------- 고정 기록 — 종료 5건(+2, -1, +3, -1, -1) + 진행 1건 + 중복 1건 ---------- */
const rec = (over) => ({
  id: over.id,
  symbol: 'BTCUSDT',
  base: 'BTC',
  asset: 'crypto',
  tf: '1H',
  side: 'long',
  strategyId: 'crt-fvg-cisd',
  strategyShort: 'CRT·FVG·CISD',
  entry: 100,
  stop: 95,
  target: 115,
  rr: 3,
  riskPct: 5,
  detectedAt: 0,
  firstSeen: 0,
  state: 'open',
  r: 0,
  bars: 1,
  ...over,
});

const w1 = rec({ id: 'w1', detectedAt: T(10), state: 'win', r: 2, strategyId: 'crt-fvg-cisd', strategyShort: 'CRT·FVG·CISD' });
const l1 = rec({ id: 'l1', detectedAt: T(20), state: 'loss', r: -1, strategyId: 'ema-pullback-rsi', strategyShort: 'EMA 눌림·RSI', base: 'ETH', symbol: 'ETHUSDT', side: 'short' });
const w2 = rec({ id: 'w2', detectedAt: T(30), state: 'win', r: 3, strategyId: 'sweep-ob', strategyShort: '스윕·OB', tf: '4H' });
const l2 = rec({ id: 'l2', detectedAt: T(40), state: 'loss', r: -1, strategyId: 'bb-squeeze-break', strategyShort: 'BB 스퀴즈', base: 'SOL', symbol: 'SOLUSDT' });
const l3 = rec({ id: 'l3', detectedAt: T(50), state: 'loss', r: -1, strategyId: 'bb-squeeze-break', strategyShort: 'BB 스퀴즈', base: 'SOL', symbol: 'SOLUSDT' });
const o1 = rec({ id: 'o1', detectedAt: T(60), state: 'open', r: 0.4, strategyId: 'supertrend-donchian', strategyShort: 'ST·돈치안', tf: '4H', side: 'short', base: 'XRP', symbol: 'XRPUSDT' });
/** 스캔이 반복되며 진입 인덱스가 바뀐 같은 시그널 — 화면에서는 1건으로 집계돼야 한다 */
const l1dup = { ...l1, id: 'l1-entryIdx-shifted' };

const history = [w1, l1, w2, l2, l3, o1, l1dup];
const trades = [
  { key: key('BTCUSDT', '1H', 'long', T(10)), enteredAt: T(11), memo: '원칙 준수' },
  { key: key('ETHUSDT', '1H', 'short', T(20)), enteredAt: T(21), memo: '추격 매수 주의' },
  { key: key('XRPUSDT', '4H', 'short', T(60)), enteredAt: T(61), memo: '' },
  { key: key('DOGEUSDT', '1H', 'long', T(5)), enteredAt: T(6), memo: '기록 지워진 진입' },
];

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const consoleErrors = [];
  const pageErrors = [];
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  const newMobile = async (init) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    await context.addInitScript((data) => {
      localStorage.setItem('cota.profile.v1', JSON.stringify({ seed: 5000, style: 'conservative', updatedAt: Date.now() }));
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
      if (data.history) localStorage.setItem('bgss.history.v1', JSON.stringify(data.history));
      if (data.trades) localStorage.setItem('bgss.mytrades.v1', JSON.stringify(data.trades));
    }, init);
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    return { context, page };
  };

  /* ======================= A) 고정 기록 대시보드 ======================= */
  const A = await newMobile({ history, trades });
  // 실시간 스캔이 고정 기록을 덮어쓰지 않도록 비트겟 API를 막는다.
  await A.context.route('**/api.bitget.com/**', (route) => route.abort());
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await A.page.waitForSelector('.history-tab, .scanner-tab', { timeout: 30000 });
  await A.page.locator('.bottom-nav button[data-tab="history"]').click();
  await A.page.waitForSelector('.history-tab .equity-panel', { timeout: 20000 });
  await A.page.waitForTimeout(700);

  const readMode = () =>
    A.page.evaluate(() => {
      const tab = document.querySelector('.history-tab');
      return {
        modes: [...tab.querySelectorAll('.trade-mode button')].map((b) => ({
          text: b.textContent.replace(/\s+/g, ' ').trim(),
          on: b.classList.contains('on'),
        })),
        stats: [...tab.querySelectorAll('.summary-card .stat')].map((s) => ({
          label: s.querySelector('.stat-label')?.textContent?.replace(/\s+/g, ' ').trim(),
          value: s.querySelector('b')?.textContent?.replace(/\s+/g, ' ').trim(),
          sub: s.querySelector('.stat-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
        })),
        kpi: [...tab.querySelectorAll('.equity-kpi span')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
        base: tab.querySelector('.equity-basis')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        strat: [...tab.querySelectorAll('.strat-chip')].map((li) => ({
          name: li.querySelector('.sc-main b')?.textContent?.trim(),
          meta: li.querySelector('.sc-main span')?.textContent?.replace(/\s+/g, ' ').trim(),
          r: li.querySelector('.sc-result b')?.textContent?.trim(),
          sub: li.querySelector('.sc-result span')?.textContent?.trim(),
        })),
        head: tab.querySelector('.history-head')?.textContent?.replace(/\s+/g, ' ').trim(),
        rows: tab.querySelectorAll('.history-list li:not(.h-empty)').length,
        mineRows: tab.querySelectorAll('.history-list li.mine').length,
        memos: [...tab.querySelectorAll('.h-memo input')].map((i) => i.value),
        svg: !!tab.querySelector('.equity-svg'),
        clipGroups: tab.querySelectorAll('.equity-svg g[clip-path]').length,
        aboveStroke: (() => {
          const el = tab.querySelector('.equity-line.above');
          return el ? getComputedStyle(el).stroke : null;
        })(),
        belowStroke: (() => {
          const el = tab.querySelector('.equity-line.below');
          return el ? getComputedStyle(el).stroke : null;
        })(),
        aboveFill: (() => {
          const el = tab.querySelector('.equity-area.above');
          return el ? getComputedStyle(el).fill : null;
        })(),
        lastAbove: !!tab.querySelector('.equity-last.above'),
        legend: tab.querySelector('.equity-legend')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        pathD: tab.querySelector('.equity-line.above')?.getAttribute('d')?.length ?? 0,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });

  const A0 = await readMode();
  check(
    '세그먼트 = 전체 시그널 6건 · 내 진입 매매 3건 (중복·미연결 진입 제외)',
    A0.modes.map((m) => m.text).join('|') === '전체 시그널 6|📌 내 진입 매매 3' && A0.modes[0].on,
    A0.modes.map((m) => m.text).join(' / '),
  );
  check(
    '전체: 추적 시그널 6 · 목표 2 · 손절 3 · 진행 1',
    A0.stats[0]?.label === '추적 시그널' &&
      A0.stats[0]?.value === '6' &&
      A0.stats[0]?.sub === '목표 달성 2 · 손절 종료 3 · 진행 중 1',
    `${A0.stats[0]?.value} · ${A0.stats[0]?.sub}`,
  );
  check('전체: 목표 달성률 40.0%', A0.stats[1]?.value === '40.0%', A0.stats[1]?.value);
  check(
    '전체: 실현 3x 수익률 = Σ(R×손절폭)×3 = +30.00%',
    A0.stats[2]?.value === '+30.00%' && /평균 0\.40R/.test(A0.stats[2]?.sub ?? ''),
    `${A0.stats[2]?.label} ${A0.stats[2]?.value} · ${A0.stats[2]?.sub}`,
  );
  check('전체: 진행중 평가 = 0.4R×5%×3 = +6.00%', A0.stats[3]?.value === '+6.00%', A0.stats[3]?.value);

  check('수익곡선 SVG 렌더', A0.svg && A0.pathD > 40 && A0.clipGroups === 2, `path ${A0.pathD}자 · clip ${A0.clipGroups}`);
  check('이익 구간 = 토스 블루(#3182F6)', A0.aboveStroke === 'rgb(49, 130, 246)', A0.aboveStroke);
  check('손실 구간 = 빨강(#F04452)', A0.belowStroke === 'rgb(240, 68, 82)', A0.belowStroke);
  check('이익 영역 옅은 블루 채움', /49, 130, 246/.test(A0.aboveFill ?? ''), A0.aboveFill);
  check('마지막 점 = 이익 구간', A0.lastAbove);
  check('0선 범례 표시', /0선 위 = 이익/.test(A0.legend) && /0선 아래 = 손실/.test(A0.legend), A0.legend);
  check(
    '곡선 KPI = 현재 +2.00R · MDD -2.00R · 연승 1 · 연패 2',
    A0.kpi.join('|') === '현재 +2.00R|최대 낙폭 -2.00R|최장 연승 1|최장 연패 2',
    A0.kpi.join(' / '),
  );
  check(
    '누적 손익 기준 = 시드 $5,000 · 1회 1.5% → +$150.00',
    /시드 \$5,000 · 1회 리스크 1\.5% 기준 누적 손익 \+\$150\.00/.test(A0.base),
    A0.base,
  );
  check(
    '전략별 성적 = 누적 R 순 5행',
    A0.strat.length === 5 &&
      A0.strat.map((s) => s.name).join('|') === '스윕·OB|CRT·FVG·CISD|EMA 눌림·RSI|BB 스퀴즈|ST·돈치안',
    A0.strat.map((s) => `${s.name} ${s.r}`).join(' / '),
  );
  check(
    '전략 행 내용: 스윕·OB +3.00R · BB 2건 0승 -2.00R',
    A0.strat[0]?.r === '+3.00R' &&
      /종료 1건 · 승률 100%/.test(A0.strat[0]?.meta ?? '') &&
      A0.strat[3]?.r === '-2.00R' &&
      /종료 2건 · 승률 0%/.test(A0.strat[3]?.meta ?? ''),
    `${A0.strat[0]?.meta} / ${A0.strat[3]?.meta}`,
  );
  check('전체 기록 6건 · 중복 7→6 정리', /전체 기록 6 \/ 6건/.test(A0.head ?? ''), A0.head);
  check('390px 기록 탭 가로 오버플로 0건', !A0.overflow);

  await A.page.screenshot({ path: `${OUT}/47-history-dashboard.png`, fullPage: true });

  /* ---------- 내 진입 매매 모드 ---------- */
  await A.page.locator('.trade-mode button').nth(1).click();
  await A.page.waitForTimeout(500);
  const A1 = await readMode();
  check(
    '내 진입: 내 매매 3건 (목표 1 · 손절 1 · 진행 1)',
    A1.stats[0]?.label === '내 진입 매매' &&
      A1.stats[0]?.value === '3' &&
      A1.stats[0]?.sub === '목표 달성 1 · 손절 종료 1 · 진행 중 1',
    `${A1.stats[0]?.value} · ${A1.stats[0]?.sub}`,
  );
  check('내 진입: 내 승률 50.0%', A1.stats[1]?.value === '50.0%', A1.stats[1]?.value);
  check(
    '내 진입: 누적 R +1.00R · 평균 +0.50R',
    A1.stats[2]?.value === '+1.00R' && /평균 \+0\.50R · 2건/.test(A1.stats[2]?.sub ?? ''),
    `${A1.stats[2]?.value} · ${A1.stats[2]?.sub}`,
  );
  check(
    '내 진입: 누적 손익 +$75.00 (시드 $5,000 · 1회 1.5%)',
    A1.stats[3]?.value === '+$75.00' && /시드 \$5,000 · 1회 1\.5%/.test(A1.stats[3]?.sub ?? ''),
    `${A1.stats[3]?.value} · ${A1.stats[3]?.sub}`,
  );
  check(
    '내 진입 곡선 = 현재 +1.00R · 낙폭 -1.00R (고점 2R → 1R)',
    A1.kpi.join('|') === '현재 +1.00R|최대 낙폭 -1.00R|최장 연승 1|최장 연패 1',
    A1.kpi.join(' / '),
  );
  check(
    '내 진입 전략 = 3개 전략 + 진행 1',
    A1.strat.length === 3 && A1.strat.map((s) => s.name).join('|') === 'CRT·FVG·CISD|EMA 눌림·RSI|ST·돈치안',
    A1.strat.map((s) => s.name).join(' / '),
  );
  check(
    '내 매매 3행 · 한 줄 복기 입력 3개',
    A1.rows === 3 && A1.mineRows === 3 && A1.memos.length === 3,
    `rows ${A1.rows} · mine ${A1.mineRows} · memo ${A1.memos.length}`,
  );
  check('복기 메모 기존 값 유지', A1.memos.includes('원칙 준수') && A1.memos.includes('추격 매수 주의'), A1.memos.join(' / '));
  check(
    '기록 지워진 진입은 집계 제외 안내',
    /기록이 지워진 진입 1건 제외/.test(A1.head ?? ''),
    A1.head,
  );
  check('내 진입 모드 390px 오버플로 0건', !A1.overflow);

  // 한 줄 복기 저장 — 가장 최근(진행 중) 매매에 입력
  const firstMemo = A.page.locator('.history-tab .h-memo input').first();
  const firstMemoKey = await A.page.evaluate(() => {
    const li = document.querySelector('.history-tab .history-list li');
    const sym = li.querySelector('.h-sym')?.firstChild?.textContent?.trim();
    const tfText = li.querySelector('.h-sym i')?.textContent?.trim();
    const long = !!li.querySelector('.badge.long');
    const time = li.querySelector('.h-time')?.textContent?.trim() ?? '';
    return { sym, tfText, long, time };
  });
  await firstMemo.fill('분할 익절 예정');
  await A.page.waitForTimeout(300);
  const storedMemos = await A.page.evaluate(() => JSON.parse(localStorage.getItem('bgss.mytrades.v1') || '[]'));
  check(
    '복기 메모 저장 → localStorage 반영',
    storedMemos.some((t) => t.memo === '분할 익절 예정'),
    storedMemos.map((t) => t.memo).join(' / '),
  );
  await A.page.screenshot({ path: `${OUT}/48-history-my-trades.png`, fullPage: true });
  check('복기 입력 필드 = 해당 매매 행', !!firstMemoKey.sym, `${firstMemoKey.sym} ${firstMemoKey.tfText}`);

  // 내 진입 해제 → 집계에서 빠짐 / 전체에서 다시 진입 표시
  await A.page.locator('.history-tab .history-list li .pin-btn').first().click();
  await A.page.waitForTimeout(400);
  const afterOff = await A.page.evaluate(() => ({
    mode: document.querySelector('.trade-mode button.on')?.textContent?.replace(/\s+/g, ' ').trim(),
    stats0: document.querySelector('.summary-card .stat b')?.textContent?.trim(),
    count: JSON.parse(localStorage.getItem('bgss.mytrades.v1') || '[]').length,
  }));
  check(
    '진입 해제 → 내 매매 2건 · 저장 3건(미연결 1건 유지)',
    afterOff.stats0 === '2' && afterOff.count === 3,
    `${afterOff.mode} · ${afterOff.stats0} · 저장 ${afterOff.count}`,
  );

  await A.page.locator('.trade-mode button').nth(0).click();
  await A.page.waitForTimeout(400);
  const allPins = await A.page.evaluate(() =>
    [...document.querySelectorAll('.history-tab .history-list li')].map((li) => ({
      sym: li.querySelector('.h-sym')?.firstChild?.textContent?.trim(),
      pin: li.querySelector('.pin-btn')?.classList.contains('on'),
      text: li.querySelector('.pin-btn')?.textContent?.trim(),
    })),
  );
  check(
    '전체 모드: 진입한 행만 ✓ 진입함',
    allPins.filter((p) => p.pin).length === 2 && allPins.filter((p) => !p.pin).length === 4,
    allPins.map((p) => `${p.sym}${p.pin ? '✓' : '·'}`).join(' '),
  );
  // 해제했던 매매를 다시 진입으로 표시 (XRP 4H 숏 행)
  const xrpRow = A.page.locator('.history-tab .history-list li', { hasText: 'XRP' }).first();
  await xrpRow.locator('.pin-btn').click();
  await A.page.waitForTimeout(400);
  const restored = await A.page.evaluate(() => ({
    count: document.querySelector('.trade-mode button:nth-child(2)')?.textContent?.replace(/\s+/g, ' ').trim(),
    stored: JSON.parse(localStorage.getItem('bgss.mytrades.v1') || '[]').length,
  }));
  check(
    '다시 진입 표시 → 내 매매 3건 복원',
    /내 진입 매매 3/.test(restored.count ?? '') && restored.stored === 4,
    `${restored.count} · 저장 ${restored.stored}`,
  );
  await A.context.close();

  /* ======================= B) 실시간 스캔 · 카드 원탭 ======================= */
  const B = await newMobile({});
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('.scanner-tab .signal-card:not(.skeleton)', { timeout: 180000 });
  await B.page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await B.page.waitForTimeout(900);

  const cardAction = await B.page.evaluate(() => {
    const card = document.querySelector('.scanner-tab .signal-card:not(.skeleton)');
    const row = card.querySelector('.card-actions');
    const pin = row?.querySelector('.pin-btn');
    return {
      cards: document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)').length,
      hasPin: !!pin,
      label: pin?.textContent?.trim(),
      pressed: pin?.getAttribute('aria-pressed'),
      copyBtns: [...row.querySelectorAll('.copy-btn')].map((b) => b.textContent.trim()),
      bitget: !!row.querySelector('.bitget-link'),
      rowOverflow: row ? row.scrollWidth > row.clientWidth + 1 : null,
      cardOverflow: card.scrollWidth > card.clientWidth + 1,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      shareHintInFoot: !!card.querySelector('.card-foot .share-hint'),
      sent: card.querySelector('.tag.sent')?.textContent?.trim(),
      sym: card.querySelector('.sym')?.textContent?.trim(),
      counter: [...document.querySelectorAll('.counter.mine')].map((c) => c.textContent.trim()),
    };
  });
  check('카드에 원탭 내 진입 버튼', cardAction.hasPin && cardAction.label === '📌 내 진입' && cardAction.pressed === 'false', cardAction.label);
  check(
    '카드 액션 행 유지(비트겟·진입가·수량) + 390px 오버플로 0',
    cardAction.bitget && cardAction.copyBtns.join('|') === '진입가|수량' && !cardAction.rowOverflow && !cardAction.cardOverflow && !cardAction.docOverflow,
    `copy=${cardAction.copyBtns.join('/')} row=${cardAction.rowOverflow} card=${cardAction.cardOverflow}`,
  );
  check('공유 안내는 카드 푸터로 이동', cardAction.shareHintInFoot && /^발송 /.test(cardAction.sent ?? ''), cardAction.sent);

  await B.page.locator('.scanner-tab .signal-card:not(.skeleton) .pin-btn').first().click();
  await B.page.waitForTimeout(400);
  const pinned = await B.page.evaluate((sym) => {
    const card = document.querySelector('.scanner-tab .signal-card:not(.skeleton)');
    const pin = card.querySelector('.pin-btn');
    const stored = JSON.parse(localStorage.getItem('bgss.mytrades.v1') || '[]');
    return {
      label: pin.textContent.trim(),
      pressed: pin.getAttribute('aria-pressed'),
      stored: stored.length,
      storedKeys: stored.map((t) => t.key),
      shareOpen: !!document.querySelector('.share-canvas.in'),
      counter: [...document.querySelectorAll('.counter.mine')].map((c) => c.textContent.trim()),
      sym,
    };
  }, cardAction.sym);
  check(
    '원탭 → ✓ 진입함 · aria-pressed true · 공유 모달은 열리지 않음',
    pinned.label === '✓ 진입함' && pinned.pressed === 'true' && !pinned.shareOpen,
    `${pinned.label} / ${pinned.pressed}`,
  );
  check(
    'localStorage 에 저장(진입 아님→진입)',
    pinned.stored === 1 && pinned.storedKeys[0].startsWith(`${cardAction.sym}USDT|`),
    `${pinned.stored}건 · ${pinned.storedKeys[0]}`,
  );
  check('스캐너 카운터에 내 진입 표시', pinned.counter.join(' ').includes('내 진입 1'), pinned.counter.join(' / '));
  // 카드 액션 행(내 진입·비트겟·복사)이 한 화면에 보이게 캡처
  await B.page.evaluate(() => {
    document.querySelector('.scanner-tab .signal-card:not(.skeleton) .card-actions')?.scrollIntoView({ block: 'center' });
  });
  await B.page.waitForTimeout(400);
  await B.page.screenshot({ path: `${OUT}/49-scanner-entry-pin.png` });

  // 새로고침 후에도 유지
  await B.page.reload({ waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('.scanner-tab .signal-card:not(.skeleton)', { timeout: 180000 });
  await B.page.waitForTimeout(1500);
  const afterReload = await B.page.evaluate(() => ({
    on: [...document.querySelectorAll('.scanner-tab .pin-btn.on')].map((b) => b.textContent.trim()),
  }));
  check('새로고침 후에도 ✓ 진입함 유지', afterReload.on.includes('✓ 진입함'), afterReload.on.join(' / '));

  await B.page.locator('.bottom-nav button[data-tab="history"]').click();
  await B.page.waitForSelector('.history-tab .equity-panel', { timeout: 20000 });
  await B.page.waitForTimeout(600);
  const liveHistory = await B.page.evaluate(() => {
    const tab = document.querySelector('.history-tab');
    const stats = [...tab.querySelectorAll('.summary-card .stat')].map((s) => ({
      label: s.querySelector('.stat-label')?.textContent?.trim(),
      value: s.querySelector('b')?.textContent?.trim(),
    }));
    return {
      mode: tab.querySelector('.trade-mode button')?.textContent?.replace(/\s+/g, ' ').trim(),
      stats,
      rows: tab.querySelectorAll('.history-list li:not(.h-empty)').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      curve: !!tab.querySelector('.equity-svg') || !!tab.querySelector('.equity-empty'),
    };
  });
  check(
    '실시간 기록 탭: 전체 시그널 집계·수익곡선 영역 렌더',
    liveHistory.stats[0]?.label === '추적 시그널' && Number(liveHistory.stats[0]?.value) >= 1 && liveHistory.curve && !liveHistory.overflow,
    `${liveHistory.mode} · ${liveHistory.stats[0]?.label} ${liveHistory.stats[0]?.value} · ${liveHistory.rows}행`,
  );
  await B.page.locator('.trade-mode button').nth(1).click();
  await B.page.waitForTimeout(500);
  const liveMine = await B.page.evaluate(() => {
    const tab = document.querySelector('.history-tab');
    return {
      rows: tab.querySelectorAll('.history-list li:not(.h-empty)').length,
      mine: tab.querySelectorAll('.history-list li.mine').length,
      label: tab.querySelector('.summary-card .stat b')?.textContent?.trim(),
      memo: tab.querySelectorAll('.h-memo input').length,
      empty: tab.querySelectorAll('.h-empty').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(
    '카드에서 표시한 매매가 기록 탭 내 진입에 연결',
    liveMine.rows === 1 && liveMine.mine === 1 && liveMine.label === '1' && liveMine.memo === 1 && !liveMine.overflow,
    `${liveMine.rows}행 · ${liveMine.label}건 · memo ${liveMine.memo}`,
  );
  await B.page.screenshot({ path: `${OUT}/50-live-history-my-trade.png`, fullPage: true });
  await B.context.close();

  /* ======================= C) 기록 없음 빈 상태 ======================= */
  const C = await newMobile({});
  await C.context.route('**/api.bitget.com/**', (route) => route.abort());
  await C.page.goto(URL, { waitUntil: 'networkidle' });
  await C.page.waitForSelector('.history-tab, .scanner-tab', { timeout: 30000 });
  await C.page.locator('.bottom-nav button[data-tab="history"]').click();
  await C.page.waitForSelector('.history-tab .equity-panel', { timeout: 20000 });
  await C.page.waitForTimeout(500);
  const empty = await C.page.evaluate(() => {
    const tab = document.querySelector('.history-tab');
    return {
      curve: tab.querySelector('.equity-empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      board: tab.querySelector('.strat-panel .equity-empty')?.textContent?.trim() ?? '',
      stats: [...tab.querySelectorAll('.summary-card .stat b')].map((b) => b.textContent.trim()),
      mode: tab.querySelector('.trade-mode button')?.textContent?.replace(/\s+/g, ' ').trim(),
    };
  });
  check(
    '빈 기록: 수익곡선·전략 안내 문구',
    /수익곡선을 그릴 종료 매매가 없어요/.test(empty.curve) && /전략별 성적을 계산할 수 없어요/.test(empty.board),
    empty.curve.slice(0, 40),
  );
  check('빈 기록: 추적 0건 · 승률 -', empty.stats[0] === '0' && empty.stats[1] === '-' && /전체 시그널 0/.test(empty.mode ?? ''), empty.stats.join(' / '));
  await C.page.screenshot({ path: `${OUT}/51-history-empty.png`, fullPage: true });
  await C.context.close();

  await browser.close();

  const realErrors = consoleErrors.filter((e) => !/429|Failed to load resource|ERR_FAILED|net::/.test(e));
  check('콘솔/페이지 에러 0건 (의도적 네트워크 차단 제외)', realErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ realErrors, pageErrors }));

  const report = {
    A: { all: A0, mine: A1 },
    B: { cardAction, pinned, afterReload, liveHistory, liveMine },
    C: empty,
    checks,
    consoleErrors: realErrors,
    pageErrors,
    allOk: checks.every((c) => c.ok),
  };
  writeFileSync('.tmp/journal-e2e-report.json', JSON.stringify(report, null, 1));
  console.log(`\n${report.allOk ? '✅ 기록 대시보드 E2E 통과' : `❌ 실패 ${checks.filter((c) => !c.ok).length}건`} (${checks.length}개 확인)`);
  if (!report.allOk) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('E2E FAILED', e);
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
