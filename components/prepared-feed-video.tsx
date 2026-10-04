'use client';

import { useEffect, useState, type ComponentProps, type Ref } from 'react';

type Props = Omit<ComponentProps<'video'>, 'src' | 'ref'> & {
  source: string;
  prepare: boolean;
  videoRef: Ref<HTMLVideoElement>;
  onPrepared: () => void;
};

export function PreparedFeedVideo({ source, prepare, videoRef, onPrepared, ...props }: Props) {
  // Remount when a clip leaves/re-enters the preparation window so a revoked URL is never reused.
  return <PreparingVideo key={`${prepare}:${source}`} source={source} prepare={prepare}
    videoRef={videoRef} onPrepared={onPrepared} {...props} />;
}

function PreparingVideo({ source, prepare, videoRef, onPrepared, ...props }: Props) {
  const [ready, setReady] = useState<{ source: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!prepare) return;
    const controller = new AbortController();
    let ownedUrl: string | undefined;
    void (async () => {
      try {
        const { preparePublishedVideo } = await import('@/lib/published-video');
        if (controller.signal.aborted) return;
        const blob = await preparePublishedVideo(source, controller.signal);
        if (controller.signal.aborted) return;
        ownedUrl = URL.createObjectURL(blob);
        setReady({ source, url: ownedUrl });
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Video hazırlanamadı.');
      }
    })();
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [source, prepare, attempt]);

  const url = prepare && ready?.source === source ? ready.url : undefined;
  useEffect(() => { if (url) onPrepared(); }, [url, onPrepared]);
  return <>
    {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
    <video {...props} ref={videoRef} src={url} />
    {prepare && !url && <output className="dub-video-status">
      {error ? <>
        <span>{error}</span>
        <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Tekrar dene</button>
      </> : 'Video hazırlanıyor…'}
    </output>}
  </>;
}
