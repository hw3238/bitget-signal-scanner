/**
 * 🐋 고래 체결 테이프 · 📰 실시간 코인 뉴스 단위 검증 (실행: npm run check:realtime)
 *
 *  1) 고래 테이프: 분할 체결 묶기(2초 창) · 금액/방향/검색 필터 · 순매수 집계 · 금액 표기 · 시각(KST)
 *  2) 거래소 파서: 비트겟 fills(REST·WS 공통) / 바이낸스 aggTrade(메이커 방향 반전) → 달러 금액
 *  3) 종목 선정: 코인만 · 거래대금 상위 15 · 스캔 전에는 기본 목록
 *  4) 뉴스: rss2json 응답 파싱(UTC 시각) · HTML 제거 · 코인/호재/악재/거시 태깅 · 필터 · 중복·정렬
 *  5) **실제 API 스모크**: 비트겟 체결 REST · 바이낸스 체결 REST(선물→현물 폴백) · rss2json 2개 피드
 */
import type { Contract, Ticker } from '../src/engine/types';
import {
  absorbTrade,
  filterWhaleRows,
  fmtTapeTime,
  fmtUsdShort,
  HUGE_WHALE_USD,
  summarizeWhales,
  sweepKey,
  thresholdLabel,
  DEFAULT_WHALE_THRESHOLD,
  type WhaleTrade,
} from '../src/engine/whaleTape';
import {
  BINANCE_WHALE_STREAMS,
  baseOf,
  fetchBinanceRecentAggTrades,
  fetchBitgetRecentFills,
  FALLBACK_WHALE_SYMBOLS,
  parseBinanceAggTrade,
  parseBitgetFill,
  pickWhaleSymbols,
} from '../src/api/whaleTape';
import {
  filterNews,
  mergeNews,
  newsAge,
  NEWS_SOURCES,
  parseFeedDate,
  parseRss2Json,
  plainText,
  tagNews,
  type NewsItem,
} from '../src/api/cryptoNews';

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
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ *
 * 1) 고래 테이프 계산
 * ------------------------------------------------------------------ */
const trade = (patch: Partial<WhaleTrade>): WhaleTrade => ({
  id: patch.id ?? 't1',
  symbol: patch.symbol ?? 'BTCUSDT',
  base: patch.base ?? 'BTC',
  side: patch.side ?? 'buy',
  price: patch.price ?? 60_000,
  usd: patch.usd ?? 100_000,
  at: patch.at ?? 1_700_000_000_000,
  fills: patch.fills ?? 1,
});

check('금액 표기 — $142K', fmtUsdShort(142_000) === '$142K', fmtUsdShort(142_000));
check('금액 표기 — $1.2M', fmtUsdShort(1_200_000) === '$1.2M', fmtUsdShort(1_200_000));
check('금액 표기 — $2.5B', fmtUsdShort(2_500_000_000) === '$2.5B', fmtUsdShort(2_500_000_000));
check('금액 표기 — 소액', fmtUsdShort(999) === '$999' && fmtUsdShort(0) === '$0', `${fmtUsdShort(999)} / ${fmtUsdShort(0)}`);
check('기준 라벨', thresholdLabel(50_000) === '$50K+' && thresholdLabel(500_000) === '$500K+');
check('기본 기준은 $50K(실측 밀도 근거)', DEFAULT_WHALE_THRESHOLD === 50_000);

const t0 = Date.UTC(2026, 10, 27, 8, 4, 39);
check('테이프 시각 = KST HH:MM:SS', fmtTapeTime(t0) === '17:04:39', fmtTapeTime(t0));
check('잘못된 시각 표기', fmtTapeTime(0) === '--:--:--', fmtTapeTime(0));

check('묶음 키 = 심볼|방향', sweepKey({ symbol: 'ETHUSDT', side: 'sell' }) === 'ETHUSDT|sell');

// 분할 체결 묶기 — 같은 코인·같은 방향 2초 창
const a1 = trade({ id: 'a1', usd: 80_000, at: 1_000, price: 60_000 });
const a2 = trade({ id: 'a2', usd: 70_000, at: 2_200, price: 60_050 });
const merged = absorbTrade(a1, a2);
check('2초 안 같은 방향 → 한 줄로 합침', merged.fresh === false && merged.sweep.usd === 150_000, `${merged.sweep.usd}`);
check('묶음은 첫 id 유지(행이 새로 생기지 않음)', merged.sweep.id === 'a1', merged.sweep.id);
check('묶음 가격·시각·건수는 최신', merged.sweep.price === 60_050 && merged.sweep.at === 2_200 && merged.sweep.fills === 2);
const a3 = trade({ id: 'a3', usd: 10_000, at: 4_500 });
check('2초를 넘으면 새 줄', absorbTrade(merged.sweep, a3).fresh === true);
check('방향이 다르면 새 줄', absorbTrade(a1, trade({ side: 'sell', at: 1_200 })).fresh === true);
check('코인이 다르면 새 줄', absorbTrade(a1, trade({ symbol: 'ETHUSDT', base: 'ETH', at: 1_200 })).fresh === true);
check('경계(정확히 2초)는 합침', absorbTrade(trade({ at: 1_000 }), trade({ at: 3_000 })).fresh === false);

// 필터
const rows = [
  trade({ id: '1', base: 'BTC', usd: 600_000, at: 5_000, side: 'buy' }),
  trade({ id: '2', base: 'ETH', symbol: 'ETHUSDT', usd: 120_000, at: 4_000, side: 'sell' }),
  trade({ id: '3', base: 'SOL', symbol: 'SOLUSDT', usd: 55_000, at: 3_000, side: 'buy' }),
  trade({ id: '4', base: 'XRP', symbol: 'XRPUSDT', usd: 49_999, at: 2_000, side: 'sell' }),
];
check('금액 필터(이상)', filterWhaleRows(rows, { minUsd: 50_000, side: 'all', query: '' }).length === 3);
check('$100K 필터', filterWhaleRows(rows, { minUsd: 100_000, side: 'all', query: '' }).length === 2);
check('방향 필터', filterWhaleRows(rows, { minUsd: 50_000, side: 'sell', query: '' }).map((r) => r.base).join() === 'ETH');
check('검색(소문자)', filterWhaleRows(rows, { minUsd: 50_000, side: 'all', query: 'btc' }).map((r) => r.base).join() === 'BTC');
check('검색(공백)', filterWhaleRows(rows, { minUsd: 50_000, side: 'all', query: '   ' }).length === 3);

// 순매수 집계
const summary = summarizeWhales(rows);
check('매수/매도 합계', summary.buyUsd === 655_000 && summary.sellUsd === 169_999, `${summary.buyUsd}/${summary.sellUsd}`);
check('매수 비중', Math.abs(summary.buyRatio - 655_000 / 824_999) < 1e-9, summary.buyRatio.toFixed(4));
check('TOP3 = 총액 순', summary.top.map((c) => c.base).join() === 'BTC,ETH,SOL', summary.top.map((c) => c.base).join());
check('코인별 순매수 방향', summary.top[1].netUsd === -120_000 && summary.top[0].netUsd === 600_000);
check('초대형(50만달러) 건수', summary.huge === 1 && HUGE_WHALE_USD === 500_000, `${summary.huge}`);
check('관측 시작 시각', summary.since === 2_000, String(summary.since));
check('빈 입력은 중립 비율', summarizeWhales([]).buyRatio === 0.5 && summarizeWhales([]).top.length === 0);

/* ------------------------------------------------------------------ *
 * 2) 거래소 파서
 * ------------------------------------------------------------------ */
const bgFill = parseBitgetFill(
  { tradeId: '1510', price: '60100.5', size: '2', side: 'sell', ts: '1795767552083' },
  'BTCUSDT',
);
check(
  '비트겟 체결 파싱',
  !!bgFill && bgFill.side === 'sell' && bgFill.usd === 120_201 && bgFill.base === 'BTC' && bgFill.id === 'bg:1510',
  bgFill ? `${bgFill.side} $${bgFill.usd}` : 'null',
);
check('비트겟 잘못된 값은 버림', parseBitgetFill({ price: '0', size: '1', ts: '1' }, 'BTCUSDT') === null);
check('비트겟 side 누락은 매수', parseBitgetFill({ price: '10', size: '1', ts: '1' }, 'SUIUSDT')?.side === 'buy');

const bnBuy = parseBinanceAggTrade({ a: 11, p: '2500', q: '60', T: 1_700_000_000_000, m: false }, 'ETHUSDT');
const bnSell = parseBinanceAggTrade({ a: 12, p: '2500', q: '60', T: 1_700_000_000_000, m: true }, 'ETHUSDT');
check('바이낸스 매수 체결(m=false)', bnBuy?.side === 'buy' && bnBuy?.usd === 150_000, `${bnBuy?.side} $${bnBuy?.usd}`);
check('바이낸스 메이커 매수 → 공격자는 매도(m=true)', bnSell?.side === 'sell', String(bnSell?.side));
check('바이낸스 체결 id 고유', bnBuy?.id === 'bn:ETHUSDT:11', String(bnBuy?.id));
check('심볼 → 코인 이름', baseOf('BTCUSDT') === 'BTC' && baseOf('DOGEUSDT') === 'DOGE');

/* ------------------------------------------------------------------ *
 * 3) 종목 선정
 * ------------------------------------------------------------------ */
const mkContract = (symbol: string, asset: Contract['asset']): Contract => ({
  symbol,
  base: baseOf(symbol),
  asset,
  isRwa: asset === 'stock',
});
const contracts: Contract[] = [
  mkContract('BTCUSDT', 'crypto'),
  mkContract('ETHUSDT', 'crypto'),
  mkContract('SOLUSDT', 'crypto'),
  mkContract('SUIUSDT', 'crypto'),
  mkContract('NVDAUSDT', 'stock'),
  mkContract('XAUUSDT', 'metal'),
];
const tickers: Ticker[] = [
  { symbol: 'BTCUSDT', last: 60_000, change24h: 1, quoteVolume: 2_000_000_000, fundingRate: 0, high24h: 0, low24h: 0 },
  { symbol: 'ETHUSDT', last: 2_500, change24h: 1, quoteVolume: 900_000_000, fundingRate: 0, high24h: 0, low24h: 0 },
  { symbol: 'NVDAUSDT', last: 180, change24h: 1, quoteVolume: 800_000_000, fundingRate: 0, high24h: 0, low24h: 0 },
  { symbol: 'SOLUSDT', last: 150, change24h: 1, quoteVolume: 300_000_000, fundingRate: 0, high24h: 0, low24h: 0 },
  { symbol: 'SUIUSDT', last: 0.7, change24h: 1, quoteVolume: 100_000_000, fundingRate: 0, high24h: 0, low24h: 0 },
];
const picked = pickWhaleSymbols(contracts, tickers);
check('종목 선정: 코인만·거래대금 순', picked.join(',') === 'BTCUSDT,ETHUSDT,SOLUSDT,SUIUSDT', picked.join(','));
check('종목 선정: 주식선물 제외', !picked.includes('NVDAUSDT') && !picked.includes('XAUUSDT'));
const many = Array.from({ length: 40 }, (_, i) => mkContract(`C${i}USDT`, 'crypto'));
const manyTickers = many.map((c, i) => ({
  symbol: c.symbol,
  last: 1,
  change24h: 0,
  quoteVolume: 1_000 - i,
  fundingRate: 0,
  high24h: 0,
  low24h: 0,
}));
check('종목 선정: 15개 상한', pickWhaleSymbols(many, manyTickers).length === 15);
check('종목 선정: 스캔 전에는 기본 목록', eq(pickWhaleSymbols([], []), FALLBACK_WHALE_SYMBOLS));
check('기본 목록에 대표 코인 포함', ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT'].every((s) => FALLBACK_WHALE_SYMBOLS.includes(s)));
check(
  '바이낸스 스트림 폴백 순서(선물 → 거래소 → 데이터 전용)',
  BINANCE_WHALE_STREAMS[0].url.startsWith('wss://fstream.binance.com') &&
    BINANCE_WHALE_STREAMS[1].url.startsWith('wss://stream.binance.com:9443') &&
    BINANCE_WHALE_STREAMS[2].url.startsWith('wss://data-stream.binance.vision'),
  BINANCE_WHALE_STREAMS.map((s) => s.url.split('/')[2]).join(' → '),
);

/* ------------------------------------------------------------------ *
 * 4) 뉴스 파싱·태깅
 * ------------------------------------------------------------------ */
check('피드 시각 = UTC 해석', parseFeedDate('2026-11-27 08:04:39') === Date.UTC(2026, 10, 27, 8, 4, 39));
check('RFC 시각도 해석', parseFeedDate('Fri, 27 Nov 2026 08:04:39 +0000') === Date.UTC(2026, 10, 27, 8, 4, 39));
check('빈 시각은 0', parseFeedDate(undefined) === 0);

const html = '<p>비트코인 <b>현물 ETF</b>가 승인됐다 &amp; 기관 자금 유입</p>';
check(
  'HTML 제거',
  plainText(html) === '비트코인 현물 ETF가 승인됐다 & 기관 자금 유입',
  plainText(html),
);
check('요약 길이 제한', plainText('<p>' + '가'.repeat(200) + '</p>', 20).length === 20);

const good = tagNews('비트코인 현물 ETF 승인… 기관 자금 유입 급증');
check('호재 태깅 + 코인', good.tone === 'good' && good.coins.includes('BTC'), `${good.tone} ${good.coins.join(',')}`);
check('배지 근거 키워드', good.hits.includes('ETF') && good.hits.includes('승인'), good.hits.join(','));
const bad = tagNews('이더리움 브리지 해킹… 4억달러 유출·청산');
check('악재 태깅 + 코인', bad.tone === 'bad' && bad.coins.includes('ETH'), `${bad.tone} ${bad.coins.join(',')}`);
const macro = tagNews('FOMC 앞두고 금리 동결 전망, CPI 발표 대기');
check('거시 태깅', macro.macro === true, String(macro.macro));
const neutral = tagNews('코인 시장 주간 리뷰');
check('애매한 기사는 중립(배지 없음)', neutral.tone === 'neutral' && neutral.coins.length === 0, neutral.tone);
const tickerOnly = tagNews('SOL·XRP 동반 강세, DOGE는 보합');
check('티커만 있어도 코인 추출', ['SOL', 'XRP', 'DOGE'].every((c) => tickerOnly.coins.includes(c)), tickerOnly.coins.join(','));
const enGood = tagNews('Bitcoin ETF inflows hit record as SOL rallies');
check(
  '영문 호재 태깅(어간 일치)',
  enGood.tone === 'good' && enGood.coins.includes('BTC') && enGood.coins.includes('SOL'),
  `${enGood.tone} ${enGood.coins.join(',')} · ${enGood.hits.join(',')}`,
);
const enBad = tagNews('Exchange faces probe over custody rules');
check('영문 악재 태깅(probe)', enBad.tone === 'bad', `${enBad.tone} · ${enBad.hits.join(',')}`);
const enMacro = tagNews('Fed holds rates as CPI cools');
check('영문 거시 태깅', enMacro.macro === true, String(enMacro.macro));
const noFalseCoin = tagNews('solution provider link analysis');
check('영문 일반 단어는 코인으로 오인하지 않음', noFalseCoin.coins.length === 0, noFalseCoin.coins.join(','));

const source = NEWS_SOURCES[0];
const payload = {
  status: 'ok',
  items: [
    {
      title: '비트코인 6만1000달러 회복',
      link: 'https://example.com/a',
      guid: 'g-a',
      pubDate: '2026-11-27 05:21:59',
      description: '<p>AI株 반등에 위험자산 훈풍</p>',
    },
    { title: '링크 없음', link: '', pubDate: '2026-11-27 05:00:00' },
    { title: '', link: 'https://example.com/b', pubDate: '2026-11-27 04:00:00' },
  ],
};
const parsed = parseRss2Json(payload, source);
check('rss2json 파싱 — 유효 기사만', parsed.length === 1 && parsed[0].id === 'g-a', `${parsed.length}건`);
check(
  'rss2json 파싱 — 출처·언어·시각',
  parsed[0].source === source.name && parsed[0].lang === 'ko' && parsed[0].at === Date.UTC(2026, 10, 27, 5, 21, 59),
  `${parsed[0].source}/${parsed[0].lang}`,
);
check('rss2json 파싱 — 요약 HTML 제거', parsed[0].summary === 'AI株 반등에 위험자산 훈풍', parsed[0].summary);
let threw = false;
try {
  parseRss2Json({ status: 'error', message: 'bad feed' }, source);
} catch {
  threw = true;
}
check('rss2json 오류 응답은 예외', threw);

const newsItem = (patch: Partial<NewsItem>): NewsItem => ({
  id: patch.id ?? 'n1',
  title: patch.title ?? 'title',
  link: patch.link ?? 'https://example.com/1',
  source: patch.source ?? '블록미디어',
  sourceId: patch.sourceId ?? 'blockmedia',
  lang: patch.lang ?? 'ko',
  at: patch.at ?? 1_700_000_000_000,
  summary: patch.summary ?? 'summary',
  coins: patch.coins ?? ['BTC'],
  tone: patch.tone ?? 'neutral',
  macro: patch.macro ?? false,
  hits: patch.hits ?? [],
});
const listA = [newsItem({ id: 'n1', at: 1_000 }), newsItem({ id: 'n2', at: 3_000, lang: 'en', tone: 'good' })];
const listB = [newsItem({ id: 'n1', at: 2_000 }), newsItem({ id: 'n3', at: 4_000, lang: 'en', tone: 'bad' })];
const mergedNews = mergeNews(listA, listB);
check('뉴스 중복 제거', mergedNews.length === 3, `${mergedNews.length}건`);
check('뉴스 최신순 정렬', mergedNews.map((n) => n.id).join() === 'n3,n2,n1', mergedNews.map((n) => n.id).join());
check('같은 기사는 최신 시각 유지', mergedNews.find((n) => n.id === 'n1')?.at === 2_000);
check('필터 전체', filterNews(mergedNews, 'all').length === 3);
check('필터 한국', filterNews(mergedNews, 'kr').map((n) => n.id).join() === 'n1');
check('필터 글로벌', filterNews(mergedNews, 'global').map((n) => n.id).join() === 'n3,n2');
check('필터 호재·악재(중립 제외)', filterNews(mergedNews, 'signal').map((n) => n.id).join() === 'n3,n2');
check('뉴스 검색', filterNews(mergedNews, 'all', 'tit').length === 3 && filterNews(mergedNews, 'all', 'BTC').length === 3);
check('상대 시간 표기', newsAge(1_000_000, 1_000_000 + 30_000) === '방금' && newsAge(0, 10) === '');
const nowAt = 1_800_000_000_000;
check(
  '상대 시간 — 분/시간/일',
  newsAge(nowAt - 3 * 60_000, nowAt) === '3분 전' &&
    newsAge(nowAt - 2 * 3_600_000, nowAt) === '2시간 전' &&
    newsAge(nowAt - 3 * 86_400_000, nowAt) === '3일 전',
  `${newsAge(nowAt - 3 * 60_000, nowAt)} / ${newsAge(nowAt - 2 * 3_600_000, nowAt)}`,
);
check(
  '피드 구성 — 한국 2 + 글로벌 2',
  NEWS_SOURCES.length === 4 &&
    NEWS_SOURCES.filter((s) => s.lang === 'ko').length === 2 &&
    NEWS_SOURCES.filter((s) => s.lang === 'en').length === 2,
  NEWS_SOURCES.map((s) => `${s.name}(${s.lang})`).join(' · '),
);

/* ------------------------------------------------------------------ *
 * 5) 실제 API 스모크 (가짜 데이터 없음)
 * ------------------------------------------------------------------ */
async function live() {
  const fills = await fetchBitgetRecentFills('BTCUSDT', 50);
  check('라이브 비트겟 체결 REST', fills.length >= 10 && fills.every((f) => f.usd > 0), `${fills.length}건 · 최근 $${Math.round(fills[0]?.usd ?? 0)}`);
  const biggest = fills.reduce((m, f) => Math.max(m, f.usd), 0);
  check('라이브 비트겟 체결 시각 최신', Date.now() - Math.max(...fills.map((f) => f.at)) < 5 * 60_000, `최대 $${Math.round(biggest)}`);

  const binance = await fetchBinanceRecentAggTrades('BTCUSDT', 50);
  check('라이브 바이낸스 체결 REST(선물→현물 폴백)', binance.length >= 10 && binance.every((f) => f.usd > 0), `${binance.length}건`);
  check(
    '라이브 바이낸스 체결에 매수·매도 모두',
    binance.some((f) => f.side === 'buy') && binance.some((f) => f.side === 'sell'),
    binance.slice(0, 20).filter((f) => f.side === 'buy').length + '/20 매수',
  );

  for (const src of [NEWS_SOURCES[0], NEWS_SOURCES[2]]) {
    const rss = await fetch(
      `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(src.rss)}&count=10`,
      { headers: { accept: 'application/json' } },
    ).catch(() => null);
    const ok = rss?.ok ?? false;
    const body = ok ? ((await rss!.json()) as Parameters<typeof parseRss2Json>[0]) : null;
    let items: NewsItem[] = [];
    try {
      items = body ? parseRss2Json(body, src) : [];
    } catch {
      items = [];
    }
    check(
      `라이브 뉴스 피드 ${src.name}`,
      ok && items.length >= 5,
      `${rss?.status ?? 'no-response'} · ${items.length}건 · ${items[0]?.title?.slice(0, 24) ?? '-'}`,
    );
    if (items[0]) {
      check(
        `라이브 뉴스 태깅 ${src.name}`,
        Number.isFinite(items[0].at) && items[0].at > Date.now() - 10 * 86_400_000,
        `${new Date(items[0].at).toISOString()} · ${items[0].tone} · ${items[0].coins.join(',') || '-'}`,
      );
    }
  }
}

live()
  .catch((e) => {
    fails.push('라이브 스모크');
    console.log(`❌ 라이브 스모크 — ${e instanceof Error ? e.message : e}`);
  })
  .finally(() => {
    console.log(`\n${fails.length === 0 ? '✅ 실시간 기능 검증 통과' : `❌ 실패 ${fails.length}건`} (${pass}개 확인)`);
    if (fails.length) {
      console.log(fails.join('\n'));
      process.exitCode = 1;
    }
  });
