import type { StrategyRow } from '../lib/journal';
import { fmtR } from '../lib/journal';

interface Props {
  rows: StrategyRow[];
}

/** 전략별 성적 — "요즘 어떤 전략이 먹히는지" 누적 R 순으로 한눈에 */
export function StrategyBoard({ rows }: Props) {
  if (!rows.length) {
    return <div className="equity-empty slim">아직 기록이 없어 전략별 성적을 계산할 수 없어요.</div>;
  }
  return (
    <ul className="strat-board">
      {rows.map((r) => {
        const cls = r.cumR > 0 ? 'up' : r.cumR < 0 ? 'down' : 'flat';
        return (
          <li className={`strat-chip ${cls}`} key={r.strategyId}>
            <div className="sc-main">
              <b>{r.strategyShort}</b>
              <span>
                {r.closed > 0
                  ? `종료 ${r.closed}건 · 승률 ${r.winRate.toFixed(0)}%${r.open > 0 ? ` · 진행 ${r.open}` : ''}`
                  : `진행 중 ${r.open}건`}
              </span>
            </div>
            <div className="sc-result">
              <b>{fmtR(r.cumR)}</b>
              <span>{r.closed > 0 ? `평균 ${fmtR(r.avgR)}` : '종료 없음'}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
