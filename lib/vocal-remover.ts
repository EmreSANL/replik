import { supabase } from './supabase';
import { reduceStereoWav } from './stereo-vocal-reducer';

export type VocalRemovalProgress = (stage: string, percent: number) => void;
export type VocalRemovalResult = { blob: Blob; url: string; duration: number; engine: 'ai' | 'stereo' };

const HF_BASE = 'https://abidlabs-music-separation.hf.space';

export function audioBufferToWav(buffer: AudioBuffer, targetSampleRate = 44100): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const ratio = buffer.sampleRate / targetSampleRate;
  const frames = Math.floor(buffer.length / ratio);
  const dataLength = frames * channels * 2;
  const bytes = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataLength, true);
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const sourceIndex = Math.min(buffer.length - 1, Math.floor(i * ratio));
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][sourceIndex]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function prepareAudio(source: File | Blob | string, onProgress?: VocalRemovalProgress) {
  onProgress?.('Videonun sesi hazırlanıyor...', 12);
  const media = typeof source === 'string'
    ? await fetch(source).then((response) => {
        if (!response.ok) throw new Error('Video dosyası okunamadı.');
        return response.blob();
      })
    : source;
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Tarayıcı ses çözümlemeyi desteklemiyor.');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await media.arrayBuffer());
    if (!decoded.length) throw new Error('Videoda ses bulunamadı.');
    onProgress?.('Ses yapay zekâ için hazırlanıyor...', 22);
    return audioBufferToWav(decoded);
  } catch {
    throw new Error('Videodaki ses çözülemedi. MP4 veya WebM formatında sesli bir video deneyin.');
  } finally {
    await context.close().catch(() => {});
  }
}

type GradioFile = { path?: string; url?: string };

function parseCompletion(stream: string): GradioFile {
  for (const block of stream.split(/\r?\n\r?\n/)) {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    if (event === 'error') throw new Error('Ses ayırma servisi işlemi tamamlayamadı. Biraz sonra yeniden deneyin.');
    if (event !== 'complete' || !data) continue;
    const result = JSON.parse(data) as GradioFile[];
    if (Array.isArray(result) && result[1] && (result[1].url || result[1].path)) return result[1];
  }
  throw new Error('Ses ayırma servisinden geçerli bir çıktı gelmedi.');
}

async function separate(audio: Blob, onProgress?: VocalRemovalProgress): Promise<Blob> {
  const form = new FormData();
  form.append('files', audio, 'scene-audio.wav');
  onProgress?.('Ses ayrıştırma servisine gönderiliyor...', 30);
  const upload = await fetch(`${HF_BASE}/gradio_api/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(90000) });
  if (!upload.ok) throw new Error(`Ses yükleme başarısız (${upload.status}).`);
  const paths = await upload.json() as string[];
  const path = paths?.[0];
  if (!path) throw new Error('Ses yükleme yolu alınamadı.');
  onProgress?.('Vokaller ayrıştırılıyor. Bu işlem birkaç dakika sürebilir...', 48);
  const call = await fetch(`${HF_BASE}/gradio_api/call/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ path, url: `${HF_BASE}/gradio_api/file=${path}`, orig_name: 'scene-audio.wav', meta: { _type: 'gradio.FileData' } }] }),
    signal: AbortSignal.timeout(90000),
  });
  if (!call.ok) throw new Error(`Ses ayrıştırma başlatılamadı (${call.status}).`);
  const { event_id: eventId } = await call.json() as { event_id?: string };
  if (!eventId) throw new Error('Ses ayrıştırma işlem numarası alınamadı.');
  const stream = await fetch(`${HF_BASE}/gradio_api/call/inference/${eventId}`, { signal: AbortSignal.timeout(300000) });
  if (!stream.ok) throw new Error(`Ses ayrıştırma sonucu alınamadı (${stream.status}).`);
  const output = parseCompletion(await stream.text());
  const outputUrl = output.url || `${HF_BASE}/gradio_api/file=${output.path}`;
  onProgress?.('Vokalsiz ses indiriliyor...', 82);
  const download = await fetch(outputUrl, { signal: AbortSignal.timeout(90000) });
  if (!download.ok) throw new Error(`Vokalsiz ses indirilemedi (${download.status}).`);
  const blob = await download.blob();
  if (blob.size < 44 || await blob.slice(0, 4).text() !== 'RIFF') {
    throw new Error('Ses ayrıştırma servisi geçersiz bir WAV dosyası döndürdü.');
  }
  return blob;
}

export async function removeVocalsFromVideo(
  videoSource: File | Blob | string,
  arg2?: string | VocalRemovalProgress,
  arg3?: string | VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  const onProgress = typeof arg2 === 'function' ? arg2 : typeof arg3 === 'function' ? arg3 : undefined;
  const fileName = typeof arg2 === 'string' ? arg2 : typeof arg3 === 'string' ? arg3 : 'scene';
  const audio = await prepareAudio(videoSource, onProgress);
  let output: Blob | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) onProgress?.('Ses servisi yeniden deneniyor...', 30);
      output = await separate(audio, onProgress);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!output) throw lastError instanceof Error ? lastError : new Error('Vokaller ayrılamadı.');
  return saveInstrumental(output, fileName, 'ai', onProgress);
}

async function saveInstrumental(output: Blob, fileName: string, engine: 'ai' | 'stereo', onProgress?: VocalRemovalProgress): Promise<VocalRemovalResult> {
  onProgress?.('Vokalsiz ses sahneye kaydediliyor...', 92);
  const cleanName = fileName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'scene';
  const path = `instrumentals/${engine}_${Date.now()}_${cleanName}.wav`;
  const { error } = await supabase.storage.from('videos').upload(path, output, {
    cacheControl: '3600',
    contentType: 'audio/wav',
  });
  if (error) throw new Error(`Vokalsiz ses buluta kaydedilemedi: ${error.message}`);
  const { data } = supabase.storage.from('videos').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Vokalsiz ses bağlantısı alınamadı.');
  onProgress?.('Vokalsiz ses hazır.', 100);
  return { blob: output, url: data.publicUrl, duration: 0, engine };
}

/** A local fallback for stereo media: remove the shared center channel. */
export async function reduceCenteredVocals(
  videoSource: File | Blob | string,
  fileName = 'scene',
  onProgress?: VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  const audio = await prepareAudio(videoSource, onProgress);
  const bytes = await audio.arrayBuffer();
  const result = reduceStereoWav(bytes);
  onProgress?.('Stereo kanallardan orta ses ayrıldı...', 86);
  return saveInstrumental(new Blob([result], { type: 'audio/wav' }), fileName, 'stereo', onProgress);
}
