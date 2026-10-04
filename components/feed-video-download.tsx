'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, LoaderCircle, X } from 'lucide-react';

type Props = {
  source: string;
  code: string;
  menu: { x: number; y: number } | null;
  onClose: () => void;
};

export function FeedVideoDownload({ source, code, menu, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const popupRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const working = useRef(false);

  useEffect(() => {
    if (!menu) return;
    menuButtonRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!popupRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('wheel', onClose);
    };
  }, [menu, onClose]);

  async function download() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const { downloadPublishedDub } = await import('@/lib/mp4-exporter');
      await downloadPublishedDub(source, code);
      onClose();
    } catch {
      setError('Video indirilemedi. Tekrar dene.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" aria-label="Dublaj videosunu indir" disabled={busy} onClick={() => void download()}>
      {busy ? <LoaderCircle size={23} className="dub-download-spinner" /> : <Download size={23} />}
      <span>{busy ? 'Hazırlanıyor' : 'İndir'}</span>
    </button>
    {error && !menu && <output className="dub-download-error">{error}</output>}
    {menu && createPortal(<dialog open ref={popupRef} className="dub-download-menu" aria-label="Video indirme"
      style={{ left: menu.x, top: menu.y }}>
      <button type="button" ref={menuButtonRef} disabled={busy} onClick={() => void download()}>
        <Download size={18} />{busy ? 'Video hazırlanıyor…' : 'Dublaj videosunu indir'}
      </button>
      <button type="button" className="dub-download-close" onClick={onClose} aria-label="İndirme menüsünü kapat"><X size={18} /></button>
      {error && <output>{error}</output>}
    </dialog>, document.body)}
  </>;
}
