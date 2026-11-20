export function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 10000) return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  if (abs >= 100) return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (abs >= 0.01)
    return value.toLocaleString('ko-KR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return value.toPrecision(4);
}

export function fmtPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtVolume(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

const KST = 'Asia/Seoul';

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', {
    timeZone: KST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: KST,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

export function tfLabel(tf: string): string {
  return tf === '1H' ? '1시간' : '4시간';
}

export function sideLabel(side: 'long' | 'short'): string {
  return side === 'long' ? '롱' : '숏';
}
