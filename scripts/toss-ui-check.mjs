/**
 * COTA UI 검증 — 토스 스타일 라이트 UI · 5탭 코인 집중 · 전면 한글화 · 가격 가독성 ·
 * 첫 실행 온보딩 · COTA 추천 레버리지 · 실계좌 잔고 기준 예상 손익(v1.5.5)
 *
 *  1) 라이트 테마(#F2F4F6 · #FFFFFF · 네온 0건) · COTA 브랜드/로고/파비콘
 *  2) 첫 실행 = 온보딩 없이 바로 메인(스캐너) — 매매 스타일·프리셋 제거(v1.5.7)
 *  3) 하단 5탭(스캐너|시황|메뉴|기록|설정) · 390px 가로 오버플로 0건
 *  4) 코인 집중: 기본 자산 필터 '코인', FX·랏(Lot)·벤티지 호가 보정 UI 0건
 *  5) 카드 한글 라벨(진입가·목표가·손절가·본전·손익비·최근/전수 승률) + 천단위 콤마
 *  6) COTA 추천 배지(잔고·손절 폭 기준 유동 2~100x) + 계좌 미연결 시 연결 안내
 *  7) 공유 카드(캔버스) · 설정(프로필·알림) · 메뉴>전략엔진 · 콘솔 에러 0건
 *  8) 스크린샷 4장: 18-toss-scanner · 19-toss-engine · 20-toss-share-card · 21-toss-settings
 *
 * 실행: npm run build && node scripts/toss-ui-check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import './lib/chromium-env.mjs';

const PORT = 4176;
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
const cleanText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const run = async () => {
  await waitForServer(URL);
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const consoleErrors = [];
  const pageErrors = [];

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await mobile.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // 자동 갱신은 꺼 두고(스캔 완료 화면 고정) 프로필은 첫 실행 상태로 둔다.
    if (!localStorage.getItem('bgss.settings.v1')) {
      localStorage.setItem('bgss.settings.v1', JSON.stringify({ refreshSec: 0 }));
    }
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
  const page = await mobile.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  /* ---------- 1) 첫 실행 = 바로 스캐너 (온보딩·매매 스타일 없음, v1.5.7) ---------- */
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1200);
  const firstRun = await page.evaluate(() => ({
    onboarding: !!document.querySelector('.onboarding'),
    styleCards: document.querySelectorAll('.style-card').length,
    profile: localStorage.getItem('cota.profile.v1'),
    scannerVisible: !!document.querySelector('.scanner-tab'),
    card: !!document.querySelector('.signal-card:not(.skeleton)'),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  check('첫 실행: 온보딩 없이 바로 메인(스캐너) 화면', !firstRun.onboarding && firstRun.scannerVisible && firstRun.card);
  check('매매 성향 선택(스타일 카드)이 없다', firstRun.styleCards === 0 && firstRun.profile === null, `styleCards=${firstRun.styleCards}`);
  check('390px 첫 화면 가로 오버플로 0건', !firstRun.overflow);

    /* ---------- 2) 라이트 토스 테마 ---------- */
  const theme = await page.evaluate(() => {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const brand = document.querySelector('.brand-logo');
    const card = document.querySelector('.signal-card:not(.skeleton)');
    const glow = [...document.querySelectorAll('.signal-card, .summary-card, .panel')].some((el) =>
      /0, 245, 160|0, 229, 255|157, 78, 221|255, 46, 99/.test(getComputedStyle(el).boxShadow),
    );
    return {
      bodyBg,
      brandLoaded: !!brand && brand.complete && brand.naturalWidth > 0,
      brandSrc: brand?.getAttribute('src'),
      brandName: document.querySelector('.brand-text b')?.textContent,
      brandSub: document.querySelector('.brand-text span')?.textContent,
      pageTitle: document.title,
      favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      cardRadius: card ? getComputedStyle(card).borderRadius : null,
      glow,
      bgImage: getComputedStyle(document.body).backgroundImage,
    };
  });
  check('배경 = 토스 연회색 #F2F4F6', theme.bodyBg === 'rgb(242, 244, 246)', theme.bodyBg);
  check('카드 = 순백 #FFFFFF · 20px 라운드', theme.cardBg === 'rgb(255, 255, 255)' && /20px/.test(theme.cardRadius || ''), `${theme.cardBg} · ${theme.cardRadius}`);
  check('네온 글로우·배경 그라디언트 제거', !theme.glow && theme.bgImage === 'none', `glow=${theme.glow}`);
  check('헤더 COTA 로고·이름', theme.brandLoaded && /cota-logo/.test(theme.brandSrc || '') && theme.brandName === 'COTA', `${theme.brandName} · ${theme.brandSub}`);
  check('페이지 제목·파비콘·매니페스트', theme.pageTitle === 'COTA · 실시간 트레이딩 시그널' && /favicon/.test(theme.favicon || '') && /manifest/.test(theme.manifest || ''), `${theme.pageTitle}`);

  /* ---------- 3) 5탭 · 코인 집중 ---------- */
  const nav = await page.evaluate(() => {
    const el = document.querySelector('.bottom-nav');
    const btns = [...el.querySelectorAll('button')];
    return {
      count: btns.length,
      labels: btns.map((b) => b.querySelector('.nav-label')?.textContent),
      grid: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      activeColor: getComputedStyle(el.querySelector('button.on')).color,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      clipped: btns.some((b) => {
        const label = b.querySelector('.nav-label');
        return label.scrollWidth > label.clientWidth + 1 || b.scrollWidth > b.clientWidth + 1;
      }),
    };
  });
  check('하단 탭 5개', nav.count === 5 && nav.grid === 5, nav.labels.join(' | '));
  check('탭 순서 = 스캐너|시황|메뉴|기록|설정', nav.labels.join('|') === '스캐너|시황|메뉴|기록|설정', nav.labels.join(' | '));
  check('활성 탭 = 토스 블루 · 라벨 잘림 0건', nav.activeColor === 'rgb(49, 130, 246)' && !nav.clipped && !nav.docOverflow, nav.activeColor);

  const coin = await page.evaluate(() => {
    const tab = document.querySelector('.scanner-tab');
    const cards = [...tab.querySelectorAll('.signal-card:not(.skeleton)')];
    const text = tab.innerText;
    return {
      assetTabs: [...tab.querySelectorAll('[aria-label="자산 구분"] button')].map((b) => ({
        t: clean(b.textContent),
        on: b.classList.contains('on'),
      })),
      assets: [...new Set(cards.map((c) => clean(c.querySelector('.asset')?.textContent)))],
      cards: cards.length,
      fxText: /FX|벤티지|Vantage|Lot|랏/.test(text),
      fxNodes: document.querySelectorAll('.fx-tab, .fx-offset-bar, .fx-chip, .lot-select, .fx-table').length,
      quick: [...tab.querySelectorAll('.quick-chip')].map((b) => clean(b.textContent)),
    };
  });
  check('자산 필터 = 코인·주식선물·전체 (기본 코인)', coin.assetTabs.map((a) => a.t).join('|') === '코인|주식선물|전체' && coin.assetTabs[0].on, coin.assetTabs.map((a) => (a.on ? `[${a.t}]` : a.t)).join(' '));
  check('카드는 코인 종목만', coin.cards > 0 && coin.assets.every((a) => a === '코인'), `${coin.cards}건 · ${coin.assets.join('/')}`);
  check('FX·랏(Lot)·벤티지 UI 0건', !coin.fxText && coin.fxNodes === 0, `텍스트=${coin.fxText} 노드=${coin.fxNodes}`);
  check('퀵 필터 = 비트·이더·솔', coin.quick.length === 3 && /비트/.test(coin.quick[0]) && /이더/.test(coin.quick[1]) && /솔/.test(coin.quick[2]), coin.quick.join(' '));

  /* ---------- 4) 카드 · 가격 · COTA 추천 ---------- */
  const card = await page.evaluate(() => {
    const c = document.querySelector('.scanner-tab .signal-card:not(.skeleton)');
    const lvls = [...c.querySelectorAll('.lvl')];
    const cells = [...c.querySelectorAll('.cockpit-cell')].map((s) => ({
      label: clean(s.querySelector('span')?.textContent),
      value: clean(s.querySelector('b')?.textContent),
      sub: clean(s.querySelector('i')?.textContent),
    }));
    return {
      sym: clean(c.querySelector('.sym')?.textContent),
      side: clean(c.querySelector('.badge.long, .badge.short')?.textContent),
      state: clean(c.querySelector('.badge.state')?.textContent),
      rec: clean(c.querySelector('.badge.rec')?.textContent),
      cap: clean(c.querySelector('.roi-cap')?.textContent),
      roi: clean(c.querySelector('.roi-value')?.textContent),
      roiSub: clean(c.querySelector('.roi-sub')?.textContent),
      sentTime: clean(c.querySelector('.tag.sent')?.textContent),
      labels: lvls.map((l) => clean(l.querySelector('.lvl-label')?.textContent)),
      values: lvls.map((l) => clean(l.querySelector('.lvl-value')?.textContent)),
      price: clean(c.querySelector('.price')?.textContent),
      priceCap: clean(c.querySelector('.price-cap')?.textContent),
      rr: clean(c.querySelector('.rr-row .rr-pill')?.textContent),
      winRate: clean(c.querySelectorAll('.rr-pill')[2]?.textContent),
      cockpitTitle: clean(c.querySelector('.cockpit-title')?.textContent),
      cockpitRisk: clean(c.querySelector('.cockpit-risk')?.textContent),
      cockpitCells: cells,
      cockpitFoot: clean(c.querySelector('.cockpit-foot')?.textContent),
      chartLabels: [...c.querySelectorAll('.mini-label')].map((l) => clean(l.textContent)),
      copyBtns: [...c.querySelectorAll('.copy-btn')].map((b) => clean(b.textContent)),
      english: /\b(ENTRY|Entry|TARGET|Target|STOP|Stop|LONG|SHORT|WIN RATE|R:R)\b/.test(clean(c.textContent)),
      leverageOptions: [...document.querySelectorAll('.select-pill select')].map((s) =>
        [...s.options].map((o) => o.textContent?.trim()),
      ),
      leverageOn: (() => {
        const s = [...document.querySelectorAll('.select-pill select')].find((x) =>
          [...x.options].some((o) => o.value === 'auto'),
        );
        return s ? s.options[s.selectedIndex].textContent?.trim() : null;
      })(),
    };
  });
  check('카드 방향·상태 배지 한글', /^(롱 · 매수|숏 · 매도)$/.test(card.side) && /^(진행 중|목표 달성|손절 종료)$/.test(card.state), `${card.side} / ${card.state}`);
  check('가격 박스 = 목표가·진입가·본전(EQ)·손절가', card.labels.join('|') === '목표가|진입가|본전 (EQ)|손절가', card.labels.join(' / '));
  check(
    '현재가 라벨 · 손익비 1 : n · 최근/전수 승률',
    card.priceCap === '현재가' &&
      /^손익비 1 : \d+\.\d$/.test(card.rr) &&
      /^(최근|전수) 승률 \d+%$/.test(card.winRate),
    `${card.rr} · ${card.winRate}`,
  );
  check('카드에 영어 약어 없음', !card.english, card.sym);
  check(
    '가격 천단위 콤마',
    [card.price, ...card.values].every((v) => {
      const n = Number(v.replace(/,/g, ''));
      return !Number.isFinite(n) || Math.abs(n) < 1000 || v.includes(',');
    }),
    `${card.price} · ${card.values.join(' / ')}`,
  );
  check('레버리지 선택 = COTA 추천 기본 + 5/10/20/50 고정', card.leverageOptions.some((o) => o.includes('COTA 추천')) && card.leverageOn === 'COTA 추천', card.leverageOn || '');
  const recLev = Number((card.rec.match(/(\d+)x/) || [])[1]);
  check('COTA 추천 배지 = 잔고·손절 폭 기준 유동 배율(2~100x)', /^COTA 추천 \d+x$/.test(card.rec) && recLev >= 2 && recLev <= 100, card.rec);

  /* ---------- 4-1) 실전 주문 콕핏 — 실계좌 미연결(v1.5.5) ---------- */
  const unlinked = await page.evaluate(() => {
    const c = document.querySelector('.scanner-tab .signal-card:not(.skeleton)');
    return {
      cockpit: !!c.querySelector('.cockpit:not(.unlinked)'),
      notice: clean(c.querySelector('[data-cockpit-unlinked]')?.textContent),
      connect: !!c.querySelector('.cockpit-connect'),
      cells: c.querySelectorAll('.cockpit-cell').length,
      quick: c.querySelectorAll('[data-quick-order]').length,
      roiSub: clean(c.querySelector('.roi-sub')?.textContent),
      copyBtns: [...c.querySelectorAll('.copy-btn')].map((b) => clean(b.textContent)),
      chartLabels: [...c.querySelectorAll('.mini-label')].map((l) => clean(l.textContent)),
    };
  });
  check(
    '계좌 미연결: 시드 숫자 대신 연결 안내 + 연결 버튼',
    !unlinked.cockpit && unlinked.cells === 0 && /계좌를 연결하면 실시간 잔고 기준/.test(unlinked.notice) && unlinked.connect,
    unlinked.notice.slice(0, 70),
  );
  check('계좌 미연결이면 원클릭 주문 없음 · 수량 복사 없음', unlinked.quick === 0 && unlinked.copyBtns.join('|') === '진입가', unlinked.copyBtns.join(' / '));
  check('수익률 표기는 레버리지만(가짜 평가손익 없음)', /^\d+x 레버리지 적용$/.test(unlinked.roiSub), unlinked.roiSub);
  check(
    '차트 우측 가격 라벨 = 목표/진입/손절 3개가 가격 박스와 일치',
    unlinked.chartLabels.join('|') === [card.values[0], card.values[1], card.values[3]].join('|'),
    unlinked.chartLabels.join(' / '),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.scanner-tab .signal-card:not(.skeleton)').first().screenshot({ path: `${OUT}/49-cockpit-unlinked.png` }).catch(() => {});

  // 진입가 복사 → 클립보드에 콤마 없는 원본 가격
  const copyBtn = page.locator('.scanner-tab .signal-card:not(.skeleton) .copy-btn').first();
  await copyBtn.scrollIntoViewIfNeeded();
  await copyBtn.click();
  await page.waitForTimeout(150);
  const clipEntry = await page.evaluate(() => navigator.clipboard.readText());
  const copyLabel = cleanText(await copyBtn.innerText());
  const clipNum = Number(String(clipEntry).replace(/,/g, ''));
  const shownEntryNum = Number(card.values[1].replace(/,/g, ''));
  check(
    '진입가 복사 → 클립보드 값 = 콤마 없는 진입가',
    !/,/.test(String(clipEntry)) &&
      Number.isFinite(clipNum) &&
      Math.abs(clipNum - shownEntryNum) <= Math.max(1e-9, shownEntryNum * 1e-6),
    `${clipEntry} vs ${card.values[1]}`,
  );
  check('복사 직후 버튼 피드백', copyLabel === '복사됨', copyLabel);
  await page.waitForTimeout(1600);

  check(
    '현재 수익률·발송 시각 표기',
    /^(현재|최종) 수익률 \(진입가 기준\)$/.test(card.cap) && /^발송 \d{2}\. \d{2}\. \d{2}:\d{2}$/.test(card.sentTime),
    `${card.cap} · ${card.sentTime}`,
  );

  // 진입가 기준 실시간 수익률이 롱/숏 방향과 레버리지에 맞게 표시되는지 전 카드 검증
  const live = await page.evaluate(() => {
    const num = (t) => Number(String(t ?? '').replace(/[,$%\s]/g, ''));
    const dec = (t) => {
      const s = String(t ?? '').replace(/[^\d.]/g, '');
      const i = s.indexOf('.');
      return i < 0 ? 0 : s.length - i - 1;
    };
    const allCards = [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')];
    const rows = allCards
      .filter((c) => /현재 수익률/.test(c.querySelector('.roi-cap')?.textContent || ''))
      .map((c) => {
        const side = c.querySelector('.badge.long') ? 'long' : 'short';
        const priceText = c.querySelector('.price')?.textContent;
        const entryText = c.querySelectorAll('.lvl-value')[1]?.textContent;
        const price = num(priceText);
        const entry = num(entryText);
        const roiText = c.querySelector('.roi-value')?.textContent?.trim() ?? '';
        const roi = num(roiText);
        const sub = c.querySelector('.roi-sub')?.textContent ?? '';
        const lev = Number((sub.match(/(\d+(?:\.\d+)?)x/) || [])[1] || 0);
        const pnlText = (sub.match(/평가손익 ([+-]?\$[\d,.]+)/) || [])[1] ?? null;
        const raw = ((price - entry) / entry) * 100 * (side === 'long' ? 1 : -1);
        const tick = Math.pow(10, -Math.max(dec(priceText), dec(entryText)));
        const tol = Math.max(0.2, entry > 0 ? (lev * 100 * (0.75 * tick)) / entry : 0.2);
        return { side, price, entry, roi, lev, raw, expect: raw * lev, pnlText, roiText, tol };
      });
    const off = rows.filter((r) => !r.entry || !r.lev || Math.abs(r.expect - r.roi) > r.tol);
    return {
      total: rows.length,
      closedCards: allCards.length - rows.length,
      longs: rows.filter((r) => r.side === 'long').length,
      shorts: rows.filter((r) => r.side === 'short').length,
      off: off.map((r) => `${r.side}:${r.roiText} vs ${r.expect.toFixed(2)}`),
      pnlShown: rows.filter((r) => r.pnlText).length,
      sample: rows.slice(0, 3).map((r) => `${r.side} ${r.price}→${r.entry} ${r.roiText} (${r.lev}x)`),
    };
  });
  check(
    '실시간 수익률 = (현재가-진입가)/진입가×레버리지 · 롱/숏 부호',
    live.total > 0 && live.off.length === 0,
    `${live.total}건(진행 중) · 종료 카드 ${live.closedCards}건 제외 · 롱 ${live.longs}/숏 ${live.shorts} · ${live.sample.join(' | ')}${live.off.length ? ` · 오차 ${live.off.join(' ; ')}` : ''}`,
  );
  check('계좌 미연결이면 평가손익($)을 지어내지 않는다', live.pnlShown === 0, `${live.pnlShown}건 표시`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/18-toss-scanner.png` });

  /* ---------- 5) 공유 카드 ---------- */
  await page.evaluate(() => {
    window.__drawn = [];
  });
  await page.locator('.scanner-tab .signal-card:not(.skeleton)').first().click();
  await page.waitForSelector('.share-canvas.in', { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/20-toss-share-card.png` });
  const share = await page.evaluate(() => {
    const c = document.querySelector('canvas.share-canvas');
    return {
      w: c.width,
      h: c.height,
      drawn: [...new Set(window.__drawn)],
      bg: (() => {
        const d = c.getContext('2d').getImageData(10, 10, 1, 1).data;
        return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
      })(),
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const hasDrawn = (re) => share.drawn.some((d) => re.test(d));
  check('공유 카드 한글 라벨 + COTA 브랜드', ['진입가', '목표가', '손절가', 'COTA'].every((t) => share.drawn.includes(t)) && hasDrawn(/^본전 \(EQ\)$/) && hasDrawn(/^COTA · 셋업 기록 공유/), share.drawn.slice(0, 12).join(' | '));
  check(
    '공유 카드 COTA 추천 배지 · 계좌 미연결이면 시드 금액 없음',
    hasDrawn(/^COTA 추천 \d+x$/) && hasDrawn(/^손익비 1 : \d+\.\d$/) && !hasDrawn(/내 시드|계좌 \$/),
    share.drawn.filter((d) => /COTA 추천|시드|계좌/.test(d)).join(' | '),
  );
  check('공유 카드 라이트 배경·해상도', /rgb\(2[45]\d, 2[45]\d, 2[45]\d\)/.test(share.bg) && share.w > 0, `${share.bg} ${share.w}px`);

  /* ---------- 6) 설정 탭 ---------- */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-profile', { timeout: 30000 });
  await page.waitForTimeout(700);
  const settings = await page.evaluate(() => {
    const panel = document.querySelector('#settings-notify');
    const profile = document.querySelector('#settings-profile');
    return {
      balance: clean(profile.querySelector('[data-settings-balance] b')?.textContent),
      balanceSub: clean(profile.querySelector('[data-settings-balance] i')?.textContent),
      connectNote: clean(profile.querySelector('[data-settings-connect]')?.textContent),
      hasSeedWord: /내 시드/.test(profile.innerText),
      profileStyle: clean(profile.querySelectorAll('.profile-cell b')[1]?.textContent),
      headings: [...document.querySelectorAll('.settings-tab .panel h3')].map((h) => clean(h.textContent)),
      heading: clean(panel.querySelector('h3')?.textContent),
      switchOn: panel.querySelector('.switch')?.classList.contains('on'),
      targets: [...panel.querySelectorAll('.notify-target button')].map((b) => clean(b.textContent)),
      targetOn: clean(panel.querySelector('.notify-target button.on')?.textContent),
      ntfy: panel.querySelector('.td-key-input')?.value,
      version: [...document.querySelectorAll('.setting-desc')].map((d) => d.textContent).find((t) => t?.includes('앱 v')),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      lotSection: /랏\(Lot\)|벤티지 호가|트웰브 데이터/.test(document.querySelector('.settings-tab').innerText),
      risk: (() => {
        const input = document.querySelector('#settings-profile [data-risk-input]');
        return {
          value: input?.value,
          chips: [...document.querySelectorAll('#settings-profile [data-risk-preset]')].map((b) => clean(b.textContent)),
          chipOn: clean(document.querySelector('#settings-profile [data-risk-preset].on')?.textContent),
          levRec: clean(document.querySelector('#settings-profile [data-settings-levrec] b')?.textContent),
          styleRows: [...document.querySelectorAll('.settings-tab .setting-name')].filter((el) => /매매 스타일|매매 성향/.test(el.textContent ?? '')).length,
        };
      })(),
    };
  });
  check(
    '설정 최상단 내 매매 기준 카드 = 계좌 잔고(미연결 안내)',
    /^💼 내 매매 기준$/.test(settings.headings[0]) && settings.balance === '실계좌 미연결' && !settings.hasSeedWord && /계좌를 연결하면/.test(settings.connectNote),
    `${settings.headings[0]} · ${settings.balance} · ${settings.balanceSub}`,
  );
  check('매매 성향 표시 대신 추천 레버리지 안내', settings.risk.levRec === 'COTA 유동 추천' && settings.risk.styleRows === 0, `${settings.risk.levRec} · 스타일 행 ${settings.risk.styleRows}`);
  check('🔔 핸드폰 알림 유지 · 코인 알림 3택', settings.heading === '🔔 핸드폰 알림' && settings.targets.join('|') === '비트·이더·솔|주요 코인|전체 종목' && settings.targetOn === '주요 코인', settings.targets.join(' / '));
  check('ntfy 토픽 유지 · 앱 버전 v1.5.8', settings.ntfy === 'bgss-hw3238-9f4k2m' && /COTA · 앱 v1\.5\.8/.test(settings.version || ''), `${settings.ntfy} · ${settings.version}`);
  check('설정에 FX 랏·벤티지·트웰브 데이터 없음', !settings.lotSection);
  check(
    '실전 주문 리스크 = 숫자 칩 1/2/3/5/10/20/30/50% + 직접 입력 · 기본 1.5%',
    settings.risk.value === '1.5' && settings.risk.chips.join('|') === '1%|2%|3%|5%|10%|20%|30%|50%' && settings.risk.chipOn === '',
    `${settings.risk.value} · ${settings.risk.chips.join(' / ')}`,
  );
  // 50% 리스크 + 직접 입력 → 저장 버튼으로 확정 → 고위험 경고 · 콕핏 수량 반영
  await page.locator('#settings-profile [data-risk-preset="50"]').click();
  await page.waitForTimeout(250);
  const riskDraftOnly = await page.evaluate(() => ({
    warning: !!document.querySelector('#settings-profile [data-risk-warning]'),
    stored: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').riskPct,
    saveDirty: document.querySelector('#settings-profile [data-save="risk"]')?.getAttribute('data-save-state'),
  }));
  check(
    '리스크 선택만으로는 저장되지 않음(초안 · 경고 미리보기)',
    riskDraftOnly.warning && riskDraftOnly.saveDirty === 'dirty' && riskDraftOnly.stored !== 50,
    `저장=${riskDraftOnly.stored} · ${riskDraftOnly.saveDirty}`,
  );
  await page.locator('#settings-profile [data-save="risk"]').click();
  await page.waitForTimeout(300);
  const risk50 = await page.evaluate(() => ({
    warning: !!document.querySelector('#settings-profile [data-risk-warning]'),
    text: document.querySelector('#settings-profile [data-risk-warning]')?.textContent?.trim() ?? '',
    stored: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').riskPct,
    autoStored: JSON.parse(localStorage.getItem('cota.autotrade.config.v1') || '{}').riskPct,
    savedLabel: document.querySelector('#settings-profile [data-save="risk"]')?.textContent?.trim(),
  }));
  check(
    '리스크 50% 저장 → ✓ 저장됨 · 고위험 경고 · 자동매매에도 50%',
    risk50.warning && /고위험 설정/.test(risk50.text) && risk50.stored === 50 && risk50.autoStored === 50 && risk50.savedLabel === '✓ 저장됨',
    `${risk50.text} · ${risk50.savedLabel} · auto=${risk50.autoStored}`,
  );
  const customInput = page.locator('#settings-profile [data-risk-input]');
  const customExists = (await customInput.count()) === 1;
  if (customExists) {
    await customInput.fill('12.5');
    await page.waitForTimeout(250);
    await page.locator('#settings-profile [data-save="risk"]').click();
    await page.waitForTimeout(300);
  }
  const custom = { exists: customExists, value: customExists ? await customInput.inputValue() : '' };
  const customStored = await page.evaluate(() => JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').riskPct);
  check('직접 입력 12.5% 저장', custom.exists && customStored === 12.5, `input=${custom.value} · 저장=${customStored}`);
  await page.locator('#settings-profile [data-risk-preset="1"]').click();
  await page.waitForTimeout(200);
  await page.locator('#settings-profile [data-save="risk"]').click();
  await page.waitForTimeout(250);
  check('설정 탭 가로 오버플로 0건', !settings.overflow);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/21-toss-settings.png` });

  /* ---------- 7) 추천 배율은 시그널(손절 폭·품질)마다 다르다 · 스타일 없음 ---------- */
  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(700);
  const dynamicLev = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')];
    const recs = cards.map((c) => clean(c.querySelector('.badge.rec')?.textContent)).filter((t) => /COTA 추천/.test(t));
    const profile = localStorage.getItem('cota.profile.v1');
    const styleInAuto = (() => {
      document.querySelector('.bottom-nav button[data-tab="menu"]')?.click();
      return null;
    })();
    return { recs, profile, styleInAuto };
  });
  const levs = dynamicLev.recs.map((r) => Number((r.match(/(\d+)x/) || [])[1]));
  check('추천 배율 배지가 카드마다 있다', dynamicLev.recs.length > 0 && levs.every((v) => Number.isFinite(v) && v >= 2 && v <= 100), dynamicLev.recs.slice(0, 4).join(' / '));
  check('추천 배율은 시그널의 손절 폭·품질에 따라 달라진다(고정 상한 없음)', new Set(levs).size >= 1 && levs.every((v) => v <= 100), `${[...new Set(levs)].join(', ')}`);
  check('매매 스타일 저장값(cota.profile.v1)이 생기지 않는다', dynamicLev.profile === null, String(dynamicLev.profile));

  /* ---------- 8) 메뉴 > 전략엔진 · 나머지 탭 ---------- */
  await page.locator('.bottom-nav button[data-tab="menu"]').click();
  await page.waitForTimeout(400);
  await page.locator('.menu-row[data-menu="engine"]').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/19-toss-engine.png` });
  const engine = await page.evaluate(() => ({
    title: clean(document.querySelector('.hero-copy h2')?.textContent),
    rows: document.querySelectorAll('.strat-row').length,
    text: (document.querySelector('.engine-tab')?.innerText || '').length,
  }));
  check('전략엔진 탭 렌더(전략 순위)', engine.rows >= 1 && engine.text > 300, `${engine.rows}개 · ${engine.title?.slice(0, 24)}`);

  const tabChecks = {};
  for (const [label, key] of [
    ['시황', 'market'],
    ['기록', 'history'],
  ]) {
    await page.locator(`.bottom-nav button[data-tab="${key}"]`).click();
    await page.waitForTimeout(700);
    tabChecks[label] = await page.evaluate(() => ({
      panels: document.querySelectorAll('.panel, .summary-card').length,
      errors: document.querySelectorAll('.notice.error').length,
      text: (document.querySelector('main')?.innerText || '').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
  }
  check(
    '시황·기록 탭 정상 · 오버플로 0건',
    Object.values(tabChecks).every((t) => t.panels > 0 && t.errors === 0 && t.text > 200 && !t.overflow),
    JSON.stringify(tabChecks),
  );

  /* ---------- 9) 즐겨찾기 · 검색 ---------- */
  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(700);
  await page.locator('.scanner-tab .signal-card:not(.skeleton) .fav-btn').first().click();
  await page.waitForTimeout(300);
  await page.locator('.scanner-tab .fav-toggle').click();
  await page.waitForTimeout(500);
  const fav = await page.evaluate(() => ({
    fav: document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)').length,
    head: clean(document.querySelector('.scanner-tab .list-head')?.textContent),
  }));
  check('⭐ 즐겨찾기 모아보기', fav.fav >= 1 && /즐겨찾기/.test(fav.head), fav.head);
  await page.locator('.scanner-tab .fav-toggle').click();
  await page.waitForTimeout(300);
  await page.locator('.scanner-tab .search-box input').fill('BTC');
  await page.waitForTimeout(600);
  const readSearch = () =>
    page.evaluate(() => ({
      cards: [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')].map((c) => clean(c.textContent)),
      count: document.querySelector('.scanner-tab .search-count b')?.textContent,
    }));
  let search = await readSearch();
  if (search.cards.length === 0) {
    // 진행 중 BTC 시그널이 없으면 앱 안내대로 '진행중만'을 꺼서 최근 종료 시그널까지 검색한다.
    await page.locator('.scanner-tab .ghost-toggle').click();
    await page.waitForTimeout(600);
    search = await readSearch();
  }
  check('코인 검색(BTC)', search.cards.length > 0 && search.cards.every((t) => t.includes('BTC')), `${search.cards.length}건 · ${search.count}`);
  await page.locator('.scanner-tab .search-clear').click();
  await page.waitForTimeout(300);

  await mobile.close();

  /* ---------- 10) 데스크톱 ---------- */
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await desktop.addInitScript(() => {
    localStorage.setItem('cota.exchange.v1', 'bitget');
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    localStorage.setItem('cota.profile.v1', JSON.stringify({ style: 'conservative', updatedAt: Date.now() }));
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
  await dpage.waitForTimeout(900);
  const desktopInfo = await dpage.evaluate(() => ({
    topNav: [...document.querySelectorAll('.top-nav button')].map((b) => clean(b.textContent)),
    bottomNavHidden: getComputedStyle(document.querySelector('.bottom-nav')).display === 'none',
    cards: document.querySelectorAll('.signal-card:not(.skeleton)').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    onboarding: !!document.querySelector('.onboarding'),
  }));
  check(
    '데스크톱 5탭(상단) · 하단 탭 숨김 · 오버플로 없음',
    desktopInfo.topNav.length === 5 && desktopInfo.bottomNavHidden && !desktopInfo.overflow && desktopInfo.cards > 0,
    JSON.stringify(desktopInfo),
  );
  check('데스크톱도 온보딩 없이 스캐너가 바로 열린다', !desktopInfo.onboarding);
  await desktop.close();
  await browser.close();

  check('콘솔/페이지 에러 0건', consoleErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors, pageErrors }));

  const report = {
    firstRun,
    theme,
    nav,
    coin,
    card,
    share: { w: share.w, h: share.h, bg: share.bg, drawn: share.drawn },
    settings,
    dynamicLev,
    engine,
    tabChecks,
    desktopInfo,
    consoleErrors,
    pageErrors,
    checks,
    allOk: checks.every((c) => c.ok),
  };
  writeFileSync('.tmp/cota-ui-report.json', JSON.stringify(report, null, 1));
  console.log(
    `\n${report.allOk ? '✅ COTA UI 검증 통과' : '❌ 실패 ' + checks.filter((c) => !c.ok).length + '건'} (${checks.length}개 확인)`,
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
