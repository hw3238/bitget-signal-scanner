/**
 * 🔔 시그널 핸드폰 알림 검증
 *
 *  1) 순수 로직(중복 방지·대상 필터·문구) 단위 검증 — src/lib/notify.ts 를 esbuild로 묶어 실행
 *  2) 헤드리스 Chromium: 설정 탭 🔔 핸드폰 알림 UI, 기본값, 테스트 알림(ntfy 동시 전송),
 *     첫 로딩 시 과거 시그널 미알림, 새로고침 후 중복 미발생, 콘솔 에러 0건,
 *     docs/screens/16-settings-notify.png 저장
 *
 * 실행: npm run build && LD_LIBRARY_PATH=/workspace/.deps/root/usr/lib/x86_64-linux-gnu node scripts/notify-check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { chromium } from 'playwright';

const PORT = 4174;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (ok) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ------------------------------------------------------------------ *
 * 1) 순수 로직
 * ------------------------------------------------------------------ */

const signal = (over) => ({
  id: `${over.symbol ?? 'XAUUSDT'}-1H-x-1`,
  symbol: 'XAUUSDT',
  base: 'XAUUSD+',
  asset: 'fx',
  tf: '1H',
  side: 'long',
  state: 'open',
  detectedAt: 1000,
  entry: 4132.5,
  stop: 4118,
  target: 4158,
  winRate: 62.4,
  decimals: 2,
  ...over,
});

async function logicChecks() {
  console.log('\n[1/2] 알림 로직');
  await esbuild({
    entryPoints: ['src/lib/notify.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: '.tmp/notify.mjs',
    logLevel: 'silent',
  });
  const n = await import(pathToFileURL(`${process.cwd()}/.tmp/notify.mjs`).href);

  // 중복 방지 키
  check(
    n.signalKey(signal({})) === 'XAUUSDT|1H|long|1000',
    '중복 판정 키 = symbol|tf|side|detectedAt',
    n.signalKey(signal({})),
  );

  // 대상 필터
  const gold = signal({});
  const euro = signal({ symbol: 'EURUSDUSDT', base: 'EURUSD+', detectedAt: 1001 });
  const btc = signal({ symbol: 'BTCUSDT', base: 'BTC', asset: 'crypto', detectedAt: 1002 });
  const tsla = signal({ symbol: 'TSLAUSDT', base: 'TSLA', asset: 'stock', detectedAt: 1003 });
  check(
    [gold, euro, btc].every((s) => n.matchesNotifyTarget(s, 'priority')) &&
      !n.matchesNotifyTarget(tsla, 'priority'),
    '주력 3종목 = 금·유로·비트만',
  );
  check(
    n.matchesNotifyTarget(gold, 'fx') && n.matchesNotifyTarget(euro, 'fx') && !n.matchesNotifyTarget(btc, 'fx'),
    'FX·금 전체 = FX·금 시그널만',
  );
  check(
    [gold, euro, btc, tsla].every((s) => n.matchesNotifyTarget(s, 'all')),
    '전체 종목 = 코인·주식·FX 전부',
  );
  check(
    !n.matchesNotifyTarget(signal({ state: 'win' }), 'all'),
    '이미 목표/무효가 된 시그널은 알림 제외',
  );

  // 첫 스캔 기준선 → 60초 갱신 시나리오
  const scan1 = [gold, btc];
  const seen = new Set(scan1.map(n.signalKey));
  check(n.pickNewSignals(scan1, seen, 'all').length === 0, '첫 스캔 시그널은 알림 없이 기록');
  check(n.pickNewSignals([...scan1], seen, 'all').length === 0, '같은 시그널이 갱신돼도 다시 울리지 않음');

  const scan2 = [gold, btc, signal({ symbol: 'EURUSDUSDT', base: 'EURUSD+', detectedAt: 2000 })];
  const fresh = n.pickNewSignals(scan2, seen, 'priority');
  check(fresh.length === 1 && fresh[0].symbol === 'EURUSDUSDT', '새로 감지된 시그널만 1건 알림', `${fresh.length}건`);
  check(
    n.pickNewSignals([signal({ detectedAt: 3000 }), signal({ detectedAt: 3000 })], new Set(), 'priority')
      .length === 1,
    '한 갱신에 같은 시그널이 두 번 들어와도 1건',
  );
  check(
    n.pickNewSignals([signal({ detectedAt: 5000 }), signal({ detectedAt: 4000 })], new Set(), 'priority')[0]
      .detectedAt === 4000,
    '알림은 감지가 오래된 순으로',
  );

  // 문구
  const msg = n.buildSignalMessage(signal({}), { lot: 0.1 });
  check(msg.title === 'XAUUSD+ 1시간 롱 시그널', '알림 제목', msg.title);
  check(msg.body.includes('0.10 Lot') && msg.body.includes('62%'), '알림 본문(랏·승률)', msg.body);
  const test = n.buildTestMessage(0.1, signal({}));
  check(test.title.startsWith('[테스트] ') && test.title.endsWith('감지'), '테스트 알림 문구', test.title);
  check(n.buildTestMessage(0.1, null).body.includes('0.10 Lot'), '테스트 알림(신호 없을 때) 안내 문구');

  // ntfy
  check(n.ntfyEndpoint('bgss-hw3238-9f4k2m') === 'https://ntfy.sh/bgss-hw3238-9f4k2m', 'ntfy 토픽 → 게시 URL');
  check(n.ntfyEndpoint('https://ntfy.sh/x') === 'https://ntfy.sh/x', 'ntfy 전체 URL 그대로 사용');
  check(n.ntfyEndpoint('   ') === null, 'ntfy 비어 있으면 호출 안 함');
  check(n.hashId('XAUUSDT|1H|long|1000') === n.hashId('XAUUSDT|1H|long|1000'), '알림 id 해시 안정적');
  check(n.hashId('a') > 0 && n.hashId('a') < 100001, '알림 id 범위(1~100000)');
}

/* ------------------------------------------------------------------ *
 * 2) 브라우저
 * ------------------------------------------------------------------ */

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

async function browserChecks() {
  console.log('\n[2/2] 설정 화면 · 알림 동작');
  mkdirSync(OUT, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
    detached: true,
  });

  try {
    await waitForServer(URL);
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      permissions: ['notifications'],
    });

    // 브라우저 Notification 를 가로채 기록.
    // (헤드리스 Chromium 은 알림 권한을 항상 denied 로 두므로, 앱이 부르는 Notification API
    //  계약(permission / requestPermission / 생성자)을 granted 로 대신해 호출 여부를 검증한다.)
    await context.addInitScript(() => {
      window.__notified = [];
      class FakeNotification {
        constructor(title, options = {}) {
          window.__notified.push({ title, body: options.body, tag: options.tag, at: Date.now() });
          this.title = title;
          this.body = options.body;
        }
        close() {}
        static permission = 'granted';
        static requestPermission() {
          return Promise.resolve('granted');
        }
      }
      Object.defineProperty(window, 'Notification', {
        value: FakeNotification,
        configurable: true,
        writable: true,
      });
    });

    // ntfy 푸시는 가로채서 전송 내용만 확인
    const ntfyCalls = [];
    await context.route('https://ntfy.sh/**', async (route) => {
      const req = route.request();
      ntfyCalls.push({ url: req.url(), body: req.postData() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      });
    });

    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 150000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.rescan');
        return !!btn && !btn.classList.contains('busy');
      },
      { timeout: 150000 },
    );
    await page.waitForTimeout(1500);

    const baseline = await page.evaluate(() => ({
      notified: window.__notified.length,
      keys: JSON.parse(localStorage.getItem('bgss.notified.v1') || '[]'),
      openCards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    }));
    check(baseline.notified === 0, '첫 로딩: 과거 시그널을 한꺼번에 알리지 않음', `알림 ${baseline.notified}건`);
    check(baseline.keys.length > 0, '첫 로딩 시그널을 중복 방지 기록에 저장', `${baseline.keys.length}건`);

    // 설정 탭 → 🔔 핸드폰 알림
    await page.locator('.bottom-nav button[data-tab="settings"]').click();
    await page.waitForSelector('#settings-notify', { timeout: 20000 });
    await page.waitForTimeout(500);

    const ui = await page.evaluate(() => {
      const panel = document.querySelector('#settings-notify');
      const targetButtons = [...panel.querySelectorAll('.notify-target button')];
      return {
        heading: panel.querySelector('h3')?.textContent?.trim(),
        note: panel.querySelector('.panel-note')?.textContent?.trim(),
        switchOn: panel.querySelector('.switch')?.classList.contains('on'),
        targets: targetButtons.map((b) => b.textContent?.trim()),
        targetOn: panel.querySelector('.notify-target button.on')?.textContent?.trim(),
        ntfy: panel.querySelector('.td-key-input')?.value,
        ntfyDesc: [...panel.querySelectorAll('.setting-desc')].map((d) => d.textContent?.trim()).find((t) => t?.includes('ntfy')),
        testBtn: [...panel.querySelectorAll('button')].map((b) => b.textContent?.trim()).find((t) => t?.includes('테스트')),
        hasGrant: [...panel.querySelectorAll('button')].some((b) => b.textContent?.includes('권한 허용')),
        stored: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}'),
      };
    });
    check(ui.heading === '🔔 핸드폰 알림', '설정 탭에 🔔 핸드폰 알림 섹션', ui.heading);
    check(ui.switchOn === true, '시그널 알림 기본 ON');
    check(ui.targets.length === 3, '알림 대상 3개 선택지', ui.targets.join(' / '));
    check(ui.targetOn === '주력 3종목', '알림 대상 기본값 = 주력 3종목', ui.targetOn);
    check(ui.ntfy === 'bgss-hw3238-9f4k2m', 'ntfy 전용 토픽 기본값', ui.ntfy);
    check(!!ui.testBtn, '알림 테스트 버튼', ui.testBtn);

    // 화면 캡처
    await page.evaluate(() => {
      const panel = document.querySelector('#settings-notify');
      if (panel) window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 60);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/16-settings-notify.png` });
    await page.screenshot({ path: `${OUT}/16-settings-notify-full.png`, fullPage: true, scale: 'css' });

    // 테스트 알림 — 폰 알림 + ntfy 동시 전송
    await page.locator('#settings-notify button', { hasText: '테스트 알림' }).first().click();
    await page.waitForFunction(() => window.__notified.length >= 1, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const afterTest = await page.evaluate(() => ({
      notified: window.__notified.map((x) => ({ title: x.title, body: x.body })),
      note: document.querySelector('#settings-notify .update-status')?.textContent?.trim(),
    }));
    check(afterTest.notified.length === 1, '테스트 알림이 브라우저 알림으로 1건 도착', JSON.stringify(afterTest.notified[0] ?? null));
    check(
      (afterTest.notified[0]?.title ?? '').startsWith('[테스트] ') &&
        (afterTest.notified[0]?.title ?? '').includes('시그널'),
      '테스트 알림 제목',
      afterTest.notified[0]?.title,
    );
    check(ntfyCalls.length === 1, 'ntfy 로도 함께 전송', `${ntfyCalls.length}건`);
    check(
      (ntfyCalls[0]?.url ?? '').includes('ntfy.sh/bgss-hw3238-9f4k2m'),
      'ntfy 토픽 = bgss-hw3238-9f4k2m',
      ntfyCalls[0]?.url,
    );
    check(
      (ntfyCalls[0]?.url ?? '').includes('title=') && (ntfyCalls[0]?.body ?? '').includes('Lot'),
      'ntfy 본문·제목 전달',
      ntfyCalls[0]?.body,
    );
    check((afterTest.note ?? '').includes('ntfy'), '테스트 결과 안내 문구', afterTest.note);

    // 알림 대상 전환 → 과거 시그널이 몰려 오지 않음
    await page.locator('#settings-notify .notify-target button', { hasText: '전체 종목' }).click();
    await page.waitForTimeout(2000);
    const afterTarget = await page.evaluate(() => ({
      notified: window.__notified.length,
      target: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').notifyTarget,
    }));
    check(afterTarget.target === 'all', '알림 대상 전환 → localStorage 저장', String(afterTarget.target));
    check(afterTarget.notified === 1, '대상 넓혀도 기존 시그널은 다시 울리지 않음', `${afterTarget.notified}건`);

    // OFF 토글
    await page.locator('#settings-notify .switch').click();
    await page.waitForTimeout(400);
    const off = await page.evaluate(() => JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').notifyEnabled);
    check(off === false, '알림 OFF → localStorage 저장');
    await page.locator('#settings-notify .switch').click();
    await page.waitForTimeout(300);

    // 새로고침 후에도 같은 시그널 중복 알림 없음
    const beforeReload = await page.evaluate(() => ({
      notified: window.__notified.length,
      keys: JSON.parse(localStorage.getItem('bgss.notified.v1') || '[]').length,
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 150000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.rescan');
        return !!btn && !btn.classList.contains('busy');
      },
      { timeout: 150000 },
    );
    await page.waitForTimeout(1500);
    const afterReload = await page.evaluate(() => ({
      notified: window.__notified.length,
      keys: JSON.parse(localStorage.getItem('bgss.notified.v1') || '[]').length,
      target: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').notifyTarget,
      ntfy: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').notifyNtfy,
    }));
    check(afterReload.notified === 0, '새로고침 후 같은 시그널 중복 알림 0건', `이전 ${beforeReload.notified}건`);
    check(afterReload.keys >= beforeReload.keys, '중복 방지 기록 유지', `${beforeReload.keys} → ${afterReload.keys}`);
    check(afterReload.target === 'all' && afterReload.ntfy === 'bgss-hw3238-9f4k2m', '설정 유지(대상·ntfy)');

    check(consoleErrors.length === 0, '콘솔 에러 0건', consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, '페이지 에러 0건', pageErrors.slice(0, 3).join(' | '));

    await browser.close();
  } finally {
    try {
      process.kill(-server.pid);
    } catch {
      /* already gone */
    }
  }
}

await logicChecks();
await browserChecks();
console.log(failures === 0 ? '\n✅ 알림 검증 통과' : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
