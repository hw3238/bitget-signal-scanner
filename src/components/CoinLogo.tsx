import { useEffect, useMemo, useState } from 'react';
import type { AssetClass } from '../engine/types';
import { symbolLogo } from '../lib/asset';
import { coinIconUrl } from '../lib/coinLogo';

interface Props {
  base: string;
  asset: AssetClass;
  /** 롱/숏 — 이미지가 없을 때 글자 아바타 색 */
  side?: 'long' | 'short';
  size?: number;
  className?: string;
}

/**
 * 종목 로고.
 * 내장 코인 아이콘(매니페스트에 있는 코인)을 먼저 보여 주고, 아이콘이 없는
 * 신규 코인·주식선물은 토스 스타일 둥근 글자 아바타로 깔끔하게 남긴다.
 * 깨진 이미지 아이콘은 노출하지 않는다.
 */
export function CoinLogo({ base, asset, side, size = 40, className = '' }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const sideClass = side ? ` ${side}` : '';
  const letter = useMemo(() => symbolLogo(base), [base]);

  // 종목이 바뀌면(카드 재사용) 아이콘을 다시 찾는다.
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setLoaded(false);
    void coinIconUrl(base, asset).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [base, asset]);

  return (
    <div
      className={`sym-logo${sideClass}${src ? ' has-img' : ''} ${className}`.trim()}
      style={{ width: size, height: size }}
      title={base}
    >
      <span className="sym-logo-text" aria-hidden={src && loaded ? true : undefined}>
        {letter}
      </span>
      {src && (
        <img
          className={`sym-logo-img${loaded ? ' in' : ''}`}
          src={src}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            // 아이콘 파일이 없거나 깨졌으면 글자 아바타만 남긴다.
            setLoaded(false);
            setSrc(null);
          }}
        />
      )}
    </div>
  );
}
