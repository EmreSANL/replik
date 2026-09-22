'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Scissors, RotateCcw, FastForward } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
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

type DragMode = 'start' | 'end' | 'move' | 'scrub' | null;

export function VideoTrimDialog({ file, onCancel, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  // Dragging state for custom timeline
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragOriginRef = useRef<{
    startX: number;
    initialStart: number;
    initialEnd: number;
  }>({
    startX: 0,
    initialStart: 0,
    initialEnd: 0,
  });

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

  function seekVideo(targetSec: number) {
    if (!duration) return;
    const clamped = Math.max(0, Math.min(duration, targetSec));
    setCurrentTime(clamped);
    const video = videoRef.current;
    if (video) {
      video.currentTime = clamped;
    }
  }

  function changeRange(
    values: readonly number[],
    previewTarget: 'start' | 'end' | 'center' = 'start',
  ) {
    const normalized = normalizeTrimRange(values[0], values[1], duration);
    if (normalized.end - normalized.start < 0.5) return;
    setRange([normalized.start, normalized.end]);
    const video = videoRef.current;
    const targetSec =
      previewTarget === 'end'
        ? normalized.end
        : previewTarget === 'center'
          ? Number(((normalized.start + normalized.end) / 2).toFixed(1))
          : normalized.start;

    setCurrentTime(targetSec);
    if (video) {
      video.pause();
      video.currentTime = targetSec;
    }
    setPlaying(false);
  }

  // Global pointer move / up listeners for smooth dragging
  useEffect(() => {
    if (!dragMode || !duration) return;

    function handlePointerMove(e: PointerEvent) {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;

      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const secAtPointer = Number((pct * duration).toFixed(1));

      if (dragMode === 'start') {
        const nextStart = Math.max(0, Math.min(range[1] - 0.5, secAtPointer));
        changeRange([nextStart, range[1]], 'start');
      } else if (dragMode === 'end') {
        const nextEnd = Math.min(
          duration,
          Math.max(range[0] + 0.5, secAtPointer),
        );
        changeRange([range[0], nextEnd], 'end');
      } else if (dragMode === 'move') {
        const deltaPx = e.clientX - dragOriginRef.current.startX;
        const deltaSec = (deltaPx / rect.width) * duration;
        const span =
          dragOriginRef.current.initialEnd - dragOriginRef.current.initialStart;
        let nextStart = dragOriginRef.current.initialStart + deltaSec;
        if (nextStart < 0) nextStart = 0;
        if (nextStart + span > duration) nextStart = Math.max(0, duration - span);
        const nextEnd = Number((nextStart + span).toFixed(1));
        nextStart = Number(nextStart.toFixed(1));
        changeRange([nextStart, nextEnd], 'center');
      } else if (dragMode === 'scrub') {
        const video = videoRef.current;
        if (video && !video.paused) {
          video.pause();
          setPlaying(false);
        }
        seekVideo(secAtPointer);
      }
    }

    function handlePointerUp() {
      setDragMode(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragMode, duration, range]);

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
        setCurrentTime(range[0]);
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

  const startPct = duration > 0 ? (range[0] / duration) * 100 : 0;
  const endPct = duration > 0 ? (range[1] / duration) * 100 : 100;
  const widthPct = Math.max(0, endPct - startPct);
  const centerTime = Number(((range[0] + range[1]) / 2).toFixed(1));
  const playheadPct =
    duration > 0
      ? Math.max(0, Math.min(100, (currentTime / duration) * 100))
      : 0;

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
            Başlangıç/bitiş noktalarını veya <strong>ortadaki çizgiyi</strong>{' '}
            tutup ileri-geri sürükleyerek kesiti kaydırabilir, çubuğa tıklayarak
            videoyu ileri-geri sardırabilirsin.
          </DialogDescription>
        </div>

        <div className="trim-video-wrap">
          {url && (
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
                setCurrentTime(0);
              }}
              onTimeUpdate={(event) => {
                const t = event.currentTarget.currentTime;
                setCurrentTime(t);
                if (playing && t >= range[1] - 0.04) {
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
          <div className="trim-video-controls-overlay">
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

            <div className="trim-quick-seek-pill">
              <button
                type="button"
                className="trim-seek-step-btn"
                disabled={!duration || processing}
                onClick={() => seekVideo(currentTime - 5)}
                title="5 saniye geri sar"
              >
                <RotateCcw size={13} /> -5sn
              </button>
              <span className="trim-current-time-readout">
                {formatTrimTime(currentTime)}
              </span>
              <button
                type="button"
                className="trim-seek-step-btn"
                disabled={!duration || processing}
                onClick={() => seekVideo(currentTime + 5)}
                title="5 saniye ileri sar"
              >
                +5sn <FastForward size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="trim-range-heading">
          <span>SEÇİLİ ARALIK (ORTADAN TUTUP İLERİ-GERİ KAYDIRABİLİRSİN)</span>
          <strong>{formatTrimTime(range[1] - range[0])}</strong>
        </div>

        {duration > 0 && (
          <div
            ref={trackRef}
            className="trim-custom-timeline"
            onPointerDown={(e) => {
              if (processing) return;
              // Clicking directly on the background track scrubs the video playhead
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(
                0,
                Math.min(1, (e.clientX - rect.left) / rect.width),
              );
              const sec = Number((pct * duration).toFixed(1));
              seekVideo(sec);
              setDragMode('scrub');
            }}
          >
            {/* Base grey track */}
            <div className="trim-custom-track-bg" />

            {/* Selected Yellow Trim Bar (draggable forward & backward) */}
            <div
              className={`trim-custom-selected-bar ${dragMode === 'move' ? 'is-dragging' : ''}`}
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
              }}
              onPointerDown={(e) => {
                if (processing) return;
                e.stopPropagation();
                dragOriginRef.current = {
                  startX: e.clientX,
                  initialStart: range[0],
                  initialEnd: range[1],
                };
                setDragMode('move');
              }}
              title="Kesiti ileri-geri kaydırmak için sürükle"
            >
              {/* CENTER VERTICAL LINE (Kırpma yerinin tam ortasındaki çizgi & tutamaç) */}
              <div
                className="trim-custom-center-line"
                onPointerDown={(e) => {
                  if (processing) return;
                  e.stopPropagation();
                  dragOriginRef.current = {
                    startX: e.clientX,
                    initialStart: range[0],
                    initialEnd: range[1],
                  };
                  setDragMode('move');
                }}
              >
                <span className="trim-center-line-tag">
                  {formatTrimTime(centerTime)}
                </span>
                <div className="trim-center-line-bar" />
                <div className="trim-center-line-grip">||</div>
              </div>
            </div>

            {/* Live Playhead Needle (İleri-geri sardırma çizgisi) */}
            <div
              className="trim-custom-playhead"
              style={{ left: `${playheadPct}%` }}
              onPointerDown={(e) => {
                if (processing) return;
                e.stopPropagation();
                setDragMode('scrub');
              }}
              title="Videoyu ileri-geri sarmak için sürükle"
            >
              <div className="trim-playhead-cap" />
            </div>

            {/* Left Start Handle (Başlangıç) */}
            <div
              className="trim-custom-thumb"
              style={{ left: `${startPct}%` }}
              role="slider"
              tabIndex={0}
              aria-label="Başlangıç noktası"
              aria-valuemin={0}
              aria-valuemax={range[1]}
              aria-valuenow={range[0]}
              onPointerDown={(e) => {
                if (processing) return;
                e.stopPropagation();
                setDragMode('start');
              }}
            />

            {/* Right End Handle (Bitiş) */}
            <div
              className="trim-custom-thumb"
              style={{ left: `${endPct}%` }}
              role="slider"
              tabIndex={0}
              aria-label="Bitiş noktası"
              aria-valuemin={range[0]}
              aria-valuemax={duration}
              aria-valuenow={range[1]}
              onPointerDown={(e) => {
                if (processing) return;
                e.stopPropagation();
                setDragMode('end');
              }}
            />
          </div>
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
                changeRange([Number(event.target.value), range[1]], 'start')
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
                changeRange([range[0], Number(event.target.value)], 'end')
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
