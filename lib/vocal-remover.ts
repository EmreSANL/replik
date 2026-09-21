/**
 * Replik Vocal Remover & M&E (Music & Effects) Audio Engine
 * Videolardaki insan seslerini (konuşmaları) Web Audio API ile otomatik olarak kaldırır.
 * OOPS (Out-Of-Phase Stereo) + Bas ve Tiz Koruma Algoritması kullanır:
 * - 220 Hz altındaki basları ve davulları (kick, bassline) %100 korur.
 * - 6000 Hz üzerindeki parlaklığı ve ambiyansı korur.
 * - 250 Hz - 5000 Hz arasındaki merkez diyalog kanalını (konuşmacı sesini) yok eder.
 * - Çıktıyı yüksek kaliteli WAV Blob formatına çevirir ve Supabase Storage'a yükler.
 */

import { supabase } from './supabase';

export type VocalRemovalProgress = (stage: string, percent: number) => void;

export type VocalRemovalResult = {
  blob: Blob;
  url: string; // Object URL or Supabase CDN URL
  duration: number;
};

/**
 * AudioBuffer'ı PCM 16-bit WAV Blob'una dönüştürür.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferArray = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bufferArray);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /* RIFF header */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');

  /* FMT sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  /* DATA sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // PCM örneklerini 16-bit integer olarak yaz
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Bir AudioBuffer'daki insan seslerini filtreler:
 * 1. Eğer ses stereo ise:
 *    - Konuşmalar stereo miksajda merkezdedir (L == R).
 *    - OOPS (L - R) ile merkez konuşmaları silinir.
 *    - Baslar (<220Hz) ve tizler (>6000Hz) mono/stereo kaybına uğramaması için filtrelenip geri mikslenir.
 * 2. Eğer ses mono ise:
 *    - Vokal formant frekans bandına (300Hz - 3400Hz) notch filtreleri uygulanarak konuşmalar bastırılır.
 */
export async function processVocalRemoval(
  sourceBuffer: AudioBuffer,
  onProgress?: VocalRemovalProgress,
): Promise<AudioBuffer> {
  onProgress?.('Ses frekansları ayrıştırılıyor...', 30);

  const sampleRate = sourceBuffer.sampleRate;
  const numFrames = sourceBuffer.length;
  const isStereo = sourceBuffer.numberOfChannels >= 2;

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const OfflineContextClass =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  if (!OfflineContextClass) {
    throw new Error('Tarayıcınız OfflineAudioContext desteklemiyor.');
  }

  // 2 kanallı stereo çıktı hazırlıyoruz
  const offlineCtx = new OfflineContextClass(2, numFrames, sampleRate);
  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = sourceBuffer;

  if (isStereo) {
    // === STEREO OOPS + BASS/TREBLE PRESERVATION ===
    const splitter = offlineCtx.createChannelSplitter(2);
    const merger = offlineCtx.createChannelMerger(2);

    sourceNode.connect(splitter);

    // 1. Bas Koruma (Low-pass < 220Hz)
    // Bas davullar ve bas gitar genellikle merkezdedir; L - R yaparsak yok olur.
    // O yüzden basları korumak için ayrı filtreliyoruz.
    const bassFilterL = offlineCtx.createBiquadFilter();
    bassFilterL.type = 'lowpass';
    bassFilterL.frequency.setValueAtTime(220, 0);

    const bassFilterR = offlineCtx.createBiquadFilter();
    bassFilterR.type = 'lowpass';
    bassFilterR.frequency.setValueAtTime(220, 0);

    splitter.connect(bassFilterL, 0);
    splitter.connect(bassFilterR, 1);

    bassFilterL.connect(merger, 0, 0);
    bassFilterR.connect(merger, 0, 1);

    // 2. Tiz Koruma (High-pass > 6000Hz)
    // Ziller, ambiyans ve efektler
    const trebleFilterL = offlineCtx.createBiquadFilter();
    trebleFilterL.type = 'highpass';
    trebleFilterL.frequency.setValueAtTime(6000, 0);

    const trebleFilterR = offlineCtx.createBiquadFilter();
    trebleFilterR.type = 'highpass';
    trebleFilterR.frequency.setValueAtTime(6000, 0);

    splitter.connect(trebleFilterL, 0);
    splitter.connect(trebleFilterR, 1);

    trebleFilterL.connect(merger, 0, 0);
    trebleFilterR.connect(merger, 0, 1);

    // 3. Orta Frekans Vokal Bandı İptali (220Hz - 6000Hz arası)
    // L_mid - R_mid -> Merkezdeki diyalog sıfırlanır!
    const midBandL = offlineCtx.createBiquadFilter();
    midBandL.type = 'bandpass';
    midBandL.frequency.setValueAtTime(1400, 0);
    midBandL.Q.setValueAtTime(0.5, 0);

    const midBandR = offlineCtx.createBiquadFilter();
    midBandR.type = 'bandpass';
    midBandR.frequency.setValueAtTime(1400, 0);
    midBandR.Q.setValueAtTime(0.5, 0);

    splitter.connect(midBandL, 0);
    splitter.connect(midBandR, 1);

    // L - R (Sol kanal için)
    const diffGainL = offlineCtx.createGain();
    diffGainL.gain.setValueAtTime(0.9, 0);

    const invGainRForL = offlineCtx.createGain();
    invGainRForL.gain.setValueAtTime(-0.9, 0);

    midBandL.connect(diffGainL);
    midBandR.connect(invGainRForL);

    diffGainL.connect(merger, 0, 0);
    invGainRForL.connect(merger, 0, 0);

    // R - L (Sağ kanal için)
    const diffGainR = offlineCtx.createGain();
    diffGainR.gain.setValueAtTime(0.9, 0);

    const invGainLForR = offlineCtx.createGain();
    invGainLForR.gain.setValueAtTime(-0.9, 0);

    midBandR.connect(diffGainR);
    midBandL.connect(invGainLForR);

    diffGainR.connect(merger, 0, 1);
    invGainLForR.connect(merger, 0, 1);

    merger.connect(offlineCtx.destination);
  } else {
    // === MONO SES İÇİN ADAPTİF VOKAL BASTIRMA FİLTRESİ ===
    const notch1 = offlineCtx.createBiquadFilter();
    notch1.type = 'peaking';
    notch1.frequency.setValueAtTime(1000, 0);
    notch1.Q.setValueAtTime(1.0, 0);
    notch1.gain.setValueAtTime(-24, 0);

    const notch2 = offlineCtx.createBiquadFilter();
    notch2.type = 'peaking';
    notch2.frequency.setValueAtTime(2500, 0);
    notch2.Q.setValueAtTime(1.2, 0);
    notch2.gain.setValueAtTime(-20, 0);

    const notch3 = offlineCtx.createBiquadFilter();
    notch3.type = 'peaking';
    notch3.frequency.setValueAtTime(450, 0);
    notch3.Q.setValueAtTime(1.5, 0);
    notch3.gain.setValueAtTime(-18, 0);

    sourceNode.connect(notch1);
    notch1.connect(notch2);
    notch2.connect(notch3);
    notch3.connect(offlineCtx.destination);
  }

  onProgress?.('Vokalsiz enstrümantal ses işleniyor...', 60);
  sourceNode.start(0);

  const rendered = await offlineCtx.startRendering();
  onProgress?.('Ses hazırlandı.', 90);
  return rendered;
}

/**
 * Video dosyasından insan seslerini çıkarıp enstrümantal / dublaj arka plan sesini üretir.
 * Sonucu WAV Blob ve Supabase CDN URL'si olarak döndürür.
 */
export async function removeVocalsFromVideo(
  videoSource: File | Blob | string,
  fileName?: string,
  onProgress?: VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  onProgress?.('Video sesi çözülüyor...', 10);

  // 1. ArrayBuffer elde et
  let arrayBuffer: ArrayBuffer;
  if (videoSource instanceof File || videoSource instanceof Blob) {
    arrayBuffer = await videoSource.arrayBuffer();
  } else {
    const res = await fetch(videoSource);
    if (!res.ok) {
      throw new Error(`Video indirilemedi: ${videoSource}`);
    }
    arrayBuffer = await res.arrayBuffer();
  }

  // 2. AudioContext ile ses akışını decode et
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtxClass) {
    throw new Error('Web Audio API desteklenmiyor.');
  }

  const audioCtx = new AudioCtxClass();
  let sourceBuffer: AudioBuffer;
  try {
    sourceBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error('Videodan ses ayrıştırılamadı veya video sessiz.');
  } finally {
    void audioCtx.close().catch(() => {});
  }

  // 3. Vokalleri filtrele
  const processedBuffer = await processVocalRemoval(sourceBuffer, onProgress);

  // 4. WAV Blob formatına çevir
  onProgress?.('WAV formatına paketleniyor...', 92);
  const wavBlob = audioBufferToWav(processedBuffer);
  const localUrl = URL.createObjectURL(wavBlob);

  // 5. Supabase Storage bulutuna arka planda yükle
  let publicUrl = localUrl;
  try {
    const cleanBase = fileName
      ? fileName.replace(/\.[^/.]+$/, '').slice(0, 20)
      : 'instrumental';
    const remotePath = `instrumentals/${Date.now()}_${cleanBase}.wav`;

    onProgress?.('Supabase bulutuna kaydediliyor...', 96);
    const { data, error } = await supabase.storage
      .from('videos')
      .upload(remotePath, wavBlob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'audio/wav',
      });

    if (!error && data?.path) {
      const { data: cdnData } = supabase.storage
        .from('videos')
        .getPublicUrl(data.path);
      if (cdnData?.publicUrl) {
        publicUrl = cdnData.publicUrl;
      }
    }
  } catch (uploadErr) {
    console.warn('Instrumental Supabase yükleme uyarısı (yerel url kullanılacak):', uploadErr);
  }

  onProgress?.('Tamamlandı!', 100);

  return {
    blob: wavBlob,
    url: publicUrl,
    duration: processedBuffer.duration,
  };
}
