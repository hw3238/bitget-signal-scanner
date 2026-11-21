/**
 * 코인 로고 아이콘 생성기 — public/coin-icons/ + manifest.json
 *
 * 왜 CDN을 바로 쓰지 않고 미리 받아 두는가
 *  · 브라우저가 CDN에서 404를 받으면 콘솔에 "Failed to load resource 404" 가 남는다.
 *    어떤 코인이 어느 CDN에 있는지 미리 알 수 없으므로, 표시 직전 요청은 실패 로그를 만든다.
 *  · 같은 출처의 내장 아이콘은 CORS·캔버스 오염·오프라인 문제가 없고 로딩도 즉시다.
 *  · 다중 소스 체인(OKX → Binance → CoinCap)은 이 스크립트가 생성 시점에 실제 HTTP 200으로 검증해 수행한다.
 *
 * 사용: npm run icons   (배포 스크립트가 빌드 전에 자동 실행)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';

const OUT_DIR = 'public/coin-icons';
const MANIFEST = `${OUT_DIR}/manifest.json`;
const TOP_N = 160; // 거래대금 상위 코인 수 (스캐너 유니버스는 상위 36 + 주력 3종)

/** `1000PEPE`·`1MBABYDOGE` 같은 단위 파생 심볼은 원 코인 로고를 쓴다. */
const UNIT_PREFIX = /^(1000|10000|1M)/;
const KEEP_AS_IS = new Set(['1INCH']);

function iconKeys(base) {
  const clean = base.replace(/\+$/, '').replace(/STOCK$/, '').trim();
  if (!clean) return [];
  if (KEEP_AS_IS.has(clean.toUpperCase())) return [clean.toLowerCase()];
  const keys = [];
  if (UNIT_PREFIX.test(clean)) keys.push(clean.replace(UNIT_PREFIX, '').toLowerCase());
  keys.push(clean.toLowerCase());
  return [...new Set(keys)];
}

const OKX = (k) => `https://www.okx.com/cdn/oksupport/asset/currency/icon/${k}.png`;
const BINANCE = (k) => `https://bin.bnbstatic.com/static/assets/logos/${k.toUpperCase()}.png`;
const COINCAP = (k) => `https://assets.coincap.io/assets/icons/${k}@2x.png`;

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

/** 소스 후보 — OKX(최대 커버리지) → Binance → CoinCap */
function candidates(base) {
  const keys = iconKeys(base);
  const list = [];
  for (const k of keys) list.push({ name: 'okx', url: OKX(k) });
  for (const k of keys) list.push({ name: 'binance', url: BINANCE(k) });
  for (const k of keys) list.push({ name: 'coincap', url: COINCAP(k) });
  return list;
}

async function download(base) {
  for (const cand of candidates(base)) {
    try {
      const res = await fetch(cand.url, {
        headers: { 'user-agent': 'Mozilla/5.0 (COTA icon fetcher)' },
      });
      if (!res.ok) continue;
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      const ext = EXT_BY_TYPE[type];
      if (!ext) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // 404 본문(작은 XML/HTML)이나 빈 아이콘은 버린다.
      if (buf.length < 500) continue;
      if (ext === 'png' && buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') continue;
      return { buf, ext, source: cand.name, url: cand.url };
    } catch {
      /* 다음 소스로 */
    }
  }
  return null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const [contractsRes, tickersRes] = await Promise.all([
    fetch('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES'),
    fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
  ]);
  const contracts = (await contractsRes.json()).data ?? [];
  const tickers = (await tickersRes.json()).data ?? [];
  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.usdtVolume ?? t.quoteVolume ?? 0)]));

  const crypto = contracts
    .filter((c) => c.symbolStatus === 'normal' && c.isRwa !== 'YES')
    .map((c) => ({ symbol: c.symbol, base: String(c.baseCoin ?? c.symbol.replace(/USDT$/, '')).replace(/STOCK$/, '') }))
    .filter((c) => c.base && /^[A-Za-z0-9._-]+$/.test(c.base));

  const priority = ['BTC', 'ETH', 'SOL'];
  const byVolume = [...crypto].sort((a, b) => (volume.get(b.symbol) ?? 0) - (volume.get(a.symbol) ?? 0));
  const targets = [];
  const seen = new Set();
  const add = (base) => {
    const key = base.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(key);
  };
  priority.forEach(add);
  byVolume.slice(0, TOP_N).forEach((c) => add(c.base));

  // 이미 받아 둔 아이콘은 유지 (다음 배포에서도 같은 파일을 그대로 쓴다)
  if (existsSync(MANIFEST)) {
    try {
      const prev = JSON.parse(readFileSync(MANIFEST, 'utf8'));
      Object.keys(prev.icons ?? {}).forEach(add);
    } catch {
      /* 깨진 매니페스트는 새로 만든다 */
    }
  }

  const icons = {};
  const sources = { okx: 0, binance: 0, coincap: 0 };
  const missing = [];
  const queue = [...targets];
  const existing = new Set(readdirSync(OUT_DIR).filter((f) => f !== 'manifest.json'));

  async function worker() {
    while (queue.length) {
      const base = queue.shift();
      const file = existing.size && [...existing].find((f) => f.startsWith(`${base}.`));
      if (file) {
        icons[base] = file;
        continue;
      }
      const got = await download(base);
      if (!got) {
        missing.push(base);
        continue;
      }
      const name = `${base}.${got.ext}`;
      writeFileSync(`${OUT_DIR}/${name}`, got.buf);
      existing.add(name);
      icons[base] = name;
      sources[got.source] += 1;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  const sorted = Object.fromEntries(Object.keys(icons).sort().map((k) => [k, icons[k]]));
  const manifest = {
    generatedAt: new Date().toISOString(),
    count: Object.keys(sorted).length,
    sources,
    icons: sorted,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);

  // 매니페스트에 없는 이미지 파일 정리
  for (const f of readdirSync(OUT_DIR)) {
    if (f === 'manifest.json') continue;
    if (!Object.values(sorted).includes(f)) unlinkSync(`${OUT_DIR}/${f}`);
  }

  console.log(
    `아이콘 ${manifest.count}개 (${Object.keys(icons).length - missing.length} 확보) · 새로 받음 OKX ${sources.okx} / Binance ${sources.binance} / CoinCap ${sources.coincap}`,
  );
  if (missing.length) console.log(`아이콘 없음(글자 아바타 폴백): ${missing.join(', ')}`);
}

main().catch((e) => {
  console.error('ICON FETCH FAILED', e);
  process.exitCode = 1;
});
