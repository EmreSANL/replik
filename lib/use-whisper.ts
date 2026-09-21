/**
 * useWhisper hook - Editör sayfasında otomatik altyazı oluşturmak için
 * Whisper AI modelini doğrudan tarayıcıda (WebGPU / WASM) çalıştırır.
 * Web Worker URL/CORS kısıtlamalarına takılmadan doğrudan çalışır.
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import type { Cue, RoleInfo } from './scenes';
import { extractAudioFromVideo } from './audio-extractor';

export type WhisperStatus =
  | 'idle'
  | 'loading_model'
  | 'extracting_audio'
  | 'transcribing'
  | 'done'
  | 'error';

type WordChunk = {
  text: string;
  timestamp: [number, number | null];
};

export type WhisperResult = {
  text: string;
  cues: Cue[];
};

// Global model önbelleği - her seferinde yeniden indirmeyi engeller
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
let transcriberCache: any = null;
let isModelLoading = false;

/**
 * Whisper modelini yükle ve önbelleğe al
 */
async function getTranscriber(
  modelId: string = 'onnx-community/whisper-tiny',
  onProgress?: (pct: number, file: string) => void,
) {
  if (transcriberCache) return transcriberCache;
  if (isModelLoading) {
    // Model yüklenirken bekle
    while (isModelLoading) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (transcriberCache) return transcriberCache;
  }

  isModelLoading = true;
  try {
    const { pipeline, env } = await import('@huggingface/transformers');

    // Tarayıcı ortamında lokal model arama hatasını önle
    if (env) {
      env.allowLocalModels = false;
    }

    // WebGPU desteğini kontrol et
    let hasWebGPU = false;
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
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

    // 1. WebGPU varsa fp32 veya q4 ile dene
    if (hasWebGPU) {
      try {
        instance = await runPipeline(
          'automatic-speech-recognition',
          modelId,
          {
            device: 'webgpu',
            dtype: 'fp32',
            progress_callback: progressCallback,
          },
        );
      } catch (gpuErr) {
        console.warn('WebGPU Whisper yüklenemedi, WASM q4 fallback yapılıyor:', gpuErr);
        instance = null;
      }
    }

    // 2. WASM fallback (q4 boyutu küçüktür, hızlı iner ve CPU üzerinde hızlı çalışır)
    if (!instance) {
      instance = await runPipeline(
        'automatic-speech-recognition',
        modelId,
        {
          device: 'wasm',
          dtype: 'q4',
          progress_callback: progressCallback,
        },
      );
    }

    transcriberCache = instance;
    return instance;
  } finally {
    isModelLoading = false;
  }
}

/**
 * Whisper'dan dönen konuşma parçalarını Cue repliklerine dönüştürür.
 */
function chunksToSentenceCues(
  chunks: WordChunk[],
  roles: RoleInfo[],
  videoDuration: number,
): Cue[] {
  if (!chunks || chunks.length === 0) return [];

  const rawCues: { text: string; start: number; end: number }[] = [];
  let prevText = '';

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const text = (chunk.text || '').trim();
    if (!text) continue;

    // Sessizlik veya tekrarlı Whisper halüsinasyonlarını filtrele
    if (text === prevText && text.length < 15) continue;
    prevText = text;

    const start = Math.max(0, Number((chunk.timestamp?.[0] ?? 0).toFixed(2)));
    let end =
      chunk.timestamp?.[1] != null
        ? Number(chunk.timestamp[1].toFixed(2))
        : Number((start + 2.5).toFixed(2));

    if (end <= start) end = Number((start + 1.5).toFixed(2));
    if (videoDuration > 0 && end > videoDuration) {
      end = Number(videoDuration.toFixed(2));
    }

    rawCues.push({ text, start, end });
  }

  return rawCues.map((item, index) => {
    const roleIdx = index % Math.max(1, roles.length);
    const role = roles[roleIdx];
    return {
      id: Date.now() + index,
      roleIndex: roleIdx,
      roleName: role?.name || `Karakter ${roleIdx + 1}`,
      roleColor: role?.color || '#d8fb51',
      start: item.start,
      end: item.end,
      text: item.text,
    };
  });
}

export function useWhisper() {
  const [status, setStatus] = useState<WhisperStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isCancelledRef = useRef(false);

  /**
   * Videodan otomatik altyazı oluştur
   */
  const transcribe = useCallback(
    async (
      videoSource: string | Blob,
      roles: RoleInfo[],
      videoDuration: number,
      language: string = 'turkish',
      modelId: string = 'onnx-community/whisper-tiny',
    ): Promise<WhisperResult> => {
      isCancelledRef.current = false;
      setError(null);
      setProgress(0);

      try {
        // 1. Videodan ses çıkar
        setStatus('extracting_audio');
        setStatusMessage('Videodan ses çıkarılıyor (16kHz PCM)...');
        setProgress(15);

        const audioData = await extractAudioFromVideo(
          videoSource,
          (stage, pct) => {
            if (isCancelledRef.current) return;
            setStatusMessage(stage);
            setProgress(Math.round(15 + (pct * 0.2)));
          },
        );

        if (isCancelledRef.current) throw new Error('İptal edildi');

        // 2. Modeli yükle / önbellekten al
        setStatus('loading_model');
        setStatusMessage('AI modeli hazırlanıyor (ilk kullanımda indirilir)...');
        setProgress(35);

        const transcriber = await getTranscriber(modelId, (pct, file) => {
          if (isCancelledRef.current) return;
          const fileName = file ? file.split('/').pop() || file : '';
          setStatusMessage(`AI modeli indiriliyor (${fileName.slice(0, 24)}): %${pct}`);
          setProgress(Math.round(35 + (pct * 0.35)));
        });

        if (isCancelledRef.current) throw new Error('İptal edildi');

        // 3. Konuşmaları tanı
        setStatus('transcribing');
        setStatusMessage('Türkçe konuşmalar ve zamanlama noktaları tanınıyor...');
        setProgress(75);

        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await transcriber(audioData, {
          language,
          task: 'transcribe',
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
        });

        if (isCancelledRef.current) throw new Error('İptal edildi');

        // 4. Zamanlı repliklere (Cue) dönüştür
        let cues = chunksToSentenceCues(
          (result.chunks || []) as WordChunk[],
          roles,
          videoDuration,
        );

        // Eğer zamanlı chunk bulunamadıysa ama genel metin varsa metni cümlelere böl
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
          const step = videoDuration / Math.max(1, sentences.length);

          cues = sentences.map((text: string, idx: number) => {
            const roleIdx = idx % Math.max(1, roles.length);
            const role = roles[roleIdx];
            const start = Number((idx * step).toFixed(2));
            const end = Number((Math.min(videoDuration, (idx + 1) * step - 0.1)).toFixed(2));
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
            ? `✅ ${cues.length} replik otomatik oluşturuldu!`
            : 'ℹ️ Videoda belirgin konuşma sesi tespit edilemedi.',
        );

        return { text: fullText, cues };
      } catch (err) {
        setStatus('error');
        const rawMsg = (err as Error).message || 'Bilinmeyen hata';
        let friendlyMsg = rawMsg;
        if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')) {
          friendlyMsg = 'Yapay zeka modeli indirilirken ağ bağlantısı hatası oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.';
        } else if (rawMsg.includes('out of memory') || rawMsg.includes('OOM')) {
          friendlyMsg = 'Tarayıcı bellek yetersizliği oluştu. Lütfen diğer sekmeleri kapatıp tekrar deneyin.';
        }
        setError(friendlyMsg);
        setStatusMessage(`Hata: ${friendlyMsg}`);
        throw new Error(friendlyMsg);
      }
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
    reset,
    status,
    progress,
    statusMessage,
    error,
    isProcessing: status !== 'idle' && status !== 'done' && status !== 'error',
  };
}
