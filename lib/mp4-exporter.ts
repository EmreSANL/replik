import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Cue, Room, Scene } from './scenes';

export interface ExportMp4Options {
  room: Room;
  scene: Scene;
  cues: Cue[];
  buffers: Map<string, AudioBuffer>;
  onProgress?: (percent: number, stage: string) => void;
}

/**
 * Sahnenin arka plan sesi (AI M&E) ve tüm oyuncuların replik kayıtlarını
 * OfflineAudioContext kullanarak tek bir stereo AudioBuffer olarak birleştirir.
 */
async function renderMixedDubbingAudio(
  scene: Scene,
  room: Room,
  cues: Cue[],
  buffers: Map<string, AudioBuffer>,
): Promise<AudioBuffer> {
  const sampleRate = 48000;
  const durationSec = Math.max(1, scene.duration || 10);
  const totalSamples = Math.ceil(durationSec * sampleRate);

  const offline = new OfflineAudioContext(2, totalSamples, sampleRate);

  // 1. Arka plan (M&E / Instrumental) sesini ekle
  const instKey = `__scene_instrumental__:${scene.id}`;
  const instBuffer = buffers.get(instKey);
  if (instBuffer) {
    const instSource = offline.createBufferSource();
    instSource.buffer = instBuffer;
    const instGain = offline.createGain();
    instGain.gain.setValueAtTime(1.0, 0);
    instSource.connect(instGain);
    instGain.connect(offline.destination);
    const playLen = Math.min(instBuffer.duration, durationSec);
    if (playLen > 0) {
      instSource.start(0, 0, playLen);
    }
  }

  // 2. Odadaki tüm oyuncuların kaydettiği replikleri tam saniyesinde ekle
  const slotDuration = durationSec / Math.max(1, room.players.length);
  let scheduledCount = 0;

  cues.forEach((c) => {
    let buf = buffers.get(`cue:${c.id}`);
    if (!buf) {
      for (const p of room.players) {
        const candidate = buffers.get(`${p.id}:${c.id}`);
        if (candidate) {
          buf = candidate;
          break;
        }
      }
    }
    if (!buf) return;

    const cueDur = Math.min(buf.duration, Math.max(0.2, c.end - c.start));
    if (cueDur <= 0 || c.start >= durationSec) return;

    const src = offline.createBufferSource();
    src.buffer = buf;
    const gain = offline.createGain();
    gain.gain.setValueAtTime(1.2, 0);
    src.connect(gain);
    gain.connect(offline.destination);
    src.start(Math.max(0, c.start), 0, cueDur);
    scheduledCount++;
  });

  if (scheduledCount === 0) {
    room.players.forEach((p, idx) => {
      const buf = buffers.get(p.id);
      if (!buf) return;
      const at = idx * slotDuration;
      const dur = Math.min(buf.duration, slotDuration);
      if (dur <= 0 || at >= durationSec) return;
      const src = offline.createBufferSource();
      src.buffer = buf;
      const gain = offline.createGain();
      gain.gain.setValueAtTime(1.2, 0);
      src.connect(gain);
      gain.connect(offline.destination);
      src.start(at, 0, dur);
    });
  }

  return await offline.startRendering();
}

/**
 * CORS / Tainted Canvas hatasını %100 önlemek için videoyu yerel Blob URL'e çevirir.
 */
async function fetchCleanVideoBlobUrl(videoUrl: string): Promise<string> {
  if (videoUrl.startsWith('blob:') || videoUrl.startsWith('data:')) {
    return videoUrl;
  }

  try {
    const res = await fetch(videoUrl, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        return URL.createObjectURL(blob);
      }
    }
  } catch {
    // Doğrudan fetch CORS'a takılırsa proxy üzerinden çek
  }

  const proxyUrl = `/api/video-proxy?url=${encodeURIComponent(videoUrl)}`;
  const proxyRes = await fetch(proxyUrl);
  if (!proxyRes.ok) {
    throw new Error('Sahne videosu indirilemedi. Bağlantınızı kontrol edin.');
  }
  const blob = await proxyRes.blob();
  return URL.createObjectURL(blob);
}

/**
 * Tarayıcının desteklediği en iyi MP4 MIME tipini bulur.
 */
function getSupportedMp4MimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const mp4Types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4;codecs=avc1,opus',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  return mp4Types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

/**
 * Dublajlı sahneyi .mp4 (video/mp4) Blob olarak üretir.
 * Hem doğrudan indirme hem de "Yayınla" (Supabase'e MP4 yükleme) için kullanılır.
 */
export async function generateDubbedMp4Blob({
  room,
  scene,
  cues,
  buffers,
  onProgress,
}: ExportMp4Options): Promise<Blob> {
  onProgress?.(5, 'Dublaj sesleri birleştiriliyor...');
  const mixedAudioBuffer = await renderMixedDubbingAudio(scene, room, cues, buffers);

  onProgress?.(15, 'Video kaynağı hazırlanıyor...');
  const cleanBlobUrl = await fetchCleanVideoBlobUrl(scene.video);
  const shouldRevokeVideoBlob = cleanBlobUrl !== scene.video && cleanBlobUrl.startsWith('blob:');

  // Offscreen temiz video elementi oluştur
  const exportVid = document.createElement('video');
  exportVid.crossOrigin = 'anonymous';
  exportVid.muted = true;
  exportVid.playsInline = true;
  exportVid.preload = 'auto';
  exportVid.src = cleanBlobUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video yükleme zaman aşımına uğradı.')), 15000);
      exportVid.onloadeddata = () => {
        clearTimeout(timeout);
        resolve();
      };
      exportVid.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Video kaynağı okunamadı.'));
      };
      exportVid.load();
    });

    // Çözünürlük (çift sayı zorunluluğu H.264 uyumu için)
    const rawW = exportVid.videoWidth || 854;
    const rawH = exportVid.videoHeight || 480;
    const scale = Math.min(1, 1280 / Math.max(rawW, 1));
    const width = Math.max(320, Math.floor((rawW * scale) / 2) * 2);
    const height = Math.max(240, Math.floor((rawH * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const paint = canvas.getContext('2d', { alpha: false })!;

    const drawCurrentFrame = () => {
      paint.fillStyle = '#000000';
      paint.fillRect(0, 0, width, height);
      paint.drawImage(exportVid, 0, 0, width, height);

      // Alt bilgi bandı ve aktif replik altyazısı
      const relTime = Math.max(0, exportVid.currentTime - scene.start);
      const activeCue = cues.find((c) => relTime >= c.start && relTime < c.end);

      if (activeCue) {
        const barH = Math.max(40, Math.round(height * 0.11));
        paint.fillStyle = 'rgba(9, 9, 9, 0.9)';
        paint.fillRect(0, height - barH - 12, width, barH);
        paint.fillStyle = '#F5E636';
        paint.font = `bold ${Math.max(13, Math.round(height * 0.032))}px system-ui, -apple-system, sans-serif`;
        paint.textAlign = 'center';
        paint.fillText(
          `${activeCue.roleName}: "${activeCue.text}"`,
          width / 2,
          height - barH / 2 - 6,
          width - 32,
        );
      }

      // Sağ üst küçük filigran
      paint.fillStyle = '#F5E636';
      paint.font = `bold ${Math.max(11, Math.round(height * 0.024))}px system-ui, sans-serif`;
      paint.textAlign = 'right';
      paint.fillText('Replik Dublaj', width - 14, 24);
    };

    const mp4Mime = getSupportedMp4MimeType();

    // 1. YÖNTEM: Tarayıcı donanımsal MP4 MediaRecorder destekliyorsa veya WebCodecs ile MP4 Muxer
    if (!mp4Mime && typeof window !== 'undefined' && 'VideoEncoder' in window) {
      // WebCodecs + mp4-muxer ile saf .mp4 üretimi (MediaRecorder video/mp4 desteklemeyen tarayıcılar için)
      const target = new ArrayBufferTarget();
      const hasAudioEncoder = 'AudioEncoder' in window;
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width,
          height,
        },
        ...(hasAudioEncoder
          ? {
              audio: {
                codec: 'aac',
                numberOfChannels: 2,
                sampleRate: mixedAudioBuffer.sampleRate,
              },
            }
          : {}),
        fastStart: 'in-memory',
      });

      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.warn('VideoEncoder warning:', e),
      });
      videoEncoder.configure({
        codec: 'avc1.42001f',
        width,
        height,
        bitrate: 3_500_000,
        framerate: 25,
      });

      if (hasAudioEncoder) {
        try {
          const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => console.warn('AudioEncoder warning:', e),
          });
          audioEncoder.configure({
            codec: 'mp4a.40.2',
            numberOfChannels: 2,
            sampleRate: mixedAudioBuffer.sampleRate,
            bitrate: 160_000,
          });

          const left = mixedAudioBuffer.getChannelData(0);
          const right =
            mixedAudioBuffer.numberOfChannels > 1 ? mixedAudioBuffer.getChannelData(1) : left;
          const interleaved = new Float32Array(left.length * 2);
          for (let i = 0; i < left.length; i++) {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
          }
          const audioData = new AudioData({
            format: 'f32',
            sampleRate: mixedAudioBuffer.sampleRate,
            numberOfFrames: left.length,
            numberOfChannels: 2,
            timestamp: 0,
            data: interleaved,
          });
          audioEncoder.encode(audioData);
          audioData.close();
          await audioEncoder.flush();
        } catch (audioEncErr) {
          console.warn('WebCodecs AAC fallback:', audioEncErr);
        }
      }

      const fps = 25;
      const totalFrames = Math.max(1, Math.floor(scene.duration * fps));
      for (let f = 0; f < totalFrames; f++) {
        const t = scene.start + f / fps;
        exportVid.currentTime = t;
        await new Promise<void>((res) => {
          const onSeek = () => {
            exportVid.removeEventListener('seeked', onSeek);
            res();
          };
          exportVid.addEventListener('seeked', onSeek);
          setTimeout(onSeek, 80);
        });
        drawCurrentFrame();
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((f / fps) * 1_000_000),
          duration: Math.round((1 / fps) * 1_000_000),
        });
        videoEncoder.encode(frame, { keyFrame: f % 25 === 0 });
        frame.close();
        onProgress?.(
          Math.min(98, 20 + Math.round(((f + 1) / totalFrames) * 78)),
          `MP4 kareleri işleniyor (%${Math.round(((f + 1) / totalFrames) * 100)})...`,
        );
      }

      await videoEncoder.flush();
      muxer.finalize();
      const mp4Blob = new Blob([target.buffer], { type: 'video/mp4' });
      onProgress?.(100, 'MP4 Hazır!');
      return mp4Blob;
    }

    // 2. YÖNTEM: Gerçek zamanlı yüksek kaliteli MP4 MediaRecorder + Birleştirilmiş Ses Kanalı
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const exportAudioCtx = new AudioCtx();
    if (exportAudioCtx.state === 'suspended') {
      await exportAudioCtx.resume();
    }

    const dest = exportAudioCtx.createMediaStreamDestination();
    const audioSource = exportAudioCtx.createBufferSource();
    audioSource.buffer = mixedAudioBuffer;
    audioSource.connect(dest);

    const stream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

    const chosenMime =
      mp4Mime ||
      ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      ) ||
      '';

    const recorder = new MediaRecorder(stream, {
      ...(chosenMime ? { mimeType: chosenMime } : {}),
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 192_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    exportVid.currentTime = scene.start;
    await new Promise<void>((res) => {
      const onSeek = () => {
        exportVid.removeEventListener('seeked', onSeek);
        res();
      };
      exportVid.addEventListener('seeked', onSeek);
      setTimeout(onSeek, 150);
    });

    let rafId = 0;
    const renderLoop = () => {
      drawCurrentFrame();
      rafId = requestAnimationFrame(renderLoop);
    };

    const durationMs = Math.max(1500, scene.duration * 1000);
    const startWall = Date.now();
    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - startWall;
      const pct = Math.min(98, 20 + Math.round((elapsed / durationMs) * 78));
      onProgress?.(pct, `MP4 Kaydediliyor (%${Math.min(99, Math.round((elapsed / durationMs) * 100))})...`);
    }, 200);

    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => {
        clearInterval(progressTimer);
        cancelAnimationFrame(rafId);
        stream.getTracks().forEach((t) => t.stop());
        void exportAudioCtx.close().catch(() => {});
        resolve();
      };
      recorder.onerror = (err) => {
        clearInterval(progressTimer);
        cancelAnimationFrame(rafId);
        stream.getTracks().forEach((t) => t.stop());
        void exportAudioCtx.close().catch(() => {});
        reject(new Error(`Kayıt hatası: ${(err as unknown as Error)?.message || 'Bilinmeyen hata'}`));
      };

      renderLoop();
      recorder.start(250);
      audioSource.start(0);
      void exportVid.play().catch(() => {});

      setTimeout(() => {
        if (recorder.state === 'recording') {
          exportVid.pause();
          try {
            audioSource.stop();
          } catch {}
          recorder.stop();
        }
      }, durationMs);
    });

    const finalBlob = new Blob(chunks, { type: 'video/mp4' });
    onProgress?.(100, 'MP4 Hazır!');
    return finalBlob;
  } finally {
    exportVid.pause();
    exportVid.removeAttribute('src');
    exportVid.load();
    if (shouldRevokeVideoBlob) {
      setTimeout(() => URL.revokeObjectURL(cleanBlobUrl), 10000);
    }
  }
}

export async function exportDubbedMp4(options: ExportMp4Options): Promise<void> {
  const blob = await generateDubbedMp4Blob(options);
  triggerMp4Download(blob, `replik-${options.room.code}.mp4`);
}

function triggerMp4Download(blob: Blob, filename: string) {
  const safeName = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 30000);
}
