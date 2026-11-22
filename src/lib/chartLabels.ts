/**
 * 미니 캔들 차트 우측 가격 라벨 배치.
 * 목표가·진입가·손절가가 서로 가까우면(손절 폭 0.3% 시그널 등) 라벨이 겹치므로
 * 위아래로 최소 간격만큼 밀어 겹침 없이 배치한다. 순수 함수(scripts/cockpit-check.ts 검증).
 */

export type PriceLabelKey = 'target' | 'entry' | 'stop';

export interface PriceLabelInput {
  key: PriceLabelKey;
  /** 차트 viewBox 기준 y 좌표 */
  y: number;
}

export interface PriceLabelPlacement {
  key: PriceLabelKey;
  /** 차트 viewBox 기준 y 좌표 — 라벨 중심 */
  top: number;
}

export interface LabelLayoutOptions {
  /** 차트 viewBox 높이 */
  height: number;
  /** 라벨 높이(viewBox 단위) */
  labelHeight?: number;
  /** 위·아래 여백 */
  pad?: number;
}

export function layoutPriceLabels(
  inputs: PriceLabelInput[],
  opts: LabelLayoutOptions,
): PriceLabelPlacement[] {
  const height = Math.max(1, opts.height);
  const labelH = Math.max(4, opts.labelHeight ?? 12);
  const pad = Math.max(0, opts.pad ?? 4);
  const half = labelH / 2;
  const minTop = pad + half;
  const maxTop = height - pad - half;
  const minGap = labelH + 1;

  const clamp = (v: number) => Math.min(maxTop, Math.max(minTop, v));
  const rows = inputs
    .map((r) => ({ key: r.key, top: clamp(Number.isFinite(r.y) ? r.y : minTop) }))
    .sort((a, b) => a.top - b.top);

  // 위에서 아래로 최소 간격 확보
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].top - rows[i - 1].top < minGap) rows[i].top = rows[i - 1].top + minGap;
  }
  // 아래로 넘치면 통째로 올린 뒤 다시 위쪽부터 간격을 맞춘다
  const last = rows[rows.length - 1];
  const overflow = last ? last.top - maxTop : 0;
  if (overflow > 0) {
    for (const row of rows) row.top -= overflow;
    for (let i = 0; i < rows.length; i += 1) rows[i].top = clamp(rows[i].top);
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].top - rows[i - 1].top < minGap) rows[i].top = rows[i - 1].top + minGap;
    }
  }

  // 입력 순서를 유지해 DOM 순서를 안정적으로
  const byKey = new Map(rows.map((r) => [r.key, r.top]));
  return inputs.map((r) => ({ key: r.key, top: byKey.get(r.key) ?? clamp(r.y) }));
}
