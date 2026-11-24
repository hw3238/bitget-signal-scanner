import { useState } from 'react';
import logoUrl from '../assets/cota-logo.png';
import { STYLE_META, type Profile, type TradeStyle } from '../lib/profile';

interface Props {
  initial?: Profile | null;
  /** 처음 실행이면 닫기 버튼 없이 시작하기로만 진행한다. */
  canClose?: boolean;
  onSave: (profile: Profile) => void;
  onClose?: () => void;
}

/**
 * 첫 실행 / 재설정 — 매매 성향만 받는 토스 스타일 온보딩.
 * v1.5.5 부터 '내 시드($)' 입력은 없어졌다. 모든 계산은 비트겟 자동매매에 연결한
 * 실계좌 잔고를 기준으로 하고, 계좌 연결은 메뉴 → 비트겟 자동매매에서 한다.
 */
export function OnboardingModal({ initial, canClose = false, onSave, onClose }: Props) {
  const [style, setStyle] = useState<TradeStyle>(initial?.style ?? 'conservative');

  const submit = () => {
    onSave({ style, updatedAt: Date.now() });
  };

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <div className="onboarding" role="dialog" aria-modal="true" aria-label="내 매매 성향 설정">
        {canClose && (
          <button type="button" className="onboarding-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        )}

        <div className="onboarding-head">
          <img src={logoUrl} alt="COTA" width={52} height={52} className="onboarding-logo" />
          <div>
            <span className="eyebrow">COTA 시작하기</span>
            <h2>내 매매 성향을 알려주세요</h2>
          </div>
        </div>
        <p className="onboarding-sub">
          성향에 맞춰 시그널마다 COTA 추천 레버리지와 1회 리스크를 정합니다. 주문 수량·예상 손익은
          <b> 비트겟 자동매매에 연결한 실계좌 잔고</b>를 기준으로 계산합니다.
        </p>

        <div className="onb-block">
          <span className="onb-label">매매 성향</span>
          <div className="style-cards" role="group" aria-label="매매 성향">
            {(Object.keys(STYLE_META) as TradeStyle[]).map((key) => {
              const meta = STYLE_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`style-card ${key} ${style === key ? 'on' : ''}`}
                  aria-pressed={style === key}
                  onClick={() => setStyle(key)}
                >
                  <span className="style-top">
                    <span className="style-emoji">{meta.emoji}</span>
                    <b>{meta.label}</b>
                  </span>
                  <span className="style-range">{meta.range}</span>
                  <span className="style-desc">{meta.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="onb-account-note" data-onb-account>
          <b>계좌를 연결하면 바로 계산됩니다</b>
          <p>
            메뉴 → 🤖 비트겟 자동매매에서 API 키를 연결하세요. 연결 전에는 시그널 카드의 주문 수량이
            비어 있고, 연결한 뒤부터 실시간 잔고 기준으로 자동 계산됩니다.
          </p>
        </div>

        <div className="onb-summary">
          <span>
            {STYLE_META[style].emoji} <b>{STYLE_META[style].label}</b> · {STYLE_META[style].range}
          </span>
        </div>

        <button type="button" className="onb-start" onClick={submit}>
          시작하기
        </button>
        <p className="onb-note">언제든 설정 탭 → 매매 성향에서 바꿀 수 있어요.</p>
      </div>
    </div>
  );
}
