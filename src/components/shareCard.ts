import type { Signal } from '../engine/types';
import { symbolLogo } from '../lib/asset';
import { fmtPct, fmtPrice, tfLabel } from '../lib/format';
import { fmtOffset, shiftSignal } from '../lib/offset';
import { fmtLot, fmtUsd, lotCalcForSignal } from '../utils/lot';

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

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'left',
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

/** 네온 글로우가 깔린 텍스트 */
function neon(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'left',
  blur = 16,
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  label(ctx, text, x, y, font, color, align);
  ctx.shadowBlur = 0;
  label(ctx, text, x, y, font, color, align);
  ctx.restore();
}

export function drawShareCard(
  canvas: HTMLCanvasElement,
  signalInput: Signal,
  leverage: number,
  offset = 0,
  /** FX 시그널이면 배수(x) 대신 이 랏(Lot) 기준 달러 손익으로 그린다. */
  lot?: number,
) {
  // 벤티지 호가 보정 — 모든 가격을 같은 값동안 평행 이동(비율·손익비는 그대로)
  const signal = offset ? shiftSignal(signalInput, offset) : signalInput;
  const lc = lot != null ? lotCalcForSignal(signal, lot) : null;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const roi = signal.changePct * leverage;
  const longSide = signal.side === 'long';
  const accent = roi >= 0 ? '#00F5A0' : '#FF2E63';
  const green = '#00F5A0';
  const red = '#FF2E63';
  const amber = '#FFD166';
  const violet2 = '#7B61FF';
  const ink = '#E8EEFF';
  const dim = '#8EA0C0';

  /* ---------- 배경: 딥 다크 네이비 ---------- */
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#050814');
  bg.addColorStop(0.55, '#080D20');
  bg.addColorStop(1, '#0A0F24');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* 오로라 글로우 */
  const g1 = ctx.createRadialGradient(90, 30, 10, 90, 30, 660);
  g1.addColorStop(0, 'rgba(0, 229, 255, 0.26)');
  g1.addColorStop(0.45, 'rgba(0, 160, 200, 0.09)');
  g1.addColorStop(1, 'rgba(5, 8, 20, 0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W - 40, H - 20, 10, W - 40, H - 20, 620);
  g2.addColorStop(0, 'rgba(157, 78, 221, 0.32)');
  g2.addColorStop(0.55, 'rgba(123, 97, 255, 0.1)');
  g2.addColorStop(1, 'rgba(5, 8, 20, 0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  const g3 = ctx.createRadialGradient(W * 0.55, -60, 10, W * 0.55, -60, 480);
  g3.addColorStop(0, longSide ? 'rgba(0, 245, 160, 0.16)' : 'rgba(255, 46, 99, 0.16)');
  g3.addColorStop(1, 'rgba(5, 8, 20, 0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, W, H);

  /* 사이버 그리드 */
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.055)';
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

  /* CRT 스캔라인 + 워터마크 */
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#000000';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.07;
  label(ctx, 'CRT', W - 24, 520, `900 210px ${FONT}`, '#7DD3FF', 'right');
  ctx.globalAlpha = 0.04;
  label(ctx, 'CRT', W - 24, 520, `900 210px ${FONT}`, violet2, 'right');
  ctx.restore();

  /* 스캔 광선 */
  ctx.save();
  const sweep = ctx.createLinearGradient(0, 0, 0, 220);
  sweep.addColorStop(0, 'rgba(0, 229, 255, 0.12)');
  sweep.addColorStop(1, 'rgba(0, 229, 255, 0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, W, 220);
  ctx.restore();

  /* ---------- 네온 외곽선 ---------- */
  const borderGrad = ctx.createLinearGradient(0, 0, W, H);
  borderGrad.addColorStop(0, 'rgba(0, 229, 255, 0.95)');
  borderGrad.addColorStop(0.42, 'rgba(0, 245, 160, 0.55)');
  borderGrad.addColorStop(0.72, 'rgba(157, 78, 221, 0.85)');
  borderGrad.addColorStop(1, 'rgba(255, 46, 99, 0.55)');
  const frame = 10;
  ctx.save();
  ctx.shadowColor = longSide ? 'rgba(0, 245, 160, 0.9)' : 'rgba(255, 46, 99, 0.9)';
  ctx.shadowBlur = 30;
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2.2;
  rr(ctx, frame, frame, W - frame * 2, H - frame * 2, 24);
  ctx.stroke();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.14)';
  ctx.lineWidth = 1;
  rr(ctx, frame + 5, frame + 5, W - (frame + 5) * 2, H - (frame + 5) * 2, 20);
  ctx.stroke();

  /* ---------- 헤더 ---------- */
  const badgeGrad = ctx.createLinearGradient(38, 38, 94, 94);
  if (longSide) {
    badgeGrad.addColorStop(0, '#00E5FF');
    badgeGrad.addColorStop(1, '#00F5A0');
  } else {
    badgeGrad.addColorStop(0, '#FF4D79');
    badgeGrad.addColorStop(1, '#FF2E63');
  }
  ctx.save();
  ctx.shadowColor = longSide ? 'rgba(0, 245, 160, 0.9)' : 'rgba(255, 46, 99, 0.9)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = badgeGrad;
  ctx.beginPath();
  ctx.arc(66, 64, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(66, 64, 26, 0, Math.PI * 2);
  ctx.stroke();
  label(ctx, symbolLogo(signal.base), 66, 71, `900 15px ${FONT}`, '#04121A', 'center');

  label(ctx, '비트겟', 104, 60, `800 25px ${FONT}`, ink);
  const wBit = ctx.measureText('비트겟').width;
  neon(ctx, 'CRT 스캐너', 104 + wBit + 8, 60, `900 25px ${FONT}`, amber, 'left', 18);

  const dateStr = new Date(signal.detectedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  label(ctx, dateStr, W - 40, 48, `800 17px ${FONT}`, ink, 'right');
  label(ctx, 'KST', W - 40, 70, `600 13px ${FONT}`, dim, 'right');
  label(
    ctx,
    `#${signal.symbol.replace('USDT', '')} · ${signal.state === 'open' ? '진행중' : signal.state === 'win' ? '적중' : '무효'}`,
    W - 40,
    96,
    `500 14px ${FONT}`,
    '#9EB0CE',
    'right',
  );

  /* 심볼 */
  neon(ctx, signal.base, 40, 178, `900 56px ${FONT}`, '#FFFFFF', 'left', 22);
  const symW = ctx.measureText(signal.base).width;
  label(ctx, tfLabel(signal.tf), 40, 214, `700 17px ${FONT}`, '#A8B8D6');
  const tfW = ctx.measureText(tfLabel(signal.tf)).width;

  /* 롱/숏 배지 (네온 테두리) */
  const bx = Math.max(52 + tfW, 40 + symW * 0.55);
  const badgeColor = longSide ? green : red;
  ctx.save();
  ctx.shadowColor = longSide ? 'rgba(0, 245, 160, 0.8)' : 'rgba(255, 46, 99, 0.8)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = longSide ? 'rgba(0, 245, 160, 0.12)' : 'rgba(255, 46, 99, 0.14)';
  ctx.strokeStyle = longSide ? 'rgba(0, 245, 160, 0.85)' : 'rgba(255, 46, 99, 0.85)';
  ctx.lineWidth = 1.4;
  rr(ctx, bx, 195, 86, 28, 14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  label(ctx, longSide ? '▲ 롱 TS' : '▼ 숏 TS', bx + 43, 214, `800 14px ${FONT}`, badgeColor, 'center');

  ctx.fillStyle = 'rgba(122, 158, 255, 0.1)';
  ctx.strokeStyle = 'rgba(122, 158, 255, 0.35)';
  ctx.lineWidth = 1.2;
  rr(ctx, bx + 96, 195, 78, 28, 14);
  ctx.fill();
  ctx.stroke();
  label(ctx, signal.asset === 'stock' ? '주식선물' : signal.asset === 'fx' ? 'FX·금' : '코인', bx + 135, 214, `700 13px ${FONT}`, '#DCE8FF', 'center');

  /* 랏(Lot) 배지 — FX 시그널은 배수 대신 계약 크기 기준 랏을 명시한다 */
  if (lc) {
    ctx.save();
    ctx.shadowColor = 'rgba(255, 209, 102, 0.7)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(255, 209, 102, 0.14)';
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.8)';
    ctx.lineWidth = 1.4;
    rr(ctx, bx + 182, 195, 96, 28, 14);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    label(ctx, `${fmtLot(lc.lot)} Lot`, bx + 230, 214, `900 13px ${FONT}`, amber, 'center');
  }

  /* 우측 R/수익 — 형광 */
  const rText = `${signal.currentR >= 0 ? '+' : '−'}${Math.abs(signal.currentR).toFixed(1)}R`;
  neon(ctx, rText, W - 40, 182, `900 50px ${FONT}`, accent, 'right', 26);
  if (lc) {
    neon(ctx, `${fmtLot(lc.lot)} Lot ${fmtUsd(lc.pnl)}`, W - 40, 212, `900 19px ${FONT}`, accent, 'right', 12);
    label(ctx, `목표 ${fmtUsd(lc.targetUsd)}`, W - 40, 234, `700 14px ${FONT}`, green, 'right');
  } else {
    neon(ctx, `레버리지 ${leverage}x ${fmtPct(roi)}`, W - 40, 210, `800 16px ${FONT}`, accent, 'right', 12);
    label(ctx, `목표 ${signal.rr.toFixed(1)}R`, W - 40, 232, `700 14px ${FONT}`, '#A8B8D6', 'right');
  }

  /* 별점 + 전략 */
  const stars = '★'.repeat(signal.star) + '☆'.repeat(5 - signal.star);
  ctx.font = `400 21px ${FONT}`;
  const starW = ctx.measureText(stars).width;
  neon(ctx, stars, 40, 264, `400 21px ${FONT}`, amber, 'left', 14);
  neon(ctx, signal.strategyShort, 40 + starW + 18, 264, `900 20px ${FONT}`, amber, 'left', 14);

  /* ---------- 차트 패널 ---------- */
  const px = 32;
  const py = 288;
  const pw = W - 64;
  const ph = 300;

  const panelBg = ctx.createLinearGradient(px, py, px, py + ph);
  panelBg.addColorStop(0, '#070C1C');
  panelBg.addColorStop(1, '#060A17');
  ctx.fillStyle = panelBg;
  rr(ctx, px, py, pw, ph, 18);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = 'rgba(0, 229, 255, 0.55)';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
  ctx.lineWidth = 1.4;
  rr(ctx, px, py, pw, ph, 18);
  ctx.stroke();
  ctx.restore();

  const inner = { x: px + 14, y: py + 16, w: pw - 28, h: ph - 32 };

  /* 차트 내부 그리드 */
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const gy = inner.y + (inner.h / 5) * i;
    ctx.beginPath();
    ctx.moveTo(inner.x, gy);
    ctx.lineTo(inner.x + inner.w, gy);
    ctx.stroke();
  }

  const candles = signal.candles;
  const values = candles.flatMap((c) => [c.h, c.l]).concat([signal.target, signal.stop]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const yOf = (p: number) => inner.y + ((hi - p) / (hi - lo)) * inner.h;
  const bw = inner.w / Math.max(1, candles.length);
  const bodyW = Math.max(3, bw * 0.56);

  /* 시그널 발생봉 하이라이트 링 */
  const hx = inner.x + bw * Math.min(signal.detectedIdx, candles.length - 1);
  const ringW = Math.max(bw * 2.4, 10);
  ctx.save();
  ctx.shadowColor = 'rgba(157, 78, 221, 0.9)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = 'rgba(123, 97, 255, 0.18)';
  ctx.fillRect(hx - ringW / 2, inner.y, ringW, inner.h);
  ctx.strokeStyle = 'rgba(157, 78, 221, 0.85)';
  ctx.lineWidth = 1.2;
  rr(ctx, hx - ringW / 2, inner.y, ringW, inner.h, 4);
  ctx.stroke();
  ctx.restore();

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

  const line = (price: number, color: string, dash: number[], width: number, glow = 0) => {
    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(inner.x, yOf(price));
    ctx.lineTo(inner.x + inner.w, yOf(price));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };
  line(signal.target, green, [], 2, 16);
  line(signal.stop, red, [], 2, 16);
  line(signal.eq, amber, [8, 6], 1.6, 12);
  line(signal.entry, 'rgba(210, 230, 255, 0.45)', [3, 5], 1.2);

  /* 오른쪽 가격 라벨 */
  const priceTag = (price: number, textColor: string, bg: string, glow: string, text: string) => {
    const y = yOf(price);
    ctx.font = `900 11px ${FONT}`;
    const tw = ctx.measureText(text).width + 14;
    const ty = Math.min(Math.max(y - 9, inner.y), inner.y + inner.h - 18);
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = bg;
    rr(ctx, inner.x + inner.w - tw, ty, tw, 18, 5);
    ctx.fill();
    ctx.restore();
    label(ctx, text, inner.x + inner.w - 7, ty + 13, `900 11px ${FONT}`, textColor, 'right');
  };
  priceTag(signal.target, '#031A10', 'rgba(0, 245, 160, 0.92)', 'rgba(0, 245, 160, 0.9)', `목표 ${fmtPrice(signal.target, signal.decimals)}`);
  priceTag(signal.stop, '#1A0308', 'rgba(255, 46, 99, 0.92)', 'rgba(255, 46, 99, 0.9)', `무효 ${fmtPrice(signal.stop, signal.decimals)}`);

  /* 현재가 점 */
  const lastC = candles[candles.length - 1];
  const lastX = inner.x + inner.w - bw / 2;
  ctx.save();
  ctx.shadowColor = longSide ? green : red;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(lastX, yOf(lastC.c), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#04060F';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(lastX, yOf(lastC.c), 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  /* ---------- 4칸 박스 ---------- */
  const boxes = [
    {
      label: '목표',
      value: fmtPrice(signal.target, signal.decimals),
      usd: lc ? fmtUsd(lc.targetUsd) : undefined,
      color: green,
      border: 'rgba(0, 245, 160, 0.5)',
      glow: 'rgba(0, 245, 160, 0.75)',
    },
    {
      label: '반익 EQ',
      value: fmtPrice(signal.eq, signal.decimals),
      usd: lc ? fmtUsd(lc.eqUsd) : undefined,
      color: amber,
      border: 'rgba(255, 209, 102, 0.45)',
      glow: 'rgba(255, 209, 102, 0.7)',
    },
    {
      label: '진입가 추천',
      value: fmtPrice(signal.entry, signal.decimals),
      usd: lc ? `${fmtLot(lc.lot)} Lot` : undefined,
      color: ink,
      border: 'rgba(0, 229, 255, 0.35)',
      glow: 'rgba(0, 229, 255, 0.6)',
    },
    {
      label: '무효',
      value: fmtPrice(signal.stop, signal.decimals),
      usd: lc ? fmtUsd(lc.stopUsd) : undefined,
      color: red,
      border: 'rgba(255, 46, 99, 0.5)',
      glow: 'rgba(255, 46, 99, 0.75)',
    },
  ];
  const boxW = (pw - 16) / 2;
  const boxH = 78;
  boxes.forEach((b, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx2 = px + col * (boxW + 16);
    const by2 = 610 + row * (boxH + 14);
    const boxBg = ctx.createLinearGradient(bx2, by2, bx2, by2 + boxH);
    boxBg.addColorStop(0, 'rgba(20, 30, 58, 0.92)');
    boxBg.addColorStop(1, 'rgba(9, 14, 30, 0.94)');
    ctx.fillStyle = boxBg;
    rr(ctx, bx2, by2, boxW, boxH, 16);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = b.border;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = b.glow;
    ctx.shadowBlur = 14;
    rr(ctx, bx2, by2, boxW, boxH, 16);
    ctx.stroke();
    ctx.restore();
    label(ctx, b.label, bx2 + 18, by2 + 28, `700 14px ${FONT}`, '#93A5C4');
    neon(ctx, b.value, bx2 + 18, by2 + 59, `900 25px ${FONT}`, b.color, 'left', 14);
    if (b.usd) {
      label(ctx, b.usd, bx2 + boxW - 16, by2 + 58, `900 14px ${FONT}`, b.color, 'right');
    }
  });

  /* ---------- 진행 게이지 ---------- */
  const gy = 812;
  label(ctx, `진행 ${Math.round(signal.progress * 100)}%`, px, gy - 10, `700 13px ${FONT}`, '#93A5C4');
  label(
    ctx,
    `승률 ${signal.winRate.toFixed(0)}% · 손익비 ${signal.rr.toFixed(1)}R`,
    W - px,
    gy - 10,
    `700 13px ${FONT}`,
    '#93A5C4',
    'right',
  );
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  rr(ctx, px, gy, pw, 7, 4);
  ctx.fill();
  const fillW = Math.max(6, pw * Math.min(1, Math.max(0, signal.progress)));
  const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
  pg.addColorStop(0, '#00E5FF');
  pg.addColorStop(0.55, '#00F5A0');
  pg.addColorStop(1, violet2);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 245, 160, 0.9)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = pg;
  rr(ctx, px, gy, fillW, 7, 4);
  ctx.fill();
  ctx.restore();

  /* ---------- 푸터 ---------- */
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(px, 858);
  ctx.lineTo(W - px, 858);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  label(ctx, `${signal.strategyName}`, px, 898, `800 18px ${FONT}`, ink);
  label(
    ctx,
    `${signal.symbol} · Bitget USDT-M · ${tfLabel(signal.tf)}봉 200개 실데이터${
      offset ? ` · Vantage 호가 ${fmtOffset(offset, signal.decimals ?? 2)}` : ''
    }${lc ? ` · ${lc.spec.label}` : ''}`,
    px,
    924,
    `500 14px ${FONT}`,
    dim,
  );
  neon(ctx, '셋업 기록 공유 · 투자 권유 아님', W / 2, 976, `700 16px ${FONT}`, '#7E90B0', 'center', 12);
}
