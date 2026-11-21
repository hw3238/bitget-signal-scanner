// FX 탭 · 랏(Lot) 표시 브라우저 검증 (390×844 모바일 + 1280×800 데스크톱)
//   - 하단 6탭(스캐너 | FX | 시황 | 전략엔진 | 기록 | 설정) 오버플로/줄바꿈 0건
//   - FX 탭 카드에 배수(x) 없이 `0.10 Lot 수익`·달러($) 손익 표시
//   - 랏 0.01 ↔ 0.10 ↔ 1.00 변경 시 카드·공유 카드 달러 손익이 정확히 비례
//   - 코인/주식선물 스캐너·즐겨찾기·더보기·검색·호가 보정·다른 탭 회귀 및 콘솔/페이지 에러 0건
//   실행: node scripts/fx-lot-check.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4175;
const URL = `http://127.0.0.1:${PORT}/`;
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
  env: { ...process.env, PATH: `${process.env.HOME}/.local/node/node-v22.14.0-linux-x64/bin:${process.env.PATH}` },
  detached: true,
});

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const parseUsd = (s) => {
  if (!s) return NaN;
  const m = String(s).replace(/,/g, '').match(/-?\$?\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return NaN;
  const n = Number(m[1]);
  return /-/.test(String(s).split('$')[0]) || String(s).trim().startsWith('-') ? -Math.abs(n) : n;
};

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

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
  await mobile.addInitScript(() => {
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // 랏 전환 비교 중 목록이 자동 갱신으로 바뀌지 않도록 자동 갱신을 끈 상태로 시작한다.
    if (!localStorage.getItem('bgss.settings.v1')) {
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    }
  });
  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1200);

  // 캔버스에 실제로 그려진 문자열 수집(공유 카드 PNG 내용 검증용)
  await page.evaluate(() => {
    window.__drawn = [];
    const proto = CanvasRenderingContext2D.prototype;
    if (!proto.__patched) {
      const orig = proto.fillText;
      proto.fillText = function (text, ...rest) {
        window.__drawn.push(String(text));
        return orig.call(this, text, ...rest);
      };
      proto.__patched = true;
    }
  });

  /* ---------- 1) 하단 6탭 레이아웃 ---------- */
  const nav = await page.evaluate(() => {
    const el = document.querySelector('.bottom-nav');
    const btns = [...el.querySelectorAll('button')];
    return {
      count: btns.length,
      labels: btns.map((b) => b.querySelector('.nav-label')?.textContent),
      gridCols: getComputedStyle(el).gridTemplateColumns,
      viewport: window.innerWidth,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      items: btns.map((b) => {
        const label = b.querySelector('.nav-label');
        const r = b.getBoundingClientRect();
        const lr = label.getBoundingClientRect();
        return {
          name: b.getAttribute('aria-label'),
          width: +r.width.toFixed(1),
          right: +r.right.toFixed(1),
          labelWidth: +lr.width.toFixed(1),
          labelHeight: +lr.height.toFixed(1),
          font: getComputedStyle(label).fontSize,
          labelClipped: label.scrollWidth > label.clientWidth + 1,
          buttonOverflow: b.scrollWidth > b.clientWidth + 1,
        };
      }),
    };
  });
  check('하단 탭 6개', nav.count === 6, nav.labels.join(' | '));
  check(
    '탭 라벨 순서 = 스캐너|FX|시황|전략엔진|기록|설정',
    nav.labels.join('|') === '스캐너|FX|시황|전략엔진|기록|설정',
    nav.labels.join(' | '),
  );
  check(
    '390px에서 6탭 오버플로/줄바꿈 0건',
    !nav.docOverflow && nav.items.every((i) => !i.labelClipped && !i.buttonOverflow && i.labelHeight < 13),
    nav.items.map((i) => `${i.name}:${i.width}px/h${i.labelHeight}`).join(', '),
  );
  await page.screenshot({ path: `${OUT}/01-scanner.png` });
  await page.screenshot({ path: `${OUT}/01-scanner-full.png`, fullPage: true, scale: 'css' });

  /* ---------- 2) FX 탭 ---------- */
  await page.locator('.bottom-nav button[data-tab="fx"]').click();
  await page.waitForSelector('.fx-tab', { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/14-fx-tab-lot.png` });

  const fxTop = await page.evaluate(() => {
    const tab = document.querySelector('.fx-tab');
    const txt = tab.innerText;
    return {
      title: clean(tab.querySelector('.summary-title')?.textContent),
      sub: clean(tab.querySelector('.summary-sub')?.textContent),
      counters: [...tab.querySelectorAll('.counter')].map((c) => clean(c.textContent)),
      lotButtons: [...tab.querySelectorAll('.lot-select button')].map((b) => ({
        label: clean(b.textContent),
        on: b.classList.contains('on'),
      })),
      lotHint: clean(tab.querySelector('.lot-hint')?.textContent),
      quick: [...tab.querySelectorAll('.quick-chip')].map((b) => clean(b.textContent)),
      tf: [...tab.querySelectorAll('[aria-label="타임프레임"] button')].map((b) => clean(b.textContent)),
      toggles: [...tab.querySelectorAll('.ghost-toggle, .fav-toggle')].map((b) => clean(b.textContent)),
      hasOffsetBar: !!tab.querySelector('.fx-offset-bar'),
      offsetPinned: [...tab.querySelectorAll('.fx-chip.priority .fx-chip-label')].map((b) => clean(b.textContent)),
      multiplierBleed: /\b\d+x\b|레버리지/.test(txt),
      lotMention: /Lot/.test(txt),
      listHead: clean(tab.querySelector('.list-head')?.textContent),
    };
  });
  check('FX 탭 요약 카드', /FX·금 발송 시그널/.test(fxTop.title), fxTop.title);
  check('FX 탭 롱/숏/1H/4H 카운터', fxTop.counters.length >= 5, fxTop.counters.join(' / '));
  check('랏 프리셋 6개 · 기본 0.10', fxTop.lotButtons.length === 6 && fxTop.lotButtons[2].on, fxTop.lotButtons.map((b) => (b.on ? `[${b.label}]` : b.label)).join(' '));
  check('퀵 버튼 금·유로', fxTop.quick.length === 2, fxTop.quick.join(' '));
  check('타임프레임 전체/1H/4H', fxTop.tf.join('|') === '전체|1H|4H', fxTop.tf.join('|'));
  check('진행중만·즐겨찾기 필터', fxTop.toggles.length === 2, fxTop.toggles.join(' / '));
  check('Vantage 호가 보정 바 + ★ XAUUSD+/EURUSD+ 고정', fxTop.hasOffsetBar && fxTop.offsetPinned.length >= 2, fxTop.offsetPinned.join(', '));
  check('FX 탭에 배수(x)·레버리지 표현 없음', !fxTop.multiplierBleed, `텍스트에 x배수/레버리지 ${fxTop.multiplierBleed ? '있음' : '없음'}`);
  check('FX 탭에 Lot 표현 있음', fxTop.lotMention);

  // 카드 영역
  await page.evaluate(() => {
    const grid = document.querySelector('.fx-tab .card-grid');
    if (grid) window.scrollTo(0, grid.getBoundingClientRect().top + window.scrollY - 118);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/14-fx-card-lot.png` });
  await page.screenshot({ path: `${OUT}/14-fx-tab-lot-full.png`, fullPage: true, scale: 'css' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const readCards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')].map((c) => ({
        sym: clean(c.querySelector('.sym')?.textContent),
        price: clean(c.querySelector('.price')?.textContent),
        cap: clean(c.querySelector('.roi-cap')?.textContent),
        pnl: clean(c.querySelector('.roi-value')?.textContent),
        target: clean(c.querySelectorAll('.lvl')[0]?.querySelector('.lvl-usd')?.textContent),
        stop: clean(c.querySelectorAll('.lvl')[3]?.querySelector('.lvl-usd')?.textContent),
        strip: clean(c.querySelector('.lot-strip')?.textContent),
        multiplier: /\b\d+x\b|레버리지/.test(clean(c.textContent)),
      })),
    );

  const cards010 = await readCards();
  check(
    'FX 카드 = `0.10 Lot 수익` + 달러 손익',
    cards010.length > 0 && cards010.every((c) => /^0\.10 Lot 수익$/.test(c.cap) && /^[+-]?\$/.test(c.pnl)),
    cards010.map((c) => `${c.sym} ${c.cap} ${c.pnl}`).join(' · '),
  );
  check(
    'FX 카드 목표/무효 달러 손익 + 핍 가치 스트립',
    cards010.every((c) => /^\+?\$/.test(c.target) && /^-\$/.test(c.stop) && /Lot/.test(c.strip)),
    cards010[0] ? `${cards010[0].target} / ${cards010[0].stop} / ${cards010[0].strip}` : 'no card',
  );
  check('FX 카드에 배수(x) 없음', cards010.every((c) => !c.multiplier));

  const WANT_DECIMALS = {
    XAUUSD: 2, XAGUSD: 2, XAUT: 2, PAXG: 2, XPTUSD: 2, XPDUSD: 2,
    EURUSD: 4, GBPUSD: 4, USDJPY: 2, USDBRL: 4,
    USOIL: 2, UKOIL: 2, NATGAS: 2, COPPER: 2, DXY: 2,
  };
  const decimals = cards010.map((c) => {
    const sym = (c.sym || '').replace(/\+$/, '');
    const price = (c.price || '').replace(/,/g, '');
    const frac = price.includes('.') ? price.split('.')[1].length : 0;
    const want = WANT_DECIMALS[sym];
    return { sym, price, frac, want, ok: want == null ? frac <= 2 : frac === want };
  });
  check(
    'FX 카드 가격 소수점 자리수',
    decimals.every((d) => d.ok),
    decimals.map((d) => `${d.sym}:${d.price}(${d.frac}/${d.want ?? '지수'})`).join(' '),
  );

  /* ---------- 3) 랏 변경 0.01 / 0.10 / 1.00 ---------- */
  const pickLot = async (label) => {
    await page.locator('.lot-select button', { hasText: new RegExp(`^${label.replace('.', '\\.')}$`) }).click();
    await page.waitForTimeout(450);
  };
  const snapshot = async () => {
    const list = await readCards();
    return list.map((c) => ({ sym: c.sym, cap: c.cap, pnl: c.pnl, target: c.target, stop: c.stop }));
  };

  const at010 = await snapshot();
  await pickLot('0.01');
  const at001 = await snapshot();
  await pickLot('1.00');
  const at100 = await snapshot();
  await pickLot('0.10');

  // 카드 순서는 랏 변경 사이에 동일하므로 같은 인덱스끼리 비교한다(같은 심볼 카드가 2건 이상일 수 있음).
  const ratioRows = at010
    .map((c, i) => {
      const b = at001[i];
      const d = at100[i];
      const a = parseUsd(c.target);
      return {
        sym: c.sym,
        target010: a,
        target001: b ? parseUsd(b.target) : null,
        target100: d ? parseUsd(d.target) : null,
        ratio001: b && a ? +(parseUsd(b.target) / a).toFixed(3) : null,
        ratio100: d && a ? +(parseUsd(d.target) / a).toFixed(3) : null,
      };
    })
    .filter((r) => Number.isFinite(r.target010) && r.target010 !== 0);
  // 센트 단위 반올림(0.01달러) 오차만 허용한다.
  const stableList =
    at010.length === at001.length &&
    at010.length === at100.length &&
    at010.every((c, i) => c.sym === at001[i]?.sym && c.sym === at100[i]?.sym);
  const ratioOk =
    stableList &&
    ratioRows.length > 0 &&
    ratioRows.every(
      (r) =>
        r.ratio001 != null &&
        r.ratio100 != null &&
        // 표시 반올림(센트, $10,000 이상은 정수 달러) 오차만 허용한다.
        Math.abs(r.target001 - r.target010 * 0.1) <= Math.max(0.02, Math.abs(r.target010) * 1e-4) &&
        Math.abs(r.target100 - r.target010 * 10) <= Math.max(0.05, Math.abs(r.target010) * 1e-2),
    );
  check('랏 0.01→0.10→1.00 카드 손익 정확히 비례(×0.1 / ×10)', ratioOk, JSON.stringify(ratioRows.slice(0, 4)));
  check(
    '랏 표기 라벨이 선택 랏을 따라감',
    at001.every((c) => c.cap.startsWith('0.01 Lot')) && at100.every((c) => c.cap.startsWith('1.00 Lot')),
    `${at001[0]?.cap} / ${at100[0]?.cap} · 목록 ${at010.length}/${at001.length}/${at100.length}건`,
  );

  // 랏 저장(localStorage) 유지
  await pickLot('0.20');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').fxLot);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signal-card', { timeout: 180000 });
  await page.locator('.bottom-nav button[data-tab="fx"]').click();
  await page.waitForSelector('.fx-tab', { timeout: 60000 });
  // 새로고침 뒤 자동 스캔이 끝날 때까지 기다려 스크린샷·측정이 스캔 중 화면을 찍지 않게 한다.
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1200);
  const persisted = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').fxLot,
    on: document.querySelector('.lot-select button.on')?.textContent,
  }));
  check('랏 선택 localStorage 저장·복원', persisted.stored === 0.2 && persisted.on === '0.20', JSON.stringify({ stored, ...persisted }));
  await pickLot('0.10');
  await page.evaluate(() => {
    window.__drawn = [];
    const proto = CanvasRenderingContext2D.prototype;
    if (!proto.__patched) {
      const orig = proto.fillText;
      proto.fillText = function (text, ...rest) {
        window.__drawn.push(String(text));
        return orig.call(this, text, ...rest);
      };
      proto.__patched = true;
    }
  });

  /* ---------- 4) FX 공유 카드 ---------- */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__drawn = [];
  });
  // 평가 손익이 가장 큰 카드를 공유 카드 스크린샷으로 쓴다(0.00만 보이지 않도록).
  const biggestPnl = async () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')];
      let best = 0;
      let bestAbs = -1;
      cards.forEach((c, i) => {
        const n = Math.abs(parseFloat(String(clean(c.querySelector('.roi-value')?.textContent)).replace(/[^0-9.]/g, '')) || 0);
        if (n > bestAbs) {
          bestAbs = n;
          best = i;
        }
      });
      return best;
    });
  const shareIdx = await biggestPnl();
  await page.locator('.fx-tab .signal-card:not(.skeleton)').nth(shareIdx).click();
  await page.waitForSelector('.share-canvas.in', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/14-fx-share-lot.png` });
  const share010 = await page.evaluate(() => {
    const c = document.querySelector('canvas.share-canvas');
    return {
      drawn: window.__drawn.slice(),
      w: c.width,
      h: c.height,
      pngBytes: c.toDataURL('image/png').length,
    };
  });
  writeFileSync(
    '.tmp/fx-share-lot.png',
    Buffer.from(
      (await page.evaluate(() => document.querySelector('canvas.share-canvas').toDataURL('image/png'))).split(',')[1],
      'base64',
    ),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await pickLot('1.00');
  await page.evaluate(() => {
    window.__drawn = [];
  });
  await page.locator('.fx-tab .signal-card:not(.skeleton)').nth(shareIdx).click();
  await page.waitForSelector('.share-canvas.in', { timeout: 30000 });
  await page.waitForTimeout(800);
  const share100 = await page.evaluate(() => ({ drawn: window.__drawn.slice(), pngBytes: document.querySelector('canvas.share-canvas').toDataURL('image/png').length }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await pickLot('0.10');

  const shareLotText = share010.drawn.filter((t) => /Lot/.test(t));
  check(
    'FX 공유 카드에 `0.10 Lot`·달러 손익 렌더',
    shareLotText.some((t) => /0\.10 Lot/.test(t)) && share010.drawn.some((t) => /^[+-]?\$/.test(t)),
    shareLotText.join(' | '),
  );
  check(
    'FX 공유 카드에 배수(x)·레버리지 문구 없음',
    !share010.drawn.some((t) => /레버리지|\b\d+x\b/.test(t)),
    share010.drawn.filter((t) => /x|레버리지/.test(t)).join(' | ') || '없음',
  );
  const shareBig = share100.drawn.find((t) => /1\.00 Lot/.test(t));
  check('공유 카드도 랏에 따라 달러 손익 변경', !!shareBig && shareBig !== shareLotText.find((t) => /0\.10 Lot/.test(t)), `${shareLotText.find((t) => /0\.10 Lot/.test(t))} → ${shareBig}`);

  /* ---------- 5) 코인·주식선물 스캐너 회귀 ---------- */
  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(800);
  const scanner = await page.evaluate(() => {
    const tab = document.querySelector('.scanner-tab');
    const cards = [...tab.querySelectorAll('.signal-card:not(.skeleton)')];
    return {
      assets: [...new Set(cards.map((c) => clean(c.querySelector('.asset')?.textContent)))],
      assetTabs: [...tab.querySelectorAll('[aria-label="자산 구분"] button')].map((b) => clean(b.textContent)),
      quick: [...tab.querySelectorAll('.quick-chip')].map((b) => clean(b.textContent)),
      caps: cards.slice(0, 3).map((c) => clean(c.querySelector('.roi-cap')?.textContent)),
      hasOffsetBar: !!tab.querySelector('.fx-offset-bar'),
      anyFx: cards.some((c) => /FX/.test(clean(c.querySelector('.asset')?.textContent))),
      cards: cards.length,
    };
  });
  check('스캐너 탭 = 코인·주식선물 전용(FX 카드 없음)', !scanner.anyFx, `${scanner.assets.join('/')} · ${scanner.cards}건`);
  check('스캐너 탭 배수(x) 표기 유지', scanner.caps.every((c) => /레버리지 \d+x 수익률/.test(c)), scanner.caps.join(' / '));
  check('스캐너 탭에 FX 필터·호가 보정 없음', scanner.assetTabs.join('|') === '전체|코인|주식선물' && !scanner.hasOffsetBar, scanner.assetTabs.join('|'));

  await page.locator('.scanner-tab .signal-card:not(.skeleton) .fav-btn').first().click();
  await page.waitForTimeout(300);
  await page.locator('.scanner-tab .fav-toggle').click();
  await page.waitForTimeout(500);
  const favMode = await page.evaluate(() => ({
    head: clean(document.querySelector('.scanner-tab .list-head')?.textContent),
    cards: document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)').length,
  }));
  check('스캐너 ⭐ 즐겨찾기 모아보기', favMode.cards >= 1 && /즐겨찾기/.test(favMode.head), favMode.head);
  await page.locator('.scanner-tab .fav-toggle').click();
  await page.waitForTimeout(300);
  await page.locator('.scanner-tab .ghost-toggle').click();
  await page.waitForTimeout(500);
  const moreBefore = await page.locator('.scanner-tab .signal-card:not(.skeleton)').count();
  if (await page.locator('.scanner-tab .more-btn').count()) {
    await page.locator('.scanner-tab .more-btn').click();
    await page.waitForTimeout(400);
  }
  const moreAfter = await page.locator('.scanner-tab .signal-card:not(.skeleton)').count();
  check('스캐너 더보기 펼침', moreAfter > moreBefore, `${moreBefore} → ${moreAfter}`);
  await page.locator('.scanner-tab .search-box input').fill('BTC');
  await page.waitForTimeout(500);
  const searchCount = await page.locator('.scanner-tab .signal-card:not(.skeleton)').count();
  const searchHead = await page.evaluate(() => clean(document.querySelector('.scanner-tab .list-head')?.textContent));
  check('스캐너 검색', searchCount > 0, `BTC ${searchCount}건 · ${searchHead}`);
  await page.locator('.scanner-tab .search-clear').click();
  await page.waitForTimeout(300);

  /* ---------- 6) 호가 보정 (FX 탭, 금 카드) ---------- */
  await page.locator('.bottom-nav button[data-tab="fx"]').click();
  await page.waitForTimeout(700);
  await page.locator('.fx-tab .quick-chip', { hasText: '금' }).click();
  await page.waitForTimeout(800);
  const goldCard = () =>
    page.evaluate(() => {
      const c = [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')].find((x) =>
        clean(x.querySelector('.sym')?.textContent).startsWith('XAUUSD'),
      );
      return {
        found: !!c,
        price: clean(c?.querySelector('.price')?.textContent),
        pnl: clean(c?.querySelector('.roi-value')?.textContent),
        sub: clean(c?.querySelector('.sym-sub')?.textContent),
      };
    });
  const goldBefore = await goldCard();
  await page.locator('.fx-tab .fx-chip.priority .fx-offset-input').first().fill('0.5');
  await page.waitForTimeout(700);
  const goldAfter = await goldCard();
  const offsets = await page.evaluate(() => JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').fxOffsets);
  check(
    '호가 보정 +0.50 → 금 카드 현재가 +0.50, 달러 손익 유지',
    goldBefore.found &&
      Math.abs(parseFloat(goldAfter.price.replace(/,/g, '')) - parseFloat(goldBefore.price.replace(/,/g, '')) - 0.5) < 0.011 &&
      goldAfter.pnl === goldBefore.pnl,
    `${goldBefore.price} → ${goldAfter.price} · pnl ${goldBefore.pnl} → ${goldAfter.pnl} · ${goldAfter.sub} · ${JSON.stringify(offsets)}`,
  );
  await page.locator('.fx-tab .fx-offset-reset').click();
  await page.waitForTimeout(300);
  await page.locator('.fx-tab .quick-chip', { hasText: '금' }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/14-fx-tab-lot.png` });

  /* ---------- 7) 나머지 탭 ---------- */
  const tabChecks = {};
  for (const [label, key] of [
    ['시황', 'market'],
    ['전략엔진', 'engine'],
    ['기록', 'history'],
    ['설정', 'settings'],
  ]) {
    await page.locator(`.bottom-nav button[data-tab="${key}"]`).click();
    await page.waitForTimeout(700);
    tabChecks[label] = await page.evaluate(() => ({
      panels: document.querySelectorAll('.panel, .summary-card').length,
      errors: document.querySelectorAll('.notice.error').length,
      text: (document.querySelector('main')?.innerText || '').length,
    }));
  }
  await page.screenshot({ path: `${OUT}/08-settings.png` });
  const settingsFxTable = await page.evaluate(() => ({
    rows: document.querySelectorAll('.fx-table .fx-tr').length,
    heads: [...document.querySelectorAll('.fx-table-head span')].map((s) => clean(s.textContent)),
  }));
  check('설정 탭 종목별 벤티지 보정 표', settingsFxTable.rows > 10, `${settingsFxTable.rows}종목`);
  const settingsLot = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('.setting-row .lot-select button')].map((b) => clean(b.textContent)),
    on: clean(document.querySelector('.setting-row .lot-select button.on')?.textContent),
  }));
  check('설정 탭 랏(Lot) 항목', settingsLot.buttons.length === 6 && settingsLot.on === '0.10', settingsLot.buttons.join(' ') + ` (${settingsLot.on})`);
  await page.locator('.bottom-nav button[data-tab="market"]').click();
  await page.waitForTimeout(600);
  await page.locator('.market-tab .segmented button', { hasText: 'FX·금' }).first().click().catch(async () => {
    await page.locator('.segmented button', { hasText: 'FX·금' }).first().click();
  });
  await page.waitForTimeout(600);
  const marketFx = await page.evaluate(() => ({
    rows: document.querySelectorAll('.mv-list li').length,
    text: clean(document.querySelector('.mv-list')?.textContent).slice(0, 120),
  }));
  check('시황 탭 FX·금 목록', marketFx.rows > 0 && /\+/.test(marketFx.text), `${marketFx.rows}행 · ${marketFx.text}`);
  check(
    '시황·전략엔진·기록·설정 탭 정상',
    Object.values(tabChecks).every((t) => t.panels > 0 && t.errors === 0 && t.text > 200),
    JSON.stringify(tabChecks),
  );

  await mobile.close();

  /* ---------- 8) 데스크톱 1280×800 ---------- */
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await desktop.addInitScript(() => {
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  });
  const dpage = await desktop.newPage();
  dpage.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[desktop] ${m.text()}`);
  });
  dpage.on('pageerror', (e) => pageErrors.push(`[desktop] ${String(e)}`));
  await dpage.goto(URL, { waitUntil: 'domcontentloaded' });
  await dpage.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
  await dpage.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await dpage.waitForTimeout(1000);
  await dpage.locator('.top-nav button[data-tab="fx"]').click();
  await dpage.waitForTimeout(1000);
  const desktopFx = await dpage.evaluate(() => {
    const cards = [...document.querySelectorAll('.fx-tab .signal-card:not(.skeleton)')];
    return {
      topNav: [...document.querySelectorAll('.top-nav button')].map((b) => clean(b.textContent)),
      bottomNavHidden: getComputedStyle(document.querySelector('.bottom-nav')).display === 'none',
      cards: cards.length,
      lotButtons: document.querySelectorAll('.lot-select button').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      caps: cards.slice(0, 4).map((c) => clean(c.querySelector('.roi-cap')?.textContent)),
      total: clean(document.querySelector('.counter.lot')?.textContent),
    };
  });
  await dpage.screenshot({ path: `${OUT}/14-fx-tab-lot-desktop.png` });
  check(
    '데스크톱 6탭 · FX 탭 · 오버플로 없음',
    desktopFx.topNav.length === 6 && desktopFx.bottomNavHidden && desktopFx.cards > 0 && !desktopFx.overflow,
    JSON.stringify(desktopFx),
  );
  await desktop.close();
  await browser.close();

  check('콘솔/페이지 에러 0건', consoleErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors, pageErrors }));

  const report = {
    nav,
    fxTop,
    cards010,
    lotSwitch: { at010, at001, at100, ratioRows },
    persisted,
    shareCard: {
      w: share010.w,
      h: share010.h,
      pngBytes: share010.pngBytes,
      lotTexts: shareLotText,
      hasMultiplier: share010.drawn.some((t) => /레버리지|\b\d+x\b/.test(t)),
      sampleDrawn: share010.drawn.slice(0, 24),
    },
    scanner,
    favMode,
    more: { before: moreBefore, after: moreAfter },
    search: { count: searchCount, head: searchHead },
    offset: { before: goldBefore, after: goldAfter, stored: offsets },
    tabChecks,
    settingsLot,
    settingsFxTable,
    marketFx,
    decimals,
    desktopFx,
    consoleErrors,
    pageErrors,
    checks,
    allOk: checks.every((c) => c.ok),
  };
  writeFileSync('.tmp/fx-lot-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ allOk: report.allOk, checks, lotSwitch: report.lotSwitch.ratioRows, fxTotal: fxTop.counters.slice(-1), share: report.shareCard, offset: report.offset }, null, 1));
  if (!report.allOk) process.exitCode = 1;
};

run()
  .catch((e) => {
    console.error('CHECK FAILED', e);
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
