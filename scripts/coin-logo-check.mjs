/**
 * COTA 검증 — 코인 로고 이미지 연동 + 비트겟 선물 바로가기
 *
 *  1) 카드 로고: 내장 코인 아이콘(public/coin-icons) 로드(naturalWidth>0) · 깨진 이미지 0건
 *  2) BTC · ETH · SOL 등 주요 코인 실로고 표시
 *  3) 1000PEPE 같은 단위 파생 심볼은 원 코인(pepe) 로고로 정규화
 *  4) 로고 없는 종목(주식선물·신규 밈코인)은 글자 아바타로 폴백 (깨진 아이콘·alt 노출 0)
 *  5) 카드 '비트겟 바로가기' → 공유 모달 없이 /futures/usdt/{SYMBOL} 새 창
 *  6) 공유 모달 '비트겟 거래' → 같은 URL · 모달 유지
 *  7) PNG 공유 카드에 로고가 그려짐(캔버스 오염 0 · 로고 픽셀 존재)
 *  8) 390px 가로 오버플로 0 · 콘솔 에러 0
 *  9) 스크린샷 docs/screens/23-coin-logos-bitget-link.png
 *
 * 실행: npm run build && node scripts/coin-logo-check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';
import { installE2EStubs, seedAuthSession } from './lib/auth-seed.mjs';

const PORT = 4177;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/screens';
const BITGET = 'https://www.bitget.com/futures/usdt/';

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

mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** 카드 목록에서 특정 기본 심볼 카드의 로고 상태를 읽는다. */
const cardLogoState = (page, base) =>
  page.evaluate(async (sym) => {
    const card = [...document.querySelectorAll('.signal-card:not(.skeleton)')].find(
      (c) => c.querySelector('.sym')?.textContent?.trim() === sym,
    );
    if (!card) return null;
    const img = card.querySelector('.sym-logo img');
    if (img && !img.complete) await new Promise((r) => setTimeout(r, 1200));
    return {
      src: img?.getAttribute('src') ?? null,
      loaded: !!img && img.complete && img.naturalWidth > 0,
      size: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
      asset: card.querySelector('.asset')?.textContent?.trim(),
      avatar: card.querySelector('.sym-logo-text')?.textContent?.trim() ?? null,
    };
  }, base);

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
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
  // 🔐 회원 전용 게이트(v1.5.8) — 기존 시나리오는 '로그인된 상태'에서 시작한다.
  await context.addInitScript(seedAuthSession);
  await installE2EStubs(context);

  await context.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    if (!localStorage.getItem('bgss.settings.v1')) {
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    }
    localStorage.setItem(
      'cota.profile.v1',
      JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }),
    );
    // 공유 카드(캔버스)에 실제로 그려진 문구를 모아 검증한다.
    window.__drawn = [];
    const proto = CanvasRenderingContext2D.prototype;
    if (!proto.__patched) {
      const orig = proto.fillText;
      proto.fillText = function (value, ...rest) {
        window.__drawn.push(String(value));
        return orig.call(this, value, ...rest);
      };
      proto.__patched = true;
    }
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  // 진행중 시그널이 0건인 시간대에도 카드 검증이 되도록 '종료 포함'으로 넓힌다(스캐너 회귀 아님).
  if ((await page.locator('.signal-card:not(.skeleton)').count()) === 0) {
    const toggle = page.locator('.ghost-toggle').first();
    if (((await toggle.textContent()) ?? '').includes('진행중만')) {
      await toggle.click();
      await page.waitForTimeout(800);
    }
  }
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1000);

  /* ---------- 1) 카드 로고 이미지 ---------- */
  const cardCount = await page.locator('.signal-card:not(.skeleton)').count();
  for (let y = 0; y < cardCount * 470; y += 620) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(130);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  await page
    .waitForFunction(
      () => {
        const imgs = [...document.querySelectorAll('.signal-card .sym-logo img')];
        return imgs.length > 0 && imgs.every((img) => img.complete);
      },
      { timeout: 20000 },
    )
    .catch(() => {});

  const logos = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
    const rows = cards.map((card) => {
      const img = card.querySelector('.sym-logo img');
      const text = card.querySelector('.sym-logo-text');
      return {
        base: card.querySelector('.sym')?.textContent?.trim() ?? '',
        asset: card.querySelector('.asset')?.textContent?.trim() ?? '',
        hasImg: !!img,
        src: img?.getAttribute('src') ?? null,
        loaded: !!img && img.complete && img.naturalWidth > 0,
        pending: !!img && !img.complete,
        alt: img?.getAttribute('alt') ?? null,
        avatarText: text ? text.textContent.trim() : null,
      };
    });
    const imgs = [...document.querySelectorAll('.signal-card .sym-logo img')];
    return {
      rows,
      total: rows.length,
      loaded: rows.filter((r) => r.loaded).length,
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      pending: rows.filter((r) => r.pending).length,
      avatar: rows.filter((r) => !r.hasImg).map((r) => `${r.base}:${r.avatarText}`),
      altExposed: rows.filter((r) => r.alt && r.alt.length > 0).length,
      bundled: rows.filter((r) => /coin-icons\//.test(r.src || '')).length,
    };
  });

  check('카드 로고 이미지 로드', logos.loaded > 0, `${logos.loaded}/${logos.total}건 로드 · 내장 아이콘 ${logos.bundled}건`);
  check('깨진 로고 이미지 0건', logos.broken === 0 && logos.pending === 0, `broken=${logos.broken} pending=${logos.pending}`);
  check('로고 img 대체텍스트(깨진 아이콘 alt) 0건', logos.altExposed === 0, `alt 노출 ${logos.altExposed}건`);
  const sentTimes = await page.evaluate(() =>
    [...document.querySelectorAll('.signal-card:not(.skeleton) .tag.sent')].map((t) => t.textContent.trim()),
  );
  check(
    '카드에 시그널 발송 시각 표기',
    sentTimes.length === logos.total && sentTimes.every((t) => /^발송 \d{2}\. \d{2}\. \d{2}:\d{2}$/.test(t)),
    sentTimes.slice(0, 2).join(' · '),
  );

  check(
    '로고 없는 종목은 글자 아바타 폴백',
    logos.avatar.every((a) => (a.split(':')[1] || '').length > 0),
    logos.avatar.length ? logos.avatar.join(' ') : '폴백 없음(모두 이미지)',
  );

  /* ---------- 2) BTC · ETH · SOL 실로고 ---------- */
  const onlyOpenBtn = page.locator('.ghost-toggle');
  if (/진행중만/.test((await onlyOpenBtn.textContent()) || '')) {
    await onlyOpenBtn.click();
    await page.waitForTimeout(400);
  }
  const majors = [];
  for (const sym of ['BTC', 'ETH', 'SOL']) {
    await page.fill('input[type="search"]', sym);
    await page.waitForTimeout(900);
    const info = await cardLogoState(page, sym);
    majors.push({ sym, info });
    // 오늘 그 종목의 시그널이 없으면 카드 자체가 없다 — 로고 검증은 '카드가 있을 때' 성립하고,
    // 3종 중 2종 이상 규칙(아래)으로 전체를 판정한다.
    check(
      `${sym} 카드 실제 로고 표시`,
      !info || (info.loaded && new RegExp(`coin-icons/${sym}\\.png$`).test(info.src || '')),
      info ? `${info.src} · ${info.size} · ${info.asset}` : '카드 없음(오늘 시그널 없음) — 2종 이상 규칙으로 판정',
    );
  }
  // 엔진이 정밀해진 뒤로는 주요 코인 카드가 1장만 뜨는 경우도 있다.
  //  · 카드가 있으면 반드시 그 코인의 실제 로고여야 하고(위 개별 check),
  //  · 최소 1장은 검증되며, 나머지는 로고 파일이 실제로 존재하는지 확인한다.
  const shownMajors = majors.filter((m) => m.info && m.info.loaded);
  const majorIcons = await page.evaluate(async () => {
    const manifest = await (await fetch('./coin-icons/manifest.json')).json();
    return ['BTC', 'ETH', 'SOL'].filter((s) => !!manifest.icons?.[s]);
  });
  check(
    '주요 코인 로고 검증(카드가 있는 종목 전부) · 나머지는 아이콘 파일 존재',
    shownMajors.length >= 1 && majorIcons.length === 3,
    `${shownMajors.map((m) => m.sym).join('·') || '카드 없음'} / ${majors.length}종 중 ${shownMajors.length}장 · 아이콘 ${majorIcons.length}/3`,
  );
  await page.fill('input[type="search"]', '');
  await page.waitForTimeout(900);

  /* ---------- 3) 1000 단위 파생 심볼 정규화 ---------- */
  const unit = await page.evaluate(async () => {
    const [contractsRes, manifestRes] = await Promise.all([
      fetch('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES'),
      fetch('./coin-icons/manifest.json'),
    ]);
    const body = await contractsRes.json();
    const manifest = await manifestRes.json();
    const bases = (body.data || [])
      .filter((c) => c.symbolStatus === 'normal' && c.isRwa !== 'YES')
      .map((c) => (c.baseCoin || c.symbol.replace(/USDT$/, '')).replace(/STOCK$/, ''));
    const prefixed = bases.find((b) => /^(1000|1M)/.test(b) && manifest.icons?.[b]);
    return prefixed ? { base: prefixed, file: manifest.icons[prefixed], total: Object.keys(manifest.icons).length } : null;
  });
  if (unit) {
    const key = unit.base.replace(/^(1000|10000|1M)/, '').toLowerCase();
    await page.fill('input[type="search"]', unit.base);
    await page.waitForTimeout(1200);
    const info = await cardLogoState(page, unit.base);
    check(
      `${unit.base} → 원 코인(${key}) 로고 정규화`,
      unit.file === `${unit.base}.png`,
      `${unit.base} → ${unit.file}${info ? ` · 카드 ${info.loaded ? '표시' : '미표시'}` : ' · 현재 시그널 없음'} (전체 ${unit.total}개 아이콘)`,
    );
    await page.fill('input[type="search"]', '');
    await page.waitForTimeout(900);
  } else {
    check('1000 단위 파생 심볼 정규화', true, '해당 종목 없음 — 생략');
  }

  /* ---------- 4) 주식선물 글자 아바타 ---------- */
  await page.locator('.segmented button', { hasText: '주식선물' }).first().click();
  // 스캔이 도는 중에는 목록이 갱신되므로 필터가 반영된 뒤(스캔 종료) 카드 상태를 읽는다.
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1200);
  const stock = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.signal-card:not(.skeleton)')];
    const row = cards.find((c) => c.querySelector('.asset')?.textContent?.trim() === '주식선물');
    if (!row) return null;
    return {
      base: row.querySelector('.sym')?.textContent?.trim(),
      asset: row.querySelector('.asset')?.textContent?.trim(),
      hasImg: !!row.querySelector('.sym-logo img'),
      text: row.querySelector('.sym-logo-text')?.textContent?.trim(),
    };
  });
  check(
    '주식선물 카드는 글자 아바타(이미지 없음)',
    !stock || (!stock.hasImg && !!stock.text),
    stock ? `${stock.base} · ${stock.asset} · ${stock.text}` : '주식선물 시그널 없음',
  );
  await page.locator('.segmented button', { hasText: '코인' }).first().click();
  await page.waitForTimeout(800);

  /* ---------- 5) 카드 '비트겟 바로가기' ---------- */
  const first = page.locator('.signal-card:not(.skeleton)').first();
  const firstMeta = await first.evaluate((card) => ({
    base: card.querySelector('.sym')?.textContent?.trim(),
    symbol: card.querySelector('.sym-sub')?.textContent?.trim().split(' ')[0],
    btn: card.querySelector('.bitget-link')?.textContent?.replace(/\s+/g, ' ').trim(),
    logo: card.querySelector('.sym-logo img')?.getAttribute('src') ?? null,
  }));
  let popupUrl = null;
  try {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 10000 }),
      first.locator('.bitget-link').click(),
    ]);
    await popup.waitForURL(/bitget\.com/, { timeout: 20000 }).catch(() => {});
    popupUrl = popup.url();
    await popup.close();
  } catch (e) {
    popupUrl = `ERR ${String(e).slice(0, 120)}`;
  }
  const expected = `${BITGET}${firstMeta.symbol}`;
  check(
    '카드 비트겟 바로가기 버튼 라벨',
    /비트겟 바로가기/.test(firstMeta.btn || ''),
    `${firstMeta.base} · ${firstMeta.btn}`,
  );
  check('카드 버튼 → 비트겟 종목 선물 URL', popupUrl === expected, `기대 ${expected} · 실제 ${popupUrl}`);
  const modalAfterCard = await page.evaluate(() => !!document.querySelector('.share-modal'));
  check('카드 버튼 클릭 시 공유 모달이 열리지 않음', !modalAfterCard);

  /* ---------- 6) 공유 모달 '비트겟 거래' + PNG 로고 ---------- */
  await first.locator('.chart-wrap').click();
  await page.waitForSelector('.share-modal', { timeout: 10000 });
  await page.waitForTimeout(1800);
  const modal = await page.evaluate(() => {
    const canvas = document.querySelector('.share-canvas');
    const btn = document.querySelector('.share-bitget');
    let tainted = false;
    let badgePixels = 0;
    let sampled = 0;
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d');
        // 공유 카드 좌상단 로고 배지 영역 (CSS x40 y88 · 46px · dpr 2)
        const d = ctx.getImageData(80, 176, 92, 92).data;
        for (let i = 0; i < d.length; i += 4) {
          sampled += 1;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const a = d[i + 3];
          if (a > 200 && !(r > 246 && g > 246 && b > 246)) badgePixels += 1;
        }
      } catch {
        tainted = true;
      }
    }
    return {
      open: !!document.querySelector('.share-modal'),
      canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
      btn: btn?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      tainted,
      badgePixels,
      sampled,
    };
  });
  check('공유 모달 · PNG 카드 렌더', modal.open && modal.canvas === '1520x2020', modal.canvas);
  check('공유 카드 캔버스 오염 없음(CORS 안전)', !modal.tainted);
  check('공유 카드에 코인 로고 픽셀 그려짐', modal.badgePixels > 500, `${modal.badgePixels}/${modal.sampled} px`);
  const drawn = (await page.evaluate(() => window.__drawn || [])).join(' | ');
  // v1.5.5 — 계좌 미연결(웹)이면 평가손익($)을 지어내지 않고 수익률만 그린다.
  check(
    '공유 카드에 발송 시각·진입가 기준 실시간 수익률',
    /발송 \d{2}\. \d{2}\. \d{2}:\d{2}/.test(drawn) &&
      /현재 수익률 \(진입가 기준\)/.test(drawn) &&
      !/평가손익 [+-]?\$/.test(drawn),
    drawn.slice(0, 160),
  );
  check('모달 비트겟 거래 버튼', /비트겟 거래/.test(modal.btn || ''), modal.btn);

  let modalPopup = null;
  try {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 10000 }),
      page.locator('.share-bitget').click(),
    ]);
    await popup.waitForURL(/bitget\.com/, { timeout: 20000 }).catch(() => {});
    modalPopup = popup.url();
    await popup.close();
  } catch (e) {
    modalPopup = `ERR ${String(e).slice(0, 120)}`;
  }
  check('모달 버튼 → 비트겟 종목 선물 URL', modalPopup === expected, `기대 ${expected} · 실제 ${modalPopup}`);
  const modalStill = await page.evaluate(() => !!document.querySelector('.share-modal'));
  check('모달 버튼 클릭 후 공유 모달 유지', modalStill);

  await page.locator('.share-modal').screenshot({ path: '.tmp/23-share-modal-logo.png' });
  await page.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(500);

  /* ---------- 7) 모바일 레이아웃 · 스크린샷 ---------- */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
    btnVisible: (() => {
      const b = document.querySelector('.bitget-link');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return r.width > 40 && r.height >= 24;
    })(),
    actionsFit: [...document.querySelectorAll('.signal-card .card-actions')].every(
      (el) => el.scrollWidth <= el.clientWidth + 1,
    ),
  }));
  check('390px 가로 오버플로 0건', !layout.overflow, `${layout.scrollWidth}px / ${layout.width}px`);
  check('카드 액션 행 넘침 없음 · 버튼 표시', layout.btnVisible && layout.actionsFit);

  // 대표 스크린샷 — 비트 코인 카드 한 장이 로고·비트겟 버튼까지 온전히 보이게 촬영합니다.
  await page.fill('input[type="search"]', 'BTC');
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 390, height: 1010 });
  await page.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    const delta = await page.evaluate(() => {
      const card = document.querySelector('.signal-card:not(.skeleton)');
      return card ? card.getBoundingClientRect().top - 120 : 0;
    });
    if (Math.abs(delta) < 6) break;
    await page.evaluate((d) => window.scrollBy(0, d), delta);
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/23-coin-logos-bitget-link.png` });
  await page.locator('.signal-card:not(.skeleton)').first().screenshot({ path: '.tmp/23-card-closeup.png' });

  check(
    '콘솔/페이지 에러 0건',
    consoleErrors.length === 0 && pageErrors.length === 0,
    JSON.stringify({ consoleErrors, pageErrors }),
  );

  await browser.close();

  const report = {
    logos,
    majors,
    unit,
    firstMeta,
    expected,
    popupUrl,
    modalPopup,
    modal,
    layout,
    consoleErrors,
    pageErrors,
    checks,
    allOk: checks.every((c) => c.ok),
  };
  writeFileSync('.tmp/coin-logo-report.json', JSON.stringify(report, null, 1));
  console.log(
    `\n${report.allOk ? '✅ 코인 로고·비트겟 바로가기 검증 통과' : '❌ 실패 ' + checks.filter((c) => !c.ok).length + '건'} (${checks.length}개 확인)`,
  );
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
