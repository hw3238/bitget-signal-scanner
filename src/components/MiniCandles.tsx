import { useId } from 'react';
import type { Candle, Signal } from '../engine/types';

interface Props {
  candles: Candle[];
  signal: Pick<Signal, 'target' | 'stop' | 'entry' | 'eq' | 'side' | 'detectedIdx' | 'state'>;
  height?: number;
  showLabels?: boolean;
  /** 토스풍 라이트 차트가 기본. dark=true 면 어두운 배경용 팔레트를 쓴다. */
  dark?: boolean;
}

/**
 * 카드 안 미니 캔들 차트 — 토스증권 차트처럼 흰/연회색 바탕에
 * 상승 빨강(#F04452) · 하락 파랑(#3182F6)만 쓴다. 네온 글로우는 쓰지 않는다.
 */
export function MiniCandles({ candles, signal, height = 116, dark = false }: Props) {
  const rawId = useId();
  const uid = `mc${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const W = 320;
  const H = height;
  const padTop = 10;
  const padBottom = 8;
  const padX = 2;

  if (!candles.length) return <div style={{ height }} />;

  const values = candles.flatMap((c) => [c.h, c.l]).concat([signal.target, signal.stop]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) {
    max += 0.5;
    min -= 0.5;
  }
  const pad = (max - min) * 0.06;
  min -= pad;
  max += pad;

  const y = (p: number) => padTop + ((max - p) / (max - min)) * (H - padTop - padBottom);
  const bw = (W - padX * 2) / candles.length;
  const bodyW = Math.max(1.6, bw * 0.58);

  /* 한국 증권 앱 팔레트 — 상승 빨강, 하락 파랑 */
  const up = dark ? '#FF6B7A' : '#F04452';
  const down = dark ? '#4C8DFF' : '#3182F6';
  const gridLine = dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(25, 31, 40, 0.06)';
  const gridVert = dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(25, 31, 40, 0.035)';
  const targetColor = dark ? 'rgba(255, 107, 122, 0.8)' : 'rgba(240, 68, 82, 0.55)';
  const stopColor = dark ? 'rgba(76, 141, 255, 0.8)' : 'rgba(49, 130, 246, 0.55)';
  const eqColor = dark ? 'rgba(255, 209, 102, 0.7)' : 'rgba(139, 149, 161, 0.6)';
  const entryColor = dark ? 'rgba(200, 220, 255, 0.3)' : 'rgba(25, 31, 40, 0.22)';

  const highlightX = padX + bw * Math.min(signal.detectedIdx, candles.length - 1);
  const highlightW = Math.max(bw * 1.6, 6);
  const last = candles[candles.length - 1];
  const lastX = padX + bw * (candles.length - 1) + bw / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mini-candles"
      preserveAspectRatio="none"
      role="img"
      aria-label="캔들 차트"
    >
      <defs>
        <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(49, 130, 246, 0.02)" />
          <stop offset="50%" stopColor="rgba(49, 130, 246, 0.09)" />
          <stop offset="100%" stopColor="rgba(49, 130, 246, 0.02)" />
        </linearGradient>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill={dark ? '#111827' : 'transparent'} />

      {/* 가로·세로 안내선 */}
      {[0.25, 0.5, 0.75].map((r) => (
        <line key={`h${r}`} x1={0} x2={W} y1={H * r} y2={H * r} stroke={gridLine} strokeWidth={1} />
      ))}
      {[0.25, 0.5, 0.75].map((r) => (
        <line key={`v${r}`} x1={W * r} x2={W * r} y1={0} y2={H} stroke={gridVert} strokeWidth={1} />
      ))}

      {/* 시그널 발생봉 표시 */}
      <rect x={highlightX - highlightW / 2} y={0} width={highlightW} height={H} fill={`url(#${uid}-band)`} />
      <line
        x1={highlightX}
        x2={highlightX}
        y1={0}
        y2={H}
        stroke={dark ? 'rgba(255,255,255,0.22)' : 'rgba(49, 130, 246, 0.35)'}
        strokeWidth={1}
        strokeDasharray="3 3"
      />

      {/* 캔들 */}
      {candles.map((c, i) => {
        const isUp = c.c >= c.o;
        const color = isUp ? up : down;
        const x = padX + bw * i + bw / 2;
        const bodyTop = y(Math.max(c.o, c.c));
        const bodyBottom = y(Math.min(c.o, c.c));
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} opacity={0.85} />
            <rect
              x={x - bodyW / 2}
              y={bodyTop}
              width={bodyW}
              height={Math.max(1.1, bodyBottom - bodyTop)}
              fill={color}
              rx={0.6}
            />
          </g>
        );
      })}

      {/* 목표가선 */}
      <line x1={0} x2={W} y1={y(signal.target)} y2={y(signal.target)} stroke={targetColor} strokeWidth={1.4} />
      {/* 손절가선 */}
      <line x1={0} x2={W} y1={y(signal.stop)} y2={y(signal.stop)} stroke={stopColor} strokeWidth={1.4} />
      {/* 본전(EQ) 점선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.eq)}
        y2={y(signal.eq)}
        stroke={eqColor}
        strokeWidth={1.1}
        strokeDasharray="5 4"
      />
      {/* 진입가 점선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.entry)}
        y2={y(signal.entry)}
        stroke={entryColor}
        strokeWidth={1}
        strokeDasharray="2 4"
      />

      {/* 현재가 점 */}
      <circle
        cx={lastX}
        cy={y(last.c)}
        r={3.2}
        fill={signal.side === 'long' ? up : down}
        stroke={dark ? '#111827' : '#FFFFFF'}
        strokeWidth={1.6}
      />
    </svg>
  );
}
