/**
 * 📰 실시간 코인 뉴스 — 공개 RSS 피드
 *
 * 브라우저·APK WebView 에서 **CORS 를 통과해 HTTP 200 으로 열리는 경로만** 쓴다.
 *  · 뉴스사 RSS 원본은 `Access-Control-Allow-Origin` 이 없어 직접 못 읽는다(실측).
 *    그래서 CORS 를 열어 주는 RSS→JSON 게이트웨이(`api.rss2json.com`, Origin 별 허용 확인)를 거친다.
 *  · 피드별로 따로 받아 **한 곳이 실패해도 나머지로 화면을 채운다**. 전부 실패하면 화면은 안내 배너다.
 *  · 기사 내용은 원문 그대로(제목·요약)만 쓴다 — 요약을 지어내지 않는다.
 *
 * 2026-11-27 실측 상태
 *  · 블록미디어(한국)     https://www.blockmedia.co.kr/feed                      → 200 · 당일 기사
 *  · 블록체인투데이(한국) https://www.blockchaintoday.co.kr/rss/allArticle.xml    → 200 · 1~2일 전
 *  · Cointelegraph(글로벌) https://cointelegraph.com/rss                          → 200 · 실시간
 *  · CoinDesk(글로벌)      https://www.coindesk.com/arc/outboundfeeds/rss         → 200 · 실시간
 *  · 토큰포스트 RSS 는 11-21 이후 갱신이 없어 제외(피드가 살아나면 아래 배열에 추가하면 된다).
 */

export type NewsLang = 'ko' | 'en';
export type NewsTone = 'good' | 'bad' | 'neutral';

export interface NewsSourceMeta {
  id: string;
  name: string;
  rss: string;
  lang: NewsLang;
}

export const NEWS_SOURCES: NewsSourceMeta[] = [
  { id: 'blockmedia', name: '블록미디어', rss: 'https://www.blockmedia.co.kr/feed', lang: 'ko' },
  {
    id: 'blockchaintoday',
    name: '블록체인투데이',
    rss: 'https://www.blockchaintoday.co.kr/rss/allArticle.xml',
    lang: 'ko',
  },
  { id: 'cointelegraph', name: 'Cointelegraph', rss: 'https://cointelegraph.com/rss', lang: 'en' },
  { id: 'coindesk', name: 'CoinDesk', rss: 'https://www.coindesk.com/arc/outboundfeeds/rss', lang: 'en' },
];

export interface NewsItem {
  /** guid(없으면 링크) — 중복 제거·React key */
  id: string;
  title: string;
  link: string;
  /** 표시용 출처 이름 */
  source: string;
  sourceId: string;
  lang: NewsLang;
  /** 게시 시각(ms) */
  at: number;
  /** 태그 없는 요약(최대 160자) */
  summary: string;
  /** 본문에서 찾은 코인 티커 */
  coins: string[];
  tone: NewsTone;
  /** 거시 키워드 포함 여부 */
  macro: boolean;
  /** 배지 근거가 된 키워드(최대 4개) */
  hits: string[];
}

export interface NewsFeedResult {
  source: NewsSourceMeta;
  ok: boolean;
  items: NewsItem[];
  error: string | null;
  at: number;
}

/* ---------------- 태깅 사전 ---------------- */

/** 코인 이름 → 티커. 한국어 이름·영문 정식명·티커(대문자)를 함께 본다. */
const COIN_WORDS: Array<{ ticker: string; patterns: RegExp[] }> = [
  { ticker: 'BTC', patterns: [/비트코인/, /bitcoin/i, /\bBTC\b/] },
  { ticker: 'ETH', patterns: [/이더리움/, /ethereum/i, /\bETH\b/] },
  { ticker: 'SOL', patterns: [/솔라나/, /solana/i, /\bSOL\b/] },
  { ticker: 'XRP', patterns: [/리플/, /ripple/i, /\bXRP\b/] },
  { ticker: 'DOGE', patterns: [/도지코인/, /도지/, /dogecoin/i, /\bDOGE\b/] },
  { ticker: 'SUI', patterns: [/수이\s*네트워크/, /\bSUI\b/] },
  { ticker: 'BNB', patterns: [/바이낸스코인/, /\bBNB\b/] },
  { ticker: 'ZEC', patterns: [/지캐시/, /zcash/i, /\bZEC\b/] },
  { ticker: 'ADA', patterns: [/에이다/, /cardano/i, /\bADA\b/] },
  { ticker: 'LINK', patterns: [/체인링크/, /chainlink/i, /\bLINK\b/] },
  { ticker: 'AVAX', patterns: [/아발란체/, /avalanche/i, /\bAVAX\b/] },
  { ticker: 'TON', patterns: [/톤코인/, /toncoin/i, /\bTON\b/] },
  { ticker: 'TRX', patterns: [/트론/, /\bTRX\b/] },
  { ticker: 'LTC', patterns: [/라이트코인/, /litecoin/i, /\bLTC\b/] },
  { ticker: 'BCH', patterns: [/비트코인\s*캐시/, /bitcoin\s*cash/i, /\bBCH\b/] },
  { ticker: 'ENA', patterns: [/에테나/, /ethena/i, /\bENA\b/] },
  { ticker: 'HYPE', patterns: [/하이퍼리퀴드/, /hyperliquid/i, /\bHYPE\b/] },
  { ticker: 'DOT', patterns: [/폴카닷/, /polkadot/i, /\bDOT\b/] },
  { ticker: 'APT', patterns: [/앱토스/, /aptos/i, /\bAPT\b/] },
  { ticker: 'ARB', patterns: [/아비트럼/, /arbitrum/i, /\bARB\b/] },
  { ticker: 'OP', patterns: [/옵티미즘/, /optimism/i, /\bOP\b/] },
  { ticker: 'NEAR', patterns: [/니어\s*프로토콜/, /near\s*protocol/i, /\bNEAR\b/] },
  { ticker: 'ATOM', patterns: [/코스모스/, /\bATOM\b/] },
  { ticker: 'XLM', patterns: [/스텔라루멘/, /stellar/i, /\bXLM\b/] },
  { ticker: 'USDT', patterns: [/테더/, /tether/i, /\bUSDT\b/] },
  { ticker: 'USDC', patterns: [/유에스디코인/, /\bUSDC\b/] },
];

const GOOD_WORDS = [
  'ETF',
  '승인',
  '상장',
  '유입',
  '순매수',
  '랠리',
  '급등',
  '신고가',
  '최고가',
  '반등',
  '상승',
  '호재',
  '파트너십',
  '제휴',
  '협력',
  '투자 유치',
  '블랙록',
  '기관',
  '바이백',
  '소각',
  '스테이킹',
  '출시',
  '확대',
  '수용',
  '면허',
  '허용',
  '돌파',
  // 글로벌 피드(영문) — 어간으로 찾는다(probe → probes)
  'approv',
  'inflow',
  'ransom',
  'rally',
  'surge',
  'record high',
  'all-time high',
  'listing',
  'partnership',
  'adoption',
  'bullish',
  'upgrade',
  'buyback',
  'stake',
  'launch',
];

const BAD_WORDS = [
  '해킹',
  '탈취',
  '청산',
  '급락',
  '하락',
  '폭락',
  '매도',
  '순매도',
  '소송',
  '제소',
  '기소',
  '벌금',
  '과징금',
  '규제',
  '제재',
  '금지',
  '파산',
  '유출',
  '디페깅',
  '사기',
  '스캔들',
  '경고',
  '우려',
  '리스크',
  '압류',
  '몰수',
  '단속',
  '조사',
  '위반',
  '취소',
  '지연',
  '차단',
  '하향',
  // 글로벌 피드(영문)
  'hack',
  'exploit',
  'breach',
  'liquidat',
  'selloff',
  'sell-off',
  'plunge',
  'slump',
  'crash',
  'lawsuit',
  'probe',
  'investigat',
  'fine',
  'penalt',
  'ban ',
  'bankrupt',
  'outflow',
  'delist',
  'bearish',
  'downgrade',
  'warning',
  'fraud',
  'scandal',
  'theft',
  'stolen',
];

const MACRO_WORDS = [
  'FOMC',
  'CPI',
  'PPI',
  '금리',
  '연준',
  'Fed',
  '인플레이션',
  '디플레이션',
  '고용',
  '실업',
  'GDP',
  '관세',
  '환율',
  '국채',
  '재정',
  '경기침체',
  '나스닥',
  'S&P',
  '코스피',
  '일본은행',
  'ECB',
  '기준금리',
  // 글로벌 피드(영문)
  'rate cut',
  'rate hike',
  'inflation',
  'jobs report',
  'unemployment',
  'tariff',
  'recession',
  'treasury',
  'Nasdaq',
  'BOJ',
];

/** HTML 제거 + 공백 정리 + 길이 제한 */
export function plainText(html: string | undefined | null, max = 160): string {
  if (!html) return '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // 문단·줄바꿈은 공백으로, 나머지 인라인 태그는 글자를 붙여 둔다("ETF</b>가" → "ETF가")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export interface NewsTags {
  coins: string[];
  tone: NewsTone;
  macro: boolean;
  hits: string[];
}

/**
 * 제목·본문에서 코인 티커와 호재/악재/거시 키워드를 뽑는다.
 *  · 호재·악재는 **근거 키워드 수**로만 판단하고, 같으면 중립으로 둔다(애매한 기사에 배지를 붙이지 않는다).
 *  · 거시는 별도 배지라 호재·악재와 함께 붙을 수 있다.
 */
/** 키워드 사전의 문자열 → 판정. 영문은 단어 시작 경계만 맞추고 뒤는 어간으로 둔다(probe → probes). */
function hasWord(text: string, word: string): boolean {
  const clean = word.trim();
  if (!clean) return false;
  // 한글·기호 키워드는 부분 일치로 충분하다
  if (!/^[A-Za-z]/.test(clean)) return text.includes(clean);
  const hay = text.toLowerCase();
  const needle = clean.toLowerCase();
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : hay[i - 1];
    if (!/[a-z0-9]/.test(before)) return true;
    from = i + 1;
  }
}

export function tagNews(title: string, body = ''): NewsTags {
  const text = `${title} ${body}`;
  const coins = COIN_WORDS.filter((c) => c.patterns.some((p) => p.test(text))).map((c) => c.ticker);
  const good: string[] = [];
  for (const w of GOOD_WORDS) {
    if (hasWord(text, w)) good.push(w.trim());
  }
  const bad: string[] = [];
  for (const w of BAD_WORDS) {
    if (hasWord(text, w)) bad.push(w.trim());
  }
  const macro = MACRO_WORDS.some((w) => hasWord(text, w));
  const tone: NewsTone = good.length > bad.length ? 'good' : bad.length > good.length ? 'bad' : 'neutral';
  const hits = [...new Set([...coins.slice(0, 2), ...(tone === 'good' ? good : bad).slice(0, 2)])];
  return { coins: coins.slice(0, 4), tone, macro, hits: hits.slice(0, 4) };
}

/* ---------------- RSS → JSON ---------------- */

interface Rss2JsonItem {
  title?: string;
  pubDate?: string;
  link?: string;
  guid?: string;
  description?: string;
  content?: string;
  author?: string;
}

interface Rss2JsonBody {
  status?: string;
  message?: string;
  items?: Rss2JsonItem[];
}

/** `2026-11-27 08:04:39` (rss2json 은 UTC 로 정규화) → ms */
export function parseFeedDate(raw: string | undefined): number {
  if (!raw) return 0;
  const text = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseRss2Json(body: Rss2JsonBody, source: NewsSourceMeta): NewsItem[] {
  if (body.status && body.status !== 'ok') throw new Error(body.message || `피드 오류(${body.status})`);
  const items: NewsItem[] = [];
  for (const row of body.items ?? []) {
    const title = plainText(row.title, 200);
    const link = (row.link ?? row.guid ?? '').trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const summary = plainText(row.content || row.description, 160);
    const tags = tagNews(title, summary);
    items.push({
      id: row.guid?.trim() || link,
      title,
      link,
      source: source.name,
      sourceId: source.id,
      lang: source.lang,
      at: parseFeedDate(row.pubDate),
      summary,
      coins: tags.coins,
      tone: tags.tone,
      macro: tags.macro,
      hits: tags.hits,
    });
  }
  return items;
}

/** 한 피드 받기 — 실패는 던지지 않고 결과에 담는다(나머지 피드로 화면 유지). */
export async function fetchNewsFeed(source: NewsSourceMeta, count = 20, timeoutMs = 14000): Promise<NewsFeedResult> {
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.rss)}&count=${count}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 429) throw new Error('요청 한도 초과(잠시 후 다시 시도)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Rss2JsonBody;
    const items = parseRss2Json(body, source);
    return { source, ok: true, items, error: null, at: Date.now() };
  } catch (err) {
    const message = err instanceof Error ? err.message : '피드를 불러오지 못했습니다';
    return { source, ok: false, items: [], error: message, at: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllNews(count = 20): Promise<NewsFeedResult[]> {
  return Promise.all(NEWS_SOURCES.map((source) => fetchNewsFeed(source, count)));
}

/* ---------------- 목록 합치기·필터 ---------------- */

/** 두 목록을 id(없으면 링크)로 합치고 최신순으로 정렬한다. */
export function mergeNews(...lists: NewsItem[][]): NewsItem[] {
  const byId = new Map<string, NewsItem>();
  for (const list of lists) {
    for (const item of list) {
      const key = item.id || item.link;
      const prev = byId.get(key);
      // 같은 기사라면 더 최신 게시 시각을 쓴다.
      if (!prev || item.at > prev.at) byId.set(key, item);
    }
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

export type NewsFilter = 'all' | 'kr' | 'global' | 'signal';

export const NEWS_FILTERS: Array<{ key: NewsFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'kr', label: '한국 뉴스' },
  { key: 'global', label: '글로벌' },
  { key: 'signal', label: '호재·악재' },
];

export function filterNews(items: NewsItem[], filter: NewsFilter, query = ''): NewsItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'kr' && item.lang !== 'ko') return false;
    if (filter === 'global' && item.lang !== 'en') return false;
    if (filter === 'signal' && item.tone === 'neutral') return false;
    if (!q) return true;
    return `${item.title} ${item.summary} ${item.coins.join(' ')}`.toLowerCase().includes(q);
  });
}

/** `3분 전` · `2시간 전` — 실시간 피드라 상대 시간이 더 유용하다 */
export function newsAge(at: number, now = Date.now()): string {
  if (!at) return '';
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  return `${day}일 전`;
}
