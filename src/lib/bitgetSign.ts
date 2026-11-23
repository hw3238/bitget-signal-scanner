/**
 * 비트겟 v2 Private REST 서명 규격의 참조 구현.
 *
 * 실제 주문은 안드로이드 네이티브(`BitgetApi.java`)가 서명한다 — Secret이 웹뷰로 내려오지 않는다.
 * 이 파일은 그 규격을 문서화하고, 네이티브와 **같은 입력 → 같은 서명**이 나오는지
 * 단위 테스트(`scripts/autotrade-check.ts`)로 고정하기 위해 존재한다.
 *
 *   prehash = timestamp(ms) + METHOD + requestPath(+query) + bodyJson
 *   ACCESS-SIGN = Base64(HMAC-SHA256(secret, prehash))
 *
 * 헤더: ACCESS-KEY · ACCESS-SIGN · ACCESS-TIMESTAMP · ACCESS-PASSPHRASE
 *       Content-Type: application/json · locale: ko-KR
 *       모의투자(Demo) 요청이면 `paptrading: 1`
 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 — 브라우저·Node 어디서나 같은 값을 내도록 직접 구현한다. */
export function sha256(input: Uint8Array): Uint8Array {
  const len = input.length;
  const bitLen = len * 8;
  const withOne = len + 1;
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64);
  padded.set(input);
  padded[len] = 0x80;
  // 64비트 길이(상위 32비트는 실제로 0) — JS 숫자 정밀도 안에서 안전하게 쓴다.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const end = padded.length;
  padded[end - 8] = (hi >>> 24) & 0xff;
  padded[end - 7] = (hi >>> 16) & 0xff;
  padded[end - 6] = (hi >>> 8) & 0xff;
  padded[end - 5] = hi & 0xff;
  padded[end - 4] = (lo >>> 24) & 0xff;
  padded[end - 3] = (lo >>> 16) & 0xff;
  padded[end - 2] = (lo >>> 8) & 0xff;
  padded[end - 1] = lo & 0xff;

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = off + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  h.forEach((v, i) => {
    out[i * 4] = (v >>> 24) & 0xff;
    out[i * 4 + 1] = (v >>> 16) & 0xff;
    out[i * 4 + 2] = (v >>> 8) & 0xff;
    out[i * 4 + 3] = v & 0xff;
  });
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 표준 Base64 (패딩 포함) — btoa/Buffer 없이 환경 독립적으로 만든다. */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : '=';
  }
  return out;
}

/** UTF-8 바이트 — 앱 이름 등 비ASCII body도 서명이 어긋나지 않게 */
export function utf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return new Uint8Array(out);
}

/** HMAC-SHA256 → Base64 (비트겟 ACCESS-SIGN) */
export function hmacSha256Base64(secret: string, message: string): string {
  const block = 64;
  let key = utf8(secret);
  if (key.length > block) key = sha256(key);
  const pad = new Uint8Array(block);
  pad.set(key);
  const inner = new Uint8Array(block + utf8(message).length);
  const outer = new Uint8Array(block + 32);
  for (let i = 0; i < block; i += 1) {
    inner[i] = pad[i] ^ 0x36;
    outer[i] = pad[i] ^ 0x5c;
  }
  inner.set(utf8(message), block);
  outer.set(sha256(inner), block);
  return base64(sha256(outer));
}

/**
 * 서명 원문(prehash).
 *  - query string 은 **보낸 그대로**(정렬·인코딩 변경 없이) requestPath 뒤에 붙인다.
 *  - GET 은 body 가 없으므로 빈 문자열.
 *  - body 는 실제 전송하는 JSON 문자열 그대로(공백·키 순서 포함).
 */
export function bitgetPrehash(input: {
  timestamp: number | string;
  method: 'GET' | 'POST' | 'DELETE';
  requestPath: string;
  body?: string;
}): string {
  const body = input.body ?? '';
  return `${input.timestamp}${input.method.toUpperCase()}${input.requestPath}${body}`;
}

/** ACCESS-SIGN */
export function bitgetSign(
  secret: string,
  input: { timestamp: number | string; method: 'GET' | 'POST' | 'DELETE'; requestPath: string; body?: string },
): string {
  return hmacSha256Base64(secret, bitgetPrehash(input));
}

/** 모의투자(Demo) 여부에 따라 붙는 헤더 값 — 네이티브와 같은 규칙 */
export function demoHeader(demo: boolean): Record<string, string> {
  return demo ? { paptrading: '1' } : {};
}

/** 키 마스킹 — 화면에는 이 형태로만 보여준다 (예: bg_9f3k••••••2c7d) */
export function maskKey(key: string): string {
  const clean = (key ?? '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}
