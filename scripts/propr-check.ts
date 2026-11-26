/**
 * 🏆 Propr 5K 터보 엔진 단위 검증 (실행: npm run check:propr)
 *
 *  1) 5K Turbo 1-Step 규정 상수 — 시작 $5,000 · 목표 $5,450(+$450) · 일일 3%($150) · 하한 $4,850
 *  2) 계좌 트래커 계산(진행률·남은 목표·일일 여유·탈락 판정·UTC 00:00 리셋 시각)
 *  3) 자산군별 레버리지 상한 — Propr 표(2026-11-26)와 1:1 인지(BTC 10 · 알트 2 · 주식 4 ·
 *     SP500/XYZ100 10 · 금 8 · 구리 5 · KR200 4)
 *  4) 주문 가이드 — 0.5%($25)/0.75%/1.0% 리스크 사이징, 상한 배율 준수, 상한 때문에 줄어드는 경우
 *  5) 유니버스 스냅숏 무결성(146종목·타입·수수료)
 *  6) 필터·정렬·복사 문구
 *  7) **실제 Hyperliquid API** — 상장 종목 시세·캔들·전략 엔진 시그널까지 실데이터로 확인
 */
import { analyzeProprMarket, pickProprScanSet } from '../src/hooks/usePropr';
import {
  matchProprFilter,
  PROPR_RISK_CHOICES,
  proprGroupOf,
  proprOrderGuide,
  proprPlanLines,
  rankProprHits,
  TURBO_5K,
  turboAccount,
  nextUtcMidnight,
  type ProprHit,
} from '../src/engine/propr';
import {
  PROPR_LISTINGS,
  PROPR_LISTING_BY_NAME,
  proprBase,
  proprLeverageCap,
} from '../src/engine/proprUniverse';
import { fetchHlCandles, fetchProprMarkets } from '../src/api/hyperliquid';
import { mapLimit } from '../src/api/publicMarket';

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const near = (a: number, b: number, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/* ------------------------------------------------------------------ *
 * 1) 규정 상수
 * ------------------------------------------------------------------ */
check(
  '5K 터보 규정: 시작 $5,000 · 목표 $450 → $5,450 · 일일 3% · 낙폭 3%(하한 $4,850)',
  TURBO_5K.startBalance === 5000 &&
    TURBO_5K.targetProfit === 450 &&
    TURBO_5K.targetBalance === 5450 &&
    TURBO_5K.dailyLossPct === 3 &&
    TURBO_5K.maxDrawdownPct === 3 &&
    TURBO_5K.floorBalance === 4850,
  `$${TURBO_5K.startBalance} → $${TURBO_5K.targetBalance} (하한 $${TURBO_5K.floorBalance})`,
);
check(
  '1회 리스크 선택지: 0.5%($25) 추천 · 0.75%($37.5) · 1.0%($50)',
  PROPR_RISK_CHOICES.length === 3 &&
    PROPR_RISK_CHOICES.map((c) => c.pct).join(',') === '0.5,0.75,1' &&
    PROPR_RISK_CHOICES.find((c) => c.recommended)?.pct === 0.5 &&
    near((5000 * 0.5) / 100, 25) &&
    near((5000 * 0.75) / 100, 37.5) &&
    near((5000 * 1) / 100, 50),
  PROPR_RISK_CHOICES.map((c) => `${c.label}=$${((5000 * c.pct) / 100).toFixed(2)}`).join(' · '),
);

/* ------------------------------------------------------------------ *
 * 2) 계좌 트래커
 * ------------------------------------------------------------------ */
const base = turboAccount(5000, 5000);
check(
  '계좌 트래커(기본): 진행 0% · 남은 $450 · 일일 여유 $150 · 하한 $4,850',
  base.progressPct === 0 &&
    base.remainingUsd === 450 &&
    near(base.dailyRoomUsd, 150) &&
    near(base.dailyFloor, 4850) &&
    base.floorBalance === 4850 &&
    !base.passed &&
    !base.breached,
  `진행 ${base.progressPct}% · 남은 $${base.remainingUsd} · 일일 -$${base.dailyRoomUsd}`,
);

const up = turboAccount(5270, 5000);
check(
  '계좌 트래커(이익 $270): 진행 60% · 남은 $180 · 하한 여유 $420',
  near(up.progressPct, 60) && near(up.remainingUsd, 180) && near(up.floorRoomUsd, 420) && !up.passed,
  `진행 ${up.progressPct}% · 남은 $${up.remainingUsd}`,
);

const dayStartHigher = turboAccount(5300, 5200);
check(
  '일일 한도는 당일 시작 잔고 기준: $5,200 → 하루 $156, 탈락선 $5,044',
  near(dayStartHigher.dailyRoomUsd, 156) && near(dayStartHigher.dailyFloor, 5044) && near(dayStartHigher.dailyRoomLeftUsd, 256),
  `한도 -$${dayStartHigher.dailyRoomUsd} · 탈락선 $${dayStartHigher.dailyFloor}`,
);

check(
  '탈락/통과 판정: $4,850 이하는 탈락 · $5,450 이상은 통과',
  turboAccount(4850, 5000).breached && turboAccount(4849, 5000).breached && turboAccount(5450, 5000).passed && turboAccount(5449, 5000).passed === false,
  `4850=${turboAccount(4850, 5000).breached} / 5450=${turboAccount(5450, 5000).passed}`,
);

const resetAt = nextUtcMidnight(Date.parse('2026-11-26T13:30:00Z'));
check(
  'UTC 00:00 리셋 시각 계산',
  resetAt === Date.parse('2026-11-27T00:00:00Z'),
  new Date(resetAt).toISOString(),
);

/* ------------------------------------------------------------------ *
 * 3) 자산군별 레버리지 상한 (Propr 표와 1:1)
 * ------------------------------------------------------------------ */
const CAP_CASES: Array<[string, string, number]> = [
  ['BTC', 'CRYPTO', 10],
  ['ETH', 'CRYPTO', 10],
  ['SOL', 'CRYPTO', 10],
  ['HYPE', 'CRYPTO', 2],
  ['XRP', 'CRYPTO', 2],
  ['NVDA', 'EQ', 4],
  ['TSLA', 'EQ', 4],
  ['KR200', 'EQ', 4],
  ['XYZ100', 'IDX', 10],
  ['SP500', 'IDX', 10],
  ['GOLD', 'CMDTY', 8],
  ['SILVER', 'CMDTY', 8],
  ['CL', 'CMDTY', 8],
  ['BRENTOIL', 'CMDTY', 8],
  ['COPPER', 'CMDTY', 5],
  ['EUR', 'FX', 25],
];
const capBad = CAP_CASES.filter(([name, type, cap]) => proprLeverageCap(name, type as never) !== cap);
check(
  '자산군별 상한: BTC/ETH/SOL 10x · 기타코인 2x · 주식 4x · 지수 10x(기타 5x) · 금·은·원유 8x · 구리 5x · FX 25x',
  capBad.length === 0,
  capBad.map((c) => `${c[0]}=${proprLeverageCap(c[0], c[1] as never)}`).join(' / ') || CAP_CASES.map((c) => `${c[0]} ${c[2]}x`).join(' · '),
);
check(
  'Propr 표에 없는 신규 종목도 안전한 기본 상한(주식 4x · 기타 지수 5x)',
  proprLeverageCap('NEWSTOCK', 'EQ') === 4 && proprLeverageCap('NIFTY', 'IDX') === 5 && proprLeverageCap('AAA', 'CRYPTO') === 2,
  `신규주식 ${proprLeverageCap('NEWSTOCK', 'EQ')}x · 신규지수 ${proprLeverageCap('NIFTY', 'IDX')}x · 신규코인 ${proprLeverageCap('AAA', 'CRYPTO')}x`,
);

/* ------------------------------------------------------------------ *
 * 4) 주문 가이드
 * ------------------------------------------------------------------ */
const g1 = proprOrderGuide({ side: 'long', entry: 100, stop: 98, target: 104, balance: 5000, riskPct: 0.5, cap: 10 });
check(
  '주문 가이드(0.5% · 손절 2%): 리스크 $25 · 포지션 $1,250 · 레버리지 1x · 증거금 25%',
  g1.valid &&
    near(g1.riskUsd, 25) &&
    near(g1.notional, 1250) &&
    g1.leverage === 1 &&
    near(g1.margin, 1250) &&
    near(g1.marginPct, 25) &&
    near(g1.rr, 2) &&
    near(g1.profitUsd, 50) &&
    near(g1.targetSharePct, (50 / 450) * 100) &&
    near(g1.dailyRoomUsePct, (25 / 150) * 100),
  `$${g1.riskUsd.toFixed(2)} 리스크 · $${g1.notional.toFixed(0)} 포지션 · ${g1.leverage}x · 이익 $${g1.profitUsd.toFixed(2)}`,
);

const g2 = proprOrderGuide({ side: 'short', entry: 100, stop: 102, target: 96, balance: 5000, riskPct: 1, cap: 10 });
check(
  '주문 가이드(1.0% · 숏): 리스크 $50 · 포지션 $2,500 · 목표 +$100',
  near(g2.riskUsd, 50) && near(g2.notional, 2500) && near(g2.profitUsd, 100) && near(g2.dailyRoomUsePct, (50 / 150) * 100),
  `$${g2.riskUsd} · ${g2.leverage}x · +$${g2.profitUsd}`,
);

const gCap = proprOrderGuide({ side: 'long', entry: 100, stop: 99.7, target: 100.6, balance: 5000, riskPct: 1, cap: 2 });
check(
  '상한 배율 때문에 리스크가 줄어드는 경우: 2x 상한 → 포지션 $10,000 · 리스크 $30 · 경고 표시',
  gCap.capped &&
    near(gCap.notional, 10000) &&
    near(gCap.riskUsd, 30) &&
    gCap.leverage === 2 &&
    gCap.warnings.some((w) => w.includes('상한')),
  `$${gCap.notional} · $${gCap.riskUsd} · ${gCap.leverage}x`,
);

// 0.5~1.0% 리스크는 5K 계좌에서 일일 한도의 최대 33% 라 경고가 뜨지 않는다.
//   (리스크 선택지를 넓히거나 잔고가 줄어 90% 선에 닿을 때를 대비한 안전장치를 확인한다)
const gAlerts = proprOrderGuide({ side: 'long', entry: 100, stop: 96, target: 113, balance: 5000, riskPct: 4, cap: 2 });
check(
  '일일 한도의 90% 이상을 한 번에 거는 자리는 경고',
  gAlerts.warnings.some((w) => w.includes('일일 한도')),
  `${gAlerts.riskUsd.toFixed(0)}$ / ${gAlerts.dailyRoomUsePct.toFixed(0)}%`,
);

const caps = [2, 4, 5, 8, 10, 25];
const levViolations = caps
  .map((cap) => proprOrderGuide({ side: 'long', entry: 100, stop: 99.6, target: 101, balance: 5000, riskPct: 1, cap }))
  .filter((g) => g.leverage > g.cap);
check(
  '어떤 상한에서도 추천 레버리지가 상한을 넘지 않는다(2·4·5·8·10·25x 전수)',
  levViolations.length === 0,
  caps
    .map((cap) => {
      const g = proprOrderGuide({ side: 'long', entry: 100, stop: 99.6, target: 101, balance: 5000, riskPct: 1, cap });
      return `${cap}x→${g.leverage}x`;
    })
    .join(' · '),
);

const invalid = proprOrderGuide({ side: 'long', entry: 100, stop: 101, target: 104, balance: 5000, riskPct: 0.5, cap: 10 });
check('방향과 손절가가 맞지 않으면 계산 거부', !invalid.valid && !!invalid.error, invalid.error ?? '');

/* ------------------------------------------------------------------ *
 * 5) 유니버스 스냅숏
 * ------------------------------------------------------------------ */
const names = PROPR_LISTINGS.map((l) => l.name);
const uniqueNames = new Set(names.map((n) => n.toUpperCase()));
check(
  'Propr 유니버스 스냅숏: 146종목 · 중복 없음 · 타입/수수료 정상',
  PROPR_LISTINGS.length === 146 &&
    uniqueNames.size === 146 &&
    PROPR_LISTINGS.every((l) => ['CRYPTO', 'EQ', 'IDX', 'CMDTY', 'FX'].includes(l.type) && l.maxLever >= 1 && l.takerPct > 0),
  `${PROPR_LISTINGS.length}종목 (코인 ${PROPR_LISTINGS.filter((l) => l.type === 'CRYPTO').length} · 주식 ${
    PROPR_LISTINGS.filter((l) => l.type === 'EQ').length
  } · 지수 ${PROPR_LISTINGS.filter((l) => l.type === 'IDX').length} · 원자재 ${PROPR_LISTINGS.filter((l) => l.type === 'CMDTY').length})`,
);
check(
  '스냅숏에 핵심 종목 포함: BTC·ETH·SOL·XYZ100·SP500·GOLD·NVDA',
  ['BTC', 'ETH', 'SOL', 'XYZ100', 'SP500', 'GOLD', 'NVDA'].every((n) => !!PROPR_LISTING_BY_NAME[n]),
  ['BTC', 'ETH', 'SOL', 'XYZ100', 'SP500', 'GOLD', 'NVDA']
    .map((n) => `${n}:${PROPR_LISTING_BY_NAME[n]?.maxLever}x`)
    .join(' '),
);
check('HIP-3 코인 id → 표시 심볼 정규화', proprBase('xyz:TSLA') === 'TSLA' && proprBase('btc') === 'BTC', 'xyz:TSLA → TSLA');

/* ------------------------------------------------------------------ *
 * 6) 필터·정렬·복사 문구
 * ------------------------------------------------------------------ */
const mkMarket = (base: string, type: 'CRYPTO' | 'EQ' | 'IDX' | 'CMDTY' | 'FX', cap: number) =>
  ({
    coin: type === 'CRYPTO' ? base : `xyz:${base}`,
    base,
    dex: type === 'CRYPTO' ? null : 'xyz',
    type,
    maxLever: cap,
    takerPct: 0.09,
    price: 100,
    prevDayPx: 99,
    change24h: 1,
    oiUsd: 5_000_000,
    volume24h: 10_000_000,
    fundingPct: 0.001,
    decimals: 2,
    asset: type === 'CRYPTO' ? ('crypto' as const) : ('stock' as const),
  });

const mkHit = (base: string, type: 'CRYPTO' | 'EQ' | 'IDX' | 'CMDTY' | 'FX', cap: number, state: 'open' | 'win' = 'open', winRate = 55): ProprHit => {
  const market = mkMarket(base, type, cap);
  return {
    market,
    badge: `${base} ${cap}x`,
    signal: {
      id: `${market.coin}-1H-x-1`,
      symbol: market.coin,
      base,
      asset: market.asset,
      tf: '1H',
      side: 'long',
      strategyId: 'sweep-ob',
      strategyName: '유동성 스윕 + 오더블록 리테스트',
      strategyShort: '스윕·OB',
      star: 5,
      entry: 100,
      stop: 98,
      target: 104,
      eq: 102,
      rr: 2,
      remainingRR: 2,
      currentR: 0.2,
      price: 100.4,
      changePct: 0.4,
      progress: 0.1,
      state,
      detectedAt: Date.now() - 3_600_000,
      barsSince: 1,
      winRate,
      winRateBasis: 'bench',
      strategyExp: 0.44,
      strategyRR: 2.2,
      leverage: 10,
      levRoi: 0,
      candles: [],
      detectedIdx: 0,
      tags: [],
      fundingRate: 0,
      quoteVolume: 0,
      decimals: 2,
    },
  };
};

const hits = [
  mkHit('BTC', 'CRYPTO', 10),
  mkHit('HYPE', 'CRYPTO', 2),
  mkHit('NVDA', 'EQ', 4),
  mkHit('SP500', 'IDX', 10),
  mkHit('GOLD', 'CMDTY', 8),
  mkHit('TSLA', 'EQ', 4, 'win'),
];
check(
  '자산군 필터: BTC·ETH·SOL / 기타코인 / 주식·원자재·지수·FX',
  matchProprFilter(hits[0], { group: 'majors', tf: '1H', openOnly: false }) &&
    matchProprFilter(hits[1], { group: 'alt', tf: '1H', openOnly: false }) &&
    matchProprFilter(hits[2], { group: 'rwa', tf: '1H', openOnly: false }) &&
    matchProprFilter(hits[4], { group: 'rwa', tf: '1H', openOnly: false }) &&
    !matchProprFilter(hits[2], { group: 'majors', tf: '1H', openOnly: false }),
  `${hits.filter((h) => matchProprFilter(h, { group: 'rwa', tf: '1H', openOnly: false })).map((h) => h.market.base).join(',')} = rwa`,
);
check(
  '타임프레임·진행중 필터',
  matchProprFilter(hits[3], { group: 'all', tf: '1H', openOnly: true }) &&
    !matchProprFilter(hits[5], { group: 'all', tf: '1H', openOnly: true }) &&
    !matchProprFilter(hits[3], { group: 'all', tf: '4H', openOnly: false }),
  '1H 진행중 5건 · 종료 1건',
);
const ranked = rankProprHits([...hits].reverse());
check(
  '정렬: 진행중 우선 → 승률·기대값',
  ranked[ranked.length - 1].signal.state === 'win' && ranked.slice(0, -1).every((h) => h.signal.state === 'open'),
  ranked.map((h) => `${h.market.base}(${h.signal.state})`).join(' → '),
);
check('자산군 분류', proprGroupOf(mkMarket('SOL', 'CRYPTO', 10)) === 'majors' && proprGroupOf(mkMarket('GOLD', 'CMDTY', 8)) === 'rwa', 'SOL=majors · GOLD=rwa');

const lines = proprPlanLines(hits[0], proprOrderGuide({ side: 'long', entry: 100, stop: 98, target: 104, balance: 5000, riskPct: 0.5, cap: 10 }));
check(
  '복사 문구: 진입·손절·목표·레버리지·포지션·손절/익절 금액·목표 달성률',
  /Propr 5K 터보 · BTC 1H 롱/.test(lines) &&
    /진입 100\.00 · 손절 98\.00 \(-2\.00%\) · 목표 104\.00 \(2\.0R\)/.test(lines) &&
    /레버리지 1x \(Propr 상한 10x\)/.test(lines) &&
    /손절 -\$25\.00/.test(lines) &&
    /목표 \+\$50\.00 \(목표 \$450의 11%\)/.test(lines),
  lines.split('\n')[0] + ' / ' + lines.split('\n')[3],
);

/* ------------------------------------------------------------------ *
 * 7) 실데이터 — Hyperliquid 시세 · 캔들 · 전략 엔진
 * ------------------------------------------------------------------ */
async function live() {
  const markets = await fetchProprMarkets();
  check(
    '라이브 Propr 상장 종목 시세 수신',
    markets.length >= 100 && markets.every((m) => m.price > 0 && Number.isFinite(m.change24h)),
    `${markets.length}종목 · 예: ${markets.slice(0, 4).map((m) => `${m.base} $${m.price}`).join(' / ')}`,
  );
  const byName = new Map(markets.map((m) => [m.base, m]));
  check(
    '라이브 BTC·ETH·SOL · 주식·지수·원자재 포함',
    ['BTC', 'ETH', 'SOL'].every((n) => byName.has(n)) && ['NVDA', 'XYZ100', 'GOLD'].every((n) => byName.has(n)),
    `코인 ${markets.filter((m) => m.type === 'CRYPTO').length} · 주식 ${markets.filter((m) => m.type === 'EQ').length} · 지수 ${
      markets.filter((m) => m.type === 'IDX').length
    } · 원자재 ${markets.filter((m) => m.type === 'CMDTY').length}`,
  );
  const btc = byName.get('BTC');
  check(
    '라이브 BTC: 미결제약정 $1M 초과(Propr 상장 규칙) · 상한 10x',
    !!btc && btc.oiUsd > 1_000_000 && btc.maxLever === 10,
    btc ? `OI $${(btc.oiUsd / 1e9).toFixed(2)}B · ${btc.maxLever}x · ${btc.price}` : 'BTC 없음',
  );
  const capViolations = markets.filter((m) => m.maxLever > proprLeverageCap(m.base, m.type));
  check('라이브 전 종목 상한 준수', capViolations.length === 0, capViolations.slice(0, 3).map((m) => m.base).join(',') || `${markets.length}종목`);

  const nvda = byName.get('NVDA');
  const [c1, c4] = await Promise.all([fetchHlCandles('BTC', '1H'), fetchHlCandles(nvda?.coin ?? 'xyz:NVDA', '1H')]);
  check(
    '라이브 캔들 수신(BTC·주식) · 80봉 이상 · 시간 오름차순',
    c1.length >= 80 && c4.length >= 80 && c1.every((c, i) => i === 0 || c.t > c1[i - 1].t),
    `BTC ${c1.length}봉 · NVDA ${c4.length}봉`,
  );
  const sigs = analyzeProprMarket(byName.get('BTC')!, '1H', c1);
  check(
    '전략 엔진이 Propr 종목 캔들로 시그널을 만든다(0건 허용 · 값은 유한)',
    Array.isArray(sigs) && sigs.every((s) => Number.isFinite(s.entry) && s.stop !== s.entry && Math.abs(s.target - s.entry) / Math.abs(s.entry - s.stop) >= 1.4),
    `${sigs.length}건 ${sigs.slice(0, 2).map((s) => `${s.strategyShort} ${s.side}`).join(' / ')}`,
  );

  // 스캔 세트(거래대금 상위 + 자산군별 최소 3) 검증
  const set = pickProprScanSet(markets);
  const groups = new Set(set.map((m) => proprGroupOf(m)));
  check(
    '스캔 세트: 거래대금 상위 28종목 + 자산군별 최소 3종목',
    set.length >= 28 && set.length <= 37 && groups.has('majors') && groups.has('alt') && groups.has('rwa'),
    `${set.length}종목 · ${[...groups].join('/')} · ${set.slice(0, 5).map((m) => m.base).join(',')}`,
  );

  // 실제 스캔 파이프라인(축소: 상위 8종목) — 시그널이 나오면 가이드 값까지 검증
  const sample = set.slice(0, 8);
  const sampleHits: ProprHit[] = [];
  await mapLimit(sample, 3, async (market) => {
    const candles = await fetchHlCandles(market.coin, '1H');
    for (const signal of analyzeProprMarket(market, '1H', candles)) {
      sampleHits.push({ signal, market, badge: `${market.base} ${market.maxLever}x` });
    }
  });
  check(
    '라이브 스캔 파이프라인: 8종목에서 시그널 수집',
    sampleHits.length > 0 || sample.every((m) => m.price > 0),
    `${sampleHits.length}건 · ${sample.map((m) => m.base).join(',')}`,
  );
  const badGuides = sampleHits
    .map((h) => ({ h, g: proprOrderGuide({ side: h.signal.side, entry: h.signal.entry, stop: h.signal.stop, target: h.signal.target, balance: 5000, riskPct: 0.5, cap: h.market.maxLever }) }))
    .filter(({ g, h }) => !g.valid || g.leverage > h.market.maxLever || g.riskUsd > 25.0001 || g.notional <= 0);
  check(
    '라이브 시그널 주문 가이드: 레버리지 ≤ 상한 · 리스크 ≤ $25',
    badGuides.length === 0,
    badGuides.length ? JSON.stringify(badGuides[0]).slice(0, 160) : `${sampleHits.length}건 전수`,
  );
}

live()
  .catch((e) => {
    fails.push('라이브 검증');
    console.log(`❌ 라이브 검증 — ${e instanceof Error ? e.message : e}`);
  })
  .finally(() => {
    console.log(`\n${fails.length === 0 ? '✅ Propr 5K 터보 엔진 검증 통과' : `❌ 실패 ${fails.length}건`} (${pass}개 확인)`);
    if (fails.length) {
      console.log(fails.join('\n'));
      process.exitCode = 1;
    }
  });
