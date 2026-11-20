import type { Settings } from '../lib/storage';
import { MIN_RR, MIN_WINRATE } from '../engine/backtest';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClearHistory: () => void;
  onClearSwapLog: () => void;
  historyCount: number;
  swapCount: number;
}

export function SettingsTab({ settings, onChange, onClearHistory, onClearSwapLog, historyCount, swapCount }: Props) {
  return (
    <div className="tab settings-tab">
      <section className="panel">
        <header className="panel-head">
          <h3>스캐너 설정</h3>
        </header>
        <div className="setting-row">
          <div>
            <div className="setting-name">레버리지 배율</div>
            <div className="setting-desc">모든 시그널 카드와 백테스트 수익률에 반영됩니다.</div>
          </div>
          <div className="segmented">
            {[5, 10, 20, 50].map((l) => (
              <button key={l} className={settings.leverage === l ? 'on' : ''} onClick={() => onChange({ leverage: l })}>
                {l}x
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">최소 손익비 필터</div>
            <div className="setting-desc">진입 시점 손익비가 이 값보다 낮은 셋업은 목록에서 제외합니다.</div>
          </div>
          <div className="segmented">
            {[1.2, 1.5, 1.8, 2, 2.5].map((r) => (
              <button key={r} className={settings.minRR === r ? 'on' : ''} onClick={() => onChange({ minRR: r })}>
                {r.toFixed(1)}R
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">자동 갱신 주기</div>
            <div className="setting-desc">캔들·티커를 다시 받아 백테스트와 시그널을 갱신합니다.</div>
          </div>
          <div className="segmented">
            {[30, 60, 120, 0].map((s) => (
              <button key={s} className={settings.refreshSec === s ? 'on' : ''} onClick={() => onChange({ refreshSec: s })}>
                {s === 0 ? '꺼짐' : `${s}초`}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">새 시그널 알림음</div>
            <div className="setting-desc">새로운 진행중 시그널이 감지되면 짧은 알림을 냅니다.</div>
          </div>
          <button className={`switch ${settings.sound ? 'on' : ''}`} onClick={() => onChange({ sound: !settings.sound })}>
            <span />
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>엔진 기준</h3>
        </header>
        <ul className="rule-list">
          <li>
            <b>전략 풀</b> CRT+FVG+CISD, Liquidity Sweep+OB, EMA20/50+RSI, BB 스퀴즈, EQ 장악형,
            SuperTrend/돈치안 — 6개 매매법
          </li>
          <li>
            <b>채택 기준</b> 최근 60봉 검증 승률 {MIN_WINRATE}% 이상 · 손익비 {MIN_RR}R 이상 · 표본 2건 이상
          </li>
          <li>
            <b>자동 교체</b> 기존 채택 전략이 기준 미달이면 현재 최고 성과 전략으로 즉시 전환하고 로그를 남깁니다
          </li>
          <li>
            <b>판정</b> 진입 이후 최대 42봉 안에 목표/무효 도달 여부로 적중·무효를 판정합니다
          </li>
          <li>
            <b>수익률</b> 1회 리스크를 자본의 1%로 두고 R배수 × 레버리지로 환산합니다
          </li>
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>데이터</h3>
        </header>
        <div className="setting-row compact">
          <div>
            <div className="setting-name">시그널 추적 기록</div>
            <div className="setting-desc">{historyCount}건 저장됨</div>
          </div>
          <button className="ghost-btn" onClick={onClearHistory} disabled={!historyCount}>
            초기화
          </button>
        </div>
        <div className="setting-row compact">
          <div>
            <div className="setting-name">전략 교체 로그</div>
            <div className="setting-desc">{swapCount}건 저장됨</div>
          </div>
          <button className="ghost-btn" onClick={onClearSwapLog} disabled={!swapCount}>
            초기화
          </button>
        </div>
        <ul className="api-list">
          <li>
            <span>계약 목록</span>
            <code>GET /api/v2/mix/market/contracts?productType=USDT-FUTURES</code>
          </li>
          <li>
            <span>실시간 티커</span>
            <code>GET /api/v2/mix/market/tickers?productType=USDT-FUTURES</code>
          </li>
          <li>
            <span>캔들</span>
            <code>GET /api/v2/mix/market/candles?symbol=..&amp;granularity=1H|4H&amp;limit=200</code>
          </li>
        </ul>
      </section>

      <p className="disclaimer">
        본 스캐너는 비트겟 공개 시세 데이터를 계산해 과거 통계를 보여주는 정보 도구입니다. 투자 권유가 아니며,
        표시된 승률·수익률은 과거 데이터 기준으로 미래 성과를 보장하지 않습니다. 레버리지 거래는 원금 전액을
        잃을 수 있습니다.
      </p>
    </div>
  );
}
