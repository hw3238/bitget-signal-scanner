import { useMemo, useState } from 'react';
import type { Signal } from '../engine/types';
import type { ScanState } from '../hooks/useScanner';
import { fmtPct, tfLabel } from '../lib/format';
import type { Settings } from '../lib/storage';
import { SignalCard } from './SignalCard';
import { RefreshIcon } from './Icons';

interface Props {
  state: ScanState;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onOpen: (s: Signal) => void;
  onRescan: () => void;
}

type AssetFilter = 'all' | 'crypto' | 'stock';
type TfFilter = 'all' | '1H' | '4H';

export function ScannerTab({ state, settings, onSettings, onOpen, onRescan }: Props) {
  const [asset, setAsset] = useState<AssetFilter>('all');
  const [tf, setTf] = useState<TfFilter>('all');
  const [onlyOpen, setOnlyOpen] = useState(true);

  const openSignals = state.signals.filter((s) => s.state === 'open');
  const counts = useMemo(
    () => ({
      long: openSignals.filter((s) => s.side === 'long').length,
      short: openSignals.filter((s) => s.side === 'short').length,
      h1: openSignals.filter((s) => s.tf === '1H').length,
      h4: openSignals.filter((s) => s.tf === '4H').length,
      stock: openSignals.filter((s) => s.asset === 'stock').length,
      crypto: openSignals.filter((s) => s.asset === 'crypto').length,
    }),
    [openSignals],
  );

  const filtered = useMemo(() => {
    return state.signals
      .filter((s) => (onlyOpen ? s.state === 'open' : true))
      .filter((s) => (asset === 'all' ? s.asset !== 'commodity' : s.asset === asset))
      .filter((s) => (tf === 'all' ? true : s.tf === tf))
      .filter((s) => s.rr >= settings.minRR)
      .sort((a, b) => {
        const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.detectedAt - a.detectedAt;
      });
  }, [state.signals, onlyOpen, asset, tf, settings.minRR]);

  const qualified = state.analyses.filter(
    (a) => a.activeWinRate >= 55 && a.activeRR >= 1.5 && a.activeN >= 2,
  ).length;
  const scanning = state.status === 'scanning';
  const pct = state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : 0;

  const avgRoi = filtered.length
    ? filtered.reduce((acc, s) => acc + s.changePct * settings.leverage, 0) / filtered.length
    : 0;

  return (
    <div className="tab scanner-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              TS 발생 종목 <span className="dot-live" /> <b>{openSignals.length}</b>
            </div>
            <div className="summary-sub">
              비트겟 USDT-M · {state.analyses.length}개 마켓 · {qualified}개 마켓 고승률 전략 채택
            </div>
          </div>
          <button className={`rescan ${scanning ? 'busy' : ''}`} onClick={onRescan} disabled={scanning}>
            <RefreshIcon size={16} />
            {scanning ? `${pct}%` : '실시간 갱신'}
          </button>
        </div>

        <div className="counter-row">
          <span className="counter long">롱 {counts.long}</span>
          <span className="counter short">숏 {counts.short}</span>
          <span className="counter">{tfLabel('1H')} {counts.h1}</span>
          <span className="counter">{tfLabel('4H')} {counts.h4}</span>
          <span className="counter alt">평균 {fmtPct(avgRoi)}</span>
        </div>

        <div className="filter-grid">
          <div className="segmented" role="group" aria-label="자산 구분">
            {(
              [
                ['all', '전체'],
                ['crypto', '코인'],
                ['stock', '주식선물'],
              ] as [AssetFilter, string][]
            ).map(([key, label]) => (
              <button key={key} className={asset === key ? 'on' : ''} onClick={() => setAsset(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented slim" role="group" aria-label="타임프레임">
            {(
              [
                ['all', '전체'],
                ['1H', '1H'],
                ['4H', '4H'],
              ] as [TfFilter, string][]
            ).map(([key, label]) => (
              <button key={key} className={tf === key ? 'on' : ''} onClick={() => setTf(key)}>
                {label}
              </button>
            ))}
          </div>
          <label className="select-pill">
            <span>레버리지</span>
            <select
              value={settings.leverage}
              onChange={(e) => onSettings({ leverage: Number(e.target.value) })}
            >
              {[5, 10, 20, 50].map((l) => (
                <option key={l} value={l}>
                  {l}x
                </option>
              ))}
            </select>
          </label>
          <label className="select-pill">
            <span>최소 손익비</span>
            <select value={settings.minRR} onChange={(e) => onSettings({ minRR: Number(e.target.value) })}>
              {[1.2, 1.5, 1.8, 2, 2.5].map((r) => (
                <option key={r} value={r}>
                  {r.toFixed(1)}R
                </option>
              ))}
            </select>
          </label>
          <button className={`ghost-toggle ${onlyOpen ? 'on' : ''}`} onClick={() => setOnlyOpen((v) => !v)}>
            {onlyOpen ? '진행중만' : '종료 포함'}
          </button>
        </div>

        {scanning && (
          <div className="scan-bar">
            <div className="scan-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </section>

      {state.status === 'error' && (
        <div className="notice error">
          비트겟 API 호출 실패: {state.error}
          <button onClick={onRescan}>다시 시도</button>
        </div>
      )}

      <div className="list-head">
        <span>
          필터 적용 <b>{filtered.length}</b>건
        </span>
        <span className="muted">
          승률 55%·손익비 {settings.minRR.toFixed(1)}R 이상 전략만 시그널 생성
        </span>
      </div>

      <div className="card-grid">
        {filtered.map((s) => (
          <SignalCard key={s.id} signal={s} leverage={settings.leverage} onOpen={onOpen} />
        ))}

        {scanning &&
          filtered.length === 0 &&
          Array.from({ length: 3 }).map((_, i) => (
            <div className="signal-card skeleton" key={`sk-${i}`}>
              <div className="sk-line w40" />
              <div className="sk-line w70" />
              <div className="sk-chart" />
              <div className="sk-line w100" />
            </div>
          ))}

        {!scanning && filtered.length === 0 && (
          <div className="empty">
            <div className="empty-title">조건을 통과한 TS가 없습니다</div>
            <p>
              현재 {state.analyses.length}개 마켓을 200봉 기준으로 다시 계산했지만, 고승률 기준(승률 55% ·
              손익비 {settings.minRR.toFixed(1)}R)을 만족하는 진행중 시그널이 없습니다.
            </p>
            <div className="empty-actions">
              <button
                onClick={() => {
                  setAsset('all');
                  setTf('all');
                  onSettings({ minRR: 1.2 });
                  setOnlyOpen(false);
                }}
              >
                기준 완화해서 보기
              </button>
              <button onClick={onRescan} className="primary">
                지금 다시 스캔
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="feed-note">
        실시간 Bitget 캔들(1H/4H, 200봉) 기반 · 마지막 스캔{' '}
        {state.finishedAt ? new Date(state.finishedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'} ·
        자동 갱신 {settings.refreshSec ? `${settings.refreshSec}초` : '꺼짐'}
      </div>
    </div>
  );
}
