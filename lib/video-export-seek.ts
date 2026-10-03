export function seekExportVideo(video: HTMLVideoElement, time: number, timeoutMs = 10000): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Video karesi okunamadı. Tekrar dene.')); };
    const timer = setTimeout(failed, timeoutMs);
    video.addEventListener('seeked', done);
    video.addEventListener('error', failed);
    video.currentTime = time;
  });
}
