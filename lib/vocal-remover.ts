import { supabase } from './supabase';
import { decodeMediaAudioBytes } from './wav-mix';

export type VocalRemovalProgress = (stage: string) => void;

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
  let lastError: Error = new Error('Ses dosyası indirilemedi.');
  const readResponse = async (response: Response) => {
    if (!response.ok) throw new Error(`Ses dosyası indirilemedi (HTTP ${response.status}).`);
    const type = response.headers.get('content-type') || '';
    if (/text\/html|application\/json/i.test(type)) throw new Error('Ses dosyası yerine bir hata sayfası alındı.');
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error('Ses dosyası boş.');
    return new Blob([bytes], { type });
  };
  try {
    return await readResponse(await fetch(source, { mode: 'cors', signal: AbortSignal.timeout(60000) }));
  } catch (error) {
    lastError = error instanceof Error ? error : lastError;
    // Fallback to proxy if direct CORS fails
  }
  if (!source.startsWith('blob:') && !source.startsWith('data:')) {
    try {
      return await readResponse(await fetch(`/api/video-proxy?url=${encodeURIComponent(source)}`, {
        signal: AbortSignal.timeout(60000),
      }));
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }
  throw lastError;
}

const audioDecodesInFlight = new Map<string, Promise<AudioBuffer>>();

export function decodeMediaAudioBuffer(source: File | Blob | string): Promise<AudioBuffer> {
  if (typeof source !== 'string') return decodeMediaAudio(source);
  const existing = audioDecodesInFlight.get(source);
  if (existing) return existing;
  const pending = decodeMediaAudio(source).finally(() => audioDecodesInFlight.delete(source));
  audioDecodesInFlight.set(source, pending);
  return pending;
}

async function decodeMediaAudio(
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
    const decoded = await decodeMediaAudioBytes(arrayBuf, context);
    if (!decoded.length) throw new Error('Videoda ses bulunamadı.');
    return decoded;
  } finally {
    await context.close().catch(() => {});
  }
}

/** Combine MVSep's music and effects stems without running a separation model locally. */
export async function combineBackgroundStems(files: File[]): Promise<Blob> {
  if (files.length < 1 || files.length > 2) throw new Error('Bir veya iki ses dosyası seçin.');
  const buffers = await Promise.all(files.map((file) => decodeMediaAudioBuffer(file)));
  if (buffers.length === 2 && Math.abs(buffers[0].duration - buffers[1].duration) > 1) {
    throw new Error('Müzik ve efekt dosyalarının süreleri eşleşmiyor. Aynı videodan çıkan dosyaları seçin.');
  }
  const sampleRate = 44100;
  const frames = Math.ceil(Math.max(...buffers.map((buffer) => buffer.duration)) * sampleRate);
  const context = new OfflineAudioContext(2, frames, sampleRate);
  for (const buffer of buffers) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
  }
  return audioBufferToWav(await context.startRendering(), sampleRate);
}

/** Called only by the editor after the original video has been uploaded. */
export async function prepareSceneBackground(
  videoUrl: string,
  onProgress?: VocalRemovalProgress,
  options: { retry?: boolean; signal?: AbortSignal } = {},
): Promise<{ url: string }> {
  if (!videoUrl.startsWith('https://')) throw new Error('Önce video yüklemesinin tamamlanmasını bekleyin.');
  const deadline = Date.now() + 60 * 60 * 1000;
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
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new Error(
        response.status === 404
          ? 'Ses hazırlama API yolu bulunamadı. Sunucu dağıtımını kontrol edin.'
          : `Ses hazırlama sunucusundan geçersiz yanıt alındı (${response.status}). Sunucu kayıtlarını kontrol edin.`,
      );
    }
    const job = await response.json() as {
      status?: string; error?: string; instrumentalUrl?: string;
      phase?: 'downloading' | 'queued' | 'separating' | 'vocals'; queuePosition?: number;
    };
    if (!response.ok || job.status === 'failed') throw new Error(job.error || 'Arka plan sesi hazırlanamadı.');
    if (job.status === 'ready' && job.instrumentalUrl) {
      onProgress?.('Arka plan sesi hazır ve kaydedildi.');
      return { url: job.instrumentalUrl };
    }
    if (job.status !== 'starting' && job.status !== 'processing') throw new Error('Ses ayırma servisinden geçersiz yanıt alındı.');
    const queue = Number.isInteger(job.queuePosition) && job.queuePosition! > 0
      ? ` (${job.queuePosition}. sırada)` : '';
    onProgress?.(job.phase === 'vocals' ? `MVSEP şarkı vokalini ayırıyor${queue}...`
      : job.status === 'starting' ? 'MVSEP işi başlatılıyor...'
      : job.phase === 'downloading' ? `MVSEP videoyu indiriyor${queue}...`
      : job.phase === 'queued' ? `MVSEP ayırma kuyruğunda${queue}...`
      : 'MVSEP konuşma, müzik ve efektleri ayırıyor...');
    await new Promise<void>((resolve, reject) => {
      const done = () => { options.signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(done, 10000);
      const cancel = () => { clearTimeout(timer); reject(new DOMException('İşlem iptal edildi.', 'AbortError')); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
    });
  }
  throw new Error('Ses hazırlama devam ediyor. Durumu tekrar kontrol ederek aynı işleme devam edebilirsiniz.');
}
