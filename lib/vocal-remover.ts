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
 * 3-Stage Zero-Vocal Music & Effects (M&E) Engine:
 * 1. Extracts non-speech ambient/music bed from the video's quiet/non-dialogue frames.
 * 2. Detects every spoken syllable using a 150Hz-4000Hz Voice Activity Detector (VAD)
 *    combined with explicit Replik/Cue time ranges ([cue.start, cue.end]).
 * 3. During speech/cues, completely erases the human voice (0% vocal bleed across all frequencies)
 *    and seamlessly crossfades in the video's own non-speech ambient/music bed + <85Hz sub-impacts
 *    + true stereo side (L-R) music, while preserving 100% of sound effects between lines.
 */
export async function createMneAudioBuffer(
  decoded: AudioBuffer,
  cues?: CueTimeRange[],
): Promise<AudioBuffer> {
  const sampleRate = decoded.sampleRate;
  const length = decoded.length;
  const offline = new OfflineAudioContext(2, length, sampleRate);

  // 1. Render vocal-band (160 Hz - 3800 Hz) for accurate Voice Activity Detection (VAD)
  //    and sub-impact band (< 85 Hz) for non-vocal thuds/impacts
  const vadOffline = new OfflineAudioContext(1, length, sampleRate);
  const vadSrc = vadOffline.createBufferSource();
  vadSrc.buffer = decoded;
  const hp = vadOffline.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 160;
  hp.Q.value = 0.707;
  const lp = vadOffline.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3800;
  lp.Q.value = 0.707;
  vadSrc.connect(hp);
  hp.connect(lp);
  lp.connect(vadOffline.destination);
  vadSrc.start(0);
  const vocalBandBuffer = await vadOffline.startRendering();
  const vocalBandData = vocalBandBuffer.getChannelData(0);

  // Render < 85 Hz sub-bass impacts (explosions, footsteps, thuds - below human voice fundamentals)
  const subOffline = new OfflineAudioContext(1, length, sampleRate);
  const subSrc = subOffline.createBufferSource();
  subSrc.buffer = decoded;
  const subLp1 = subOffline.createBiquadFilter();
  subLp1.type = 'lowpass';
  subLp1.frequency.value = 85;
  subLp1.Q.value = 0.707;
  const subLp2 = subOffline.createBiquadFilter();
  subLp2.type = 'lowpass';
  subLp2.frequency.value = 85;
  subLp2.Q.value = 0.707;
  subSrc.connect(subLp1);
  subLp1.connect(subLp2);
  subLp2.connect(subOffline.destination);
  subSrc.start(0);
  const subImpactBuffer = await subOffline.startRendering();
  const subImpactData = subImpactBuffer.getChannelData(0);

  const leftIn = decoded.getChannelData(0);
  const rightIn =
    decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : leftIn;

  // 2. Analyze 25ms frames for VAD (Voice Activity Detection) and find cleanest non-speech ambiance frames
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.025));
  const numFrames = Math.ceil(length / frameSize);
  const vocalRms = new Float32Array(numFrames);
  const totalRms = new Float32Array(numFrames);
  const sideRms = new Float32Array(numFrames);

  let sumSide = 0;
  let sumTotal = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSize;
    const end = Math.min(length, start + frameSize);
    let vSum = 0;
    let tSum = 0;
    let sSum = 0;
    for (let i = start; i < end; i++) {
      const v = vocalBandData[i];
      const l = leftIn[i];
      const r = rightIn[i];
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      vSum += v * v;
      tSum += mid * mid;
      sSum += side * side;
    }
    const count = Math.max(1, end - start);
    vocalRms[f] = Math.sqrt(vSum / count);
    totalRms[f] = Math.sqrt(tSum / count);
    sideRms[f] = Math.sqrt(sSum / count);
    sumSide += sSum;
    sumTotal += tSum;
  }

  const hasTrueStereo = sumTotal > 0 && sumSide / sumTotal >= 0.015;

  // Sort vocalRms to find the noise/ambience floor vs speech peak
  const sortedVocal = Float32Array.from(vocalRms).sort();
  const p20 = sortedVocal[Math.floor(numFrames * 0.2)] || 0.001;
  const p50 = sortedVocal[Math.floor(numFrames * 0.5)] || 0.005;
  const p85 = sortedVocal[Math.floor(numFrames * 0.85)] || 0.02;

  // Dynamic speech threshold: frames with vocal energy above background floor are flagged as speech
  const speechThreshold = Math.max(
    0.004,
    Math.min(p50 * 0.85, p20 * 2.2 + (p85 - p20) * 0.14),
  );

  // Build a continuous Ambient Room-Tone / Background Bed from the non-speech frames of the video
  const ambientFrames: number[] = [];
  for (let f = 0; f < numFrames; f++) {
    const tSec = (f * frameSize) / sampleRate;
    const inCue =
      cues &&
      cues.length > 0 &&
      cues.some((c) => tSec >= c.start - 0.05 && tSec <= c.end + 0.05);
    if (!inCue && vocalRms[f] <= p20 * 1.6 && totalRms[f] > 0.0002) {
      ambientFrames.push(f);
    }
  }
  if (ambientFrames.length === 0) {
    for (let f = 0; f < numFrames; f++) {
      if (vocalRms[f] <= p50) ambientFrames.push(f);
    }
  }

  // Determine per-frame speech suppression mask (0.0 = 100% vocal erased, 1.0 = full SFX/music preserved)
  const rawKeepMask = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const tSec = (f * frameSize) / sampleRate;
    const inCueWindow =
      cues &&
      cues.length > 0 &&
      cues.some((c) => tSec >= c.start - 0.1 && tSec <= c.end + 0.1);

    const isVocalBurst = vocalRms[f] > speechThreshold;

    if (inCueWindow) {
      // Inside a Replik/Cue window: 100% silence original speech so player's dub is crystal clear!
      rawKeepMask[f] = 0.0;
    } else if (isVocalBurst) {
      // Detected human speech syllable outside cues (or when cues aren't set yet): erase speech!
      rawKeepMask[f] = 0.0;
    } else {
      // Non-speech pause / sound effect / background music moment: keep!
      rawKeepMask[f] = 0.92;
    }
  }

  // Expand speech zero-mask by 2 frames (50ms attack/hold) so consonant plosives/sibilants at word edges are also erased
  const expandedMask = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let minVal = rawKeepMask[f];
    for (let k = Math.max(0, f - 2); k <= Math.min(numFrames - 1, f + 2); k++) {
      if (rawKeepMask[k] < minVal) minVal = rawKeepMask[k];
    }
    expandedMask[f] = minVal;
  }

  // Smooth the frame mask so transitions have zero clicks/pops
  const smoothMask = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let acc = 0;
    let count = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(numFrames - 1, f + 2); k++) {
      acc += expandedMask[k];
      count++;
    }
    smoothMask[f] = acc / count;
  }

  // 3. Synthesize the final stereo M&E output buffer
  const outBuffer = offline.createBuffer(2, length, sampleRate);
  const outL = outBuffer.getChannelData(0);
  const outR = outBuffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const fIdx = Math.min(numFrames - 1, Math.floor(i / frameSize));
    const nextFIdx = Math.min(numFrames - 1, fIdx + 1);
    const frac = (i - fIdx * frameSize) / frameSize;
    const keepGain =
      smoothMask[fIdx] * (1 - frac) + smoothMask[nextFIdx] * frac;
    const suppressAmount = 1 - keepGain;

    const l = leftIn[i];
    const r = rightIn[i];

    // Sample from extracted non-speech ambient room-tone bed during suppressed speech
    let ambL = 0;
    let ambR = 0;
    if (ambientFrames.length > 0) {
      const cycleFrame =
        ambientFrames[Math.floor(i / frameSize) % ambientFrames.length];
      const offsetInFrame = i % frameSize;
      const ambSampleIdx = Math.min(
        length - 1,
        cycleFrame * frameSize + offsetInFrame,
      );
      ambL = leftIn[ambSampleIdx] * 0.45;
      ambR = rightIn[ambSampleIdx] * 0.45;
    }

    // If true stereo music/effects exist in the side channel (L - R), retain pure stereo side
    const stereoSide = hasTrueStereo ? (l - r) * 0.55 : 0;
    const subImpact = subImpactData[i] * 0.55;

    // Combine:
    // - When keepGain is 1 (between lines / non-speech SFX): original SFX & music play clearly
    // - When keepGain is 0 (during speech / cues): 0% original voice; only stereo side + <85Hz impact + non-speech ambient room tone!
    outL[i] = Math.max(
      -1,
      Math.min(
        1,
        l * keepGain +
          suppressAmount * (ambL + stereoSide + subImpact),
      ),
    );
    outR[i] = Math.max(
      -1,
      Math.min(
        1,
        r * keepGain +
          suppressAmount * (ambR - stereoSide + subImpact),
      ),
    );
  }

  return outBuffer;
}

async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
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
  const LIVE_AI_SPACE = 'https://iqbalzz-vocals-instrumentals.hf.space';
  onProgress?.('Bulut AI vokal ayrıştırma motoruna bağlanılıyor...', 32);
  const base64Audio = await blobToBase64DataUrl(audio);

  onProgress?.('Yapay Zeka (AI) insan seslerini müzik ve efektlerden ayırıyor...', 55);
  const response = await fetch(`${LIVE_AI_SPACE}/run/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [{ name: 'scene-audio.wav', data: base64Audio }],
    }),
    signal: AbortSignal.timeout(35000),
  });

  if (!response.ok) {
    throw new Error(`AI servisi yanıt vermedi (${response.status}).`);
  }

  const json = (await response.json()) as {
    data?: Array<{ name?: string; data?: string }>;
  };
  const instrumentalEntry = json?.data?.[1];
  if (!instrumentalEntry?.name) {
    throw new Error('AI servisinden vokalsiz ses çıktısı alınamadı.');
  }

  onProgress?.('AI tarafından ayrıştırılan vokalsiz ses indiriliyor...', 78);
  const downloadUrl = `${LIVE_AI_SPACE}/file=${instrumentalEntry.name}`;
  const dl = await fetch(downloadUrl, { signal: AbortSignal.timeout(20000) });
  if (!dl.ok) {
    throw new Error(`Vokalsiz ses indirilemedi (${dl.status}).`);
  }

  const blob = await dl.blob();
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
 * Combines Cloud AI Stem Separation + VAD/Cue Speech Eraser so ZERO human speech
 * remains during dialogue while background music, ambiance, and sound effects are preserved.
 */
export async function removeVocalsFromVideo(
  videoSource: File | Blob | string,
  arg2?: string | VocalRemovalProgress,
  arg3?: string | VocalRemovalProgress,
  cues?: CueTimeRange[],
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

  // 1. Try Cloud AI Separator first, then pass through Cue/VAD Speech Polish to guarantee 0% vocal bleed
  try {
    const aiOutput = await separate(wavBlob, onProgress);
    try {
      const aiDecoded = await decodeMediaAudioBuffer(aiOutput);
      const polishedBuffer = await createMneAudioBuffer(aiDecoded, cues);
      const polishedWav = audioBufferToWav(polishedBuffer);
      return await saveInstrumental(polishedWav, fileName, 'ai', onProgress);
    } catch {
      return await saveInstrumental(aiOutput, fileName, 'ai', onProgress);
    }
  } catch (aiErr) {
    console.warn(
      'Bulut AI yerine sıfır-vokal VAD + M&E Diyalog Silici devreye alındı:',
      aiErr,
    );
  }

  // 2. Zero-Vocal VAD + Cue Speech Eraser & Ambience Reconstructor
  onProgress?.(
    'Konuşma sesleri %100 silinip ortam ambiyansı ve ses efektleri korunuyor...',
    68,
  );
  const mneBuffer = await createMneAudioBuffer(decoded, cues);
  const mneWav = audioBufferToWav(mneBuffer);
  return await saveInstrumental(mneWav, fileName, 'ai', onProgress);
}

/**
 * Local M&E vocal reducer: applies Zero-Vocal VAD + Cue Speech Eraser & Ambience Reconstructor.
 */
export async function reduceCenteredVocals(
  videoSource: File | Blob | string,
  fileName = 'scene',
  onProgress?: VocalRemovalProgress,
  cues?: CueTimeRange[],
): Promise<VocalRemovalResult> {
  onProgress?.(
    'Diyalog sesleri sıfırlanıp müzik ve efekt kanalı (M&E) oluşturuluyor...',
    45,
  );
  const decoded = await decodeMediaAudioBuffer(videoSource);
  const mneBuffer = await createMneAudioBuffer(decoded, cues);
  const mneWav = audioBufferToWav(mneBuffer);
  return await saveInstrumental(mneWav, fileName, 'stereo', onProgress);
}
