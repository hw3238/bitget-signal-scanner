import { EngineIcon, FxIcon, HistoryIcon, MarketIcon, ScannerIcon, SettingsIcon } from './Icons';

export type TabKey = 'scanner' | 'fx' | 'market' | 'engine' | 'history' | 'settings';

interface NavTab {
  key: TabKey;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
}

/** 하단·상단 공통 탭 정의 — 스캐너 | FX | 시황 | 전략엔진 | 기록 | 설정 */
export const NAV_TABS: NavTab[] = [
  { key: 'scanner', label: '스캐너', icon: ScannerIcon },
  { key: 'fx', label: 'FX', icon: FxIcon },
  { key: 'market', label: '시황', icon: MarketIcon },
  { key: 'engine', label: '전략엔진', icon: EngineIcon },
  { key: 'history', label: '기록', icon: HistoryIcon },
  { key: 'settings', label: '설정', icon: SettingsIcon },
];

interface Props {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
  /** 탭별 활성 시그널 수 배지 */
  badges?: Partial<Record<TabKey, number>>;
}

export function BottomNav({ tab, onChange, badges = {} }: Props) {
  return (
    <nav className="bottom-nav" aria-label="주요 탭">
      {NAV_TABS.map((t) => {
        const Icon = t.icon;
        const badge = badges[t.key] ?? 0;
        return (
          <button
            key={t.key}
            type="button"
            data-tab={t.key}
            className={tab === t.key ? 'on' : ''}
            aria-current={tab === t.key ? 'page' : undefined}
            aria-label={badge > 0 ? `${t.label} ${badge}건` : t.label}
            onClick={() => onChange(t.key)}
          >
            <span className="nav-icon">
              <Icon size={21} />
              {badge > 0 && <i className="nav-badge">{badge > 99 ? '99+' : badge}</i>}
            </span>
            <span className="nav-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
