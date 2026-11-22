import { useMemo, useState } from 'react';
import type { Profile } from '../lib/profile';
import { fmtUsdAmount } from '../lib/profile';
import { feeCalculator, FEE_MAKER_PCT, FEE_TAKER_PCT } from '../lib/calc';
import { NumField } from './ui';

export function FeeCalc({ profile }: { profile: Profile | null }) {
  const [seed, setSeed] = useState(profile?.seed ?? 1000);
  const [leverage, setLeverage] = useState(10);
  const [tradesPerDay, setTradesPerDay] = useState(5);
  const [makerShare, setMakerShare] = useState(0.3);
  const [discountPct, setDiscountPct] = useState(0);
  const [paybackPct, setPaybackPct] = useState(0);

  const result = useMemo(
    () => feeCalculator({ seed, leverage, tradesPerDay, makerShare, discountPct, paybackPct }),
    [seed, leverage, tradesPerDay, makerShare, discountPct, paybackPct],
  );

  const percent = Math.round(makerShare * 100);

  return (
    <div className="tab fee-tab">
      <section className="panel">
        <header className="panel-head">
          <h3>수수료 계산기</h3>
          <span className="panel-note">지정가 {FEE_MAKER_PCT}% · 시장가 {FEE_TAKER_PCT}%</span>
        </header>
        <div className="form-grid">
          <NumField label="시드" value={seed} onChange={setSeed} suffix="USDT" />
          <NumField label="레버리지" value={leverage} onChange={setLeverage} suffix="x" />
          <NumField label="일일 거래 횟수 (왕복)" value={tradesPerDay} onChange={setTradesPerDay} suffix="회" />
          <div className="num-field">
            <span className="num-label">지정가 비중</span>
            <input
              className="range"
              type="range"
              min={0}
              max={100}
              step={10}
              value={percent}
              onChange={(e) => setMakerShare(Number(e.target.value) / 100)}
              aria-label="지정가 비중"
            />
            <em className="num-hint">
              지정가 {percent}% · 시장가 {100 - percent}%
            </em>
          </div>
          <NumField label="수수료 할인율" value={discountPct} onChange={setDiscountPct} suffix="%" hint="VIP·이벤트 할인" />
          <NumField label="페이백율" value={paybackPct} onChange={setPaybackPct} suffix="%" hint="파트너·리베이트" />
        </div>
      </section>

      <section className="summary-card">
        <div className="summary-title">
          월 예상 수수료 <b>{fmtUsdAmount(-result.monthlyFee)}</b>
        </div>
        <div className="summary-sub">
          포지션 규모 {result.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT · 왕복 1회{' '}
          {fmtUsdAmount(-result.roundTripFee)}
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">일</span>
            <b className="down">{fmtUsdAmount(-result.dailyFee)}</b>
          </div>
          <div className="stat">
            <span className="stat-label">월</span>
            <b className="down">{fmtUsdAmount(-result.monthlyFee)}</b>
          </div>
          <div className="stat">
            <span className="stat-label">연</span>
            <b className="down">{fmtUsdAmount(-result.yearlyFee)}</b>
          </div>
          <div className="stat">
            <span className="stat-label">연간 시드 대비</span>
            <b className="down">{((result.yearlyFee / Math.max(1, seed)) * 100).toFixed(1)}%</b>
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>할인 · 페이백 적용</h3>
          <span className="panel-note">실효 수수료 {result.effectiveFeePct.toFixed(3)}% / 왕복</span>
        </header>
        <ul className="kv-list">
          <li>
            <span>월 실제 부담</span>
            <b>{fmtUsdAmount(-result.monthlyNet)}</b>
          </li>
          <li>
            <span>연 실제 부담</span>
            <b>{fmtUsdAmount(-result.yearlyNet)}</b>
          </li>
          <li>
            <span>월 절감액</span>
            <b className="up">{fmtUsdAmount(result.monthlySaving)}</b>
          </li>
          <li>
            <span>연 절감액</span>
            <b className="up">{fmtUsdAmount(result.yearlySaving)}</b>
          </li>
        </ul>
      </section>

      <div className="feed-note">
        수수료 = 포지션 규모 × (지정가·시장가 혼합 요율) × 2(진입·청산) × 거래 횟수. 할인·페이백은 낸 수수료에 곱해
        차감합니다. 실제 정산은 거래소 등급·이벤트에 따라 달라집니다.
      </div>
    </div>
  );
}
