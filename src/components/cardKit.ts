/**
 * 카드 그리기 공통 키트 — 기존 시그널 공유 카드와 같은 토스 라이트 팔레트.
 * 새 카드(시황 속보 · 생존 성적표 · 도플갱어)는 540 논리 px × 2배율 = 1080px PNG 로 저장한다.
 */

export const CARD_W = 540;
export const CARD_DPR = 2;

export const K = {
  bg: '#FFFFFF',
  panel: '#F9FAFB',
  panel2: '#F2F4F6',
  ink: '#191F28',
  ink2: '#4E5968',
  sub: '#8B95A1',
  line: '#E5E8EB',
  blue: '#3182F6',
  blueSoft: '#E8F3FF',
  blueDeep: '#1B64DA',
  up: '#F04452',
  upSoft: '#FDECEE',
  down: '#3182F6',
  downSoft: '#E8F3FF',
  green: '#12B76A',
  greenSoft: '#EDF7F0',
  amber: '#F5A623',
  amberSoft: '#FFF7E6',
};

export const CARD_FONT =
  '"Pretendard Variable",Pretendard,"Noto Sans KR","Noto Sans CJK KR",-apple-system,system-ui,sans-serif';

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export interface TextOpts {
  size: number;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
}

export function txt(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, o: TextOpts) {
  ctx.font = `${o.weight ?? 700} ${o.size}px ${CARD_FONT}`;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

/** 폭을 넘으면 글자를 줄여 그린다 */
export function fitTxt(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  o: TextOpts,
) {
  let size = o.size;
  ctx.font = `${o.weight ?? 700} ${size}px ${CARD_FONT}`;
  while (size > 8 && ctx.measureText(value).width > maxWidth) {
    size -= 1;
    ctx.font = `${o.weight ?? 700} ${size}px ${CARD_FONT}`;
  }
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

/** 알약 배지 — 그린 폭을 돌려준다 */
export function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  bg: string,
  color: string,
  size = 12,
  padX = 10,
  height = 24,
) {
  ctx.font = `800 ${size}px ${CARD_FONT}`;
  const w = ctx.measureText(label).width + padX * 2;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, height, height / 2);
  ctx.fill();
  txt(ctx, label, x + w / 2, y + height / 2 + size * 0.35, { size, weight: 800, color, align: 'center' });
  return w;
}

/** 캔버스 준비 — 논리 좌표(540×h)로 그릴 수 있게 배율을 맞춘다. */
export function beginCard(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D | null {
  canvas.width = CARD_W * CARD_DPR;
  canvas.height = height * CARD_DPR;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(CARD_DPR, 0, 0, CARD_DPR, 0, 0);
  ctx.fillStyle = K.bg;
  ctx.fillRect(0, 0, CARD_W, height);
  return ctx;
}

/** 상단 COTA 헤더 — 제목과 시각을 함께 */
export function cardHeader(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  pad = 28,
) {
  ctx.fillStyle = K.blue;
  roundRect(ctx, pad, 26, 28, 28, 9);
  ctx.fill();
  txt(ctx, 'C', pad + 14, 46, { size: 16, weight: 800, color: '#FFFFFF', align: 'center' });
  txt(ctx, 'COTA', pad + 36, 45, { size: 18, weight: 800, color: K.ink });
  txt(ctx, subtitle, pad + 36, 61, { size: 10, weight: 600, color: K.sub });
  txt(ctx, title, CARD_W - pad, 45, { size: 12, weight: 700, color: K.ink2, align: 'right' });
}

/** 하단 푸터 — 워터마크 */
export function cardFooter(ctx: CanvasRenderingContext2D, height: number, note: string, pad = 28) {
  ctx.strokeStyle = K.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, height - 54);
  ctx.lineTo(CARD_W - pad, height - 54);
  ctx.stroke();
  txt(ctx, note, pad, height - 32, { size: 10, weight: 500, color: K.sub });
  txt(ctx, 'cota · hw3238.github.io/bitget-signal-scanner', CARD_W - pad, height - 32, {
    size: 9,
    weight: 600,
    color: K.sub,
    align: 'right',
  });
}

export function kst(ts: number, withMinute = true): string {
  const d = new Date(ts);
  const s = d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return withMinute ? s.replace(/\.$/, '') : s.slice(0, 8);
}
