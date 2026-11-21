import type { Signal } from '../engine/types';
import { assetLabel } from '../lib/asset';
import { fmtPct, fmtPrice, fmtRR, sideFullLabel, stateLabel, tfLabel } from '../lib/format';
import {
  STYLE_META,
  fmtSeed,
  fmtUsdAmount,
  recommendLeverage,
  seedPnl,
  type Profile,
} from '../lib/profile';

const FONT =
  '"Pretendard Variable",Pretendard,"Noto Sans KR","Noto Sans CJK KR",-apple-system,system-ui,sans-serif';

const W = 760;
const H = 1010;

/* ---------- 토스 스타일 팔레트 ---------- */
const C = {
  bg: '#FFFFFF',
  panel: '#F9FAFB',
  panel2: '#F2F4F6',
  ink: '#191F28',
  ink2: '#4E5968',
  sub: '#8B95A1',
  line: '#E5E8EB',
  blue: '#3182F6',
  blueSoft: '#E8F3FF',
  up: '#F04452',
  upSoft: '#FDECEE',
  down: '#3182F6',
  downSoft: '#E8F3FF',
};

function autorec(
  auto: boolean,
  profile: Profile | null,
  signal: Signal,
): ReturnType<typeof recommendLeverage> | null {
  if (!auto || !profile) return null;
  return recommendLeverage(signal, profile.style);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface TextOpts {
  size: number;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, o: TextOpts) {
  ctx.font = `${o.weight ?? 700} ${o.size}px ${FONT}`;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

/** 글자가 폭을 넘지 않게 줄여 그린다 (긴 심볼·전략명 대비) */
function fitText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  o: TextOpts,
) {
  let size = o.size;
  ctx.font = `${o.weight ?? 700} ${size}px ${FONT}`;
  while (size > 10 && ctx.measureText(value).width > maxWidth) {
    size -= 1;
    ctx.font = `${o.weight ?? 700} ${size}px ${FONT}`;
  }
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

function chip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  bg: string,
  color: string,
  size = 14,
  padX = 12,
  height = 28,
) {
  ctx.font = `800 ${size}px ${FONT}`;
  const w = ctx.measureText(label).width + padX * 2;
  ctx.fillStyle = bg;
  rr(ctx, x, y, w, height, height / 2);
  ctx.fill();
  text(ctx, label, x + w / 2, y + height / 2 + size * 0.36, { size, weight: 800, color, align: 'center' });
  return w;
}

export function drawShareCard(
  canvas: HTMLCanvasElement,
  signal: Signal,
  leverage: number,
  profile: Profile | null = null,
  auto = false,
) {
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const dir = signal.side === 'long' ? 1 : -1;
  const rec = autorec(auto, profile, signal);
  const lev = rec ? rec.leverage : leverage;
  const pnl = auto && profile ? seedPnl(signal, lev, profile.seed) : null;
  const roi = signal.changePct * lev;
  const longSide = signal.side === 'long';
  const sideColor = longSide ? C.up : C.down;
  const sideSoft = longSide ? C.upSoft : C.downSoft;
  const toTargetPct = ((signal.target - signal.price) / (signal.price || 1)) * 100 * dir;
  const toStopPct = ((signal.stop - signal.price) / (signal.price || 1)) * 100 * dir;
  const px = 40;
  const pw = W - px * 2;

  /* ---------- 배경 ---------- */
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  /* 상단 요약 영역 — 아주 옅은 회색 판 */
  ctx.fillStyle = C.panel;
  rr(ctx, 16, 16, W - 32, 296, 26);
  ctx.fill();

  /* ---------- 헤더 ---------- */
  ctx.fillStyle = C.blue;
  rr(ctx, px, 36, 36, 36, 12);
  ctx.fill();
  text(ctx, 'C', px + 18, 61, { size: 20, weight: 800, color: '#FFFFFF', align: 'center' });

  text(ctx, 'COTA', px + 48, 60, { size: 23, weight: 800, color: C.ink });
  text(ctx, '실시간 트레이딩 시그널', px + 48, 80, { size: 12, weight: 600, color: C.sub });

  const dateStr = new Date(signal.detectedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  text(ctx, `${dateStr} KST`, W - px, 60, { size: 14, weight: 600, color: C.sub, align: 'right' });

  /* ---------- 종목 · 방향 ---------- */
  fitText(ctx, signal.base, px, 128, pw - 250, { size: 46, weight: 800, color: C.ink });

  let chipX = px;
  chipX += chip(ctx, chipX, 148, tfLabel(signal.tf), '#FFFFFF', C.ink2, 13, 11, 26) + 6;
  chipX += chip(ctx, chipX, 148, assetLabel(signal.asset), '#FFFFFF', C.sub, 13, 11, 26) + 6;
  chipX += chip(ctx, chipX, 148, stateLabel(signal.state), '#FFFFFF', C.ink2, 13, 11, 26) + 6;
  chip(ctx, chipX, 148, rec ? `COTA 추천 ${lev}x` : `레버리지 ${lev}x`, C.blueSoft, C.blue, 13, 11, 26);

  /* 방향 배지 — 롱 · 매수 / 숏 · 매도 */
  const sideLabelText = sideFullLabel(signal.side);
  ctx.font = `800 15px ${FONT}`;
  const sideW = ctx.measureText(sideLabelText).width + 28;
  ctx.fillStyle = sideSoft;
  rr(ctx, W - px - sideW, 100, sideW, 34, 17);
  ctx.fill();
  text(ctx, sideLabelText, W - px - sideW / 2, 123, {
    size: 15,
    weight: 800,
    color: sideColor,
    align: 'center',
  });

  /* ---------- 현재가 · 예상 수익 ---------- */
  text(ctx, '현재가', px, 216, { size: 13, weight: 600, color: C.sub });
  text(ctx, fmtPrice(signal.price, signal.decimals), px, 268, {
    size: 46,
    weight: 800,
    color: C.ink,
  });

  const gainColor = roi >= 0 ? C.up : C.down;
  text(ctx, '예상 수익', W - px, 216, { size: 13, weight: 600, color: C.sub, align: 'right' });
  text(ctx, pnl ? fmtUsdAmount(pnl.profitUsd) : fmtPct(roi), W - px, 258, {
    size: 27,
    weight: 800,
    color: gainColor,
    align: 'right',
  });
  text(
    ctx,
    pnl ? `${fmtPct(pnl.profitPct)} · 손절 시 ${fmtUsdAmount(pnl.lossUsd)}` : `진입가 대비 ${fmtPct(signal.changePct, 2)}`,
    W - px,
    284,
    { size: 13, weight: 600, color: pnl ? C.down : C.ink2, align: 'right' },
  );

  /* ---------- 진입가 · 목표가 · 본전 · 손절가 ---------- */
  const boxW = (pw - 12) / 2;
  const boxH = 96;
  const boxes = [
    {
      label: '진입가',
      value: fmtPrice(signal.entry, signal.decimals),
      note: '기준가',
      color: C.ink,
      noteColor: C.sub,
    },
    {
      label: '목표가',
      value: fmtPrice(signal.target, signal.decimals),
      note: fmtPct(toTargetPct, 2),
      color: C.up,
      noteColor: C.up,
    },
    {
      label: '본전 (EQ)',
      value: fmtPrice(signal.eq, signal.decimals),
      note: '절반 익절',
      color: '#B26A00',
      noteColor: '#B26A00',
    },
    {
      label: '손절가',
      value: fmtPrice(signal.stop, signal.decimals),
      note: fmtPct(toStopPct, 2),
      color: C.down,
      noteColor: C.down,
    },
  ];

  boxes.forEach((b, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = px + col * (boxW + 12);
    const by = 332 + row * (boxH + 12);
    ctx.fillStyle = '#FFFFFF';
    rr(ctx, bx, by, boxW, boxH, 18);
    ctx.fill();
    text(ctx, b.label, bx + 18, by + 30, { size: 13, weight: 600, color: C.sub });
    fitText(ctx, b.value, bx + 18, by + 68, boxW - 36, { size: 26, weight: 800, color: b.color });
    text(ctx, b.note, bx + boxW - 18, by + 30, {
      size: 12,
      weight: 700,
      color: b.noteColor,
      align: 'right',
    });
  });

  /* ---------- 차트 ---------- */
  const cy = 550;
  const ch = 260;
  ctx.fillStyle = C.panel;
  rr(ctx, px, cy, pw, ch, 20);
  ctx.fill();

  const inner = { x: px + 18, y: cy + 20, w: pw - 36, h: ch - 40 };
  const candles = signal.candles;
  const values = candles.flatMap((c) => [c.h, c.l]).concat([signal.target, signal.stop]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const padY = (hi - lo) * 0.08 || 1;
  lo -= padY;
  hi += padY;
  const yOf = (p: number) => inner.y + ((hi - p) / (hi - lo)) * inner.h;
  const bw = inner.w / Math.max(1, candles.length);
  const bodyW = Math.max(2.5, bw * 0.56);

  ctx.strokeStyle = 'rgba(25,31,40,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gy = inner.y + (inner.h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(inner.x, gy);
    ctx.lineTo(inner.x + inner.w, gy);
    ctx.stroke();
  }

  /* 시그널 발생봉 */
  const hx = inner.x + bw * Math.min(signal.detectedIdx, candles.length - 1);
  const ringW = Math.max(bw * 2.2, 8);
  ctx.fillStyle = 'rgba(49,130,246,0.08)';
  ctx.fillRect(hx - ringW / 2, inner.y, ringW, inner.h);

  ctx.save();
  rr(ctx, px, cy, pw, ch, 20);
  ctx.clip();
  candles.forEach((c, i) => {
    const up = c.c >= c.o;
    const color = up ? C.up : C.down;
    const x = inner.x + bw * i + bw / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.h));
    ctx.lineTo(x, yOf(c.l));
    ctx.stroke();
    ctx.fillStyle = color;
    const top = yOf(Math.max(c.o, c.c));
    const bh = Math.max(1.5, yOf(Math.min(c.o, c.c)) - top);
    ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
  });

  const priceLine = (price: number, color: string, dash: number[], width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(inner.x, yOf(price));
    ctx.lineTo(inner.x + inner.w, yOf(price));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  priceLine(signal.target, 'rgba(240,68,82,0.65)', [], 1.6);
  priceLine(signal.stop, 'rgba(49,130,246,0.65)', [], 1.6);
  priceLine(signal.eq, 'rgba(139,149,161,0.55)', [6, 5], 1.2);
  priceLine(signal.entry, 'rgba(25,31,40,0.22)', [3, 4], 1.1);

  /* 목표가·손절가 라벨 */
  const tag = (price: number, label: string, color: string, bg: string) => {
    const y = Math.min(Math.max(yOf(price) - 10, inner.y), inner.y + inner.h - 22);
    ctx.font = `800 12px ${FONT}`;
    const tw = ctx.measureText(label).width + 16;
    ctx.fillStyle = bg;
    rr(ctx, inner.x + inner.w - tw, y, tw, 21, 7);
    ctx.fill();
    text(ctx, label, inner.x + inner.w - tw / 2, y + 15, { size: 12, weight: 800, color, align: 'center' });
  };
  tag(signal.target, `목표가 ${fmtPrice(signal.target, signal.decimals)}`, C.up, '#FDECEE');
  tag(signal.stop, `손절가 ${fmtPrice(signal.stop, signal.decimals)}`, C.down, '#E8F3FF');

  /* 현재가 점 */
  const lastC = candles[candles.length - 1];
  const lastX = inner.x + inner.w - bw / 2;
  ctx.beginPath();
  ctx.arc(lastX, yOf(lastC.c), 4.5, 0, Math.PI * 2);
  ctx.fillStyle = longSide ? C.up : C.down;
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  /* ---------- 진행률 · 손익비 · 최근 승률 ---------- */
  const gy = 848;
  text(ctx, `진행 ${Math.round(signal.progress * 100)}%`, px, gy - 10, {
    size: 13,
    weight: 700,
    color: C.ink2,
  });
  text(ctx, `최근 승률 ${signal.winRate.toFixed(0)}%`, W / 2, gy - 10, {
    size: 13,
    weight: 700,
    color: C.ink2,
    align: 'center',
  });
  text(ctx, `손익비 ${fmtRR(signal.rr, 1)}`, W - px, gy - 10, {
    size: 13,
    weight: 700,
    color: C.ink2,
    align: 'right',
  });

  ctx.fillStyle = C.panel2;
  rr(ctx, px, gy, pw, 8, 4);
  ctx.fill();
  const fillW = Math.max(8, pw * Math.min(1, Math.max(0, signal.progress)));
  ctx.fillStyle = C.blue;
  rr(ctx, px, gy, fillW, 8, 4);
  ctx.fill();

  /* ---------- 푸터 ---------- */
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, 890);
  ctx.lineTo(W - px, 890);
  ctx.stroke();

  fitText(ctx, signal.strategyName, px, 926, pw - 220, { size: 18, weight: 800, color: C.ink });
  text(ctx, `★ ${signal.star}/5`, W - px, 926, {
    size: 13,
    weight: 700,
    color: '#F5A623',
    align: 'right',
  });

  const seedNote =
    auto && profile
      ? ` · 내 시드 $${fmtSeed(profile.seed)} · ${STYLE_META[profile.style].label}`
      : '';
  const detail = `${signal.symbol} · 비트겟 USDT-M · ${tfLabel(signal.tf)}봉 200개 실데이터 · 레버리지 ${lev}x${seedNote}`;
  fitText(ctx, detail, px, 952, pw, { size: 12, weight: 500, color: C.sub });

  text(ctx, 'COTA · 셋업 기록 공유 · 투자 권유가 아닙니다', W / 2, 984, {
    size: 12,
    weight: 600,
    color: C.sub,
    align: 'center',
  });
}
