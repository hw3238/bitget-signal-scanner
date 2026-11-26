import type { ScanState } from '../hooks/useScanner';
import type { AutoTradeApi } from '../hooks/useAutoTrade';
import type { Signal } from '../engine/types';
import type { AccountBase } from '../lib/account';
import type { SwapLogEntry } from '../lib/storage';
import { AutoTradeTab } from './AutoTradeTab';
import { SurgeExplorer } from './SurgeExplorer';
import { statusBadge } from '../lib/autotrade';
import { EXCHANGES, type Exchange } from '../lib/exchange';
import { EngineTab } from './EngineTab';
import { KimchiRadar } from './KimchiRadar';
import { KeyMatchRadar } from './KeyMatchRadar';
import { Doppelganger } from './Doppelganger';
import { PositionSurvival } from './PositionSurvival';
import { SizingCalc } from './SizingCalc';
import { FeeCalc } from './FeeCalc';

export type MenuView = 'auto' | 'surge' | 'kimchi' | 'lag' | 'doppel' | 'survival' | 'sizing' | 'fee' | 'engine';

interface MenuItem {
  key: MenuView;
  emoji: string;
  title: string;
  desc: string;
  tag: string;
  hot?: boolean;
}

const GROUPS: Array<{ title: string; items: MenuItem[] }> = [
  {
    title: '실전 레이더',
    items: [
      {
        key: 'surge',
        emoji: '🚀',
        title: '급등 탐색기',
        desc: '6가지 급등 요건을 점수화해 출발 직전 코인과 진입·목표·손절을 추천',
        tag: '6요건 · 100점',
        hot: true,
      },
      {
        key: 'kimchi',
        emoji: '🥬',
        title: '김프 & 송금 레이더',
        desc: '국내·해외 시세 차이와 지금 가장 유리한 송금 코인 TOP 3',
        tag: '업비트 ↔ 비트겟',
        hot: true,
      },
      {
        key: 'lag',
        emoji: '🎯',
        title: '키맞추기 레이더',
        desc: '비트는 움직였는데 아직 안 따라온 후발주자를 찾습니다',
        tag: '상관 · 괴리',
        hot: true,
      },
      {
        key: 'doppel',
        emoji: '🔮',
        title: '차트 도플갱어',
        desc: '지금 차트와 가장 닮은 과거 구간 TOP 3와 그 이후 흐름',
        tag: '패턴 매칭',
        hot: true,
      },
    ],
  },
  {
    title: '리스크 관리',
    items: [
      {
        key: 'survival',
        emoji: '🩺',
        title: '포지션 생존 성적표',
        desc: '청산가·물타기·펀딩비를 넣어 S~F 등급으로 진단',
        tag: '청산 시뮬',
      },
      {
        key: 'sizing',
        emoji: '📐',
        title: '포지션 사이징',
        desc: '손실률을 먼저 정하고 수량·레버리지·손익비를 계산',
        tag: 'R:R',
      },
      {
        key: 'fee',
        emoji: '🧾',
        title: '수수료 & 페이백',
        desc: '매매 습관대로 한 달·1년 수수료가 얼마인지 확인',
        tag: '비용',
      },
    ],
  },
  {
    title: '분석',
    items: [
      {
        key: 'engine',
        emoji: '⚙️',
        title: '전략 엔진',
        desc: '전략별 승률·손익비와 시그널 성과를 확인',
        tag: '백테스트',
      },
    ],
  },
];

interface Props {
  /** 현재 거래소 — 급등 탐색기·자동매매 화면이 거래소를 따른다 */
  exchange: Exchange;
  onExchangeChange: (exchange: Exchange) => void;
  state: ScanState;
  /** 연결된 계좌 잔고 — 사이징·생존 성적표의 기본 증거금(v1.5.5) */
  account: AccountBase;
  /** 하위 화면 상태(앱이 들고 있다 — 시그널 카드에서 자동매매 화면을 바로 열기 위해) */
  view: MenuView | null;
  onViewChange: (view: MenuView | null) => void;
  leverage: number;
  swapLog: SwapLogEntry[];
  onRescan: () => void;
  onClearLog: () => void;
  /** 🤖 자동매매 상태·화면 */
  autoTrade: AutoTradeApi;
  signals: Signal[];
}

const TITLES: Record<MenuView, string> = {
  auto: '비트겟 자동매매',
  surge: '급등 탐색기',
  kimchi: '김프 & 송금 레이더',
  lag: '키맞추기 레이더',
  doppel: '차트 도플갱어',
  survival: '포지션 생존 성적표',
  sizing: '포지션 사이징',
  fee: '수수료 & 페이백',
  engine: '전략 엔진',
};

export function MenuTab({
  exchange,
  onExchangeChange,
  state,
  account,
  view,
  onViewChange,
  leverage,
  swapLog,
  onRescan,
  onClearLog,
  autoTrade,
  signals,
}: Props) {

  if (view) {
    return (
      <div className="tab menu-tab">
        <div className="subview-nav">
          <button className="menu-back" onClick={() => onViewChange(null)} aria-label="메뉴로 돌아가기">
            ← 메뉴
          </button>
          <b>{view === 'auto' && exchange !== 'bitget' ? '자동매매 · 비트겟 전용' : TITLES[view]}</b>
        </div>
        {view === 'auto' && (
          <AutoTradeTab
            api={autoTrade}
            signals={signals}
            exchange={exchange}
            onSwitchExchange={onExchangeChange}
          />
        )}
        {view === 'surge' && (
          <SurgeExplorer exchange={exchange} state={state} account={account} autoTrade={autoTrade} />
        )}
        {view === 'kimchi' && <KimchiRadar state={state} />}
        {view === 'lag' && <KeyMatchRadar exchange={exchange} state={state} />}
        {view === 'doppel' && <Doppelganger exchange={exchange} state={state} />}
        {view === 'survival' && <PositionSurvival state={state} account={account} />}
        {view === 'sizing' && <SizingCalc state={state} account={account} />}
        {view === 'fee' && <FeeCalc account={account} />}
        {view === 'engine' && (
          <EngineTab state={state} swapLog={swapLog} leverage={leverage} onRescan={onRescan} onClearLog={onClearLog} />
        )}
      </div>
    );
  }

  return (
    <div className="tab menu-tab">
      <section className="menu-hero">
        <div className="menu-hero-top">
          <div>
            <div className="menu-hero-eyebrow">COTA 트레이더 올인원</div>
            <h2>시장 · 리스크 · 분석</h2>
            <p>코인 트레이더가 매일 쓰는 9가지 도구를 한 곳에 모았습니다.</p>
          </div>
          <div className="menu-hero-count">
            <b>9</b>
            <span>tools</span>
          </div>
        </div>
      </section>

      <button
        type="button"
        className={`menu-auto ${autoTrade.config.enabled ? (autoTrade.tradeMode.mode === 'live' ? 'live' : 'demo') : 'off'}`}
        onClick={() => onViewChange('auto')}
        data-menu="auto"
      >
        <span className="menu-auto-emoji">🤖</span>
        <span className="menu-auto-copy">
          <b>
            비트겟 자동매매 <i className="menu-hot">NEW</i>
          </b>
          <span>
            {exchange === 'bitget'
              ? '시그널을 24시간 감시해 TP/SL 포함 자동 주문 · 1일 손실 한도'
              : `${EXCHANGES[exchange].koName} 모드 — 자동매매·원클릭 주문은 비트겟 계좌 전용`}
          </span>
          <em className={`menu-auto-badge ${autoTrade.config.enabled ? (autoTrade.tradeMode.mode === 'live' ? 'live' : 'demo') : 'off'}`} data-auto-menu-badge>
            {/* 라벨은 저장된 키의 계좌(tradeMode)와 서비스 가동 여부를 함께 따른다 — 실거래 키를 모의로 착각하지 않게. */}
            {statusBadge({ ...autoTrade.config, mode: autoTrade.tradeMode.mode }, autoTrade.running).label}
          </em>
        </span>
        <span className="menu-arrow">›</span>
      </button>

      {GROUPS.map((g) => (
        <section key={g.title} className="menu-group">
          <h3 className="menu-group-title">{g.title}</h3>
          <div className="menu-list">
            {g.items.map((item) => (
              <button key={item.key} className="menu-row" onClick={() => onViewChange(item.key)} data-menu={item.key}>
                <span className="menu-emoji">{item.emoji}</span>
                <span className="menu-copy">
                  <b>
                    {item.title}
                    {item.hot && <i className="menu-hot">NEW</i>}
                  </b>
                  <span>{item.desc}</span>
                </span>
                <span className="menu-tag">{item.tag}</span>
                <span className="menu-arrow">›</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div className="feed-note">
        모든 수치는 비트겟·업비트·빗썸·alternative.me 공개 API의 실시간 데이터와 화면 안 계산으로 만들어집니다.
        투자 권유가 아니며 판단과 책임은 본인에게 있습니다.
      </div>
    </div>
  );
}
