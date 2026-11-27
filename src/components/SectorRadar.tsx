import { useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import { buildSectorBoard, rotationHints, type SectorCoinRow, type SectorRow } from '../engine/sectorRadar';
import { fmtPct, fmtTime, fmtVolume } from '../lib/format';
import { EXCHANGES, type Exchange } from '../lib/exchange';
import { RefreshIcon } from './Icons';

interface Props {
  exchange: Exchange;
  state: ScanState;
  /** 시세를 한 번 더 받아오고 싶을 때(스캐너 재스캔) */
  onRescan?: () => void;
}

function CoinChip({ coin, tone, role }: { coin: SectorCoinRow; tone: 'leader' | 'lag'; role: string }) {
  return (
    <div className={`sec-coin ${tone}`} data-coin={coin.base}>
      <span className="sec-coin-role">{role}</span>
      <b>{coin.base}</b>
      <span className={`sec-coin-change ${coin.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(coin.change24h, 2)}</span>
      <span className="sec-coin-meta">
        RS {coin.rs >= 0 ? '+' : ''}
        {coin.rs.toFixed(1)}%p · {fmtVolume(coin.quoteVolume)}
      </span>
    </div>
  );
}

export function SectorRadar({ exchange, state, onRescan }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const btcChange24h = useMemo(
    () => state.tickers.find((t) => t.symbol === 'BTCUSDT')?.change24h ?? 0,
    [state.tickers],
  );

  const board = useMemo(
    () => buildSectorBoard({ contracts: state.contracts, tickers: state.tickers, btcChange24h }),
    [state.contracts, state.tickers, btcChange24h],
  );

  const hints = useMemo(() => rotationHints(board, 3), [board]);
  const inflow = board.sectors.filter((s) => s.n > 0 && s.momentum === 'in');
  const top = board.sectors.find((s) => s.n > 0) ?? null;
  const maxScore = Math.max(1, ...board.sectors.map((s) => s.score));

  const detail = (s: SectorRow) => (
    <div className="sec-detail" data-sector-detail={s.key}>
      <div className="sec-detail-head">
        <b>{s.emoji} {s.label}</b>
        <span>{s.note}</span>
      </div>
      <div className="sec-pair">
        <div className="sec-pair-col">
          <h4>🚀 대장주 — 먼저 쏜 코인</h4>
          {s.leader ? (
            <CoinChip coin={s.leader} tone="leader" role="대장" />
          ) : (
            <div className="mv-empty">유동성 기준을 넘는 코인이 없습니다</div>
          )}
        </div>
        <div className="sec-pair-col">
          <h4>🎯 후발주 — 거래대금은 붙는데 덜 오른 코인</h4>
          {s.laggards.length ? (
            s.laggards.map((c) => <CoinChip key={c.symbol} coin={c} tone="lag" role="후발" />)
          ) : (
            <div className="mv-empty">지금은 덜 오른 코인이 없습니다</div>
          )}
        </div>
      </div>
      <div className="sec-detail-foot">
        <span>24h 등락 평균 {fmtPct(s.avgChange, 2)}</span>
        <span>중앙값 {fmtPct(s.medianChange, 2)}</span>
        <span>BTC 대비 {s.avgRs >= 0 ? '+' : ''}{s.avgRs.toFixed(2)}%p</span>
        <span>상승 {Math.round(s.breadth * 100)}%</span>
        <span>거래대금 {fmtVolume(s.volumeUsd)}</span>
      </div>
    </div>
  );

  return (
    <div className="tab sector-tab" data-sector>
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🌊 섹터 자금 순환 레이더
              <span className={`tool-badge ${board.btcChange24h >= 0 ? 'up' : 'down'}`}>
                BTC {fmtPct(board.btcChange24h, 2)}
              </span>
            </div>
            <div className="summary-sub" data-sector-sub>
              {EXCHANGES[exchange].universeLabel} · {board.mapped}종목 매핑 · 24h 등락·거래대금 기준 ·{' '}
              {state.tickersAt ? `${fmtTime(state.tickersAt)} 시세` : '시세 대기'}
            </div>
          </div>
          {onRescan && (
            <button className={`rescan ${state.status === 'scanning' ? 'busy' : ''}`} onClick={onRescan} disabled={state.status === 'scanning'} data-sector-rescan>
              <RefreshIcon size={15} />
              시세 갱신
            </button>
          )}
        </div>

        <div className="sec-kpis">
          <div className="sec-kpi">
            <span>지금 1위 섹터</span>
            <b data-sector-top>{top ? `${top.emoji} ${top.label}` : '—'}</b>
            <em>{top ? `${top.score}점 · 24h ${fmtPct(top.avgChange, 2)}` : '집계 중'}</em>
          </div>
          <div className="sec-kpi">
            <span>자금 유입 섹터</span>
            <b className="up">{inflow.length}개</b>
            <em>BTC 대비 +1%p 이상</em>
          </div>
          <div className="sec-kpi">
            <span>순환매 후보</span>
            <b data-sector-hints>{hints.length}개</b>
            <em>유입 섹터의 후발주</em>
          </div>
        </div>
      </section>

      {hints.length > 0 && (
        <section className="panel" data-sector-hint-list>
          <header className="panel-head">
            <h3>🔁 지금 순환매 후보</h3>
            <span className="panel-note">자금이 들어오는 섹터에서 덜 오른 코인</span>
          </header>
          <div className="sec-hints">
            {hints.map(({ sector, coin }) => (
              <div className="sec-hint" key={`${sector.key}-${coin.symbol}`}>
                <span className="sec-hint-sector">
                  {sector.emoji} {sector.label}
                </span>
                <b>{coin.base}</b>
                <span className={coin.change24h >= 0 ? 'up' : 'down'}>{fmtPct(coin.change24h, 2)}</span>
                <em>
                  섹터 평균 {fmtPct(sector.avgChange, 2)} · {fmtVolume(coin.quoteVolume)}
                </em>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel" data-sector-rank>
        <header className="panel-head">
          <h3>섹터 순위</h3>
          <span className="panel-note">
            등락 35% · 상대강도 25% · 상승폭 20% · 거래대금 20% · 표본 보정
          </span>
        </header>
        <div className="sec-list">
          {board.sectors.map((s) => {
            const expanded = open === s.key;
            return (
              <div className="sec-item" key={s.key} data-row={s.key} data-score={s.score}>
                <button className="sec-row" onClick={() => setOpen(expanded ? null : s.key)} aria-expanded={expanded}>
                  <span className={`sec-rank r${Math.min(3, s.rank)}`}>{s.rank}</span>
                  <span className="sec-name">
                    <b>
                      {s.emoji} {s.label}
                    </b>
                    <span>{s.n ? `${s.n}종목 · ${fmtVolume(s.volumeUsd)}` : '대표 코인 없음'}</span>
                  </span>
                  <span className={`sec-change ${s.avgChange >= 0 ? 'up' : 'down'}`}>{s.n ? fmtPct(s.avgChange, 2) : '—'}</span>
                  <span className={`sec-momentum ${s.momentum}`}>
                    {s.momentum === 'in' ? '자금 유입' : s.momentum === 'out' ? '자금 이탈' : '중립'}
                  </span>
                  <span className="sec-score">
                    <span className="sec-score-bar">
                      <span style={{ width: `${(s.score / maxScore) * 100}%` }} />
                    </span>
                    <b>{s.n ? s.score : '—'}</b>
                  </span>
                </button>
                {expanded && detail(s)}
              </div>
            );
          })}
        </div>
      </section>

      <div className="feed-note">
        섹터는 대표 코인 목록으로 고정 매핑했고(한 코인은 한 섹터), 순위는 {EXCHANGES[exchange].marketLine}의 24h 등락률·거래대금과
        BTC 대비 상대강도로 계산합니다. 과거 시계열이 없어 <b>24h 기준</b>이며, 후발주는 ‘섹터 최대 거래대금의 25% 이상인데 평균보다
        1%p 이상 덜 오른 코인’입니다. 투자 권유가 아닙니다.
      </div>
    </div>
  );
}
