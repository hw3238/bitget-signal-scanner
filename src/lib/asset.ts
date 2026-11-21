import type { AssetClass } from '../engine/types';

export function assetLabel(asset: AssetClass): string {
  if (asset === 'stock') return '주식선물';
  if (asset === 'fx') return 'FX·금';
  return '코인';
}

/** 카드 배지용 CSS 클래스 */
export function assetClass(asset: AssetClass): 'stock' | 'fx' | 'crypto' {
  if (asset === 'stock') return 'stock';
  if (asset === 'fx') return 'fx';
  return 'crypto';
}

/** 카드 좌측 로고 글자 — `XAUUSD+` → `XAU`, `NAS100+` → `NAS` */
export function symbolLogo(base: string): string {
  const clean = base.replace(/\+$/, '');
  return clean.length > 4 ? clean.slice(0, 3) : clean;
}
