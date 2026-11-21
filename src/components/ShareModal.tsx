import { useEffect, useRef, useState } from 'react';
import type { Signal } from '../engine/types';
import { drawShareCard } from './shareCard';
import { CloseIcon, DownloadIcon, ShareIcon, StarIcon } from './Icons';
import { isNativeApp, saveImageToDevice, shareImageFromDevice } from '../lib/native';
import type { Profile } from '../lib/profile';

interface Props {
  signal: Signal;
  leverage: number;
  profile?: Profile | null;
  auto?: boolean;
  isFavorite: boolean;
  onToggleFavorite: (signal: Signal) => void;
  onClose: () => void;
}

export function ShareModal({ signal, leverage, profile = null, auto = false, isFavorite, onToggleFavorite, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (cancelled || !canvasRef.current) return;
      drawShareCard(canvasRef.current, signal, leverage, profile, auto);
      setReady(true);
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(draw).catch(draw);
    } else {
      draw();
    }
    return () => {
      cancelled = true;
    };
  }, [signal, leverage, profile, auto]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  const fileName = `CRT-${signal.base}-${signal.tf}-${signal.side}.png`;

  const flash = (state: 'saved' | 'failed') => {
    setSaved(state === 'saved');
    setFailed(state === 'failed');
    setTimeout(() => {
      setSaved(false);
      setFailed(false);
    }, 2200);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
    if (!blob) return;
    if (isNativeApp()) {
      // WebView에서는 blob 다운로드가 막히므로 네이티브 저장(갤러리)으로 처리
      try {
        await saveImageToDevice(blob, fileName);
        flash('saved');
      } catch {
        flash('failed');
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    flash('saved');
  };

  const share = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
      if (!blob) return;
      const file = new File([blob], fileName, { type: 'image/png' });
      if (isNativeApp()) {
        await shareImageFromDevice(blob, fileName);
        return;
      }
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${signal.base} ${signal.tf} CRT 시그널` });
      } else {
        await save();
      }
    } catch {
      /* 사용자가 공유를 취소한 경우 */
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-frame">
          <canvas ref={canvasRef} className={`share-canvas ${ready ? 'in' : ''}`} aria-label="시그널 공유 카드" />
        </div>
        <div className="share-actions">
          <button
            type="button"
            className={`fav-action ${isFavorite ? 'on' : ''}`}
            aria-pressed={isFavorite}
            onClick={() => onToggleFavorite(signal)}
          >
            <StarIcon size={16} filled={isFavorite} />
            {isFavorite ? '즐겨찾기됨' : '즐겨찾기'}
          </button>
          <button className="primary" onClick={() => void save()}>
            <DownloadIcon size={17} />
            {saved ? '저장됨' : failed ? '저장 실패' : 'PNG 저장'}
          </button>
          <button onClick={share}>
            <ShareIcon size={17} />
            공유
          </button>
          <button className="icon-only" onClick={onClose} aria-label="닫기">
            <CloseIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
