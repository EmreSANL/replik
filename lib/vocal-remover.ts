import { supabase } from './supabase';

export type VocalRemovalProgress = (stage: string, percent: number) => void;

export function audioBufferToWav(
  buffer: AudioBuffer,
  targetSampleRate = 44100,
): Blob {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const ratio = buffer.sampleRate / targetSampleRate;
  const frames = Math.floor(buffer.length / ratio);
  const outChannels = 2; // Always output 2-channel stereo WAV for universal compatibility
  const dataLength = frames * outChannels * 2;
  const bytes = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, outChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * outChannels * 2, true);
  view.setUint16(32, outChannels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataLength, true);

  const leftData = buffer.getChannelData(0);
  const rightData =
    channels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const sourceIndex = Math.min(buffer.length - 1, Math.floor(i * ratio));
    const sL = Math.max(-1, Math.min(1, leftData[sourceIndex]));
    const sR = Math.max(-1, Math.min(1, rightData[sourceIndex]));
    view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7fff, true);
    offset += 2;
    view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7fff, true);
    offset += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function fetchMediaBlob(source: File | Blob | string): Promise<Blob> {
  if (typeof source !== 'string') return source;
  try {
    const response = await fetch(source, { mode: 'cors' });
    if (response.ok) return await response.blob();
  } catch {
    // Fallback to proxy if direct CORS fails
  }
  if (!source.startsWith('blob:') && !source.startsWith('data:')) {
    const proxyRes = await fetch(
      `/api/video-proxy?url=${encodeURIComponent(source)}`,
    );
    if (proxyRes.ok) return await proxyRes.blob();
  }
  throw new Error('Video dosyası okunamadı.');
}

export async function decodeMediaAudioBuffer(
  source: File | Blob | string,
): Promise<AudioBuffer> {
  const media = await fetchMediaBlob(source);
  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Tarayıcı ses çözümlemeyi desteklemiyor.');
  }
  const context = new AudioContextClass();
  try {
    const arrayBuf = await media.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuf.slice(0));
    if (!decoded.length) throw new Error('Videoda ses bulunamadı.');
    return decoded;
  } finally {
    await context.close().catch(() => {});
  }
}

/** Called only by the editor after the original video has been uploaded. */
export async function prepareSceneBackground(
  videoUrl: string,
  onProgress?: VocalRemovalProgress,
  options: { retry?: boolean; signal?: AbortSignal } = {},
): Promise<{ url: string }> {
  if (!videoUrl.startsWith('https://')) throw new Error('Önce video yüklemesinin tamamlanmasını bekleyin.');
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Ses hazırlamak için giriş yapın.');
    const response = await fetch('/api/splitter-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ videoUrl, retry: options.retry === true }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
    const job = await response.json() as { status?: string; error?: string; instrumentalUrl?: string };
    if (!response.ok || job.status === 'failed') throw new Error(job.error || 'Arka plan sesi hazırlanamadı.');
    if (job.status === 'ready' && job.instrumentalUrl) {
      onProgress?.('Arka plan sesi hazır ve kaydedildi.', 100);
      return { url: job.instrumentalUrl };
    }
    if (job.status !== 'starting' && job.status !== 'processing') throw new Error('Ses ayırma servisinden geçersiz yanıt alındı.');
    onProgress?.(job.status === 'starting' ? 'Ses hazırlama başlatılıyor...' : 'Konuşma ayrılıyor; müzik ve efekt kanalı hazırlanıyor...', job.status === 'starting' ? 20 : 60);
    await new Promise<void>((resolve, reject) => {
      const done = () => { options.signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(done, 3000);
      const cancel = () => { clearTimeout(timer); reject(new DOMException('İşlem iptal edildi.', 'AbortError')); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
    });
  }
  throw new Error('Ses hazırlama devam ediyor. Durumu tekrar kontrol ederek aynı işleme devam edebilirsiniz.');
}
