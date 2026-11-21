import { useState } from 'react';
import logoUrl from '../assets/cota-logo.png';
import {
  DEFAULT_SEED,
  SEED_PRESETS,
  STYLE_META,
  fmtSeed,
  type Profile,
  type TradeStyle,
} from '../lib/profile';

interface Props {
  initial?: Profile | null;
  /** 처음 실행이면 닫기 버튼 없이 시작하기로만 진행한다. */
  canClose?: boolean;
  onSave: (profile: Profile) => void;
  onClose?: () => void;
}

/** 첫 실행 / 재설정 — 시드와 매매 성향을 받는 토스 스타일 온보딩 */
export function OnboardingModal({ initial, canClose = false, onSave, onClose }: Props) {
  const [seed, setSeed] = useState<number>(initial?.seed ?? DEFAULT_SEED);
  const [style, setStyle] = useState<TradeStyle>(initial?.style ?? 'conservative');

  const valid = Number.isFinite(seed) && seed > 0;

  const submit = () => {
    if (!valid) return;
    onSave({ seed: Math.round(seed), style, updatedAt: Date.now() });
  };

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <div className="onboarding" role="dialog" aria-modal="true" aria-label="내 투자 프로필 설정">
        {canClose && (
          <button type="button" className="onboarding-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        )}

        <div className="onboarding-head">
          <img src={logoUrl} alt="COTA" width={52} height={52} className="onboarding-logo" />
          <div>
            <span className="eyebrow">COTA 시작하기</span>
            <h2>내 시드와 매매 성향을 알려주세요</h2>
          </div>
        </div>
        <p className="onboarding-sub">
          시드와 성향에 맞춰 시그널마다 COTA 추천 레버리지와 예상 수익·손실을 계산해 보여드립니다.
        </p>

        <div className="onb-block">
          <span className="onb-label">내 투자 시드 (USDT)</span>
          <label className="seed-input">
            <span>$</span>
            <input
              type="text"
              inputMode="numeric"
              value={fmtSeed(seed)}
              aria-label="내 투자 시드"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
                setSeed(digits ? Number(digits) : 0);
              }}
            />
          </label>
          <div className="seed-presets" role="group" aria-label="시드 프리셋">
            {SEED_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`seed-chip ${seed === p ? 'on' : ''}`}
                aria-pressed={seed === p}
                onClick={() => setSeed(p)}
              >
                ${fmtSeed(p)}
              </button>
            ))}
          </div>
        </div>

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

        <div className="onb-summary">
          <span>
            시드 <b>${fmtSeed(seed || 0)}</b>
          </span>
          <span>
            {STYLE_META[style].emoji} <b>{STYLE_META[style].label}</b> · {STYLE_META[style].range}
          </span>
        </div>

        <button type="button" className="onb-start" onClick={submit} disabled={!valid}>
          시작하기
        </button>
        <p className="onb-note">언제든 설정 탭 → 내 투자 프로필에서 바꿀 수 있어요.</p>
      </div>
    </div>
  );
}
