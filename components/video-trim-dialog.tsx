'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Scissors } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  formatTrimTime,
  normalizeTrimRange,
  trimVideoFile,
} from '@/lib/video-trimmer';

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File, duration: number) => void;
};

export function VideoTrimDialog({ file, onCancel, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [playing, setPlaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    let active = true;
    queueMicrotask(() => {
      if (active) setUrl(objectUrl);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  function changeRange(values: readonly number[]) {
    const normalized = normalizeTrimRange(values[0], values[1], duration);
    if (normalized.end - normalized.start < 0.5) return;
    setRange([normalized.start, normalized.end]);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = normalized.start;
    }
    setPlaying(false);
  }

  async function togglePreview() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      return;
    }
    try {
      if (
        video.currentTime < range[0] ||
        video.currentTime >= range[1] - 0.05
      ) {
        video.currentTime = range[0];
      }
      await video.play();
      setPlaying(true);
    } catch {
      setError('Önizleme oynatılamadı. Farklı bir video deneyin.');
    }
  }

  async function confirm() {
    if (!duration || range[1] - range[0] < 0.5) return;
    videoRef.current?.pause();
    setPlaying(false);
    setError('');

    if (range[0] <= 0.05 && duration - range[1] <= 0.05) {
      onConfirm(file, duration);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setProcessing(true);
    try {
      const clippedFile = await trimVideoFile(
        file,
        { start: range[0], end: range[1] },
        setProgress,
        controller.signal,
      );
      onConfirm(clippedFile, range[1] - range[0]);
    } catch (cause) {
      if (controller.signal.aborted) onCancel();
      else setError((cause as Error).message);
    } finally {
      abortRef.current = null;
      setProcessing(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !processing) onCancel();
      }}
    >
      <DialogContent className="trim-dialog" showCloseButton={!processing}>
        <div className="trim-heading">
          <span className="trim-eyebrow">
            <Scissors size={15} /> VİDEO HAZIRLIĞI
          </span>
          <DialogTitle>Oynanacak bölümü seç</DialogTitle>
          <DialogDescription>
            Başlangıç ve bitiş işaretlerini sürükle. Yalnızca seçtiğin bölüm
            sahneye yüklenir ve ses analizine girer.
          </DialogDescription>
        </div>

        <div className="trim-video-wrap">
          {url && (
            // The uploaded source is user-provided and has no caption track yet.
            // oxlint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              src={url}
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const measured = event.currentTarget.duration;
                if (!Number.isFinite(measured) || measured < 0.5) {
                  setError('Video süresi okunamadı. Farklı bir dosya deneyin.');
                  return;
                }
                setDuration(measured);
                setRange([0, measured]);
              }}
              onTimeUpdate={(event) => {
                if (event.currentTarget.currentTime >= range[1] - 0.04) {
                  event.currentTarget.pause();
                  setPlaying(false);
                }
              }}
              onEnded={() => setPlaying(false)}
              onError={() =>
                setError('Video açılamadı. MP4 veya WebM dosyası deneyin.')
              }
            />
          )}
          <button
            className="trim-play"
            type="button"
            disabled={!duration || processing}
            onClick={togglePreview}
            aria-label={playing ? 'Önizlemeyi durdur' : 'Seçili bölümü oynat'}
          >
            {playing ? (
              <Pause size={20} />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
        </div>

        <div className="trim-range-heading">
          <span>SEÇİLİ ARALIK</span>
          <strong>{formatTrimTime(range[1] - range[0])}</strong>
        </div>
        {duration > 0 && (
          <Slider
            className="trim-slider"
            min={0}
            max={duration}
            step={0.1}
            minStepsBetweenValues={5}
            thumbCollisionBehavior="none"
            value={range}
            onValueChange={(values) => changeRange(values as readonly number[])}
            aria-label="Video başlangıç ve bitiş aralığı"
            disabled={processing}
          />
        )}
        <div className="trim-time-inputs">
          <label>
            <span>BAŞLANGIÇ</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, range[1] - 0.5)}
              step={0.1}
              value={Number(range[0].toFixed(1))}
              onChange={(event) =>
                changeRange([Number(event.target.value), range[1]])
              }
              disabled={processing || !duration}
              aria-label="Başlangıç saniyesi"
            />
            <small>{formatTrimTime(range[0])}</small>
          </label>
          <label>
            <span>BİTİŞ</span>
            <input
              type="number"
              min={range[0] + 0.5}
              max={duration}
              step={0.1}
              value={Number(range[1].toFixed(1))}
              onChange={(event) =>
                changeRange([range[0], Number(event.target.value)])
              }
              disabled={processing || !duration}
              aria-label="Bitiş saniyesi"
            />
            <small>{formatTrimTime(range[1])}</small>
          </label>
        </div>

        {processing && (
          <output className="trim-progress">
            <div className="trim-progress-track">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>
              Kesit hazırlanıyor %{Math.round(progress * 100)} · Bu sekmeyi açık
              tut
            </span>
          </output>
        )}
        {error && (
          <p className="trim-error" role="alert">
            {error}
          </p>
        )}
        <div className="trim-actions">
          <button
            type="button"
            className="trim-cancel"
            onClick={() => {
              if (processing) abortRef.current?.abort();
              else onCancel();
            }}
          >
            İptal
          </button>
          <button
            type="button"
            className="trim-confirm"
            disabled={!duration || processing}
            onClick={confirm}
          >
            <Scissors size={16} />{' '}
            {processing ? 'Kesit hazırlanıyor…' : 'Bu kesiti kullan'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
