/**
 * COTA 스캔 속도 벤치마크 — 헤드리스 Chromium 실제 환경 측정
 *
 *  측정
 *   - first : 첫 진입(빈 localStorage) — 첫 시그널 카드 표시까지 · 스캔 완료까지 · 캔들/티커 요청 수 · 429 수
 *   - warm  : 재진입(직전 localStorage 유지) — 첫 카드 표시까지(스냅숏 복원) · 배경 갱신 완료까지
 *             + 상단 새로고침 버튼(강제 재스캔) 완료까지 · 그때의 요청 수/429
 *
 *  실행
 *   node scripts/perf-bench.mjs --label before --phase first
 *   node scripts/perf-bench.mjs --label before --phase warm
 *   → .tmp/perf-<label>.json 에 단계별 결과 누적
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4179;
const URL = `http://127.0.0.1:${PORT}/`;
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : fallback;
};
const label = argOf('--label', 'run');
const phase = argOf('--phase', 'first');
const outPath = argOf('--out', `.tmp/perf-${label}.json`);
const storagePath = `.tmp/perf-storage-${label}.json`;

mkdirSync('.tmp', { recursive: true });

function waitForServer(url, timeoutMs = 60000) {
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
      setTimeout(tick, 300);
    };
    tick();
  });
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}`,
    },
    detached: true,
  },
);

const results = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf8'))
  : { label, at: new Date().toISOString(), phases: {}, errors: [] };
results.phases = results.phases ?? {};
results.errors = results.errors ?? [];

const idle = async (page, timeout = 240000) => {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.rescan');
      return !!btn && !btn.classList.contains('busy');
    },
    { timeout, polling: 50 },
  );
};

function instrument(page) {
  const net = { candles: 0, tickers: 0, contracts: 0, other: 0, total: 0, e429: 0, failed: 0, inflight: 0, maxInflight: 0 };
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('request', (req) => {
    const u = req.url();
    if (!u.includes('api.bitget.com')) return;
    net.total += 1;
    net.inflight += 1;
    net.maxInflight = Math.max(net.maxInflight, net.inflight);
    if (u.includes('/market/candles')) net.candles += 1;
    else if (u.includes('/market/tickers')) net.tickers += 1;
    else if (u.includes('/market/contracts')) net.contracts += 1;
    else net.other += 1;
  });
  const settle = (req) => {
    if (!req.url().includes('api.bitget.com')) return;
    net.inflight = Math.max(0, net.inflight - 1);
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', (req) => {
    settle(req);
    if (req.url().includes('api.bitget.com')) net.failed += 1;
  });
  page.on('response', (res) => {
    if (res.url().includes('api.bitget.com') && res.status() === 429) net.e429 += 1;
  });
  return {
    net,
    consoleErrors,
    snapshot: () =>
      page.evaluate(() => ({
        cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
        skeleton: document.querySelectorAll('.signal-card.skeleton').length,
        statusText: document.querySelector('.status-text')?.textContent?.trim() ?? '',
        speedChip: document.querySelector('[data-scan-speed]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        feedNote: document.querySelector('.feed-note')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      })),
  };
}

const PROFILE = { seed: 1000, style: 'conservative', updatedAt: Date.now() };

try {
  await waitForServer(URL);
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `/workspace/.deps/root/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH ?? ''}`,
    },
  });

  const useStorage = phase !== 'first' && existsSync(storagePath);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ...(useStorage ? { storageState: storagePath } : {}),
  });
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await context.addInitScript(seedAuthSession);
  await installE2EStubs(context);

  if (!useStorage) {
    await context.addInitScript((profile) => {
      localStorage.setItem('cota.exchange.v1', 'bitget');
      try {
        localStorage.setItem('cota.profile.v1', JSON.stringify(profile));
      } catch {
        /* ignore */
      }
    }, PROFILE);
  }
  const page = await context.newPage();
  const { net, consoleErrors, snapshot } = instrument(page);

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  let firstCardMs = null;
  try {
    await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 240000 });
    firstCardMs = Date.now() - t0;
  } catch {
    results.errors.push(`${phase}: no signal card`);
  }
  // 첫 진입 측정: 첫 카드가 그려진 뒤 '스캔 완료'까지
  const firstIdleMs = firstCardMs;
  let scanDoneMs = null;
  try {
    await idle(page, 240000);
    scanDoneMs = Date.now() - t0;
  } catch {
    results.errors.push(`${phase}: scan never finished`);
  }
  await page.waitForTimeout(900);

  const afterFirst = await snapshot();
  const netFirst = { ...net };

  const row = {
    phase,
    at: new Date().toISOString(),
    firstCardMs: firstIdleMs,
    scanDoneMs,
    cards: afterFirst.cards,
    statusText: afterFirst.statusText,
    speedChip: afterFirst.speedChip,
    feedNote: afterFirst.feedNote,
    net: netFirst,
    consoleErrors: consoleErrors.length,
    consoleErrorSamples: consoleErrors.slice(0, 4),
  };

  if (phase !== 'first') {
    // 강제 재스캔(상단 새로고침 버튼) — 스캔 완료까지
    const before = { ...net };
    const tRescan = Date.now();
    await page.locator('.rescan').click();
    try {
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.rescan');
          return !!btn && btn.classList.contains('busy');
        },
        { timeout: 20000, polling: 30 },
      );
    } catch {
      results.errors.push(`${phase}: rescan did not go busy`);
    }
    let rescanMs = null;
    try {
      await idle(page, 240000);
      rescanMs = Date.now() - tRescan;
    } catch {
      results.errors.push(`${phase}: rescan never finished`);
    }
    await page.waitForTimeout(600);
    row.rescanMs = rescanMs;
    row.rescanNet = {
      candles: net.candles - before.candles,
      tickers: net.tickers - before.tickers,
      contracts: net.contracts - before.contracts,
      total: net.total - before.total,
      e429: net.e429 - before.e429,
      failed: net.failed - before.failed,
    };
    const afterRescan = await snapshot();
    row.cardsAfterRescan = afterRescan.cards;
    row.speedChipAfterRescan = afterRescan.speedChip;
  }

  await context.storageState({ path: storagePath });
  await browser.close();

  results.phases[phase] = row;
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(row, null, 2));
  console.log(`\n saved → ${outPath}`);
} catch (e) {
  results.errors.push(`${phase}: ${String(e).slice(0, 400)}`);
  console.error(String(e).slice(0, 1200));
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  try {
    process.kill(-server.pid);
  } catch {
    /* 이미 종료 */
  }
}
