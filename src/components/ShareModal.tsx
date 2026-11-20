import { useEffect, useRef, useState } from 'react';
import type { Signal } from '../engine/types';
import { drawShareCard } from './shareCard';
import { CloseIcon, DownloadIcon, ShareIcon } from './Icons';

interface Props {
  signal: Signal;
  leverage: number;
  onClose: () => void;
}

export function ShareModal({ signal, leverage, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (cancelled || !canvasRef.current) return;
      drawShareCard(canvasRef.current, signal, leverage);
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
  }, [signal, leverage]);

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

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CRT-${signal.base}-${signal.tf}-${signal.side}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    }, 'image/png');
  };

  const share = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
      if (!blob) return;
      const file = new File([blob], `CRT-${signal.base}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${signal.base} ${signal.tf} CRT 시그널` });
      } else {
        save();
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
          <button className="primary" onClick={save}>
            <DownloadIcon size={17} />
            {saved ? '저장됨' : 'PNG 저장'}
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
