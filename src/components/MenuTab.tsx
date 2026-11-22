import { useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { Profile } from '../lib/profile';
import type { SwapLogEntry } from '../lib/storage';
import { EngineTab } from './EngineTab';
import { KimchiRadar } from './KimchiRadar';
import { KeyMatchRadar } from './KeyMatchRadar';
import { Doppelganger } from './Doppelganger';
import { PositionSurvival } from './PositionSurvival';
import { SizingCalc } from './SizingCalc';
import { FeeCalc } from './FeeCalc';

export type MenuView = 'kimchi' | 'lag' | 'doppel' | 'survival' | 'sizing' | 'fee' | 'engine';

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
        key: 'kimchi',
        emoji: '🚀',
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
  state: ScanState;
  profile: Profile | null;
  leverage: number;
  swapLog: SwapLogEntry[];
  onRescan: () => void;
  onClearLog: () => void;
}

const TITLES: Record<MenuView, string> = {
  kimchi: '김프 & 송금 레이더',
  lag: '키맞추기 레이더',
  doppel: '차트 도플갱어',
  survival: '포지션 생존 성적표',
  sizing: '포지션 사이징',
  fee: '수수료 & 페이백',
  engine: '전략 엔진',
};

export function MenuTab({ state, profile, leverage, swapLog, onRescan, onClearLog }: Props) {
  const [view, setView] = useState<MenuView | null>(null);

  if (view) {
    return (
      <div className="tab menu-tab">
        <div className="subview-nav">
          <button className="menu-back" onClick={() => setView(null)} aria-label="메뉴로 돌아가기">
            ← 메뉴
          </button>
          <b>{TITLES[view]}</b>
        </div>
        {view === 'kimchi' && <KimchiRadar state={state} />}
        {view === 'lag' && <KeyMatchRadar state={state} />}
        {view === 'doppel' && <Doppelganger state={state} />}
        {view === 'survival' && <PositionSurvival state={state} profile={profile} />}
        {view === 'sizing' && <SizingCalc state={state} profile={profile} />}
        {view === 'fee' && <FeeCalc profile={profile} />}
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
            <p>코인 트레이더가 매일 쓰는 7가지 도구를 한 곳에 모았습니다.</p>
          </div>
          <div className="menu-hero-count">
            <b>7</b>
            <span>tools</span>
          </div>
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="menu-group">
          <h3 className="menu-group-title">{g.title}</h3>
          <div className="menu-list">
            {g.items.map((item) => (
              <button key={item.key} className="menu-row" onClick={() => setView(item.key)} data-menu={item.key}>
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
