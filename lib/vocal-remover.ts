import { supabase } from './supabase';
import { reduceStereoWav } from './stereo-vocal-reducer';

export type VocalRemovalProgress = (stage: string, percent: number) => void;
export type VocalRemovalResult = {
  blob: Blob;
  url: string;
  duration: number;
  engine: 'ai' | 'stereo';
};

const HF_BASE = 'https://abidlabs-music-separation.hf.space';
const DEMUCS_ENDPOINT = process.env.NEXT_PUBLIC_DEMUCS_ENDPOINT?.trim();

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

export type CueTimeRange = { start: number; end: number };

/**
 * Saf AI Vokal Ayırıcı (htdemucs --two-stems=vocals) çıktısını bozmamak için
 * hiçbir yapay 25ms çerçeve kesme (frame-slicing) veya cızırtı üreten filtre uygulanmaz.
 */
export async function createMneAudioBuffer(
  decoded: AudioBuffer,
  _cues?: CueTimeRange[],
): Promise<AudioBuffer> {
  return decoded;
}

async function separateWithOwnDemucs(
  audio: Blob,
  onProgress?: VocalRemovalProgress,
): Promise<Blob> {
  onProgress?.('Demucs modeli konuşmayı müzik ve efektlerden ayırıyor...', 48);
  const response = await fetch(DEMUCS_ENDPOINT!, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: audio,
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) {
    throw new Error(`Demucs ses ayırma işlemi başarısız (${response.status}).`);
  }
  onProgress?.('Müzik ve efekt kanalı alınıyor...', 82);
  const result = await response.blob();
  if (result.size < 44 || (await result.slice(0, 4).text()) !== 'RIFF') {
    throw new Error('Demucs geçerli bir WAV dosyası döndürmedi.');
  }
  return result;
}

async function separateWithCloudDemucs(
  audio: Blob,
  onProgress?: VocalRemovalProgress,
): Promise<Blob> {
  onProgress?.('Açık kaynak Demucs v4 AI motoruna bağlanılıyor...', 35);
  const form = new FormData();
  form.append('files', audio, 'input_audio.wav');

  const upRes = await fetch(`${HF_BASE}/gradio_api/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(45000),
  });
  if (!upRes.ok) {
    throw new Error(`Demucs AI yükleme hatası (${upRes.status}).`);
  }
  const uploaded = (await upRes.json()) as string[];
  const remotePath = uploaded[0];

  onProgress?.('AI (htdemucs) insan seslerini kaldırıp müzik ve efektleri koruyor...', 60);
  const callRes = await fetch(`${HF_BASE}/gradio_api/call/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [
        {
          path: remotePath,
          url: `${HF_BASE}/gradio_api/file=${remotePath}`,
          orig_name: 'input_audio.wav',
          meta: { _type: 'gradio.FileData' },
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!callRes.ok) {
    throw new Error(`Demucs AI başlatılamadı (${callRes.status}).`);
  }
  const { event_id } = (await callRes.json()) as { event_id: string };
  const sseRes = await fetch(`${HF_BASE}/gradio_api/call/inference/${event_id}`, {
    signal: AbortSignal.timeout(180000),
  });
  const sseText = await sseRes.text();
  let noVocalsUrl = '';
  for (const line of sseText.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]?.url) {
          noVocalsUrl = parsed[1].url;
        } else if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]?.path) {
          noVocalsUrl = `${HF_BASE}/gradio_api/file=${parsed[1].path}`;
        }
      } catch {}
    }
  }
  if (!noVocalsUrl) {
    throw new Error('Demucs AI no_vocals.wav üretemedi.');
  }
  onProgress?.('Saf AI arka plan sesi (no_vocals.wav) indiriliyor...', 85);
  const dl = await fetch(noVocalsUrl, { signal: AbortSignal.timeout(60000) });
  if (!dl.ok) {
    throw new Error(`no_vocals.wav indirilemedi (${dl.status}).`);
  }
  const blob = await dl.blob();
  if (blob.size < 44 || (await blob.slice(0, 4).text()) !== 'RIFF') {
    throw new Error('Geçersiz WAV çıktısı.');
  }
  return blob;
}

async function saveInstrumental(
  output: Blob,
  fileName: string,
  engine: 'ai' | 'stereo',
  onProgress?: VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  onProgress?.('Saf AI arka plan sesi kaydediliyor...', 92);
  const cleanName =
    fileName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'scene';
  const path = `instrumentals/pure_htdemucs_${Date.now()}_${cleanName}.wav`;
  try {
    const { error } = await supabase.storage
      .from('videos')
      .upload(path, output, {
        cacheControl: '3600',
        contentType: 'audio/wav',
      });
    if (!error) {
      const { data } = supabase.storage.from('videos').getPublicUrl(path);
      if (data?.publicUrl) {
        onProgress?.('Saf AI vokal ayrıştırma tamamlandı.', 100);
        return { blob: output, url: data.publicUrl, duration: 0, engine };
      }
    }
  } catch {
    // Fallback to local blob URL if storage upload fails
  }
  const localUrl = URL.createObjectURL(output);
  onProgress?.('Saf AI vokal ayrıştırma tamamlandı.', 100);
  return { blob: output, url: localUrl, duration: 0, engine };
}

/**
 * vocalremover.org / splitter-ai tarzı Açık Kaynak AI Vokal Ayırıcı (Meta Hybrid Transformer Demucs v4: htdemucs --two-stems=vocals)
 * Sadece insan seslerini (vocals) ayırır; videodaki ses efektlerini (SFX), müziği ve ortam ambiyansını
 * hiçbir cızırtı veya yapay ses kısma (ducking) olmadan %100 koruyan saf no_vocals.wav çıktısını üretir.
 */
export async function removeVocalsFromVideo(
  videoSource: File | Blob | string,
  arg2?: string | VocalRemovalProgress,
  arg3?: string | VocalRemovalProgress,
  _cues?: CueTimeRange[],
): Promise<VocalRemovalResult> {
  const onProgress =
    typeof arg2 === 'function'
      ? arg2
      : typeof arg3 === 'function'
        ? arg3
        : undefined;
  const fileName =
    typeof arg2 === 'string'
      ? arg2
      : typeof arg3 === 'string'
        ? arg3
        : 'scene';

  onProgress?.('Splitter-AI (htdemucs) başlatılıyor...', 12);

  // 1. Öncelikle kendi yerel/sunucu Açık Kaynak Splitter-AI (htdemucs --two-stems=vocals) motorumuzu (/api/splitter-ai) çalıştır
  try {
    onProgress?.(
      'Yapay Zeka (htdemucs): Müzik ve ses efektleri korunarak sadece insan sesleri ayrıştırılıyor...',
      30,
    );
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};

    let apiRes: Response;
    if (typeof videoSource === 'string' && !videoSource.startsWith('blob:')) {
      apiRes = await fetch('/api/splitter-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ videoUrl: videoSource }),
      });
    } else {
      const mediaBlob = await fetchMediaBlob(videoSource);
      apiRes = await fetch('/api/splitter-ai', {
        method: 'POST',
        headers: {
          'Content-Type': mediaBlob.type || 'application/octet-stream',
          ...authHeaders,
        },
        body: mediaBlob,
      });
    }

    if (apiRes.ok) {
      const data = (await apiRes.json()) as {
        ok?: boolean;
        instrumentalUrl?: string;
      };
      if (data.ok && data.instrumentalUrl) {
        onProgress?.('Saf AI arka plan sesi (no_vocals.wav) doğrulanıyor...', 88);
        const wavResp = await fetch(data.instrumentalUrl);
        if (wavResp.ok) {
          const wavBlob = await wavResp.blob();
          onProgress?.('Tamamlandı! Saf AI (htdemucs) ile vokaller ayrıldı.', 100);
          return {
            blob: wavBlob,
            url: data.instrumentalUrl,
            duration: 0,
            engine: 'ai',
          };
        }
      }
    }
  } catch (splitterErr) {
    console.warn('[Splitter-AI] Yerel API uyarısı, alternatif Demucs deneniyor:', splitterErr);
  }

  // 2. Harici Demucs endpoint veya Bulut Demucs v4 (saf no_vocals.wav)
  const decoded = await decodeMediaAudioBuffer(videoSource);
  const wavBlob = audioBufferToWav(decoded);

  if (DEMUCS_ENDPOINT) {
    const outBlob = await separateWithOwnDemucs(wavBlob, onProgress);
    return await saveInstrumental(outBlob, fileName, 'ai', onProgress);
  }

  const cloudBlob = await separateWithCloudDemucs(wavBlob, onProgress);
  return await saveInstrumental(cloudBlob, fileName, 'ai', onProgress);
}

/**
 * Stereo yedek vokal azaltıcı: Önce açık kaynak Splitter-AI'ı dener,
 * ulaşılamazsa cızırtısız doğrusal stereo merkez kanal azaltma uygular.
 */
export async function reduceCenteredVocals(
  videoSource: File | Blob | string,
  fileName = 'scene',
  onProgress?: VocalRemovalProgress,
  cues?: CueTimeRange[],
): Promise<VocalRemovalResult> {
  try {
    return await removeVocalsFromVideo(videoSource, fileName, onProgress, cues);
  } catch {
    onProgress?.('Stereo merkez kanaldan insan sesi azaltılıyor...', 65);
    const decoded = await decodeMediaAudioBuffer(videoSource);
    const wavBlob = audioBufferToWav(decoded);
    const bytes = await wavBlob.arrayBuffer();
    const reducedBytes = reduceStereoWav(bytes);
    return await saveInstrumental(
      new Blob([reducedBytes], { type: 'audio/wav' }),
      fileName,
      'stereo',
      onProgress,
    );
  }
}
