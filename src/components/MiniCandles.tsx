import type { Candle, Signal } from '../engine/types';

interface Props {
  candles: Candle[];
  signal: Pick<Signal, 'target' | 'stop' | 'entry' | 'eq' | 'side' | 'detectedIdx' | 'state'>;
  height?: number;
  showLabels?: boolean;
  dark?: boolean;
}

export function MiniCandles({ candles, signal, height = 116, dark = false }: Props) {
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

  const up = dark ? '#3ddc97' : '#12b886';
  const down = dark ? '#ff5d5d' : '#f03e3e';
  const gridLine = dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,35,0.05)';

  const highlightX = padX + bw * signal.detectedIdx;
  const last = candles[candles.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mini-candles"
      preserveAspectRatio="none"
      role="img"
      aria-label="캔들 차트"
    >
      {[0.25, 0.5, 0.75].map((r) => (
        <line key={r} x1={0} x2={W} y1={H * r} y2={H * r} stroke={gridLine} strokeWidth={1} />
      ))}
      <rect
        x={Math.max(0, highlightX - bodyW)}
        y={0}
        width={Math.max(bw * 5.5, 26)}
        height={H}
        fill={dark ? 'rgba(124,92,255,0.16)' : 'rgba(91,91,214,0.08)'}
      />
      {candles.map((c, i) => {
        const isUp = c.c >= c.o;
        const color = isUp ? up : down;
        const x = padX + bw * i + bw / 2;
        const bodyTop = y(Math.max(c.o, c.c));
        const bodyBottom = y(Math.min(c.o, c.c));
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
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

      {/* 목표선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.target)}
        y2={y(signal.target)}
        stroke={dark ? '#3ddc97' : '#12b886cc'}
        strokeWidth={1.6}
      />
      {/* 무효선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.stop)}
        y2={y(signal.stop)}
        stroke={dark ? '#ff5d5d' : '#f03e3e'}
        strokeWidth={1.6}
      />
      {/* EQ 점선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.eq)}
        y2={y(signal.eq)}
        stroke={dark ? 'rgba(240,180,41,0.85)' : 'rgba(214,138,0,0.75)'}
        strokeWidth={1.2}
        strokeDasharray="5 4"
      />
      {/* 진입 점선 */}
      <line
        x1={0}
        x2={W}
        y1={y(signal.entry)}
        y2={y(signal.entry)}
        stroke={dark ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,35,0.28)'}
        strokeWidth={1}
        strokeDasharray="2 4"
      />
      <circle
        cx={padX + bw * (candles.length - 1) + bw / 2}
        cy={y(last.c)}
        r={3.2}
        fill={signal.side === 'long' ? up : down}
        stroke={dark ? '#0a0b0d' : '#fff'}
        strokeWidth={1.4}
      />
    </svg>
  );
}
