/**
 * Replik Audio Voice Activity Detection (VAD) & Timing Alignment Engine
 * Ses dalga boyundaki (Float32Array PCM) enerji seviyelerini analiz ederek:
 * 1. İnsan konuşmasının gerçek başlangıç ve bitiş noktalarını milisaniye hassasiyetinde tespit eder.
 * 2. Whisper'dan dönen repliklerin zaman damgalarını fiziksel ses başlangıçlarına kilitler (snap).
 * 3. Sessizlik boşluklarını, çakışmaları ve konuşulmayan aralıkları otomatik temizler.
 */

export type SpeechInterval = {
  start: number; // saniye
  end: number; // saniye
  duration: number;
  energy: number;
};

export type VadOptions = {
  frameSizeMs: number; // Analiz penceresi (örn. 25ms)
  hopSizeMs: number; // Atlama adımı (örn. 10ms)
  minSpeechDurationMs: number; // Minimum konuşma süresi (örn. 200ms)
  maxPauseDurationMs: number; // İki kelime arası izin verilen boşluk (örn. 350ms)
  preSpeechPadMs: number; // Konuşma başlangıcına eklenen tampon (örn. 80ms)
  postSpeechPadMs: number; // Konuşma bitişine eklenen tampon (örn. 120ms)
};

const DEFAULT_VAD_OPTIONS: VadOptions = {
  frameSizeMs: 25,
  hopSizeMs: 10,
  minSpeechDurationMs: 200,
  maxPauseDurationMs: 350,
  preSpeechPadMs: 80,
  postSpeechPadMs: 120,
};

/**
 * Ses verisini konuşma tanıma için optimize eder (Speech Enhancement):
 * - 100Hz altındaki rüzgar, mikrofon sürtünmesi ve DC ofsetleri temizler.
 * - RMS ses seviyesini nominal Whisper seviyesine normalize eder (kısık sesleri güçlendirir).
 */
export function enhanceSpeechAudio(
  audioData: Float32Array,
  sampleRate: number = 16000,
): Float32Array {
  const enhanced = new Float32Array(audioData.length);
  if (audioData.length === 0) return enhanced;

  // 1. High-pass IIR Filtre (100 Hz cutoff) - DC ofset ve bas uğultusunu keser
  const rc = 1.0 / (2.0 * Math.PI * 100);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);

  let prevInput = audioData[0];
  let prevOutput = audioData[0];
  enhanced[0] = prevOutput;

  for (let i = 1; i < audioData.length; i++) {
    const current = audioData[i];
    const out = alpha * (prevOutput + current - prevInput);
    enhanced[i] = out;
    prevInput = current;
    prevOutput = out;
  }

  // 2. Maksimum tepe değerini bul ve normalize et (Peak Normalization)
  let maxVal = 0;
  for (let i = 0; i < enhanced.length; i++) {
    const abs = Math.abs(enhanced[i]);
    if (abs > maxVal) maxVal = abs;
  }

  if (maxVal > 0.001) {
    const targetPeak = 0.90;
    const gain = Math.min(10.0, targetPeak / maxVal);
    for (let i = 0; i < enhanced.length; i++) {
      enhanced[i] *= gain;
    }
  }

  return enhanced;
}

/**
 * Ses dalgasındaki gerçek konuşma aralıklarını tespit eder (Energy VAD).
 */
export function detectSpeechIntervals(
  audioData: Float32Array,
  sampleRate: number = 16000,
  options?: Partial<VadOptions>,
): SpeechInterval[] {
  const opts = { ...DEFAULT_VAD_OPTIONS, ...options };
  const frameLength = Math.max(1, Math.floor((sampleRate * opts.frameSizeMs) / 1000));
  const hopLength = Math.max(1, Math.floor((sampleRate * opts.hopSizeMs) / 1000));
  const totalFrames = Math.floor((audioData.length - frameLength) / hopLength);

  if (totalFrames <= 0) return [];

  // 1. Her karenin RMS enerjisini hesapla
  const frameEnergies = new Float32Array(totalFrames);
  let energySum = 0;
  let maxEnergy = 0;

  for (let f = 0; f < totalFrames; f++) {
    const offset = f * hopLength;
    let sumSquares = 0;
    for (let i = 0; i < frameLength; i++) {
      const val = audioData[offset + i];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / frameLength);
    frameEnergies[f] = rms;
    energySum += rms;
    if (rms > maxEnergy) maxEnergy = rms;
  }

  const avgEnergy = energySum / totalFrames;

  // 2. Dinamik gürültü tabanı (Noise Floor) ve Konuşma Eşiği (Threshold)
  // Kare enerjilerini sıralayarak 20. persentili (arka plan gürültüsü) tahmin et
  const sorted = Float32Array.from(frameEnergies).sort();
  const noiseFloor = sorted[Math.floor(totalFrames * 0.20)] || 0.005;
  const speechThreshold = Math.max(
    noiseFloor * 1.8,
    noiseFloor + (maxEnergy - noiseFloor) * 0.08,
    avgEnergy * 0.35,
    0.015,
  );

  // 3. Konuşma karelerini belirle ve kısa sessizlikleri (hangover) birleştir
  const maxPauseFrames = Math.floor((opts.maxPauseDurationMs / 1000) * (sampleRate / hopLength));
  const minSpeechFrames = Math.floor((opts.minSpeechDurationMs / 1000) * (sampleRate / hopLength));

  type RawInterval = { startFrame: number; endFrame: number; peak: number };
  const rawIntervals: RawInterval[] = [];

  let inSpeech = false;
  let startFrame = 0;
  let silenceCount = 0;
  let currentPeak = 0;

  for (let f = 0; f < totalFrames; f++) {
    const e = frameEnergies[f];
    const isSpeechFrame = e >= speechThreshold;

    if (isSpeechFrame) {
      if (!inSpeech) {
        inSpeech = true;
        startFrame = f;
        currentPeak = e;
        silenceCount = 0;
      } else {
        silenceCount = 0;
        if (e > currentPeak) currentPeak = e;
      }
    } else if (inSpeech) {
      silenceCount++;
      if (silenceCount > maxPauseFrames || f === totalFrames - 1) {
        const actualEndFrame = f - silenceCount;
        if (actualEndFrame - startFrame >= minSpeechFrames) {
          rawIntervals.push({
            startFrame,
            endFrame: actualEndFrame,
            peak: currentPeak,
          });
        }
        inSpeech = false;
        silenceCount = 0;
        currentPeak = 0;
      }
    }
  }

  // 4. Zaman cinsine çevir ve pre-roll / post-roll tamponları ekle
  const prePadSec = opts.preSpeechPadMs / 1000;
  const postPadSec = opts.postSpeechPadMs / 1000;
  const totalAudioSec = audioData.length / sampleRate;

  const intervals: SpeechInterval[] = rawIntervals.map((raw) => {
    const rawStart = (raw.startFrame * hopLength) / sampleRate;
    const rawEnd = (raw.endFrame * hopLength + frameLength) / sampleRate;

    const start = Math.max(0, Number((rawStart - prePadSec).toFixed(2)));
    const end = Math.min(totalAudioSec, Number((rawEnd + postPadSec).toFixed(2)));

    return {
      start,
      end,
      duration: Number((end - start).toFixed(2)),
      energy: Number(raw.peak.toFixed(3)),
    };
  });

  return intervals;
}

/**
 * Verilen bir repliğin (start, end) zamanlarını en yakın gerçek konuşma aralığına hizalar.
 */
export function snapTimeToSpeech(
  start: number,
  end: number,
  intervals: SpeechInterval[],
  videoDuration: number,
): { start: number; end: number } {
  if (intervals.length === 0) {
    return {
      start: Math.max(0, Number(start.toFixed(2))),
      end: Math.min(videoDuration, Math.max(start + 0.5, Number(end.toFixed(2)))),
    };
  }

  // 1. Bu replikle kesişen veya yakın olan aralıkları topla
  const searchWindowSec = 1.0;
  const overlapping = intervals.filter((inv) => {
    return (
      (inv.start >= start - searchWindowSec && inv.start <= end + searchWindowSec) ||
      (inv.end >= start - searchWindowSec && inv.end <= end + searchWindowSec) ||
      (inv.start <= start && inv.end >= end)
    );
  });

  if (overlapping.length > 0) {
    // Kesişen en erken başlangıç ve en geç bitiş
    let bestStart = overlapping[0].start;
    let bestEnd = overlapping[overlapping.length - 1].end;

    // Çok uzak bir aralık seçilmesin (en fazla ±1.2s kayma toleransı)
    if (Math.abs(bestStart - start) > 1.2) {
      bestStart = Math.max(0, start);
    }
    if (Math.abs(bestEnd - end) > 1.5) {
      bestEnd = Math.max(bestStart + 0.6, end);
    }

    bestStart = Math.max(0, Number(bestStart.toFixed(2)));
    bestEnd = Math.min(videoDuration > 0 ? videoDuration : bestEnd, Number(bestEnd.toFixed(2)));
    if (bestEnd <= bestStart) bestEnd = Number((bestStart + 0.6).toFixed(2));

    return { start: bestStart, end: bestEnd };
  }

  // Yakında belirgin bir konuşma bulunamadıysa orijinali sınırlandır
  const safeStart = Math.max(0, Number(start.toFixed(2)));
  const safeEnd = Math.min(
    videoDuration > 0 ? videoDuration : start + 2.0,
    Math.max(safeStart + 0.5, Number(end.toFixed(2))),
  );
  return { start: safeStart, end: safeEnd };
}

/**
 * Replik listesindeki tüm repliklerin zaman damgalarını ses dalgasına göre
 * baştan sona otomatik hizalar, çakışmaları ve kaymaları giderir.
 */
export function alignAllCuesWithAudio(
  cues: Array<{
    id: number;
    roleIndex: number;
    roleName: string;
    roleColor: string;
    start: number;
    end: number;
    text: string;
  }>,
  audioData: Float32Array,
  videoDuration: number,
  sampleRate: number = 16000,
): typeof cues {
  if (!cues || cues.length === 0) return [];

  // Ses dalgasındaki konuşma noktalarını çıkar
  const intervals = detectSpeechIntervals(audioData, sampleRate);

  // Replikleri kronolojik olarak sırala
  const sorted = [...cues].sort((a, b) => a.start - b.start);

  const aligned = sorted.map((cue) => {
    const snapped = snapTimeToSpeech(cue.start, cue.end, intervals, videoDuration);
    return {
      ...cue,
      start: snapped.start,
      end: snapped.end,
    };
  });

  // Çakışmaları çöz (Overlap resolution: önceki replik sonrakinin üzerine binmesin)
  for (let i = 0; i < aligned.length; i++) {
    const current = aligned[i];
    const next = aligned[i + 1];

    if (next && current.end > next.start) {
      // Çakışma varsa aralarında 0.05s mikro boşluk bırakarak sınırla
      const mid = Number(((current.end + next.start) / 2).toFixed(2));
      current.end = Math.max(current.start + 0.4, mid - 0.05);
      next.start = Math.max(current.end + 0.05, mid);
    }

    if (videoDuration > 0 && current.end > videoDuration) {
      current.end = Number(videoDuration.toFixed(2));
    }
  }

  return aligned;
}
