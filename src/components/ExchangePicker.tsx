import logoUrl from '../assets/cota-logo.png';
import { EXCHANGE_ORDER, EXCHANGES, type Exchange } from '../lib/exchange';
import { ChevronRightIcon } from './Icons';

interface OptionProps {
  exchange: Exchange;
  current: Exchange | null;
  onPick: (exchange: Exchange) => void;
  /** 시트(전환)에서는 현재 거래소를 `사용 중` 으로 표시한다 */
  markCurrent: boolean;
}

function ExchangeOption({ exchange, current, onPick, markCurrent }: OptionProps) {
  const meta = EXCHANGES[exchange];
  const active = current === exchange;
  return (
    <button
      type="button"
      className={`exchange-option ${exchange} ${active ? 'on' : ''}`}
      data-exchange-option={exchange}
      aria-pressed={active}
      onClick={() => onPick(exchange)}
    >
      <span className="exchange-option-logo" style={{ background: `${meta.tint}1f` }}>
        <img src={meta.logo} alt={`${meta.name} 로고`} width={40} height={40} data-exchange-logo={exchange} />
      </span>
      <span className="exchange-option-copy">
        <b>
          {meta.name} <em>({meta.koName})</em>
        </b>
        <span>{meta.desc}</span>
      </span>
      {markCurrent && active ? (
        <span className="exchange-option-badge" data-exchange-current>
          사용 중
        </span>
      ) : (
        <span className="exchange-option-arrow">
          <ChevronRightIcon size={16} />
        </span>
      )}
    </button>
  );
}

/** 첫 방문 — 거래소를 고르기 전에는 스캐너를 열지 않는다. */
export function ExchangeGate({ onPick }: { onPick: (exchange: Exchange) => void }) {
  return (
    <div className="exchange-gate" data-exchange-gate>
      <div className="exchange-gate-inner">
        <img className="exchange-gate-logo" src={logoUrl} alt="COTA" width={56} height={56} />
        <h1>어느 거래소를 쓰세요?</h1>
        <p>
          고른 거래소의 마켓만 따로 스캔합니다.
          <br />
          선택은 언제든 바꿀 수 있어요.
        </p>
        <div className="exchange-options">
          {EXCHANGE_ORDER.map((ex) => (
            <ExchangeOption key={ex} exchange={ex} current={null} onPick={onPick} markCurrent={false} />
          ))}
        </div>
        <div className="exchange-gate-foot">
          <b>바이낸스</b>는 USDT 마켓 시그널·급등 탐지, <b>비트겟</b>은 시그널에 더해 24시간 자동매매까지.
        </div>
      </div>
    </div>
  );
}

/** 헤더 칩·설정 카드에서 여는 전환 시트 */
export function ExchangeSheet({
  current,
  onPick,
  onClose,
}: {
  current: Exchange;
  onPick: (exchange: Exchange) => void;
  onClose: () => void;
}) {
  return (
    <div className="exchange-sheet-backdrop" data-exchange-sheet onClick={onClose} role="presentation">
      <div
        className="exchange-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="거래소 전환"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="exchange-sheet-head">
          <b>거래소 전환</b>
          <button type="button" className="exchange-sheet-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <p className="exchange-sheet-note">바꾸면 이전 거래소의 시그널을 지우고 새 마켓만 다시 스캔합니다.</p>
        <div className="exchange-options">
          {EXCHANGE_ORDER.map((ex) => (
            <ExchangeOption key={ex} exchange={ex} current={current} onPick={onPick} markCurrent />
          ))}
        </div>
      </div>
    </div>
  );
}
