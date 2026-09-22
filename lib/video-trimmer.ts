import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

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
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Kırpma iptal edildi.', 'AbortError'));
  }
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

/**
 * Resolves the true finite duration of a video even when the container (e.g., WebM from MediaRecorder)
 * reports `video.duration === Infinity` or `NaN`.
 */
export async function resolveVideoDuration(
  video: HTMLVideoElement,
  file?: Blob,
  fallbackDuration?: number,
): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration >= 0.5) {
    return video.duration;
  }

  // 1. Try decoding audio track duration (exact & fast for WebM/MP4)
  if (file && typeof window !== 'undefined') {
    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        const tempCtx = new AudioCtx();
        const audioBuf = await tempCtx.decodeAudioData(arrayBuf.slice(0));
        await tempCtx.close().catch(() => {});
        if (Number.isFinite(audioBuf.duration) && audioBuf.duration >= 0.5) {
          return audioBuf.duration;
        }
      }
    } catch {
      // Ignore audio decode failure and continue to seek trick
    }
  }

  // 2. HTML5 Infinity duration seek workaround (`currentTime = 1e101`)
  try {
    const prevTime = video.currentTime || 0;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 1200);
      const onDone = () => {
        window.clearTimeout(timer);
        video.removeEventListener('seeked', onDone);
        video.removeEventListener('durationchange', onDone);
        resolve();
      };
      video.addEventListener('seeked', onDone, { once: true });
      video.addEventListener('durationchange', onDone, { once: true });
      video.currentTime = 1e101;
    });

    const measured = video.duration;
    video.currentTime = Number.isFinite(prevTime) ? prevTime : 0;
    if (Number.isFinite(measured) && measured >= 0.5) {
      return measured;
    }
  } catch {
    // Ignore seek error
  }

  if (
    fallbackDuration !== undefined &&
    Number.isFinite(fallbackDuration) &&
    fallbackDuration >= 0.5
  ) {
    return fallbackDuration;
  }

  return 0;
}

function seekVideoTo(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Kırpma iptal edildi.', 'AbortError'));
  }
  if (Math.abs(video.currentTime - time) < 0.002) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timer: number;
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video karesi okunamadı.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Kırpma iptal edildi.', 'AbortError'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 250);

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    video.currentTime = time;
  });
}

/**
 * Ultra-fast hardware-accelerated WebCodecs + mp4-muxer trimming engine.
 * Produces a clean, seekable MP4 with exact duration metadata and 0-based timestamps.
 */
async function trimVideoFileWebCodecs(
  file: File,
  range: TrimRange,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  if (
    typeof window === 'undefined' ||
    typeof window.VideoEncoder === 'undefined'
  ) {
    throw new Error('WebCodecs VideoEncoder not supported');
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10000px';
  document.body.appendChild(video);

  let videoEncoder: VideoEncoder | undefined;
  let audioEncoder: AudioEncoder | undefined;

  try {
    if (video.readyState < 1) {
      await waitForMedia(video, 'loadedmetadata', signal);
    }
    const resolvedDuration = await resolveVideoDuration(
      video,
      file,
      range.end,
    );
    const { start, end } = normalizeTrimRange(
      range.start,
      range.end,
      resolvedDuration || range.end,
    );
    const duration = end - start;
    if (duration < 0.4) {
      throw new Error('En az 0,5 saniyelik bir bölüm seçin.');
    }

    // Cap to 720p HD (1280x720) with even dimensions so ALL H.264 profiles & levels succeed
    // and GPU encoding runs at 100+ FPS without macroblock overflow.
    const rawW = video.videoWidth || 1280;
    const rawH = video.videoHeight || 720;
    const maxDim = 1280;
    let targetW = rawW;
    let targetH = rawH;
    if (targetW > maxDim || targetH > maxDim) {
      const scale = Math.min(maxDim / targetW, maxDim / targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }
    targetW = Math.max(320, Math.floor(targetW / 2) * 2);
    targetH = Math.max(240, Math.floor(targetH / 2) * 2);

    const fps = 25;
    const bitrate = Math.min(
      5_000_000,
      Math.max(1_800_000, Math.round(targetW * targetH * fps * 0.14)),
    );

    // Find supported H.264 codec string for these dimensions
    const codecCandidates = [
      'avc1.640028', // High Profile Level 4.0
      'avc1.4d002a', // Main Profile Level 4.2
      'avc1.420028', // Baseline Profile Level 4.0
      'avc1.42001f', // Baseline Profile Level 3.1
    ];
    let selectedVideoCodec = 'avc1.42001f';
    for (const candidate of codecCandidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: candidate,
          width: targetW,
          height: targetH,
          bitrate,
          framerate: fps,
        });
        if (support.supported) {
          selectedVideoCodec = candidate;
          break;
        }
      } catch {
        // Continue checking next candidate
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Video kırpma alanı oluşturulamadı.');

    // Step 1: Decode & slice audio track via Web Audio in milliseconds
    let audioBuffer: AudioBuffer | null = null;
    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const tempCtx = new AudioCtx();
      audioBuffer = await tempCtx.decodeAudioData(arrayBuf.slice(0));
      await tempCtx.close().catch(() => {});
    } catch {
      audioBuffer = null;
    }

    const audioSampleRate = audioBuffer?.sampleRate || 48000;
    const audioChannels = Math.min(2, audioBuffer?.numberOfChannels || 1);

    let canEncodeAudio = false;
    if (
      audioBuffer !== null &&
      audioBuffer.duration > 0 &&
      typeof window.AudioEncoder !== 'undefined'
    ) {
      try {
        const audioSupport = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          numberOfChannels: audioChannels,
          sampleRate: audioSampleRate,
          bitrate: 128_000,
        });
        canEncodeAudio = Boolean(audioSupport.supported);
      } catch {
        canEncodeAudio = false;
      }
    }

    // Initialize MP4 Muxer
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: targetW,
        height: targetH,
      },
      ...(canEncodeAudio
        ? {
            audio: {
              codec: 'aac',
              numberOfChannels: audioChannels,
              sampleRate: audioSampleRate,
            },
          }
        : {}),
      fastStart: 'in-memory',
    });

    // Step 2: Encode Audio Slice with AudioEncoder (isolated try/catch so audio issues never break video)
    if (canEncodeAudio && audioBuffer) {
      try {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.warn('AudioEncoder warning:', e),
        });
        audioEncoder.configure({
          codec: 'mp4a.40.2',
          numberOfChannels: audioChannels,
          sampleRate: audioSampleRate,
          bitrate: 128_000,
        });

        const startSample = Math.max(0, Math.floor(start * audioSampleRate));
        const endSample = Math.min(
          audioBuffer.length,
          Math.ceil(end * audioSampleRate),
        );
        const sliceFrames = Math.max(1, endSample - startSample);

        const left = audioBuffer.getChannelData(0);
        const right =
          audioChannels > 1 ? audioBuffer.getChannelData(1) : left;

        const chunkSize = 1024;
        for (let offset = 0; offset < sliceFrames; offset += chunkSize) {
          if (signal?.aborted) {
            throw new DOMException('Kırpma iptal edildi.', 'AbortError');
          }
          const count = Math.min(chunkSize, sliceFrames - offset);
          const interleaved = new Float32Array(count * audioChannels);
          for (let j = 0; j < count; j++) {
            const srcIdx = startSample + offset + j;
            interleaved[j * audioChannels] =
              srcIdx < left.length ? left[srcIdx] : 0;
            if (audioChannels > 1) {
              interleaved[j * audioChannels + 1] =
                srcIdx < right.length ? right[srcIdx] : 0;
            }
          }
          const audioData = new AudioData({
            format: 'f32',
            sampleRate: audioSampleRate,
            numberOfFrames: count,
            numberOfChannels: audioChannels,
            timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
            data: interleaved,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }
        await audioEncoder.flush();
      } catch (audioErr) {
        if (signal?.aborted || (audioErr as DOMException)?.name === 'AbortError') {
          throw audioErr;
        }
        console.warn('Audio encoding skipped:', audioErr);
      }
    }

    // Step 3: Configure VideoEncoder
    let encoderError: Error | null = null;
    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encoderError = new Error(`VideoEncoder hatası: ${e.message}`);
      },
    });

    videoEncoder.configure({
      codec: selectedVideoCodec,
      width: targetW,
      height: targetH,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' },
    });

    // Step 4: Rapid Frame Stepping & GPU Encoding (timestamps strictly 0 to duration)
    const totalFrames = Math.max(1, Math.round(duration * fps));
    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) {
        throw new DOMException('Kırpma iptal edildi.', 'AbortError');
      }
      if (encoderError) throw encoderError;

      const time = Math.min(end, start + f / fps);
      await seekVideoTo(video, time, signal);

      ctx.drawImage(video, 0, 0, targetW, targetH);
      const frameUs = Math.round((f / fps) * 1_000_000);
      const durationUs = Math.round((1 / fps) * 1_000_000);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: frameUs,
        duration: durationUs,
      });
      videoEncoder.encode(videoFrame, { keyFrame: f % (fps * 2) === 0 });
      videoFrame.close();

      if (f % 4 === 0 || f === totalFrames - 1) {
        onProgress(Math.min(0.99, (f + 1) / totalFrames));
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await videoEncoder.flush();
    muxer.finalize();

    const mp4Blob = new Blob([target.buffer], { type: 'video/mp4' });
    if (mp4Blob.size < 100) {
      throw new Error('Kesilen video oluşturulamadı.');
    }

    onProgress(1);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([mp4Blob], `${baseName}-kesit.mp4`, {
      type: 'video/mp4',
    });
  } finally {
    if (videoEncoder && videoEncoder.state !== 'closed') {
      try {
        videoEncoder.close();
      } catch {}
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      try {
        audioEncoder.close();
      } catch {}
    }
    video.pause();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}

/**
 * Fallback trimmer using MediaRecorder with 0-based AudioBuffer source so WebM/MP4
 * streams never inherit shifted start timestamps from the source video element.
 */
async function trimVideoFileMediaRecorder(
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
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) {
    throw new Error(
      'Bu tarayıcı kesilmiş video oluşturamıyor. Güncel Chrome veya Safari ile deneyin.',
    );
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10000px';
  document.body.appendChild(video);

  let audioContext: AudioContext | undefined;
  let audioSourceNode: AudioBufferSourceNode | undefined;
  let outputStream: MediaStream | undefined;
  let animationFrame = 0;
  let recorder: MediaRecorder | undefined;

  try {
    if (video.readyState < 1) {
      await waitForMedia(video, 'loadedmetadata', signal);
    }
    const resolvedDuration = await resolveVideoDuration(
      video,
      file,
      range.end,
    );
    const { start, end } = normalizeTrimRange(
      range.start,
      range.end,
      resolvedDuration || range.end,
    );
    const clipDuration = end - start;
    if (clipDuration < 0.4) {
      throw new Error('En az 0,5 saniyelik bir bölüm seçin.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video kırpma alanı oluşturulamadı.');

    if (Math.abs(video.currentTime - start) > 0.05) {
      const seeked = waitForMedia(video, 'seeked', signal);
      video.currentTime = start;
      await seeked;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForMedia(video, 'loadeddata', signal);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Use decoded AudioBuffer started at 0s so stream timestamps start cleanly at 00:00.000
    audioContext = new AudioContext();
    const audioDestination = audioContext.createMediaStreamDestination();
    await audioContext.resume();

    try {
      const arrayBuf = await file.arrayBuffer();
      const decodedAudio = await audioContext.decodeAudioData(arrayBuf.slice(0));
      audioSourceNode = audioContext.createBufferSource();
      audioSourceNode.buffer = decodedAudio;
      audioSourceNode.connect(audioDestination);
    } catch {
      // Proceed silent if audio decode fails
    }

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
        if (blob.size < 100) {
          reject(new Error('Kesilen video boş çıktı. Tekrar deneyin.'));
        } else resolve(blob);
      };
    });
    void finished.catch(() => {});

    let ended = false;
    const stopAtEnd = () => {
      if (ended) return;
      ended = true;
      video.pause();
      try {
        audioSourceNode?.stop();
      } catch {}
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
      onProgress(Math.max(0, Math.min(1, elapsed / clipDuration)));
      if (video.currentTime >= end || video.ended) stopAtEnd();
      else animationFrame = requestAnimationFrame(draw);
    };

    try {
      recorder.start(250);
      if (audioSourceNode) {
        audioSourceNode.start(0, start, clipDuration);
      }
      await video.play();
      draw();
      const blob = await finished;
      if (signal?.aborted) {
        throw new DOMException('Kırpma iptal edildi.', 'AbortError');
      }
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
    try {
      audioSourceNode?.stop();
    } catch {}
    outputStream?.getTracks().forEach((track) => track.stop());
    if (audioContext) await audioContext.close().catch(() => {});
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}

/**
 * Creates a new trimmed video file.
 * Uses hardware-accelerated WebCodecs + mp4-muxer for high speed (10x-15x faster),
 * and automatically falls back to MediaRecorder on legacy browsers.
 */
export async function trimVideoFile(
  file: File,
  range: TrimRange,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  if (
    typeof window !== 'undefined' &&
    typeof window.VideoEncoder !== 'undefined'
  ) {
    try {
      return await trimVideoFileWebCodecs(file, range, onProgress, signal);
    } catch (err) {
      if (signal?.aborted || (err as DOMException)?.name === 'AbortError') {
        throw err;
      }
      console.warn(
        'WebCodecs video trimming failed, falling back to MediaRecorder:',
        err,
      );
    }
  }

  return await trimVideoFileMediaRecorder(file, range, onProgress, signal);
}
