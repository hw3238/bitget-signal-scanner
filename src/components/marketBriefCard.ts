import type { FearGreed } from '../api/publicMarket';
import { fmtPrice, fmtVolume } from '../lib/format';
import { CARD_W, K, beginCard, cardFooter, cardHeader, fitTxt, pill, roundRect, txt } from './cardKit';

export interface BriefCoin {
  base: string;
  price: number;
  change24h: number;
}

export interface BriefFunding {
  base: string;
  /** 8시간 펀딩비(%) */
  rate: number;
  /** 연환산(%) */
  annual: number;
  /** 미결제약정(USDT) */
  oiUsd: number;
}

export interface MarketBriefData {
  at: number;
  fearGreed: FearGreed | null;
  coins: BriefCoin[];
  upCount: number;
  downCount: number;
  totalVolume: number;
  avgFunding: number;
  hotFunding: BriefFunding[];
  /** 숏 스퀴즈(롱 과열) / 롱 스퀴즈(숏 과열) 개수 */
  longSqueeze: number;
  shortSqueeze: number;
}


const fearColor = (v: number) => (v <= 25 ? K.down : v <= 45 ? '#4E8DF5' : v < 55 ? K.ink2 : v < 75 ? K.amber : K.up);

export async function drawMarketBriefCard(canvas: HTMLCanvasElement, data: MarketBriefData) {
  // 펀딩 과열 행이 없으면 카드를 짧게 — 아래 빈 공간이 남지 않게.
  const HEIGHT = data.hotFunding.length ? 800 : 744;
  const ctx = beginCard(canvas, HEIGHT);
  if (!ctx) return;
  const pad = 28;
  const inner = CARD_W - pad * 2;

  cardHeader(ctx, '시황 속보', '실시간 코인 시장 요약');

  const at = new Date(data.at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const fg = data.fearGreed;
  const fgValue = fg ? fg.value : 50;
  const color = fearColor(fgValue);

  /* ---------- 공포·탐욕 ---------- */
  ctx.fillStyle = K.panel;
  roundRect(ctx, pad, 82, inner, 132, 20);
  ctx.fill();
  txt(ctx, '공포 · 탐욕 지수', pad + 20, 110, { size: 11, weight: 700, color: K.sub });
  txt(ctx, fg ? String(fg.value) : '—', pad + 20, 172, { size: 52, weight: 800, color });
  const label = fg ? fg.label : '데이터 없음';
  pill(ctx, pad + 20 + (fg ? ctx.measureText(String(fg.value)).width + 8 : 44), 128, label, `${color}18`, color, 12, 11, 24);
  txt(ctx, fg ? `전일 대비 ${fg.previous != null ? (fg.value - fg.previous >= 0 ? '+' : '') + (fg.value - fg.previous) : '—'}` : '', pad + 20, 196, {
    size: 10,
    weight: 600,
    color: K.sub,
  });

  // 게이지
  const gx = pad + 214;
  const gw = inner - 214 - 20;
  const gy = 150;
  ctx.fillStyle = K.panel2;
  roundRect(ctx, gx, gy, gw, 10, 5);
  ctx.fill();
  const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  grad.addColorStop(0, '#3182F6');
  grad.addColorStop(0.5, '#B0B8C1');
  grad.addColorStop(1, '#F04452');
  ctx.fillStyle = grad;
  roundRect(ctx, gx, gy, Math.max(8, (gw * Math.max(0, Math.min(100, fgValue))) / 100), 10, 5);
  ctx.fill();
  txt(ctx, '극단적 공포', gx, gy + 26, { size: 9, weight: 600, color: K.sub });
  txt(ctx, '극단적 탐욕', gx + gw, gy + 26, { size: 9, weight: 600, color: K.sub, align: 'right' });
  txt(ctx, '0', gx, gy + 40, { size: 8, weight: 500, color: K.sub });
  txt(ctx, '100', gx + gw, gy + 40, { size: 8, weight: 500, color: K.sub, align: 'right' });

  const mood =
    fgValue <= 25
      ? '시장이 얼어붙었습니다. 역발상 매수 구간인지 확인하세요.'
      : fgValue <= 45
        ? '공포 우위 — 무리한 추격보다 분할 접근이 유리합니다.'
        : fgValue < 55
          ? '중립 — 방향보다 종목 선별이 중요한 구간입니다.'
          : fgValue < 75
            ? '탐욕 우위 — 익절 라인을 미리 정해 두세요.'
            : '극단적 탐욕 — 신규 진입은 특히 조심해야 합니다.';
  fitTxt(ctx, mood, gx, 118, gw, { size: 11, weight: 600, color: K.ink2 });

  /* ---------- 주요 코인 ---------- */
  let y = 228;
  txt(ctx, '주요 코인', pad, y, { size: 11, weight: 700, color: K.sub });
  data.coins.slice(0, 4).forEach((c, i) => {
    y += i === 0 ? 30 : 42;
    const up = c.change24h >= 0;
    txt(ctx, c.base, pad, y + 16, { size: 16, weight: 800, color: K.ink });
    txt(ctx, `${up ? '▲' : '▼'} ${Math.abs(c.change24h).toFixed(2)}%`, pad + 92, y + 16, {
      size: 12,
      weight: 700,
      color: up ? K.up : K.down,
    });
    fitTxt(ctx, fmtPrice(c.price), CARD_W - pad, y + 17, 170, {
      size: 18,
      weight: 800,
      color: K.ink,
      align: 'right',
    });
    ctx.strokeStyle = K.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y + 29);
    ctx.lineTo(CARD_W - pad, y + 29);
    ctx.stroke();
  });

  /* ---------- 시장 폭 ---------- */
  y += 30;
  const cardW = (inner - 10) / 2;
  const cards: Array<{ label: string; value: string; sub: string; tone: string }> = [
    { label: '상승 종목', value: `${data.upCount}`, sub: `하락 ${data.downCount}`, tone: K.up },
    { label: '24h 거래대금', value: fmtVolume(data.totalVolume).replace('$', ''), sub: 'USDT', tone: K.ink },
    { label: '평균 펀딩비', value: `${data.avgFunding.toFixed(4)}%`, sub: '8시간', tone: data.avgFunding >= 0 ? K.up : K.down },
    { label: '쏠림 경고', value: `${data.longSqueeze + data.shortSqueeze}`, sub: `롱과열 ${data.longSqueeze} · 숏과열 ${data.shortSqueeze}`, tone: K.amber },
  ];
  cards.forEach((c, i) => {
    const bx = pad + (i % 2) * (cardW + 10);
    const by = y + Math.floor(i / 2) * 78;
    ctx.fillStyle = K.panel;
    roundRect(ctx, bx, by, cardW, 68, 16);
    ctx.fill();
    txt(ctx, c.label, bx + 14, by + 22, { size: 10, weight: 600, color: K.sub });
    fitTxt(ctx, c.value, bx + 14, by + 50, cardW - 28, { size: 22, weight: 800, color: c.tone });
    txt(ctx, c.sub, bx + cardW - 14, by + 22, { size: 9, weight: 600, color: K.sub, align: 'right' });
  });
  y += 78 * 2 + 10;

  /* ---------- 펀딩 과열 ---------- */
  txt(ctx, '펀딩비 과열 TOP 3', pad, y + 4, { size: 11, weight: 700, color: K.sub });
  y += 14;
  if (data.hotFunding.length === 0) {
    ctx.fillStyle = K.greenSoft;
    roundRect(ctx, pad, y, inner, 52, 14);
    ctx.fill();
    txt(ctx, '펀딩 과열 없음 — 롱·숏 쏠림이 안정 구간입니다', pad + 16, y + 32, {
      size: 12,
      weight: 700,
      color: K.green,
    });
    y += 52;
  }
  data.hotFunding.slice(0, 3).forEach((f) => {
    y += 34;
    txt(ctx, f.base, pad, y + 14, { size: 14, weight: 800, color: K.ink });
    const hot = f.rate > 0.05 ? '롱 과열 · 롱 스퀴즈 주의' : f.rate < -0.05 ? '숏 과열 · 숏 스퀴즈 주의' : '정상 범위';
    txt(ctx, hot, pad + 80, y + 14, {
      size: 10,
      weight: 700,
      color: f.rate > 0.05 ? K.up : f.rate < -0.05 ? K.down : K.sub,
    });
    txt(ctx, `${f.rate >= 0 ? '+' : ''}${f.rate.toFixed(4)}% · 연 ${f.annual.toFixed(1)}%`, CARD_W - pad, y + 14, {
      size: 11,
      weight: 700,
      color: K.ink2,
      align: 'right',
    });
  });

  cardFooter(ctx, HEIGHT, `비트겟·빗썸·alternative.me 실데이터 · ${at} KST`);
}
