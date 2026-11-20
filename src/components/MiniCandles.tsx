import { useId } from 'react';
import type { Candle, Signal } from '../engine/types';

interface Props {
  candles: Candle[];
  signal: Pick<Signal, 'target' | 'stop' | 'entry' | 'eq' | 'side' | 'detectedIdx' | 'state'>;
  height?: number;
  showLabels?: boolean;
  dark?: boolean;
}

export function MiniCandles({ candles, signal, height = 116, dark = true }: Props) {
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

  /* 네온 팔레트 */
  const up = '#00F5A0';
  const down = '#FF2E63';
  const gridLine = dark ? 'rgba(0, 229, 255, 0.075)' : 'rgba(15,23,35,0.05)';
  const gridVert = dark ? 'rgba(122, 158, 255, 0.05)' : 'rgba(15,23,35,0.03)';
  const targetColor = dark ? '#00F5A0' : '#12b886cc';
  const stopColor = dark ? '#FF2E63' : '#f03e3e';
  const eqColor = dark ? '#FFD166' : 'rgba(214,138,0,0.75)';
  const entryColor = dark ? 'rgba(200, 220, 255, 0.38)' : 'rgba(15,23,35,0.28)';

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
        <filter
          id={`${uid}-glow`}
          filterUnits="userSpaceOnUse"
          x={-8}
          y={-8}
          width={W + 16}
          height={H + 16}
        >
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter
          id={`${uid}-soft`}
          filterUnits="userSpaceOnUse"
          x={-8}
          y={-8}
          width={W + 16}
          height={H + 16}
        >
          <feGaussianBlur stdDeviation="3.6" />
        </filter>
        <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(157, 78, 221, 0.05)" />
          <stop offset="48%" stopColor="rgba(157, 78, 221, 0.28)" />
          <stop offset="100%" stopColor="rgba(0, 229, 255, 0.1)" />
        </linearGradient>
      </defs>

      {/* 다크 캔버스 */}
      <rect x={0} y={0} width={W} height={H} fill={dark ? '#060A17' : 'transparent'} />

      {/* 은은한 사이버 그리드 */}
      {[0.2, 0.4, 0.6, 0.8].map((r) => (
        <line key={`h${r}`} x1={0} x2={W} y1={H * r} y2={H * r} stroke={gridLine} strokeWidth={1} />
      ))}
      {[0.2, 0.4, 0.6, 0.8].map((r) => (
        <line key={`v${r}`} x1={W * r} x2={W * r} y1={0} y2={H} stroke={gridVert} strokeWidth={1} />
      ))}

      {/* 시그널 발생봉 네온 하이라이트 */}
      <rect x={highlightX - highlightW / 2} y={0} width={highlightW} height={H} fill={`url(#${uid}-band)`} />
      <rect
        x={highlightX - highlightW / 2}
        y={0.5}
        width={highlightW}
        height={H - 1}
        fill="none"
        stroke="rgba(157, 78, 221, 0.75)"
        strokeWidth={1}
        rx={3}
        filter={`url(#${uid}-glow)`}
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
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} opacity={0.9} />
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

      {/* 목표선 — 네온 그린 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.target)}
        y2={y(signal.target)}
        stroke={targetColor}
        strokeWidth={1.7}
        filter={dark ? `url(#${uid}-glow)` : undefined}
      />
      {/* 무효선 — 네온 레드 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.stop)}
        y2={y(signal.stop)}
        stroke={stopColor}
        strokeWidth={1.7}
        filter={dark ? `url(#${uid}-glow)` : undefined}
      />
      {/* EQ 점선 — 네온 골드 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.eq)}
        y2={y(signal.eq)}
        stroke={eqColor}
        strokeWidth={1.3}
        strokeDasharray="5 4"
        filter={dark ? `url(#${uid}-glow)` : undefined}
      />
      {/* 진입 점선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.entry)}
        y2={y(signal.entry)}
        stroke={entryColor}
        strokeWidth={1}
        strokeDasharray="2 4"
      />

      {/* 현재가 점 — 발광 */}
      {dark && <circle cx={lastX} cy={y(last.c)} r={6} fill={signal.side === 'long' ? up : down} opacity={0.35} filter={`url(#${uid}-soft)`} />}
      <circle
        cx={lastX}
        cy={y(last.c)}
        r={3.2}
        fill={signal.side === 'long' ? up : down}
        stroke={dark ? '#04060F' : '#fff'}
        strokeWidth={1.4}
      />
    </svg>
  );
}
