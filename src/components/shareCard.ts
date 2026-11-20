import type { Signal } from '../engine/types';
import { fmtPct, fmtPrice, tfLabel } from '../lib/format';

const FONT = '"Noto Sans KR","Noto Sans CJK KR",system-ui,sans-serif';

const W = 760;
const H = 1010;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

export function drawShareCard(canvas: HTMLCanvasElement, signal: Signal, leverage: number) {
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const roi = signal.changePct * leverage;
  const accent = roi >= 0 ? '#39e58c' : '#ff5d6c';
  const green = '#39e58c';
  const red = '#ff5d6c';
  const amber = '#f4b93e';
  const dim = '#7d8798';

  // 배경
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(120, 60, 20, 120, 60, 620);
  g1.addColorStop(0, 'rgba(57,229,140,0.20)');
  g1.addColorStop(0.55, 'rgba(9,40,30,0.10)');
  g1.addColorStop(1, 'rgba(4,6,10,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W - 90, H - 40, 10, W - 90, H - 40, 520);
  g2.addColorStop(0, 'rgba(90,60,200,0.22)');
  g2.addColorStop(1, 'rgba(4,6,10,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // 그리드
  ctx.strokeStyle = 'rgba(255,255,255,0.028)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 38) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 38) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // 테두리
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  rr(ctx, 1, 1, W - 2, H - 2, 26);
  ctx.stroke();

  // 헤더
  const badgeGrad = ctx.createLinearGradient(40, 40, 96, 96);
  badgeGrad.addColorStop(0, signal.side === 'long' ? '#0e7a4f' : '#7a1220');
  badgeGrad.addColorStop(1, signal.side === 'long' ? '#1fd18a' : '#ff5d6c');
  ctx.fillStyle = badgeGrad;
  ctx.beginPath();
  ctx.arc(66, 64, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  label(ctx, signal.base.slice(0, 3), 66, 71, `800 15px ${FONT}`, '#08130d', 'center');

  label(ctx, '비트겟', 104, 60, `800 25px ${FONT}`, '#ffffff');
  const wBit = ctx.measureText('비트겟').width;
  label(ctx, 'CRT 스캐너', 104 + wBit + 8, 60, `900 25px ${FONT}`, '#ffd34d');

  const dateStr = new Date(signal.detectedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  label(ctx, dateStr, W - 40, 48, `700 17px ${FONT}`, '#c9d2e0', 'right');
  label(ctx, 'KST', W - 40, 70, `500 13px ${FONT}`, dim, 'right');
  label(
    ctx,
    `#${signal.symbol.replace('USDT', '')} · ${signal.state === 'open' ? '진행중' : signal.state === 'win' ? '적중' : '무효'}`,
    W - 40,
    96,
    `500 14px ${FONT}`,
    '#98a2b3',
    'right',
  );

  // 심볼
  label(ctx, signal.base, 40, 178, `900 56px ${FONT}`, '#ffffff');
  label(ctx, tfLabel(signal.tf), 40, 214, `700 17px ${FONT}`, '#a8b2c1');
  const tfW = ctx.measureText(tfLabel(signal.tf)).width;

  // 롱/숏 배지
  const bx = 52 + tfW;
  const badgeColor = signal.side === 'long' ? '#39e58c' : '#ff5d6c';
  ctx.fillStyle = signal.side === 'long' ? 'rgba(57,229,140,0.14)' : 'rgba(255,93,108,0.14)';
  ctx.strokeStyle = signal.side === 'long' ? 'rgba(57,229,140,0.5)' : 'rgba(255,93,108,0.5)';
  rr(ctx, bx, 196, 78, 26, 13);
  ctx.fill();
  ctx.stroke();
  label(ctx, signal.side === 'long' ? '▲ 롱 TS' : '▼ 숏 TS', bx + 39, 214, `800 14px ${FONT}`, badgeColor, 'center');

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  rr(ctx, bx + 88, 196, 74, 26, 13);
  ctx.fill();
  ctx.stroke();
  label(ctx, signal.asset === 'stock' ? '주식선물' : '코인', bx + 125, 214, `700 13px ${FONT}`, '#dfe5ee', 'center');

  // 우측 R
  const rText = `${signal.currentR >= 0 ? '+' : '−'}${Math.abs(signal.currentR).toFixed(1)}R`;
  label(ctx, rText, W - 40, 180, `900 48px ${FONT}`, accent, 'right');
  label(ctx, `레버리지 ${leverage}x ${fmtPct(roi)} · 목표 ${signal.rr.toFixed(1)}R`, W - 40, 210, `700 16px ${FONT}`, '#c9d2e0', 'right');

  // 별점 + 전략
  const stars = '★'.repeat(signal.star) + '☆'.repeat(5 - signal.star);
  label(ctx, stars, 40, 262, `400 22px ${FONT}`, '#f4b93e');
  const starW = ctx.measureText(stars).width;
  label(ctx, signal.strategyShort, 40 + starW + 12, 262, `900 20px ${FONT}`, '#ffd34d');

  // 차트 패널
  const px = 32;
  const py = 288;
  const pw = W - 64;
  const ph = 300;
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  rr(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const candles = signal.candles;
  const inner = { x: px + 14, y: py + 16, w: pw - 28, h: ph - 32 };
  const values = candles.flatMap((c) => [c.h, c.l]).concat([signal.target, signal.stop]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const yOf = (p: number) => inner.y + ((hi - p) / (hi - lo)) * inner.h;
  const bw = inner.w / Math.max(1, candles.length);
  const bodyW = Math.max(3, bw * 0.56);

  // 시그널 발생 구간 하이라이트
  const hx = inner.x + bw * signal.detectedIdx;
  ctx.fillStyle = 'rgba(124,92,255,0.12)';
  ctx.fillRect(hx - bodyW, inner.y, bw * 3.4, inner.h);

  ctx.save();
  rr(ctx, px, py, pw, ph, 18);
  ctx.clip();
  candles.forEach((c, i) => {
    const up = c.c >= c.o;
    const color = up ? green : red;
    const x = inner.x + bw * i + bw / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.h));
    ctx.lineTo(x, yOf(c.l));
    ctx.stroke();
    ctx.fillStyle = color;
    const top = yOf(Math.max(c.o, c.c));
    const bh = Math.max(1.6, yOf(Math.min(c.o, c.c)) - top);
    ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
  });

  const line = (price: number, color: string, dash: number[], width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(inner.x, yOf(price));
    ctx.lineTo(inner.x + inner.w, yOf(price));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(signal.target, green, [], 2);
  line(signal.stop, red, [], 2);
  line(signal.eq, 'rgba(244,185,62,0.9)', [8, 6], 1.6);
  line(signal.entry, 'rgba(255,255,255,0.35)', [3, 5], 1.2);

  // 오른쪽 가격 라벨
  const priceTag = (price: number, color: string, bg: string, text: string) => {
    const y = yOf(price);
    ctx.font = `800 11px ${FONT}`;
    const tw = ctx.measureText(text).width + 14;
    ctx.fillStyle = bg;
    rr(ctx, inner.x + inner.w - tw, Math.min(Math.max(y - 9, inner.y), inner.y + inner.h - 18), tw, 18, 5);
    ctx.fill();
    label(ctx, text, inner.x + inner.w - 7, y + 4, `800 11px ${FONT}`, color, 'right');
  };
  priceTag(signal.target, '#05130c', 'rgba(57,229,140,0.85)', `목표 ${fmtPrice(signal.target)}`);
  priceTag(signal.stop, '#170306', 'rgba(255,93,108,0.85)', `무효 ${fmtPrice(signal.stop)}`);

  // 현재가 점
  const lastC = candles[candles.length - 1];
  ctx.beginPath();
  ctx.arc(inner.x + inner.w - bw / 2, yOf(lastC.c), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#04060a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 4칸 박스
  const boxes = [
    { label: '목표', value: fmtPrice(signal.target), color: green },
    { label: '반익 EQ', value: fmtPrice(signal.eq), color: amber },
    { label: '진입가 추천', value: fmtPrice(signal.entry), color: '#ffffff' },
    { label: '무효', value: fmtPrice(signal.stop), color: red },
  ];
  const boxW = (pw - 16) / 2;
  const boxH = 78;
  boxes.forEach((b, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx2 = px + col * (boxW + 16);
    const by2 = 610 + row * (boxH + 14);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    rr(ctx, bx2, by2, boxW, boxH, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.075)';
    ctx.lineWidth = 1;
    ctx.stroke();
    label(ctx, b.label, bx2 + 18, by2 + 28, `700 14px ${FONT}`, '#8b95a6');
    label(ctx, b.value, bx2 + 18, by2 + 58, `900 25px ${FONT}`, b.color);
  });

  // 진행 게이지
  const gy = 812;
  label(ctx, `진행 ${Math.round(signal.progress * 100)}%`, px, gy - 10, `600 13px ${FONT}`, '#8b95a6');
  label(ctx, `승률 ${signal.winRate.toFixed(0)}% · 손익비 ${signal.rr.toFixed(1)}R`, W - px, gy - 10, `600 13px ${FONT}`, '#8b95a6', 'right');
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  rr(ctx, px, gy, pw, 6, 3);
  ctx.fill();
  const fillW = Math.max(4, pw * Math.min(1, Math.max(0, signal.progress)));
  const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
  pg.addColorStop(0, '#39e58c');
  pg.addColorStop(1, '#8f7bff');
  ctx.fillStyle = pg;
  rr(ctx, px, gy, fillW, 6, 3);
  ctx.fill();

  // 푸터
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(px, 858);
  ctx.lineTo(W - px, 858);
  ctx.stroke();
  ctx.setLineDash([]);

  label(ctx, `${signal.strategyName}`, px, 898, `800 18px ${FONT}`, '#dfe5ee');
  label(ctx, `${signal.symbol} · Bitget USDT-M · ${tfLabel(signal.tf)}봉 200개 실데이터`, px, 924, `500 14px ${FONT}`, dim);
  label(ctx, '셋업 기록 공유 · 투자 권유 아님', W / 2, 976, `700 16px ${FONT}`, '#6f7a8b', 'center');

  // 워터마크
  ctx.save();
  ctx.globalAlpha = 0.028;
  label(ctx, 'CRT', W - 26, 520, `900 200px ${FONT}`, '#ffffff', 'right');
  ctx.restore();
}
