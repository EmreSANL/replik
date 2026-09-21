/**
 * Videodan ses çıkarma yardımcısı.
 * Web Audio API kullanarak videoyu 16kHz mono PCM Float32 formatına çevirir.
 * Whisper modelinin beklediği format budur.
 */

/**
 * Bir video elementinden veya Blob URL'den sesi çıkarır
 * ve Whisper'ın beklediği 16kHz mono Float32Array formatına dönüştürür.
 */
export async function extractAudioFromVideo(
  videoSource: string | Blob,
  onProgress?: (stage: string, pct: number) => void,
): Promise<Float32Array> {
  onProgress?.('Ses dosyası alınıyor...', 0);

  // 1. Blob olarak elde et
  let blob: Blob;
  if (videoSource instanceof Blob) {
    blob = videoSource;
  } else {
    const resp = await fetch(videoSource);
    if (!resp.ok) {
      throw new Error(`Video dosyası yüklenemedi (${resp.status}): ${videoSource}`);
    }
    blob = await resp.blob();
  }

  onProgress?.('Ses verisi okunuyor...', 25);

  // 2. ArrayBuffer'a çevir
  const arrayBuffer = await blob.arrayBuffer();
  onProgress?.('Ses çözülüyor (decode)...', 50);

  // 3. AudioContext ile decode et
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Tarayıcınız Web Audio API desteklemiyor.');
  }

  const audioCtx = new AudioContextClass();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error('Videodaki ses verisi çözülemedi veya videoda ses kaydı bulunamadı.');
  } finally {
    try {
      await audioCtx.close();
    } catch {
      // ignore
    }
  }

  onProgress?.('16kHz mono formatına dönüştürülüyor...', 75);

  // 4. 16kHz mono PCM Float32 formatına dönüştür (Whisper gereksinimi)
  const targetSampleRate = 16000;
  const numFrames = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate));

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  let monoData: Float32Array;

  if (OfflineContextClass) {
    const offlineCtx = new OfflineContextClass(1, numFrames, targetSampleRate);
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(offlineCtx.destination);
    sourceNode.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    monoData = renderedBuffer.getChannelData(0);
  } else {
    // Fallback: Kanal 0 verisini al
    const rawData = audioBuffer.getChannelData(0);
    monoData = new Float32Array(rawData.length);
    monoData.set(rawData);
  }

  onProgress?.('Ses hazır.', 100);
  return monoData;
}

/**
 * Float32Array ses verisini ~30 saniyelik parçalara böler.
 * Whisper modeli uzun seslerde daha iyi çalışır ancak
 * çok uzun dosyalarda bellek sorunları olabilir.
 */
export function chunkAudio(
  audioData: Float32Array,
  sampleRate: number = 16000,
  chunkDurationSec: number = 30,
): Float32Array[] {
  const chunkSize = sampleRate * chunkDurationSec;
  const chunks: Float32Array[] = [];

  for (let offset = 0; offset < audioData.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, audioData.length);
    chunks.push(audioData.slice(offset, end));
  }

  return chunks;
}

/**
 * Saniye cinsinden ses süresini hesaplar.
 */
export function getAudioDuration(
  audioData: Float32Array,
  sampleRate: number = 16000,
): number {
  return audioData.length / sampleRate;
}
