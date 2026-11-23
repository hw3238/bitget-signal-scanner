/**
 * COTA UI 검증 — 토스 스타일 라이트 UI · 5탭 코인 집중 · 전면 한글화 · 가격 가독성 ·
 * 첫 실행 온보딩 · COTA 추천 레버리지 · 시드 기반 예상 손익
 *
 *  1) 라이트 테마(#F2F4F6 · #FFFFFF · 네온 0건) · COTA 브랜드/로고/파비콘
 *  2) 첫 실행 온보딩(시드 프리셋·보수적/공격적) → 저장 → 메인 진입
 *  3) 하단 5탭(스캐너|시황|메뉴|기록|설정) · 390px 가로 오버플로 0건
 *  4) 코인 집중: 기본 자산 필터 '코인', FX·랏(Lot)·벤티지 호가 보정 UI 0건
 *  5) 카드 한글 라벨(진입가·목표가·손절가·본전·손익비·최근 승률) + 천단위 콤마
 *  6) COTA 추천 배지(보수적 2~5x · 공격적 10~25x) + 시드 예상 수익/손절 손실
 *  7) 공유 카드(캔버스) · 설정(프로필·알림) · 메뉴>전략엔진 · 콘솔 에러 0건
 *  8) 스크린샷 5장: 18-toss-scanner · 19-toss-engine · 20-toss-share-card · 21-toss-settings · 22-toss-onboarding
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

  /* ---------- 1) 첫 실행 온보딩 ---------- */
  await page.waitForSelector('.onboarding', { timeout: 30000 });
  const onb = await page.evaluate(() => {
    const el = document.querySelector('.onboarding');
    return {
      visible: !!el,
      title: clean(el.querySelector('h2')?.textContent),
      seedValue: el.querySelector('.seed-input input')?.value,
      presets: [...el.querySelectorAll('.seed-chip')].map((b) => clean(b.textContent)),
      presetOn: clean(el.querySelector('.seed-chip.on')?.textContent),
      styles: [...el.querySelectorAll('.style-card')].map((b) => ({
        label: clean(b.querySelector('b')?.textContent),
        range: clean(b.querySelector('.style-range')?.textContent),
        on: b.classList.contains('on'),
      })),
      startText: clean(el.querySelector('.onb-start')?.textContent),
      closeBtn: !!el.querySelector('.onboarding-x'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      logoLoaded: (() => {
        const img = el.querySelector('.onboarding-logo');
        return !!img && img.complete && img.naturalWidth > 0;
      })(),
    };
  });
  check('첫 실행: 온보딩 모달 표시', onb.visible, onb.title);
  check('시드 기본값 $1,000 · 프리셋 4개', onb.seedValue === '1,000' && onb.presets.join('|') === '$100|$500|$1,000|$5,000', `${onb.seedValue} · ${onb.presets.join(' ')}`);
  check('매매 성향 2택(보수적 2~5x · 공격적 10~25x)', onbstyles(onb) === '보수적 매매:추천 2x ~ 5x|공격적 매매:추천 10x ~ 25x', onb.styles.map((s) => `${s.label}:${s.range}`).join(' | '));
  check('보수적 기본 선택 · 시작하기 버튼 · 로고', onb.styles[0]?.on && onb.startText === '시작하기' && onb.logoLoaded, `${onb.startText}`);
  check('첫 실행 온보딩은 닫기 버튼 없음', !onb.closeBtn);
  check('390px 온보딩 가로 오버플로 0건', !onb.overflow);

  // 시드 비우면 시작하기 비활성
  await page.fill('.seed-input input', '');
  const disabled = await page.evaluate(() => document.querySelector('.onb-start')?.disabled === true);
  check('시드가 비면 시작하기 비활성', disabled);

  // $5,000 + 공격적 → 스크린샷 22
  await page.fill('.seed-input input', '5000');
  await page.locator('.style-card.aggressive').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/22-toss-onboarding.png` });
  const onbState = await page.evaluate(() => ({
    seed: document.querySelector('.seed-input input')?.value,
    aggressiveOn: document.querySelector('.style-card.aggressive')?.classList.contains('on'),
    summary: clean(document.querySelector('.onb-summary')?.textContent),
  }));
  check('시드 $5,000 입력 · 공격적 선택 반영', onbState.seed === '5,000' && onbState.aggressiveOn && /5,000/.test(onbState.summary), onbState.summary);

  // 보수적으로 시작 → 메인 진입
  await page.locator('.style-card.conservative').click();
  await page.locator('.onb-start').click();
  await page.waitForSelector('.onboarding', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('.signal-card:not(.skeleton)', { timeout: 180000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.rescan');
      return !!b && !b.classList.contains('busy');
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cota.profile.v1') || 'null'));
  check('시작하기 → cota.profile.v1 저장 · 온보딩 닫힘', stored?.seed === 5000 && stored?.style === 'conservative', JSON.stringify(stored));

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
  check('현재가 라벨 · 손익비 1 : n · 최근 승률', card.priceCap === '현재가' && /^손익비 1 : \d+\.\d$/.test(card.rr) && /^최근 승률 \d+%$/.test(card.winRate), `${card.rr} · ${card.winRate}`);
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
  check('COTA 추천 배지 = 보수적 2x~5x', /^COTA 추천 \d+x$/.test(card.rec) && recLev >= 2 && recLev <= 5, card.rec);

  /* ---------- 4-1) 실전 주문 콕핏 ---------- */
  check(
    '실전 주문 콕핏 4칸 = 주문 수량·필요 증거금·손절·목표',
    card.cockpitTitle === '🎯 실전 주문' &&
      card.cockpitCells.map((x) => x.label).join('|') === '주문 수량|필요 증거금|손절 도달 시|목표 도달 시',
    `${card.cockpitTitle} · ${card.cockpitCells.map((x) => x.label).join(' / ')}`,
  );
  check(
    '콕핏 리스크 = 시드 $5,000의 보수적 1.5% · COTA 추천 배율',
    /^시드 \$5,000의 1\.5% · \d+x$/.test(card.cockpitRisk),
    card.cockpitRisk,
  );
  const entryVal = Number(card.values[1].replace(/,/g, ''));
  const targetVal = Number(card.values[0].replace(/,/g, ''));
  const stopVal = Number(card.values[3].replace(/,/g, ''));
  const shownQty = Number((card.cockpitCells[0]?.value || '').replace(/[^0-9.]/g, ''));
  const expectQty = (5000 * 0.015) / Math.abs(entryVal - stopVal);
  check(
    '주문 수량 = (시드 × 1.5%) ÷ |진입가 − 손절가| (거래소 단위 내림)',
    Number.isFinite(shownQty) &&
      shownQty > 0 &&
      Math.abs(shownQty - expectQty) <= Math.max(0.0002, expectQty * 0.04),
    `표시 ${card.cockpitCells[0]?.value} · 계산 ${expectQty.toFixed(6)}`,
  );
  const shownMargin = Number((card.cockpitCells[1]?.value || '').replace(/[^0-9.]/g, ''));
  const expectMargin = (shownQty * entryVal) / recLev;
  check(
    '필요 증거금 = 수량 × 진입가 ÷ 추천 배율',
    Math.abs(shownMargin - expectMargin) <= Math.max(1, expectMargin * 0.01),
    `표시 $${shownMargin} · 계산 $${expectMargin.toFixed(2)} @ ${recLev}x`,
  );
  const shownProfit = Number((card.cockpitCells[3]?.value || '').replace(/[^0-9.]/g, ''));
  const expectProfit = shownQty * Math.abs(targetVal - entryVal);
  check(
    '손절 손실 = —$75 (시드의 1.5%) · 목표 수익 = 수량 × 목표 거리',
    card.cockpitCells[2]?.value === '-$75.00' &&
      card.cockpitCells[2]?.sub === '-1.50%' &&
      Math.abs(shownProfit - expectProfit) <= Math.max(3, expectProfit * 0.03),
    `${card.cockpitCells[2]?.value} · ${card.cockpitCells[3]?.value} (계산 $${expectProfit.toFixed(2)})`,
  );
  check(
    '차트 우측 가격 라벨 = 목표/진입/손절 3개가 가격 박스와 일치',
    card.chartLabels.join('|') === [card.values[0], card.values[1], card.values[3]].join('|'),
    card.chartLabels.join(' / '),
  );
  check('원클릭 복사 버튼 = 진입가·수량', card.copyBtns.join('|') === '진입가|수량', card.copyBtns.join(' / '));

  // 진입가 복사 → 클립보드에 콤마 없는 원본 가격
  const copyBtn = page.locator('.scanner-tab .signal-card:not(.skeleton) .copy-btn').first();
  await copyBtn.scrollIntoViewIfNeeded();
  await copyBtn.click();
  await page.waitForTimeout(150);
  const clipEntry = await page.evaluate(() => navigator.clipboard.readText());
  const copyLabel = cleanText(await copyBtn.innerText());
  check(
    '진입가 복사 → 클립보드 값 = 콤마 없는 진입가',
    clipEntry === card.values[1].replace(/,/g, ''),
    `${clipEntry} vs ${card.values[1]}`,
  );
  check('복사 직후 버튼 피드백', copyLabel === '복사됨', copyLabel);
  await page.waitForTimeout(1600);

  // 수량 복사 → 숫자만(지수·콤마 없음)
  const qtyBtn = page.locator('.scanner-tab .signal-card:not(.skeleton) .copy-btn').nth(1);
  await qtyBtn.click();
  await page.waitForTimeout(150);
  const clipQty = await page.evaluate(() => navigator.clipboard.readText());
  check(
    '수량 복사 → 콤마·지수 없는 주문 수량',
    /^[0-9]+(\.[0-9]+)?$/.test(clipQty) && Math.abs(Number(clipQty) - shownQty) <= Math.max(1e-8, shownQty * 1e-6),
    clipQty,
  );
  await page.waitForTimeout(1600);

  // 대표 스크린샷 — 실전 주문 콕핏이 한 장에 보이게
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstCard = page.locator('.scanner-tab .signal-card:not(.skeleton)').first();
  await firstCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await firstCard.screenshot({ path: `${OUT}/45-signal-cockpit.png` });

  check(
    '현재 수익률·발송 시각 표기',
    /^(현재|최종) 수익률 \(진입가 기준\)$/.test(card.cap) &&
      /^\d+x 적용 · 평가손익 [+-]?\$/.test(card.roiSub) &&
      /^발송 \d{2}\. \d{2}\. \d{2}:\d{2}$/.test(card.sentTime),
    `${card.cap} · ${card.roiSub} · ${card.sentTime}`,
  );

  // 진입가 기준 실시간 수익률이 롱/숏 방향과 레버리지에 맞게 표시되는지 전 카드 검증
  const live = await page.evaluate(() => {
    const num = (t) => Number(String(t ?? '').replace(/[,$%\s]/g, ''));
    const dec = (t) => {
      const s = String(t ?? '').replace(/[^\d.]/g, '');
      const i = s.indexOf('.');
      return i < 0 ? 0 : s.length - i - 1;
    };
    const rows = [...document.querySelectorAll('.scanner-tab .signal-card:not(.skeleton)')].map((c) => {
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
      // 표시 가격의 최소 단위(틱) 반올림 오차를 레버리지만큼 허용 — 마이크로 프라이스 코인(SHIB 등) 대응
      const tick = Math.pow(10, -Math.max(dec(priceText), dec(entryText)));
      const tol = Math.max(0.2, entry > 0 ? (lev * 100 * (0.75 * tick)) / entry : 0.2);
      return { side, price, entry, roi, lev, raw, expect: raw * lev, pnlText, roiText, tol };
    });
    const off = rows.filter((r) => !r.entry || !r.lev || Math.abs(r.expect - r.roi) > r.tol);
    const seedPnlOff = rows.filter((r) => {
      if (!r.pnlText) return false;
      const shown = num(r.pnlText);
      return Math.abs(shown - (5000 * r.roi) / 100) > 40;
    });
    return {
      total: rows.length,
      longs: rows.filter((r) => r.side === 'long').length,
      shorts: rows.filter((r) => r.side === 'short').length,
      off: off.map((r) => `${r.side}:${r.roiText} vs ${r.expect.toFixed(2)}`),
      seedPnlOff: seedPnlOff.map((r) => r.pnlText),
      sample: rows.slice(0, 3).map((r) => `${r.side} ${r.price}→${r.entry} ${r.roiText} (${r.lev}x)`),
    };
  });
  check(
    '실시간 수익률 = (현재가-진입가)/진입가×레버리지 · 롱/숏 부호',
    live.total > 0 && live.off.length === 0,
    `${live.total}건 · 롱 ${live.longs}/숏 ${live.shorts} · ${live.sample.join(' | ')}${live.off.length ? ` · 오차 ${live.off.join(' ; ')}` : ''}`,
  );
  check(
    '시드 평가손익 = 시드 × 실시간 수익률',
    live.seedPnlOff.length === 0,
    live.seedPnlOff.length ? live.seedPnlOff.join(' ') : '전 카드 일치',
  );

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
  check('공유 카드 COTA 추천 배지·시드 손익', hasDrawn(/^COTA 추천 \d+x$/) && hasDrawn(/내 시드 \$5,000/) && hasDrawn(/^손익비 1 : \d+\.\d$/), share.drawn.filter((d) => /COTA 추천|시드/.test(d)).join(' | '));
  check('공유 카드 라이트 배경·해상도', /rgb\(2[45]\d, 2[45]\d, 2[45]\d\)/.test(share.bg) && share.w > 0, `${share.bg} ${share.w}px`);

  /* ---------- 6) 설정 탭 ---------- */
  await page.locator('.bottom-nav button[data-tab="settings"]').click();
  await page.waitForSelector('#settings-profile', { timeout: 30000 });
  await page.waitForTimeout(700);
  const settings = await page.evaluate(() => {
    const panel = document.querySelector('#settings-notify');
    const profile = document.querySelector('#settings-profile');
    return {
      profileSeed: clean(profile.querySelector('.profile-cell b')?.textContent),
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
        const s = document.querySelector('#settings-profile .risk-pill select');
        return {
          value: s?.value,
          options: s ? [...s.options].map((o) => clean(o.textContent)) : [],
        };
      })(),
    };
  });
  check('설정 최상단 내 투자 프로필 카드', /^💼 내 투자 프로필$/.test(settings.headings[0]) && settings.profileSeed === '$5,000', `${settings.headings[0]} · ${settings.profileSeed} · ${settings.profileStyle}`);
  check('매매 성향 표시(보수적)', /보수적 매매/.test(settings.profileStyle), settings.profileStyle);
  check('🔔 핸드폰 알림 유지 · 코인 알림 3택', settings.heading === '🔔 핸드폰 알림' && settings.targets.join('|') === '비트·이더·솔|주요 코인|전체 종목' && settings.targetOn === '주요 코인', settings.targets.join(' / '));
  check('ntfy 토픽 유지 · 앱 버전 v1.5.0', settings.ntfy === 'bgss-hw3238-9f4k2m' && /COTA · 앱 v1\.5\.0/.test(settings.version || ''), `${settings.ntfy} · ${settings.version}`);
  check('설정에 FX 랏·벤티지·트웰브 데이터 없음', !settings.lotSection);
  check(
    '실전 주문 리스크 설정 = 성향 추천 + 1/2/3/5/10/20/30/50% + 직접 입력',
    settings.risk.value === 'auto' &&
      settings.risk.options.length === 10 &&
      /성향 추천 \(1\.5%\)/.test(settings.risk.options[0]) &&
      settings.risk.options.slice(1, 9).join('|') === '시드의 1%|시드의 2%|시드의 3%|시드의 5%|시드의 10%|시드의 20%|시드의 30%|시드의 50%' &&
      settings.risk.options[9] === '직접 입력',
    `${settings.risk.value} · ${settings.risk.options.join(' / ')}`,
  );
  // 50% 리스크 + 직접 입력 → 고위험 경고 · 콕핏 수량 반영
  await page.selectOption('#settings-profile .risk-pill select', '50');
  await page.waitForTimeout(300);
  const risk50 = await page.evaluate(() => ({
    warning: !!document.querySelector('#settings-profile [data-risk-warning]'),
    text: document.querySelector('#settings-profile [data-risk-warning]')?.textContent?.trim() ?? '',
    stored: JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').riskPct,
  }));
  check('리스크 50% 선택 → 고위험 경고 표시', risk50.warning && /고위험 설정/.test(risk50.text) && risk50.stored === 50, risk50.text);
  await page.selectOption('#settings-profile .risk-pill select', 'custom');
  await page.waitForTimeout(250);
  const customInput = page.locator('#settings-profile [data-risk-input]');
  const customExists = (await customInput.count()) === 1;
  if (customExists) {
    await customInput.fill('12.5');
    await page.waitForTimeout(250);
  }
  const custom = { exists: customExists, value: customExists ? await customInput.inputValue() : '' };
  const customStored = await page.evaluate(() => JSON.parse(localStorage.getItem('bgss.settings.v1') || '{}').riskPct);
  check('직접 입력 12.5% 저장', custom.exists && customStored === 12.5, `input=${custom.value} · 저장=${customStored}`);
  await page.selectOption('#settings-profile .risk-pill select', 'auto');
  await page.waitForTimeout(200);
  check('설정 탭 가로 오버플로 0건', !settings.overflow);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/21-toss-settings.png` });

  /* ---------- 7) 공격적 성향 → 추천 배율 상승 ---------- */
  await page.locator('#settings-profile .ghost-btn', { hasText: '다시 설정' }).click();
  await page.waitForSelector('.onboarding', { timeout: 15000 });
  const reopen = await page.evaluate(() => ({
    seed: document.querySelector('.seed-input input')?.value,
    style: document.querySelector('.style-card.on b')?.textContent?.trim(),
    canClose: !!document.querySelector('.onboarding-x'),
  }));
  check('설정에서 온보딩 다시 열기(기존 값 유지)', reopen.seed === '5,000' && /보수적/.test(reopen.style || '') && reopen.canClose, `${reopen.seed} · ${reopen.style}`);
  await page.locator('.style-card.aggressive').click();
  await page.locator('.onb-start').click();
  await page.waitForSelector('.onboarding', { state: 'detached', timeout: 15000 });
  await page.locator('.bottom-nav button[data-tab="scanner"]').click();
  await page.waitForTimeout(700);
  const aggressive = await page.evaluate(() => {
    const rec = document.querySelector('.scanner-tab .badge.rec')?.textContent || '';
    const cells = [...document.querySelectorAll('.scanner-tab .cockpit-cell')].map((s) => ({
      label: clean(s.querySelector('span')?.textContent),
      value: clean(s.querySelector('b')?.textContent),
      sub: clean(s.querySelector('i')?.textContent),
    }));
    const risk = clean(document.querySelector('.scanner-tab .cockpit-risk')?.textContent);
    const stored = JSON.parse(localStorage.getItem('cota.profile.v1') || '{}');
    return { rec: clean(rec), cells, risk, stored };
  });
  const agLev = Number((aggressive.rec.match(/(\d+)x/) || [])[1]);
  check('공격적 저장 · 추천 배율 10x~25x', aggressive.stored.style === 'aggressive' && agLev >= 10 && agLev <= 25, aggressive.rec);
  check('성향 변경 시 추천 배율 상승(보수적 < 공격적)', agLev > recLev, `${recLev}x → ${agLev}x`);
  check(
    '공격적 리스크 3%로 갱신 · 손절 손실 −$150',
    /^시드 \$5,000의 3% · \d+x$/.test(aggressive.risk) &&
      aggressive.cells[2]?.value === '-$150.00' &&
      aggressive.cells[2]?.sub === '-3.00%',
    `${aggressive.risk} · ${aggressive.cells[2]?.value}`,
  );

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
    window.clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    localStorage.setItem('cota.profile.v1', JSON.stringify({ seed: 1000, style: 'conservative', updatedAt: Date.now() }));
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
  check('프로필이 있으면 온보딩이 뜨지 않음', !desktopInfo.onboarding);
  await desktop.close();
  await browser.close();

  check('콘솔/페이지 에러 0건', consoleErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors, pageErrors }));

  const report = {
    onb,
    theme,
    nav,
    coin,
    card,
    share: { w: share.w, h: share.h, bg: share.bg, drawn: share.drawn },
    settings,
    aggressive,
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

function onbstyles(onb) {
  return onb.styles.map((s) => `${s.label}:${s.range}`).join('|');
}

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
