/**
 * Replik Saf AI Vokal Ayırıcı Motor (Meta Hybrid Transformer Demucs - htdemucs)
 *
 * Hiçbir hibrit ses kısma (ducking / gate / filtre) olmadan,
 * doğrudan yapay zeka (htdemucs --two-stems=vocals) ile videodaki vokalleri ayırır
 * ve saf 'no_vocals.wav' (arka plan ses efektleri, müzik, ortam sesleri) çıktısını döndürür.
 */

import { supabase } from './supabase';

export type VocalRemovalProgress = (stage: string, percent: number) => void;

export type VocalRemovalResult = {
  blob: Blob;
  url: string;
  vocalsBlob?: Blob;
  duration: number;
};

const HF_DEMUCS_BASE = 'https://abidlabs-music-separation.hf.space';

export function audioBufferToWav(buffer: AudioBuffer, targetSampleRate = 24000): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const srcRate = buffer.sampleRate;
  const ratio = srcRate / targetSampleRate;
  const outLength = Math.floor(buffer.length / ratio);
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = outLength * blockAlign;
  const bufferArray = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bufferArray);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < outLength; i++) {
    const srcIdx = Math.min(buffer.length - 1, Math.floor(i * ratio));
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][srcIdx]));
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
 * Doğrudan saf Demucs AI çıktısını (no_vocals.wav) döndürür — hiçbir hibrit filtre veya ses kısma uygulanmaz.
 */
async function separateWithPureDemucsCloudAI(
  videoSource: File | Blob | string,
  onProgress?: VocalRemovalProgress,
): Promise<{ noVocalsBlob: Blob; vocalsBlob?: Blob }> {
  onProgress?.('🤖 Yapay Zeka (Demucs AI) vokal ve ses efektlerini ayrıştırıyor...', 30);

  let remoteFilePath = '';
  if (typeof videoSource === 'string' && videoSource.startsWith('http')) {
    remoteFilePath = videoSource;
  } else if (typeof videoSource !== 'string') {
    const fd = new FormData();
    fd.append('files', videoSource, 'input_media');
    const uploadRes = await fetch(`${HF_DEMUCS_BASE}/gradio_api/upload`, {
      method: 'POST',
      body: fd,
    });
    if (!uploadRes.ok) {
      throw new Error(`Demucs AI dosya yükleme hatası: ${uploadRes.status}`);
    }
    const uploadedPaths = (await uploadRes.json()) as string[];
    if (!uploadedPaths?.[0]) {
      throw new Error('Demucs AI dosya yolu alınamadı.');
    }
    remoteFilePath = uploadedPaths[0];
  }

  const fileUrl = remoteFilePath.startsWith('http')
    ? remoteFilePath
    : `${HF_DEMUCS_BASE}/gradio_api/file=${remoteFilePath}`;

  const callRes = await fetch(`${HF_DEMUCS_BASE}/gradio_api/call/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [
        {
          path: remoteFilePath,
          url: fileUrl,
          orig_name: 'input_media',
          meta: { _type: 'gradio.FileData' },
        },
      ],
    }),
  });

  if (!callRes.ok) {
    throw new Error(`Demucs AI çağrısı başarısız: ${callRes.status}`);
  }

  const { event_id } = (await callRes.json()) as { event_id: string };
  const streamRes = await fetch(`${HF_DEMUCS_BASE}/gradio_api/call/inference/${event_id}`);
  const streamText = await streamRes.text();

  let parsedData: Array<{ path?: string; url?: string }> | null = null;
  const lines = streamText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('event: complete') && lines[i + 1]?.startsWith('data: ')) {
      parsedData = JSON.parse(lines[i + 1].slice(6));
      break;
    }
  }

  if (!parsedData || parsedData.length < 2) {
    throw new Error('Demucs AI çıktısı çözümlenemedi.');
  }

  const vocalsUrl = parsedData[0].url || `${HF_DEMUCS_BASE}/gradio_api/file=${parsedData[0].path}`;
  const noVocalsUrl = parsedData[1].url || `${HF_DEMUCS_BASE}/gradio_api/file=${parsedData[1].path}`;

  const [vocRes, noVocRes] = await Promise.all([fetch(vocalsUrl), fetch(noVocalsUrl)]);
  const [vocalsBlob, noVocalsBlob] = await Promise.all([vocRes.blob(), noVocRes.blob()]);

  return { noVocalsBlob, vocalsBlob };
}

/**
 * Bir video dosyasından konuşma seslerini (vokalleri)
 * SADECE saf yapay zeka (htdemucs --two-stems=vocals) ile ayırır.
 * Hiçbir hibrit ses kısma (ducking) veya filtre uygulanmaz.
 */
export async function removeVocalsFromVideo(
  videoSource: File | Blob | string,
  arg2?: string | VocalRemovalProgress,
  arg3?: string | VocalRemovalProgress,
): Promise<VocalRemovalResult> {
  const onProgress: VocalRemovalProgress | undefined =
    typeof arg2 === 'function' ? arg2 : typeof arg3 === 'function' ? arg3 : undefined;
  const fileName: string | undefined =
    typeof arg2 === 'string' ? arg2 : typeof arg3 === 'string' ? arg3 : undefined;

  onProgress?.('Saf AI Vokal Ayırıcı (htdemucs) başlatılıyor...', 10);

  // 1. Kendi yerel/sunucu Saf AI Backend API'mizi (/api/splitter-ai) çağır
  try {
    onProgress?.('AI (htdemucs): Videodaki vokaller ayrıştırılıyor...', 25);
    let apiRes: Response;
    if (typeof videoSource === 'string') {
      apiRes = await fetch('/api/splitter-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: videoSource }),
      });
    } else {
      apiRes = await fetch('/api/splitter-ai', {
        method: 'POST',
        headers: { 'Content-Type': videoSource.type || 'application/octet-stream' },
        body: videoSource,
      });
    }

    if (apiRes.ok) {
      const data = (await apiRes.json()) as { ok?: boolean; instrumentalUrl?: string };
      if (data.ok && data.instrumentalUrl) {
        onProgress?.('Saf AI arka plan sesi doğrulanıyor...', 88);
        const wavResp = await fetch(data.instrumentalUrl);
        if (wavResp.ok) {
          const wavBlob = await wavResp.blob();
          onProgress?.('Tamamlandı! Saf AI ile vokaller ayrıldı.', 100);
          return {
            blob: wavBlob,
            url: data.instrumentalUrl,
            duration: 0,
          };
        }
      }
    }
  } catch (splitterErr) {
    console.warn('Yerel Splitter-AI API uyarısı, Bulut Demucs AI motoruna geçiliyor:', splitterErr);
  }

  // 2. Bulut Saf Demucs AI (hiçbir hibrit filtre olmadan doğrudan no_vocals.wav)
  const { noVocalsBlob, vocalsBlob } = await separateWithPureDemucsCloudAI(videoSource, onProgress);
  let publicUrl = URL.createObjectURL(noVocalsBlob);

  try {
    const cleanBase = fileName
      ? fileName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'scene'
      : 'scene';
    const remotePath = `instrumentals/demucs_pure_${Date.now()}_${cleanBase}.wav`;

    onProgress?.('Saf AI arka plan sesi Supabase bulutuna kaydediliyor...', 95);
    const { data, error } = await supabase.storage
      .from('videos')
      .upload(remotePath, noVocalsBlob, {
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
    console.warn('Instrumental Supabase yükleme uyarısı:', uploadErr);
  }

  onProgress?.('Tamamlandı! Saf AI ile vokaller ayrıldı.', 100);

  return {
    blob: noVocalsBlob,
    url: publicUrl,
    vocalsBlob,
    duration: 0,
  };
}

export async function processVocalRemoval(sourceBuffer: AudioBuffer): Promise<AudioBuffer> {
  return sourceBuffer;
}

