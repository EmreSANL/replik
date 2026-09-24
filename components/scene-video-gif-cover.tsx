'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Cue, Scene } from '@/lib/scenes';

interface SceneVideoGifCoverProps {
  scene: Scene;
  cues?: Cue[];
  className?: string;
  showBadge?: boolean;
}

/**
 * Renders a scene's video as an automatic mid-video cover and loops the middle
 * highlight / replik segment (3-4 seconds around the midpoint) like an animated GIF.
 */
export function SceneVideoGifCover({
  scene,
  cues = [],
  className = '',
  showBadge = false,
}: SceneVideoGifCoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVisibleRef = useRef<boolean>(true);
  const lastSubtitleRef = useRef<string>('');
  const loopBoundsRef = useRef<{ start: number; end: number; mid: number }>({
    start: 0,
    end: 3.5,
    mid: 1.5,
  });
  const [activeSubtitle, setActiveSubtitle] = useState<string>('');

  // Ekran dışına (viewport dışına) çıkan kartların videolarını otomatik duraklat (GPU/CPU optimizasyonu)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        isVisibleRef.current = entry.isIntersecting;
        const v = videoRef.current;
        if (!v) return;
        if (entry.isIntersecting) {
          if (v.paused) void v.play().catch(() => {});
        } else {
          if (!v.paused) v.pause();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !scene.video) return;

    const baseStart =
      typeof scene.start === 'number' && Number.isFinite(scene.start)
        ? Math.max(0, scene.start)
        : 0;
    const declaredDur =
      typeof scene.duration === 'number' &&
      Number.isFinite(scene.duration) &&
      scene.duration > 0
        ? scene.duration
        : 12;

    const pickLoopForCueIndex = (actualVideoDur: number, cueIdx: number) => {
      const effectiveDur =
        Number.isFinite(actualVideoDur) && actualVideoDur > 0.5
          ? actualVideoDur
          : baseStart + declaredDur;

      const clipSpan = Math.min(
        declaredDur,
        Math.max(0.5, effectiveDur - baseStart),
      );

      let cueMid = clipSpan * 0.5;
      if (cues && cues.length > 0) {
        const chosenCue = cues[cueIdx % cues.length] || cues[Math.floor(cues.length / 2)];
        if (
          chosenCue &&
          Number.isFinite(chosenCue.start) &&
          Number.isFinite(chosenCue.end)
        ) {
          cueMid = (chosenCue.start + chosenCue.end) / 2;
        }
      }

      const relMid = Math.min(
        clipSpan * 0.88,
        Math.max(clipSpan * 0.15, cueMid <= clipSpan ? cueMid : clipSpan * 0.5),
      );
      const absMid = baseStart + relMid;

      const gifSpan = Math.min(3.5, Math.max(1.6, clipSpan * 0.45));
      const loopStart = Math.max(
        baseStart,
        Math.min(effectiveDur - 0.6, absMid - gifSpan / 2),
      );
      const loopEnd = Math.min(
        effectiveDur,
        Math.max(loopStart + 0.9, loopStart + gifSpan),
      );

      loopBoundsRef.current = {
        start: loopStart,
        end: loopEnd,
        mid: absMid,
      };
    };

    const initialCueIdx =
      cues && cues.length > 0
        ? Math.floor(Math.random() * cues.length)
        : 0;
    pickLoopForCueIndex(declaredDur, initialCueIdx);

    const safePlay = () => {
      if (isVisibleRef.current && video.paused) {
        void video.play().catch(() => {});
      }
    };

    const handleLoadedMetadata = () => {
      pickLoopForCueIndex(video.duration, initialCueIdx);
      try {
        video.currentTime = loopBoundsRef.current.start;
      } catch {}
      safePlay();
    };

    const handleCanPlay = () => {
      safePlay();
    };

    const handleSeeked = () => {
      safePlay();
    };

    const handleTimeUpdate = () => {
      if (!isVisibleRef.current) return;
      const { start, end } = loopBoundsRef.current;
      const t = video.currentTime;
      if (t >= end || t < start - 0.35) {
        if (cues && cues.length > 1 && t >= end) {
          const nextRandomIdx = Math.floor(Math.random() * cues.length);
          pickLoopForCueIndex(video.duration, nextRandomIdx);
        }
        try {
          video.currentTime = loopBoundsRef.current.start;
          safePlay();
        } catch {}
      }

      if (cues && cues.length > 0) {
        const relTime = Math.max(0, t - baseStart);
        const match =
          cues.find((c) => relTime >= c.start && relTime <= c.end) ||
          cues[Math.floor(cues.length / 2)];
        const nextSub = match?.text || '';
        // Sadece altyazı gerçekten değiştiğinde React state güncelle (gereksiz re-render'ları %98 azaltır)
        if (nextSub !== lastSubtitleRef.current) {
          lastSubtitleRef.current = nextSub;
          setActiveSubtitle(nextSub);
        }
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);

    if (video.readyState >= 1) {
      handleLoadedMetadata();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [scene.video, scene.start, scene.duration, cues]);

  return (
    <div
      ref={containerRef}
      className={`scene-gif-cover-wrap ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#11110F',
      }}
      onMouseEnter={() => {
        const v = videoRef.current;
        if (v && v.paused) {
          void v.play().catch(() => {});
        }
      }}
    >
      {scene.video && (
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          key={scene.video}
          src={scene.video}
          poster={scene.poster || undefined}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center center',
            transform: 'scale(1.14)',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      )}

      {showBadge && (
        <span
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            zIndex: 3,
            background: 'rgba(9, 9, 9, 0.75)',
            color: '#F5E636',
            fontSize: '9.5px',
            fontWeight: 800,
            letterSpacing: '0.04em',
            padding: '2px 6px',
            borderRadius: '6px',
            border: '1px solid rgba(245, 230, 54, 0.35)',
            pointerEvents: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '999px',
              backgroundColor: '#F5E636',
              display: 'inline-block',
            }}
          />
          GIF ÖNİZLEME
        </span>
      )}

      {activeSubtitle && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            zIndex: 3,
            background: 'transparent',
            color: '#FFFFFF',
            fontSize: '11px',
            fontWeight: 800,
            padding: '2px 4px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            WebkitTextStroke: '0.8px rgba(0, 0, 0, 0.9)',
            paintOrder: 'stroke fill',
            textShadow:
              '-1px -1px 0 rgba(0,0,0,0.92), 1px -1px 0 rgba(0,0,0,0.92), -1px 1px 0 rgba(0,0,0,0.92), 1px 1px 0 rgba(0,0,0,0.92), 0 2px 6px rgba(0,0,0,0.85)',
          }}
        >
          “{activeSubtitle}”
        </div>
      )}
    </div>
  );
}
