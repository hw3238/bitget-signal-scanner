import { useCallback, useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { Side } from '../engine/types';
import type { Profile } from '../lib/profile';
import { fmtUsdAmount } from '../lib/profile';
import {
  applyDca,
  maintenanceMarginRate,
  positionMetrics,
  survivalScore,
} from '../lib/calc';
import { fmtPct, fmtPrice } from '../lib/format';
import { CoinSelect, NumField } from './ui';
import { ImageCardModal } from './ImageCardModal';
import { drawSurvivalCard } from './survivalCard';
import { DownloadIcon } from './Icons';

const gradeTone = (g: string) =>
  g === 'S' ? 'green' : g === 'A' || g === 'B' ? 'blue' : g === 'C' || g === 'D' ? 'amber' : 'red';

export function PositionSurvival({ state, profile }: { state: ScanState; profile: Profile | null }) {
  const coins = useMemo(() => {
    const rows = state.contracts
      .filter((c) => c.asset === 'crypto')
      .map((c) => {
        const t = state.tickers.find((x) => x.symbol === c.symbol);
        return { symbol: c.symbol, base: c.base, volume: t?.quoteVolume ?? 0, last: t?.last ?? 0 };
      })
      .filter((c) => c.last > 0)
      .sort((a, b) => b.volume - a.volume);
    return rows.slice(0, 80);
  }, [state.contracts, state.tickers]);

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<Side>('long');
  const [entry, setEntry] = useState(0);
  const [leverage, setLeverage] = useState(10);
  const [margin, setMargin] = useState(profile?.seed ?? 100);
  const [addMargin, setAddMargin] = useState(0);
  const [addPrice, setAddPrice] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);

  const ticker = state.tickers.find((t) => t.symbol === symbol);
  const mark = ticker?.last ?? 0;
  const fundingPct = ticker?.fundingRate ?? 0;
  const mmr = maintenanceMarginRate(symbol);
  const effectiveEntry = entry > 0 ? entry : mark;

  const metrics = useMemo(() => {
    if (!effectiveEntry || !mark || margin <= 0 || leverage <= 0) return null;
    return positionMetrics({
      side,
      entry: effectiveEntry,
      leverage,
      margin,
      mark,
      mmr,
      fundingRatePct: fundingPct,
    });
  }, [effectiveEntry, mark, margin, leverage, side, mmr, fundingPct]);

  const dca = useMemo(() => {
    if (!effectiveEntry || margin <= 0) return null;
    if (addMargin <= 0 || addPrice <= 0) return null;
    return applyDca(
      { side, entry: effectiveEntry, leverage, margin, mark, mmr, fundingRatePct: fundingPct },
      addMargin,
      addPrice,
    );
  }, [effectiveEntry, margin, addMargin, addPrice, side, leverage, mark, mmr, fundingPct]);

  const fundingPerDay = metrics ? metrics.fundingPerInterval * 3 : 0;
  const score = metrics
    ? survivalScore({
        liqBufferPct: metrics.liqBufferPct,
        leverage,
        fundingPerDay,
        margin,
        pnlPct: metrics.pnlPct,
      })
    : null;

  const pickSymbol = useCallback(
    (next: string) => {
      setSymbol(next);
      setEntry(0);
      setAddPrice(0);
    },
    [],
  );

  const draw = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!metrics || !score) return;
      await drawSurvivalCard(canvas, {
        at: Date.now(),
        symbol,
        base: symbol.replace(/USDT$/, ''),
        side,
        entry: effectiveEntry,
        mark,
        leverage,
        margin,
        liq: metrics.liq,
        liqBufferPct: metrics.liqBufferPct,
        pnlPct: metrics.pnlPct,
        pnlUsd: metrics.pnlUsd,
        dca: dca ? { avgEntry: dca.avgEntry, liq: dca.liq, margin: dca.margin, leverage: dca.leverage } : null,
        fundingPerInterval: metrics.fundingPerInterval,
        fundingPerDay,
        roundTripFee: metrics.roundTripFee,
        score,
        stopBufferPct: null,
      });
    },
    [metrics, score, symbol, side, effectiveEntry, mark, leverage, margin, dca, fundingPerDay],
  );

  return (
    <div className="tab survival-tab">
      <section className="panel">
        <header className="panel-head">
          <h3>내 포지션</h3>
          <span className="panel-note">비트겟 현재가 자동 반영</span>
        </header>
        <div className="form-grid">
          <CoinSelect value={symbol} onChange={pickSymbol} coins={coins} />
          <div className="num-field">
            <span className="num-label">방향</span>
            <div className="segmented side-seg">
              <button className={side === 'long' ? 'on' : ''} onClick={() => setSide('long')}>
                롱 · 매수
              </button>
              <button className={side === 'short' ? 'on' : ''} onClick={() => setSide('short')}>
                숏 · 매도
              </button>
            </div>
          </div>
          <NumField
            label="진입가"
            value={entry || mark}
            onChange={setEntry}
            suffix="USDT"
            hint={mark ? `현재가 ${fmtPrice(mark)}` : undefined}
          />
          <NumField label="레버리지" value={leverage} onChange={setLeverage} suffix="x" />
          <NumField label="투입 증거금" value={margin} onChange={setMargin} suffix="USDT" />
          <div className="num-field">
            <span className="num-label">빠른 설정</span>
            <div className="chip-row">
              <button className="ghost-btn small" onClick={() => setEntry(mark)}>
                현재가로 진입
              </button>
              {profile && (
                <button className="ghost-btn small" onClick={() => setMargin(profile.seed)}>
                  내 시드 ${profile.seed.toLocaleString('en-US')}
                </button>
              )}
              <button className="ghost-btn small" onClick={() => setLeverage(10)}>
                10x
              </button>
              <button className="ghost-btn small" onClick={() => setLeverage(25)}>
                25x
              </button>
            </div>
          </div>
        </div>
      </section>

      {score && metrics ? (
        <section className={`survival-card grade-${gradeTone(score.grade)}`}>
          <div className="survival-top">
            <div>
              <div className="survival-label">생존 성적표</div>
              <div className="survival-grade">
                {score.grade}
                <span>{score.score}점</span>
              </div>
              <p className="survival-comment">{score.comment}</p>
            </div>
            <button className="ghost-btn small" onClick={() => setCardOpen(true)}>
              <DownloadIcon size={14} /> PNG 카드
            </button>
          </div>
          <div className="survival-grid">
            <div>
              <span>예상 청산가</span>
              <b className="down">{fmtPrice(metrics.liq)}</b>
            </div>
            <div>
              <span>청산까지 여유</span>
              <b className={metrics.liqBufferPct < 10 ? 'down' : ''}>{metrics.liqBufferPct.toFixed(2)}%</b>
            </div>
            <div>
              <span>현재 손익</span>
              <b className={metrics.pnlPct >= 0 ? 'up' : 'down'}>{fmtPct(metrics.pnlPct, 2)}</b>
            </div>
            <div>
              <span>평가손익</span>
              <b className={metrics.pnlUsd >= 0 ? 'up' : 'down'}>{fmtUsdAmount(metrics.pnlUsd)}</b>
            </div>
          </div>
        </section>
      ) : (
        <div className="notice">코인을 고르고 진입가·증거금을 입력하면 생존 성적표가 계산됩니다.</div>
      )}

      <section className="panel">
        <header className="panel-head">
          <h3>비용 시뮬레이션</h3>
          <span className="panel-note">8시간 정산 기준</span>
        </header>
        <ul className="kv-list">
          <li>
            <span>포지션 규모</span>
            <b>{metrics ? `${metrics.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT` : '-'}</b>
          </li>
          <li>
            <span>수량</span>
            <b>{metrics ? metrics.qty.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '-'}</b>
          </li>
          <li>
            <span>펀딩비 (8h / 일)</span>
            <b className={fundingPerDay > 0 ? 'green' : fundingPerDay < 0 ? 'down' : ''}>
              {metrics
                ? `${fmtUsdAmount(metrics.fundingPerInterval)} / ${fmtUsdAmount(fundingPerDay)}`
                : '-'}
            </b>
          </li>
          <li>
            <span>왕복 수수료 (시장가)</span>
            <b>{metrics ? fmtUsdAmount(-metrics.roundTripFee) : '-'}</b>
          </li>
          <li>
            <span>유지증거금률</span>
            <b>{(mmr * 100).toFixed(1)}%</b>
          </li>
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>물타기 시뮬레이터</h3>
          <span className="panel-note">추가 증거금을 넣었을 때</span>
        </header>
        <div className="form-grid">
          <NumField label="추가 증거금" value={addMargin} onChange={setAddMargin} suffix="USDT" />
          <NumField
            label="추가 진입가"
            value={addPrice}
            onChange={setAddPrice}
            suffix="USDT"
            hint={mark ? `현재가 ${fmtPrice(mark)}` : undefined}
          />
        </div>
        {dca ? (
          <div className="dca-result">
            <div>
              <span>새 평단가</span>
              <b>{fmtPrice(dca.avgEntry)}</b>
            </div>
            <div>
              <span>새 청산가</span>
              <b className="down">{fmtPrice(dca.liq)}</b>
            </div>
            <div>
              <span>새 배율</span>
              <b>{dca.leverage.toFixed(1)}x</b>
            </div>
            <div>
              <span>총 증거금</span>
              <b>${dca.margin.toLocaleString('en-US', { maximumFractionDigits: 0 })}</b>
            </div>
          </div>
        ) : (
          <p className="panel-note">추가 증거금과 가격을 넣으면 평단·청산가가 어떻게 바뀌는지 보여줍니다.</p>
        )}
      </section>

      <div className="feed-note">
        청산가는 격리 마진·유지증거금률 {`${(mmr * 100).toFixed(1)}%`} 가정으로 계산한 예상치입니다. 실제 청산은 거래소
        티어·펀딩 정산에 따라 달라질 수 있습니다.
      </div>

      {cardOpen && score && metrics && (
        <ImageCardModal
          title="포지션 생존 성적표"
          fileName={`COTA-survival-${symbol.replace(/USDT$/, '')}-${score.grade}`}
          draw={draw}
          onClose={() => setCardOpen(false)}
          hint="커뮤니티 인증·바이럴용 카드입니다. 투자 권유가 아닙니다."
        />
      )}
    </div>
  );
}
