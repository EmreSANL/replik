'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Check, Volume2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export default function MicTestDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [hasSpoken, setHasSpoken] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
      setLevel(0);
      setError('');
      setHasSpoken(false);
      return;
    }

    let isSubscribed = true;

    async function startListening() {
      try {
        setError('');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (!isSubscribed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const dataArray = new Float32Array(analyser.fftSize);

        const checkVolume = () => {
          if (!isSubscribed) return;
          analyser.getFloatTimeDomainData(dataArray);
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sumSquares += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);
          const normalized = Math.min(100, Math.round(rms * 2500));
          setLevel(normalized);

          if (normalized > 15) {
            setHasSpoken(true);
          }

          animRef.current = requestAnimationFrame(checkVolume);
        };

        checkVolume();
      } catch (e) {
        if (isSubscribed) {
          setError(
            (e as Error).name === 'NotAllowedError'
              ? 'Mikrofon izni verilmedi. Lütfen tarayıcı izinlerinden mikrofonu etkinleştir.'
              : 'Mikrofona erişilemedi: ' + (e as Error).message,
          );
        }
      }
    }

    void startListening();

    return () => {
      isSubscribed = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [open]);

  function handleConfirm() {
    onComplete();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mic-test-dialog">
        <div className="mic-test-header">
          <div className="mic-icon-bubble">
            <Mic size={28} />
          </div>
          <DialogTitle>MİKROFON TESTİ</DialogTitle>
          <DialogDescription>
            Bir şeyler söyle, sesinin seviyesini ve netliğini kontrol et.
          </DialogDescription>
        </div>

        {error ? (
          <div className="mic-test-error">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="mic-test-body">
            <div className="mic-meter-container">
              {Array.from({ length: 14 }).map((_, i) => {
                const threshold = (i + 1) * 7;
                const isActive = level >= threshold;
                return (
                  <div
                    key={i}
                    className={`mic-meter-bar ${isActive ? 'active' : ''} ${i > 10 ? 'high' : ''}`}
                    style={{
                      height: `${Math.max(16, (i + 1) * 3.5)}px`,
                    }}
                  />
                );
              })}
            </div>

            <div className="mic-status-text">
              {hasSpoken ? (
                <span className="mic-ok">
                  <Check size={16} /> Sesin harika geliyor!
                </span>
              ) : (
                <span className="mic-waiting">
                  <Volume2 size={16} /> Mikrofona konuşmayı dene…
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mic-test-actions">
          <button
            className="primary mic-confirm-btn"
            disabled={!!error}
            onClick={handleConfirm}
          >
            <Check size={18} /> Sesim Geliyor / Testi Tamamla
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
