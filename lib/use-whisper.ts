/**
 * useWhisper hook - Editör sayfasında otomatik altyazı oluşturmak için
 * Whisper AI modelini ve Voice Activity Detection (VAD) motorunu doğrudan tarayıcıda çalıştırır.
 * 
 * Özellikler:
 * - Whisper Base & Whisper Tiny model seçimi (Türkçe için Whisper Base yüksek doğruluk sağlar).
 * - Ses ön işleme (Speech Enhancement - Dip gürültü ve bas temizliği, konuşma normalizasyonu).
 * - Akıllı Cümle & Replik Birleştirme (Word/phrase parçalarını anlamsal cümlelere döker).
 * - VAD Akustik Hizalama (Her repliğin başlangıç ve bitişini milisaniyelik gerçek sese kenetler).
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import type { Cue, RoleInfo } from './scenes';
import { extractAudioFromVideo } from './audio-extractor';
import {
  enhanceSpeechAudio,
  detectSpeechIntervals,
  snapTimeToSpeech,
  alignAllCuesWithAudio,
  type SpeechInterval,
} from './audio-vad';

export type WhisperStatus =
  | 'idle'
  | 'loading_model'
  | 'extracting_audio'
  | 'transcribing'
  | 'aligning'
  | 'done'
  | 'error';

export type WordChunk = {
  text: string;
  timestamp: [number, number | null];
};

export type WhisperResult = {
  text: string;
  cues: Cue[];
  audioData?: Float32Array;
};

// Global model önbellek haritası (Model ID bazlı)
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const transcriberMap = new Map<string, any>();
let isModelLoading = false;

/**
 * Whisper modelini yükle ve önbelleğe al
 */
async function getTranscriber(
  modelId: string = 'onnx-community/whisper-base',
  onProgress?: (pct: number, file: string) => void,
) {
  if (transcriberMap.has(modelId)) {
    return transcriberMap.get(modelId);
  }

  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (transcriberMap.has(modelId)) {
      return transcriberMap.get(modelId);
    }
  }

  isModelLoading = true;
  try {
    const { pipeline, env } = await import('@huggingface/transformers');

    if (env) {
      env.allowLocalModels = false;
    }

    let hasWebGPU = false;
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        const adapter = await (
          navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }
        ).gpu.requestAdapter();
        if (adapter) hasWebGPU = true;
      }
    } catch {
      hasWebGPU = false;
    }

    const progressCallback = (progress: { status: string; progress?: number; file?: string }) => {
      if (progress.status === 'progress' && progress.progress !== undefined) {
        onProgress?.(Math.round(progress.progress), progress.file || '');
      }
    };

    type PipelineFn = (
      task: string,
      model: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    const runPipeline = pipeline as unknown as PipelineFn;

    let instance: unknown = null;

    // 1. WebGPU varsa fp32 / q4 ile dene
    if (hasWebGPU) {
      try {
        instance = await runPipeline('automatic-speech-recognition', modelId, {
          device: 'webgpu',
          dtype: 'fp32',
          progress_callback: progressCallback,
        });
      } catch (gpuErr) {
        console.warn('WebGPU Whisper yüklenemedi, WASM q4 fallback yapılıyor:', gpuErr);
        instance = null;
      }
    }

    // 2. WASM fallback (q4 boyutu küçüktür, hızlı iner ve CPU üzerinde hızlı çalışır)
    if (!instance) {
      instance = await runPipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: progressCallback,
      });
    }

    transcriberMap.set(modelId, instance);
    return instance;
  } finally {
    isModelLoading = false;
  }
}

/**
 * Cümle bitişi belirten işaretler veya soru ekleri
 */
const SENTENCE_END_REGEX = /[.!?…\n]+$/;

/**
 * Whisper parçalarını (chunks) anlamsal tam cümlelere ve repliklere birleştirir,
 * ardından VAD ile gerçek fiziksel konuşma sınırlarına kilitler.
 */
function smartGroupWhisperChunks(
  chunks: WordChunk[],
  roles: RoleInfo[],
  videoDuration: number,
  intervals: SpeechInterval[],
): Cue[] {
  if (!chunks || chunks.length === 0) return [];

  type PendingSentence = {
    words: string[];
    start: number;
    end: number;
  };

  const sentences: PendingSentence[] = [];
  let current: PendingSentence | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const text = (chunk.text || '').trim();
    if (!text) continue;

    const chunkStart = Math.max(0, Number((chunk.timestamp?.[0] ?? 0).toFixed(2)));
    const chunkEnd =
      chunk.timestamp?.[1] != null
        ? Number(chunk.timestamp[1].toFixed(2))
        : Number((chunkStart + 1.5).toFixed(2));

    if (!current) {
      current = {
        words: [text],
        start: chunkStart,
        end: chunkEnd,
      };
    } else {
      const gap = chunkStart - current.end;
      const currentText = current.words.join(' ');
      const isPunctuationEnd = SENTENCE_END_REGEX.test(current.words[current.words.length - 1]);
      const isLongEnough = current.words.length >= 10;
      const durationSoFar = chunkEnd - current.start;

      // Yeni bir replik başlatma şartları:
      // 1. İki kelime arasında belirgin duraksama / sessizlik varsa (0.60s üzeri)
      // 2. Önceki kelime nokta, soru işareti veya ünlemle bitmişse
      // 3. Replik süresi 6.0 saniyeyi aşmışsa veya kelime sayısı 12'ye ulaşmışsa
      if (gap > 0.60 || isPunctuationEnd || (isLongEnough && gap > 0.3) || durationSoFar > 6.0) {
        sentences.push(current);
        current = {
          words: [text],
          start: chunkStart,
          end: chunkEnd,
        };
      } else {
        current.words.push(text);
        current.end = Math.max(current.end, chunkEnd);
      }
    }
  }

  if (current && current.words.length > 0) {
    sentences.push(current);
  }

  // Cümleleri VAD konuşma aralıklarıyla hizalayarak Cue objelerine çevir
  let lastRoleIndex = 0;
  let lastEndTime = 0;

  const rawCues = sentences.map((sent, index) => {
    const rawText = sent.words.join(' ').replace(/\s+/g, ' ').trim();
    // VAD ile gerçek ses başlangıcına ve bitişine snap et
    const snapped = snapTimeToSpeech(sent.start, sent.end, intervals, videoDuration);

    // Rol atama: Eğer iki replik arasında 1.2 saniyeden uzun sessizlik varsa veya farklı bir soru-cevap akışı varsa rolü değiştir
    const pauseFromPrev = sent.start - lastEndTime;
    let roleIdx = lastRoleIndex;
    if (index > 0 && (pauseFromPrev > 1.2 || sent.words.length > 5)) {
      roleIdx = (lastRoleIndex + 1) % Math.max(1, roles.length);
    }
    lastRoleIndex = roleIdx;
    lastEndTime = snapped.end;

    const role = roles[roleIdx] || roles[0];

    return {
      id: Date.now() + index,
      roleIndex: roleIdx,
      roleName: role?.name || `Karakter ${roleIdx + 1}`,
      roleColor: role?.color || '#d8fb51',
      start: snapped.start,
      end: snapped.end,
      text: rawText,
    };
  });

  // Çakışma kontrolü ve sıralama
  rawCues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < rawCues.length; i++) {
    const cur = rawCues[i];
    const nxt = rawCues[i + 1];
    if (nxt && cur.end > nxt.start) {
      cur.end = Math.max(cur.start + 0.4, Number((nxt.start - 0.05).toFixed(2)));
    }
    if (videoDuration > 0 && cur.end > videoDuration) {
      cur.end = Number(videoDuration.toFixed(2));
    }
  }

  return rawCues;
}

export function useWhisper() {
  const [status, setStatus] = useState<WhisperStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isCancelledRef = useRef(false);
  const cachedAudioRef = useRef<Float32Array | null>(null);

  /**
   * Videodan otomatik altyazı oluşturur ve VAD ile milisaniyelik hizalar
   */
  const transcribe = useCallback(
    async (
      videoSource: string | Blob,
      roles: RoleInfo[],
      videoDuration: number,
      language: string = 'turkish',
      modelId: string = 'onnx-community/whisper-base',
    ): Promise<WhisperResult> => {
      isCancelledRef.current = false;
      setError(null);
      setProgress(0);

      try {
        // 1. Videodan ses çıkar (16kHz PCM mono Float32)
        setStatus('extracting_audio');
        setStatusMessage('Videodan ses çıkarılıyor (16kHz PCM)...');
        setProgress(12);

        const rawAudioData = await extractAudioFromVideo(videoSource, (stage, pct) => {
          if (isCancelledRef.current) return;
          setStatusMessage(stage);
          setProgress(Math.round(12 + pct * 0.18));
        });

        if (isCancelledRef.current) throw new Error('İptal edildi');

        // Sesi gürültü ve bas frekanslarından temizle, ses seviyesini normalize et
        const enhancedAudioData = enhanceSpeechAudio(rawAudioData);
        cachedAudioRef.current = rawAudioData;

        // 2. Modeli yükle / önbellekten al
        setStatus('loading_model');
        const shortModelName = modelId.includes('base') ? 'Whisper Base (Yüksek Doğruluk)' : 'Whisper Tiny (Hızlı)';
        setStatusMessage(`Yapay zeka modeli hazırlanıyor (${shortModelName})...`);
        setProgress(32);

        const transcriber = await getTranscriber(modelId, (pct, file) => {
          if (isCancelledRef.current) return;
          const fileName = file ? file.split('/').pop() || file : '';
          setStatusMessage(`AI modeli indiriliyor (${fileName.slice(0, 22)}): %${pct}`);
          setProgress(Math.round(32 + pct * 0.38));
        });

        if (isCancelledRef.current) throw new Error('İptal edildi');

        // 3. Konuşmaları tanı
        setStatus('transcribing');
        setStatusMessage('Türkçe konuşmalar ve zamanlama noktaları tanınıyor...');
        setProgress(72);

        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await transcriber(enhancedAudioData, {
          language,
          task: 'transcribe',
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
          condition_on_previous_text: false, // Halüsinasyon ve tekrarlama döngülerini engeller
        });

        if (isCancelledRef.current) throw new Error('İptal edildi');

        // 4. VAD Akustik Analizi ve Replik Zamanlaması
        setStatus('aligning');
        setStatusMessage('Repliklerin başlangıç ve bitişleri ses dalgasına göre hizalanıyor...');
        setProgress(90);

        const speechIntervals = detectSpeechIntervals(rawAudioData);

        let cues = smartGroupWhisperChunks(
          (result.chunks || []) as WordChunk[],
          roles,
          videoDuration,
          speechIntervals,
        );

        // Eğer zamanlı chunk dönmediyse ama genel metin varsa VAD konuşma aralıklarına oturt
        const fullText = (result.text || '').trim();
        if (cues.length === 0 && fullText) {
          const rawSentences = fullText
            .split(/([.!?…\n]+)/)
            .filter(Boolean)
            .reduce((acc: string[], curr: string, i: number, arr: string[]) => {
              if (i % 2 === 0) {
                const punct = arr[i + 1] || '';
                const combined = (curr + punct).trim();
                if (combined) acc.push(combined);
              }
              return acc;
            }, []);

          const sentences = rawSentences.length > 0 ? rawSentences : [fullText];

          cues = sentences.map((text: string, idx: number) => {
            const roleIdx = idx % Math.max(1, roles.length);
            const role = roles[roleIdx];
            
            // Eğer VAD konuşma aralığı varsa oraya yerleştir, yoksa tahmini yay
            let start = 0;
            let end = 2.5;
            if (speechIntervals[idx]) {
              start = speechIntervals[idx].start;
              end = speechIntervals[idx].end;
            } else if (speechIntervals.length > 0) {
              const inv = speechIntervals[Math.min(idx, speechIntervals.length - 1)];
              start = inv.start;
              end = inv.end;
            } else {
              const step = videoDuration / Math.max(1, sentences.length);
              start = Number((idx * step).toFixed(2));
              end = Number(Math.min(videoDuration, (idx + 1) * step - 0.1).toFixed(2));
            }

            return {
              id: Date.now() + idx,
              roleIndex: roleIdx,
              roleName: role?.name || `Karakter ${roleIdx + 1}`,
              roleColor: role?.color || '#d8fb51',
              start,
              end,
              text,
            };
          });
        }

        setStatus('done');
        setProgress(100);
        setStatusMessage(
          cues.length > 0
            ? `✅ ${cues.length} replik zamanlamalarıyla kusursuz oluşturuldu!`
            : 'ℹ️ Videoda belirgin konuşma sesi tespit edilemedi.',
        );

        return {
          text: fullText,
          cues,
          audioData: rawAudioData,
        };
      } catch (err) {
        setStatus('error');
        const rawMsg = (err as Error).message || 'Bilinmeyen hata';
        let friendlyMsg = rawMsg;
        if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')) {
          friendlyMsg =
            'Yapay zeka modeli indirilirken ağ bağlantısı hatası oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.';
        } else if (rawMsg.includes('out of memory') || rawMsg.includes('OOM')) {
          friendlyMsg =
            'Tarayıcı bellek yetersizliği oluştu. Lütfen diğer sekmeleri kapatıp tekrar deneyin.';
        }
        setError(friendlyMsg);
        setStatusMessage(`Hata: ${friendlyMsg}`);
        throw new Error(friendlyMsg);
      }
    },
    [],
  );

  /**
   * Mevcut replikleri ses dalgasına göre baştan sona otomatik düzeltir
   */
  const alignExistingCues = useCallback(
    async (
      cues: Cue[],
      videoSource: string | Blob,
      videoDuration: number,
    ): Promise<Cue[]> => {
      let audio = cachedAudioRef.current;
      if (!audio) {
        setStatusMessage('Ses verisi okunuyor...');
        audio = await extractAudioFromVideo(videoSource);
        cachedAudioRef.current = audio;
      }
      return alignAllCuesWithAudio(cues, audio, videoDuration);
    },
    [],
  );

  const reset = useCallback(() => {
    isCancelledRef.current = true;
    setStatus('idle');
    setProgress(0);
    setStatusMessage('');
    setError(null);
  }, []);

  return {
    transcribe,
    alignExistingCues,
    reset,
    status,
    progress,
    statusMessage,
    error,
    isProcessing: status !== 'idle' && status !== 'done' && status !== 'error',
    cachedAudio: cachedAudioRef.current,
  };
}
