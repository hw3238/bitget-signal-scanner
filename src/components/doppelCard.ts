import type { DoppelResult } from '../lib/calc';
import { CARD_W, K, beginCard, cardFooter, cardHeader, fitTxt, pill, roundRect, txt } from './cardKit';

export interface DoppelCardData {
  base: string;
  tf: '1H' | '4H';
  at: number;
  result: DoppelResult;
}

const HEIGHT = 856;

/** 닫힌 종가 시퀀스를 시작값=0% 로 정규화 */
function pctPath(values: number[]): number[] {
  const base = values[0] || 1;
  return values.map((v) => ((v / base) - 1) * 100);
}

export async function drawDoppelCard(canvas: HTMLCanvasElement, d: DoppelCardData) {
  const ctx = beginCard(canvas, HEIGHT);
  if (!ctx) return;
  const pad = 28;
  const inner = CARD_W - pad * 2;
  const top = d.result.matches[0];

  cardHeader(ctx, '차트 도플갱어', `${d.base} · ${d.tf} · 과거 유사 패턴 매칭`);

  /* ---------- 요약 ---------- */
  ctx.fillStyle = K.panel;
  roundRect(ctx, pad, 80, inner, 108, 20);
  ctx.fill();
  const avg = d.result.avgFuturePct;
  txt(ctx, '유사 패턴 이후 흐름', pad + 18, 106, { size: 11, weight: 700, color: K.sub });
  txt(ctx, `${d.result.upCount}건 상승 · ${d.result.downCount}건 하락`, pad + 18, 138, {
    size: 20,
    weight: 800,
    color: d.result.upCount >= d.result.downCount ? K.up : K.down,
  });
  txt(ctx, `이후 ${d.result.futureLen}봉 평균 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`, pad + 18, 164, {
    size: 12,
    weight: 700,
    color: avg >= 0 ? K.up : K.down,
  });
  pill(ctx, CARD_W - pad - 18 - 92, 100, `평균 유사도 ${(d.result.avgCorr * 100).toFixed(1)}%`, K.blueSoft, K.blue, 11, 11, 24);

  /* ---------- 오버레이 차트 ---------- */
  const chartX = pad;
  const chartY = 206;
  const chartW = inner;
  const chartH = 250;
  ctx.fillStyle = K.panel;
  roundRect(ctx, chartX, chartY, chartW, chartH, 18);
  ctx.fill();

  if (top) {
    const cur = pctPath(d.result.current);
    const past = pctPath(top.window);
    const future = pctPath([top.window[top.window.length - 1], ...top.future]).map(
      (v) => v + past[past.length - 1],
    );
    const all = [...cur, ...past, ...future];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo || 1;
    const px = chartX + 16;
    const py = chartY + 22;
    const pw = chartW - 32;
    const ph = chartH - 58;
    const xOf = (i: number, total: number) => px + (pw * i) / Math.max(1, total - 1);
    const yOf = (v: number) => py + ph - ((v - lo) / span) * ph;

    // 0% 기준선
    ctx.strokeStyle = 'rgba(25,31,40,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, yOf(0));
    ctx.lineTo(px + pw, yOf(0));
    ctx.stroke();

    // 현재 패턴 (파랑 실선)
    ctx.strokeStyle = K.blue;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    cur.forEach((v, i) => {
      const x = xOf(i, cur.length);
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 도플갱어 1위 (회색 실선)
    ctx.strokeStyle = 'rgba(78,89,104,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    past.forEach((v, i) => {
      const x = xOf(i, past.length);
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 그 이후 실제 움직임 (점선)
    ctx.strokeStyle = top.futureChangePct >= 0 ? K.up : K.down;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    future.forEach((v, i) => {
      const x = xOf(past.length - 1 + i, past.length + future.length - 1);
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 이후 구간 배경
    const splitX = xOf(past.length - 1, past.length + future.length - 1);
    txt(ctx, '현재', px, chartY + chartH - 12, { size: 9, weight: 700, color: K.blue });
    txt(ctx, `과거 ${top.similarity.toFixed(1)}%`, px + pw / 2 - 20, chartY + chartH - 12, {
      size: 9,
      weight: 700,
      color: K.ink2,
    });
    txt(ctx, '이후 실제', splitX + 6, chartY + chartH - 12, {
      size: 9,
      weight: 700,
      color: top.futureChangePct >= 0 ? K.up : K.down,
    });
  }

  /* ---------- TOP 3 ---------- */
  let y = 466;
  txt(ctx, '가장 닮은 과거 구간 TOP 3', pad, y, { size: 11, weight: 700, color: K.sub });
  y += 4;
  d.result.matches.forEach((m, i) => {
    y += i === 0 ? 24 : 62;
    ctx.fillStyle = K.panel;
    roundRect(ctx, pad, y, inner, 54, 14);
    ctx.fill();
    txt(ctx, String(i + 1), pad + 16, y + 32, { size: 15, weight: 800, color: K.sub });
    const when = new Date(m.endAt).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    });
    fitTxt(ctx, when, pad + 40, y + 24, 160, { size: 12, weight: 700, color: K.ink });
    txt(ctx, `유사도 ${m.similarity.toFixed(1)}%`, pad + 40, y + 42, { size: 10, weight: 600, color: K.sub });
    txt(ctx, `이후 ${d.result.futureLen}봉`, CARD_W - pad - 84, y + 24, {
      size: 10,
      weight: 600,
      color: K.sub,
      align: 'right',
    });
    fitTxt(ctx, `${m.futureChangePct >= 0 ? '+' : ''}${m.futureChangePct.toFixed(2)}%`, CARD_W - pad - 16, y + 40, 80, {
      size: 19,
      weight: 800,
      color: m.futureChangePct >= 0 ? K.up : K.down,
      align: 'right',
    });
  });

  /* ---------- 해석 ---------- */
  y += 72;
  const verdict =
    d.result.upCount === d.result.matches.length && d.result.matches.length > 0
      ? '닮은 구간이 모두 상승으로 이어졌습니다. 다만 과거는 보장이 아닙니다.'
      : d.result.upCount === 0 && d.result.matches.length > 0
        ? '닮은 구간이 모두 하락으로 이어졌습니다. 반등 베팅은 신중하게.'
        : '상승·하락이 갈렸습니다. 방향보다 손절 라인이 중요한 자리입니다.';
  ctx.fillStyle = K.blueSoft;
  roundRect(ctx, pad, y, inner, 48, 14);
  ctx.fill();
  fitTxt(ctx, verdict, pad + 14, y + 28, inner - 28, { size: 10, weight: 700, color: K.blueDeep });

  const at = new Date(d.at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  cardFooter(ctx, HEIGHT, `비트겟 ${d.tf}봉 실데이터 · 피어슨 상관 · ${at} KST`);
}
