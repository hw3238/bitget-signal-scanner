import type { Side } from '../engine/types';
import type { SurvivalScore } from '../lib/calc';
import { fmtPct, fmtPrice } from '../lib/format';
import { fmtUsdAmount } from '../lib/profile';
import { CARD_W, K, beginCard, cardFooter, cardHeader, fitTxt, pill, roundRect, txt } from './cardKit';

export interface SurvivalCardData {
  at: number;
  symbol: string;
  base: string;
  side: Side;
  entry: number;
  mark: number;
  leverage: number;
  margin: number;
  liq: number;
  liqBufferPct: number;
  pnlPct: number;
  pnlUsd: number;
  dca: { avgEntry: number; liq: number; margin: number; leverage: number } | null;
  fundingPerInterval: number;
  fundingPerDay: number;
  roundTripFee: number;
  score: SurvivalScore;
  /** 이 자리에서 손절까지 거리(%) — 입력이 있을 때 */
  stopBufferPct: number | null;
}

const HEIGHT = 720;

const gradeTone = (grade: string) => {
  if (grade === 'S') return { bg: K.greenSoft, fg: K.green };
  if (grade === 'A' || grade === 'B') return { bg: K.blueSoft, fg: K.blue };
  if (grade === 'C' || grade === 'D') return { bg: K.amberSoft, fg: '#B26A00' };
  return { bg: K.upSoft, fg: K.up };
};

export async function drawSurvivalCard(canvas: HTMLCanvasElement, d: SurvivalCardData) {
  const ctx = beginCard(canvas, HEIGHT);
  if (!ctx) return;
  const pad = 28;
  const inner = CARD_W - pad * 2;
  const tone = gradeTone(d.score.grade);

  cardHeader(ctx, '생존 성적표', '포지션 청산 · 펀딩 시뮬레이션');

  /* ---------- 등급 ---------- */
  ctx.fillStyle = tone.bg;
  roundRect(ctx, pad, 80, inner, 150, 22);
  ctx.fill();
  txt(ctx, d.score.grade, pad + 26, 190, { size: 84, weight: 800, color: tone.fg });
  txt(ctx, `${d.score.score}점`, pad + 110, 152, { size: 16, weight: 800, color: tone.fg });
  fitTxt(ctx, d.score.comment, pad + 110, 182, inner - 140, { size: 12, weight: 600, color: K.ink2 });
  const chips: Array<{ t: string; bg: string; fg: string }> = [
    { t: d.base, bg: '#FFFFFF', fg: K.ink },
    { t: d.side === 'long' ? '롱 · 매수' : '숏 · 매도', bg: '#FFFFFF', fg: d.side === 'long' ? K.up : K.down },
    { t: `${d.leverage.toFixed(1)}x`, bg: '#FFFFFF', fg: K.ink2 },
    { t: `증거금 $${d.margin.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, bg: '#FFFFFF', fg: K.ink2 },
  ];
  let cx = pad + 26;
  chips.forEach((c) => {
    cx += pill(ctx, cx, 198, c.t, c.bg, c.fg, 11, 10, 22) + 6;
  });

  /* ---------- 핵심 수치 ---------- */
  let y = 254;
  const cellW = (inner - 10) / 2;
  const cells = [
    { label: '진입가', value: fmtPrice(d.entry), tone: K.ink },
    { label: '현재가', value: fmtPrice(d.mark), tone: K.ink },
    { label: '예상 청산가', value: fmtPrice(d.liq), tone: K.up },
    { label: '청산까지 여유', value: `${d.liqBufferPct.toFixed(2)}%`, tone: d.liqBufferPct < 10 ? K.up : K.ink2 },
  ];
  cells.forEach((c, i) => {
    const bx = pad + (i % 2) * (cellW + 10);
    const by = y + Math.floor(i / 2) * 84;
    ctx.fillStyle = K.panel;
    roundRect(ctx, bx, by, cellW, 74, 16);
    ctx.fill();
    txt(ctx, c.label, bx + 14, by + 22, { size: 10, weight: 600, color: K.sub });
    fitTxt(ctx, c.value, bx + 14, by + 52, cellW - 28, { size: 22, weight: 800, color: c.tone });
  });
  y += 84 * 2 + 4;

  /* ---------- 손익 · 비용 ---------- */
  const rows: Array<[string, string, string]> = [
    ['현재 손익', `${fmtPct(d.pnlPct)} · ${fmtUsdAmount(d.pnlUsd)}`, d.pnlPct >= 0 ? K.up : K.down],
    ['펀딩비 (8h / 일)', `${fmtUsdAmount(d.fundingPerInterval)} / ${fmtUsdAmount(d.fundingPerDay)}`, d.fundingPerInterval >= 0 ? K.green : K.ink2],
    ['왕복 수수료 (시장가)', fmtUsdAmount(-d.roundTripFee), K.ink2],
  ];
  if (d.stopBufferPct != null) {
    rows.push(['손절까지 거리', `${d.stopBufferPct.toFixed(2)}%`, K.ink2]);
  }
  if (d.dca) {
    rows.push([
      `물타기 후 평단 ${fmtPrice(d.dca.avgEntry)}`,
      `청산 ${fmtPrice(d.dca.liq)} · ${d.dca.leverage.toFixed(1)}x`,
      K.blue,
    ]);
  }
  txt(ctx, '비용 · 손익 시뮬레이션', pad, y + 10, { size: 11, weight: 700, color: K.sub });
  y += 22;
  rows.forEach(([label, value, color]) => {
    y += 32;
    txt(ctx, label, pad, y + 12, { size: 12, weight: 600, color: K.ink2 });
    fitTxt(ctx, value, CARD_W - pad, y + 12, 230, { size: 12, weight: 800, color, align: 'right' });
    ctx.strokeStyle = K.line;
    ctx.beginPath();
    ctx.moveTo(pad, y + 22);
    ctx.lineTo(CARD_W - pad, y + 22);
    ctx.stroke();
  });

  /* ---------- 점수 구성 ---------- */
  y += 44;
  txt(ctx, '점수 구성', pad, y, { size: 10, weight: 700, color: K.sub });
  const parts = [
    { label: '청산 여유', score: d.score.parts.buffer, max: 40 },
    { label: '레버리지', score: d.score.parts.leverage, max: 25 },
    { label: '펀딩 비용', score: d.score.parts.funding, max: 20 },
    { label: '손익 위치', score: d.score.parts.pnl, max: 15 },
  ];
  parts.forEach((p, i) => {
    const bx = pad + i * ((inner - 24) / 4 + 8);
    const w = (inner - 24) / 4;
    txt(ctx, p.label, bx, y + 20, { size: 9, weight: 600, color: K.sub });
    ctx.fillStyle = K.panel2;
    roundRect(ctx, bx, y + 28, w, 6, 3);
    ctx.fill();
    ctx.fillStyle = tone.fg;
    roundRect(ctx, bx, y + 28, Math.max(3, (w * p.score) / p.max), 6, 3);
    ctx.fill();
    txt(ctx, `${Math.round(p.score)}/${p.max}`, bx, y + 50, { size: 9, weight: 700, color: K.ink2 });
  });
  txt(ctx, '유지증거금 · 수수료 가정 포함 · 투자 권유가 아닙니다', pad, y + 74, {
    size: 9,
    weight: 500,
    color: K.sub,
  });

  const at = new Date(d.at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  cardFooter(ctx, HEIGHT, `${d.symbol} · 비트겟 현재가 기준 · ${at} KST`);
}
