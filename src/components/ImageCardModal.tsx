import { useEffect, useRef, useState } from 'react';
import { CloseIcon, DownloadIcon, ShareIcon } from './Icons';
import { saveCanvasPng, shareCanvasPng } from '../lib/shareImage';

interface Props {
  title: string;
  /** 파일명 (확장자 제외) */
  fileName: string;
  /** 캔버스를 그리는 함수. 폰트 로딩 후 호출된다. */
  draw: (canvas: HTMLCanvasElement) => Promise<void> | void;
  hint?: string;
  onClose: () => void;
}

/** PNG 카드 저장/공유 모달 — 시황 속보 · 생존 성적표 · 도플갱어 공용 */
export function ImageCardModal({ title, fileName, draw, hint, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<'saved' | 'failed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!canvasRef.current) return;
      try {
        await draw(canvasRef.current);
      } catch {
        /* 그리기 실패 시에도 모달은 열어 둔다 */
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    if (document.fonts?.ready) document.fonts.ready.then(() => void run()).catch(() => void run());
    else void run();
    return () => {
      cancelled = true;
    };
  }, [draw]);

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

  const flashOnce = (state: 'saved' | 'failed') => {
    setFlash(state);
    setTimeout(() => setFlash(null), 2200);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    flashOnce((await saveCanvasPng(canvas, `${fileName}.png`)) ? 'saved' : 'failed');
  };

  const share = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    await shareCanvasPng(canvas, `${fileName}.png`, title);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="share-modal card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-modal-head">
          <b>{title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="share-frame">
          <canvas ref={canvasRef} className={`share-canvas ${ready ? 'in' : ''}`} aria-label={title} />
        </div>
        <div className="share-actions">
          <button className="primary" onClick={() => void save()}>
            <DownloadIcon size={17} />
            {flash === 'saved' ? '저장됨' : flash === 'failed' ? '저장 실패' : 'PNG 저장'}
          </button>
          <button onClick={() => void share()}>
            <ShareIcon size={17} />
            공유
          </button>
          <button className="icon-only" onClick={onClose} aria-label="닫기">
            <CloseIcon size={18} />
          </button>
        </div>
        {hint && <p className="card-modal-hint">{hint}</p>}
      </div>
    </div>
  );
}
