import { useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { AutoTradeApi } from '../hooks/useAutoTrade';
import type { Signal } from '../engine/types';
import type { AccountBase } from '../lib/account';
import type { SwapLogEntry } from '../lib/storage';
import { AutoTradeTab } from './AutoTradeTab';
import { AccountCard } from './AccountCard';
import { AdminDashboard } from './AdminDashboard';
import type { AccountAuthApi } from '../hooks/useAccountAuth';
import { SurgeExplorer } from './SurgeExplorer';
import { ProprTab } from './ProprTab';
import type { ProprState } from '../hooks/usePropr';
import type { TF } from '../engine/types';
import { statusBadge } from '../lib/autotrade';
import { EXCHANGES, type Exchange } from '../lib/exchange';
import { EngineTab } from './EngineTab';
import { KimchiRadar } from './KimchiRadar';
import { KeyMatchRadar } from './KeyMatchRadar';
import { Doppelganger } from './Doppelganger';
import { PositionSurvival } from './PositionSurvival';
import { SizingCalc } from './SizingCalc';
import { FeeCalc } from './FeeCalc';
import { TradeDnaTab } from './TradeDnaTab';
import { LiquidationMagnet } from './LiquidationMagnet';
import { SectorRadar } from './SectorRadar';
import { WhaleTapeTab } from './WhaleTapeTab';
import { NewsTab } from './NewsTab';
import { AlertsTab } from './AlertsTab';
import type { useAlertCenter } from '../lib/alertBridge';
import type { HistoryRecord, MyTrade } from '../lib/storage';

export type MenuView =
  | 'alerts'
  | 'auto'
  | 'propr'
  | 'surge'
  | 'whale'
  | 'news'
  | 'magnet'
  | 'sector'
  | 'kimchi'
  | 'lag'
  | 'doppel'
  | 'survival'
  | 'sizing'
  | 'fee'
  | 'dna'
  | 'engine'
  /** 관리자 전용 — role === 'admin' 일 때만 메뉴에 나타난다 */
  | 'admin';

interface MenuItem {
  key: MenuView;
  emoji: string;
  title: string;
  /** 한 줄 설명 — 35~40자 안쪽으로 유지한다(카드가 2줄로 늘어지지 않게) */
  desc: string;
  tag: string;
  hot?: boolean;
  /** 검색 보조 키워드 */
  keywords?: string;
}

/** 상단 카테고리 칩 — 그룹과 1:1로 대응 */
const CATEGORIES: Array<{ key: 'all' | 'alert' | 'radar' | 'risk' | 'analysis'; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'alert', label: '알림·시황' },
  { key: 'radar', label: '실전 레이더' },
  { key: 'risk', label: '계산·리스크' },
  { key: 'analysis', label: '분석' },
];

type CategoryKey = (typeof CATEGORIES)[number]['key'];

const GROUPS: Array<{ key: Exclude<CategoryKey, 'all'>; title: string; items: MenuItem[] }> = [
  {
    key: 'alert',
    title: '알림 · 시황',
    items: [
      {
        key: 'alerts',
        emoji: '🎯',
        title: '맞춤 알림 · 경제지표',
        desc: '지정가·RSI 알림 + 지표 예상치·롱숏 가이드',
        tag: '알림 4종',
        hot: true,
        keywords: '알림 푸시 지정가 경제지표 매크로 FOMC CPI NFP',
      },
      {
        key: 'news',
        emoji: '📰',
        title: '실시간 코인 뉴스',
        desc: '4개 피드 60초 갱신 · 호재·악재 자동 태그',
        tag: '4개 피드',
        hot: true,
        keywords: '뉴스 속보 블록미디어 코인데스크',
      },
    ],
  },
  {
    key: 'radar',
    title: '실전 레이더',
    items: [
      {
        key: 'whale',
        emoji: '🐋',
        title: '고래 체결 테이프',
        desc: '유동성 상위 15종목의 큰 체결만 실시간',
        tag: '실시간 체결',
        hot: true,
        keywords: '고래 체결 테이프 큰손',
      },
      {
        key: 'surge',
        emoji: '🚀',
        title: '급등 탐색기',
        desc: '6가지 급등 요건 점수로 출발 직전 코인 추천',
        tag: '6요건 · 100점',
        hot: true,
        keywords: '급등 급등주 탐색',
      },
      {
        key: 'magnet',
        emoji: '🧲',
        title: '청산 자석 레이더',
        desc: '위·아래 청산 물량 뭉치와 스퀴즈 가격대',
        tag: '청산 추정',
        hot: true,
        keywords: '청산 스퀴즈 롱숏 물량',
      },
      {
        key: 'sector',
        emoji: '🌊',
        title: '섹터 자금 순환',
        desc: 'AI·밈·L1 테마 순위와 대장주·후발주',
        tag: '테마 순환',
        hot: true,
        keywords: '섹터 테마 순환매',
      },
      {
        key: 'lag',
        emoji: '🎯',
        title: '키맞추기 레이더',
        desc: '비트는 갔는데 안 따라온 후발주 찾기',
        tag: '상관 · 괴리',
        keywords: '상관 괴리 후발주 키맞추기',
      },
      {
        key: 'kimchi',
        emoji: '🥬',
        title: '김프 & 송금 레이더',
        desc: '국내·해외 시세 차이와 유리한 송금 코인',
        tag: '업비트 ↔ 비트겟',
        keywords: '김치프리미엄 김프 송금',
      },
      {
        key: 'propr',
        emoji: '🏆',
        title: 'Propr 5K 터보 시그널',
        desc: '프랍 5K 규정에 맞춘 레버리지·주문 가이드',
        tag: '프랍 · 5K',
        hot: true,
        keywords: '프랍 propr 5k 터보',
      },
    ],
  },
  {
    key: 'risk',
    title: '리스크 · 계산기',
    items: [
      {
        key: 'survival',
        emoji: '🩺',
        title: '포지션 생존 성적표',
        desc: '청산가·물타기·펀딩비를 S~F 등급으로 진단',
        tag: '청산 시뮬',
        keywords: '청산가 물타기 생존',
      },
      {
        key: 'sizing',
        emoji: '📐',
        title: '포지션 사이징',
        desc: '손실률 먼저 정하고 수량·배율·손익비 계산',
        tag: 'R:R',
        keywords: '사이징 수량 계산',
      },
      {
        key: 'fee',
        emoji: '🧾',
        title: '수수료 & 페이백',
        desc: '매매 습관대로 한 달·1년 수수료 확인',
        tag: '비용',
        keywords: '수수료 페이백 계산',
      },
    ],
  },
  {
    key: 'analysis',
    title: '분석 · 엔진',
    items: [
      {
        key: 'dna',
        emoji: '🧠',
        title: '내 매매 DNA',
        desc: '시간대·배율·롱숏 습관 진단과 뇌동매매 차단',
        tag: '습관 진단',
        hot: true,
        keywords: '매매 dna 습관 뇌동매매',
      },
      {
        key: 'doppel',
        emoji: '🔮',
        title: '차트 도플갱어',
        desc: '지금 차트와 닮은 과거 구간 TOP 3',
        tag: '패턴 매칭',
        keywords: '도플갱어 패턴 과거',
      },
      {
        key: 'engine',
        emoji: '⚙️',
        title: '전략 엔진',
        desc: '전략별 승률·손익비와 시그널 성과 확인',
        tag: '백테스트',
        keywords: '전략 엔진 백테스트 승률',
      },
    ],
  },
];

/** 자동매매를 포함한 전체 도구 수 */
export const MENU_TOOL_COUNT = GROUPS.reduce((sum, g) => sum + g.items.length, 0) + 1;

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
  /** 🔐 계정 — 로그인 카드·관리자 메뉴 */
  auth: AccountAuthApi;
  /** 🏆 Propr 5K 터보 전용 탐지 — 메인 스캐너·자동매매와 완전히 분리된 상태 */
  propr: {
    state: ProprState;
    scan: (opts?: { force?: boolean; all?: boolean; tf?: TF }) => void;
    setTf: (tf: TF) => void;
  };
  /** 🧠 내 매매 DNA — 매매일지(시그널 이력 + 내 진입)와 실계좌 체결 */
  history: HistoryRecord[];
  myTrades: MyTrade[];
  /** 🔔 알림 센터 상태·동작 */
  alerts: ReturnType<typeof useAlertCenter>;
}

const TITLES: Record<MenuView, string> = {
  alerts: '맞춤 알림 · 경제지표',
  auto: '비트겟 자동매매',
  propr: 'Propr 5K 터보 시그널',
  surge: '급등 탐색기',
  whale: '고래 체결 테이프',
  news: '실시간 코인 뉴스',
  magnet: '청산 자석 레이더',
  sector: '섹터 자금 순환',
  kimchi: '김프 & 송금 레이더',
  lag: '키맞추기 레이더',
  doppel: '차트 도플갱어',
  survival: '포지션 생존 성적표',
  sizing: '포지션 사이징',
  fee: '수수료 & 페이백',
  dna: '내 매매 DNA',
  engine: '전략 엔진',
  admin: '관리자 대시보드',
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
  auth,
  propr,
  history,
  myTrades,
  alerts,
}: Props) {
  const [category, setCategory] = useState<CategoryKey>('all');
  const [query, setQuery] = useState('');

  /** 메뉴 배지 — 이번 세션 탐지가 있으면 그 값, 없으면 지난 탐 요약(재진입 직후) */
  const proprOpen = propr.state.hits.length
    ? propr.state.hits.filter((h) => h.signal.state === 'open').length
    : (propr.state.lastRun?.openCount ?? 0);
  /** 아직 한 번도 탐지하지 않았으면 배지를 달지 않는다(0건을 실적으로 오해하지 않게) */
  const proprBadge = propr.state.at || propr.state.lastRun || proprOpen > 0 ? `${proprOpen}건 진행` : '';
  /** 알림 센터 배지 — 감시 중인 조건 수 */
  const alertBadge = alerts.active.length > 0 ? `${alerts.active.length}건 감시` : '';

  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    return GROUPS.filter((g) => category === 'all' || g.key === category)
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          if (!q) return true;
          const hay = `${item.title} ${item.desc} ${item.tag} ${item.keywords ?? ''} ${item.emoji}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [category, q]);
  const shownCount = visibleGroups.reduce((sum, g) => sum + g.items.length, 0);
  const filtering = category !== 'all' || q.length > 0;

  if (view) {
    return (
      <div className="tab menu-tab">
        <div className="subview-nav">
          <button className="menu-back" onClick={() => onViewChange(null)} aria-label="메뉴로 돌아가기">
            ← 메뉴
          </button>
          <b>{view === 'auto' && exchange !== 'bitget' ? '자동매매 · 비트겟 전용' : TITLES[view]}</b>
        </div>
        {view === 'alerts' && <AlertsTab exchange={exchange} state={state} center={alerts} />}
        {view === 'auto' && (
          <AutoTradeTab
            api={autoTrade}
            signals={signals}
            exchange={exchange}
            onSwitchExchange={onExchangeChange}
          />
        )}
        {view === 'propr' && <ProprTab state={propr.state} scan={propr.scan} setTf={propr.setTf} />}
        {view === 'surge' && (
          <SurgeExplorer exchange={exchange} state={state} account={account} autoTrade={autoTrade} />
        )}
        {view === 'whale' && <WhaleTapeTab exchange={exchange} state={state} />}
        {view === 'news' && <NewsTab />}
        {view === 'magnet' && <LiquidationMagnet exchange={exchange} state={state} />}
        {view === 'sector' && <SectorRadar exchange={exchange} state={state} onRescan={onRescan} />}
        {view === 'dna' && <TradeDnaTab history={history} myTrades={myTrades} autoTrade={autoTrade} />}
        {view === 'kimchi' && <KimchiRadar state={state} exchange={exchange} />}
        {view === 'lag' && <KeyMatchRadar exchange={exchange} state={state} />}
        {view === 'doppel' && <Doppelganger exchange={exchange} state={state} />}
        {view === 'survival' && <PositionSurvival state={state} account={account} />}
        {view === 'sizing' && <SizingCalc state={state} account={account} />}
        {view === 'fee' && <FeeCalc account={account} />}
        {view === 'engine' && (
          <EngineTab state={state} swapLog={swapLog} leverage={leverage} onRescan={onRescan} onClearLog={onClearLog} />
        )}
        {view === 'admin' && <AdminDashboard auth={auth} />}
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
            <p>코인 트레이더가 매일 쓰는 {MENU_TOOL_COUNT}가지 도구를 한 곳에 모았습니다.</p>
          </div>
          <div className="menu-hero-count">
            <b>{MENU_TOOL_COUNT}</b>
            <span>tools</span>
          </div>
        </div>

        {/* 카테고리 칩 + 검색 — 16개 도구를 스크롤 없이 찾는다 */}
        <div className="menu-finder" data-menu-finder>
          <div className="menu-search">
            <span aria-hidden>🔎</span>
            <input
              type="search"
              value={query}
              placeholder="도구 검색 — 예: 알림, 청산, 김프"
              aria-label="메뉴 도구 검색"
              data-menu-search
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="menu-search-clear" onClick={() => setQuery('')} aria-label="검색 지우기">
                ✕
              </button>
            )}
          </div>
          <div className="menu-chips" role="tablist" aria-label="도구 카테고리">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={category === c.key}
                className={`menu-chip ${category === c.key ? 'on' : ''}`}
                data-menu-chip={c.key}
                onClick={() => setCategory(c.key)}
              >
                {c.label}
                <i>
                  {c.key === 'all'
                    ? GROUPS.reduce((n, g) => n + g.items.length, 0)
                    : (GROUPS.find((g) => g.key === c.key)?.items.length ?? 0)}
                </i>
              </button>
            ))}
          </div>
          {filtering && (
            <div className="menu-finder-summary" data-menu-summary>
              {q ? `“${query.trim()}” ` : ''}검색 결과 {shownCount}개
              <button
                type="button"
                className="menu-reset"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
              >
                초기화
              </button>
            </div>
          )}
        </div>
      </section>

      <AccountCard auth={auth} variant="menu" />

      {auth.isAdmin && (
        <section className="menu-group" data-admin-group>
          <h3 className="menu-group-title">관리자</h3>
          <div className="menu-list">
            <button className="menu-row admin" onClick={() => onViewChange('admin')} data-menu="admin">
              <span className="menu-emoji">🛡️</span>
              <span className="menu-copy">
                <b>
                  관리자 대시보드 <i className="menu-hot admin">ADMIN</i>
                </b>
                <span>가입 유저 · 거래소/API 연결 · 자동매매 현황</span>
              </span>
              <span className="menu-tag">전체 유저</span>
              <span className="menu-arrow">›</span>
            </button>
          </div>
        </section>
      )}

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
              ? '시그널을 24시간 감시해 TP/SL 포함 자동 주문'
              : `${EXCHANGES[exchange].koName} 모드 — 자동매매는 비트겟 전용`}
          </span>
          <em className={`menu-auto-badge ${autoTrade.config.enabled ? (autoTrade.tradeMode.mode === 'live' ? 'live' : 'demo') : 'off'}`} data-auto-menu-badge>
            {/* 라벨은 저장된 키의 계좌(tradeMode)와 서비스 가동 여부를 함께 따른다 — 실거래 키를 모의로 착각하지 않게. */}
            {statusBadge({ ...autoTrade.config, mode: autoTrade.tradeMode.mode }, autoTrade.running).label}
          </em>
        </span>
        <span className="menu-arrow">›</span>
      </button>

      {visibleGroups.map((g) => (
        <section key={g.key} className="menu-group" data-menu-group={g.key}>
          <h3 className="menu-group-title">{g.title}</h3>
          <div className="menu-list">
            {g.items.map((item) => (
              <button key={item.key} className="menu-row" onClick={() => onViewChange(item.key)} data-menu={item.key}>
                <span className="menu-emoji">{item.emoji}</span>
                <span className="menu-copy">
                  <b>
                    {item.title}
                    {item.hot && <i className="menu-hot">NEW</i>}
                    {item.key === 'propr' && proprBadge && (
                      <span className="menu-badge-count" data-propr-menu-badge>
                        {proprBadge}
                      </span>
                    )}
                    {item.key === 'alerts' && alertBadge && (
                      <span className="menu-badge-count" data-alert-menu-badge>
                        {alertBadge}
                      </span>
                    )}
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

      {visibleGroups.length === 0 && (
        <div className="menu-empty" data-menu-empty>
          <b>“{query.trim()}”</b> 에 맞는 도구가 없습니다.
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setQuery('');
              setCategory('all');
            }}
          >
            전체 도구 보기
          </button>
        </div>
      )}

      <div className="feed-note">
        모든 수치는 비트겟·업비트·빗썸·alternative.me 공개 API의 실시간 데이터와 화면 안 계산으로 만들어집니다.
        투자 권유가 아니며 판단과 책임은 본인에게 있습니다.
      </div>
    </div>
  );
}
