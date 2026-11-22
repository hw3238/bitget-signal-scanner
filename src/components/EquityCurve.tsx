import type { EquityCurveData, StreakInfo } from '../lib/journal';
import { fmtR } from '../lib/journal';

interface Props {
  curve: EquityCurveData;
  streaks: StreakInfo;
  /** 내 진입 매매 기준인지 — 빈 상태 문구가 달라진다 */
  mine?: boolean;
}

const W = 320;
const H = 132;
const PAD = { l: 8, r: 8, t: 16, b: 16 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 누적 R 수익곡선 — 실제 종료 매매만 시간순으로 이어 그린다.
 * 0선 위(이익 구간)는 토스 블루, 아래(손실 구간)는 빨강. 영역은 0선에서 잘라 칠한다.
 */
export function EquityCurve({ curve, streaks, mine = false }: Props) {
  const { points, trades } = curve;
  if (trades === 0 || points.length < 2) {
    return (
      <div className="equity-empty">
        <b>수익곡선을 그릴 종료 매매가 없어요</b>
        <p>
          {mine
            ? '내 진입으로 표시한 시그널이 목표 달성·손절로 끝나면 여기에 내 매매만의 누적 R 곡선이 그려집니다.'
            : '목표 달성·손절로 끝난 시그널이 쌓이면 여기에 시간순 누적 R 곡선이 그려집니다.'}
        </p>
      </div>
    );
  }

  const values = points.map((p) => p.cumR);
  let hi = Math.max(0, ...values);
  let lo = Math.min(0, ...values);
  if (hi - lo < 1e-9) {
    hi = 1;
    lo = -1;
  }
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const zeroY = PAD.t + (hi / (hi - lo)) * plotH;
  const x = (i: number) => PAD.l + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.cumR).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;
  const last = points[points.length - 1];
  const lastUp = last.cumR >= 0;
  const dots = points.length <= 24 ? points : [];

  return (
    <div className="equity-wrap">
      <svg
        className="equity-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`누적 R 수익곡선 — ${trades}건, 최고 ${fmtR(curve.peakR)}, 최종 ${fmtR(
          curve.finalR,
        )}, 최대 낙폭 ${fmtR(curve.mddR)}`}
      >
        <defs>
          <clipPath id="equity-above">
            <rect x={0} y={0} width={W} height={zeroY} />
          </clipPath>
          <clipPath id="equity-below">
            <rect x={0} y={zeroY} width={W} height={Math.max(0, H - zeroY)} />
          </clipPath>
        </defs>

        {/* 0R 기준선 */}
        <line className="equity-zero" x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} />

        {/* 0선 위 = 이익 구간(토스 블루) */}
        <g clipPath="url(#equity-above)">
          <path className="equity-area above" d={area} />
          <path className="equity-line above" d={line} />
        </g>
        {/* 0선 아래 = 손실 구간(빨강) */}
        <g clipPath="url(#equity-below)">
          <path className="equity-area below" d={area} />
          <path className="equity-line below" d={line} />
        </g>

        {dots.map((p, i) => (
          <circle
            key={`${p.t}-${i}`}
            className={`equity-dot ${p.cumR >= 0 ? 'above' : 'below'}`}
            cx={x(i)}
            cy={y(p.cumR)}
            r={i === points.length - 1 ? 3.2 : 1.8}
          />
        ))}

        <circle
          className={`equity-last ${lastUp ? 'above' : 'below'}`}
          cx={x(points.length - 1)}
          cy={y(last.cumR)}
          r={3.4}
        />

        {hi > 0 && (
          <text className="equity-label" x={W - PAD.r} y={PAD.t - 5} textAnchor="end">
            최고 {fmtR(curve.peakR)}
          </text>
        )}
        {lo < 0 && (
          <text className="equity-label" x={W - PAD.r} y={H - 3} textAnchor="end">
            최저 {fmtR(lo)}
          </text>
        )}
        <text className="equity-label zero" x={PAD.l} y={clamp(zeroY - 4, 9, H - 3)}>
          0R
        </text>
      </svg>

      <div className="equity-kpi">
        <span>
          현재 <b>{fmtR(curve.finalR)}</b>
        </span>
        <span>
          최대 낙폭 <b>{fmtR(curve.mddR)}</b>
        </span>
        <span>
          최장 연승 <b>{streaks.maxWin}</b>
        </span>
        <span>
          최장 연패 <b>{streaks.maxLoss}</b>
        </span>
      </div>
      <div className="equity-legend">
        <i className="above" /> 0선 위 = 이익 구간
        <i className="below" /> 0선 아래 = 손실 구간
      </div>
    </div>
  );
}
