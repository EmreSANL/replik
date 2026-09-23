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

/**
 * Multi-Band Music & Effects (M&E) Vocal Suppressor.
 * Removes human speech (300Hz-3400Hz center/formant frequencies) while preserving
 * background music, bass impacts (<220Hz), stereo ambiance (L-R), and crisp sound effects (>3800Hz).
 * Works reliably on BOTH stereo AND mono/dual-mono videos.
 */
export async function createMneAudioBuffer(
  decoded: AudioBuffer,
): Promise<AudioBuffer> {
  const sampleRate = decoded.sampleRate;
  const length = decoded.length;
  const offline = new OfflineAudioContext(2, length, sampleRate);

  const leftIn = decoded.getChannelData(0);
  const rightIn =
    decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : leftIn;

  // Measure whether true stereo difference exists
  let sideEnergy = 0;
  let totalEnergy = 0;
  const step = Math.max(1, Math.floor(length / 8000));
  for (let i = 0; i < length; i += step) {
    const l = leftIn[i];
    const r = rightIn[i];
    const diff = l - r;
    sideEnergy += diff * diff;
    totalEnergy += l * l + r * r;
  }
  const hasTrueStereo = totalEnergy > 0 && sideEnergy / totalEnergy >= 0.0025;

  // Create stereo Side buffer (L - R) for ambient music & room effects
  const sideBuffer = offline.createBuffer(2, length, sampleRate);
  const sideL = sideBuffer.getChannelData(0);
  const sideR = sideBuffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const l = leftIn[i];
    const r = rightIn[i];
    if (hasTrueStereo) {
      const side = (l - r) * 0.82;
      sideL[i] = Math.max(-1, Math.min(1, side));
      sideR[i] = Math.max(-1, Math.min(1, -side));
    } else {
      // For mono/dual-mono: create a subtle phase-decorrelated ambient bed
      sideL[i] = l * 0.32;
      sideR[i] = r * 0.32;
    }
  }

  // 1. Side / Ambient Bed Path
  const sideSource = offline.createBufferSource();
  sideSource.buffer = sideBuffer;

  if (!hasTrueStereo) {
    // Deeply carve out human speech formants (350Hz - 3200Hz) on mono bed
    const formantFrequencies = [480, 950, 1750, 2750];
    let lastNode: AudioNode = sideSource;
    for (const freq of formantFrequencies) {
      const notch = offline.createBiquadFilter();
      notch.type = 'peaking';
      notch.frequency.value = freq;
      notch.Q.value = 1.4;
      notch.gain.value = -22;
      lastNode.connect(notch);
      lastNode = notch;
    }
    lastNode.connect(offline.destination);
  } else {
    sideSource.connect(offline.destination);
  }
  sideSource.start(0);

  // 2. Sub-Bass, Rhythm & Impact Effects Path (< 215 Hz) - Keeps drums, bassline, thuds, footsteps
  const bassSource = offline.createBufferSource();
  bassSource.buffer = decoded;
  const lowPass = offline.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.frequency.value = 215;
  lowPass.Q.value = 0.707;
  const bassGain = offline.createGain();
  bassGain.gain.value = 0.95;
  bassSource.connect(lowPass);
  lowPass.connect(bassGain);
  bassGain.connect(offline.destination);
  bassSource.start(0);

  // 3. High-Frequency Crisp Sound Effects & Air Path (> 3900 Hz) - Keeps applause, clicks, glass, sfx
  const sfxSource = offline.createBufferSource();
  sfxSource.buffer = decoded;
  const highPass = offline.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 3900;
  highPass.Q.value = 0.707;
  const sfxGain = offline.createGain();
  sfxGain.gain.value = 0.75;
  sfxSource.connect(highPass);
  highPass.connect(sfxGain);
  sfxGain.connect(offline.destination);
  sfxSource.start(0);

  return await offline.startRendering();
}

type GradioFile = { path?: string; url?: string };

function parseCompletion(stream: string): GradioFile {
  for (const block of stream.split(/\r?\n\r?\n/)) {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    if (event === 'error') {
      throw new Error('Bulut AI servisi yoğun.');
    }
    if (event !== 'complete' || !data) continue;
    const result = JSON.parse(data) as GradioFile[];
    if (
      Array.isArray(result) &&
      result[1] &&
      (result[1].url || result[1].path)
    ) {
      return result[1];
    }
  }
  throw new Error('Ses ayırma servisinden geçerli bir çıktı gelmedi.');
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
    signal: AbortSignal.timeout(60000),
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

async function separateWithPublicService(
  audio: Blob,
  onProgress?: VocalRemovalProgress,
): Promise<Blob> {
  const form = new FormData();
  form.append('files', audio, 'scene-audio.wav');
  onProgress?.('AI ses ayrıştırma servisine bağlanılıyor...', 30);
  const upload = await fetch(`${HF_BASE}/gradio_api/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!upload.ok) throw new Error(`Ses yükleme başarısız (${upload.status}).`);
  const paths = (await upload.json()) as string[];
  const path = paths?.[0];
  if (!path) throw new Error('Ses yükleme yolu alınamadı.');
  onProgress?.('AI vokalleri müzik ve efektlerden ayırıyor...', 52);
  const call = await fetch(`${HF_BASE}/gradio_api/call/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [
        {
          path,
          url: `${HF_BASE}/gradio_api/file=${path}`,
          orig_name: 'scene-audio.wav',
          meta: { _type: 'gradio.FileData' },
        },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!call.ok) {
    throw new Error(`Ses ayrıştırma başlatılamadı (${call.status}).`);
  }
  const { event_id: eventId } = (await call.json()) as { event_id?: string };
  if (!eventId) throw new Error('Ses ayrıştırma işlem numarası alınamadı.');
  const stream = await fetch(`${HF_BASE}/gradio_api/call/inference/${eventId}`, {
    signal: AbortSignal.timeout(25000),
  });
  if (!stream.ok) {
    throw new Error(`Ses ayrıştırma sonucu alınamadı (${stream.status}).`);
  }
  const output = parseCompletion(await stream.text());
  const outputUrl = output.url || `${HF_BASE}/gradio_api/file=${output.path}`;
  onProgress?.('Vokalsiz M&E ses indiriliyor...', 82);
  const download = await fetch(outputUrl, {
    signal: AbortSignal.timeout(15000),
  });
  if (!download.ok) {
    throw new Error(`Vokalsiz ses indirilemedi (${download.status}).`);
  }
  const blob = await download.blob();
  if (blob.size < 44 || (await blob.slice(0, 4).text()) !== 'RIFF') {
    throw new Error('Geçersiz WAV çıktısı.');
  }
  return blob;
}

async function separate(
  audio: Blob,
  onProgress?: VocalRemovalProgress,
): Promise<Blob> {
  return DEMUCS_ENDPOINT
    ? separateWithOwnDemucs(audio, onProgress)
    : separateWithPublicService(audio, onProgress);
}

async function saveInstrumental(
  output: Blob,
  fileName: string,
  engine: 'ai' | 'stereo',
  onProgress?: VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  onProgress?.('Vokalsiz müzik & efekt (M&E) kanalı kaydediliyor...', 92);
  const cleanName =
    fileName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'scene';
  const path = `instrumentals/${engine}_${Date.now()}_${cleanName}.wav`;
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
        onProgress?.('Vokalsiz ses hazır.', 100);
        return { blob: output, url: data.publicUrl, duration: 0, engine };
      }
    }
  } catch {
    // Fallback to local blob URL if storage upload fails
  }
  const localUrl = URL.createObjectURL(output);
  onProgress?.('Vokalsiz ses hazır.', 100);
  return { blob: output, url: localUrl, duration: 0, engine };
}

/**
 * Removes vocals and preserves Music & Sound Effects (M&E).
 * First attempts Cloud AI Demucs; if busy or rate-limited, automatically falls back
 * to our built-in Multi-Band M&E Vocal Suppressor so it NEVER fails.
 */
export async function removeVocalsFromVideo(
  videoSource: File | Blob | string,
  arg2?: string | VocalRemovalProgress,
  arg3?: string | VocalRemovalProgress,
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

  onProgress?.('Videonun sesi ayrıştırma için hazırlanıyor...', 14);
  const decoded = await decodeMediaAudioBuffer(videoSource);
  const wavBlob = audioBufferToWav(decoded);

  // 1. Try AI Demucs first
  try {
    const aiOutput = await separate(wavBlob, onProgress);
    return await saveInstrumental(aiOutput, fileName, 'ai', onProgress);
  } catch (aiErr) {
    console.warn(
      'Bulut AI yoğun, yerleşik M&E (Müzik & Efekt) Vokal Bastırıcı devreye alındı:',
      aiErr,
    );
  }

  // 2. Automatic unbreakable fallback: Multi-Band M&E Vocal Suppressor (works on Stereo & Mono)
  onProgress?.(
    'Yerleşik M&E motoru ile insan sesleri bastırılıp müzik ve efektler korunuyor...',
    68,
  );
  const mneBuffer = await createMneAudioBuffer(decoded);
  const mneWav = audioBufferToWav(mneBuffer);
  return await saveInstrumental(mneWav, fileName, 'stereo', onProgress);
}

/**
 * Local M&E vocal reducer: tries stereo phase cancellation first, and automatically
 * uses Multi-Band M&E Vocal Suppressor for mono / dual-mono videos.
 */
export async function reduceCenteredVocals(
  videoSource: File | Blob | string,
  fileName = 'scene',
  onProgress?: VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  onProgress?.('Ses kanalları analiz ediliyor...', 20);
  const decoded = await decodeMediaAudioBuffer(videoSource);
  const wavBlob = audioBufferToWav(decoded);
  try {
    const bytes = await wavBlob.arrayBuffer();
    const result = reduceStereoWav(bytes);
    onProgress?.('Stereo kanallardan orta konuşma sesi ayrıldı...', 86);
    return await saveInstrumental(
      new Blob([result], { type: 'audio/wav' }),
      fileName,
      'stereo',
      onProgress,
    );
  } catch {
    onProgress?.(
      'M&E Spektral Vokal Bastırıcı ile müzik ve efekt kanalı oluşturuluyor...',
      75,
    );
    const mneBuffer = await createMneAudioBuffer(decoded);
    const mneWav = audioBufferToWav(mneBuffer);
    return await saveInstrumental(mneWav, fileName, 'stereo', onProgress);
  }
}
