export type TrimRange = { start: number; end: number };

export function normalizeTrimRange(
  start: number,
  end: number,
  duration: number,
): TrimRange {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeStart = Number.isFinite(start)
    ? Math.max(0, Math.min(start, safeDuration))
    : 0;
  const safeEnd = Number.isFinite(end)
    ? Math.max(safeStart, Math.min(end, safeDuration))
    : safeDuration;
  return { start: safeStart, end: safeEnd };
}

export function formatTrimTime(seconds: number): string {
  const totalTenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(totalTenths / 600);
  const wholeSeconds = Math.floor((totalTenths % 600) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${totalTenths % 10}`;
}

function waitForMedia(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'loadeddata' | 'seeked',
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('Kırpma iptal edildi.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(new Error('Video okunamadı. Dosyayı yeniden seçin.')),
      15000,
    );
    const onEvent = () => finish();
    const onError = () =>
      finish(
        new Error('Video dosyası açılamadı. Farklı bir MP4 veya WebM deneyin.'),
      );
    const onAbort = () =>
      finish(new DOMException('Kırpma iptal edildi.', 'AbortError'));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Creates a new playable file so uploads, transcription and vocal separation use the selected clip. */
export async function trimVideoFile(
  file: File,
  range: TrimRange,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error(
      'Bu tarayıcı video kırpmayı desteklemiyor. Güncel Chrome veya Safari ile deneyin.',
    );
  }

  const mimeType = [
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType)
    throw new Error(
      'Bu tarayıcı kesilmiş video oluşturamıyor. Güncel Chrome veya Safari ile deneyin.',
    );

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.playsInline = true;
  video.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10000px';
  document.body.appendChild(video);

  let audioContext: AudioContext | undefined;
  let outputStream: MediaStream | undefined;
  let animationFrame = 0;
  let recorder: MediaRecorder | undefined;

  try {
    if (video.readyState < 1)
      await waitForMedia(video, 'loadedmetadata', signal);
    const { start, end } = normalizeTrimRange(
      range.start,
      range.end,
      video.duration,
    );
    if (end - start < 0.5)
      throw new Error('En az 0,5 saniyelik bir bölüm seçin.');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height)
      throw new Error('Videonun görüntüsü okunamadı.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video kırpma alanı oluşturulamadı.');

    if (Math.abs(video.currentTime - start) > 0.05) {
      const seeked = waitForMedia(video, 'seeked', signal);
      video.currentTime = start;
      await seeked;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
      await waitForMedia(video, 'loadeddata', signal);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    source.connect(audioDestination);
    await audioContext.resume();

    const canvasStream = canvas.captureStream(30);
    outputStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    recorder = new MediaRecorder(outputStream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };

    const finished = new Promise<Blob>((resolve, reject) => {
      recorder!.onerror = () =>
        reject(new Error('Video kırpılırken kayıt hatası oluştu.'));
      recorder!.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 100)
          reject(new Error('Kesilen video boş çıktı. Tekrar deneyin.'));
        else resolve(blob);
      };
    });
    // A failed play() may stop the recorder before the main await reaches this promise.
    void finished.catch(() => {});

    let ended = false;
    const stopAtEnd = () => {
      if (ended) return;
      ended = true;
      video.pause();
      if (recorder?.state === 'recording') recorder.stop();
    };
    const onAbort = () => {
      stopAtEnd();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const draw = () => {
      if (ended) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const elapsed = video.currentTime - start;
      onProgress(Math.max(0, Math.min(1, elapsed / (end - start))));
      if (video.currentTime >= end || video.ended) stopAtEnd();
      else animationFrame = requestAnimationFrame(draw);
    };

    try {
      recorder.start(1000);
      await video.play();
      draw();
      const blob = await finished;
      if (signal?.aborted)
        throw new DOMException('Kırpma iptal edildi.', 'AbortError');
      onProgress(1);
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const baseName = file.name.replace(/\.[^.]+$/, '');
      return new File([blob], `${baseName}-kesit.${extension}`, {
        type: mimeType,
      });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    if (recorder?.state === 'recording') recorder.stop();
    window.cancelAnimationFrame(animationFrame);
    video.pause();
    outputStream?.getTracks().forEach((track) => track.stop());
    if (audioContext) await audioContext.close();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}
