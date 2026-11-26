interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const ScannerIcon = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 20V10M8.5 20V4M14 20v-7M19.5 20V7" />
    <path d="M3 20h18" strokeOpacity="0" />
  </svg>
);

export const FxIcon = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 8.2h13.2M13.2 4.6l3.6 3.6-3.6 3.6" />
    <path d="M21 15.8H7.8M10.8 12.2 7.2 15.8l3.6 3.6" />
  </svg>
);

export const MarketIcon = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 16.5 9 11l3.2 3.2L20 6" />
    <path d="M15 6h5v5" />
    <path d="M4 20h16" />
  </svg>
);

export const EngineIcon = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7" />
  </svg>
);

export const MenuIcon = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="2" />
    <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="2" />
    <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="2" />
    <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="2" />
  </svg>
);

export const HistoryIcon = ({ size = 22, className }: IconProps) => (  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.4V12l3.2 1.9" />
  </svg>
);

export const SettingsIcon = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="15" cy="17" r="2" />
  </svg>
);

export const RefreshIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M20 11a8 8 0 1 0-2.6 6.4" />
    <path d="M20 4.5V11h-6.2" />
  </svg>
);

export const CloseIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const DownloadIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v10M8 10.5l4 4 4-4" />
    <path d="M4.5 18.5h15" />
  </svg>
);

export const ShareIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4M8 7.5 12 3.5l4 4" />
    <path d="M5 13v6h14v-6" />
  </svg>
);

export const SearchIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="10.6" cy="10.6" r="6.4" />
    <path d="M15.4 15.4 20 20" />
  </svg>
);

export const StarIcon = ({ size = 18, className, filled = false }: IconProps & { filled?: boolean }) => (
  <svg {...base(size)} className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.4l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75L6.8 19.45l1-5.8-4.2-4.1 5.8-.85L12 3.4Z" />
  </svg>
);

export const ArrowUpRightIcon = ({ size = 13, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7 17 17 7" />
    <path d="M9.4 7H17v7.6" />
  </svg>
);

export const CopyIcon = ({ size = 13, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2.4" />
    <path d="M15 5.6A2.6 2.6 0 0 0 12.4 3H6.6A2.6 2.6 0 0 0 4 5.6v5.8A2.6 2.6 0 0 0 6.6 14" />
  </svg>
);

export const CheckIcon = ({ size = 13, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 12.4 9.6 17.5 19.5 6.9" />
  </svg>
);

export const BoltIcon = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z" />
  </svg>
);

/** 거래소 전환 — 오른쪽 화살표 */
export const ChevronRightIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

/** 거래소 칩 좌우 전환 — ⇄ */
export const SwapIcon = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);
