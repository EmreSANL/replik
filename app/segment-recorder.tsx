'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Check, Mic, Square, RotateCcw, Play } from 'lucide-react';
import { formatTimecode } from '@/lib/timecode';
import {
  playerCues,
  sceneCues,
  getSceneById,
  type Room,
  type Cue,
  type Scene,
} from '@/lib/scenes';
import type { Session } from './studio';
import { saveAudioRecording, getAudioRecordingUrl, executeGameRoomAction } from '@/lib/game-service';
import {
  createMneAudioBuffer,
  decodeMediaAudioBuffer,
  audioBufferToWav,
  removeVocalsFromVideo,
} from '@/lib/vocal-remover';
import { supabase } from '@/lib/supabase';

type Take = { blob: Blob; url: string; peaks: number[] };

async function seekBackingAudio(audio: HTMLAudioElement, time: number, end: number) {
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Vokalsiz ses yüklenemedi. Sahneyi düzenleyicide yeniden hazırlayın.')), 10000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        audio.removeEventListener('loadedmetadata', loaded);
        audio.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      };
      const loaded = () => finish();
      const failed = () => finish(new Error('Vokalsiz ses dosyası okunamadı. Sahneyi düzenleyicide yeniden hazırlayın.'));
      audio.addEventListener('loadedmetadata', loaded, { once: true });
      audio.addEventListener('error', failed, { once: true });
      audio.load();
    });
  }
  if (Number.isFinite(audio.duration) && audio.duration + 0.1 < end) {
    throw new Error('Vokalsiz ses bu repliğin süresini kapsamıyor. Sahneyi yeniden ayırın.');
  }
  audio.pause();
  if (Math.abs(audio.currentTime - time) < 0.02) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Vokalsiz ses doğru zamana alınamadı. Tekrar deneyin.')), 5000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      audio.removeEventListener('seeked', seeked);
      audio.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const seeked = () => finish();
    const failed = () => finish(new Error('Vokalsiz ses oynatılamadı.'));
    audio.addEventListener('seeked', seeked, { once: true });
    audio.addEventListener('error', failed, { once: true });
    audio.currentTime = time;
  });
}

function peaksOf(buffer: AudioBuffer, bars = 80) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / bars));
  const raw = Array.from({ length: bars }, (_, i) => {
    let max = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    return max;
  });
  const peak = Math.max(0.02, ...raw);
  return raw.map((n) => Math.max(0.08, Math.min(1, n / peak)));
}
export default function SegmentRecorder({
  room,
  session,
  onRoom,
  customScenes,
}: {
  room: Room;
  session: Session;
  onRoom: (room: Room) => void;
  customScenes?: Scene[];
}) {
  const scene = getSceneById(room.scene, customScenes);
  const me = room.players.find((p) => p.id === session.id) ?? room.players[0];
  const index = Math.max(
    0,
    room.players.findIndex((p) => p.id === me.id),
  );
  const preferredRoles = room.players.map((p) => p.role);
  const cues = sceneCues(room.scene, customScenes);
  const mine = playerCues(room.scene, index, room.players.length, customScenes, preferredRoles);
  const initialCue = mine.find((c) => !me.segments?.includes(c.id)) ?? mine[0] ?? cues[0];
  const [selected, setSelected] = useState<number>(() => initialCue?.id ?? 0);
  const [takes, setTakes] = useState<Record<number, Take>>({});
  const [savedUrls, setSavedUrls] = useState<Record<number, string>>({});
  const [waves, setWaves] = useState<Record<number, number[]>>({});
  const [originalPeaks, setOriginalPeaks] = useState<number[]>(() => {
    const bars = 200;
    const dur = Math.max(1, scene.duration);
    return Array.from({ length: bars }, (_, i) => {
      const t = ((i + 0.5) / bars) * dur;
      const activeCue = cues.find((c) => t >= c.start && t <= c.end);
      if (activeCue) {
        const rel = (t - activeCue.start) / Math.max(0.1, activeCue.end - activeCue.start);
        const env = Math.sin(rel * Math.PI);
        const mod = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + activeCue.id) * Math.cos(i * 0.9));
        return Math.max(0.16, Math.min(0.92, env * mod * 0.88 + 0.12));
      }
      return 0.08 + 0.08 * Math.abs(Math.sin(i * 1.3));
    });
  });
  const [recording, setRecording] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [playingSegment, setPlayingSegment] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [position, setPosition] = useState(() => initialCue?.start ?? 0);
  const [error, setError] = useState('');
  const [reviewedTakeId, setReviewedTakeId] = useState<number | null>(null);

  const current: Cue =
    cues.find((c) => Number(c.id) === Number(selected)) ||
    cues[0] || {
      id: 0,
      roleIndex: 0,
      roleName: scene.roles?.[0] || '1. Karakter',
      roleColor: scene.roleDetails?.[0]?.color || '#F5E636',
      text: '',
      start: 0,
      end: scene.duration || 10,
    };
  const duration = Math.max(0.1, current.end - current.start);
  const completed = mine.filter((c) => me.segments?.includes(c.id)).length;
  const take = takes[selected];
  const isSaved = Boolean(me.segments?.includes(selected));
  const selectedNumber = Math.max(0, cues.findIndex((c) => Number(c.id) === Number(selected))) + 1;
  const [listeningOriginal, setListeningOriginal] = useState(false);
  const locked = busy || recording || countdown > 0 || listeningOriginal;
  const video = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    audioContext = useRef<AudioContext | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    previewEnd = useRef<number | null>(null),
    mounted = useRef(true),
    urls = useRef<string[]>([]),
    loaded = useRef(new Set<number>()),
    savedAudio = useRef<HTMLAudioElement>(null),
    segmentAudio = useRef<HTMLAudioElement | null>(null),
    instrumentalAudio = useRef<HTMLAudioElement | null>(null);
  const [resolvedInstrumentalUrl, setResolvedInstrumentalUrl] = useState<string>(scene.instrumental || '');
  const generatingMneRef = useRef<Promise<string> | null>(null);
  const api = `/api/rooms/${room.code}/audio/${session.id}`;

  async function ensureInstrumentalReady(): Promise<string> {
    const isPureAi =
      Boolean(scene.instrumental) &&
      (scene.instrumental!.includes('/pure_htdemucs_') ||
        scene.instrumental!.includes('/splitter_'));
    if (isPureAi && scene.instrumental) {
      if (resolvedInstrumentalUrl !== scene.instrumental) {
        setResolvedInstrumentalUrl(scene.instrumental);
      }
      if (
        instrumentalAudio.current &&
        instrumentalAudio.current.src !== scene.instrumental
      ) {
        instrumentalAudio.current.src = scene.instrumental;
      }
      return scene.instrumental;
    }
    if (resolvedInstrumentalUrl && resolvedInstrumentalUrl.includes('/pure_htdemucs_')) {
      return resolvedInstrumentalUrl;
    }
    if (!scene.video) return scene.instrumental || '';
    if (generatingMneRef.current) return generatingMneRef.current;

    const task = (async () => {
      try {
        const cloudRes = await removeVocalsFromVideo(
          scene.video,
          scene.title,
          undefined,
          cues,
        );
        if (cloudRes.url) {
          if (mounted.current) {
            setResolvedInstrumentalUrl(cloudRes.url);
            if (instrumentalAudio.current) {
              instrumentalAudio.current.src = cloudRes.url;
              instrumentalAudio.current.load();
            }
          }
          if (!cloudRes.url.startsWith('blob:')) {
            await supabase
              .from('custom_scenes')
              .update({ instrumental_url: cloudRes.url })
              .eq('id', scene.id);
          }
          return cloudRes.url;
        }
        return scene.instrumental || '';
      } catch (err) {
        console.warn('Splitter-AI hazırlama uyarısı:', err);
        return scene.instrumental || '';
      } finally {
        generatingMneRef.current = null;
      }
    })();

    generatingMneRef.current = task;
    return task;
  }

  useEffect(() => {
    if (scene.video || scene.instrumental) {
      void ensureInstrumentalReady();
    }
  }, [scene.id, scene.instrumental, scene.video]);

  function stop() {
    previewEnd.current = null;
    if (video.current) {
      video.current.pause();
      video.current.muted = true;
    }
    if (instrumentalAudio.current) {
      instrumentalAudio.current.pause();
    }
    if (segmentAudio.current) {
      segmentAudio.current.pause();
      segmentAudio.current.currentTime = 0;
    }
    savedAudio.current?.pause();
    setPreviewing(false);
    setListeningOriginal(false);
    setPlayingSegment(null);
    if (timer.current) clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }
  const handleTime = useEffectEvent(() => {
    const v = video.current;
    if (!v) return;
    setPosition(v.currentTime - scene.start);
    if (previewEnd.current !== null && v.currentTime >= previewEnd.current) {
      stop();
      v.currentTime = previewEnd.current ?? scene.start + current.end;
    }
  });
  useEffect(() => {
    mounted.current = true;
    const v = video.current;
    const ownedUrls = urls.current;
    const tick = () => handleTime();
    v?.addEventListener('timeupdate', tick);
    return () => {
      mounted.current = false;
      v?.removeEventListener('timeupdate', tick);
      v?.pause();
      if (segmentAudio.current) segmentAudio.current.pause();
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      void audioContext.current?.close();
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [video]);

  // Videonun gerçek orijinal ses dalgasını (waveform) çıkart
  useEffect(() => {
    let active = true;
    if (!scene.video) return;
    void (async () => {
      try {
        const res = await fetch(scene.video);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const tempCtx = new Ctx();
        try {
          const decoded = await tempCtx.decodeAudioData(buf);
          if (!active) return;
          const ch0 = decoded.getChannelData(0);
          const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : ch0;
          const sr = decoded.sampleRate;
          const startIdx = Math.max(0, Math.floor(scene.start * sr));
          const totalSamples = Math.max(
            1,
            Math.min(decoded.length - startIdx, Math.floor(scene.duration * sr)),
          );
          const bars = 200;
          const step = Math.max(1, Math.floor(totalSamples / bars));
          const raw = Array.from({ length: bars }, (_, i) => {
            let max = 0;
            const s = startIdx + i * step;
            const e = Math.min(decoded.length, s + step);
            for (let j = s; j < e; j++) {
              const v = (Math.abs(ch0[j]) + Math.abs(ch1[j])) * 0.5;
              if (v > max) max = v;
            }
            return max;
          });
          const maxPeak = Math.max(0.02, ...raw);
          const normalized = raw.map((n) => Math.max(0.06, Math.min(1, n / maxPeak)));
          if (active) setOriginalPeaks(normalized);
        } finally {
          void tempCtx.close().catch(() => {});
        }
      } catch {
        // Fallback waveform remains active
      }
    })();
    return () => {
      active = false;
    };
  }, [scene.video, scene.start, scene.duration]);
  const segmentKey = me.segments.join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of segmentKey.split(',').filter(Boolean).map(Number)) {
      if (loaded.current.has(id)) continue;
      loaded.current.add(id);
      void (async () => {
        try {
          let audioUrl = await getAudioRecordingUrl(room.code, session.id, id);
          if (!audioUrl) audioUrl = `${api}?segment=${id}`;
          const r = await fetch(audioUrl, {
            headers: audioUrl.startsWith('http') && !audioUrl.includes('/api/rooms')
              ? {}
              : { Authorization: `Bearer ${session.token}` },
          });
          if (!r.ok) throw new Error('Kayıt okunamadı');
          audioContext.current ??= new AudioContext();
          const blob = await r.blob();
          const data = await audioContext.current.decodeAudioData(
            await blob.arrayBuffer(),
          );
          if (!cancelled) {
            const url = URL.createObjectURL(blob);
            urls.current.push(url);
            setSavedUrls((u) => ({ ...u, [id]: url }));
            setWaves((w) => ({ ...w, [id]: peaksOf(data) }));
          } else {
            loaded.current.delete(id);
          }
        } catch {
          loaded.current.delete(id);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [api, session.token, segmentKey]);
  async function seek(start: number) {
    const v = video.current;
    if (!v || v.readyState < 1)
      throw new Error('Video yükleniyor. Birkaç saniye sonra tekrar dene.');
    v.pause();
    if (Math.abs(v.currentTime - start) > 0.015) {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timeout);
          v.removeEventListener('seeked', done);
          resolve();
        };
        const timeout = setTimeout(() => {
          v.removeEventListener('seeked', done);
          reject(new Error('Video konumlandırılamadı. Tekrar dene.'));
        }, 5000);
        v.addEventListener('seeked', done);
        v.currentTime = start;
      });
    }
    return v;
  }
  async function preview() {
    setError('');
    setBusy(true);
    savedAudio.current?.pause();
    stop();
    try {
      const v = await seek(scene.start + current.start);
      if (!mounted.current) return;
      previewEnd.current = scene.start + current.end;
      setPosition(current.start);
      setPreviewing(true);
      // Önizlemede videonun ORİJİNAL sesini oynat (instrumentalAudio kapalı)
      if (instrumentalAudio.current) {
        instrumentalAudio.current.pause();
      }
      v.muted = false;
      v.volume = 1.0;
      await v.play();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(id: number) {
    if (locked) return;
    stop();
    setSelected(id);
    setError('');
    const target = cues.find((c) => Number(c.id) === Number(id));
    if (target) {
      setPosition(target.start);
      if (video.current) video.current.currentTime = scene.start + target.start;
    }
  }
  async function playSegment(id: number) {
    if (locked && playingSegment !== id) return;
    if (playingSegment === id) {
      stop();
      return;
    }
    savedAudio.current?.pause();
    stop();
    const c = cues.find((item) => Number(item.id) === Number(id));
    if (!c) return;
    let audioUrl = takes[id]?.url ?? savedUrls[id];
    if (!audioUrl && me.segments?.includes(id)) {
      setBusy(true);
      try {
        let fetchedUrl = await getAudioRecordingUrl(room.code, session.id, id);
        if (!fetchedUrl) fetchedUrl = `${api}?segment=${id}`;
        const r = await fetch(fetchedUrl, {
          headers: fetchedUrl.startsWith('http') && !fetchedUrl.includes('/api/rooms')
            ? {}
            : { Authorization: `Bearer ${session.token}` },
        });
        if (r.ok) {
          const blob = await r.blob();
          audioUrl = URL.createObjectURL(blob);
          urls.current.push(audioUrl);
          setSavedUrls((prev) => ({ ...prev, [id]: audioUrl }));
        }
      } catch {
        // ignore
      }
      setBusy(false);
    }
    if (!audioUrl) return;

    setSelected(id);
    setPlayingSegment(id);
    setBusy(true);
    setError('');

    try {
      // Kendi sesimizi dinlerken VİDEO OYNATILMAZ ve arka plan müziği çalmaz!
      if (video.current) {
        video.current.pause();
        video.current.currentTime = scene.start + c.start;
      }
      if (instrumentalAudio.current) {
        instrumentalAudio.current.pause();
      }

      const a = segmentAudio.current;
      if (a) {
        a.src = audioUrl;
        a.currentTime = 0;
        setPosition(c.start);
        await a.play();
      }

      timer.current = setInterval(() => {
        if (!a || !mounted.current) return;
        const currentPos = Math.min(c.end, c.start + a.currentTime);
        setPosition(currentPos);
        if (a.ended || a.currentTime >= c.end - c.start) {
          stop();
          setPosition(c.start);
        }
      }, 25);
    } catch (e) {
      stop();
      setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function record() {
    setError('');
    setBusy(true);
    savedAudio.current?.pause();
    stop();
    try {
      const backing = instrumentalAudio.current;
      const readyInstrumentalUrl = await ensureInstrumentalReady();
      if (backing && readyInstrumentalUrl && backing.src !== readyInstrumentalUrl) {
        backing.src = readyInstrumentalUrl;
        backing.load();
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error('Kayıt için güncel Chrome veya Safari kullan.');
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }

      // 1. ADIM: İlk başta replik yapılacak kısım videonun ORİJİNAL SESİYLE oynatılsın
      const v = await seek(scene.start + current.start);
      if (!mounted.current) return;
      if (instrumentalAudio.current) {
        instrumentalAudio.current.pause();
      }
      setListeningOriginal(true);
      setPosition(current.start);
      v.muted = false;
      v.volume = 1.0;
      await v.play();

      await new Promise<void>((resolve) => {
        const checkOriginalEnd = setInterval(() => {
          if (!mounted.current || !video.current) {
            clearInterval(checkOriginalEnd);
            resolve();
            return;
          }
          setPosition(video.current.currentTime - scene.start);
          if (video.current.currentTime >= scene.start + current.end || video.current.paused) {
            clearInterval(checkOriginalEnd);
            video.current.pause();
            resolve();
          }
        }, 25);
      });

      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      setListeningOriginal(false);

      // 2. ADIM: Videoyu başa sar, sesi kapat ve oyuncunun repliğini dublaj olarak kaydet!
      v.muted = true;
      await seek(scene.start + current.start);
      if (backing && (backing.src || readyInstrumentalUrl)) {
        try {
          await seekBackingAudio(backing, scene.start + current.start, scene.start + current.end);
        } catch (seekErr) {
          console.warn('Vokalsiz ses konumlandırma uyarısı:', seekErr);
          try {
            backing.currentTime = scene.start + current.start;
          } catch {
            // ignore
          }
        }
      }
      setPosition(current.start);

      audioContext.current ??= new AudioContext();
      await audioContext.current.resume();
      for (let n = 3; n > 0; n--) {
        setCountdown(n);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!mounted.current) return;
      }
      setCountdown(0);
      const mime = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined),
        parts: BlobPart[] = [];
      const id = selected;
      const end = current.end;
      r.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      r.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        if (!parts.length) return;
        const blob = new Blob(parts, { type: r.mimeType || 'audio/webm' }),
          url = URL.createObjectURL(blob);
        urls.current.push(url);
        setReviewedTakeId(id);
        setSavedUrls((u) => ({ ...u, [id]: url }));
        setTakes((t) => ({ ...t, [id]: { blob, url, peaks: [] } }));
        void blob
          .arrayBuffer()
          .then((data) => audioContext.current!.decodeAudioData(data))
          .then((buffer) => {
            if (mounted.current) {
              const peaks = peaksOf(buffer);
              setWaves((w) => ({ ...w, [id]: peaks }));
            }
          })
          .catch(() => {});
        setError('');
        // Kayıt bittiği veya "Kaydı bitir"e basıldığı anda otomatik olarak kaydet ve sıradaki repliğe/finale geç!
        void save(id, blob);
      };
      recorder.current = r;
      // Orijinal konuşma kapalıdır; yalnızca ayrıştırılmış müzik ve efektler duyulur.
      v.muted = true;
      if (backing) backing.volume = 1;
      r.start(200);
      await Promise.all([
        v.play(),
        backing && (backing.src || readyInstrumentalUrl) ? backing.play().catch(() => {}) : Promise.resolve(),
      ]);
      if (!mounted.current) return;
      setRecording(true);
      setPosition(current.start);
      previewEnd.current = scene.start + end;
      const recStartedAt = Date.now();
      const clipDuration = Math.max(0.25, end - current.start);
      timer.current = setInterval(() => {
        const elapsed = (Date.now() - recStartedAt) / 1000;
        setPosition(Math.min(end, v.currentTime - scene.start));
        if (backing && !backing.seeking && !backing.paused && Math.abs(backing.currentTime - v.currentTime) > 0.18) {
          backing.currentTime = v.currentTime;
        }
        if (
          v.currentTime - scene.start >= end - 0.05 ||
          v.ended ||
          v.paused ||
          elapsed >= clipDuration + 0.15
        ) {
          stop();
          if (Number.isFinite(v.duration) && v.duration > 0) {
            v.currentTime = Math.min(v.duration, scene.start + end);
          }
        }
      }, 25);
    } catch (e) {
      stop();
      setListeningOriginal(false);
      if (mounted.current) setError((e as Error).message || 'Kayıt başlatılamadı. Tekrar deneyin.');
      setCountdown(0);
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Mikrofon izni gerekli. Adres çubuğundan mikrofonu açıp tekrar dene.'
          : (e as Error).message,
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save(targetId = selected, targetBlob = take?.blob) {
    if (!targetBlob) return;
    stop();
    savedAudio.current?.pause();
    setBusy(true);
    setError('');
    try {
      // Önce bellekte bekleyen diğer kaydedilmiş ama yüklenmemiş replikler varsa onları da sırayla kaydet
      const pendingEntries = Object.entries(takes).filter(
        ([k, v]) => Number(k) !== Number(targetId) && v?.blob && !me.segments?.includes(Number(k)),
      );
      for (const [k, pendingTake] of pendingEntries) {
        try {
          await saveAudioRecording(room.code, session.id, Number(k), pendingTake.blob);
        } catch {
          // ignore individual pending fallback
        }
      }

      let updatedRoom: Room | null = null;
      try {
        const res = await saveAudioRecording(
          room.code,
          session.id,
          Number(targetId),
          targetBlob,
        );
        updatedRoom = res.room;
      } catch (err) {
        console.warn('Direct Supabase save warning, trying API fallback:', err);
      }

      if (!updatedRoom) {
        const r = await fetch(`${api}?segment=${targetId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.token}`,
            'Content-Type': targetBlob.type,
          },
          body: targetBlob,
        });
        const data = (await r.json()) as { room: Room; error?: string };
        if (!r.ok) throw new Error(data.error);
        updatedRoom = data.room;
      }

      onRoom(updatedRoom);
      setTakes((previous) => {
        const nextTakes = { ...previous };
        delete nextTakes[targetId];
        for (const [k] of pendingEntries) {
          delete nextTakes[Number(k)];
        }
        return nextTakes;
      });
      setReviewedTakeId(null);
      const myUpdatedSegs = (
        updatedRoom.players.find((p) => p.id === me.id)?.segments || []
      ).map(Number);
      const next = mine.find(
        (c) => Number(c.id) !== Number(targetId) && !myUpdatedSegs.includes(Number(c.id)),
      );
      if (next) {
        setSelected(next.id);
        setPosition(next.start);
        if (video.current) video.current.currentTime = scene.start + next.start;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const progress = Math.max(
    0,
    Math.min(100, ((position - current.start) / duration) * 100),
  );
  return (
    <div className="cue-stage">
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={segmentAudio}
        playsInline
        onEnded={stop}
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={instrumentalAudio}
        src={resolvedInstrumentalUrl || undefined}
        preload="auto"
        playsInline
        aria-hidden="true"
        onError={() => {
          if (scene.video) {
            setResolvedInstrumentalUrl('');
            void (async () => {
              try {
                const decoded = await decodeMediaAudioBuffer(scene.video);
                const mneBuf = await createMneAudioBuffer(decoded);
                const wavBlob = audioBufferToWav(mneBuf);
                const localUrl = URL.createObjectURL(wavBlob);
                urls.current.push(localUrl);
                if (mounted.current) {
                  setResolvedInstrumentalUrl(localUrl);
                  if (instrumentalAudio.current) {
                    instrumentalAudio.current.src = localUrl;
                    instrumentalAudio.current.load();
                  }
                }
              } catch {
                // ignore
              }
            })();
          }
        }}
        style={{ display: 'none' }}
      />

      {/* Başlık ve Canlı Hazır Durumu */}
      {(() => {
        const preferredRoles = room.players.map((p) => p.role);
        const readyPlayersCount = room.players.filter((p, pIdx) => {
          const pAssigned = playerCues(room.scene, pIdx, room.players.length, customScenes, preferredRoles);
          const pDone = pAssigned.length > 0 ? pAssigned.every((c) => p.segments?.includes(c.id)) : p.audio;
          return p.ready === 1 && pDone;
        }).length;

        return (
          <div className="cue-stage-heading">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="eyebrow">KAYIT STÜDYOSU / BÖLÜM {String(selectedNumber).padStart(2, '0')}</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: completed >= mine.length ? 'rgba(74, 222, 128, 0.15)' : 'rgba(245, 230, 54, 0.15)',
                  color: completed >= mine.length ? '#4ade80' : '#F5E636',
                  border: `1px solid ${completed >= mine.length ? 'rgba(74, 222, 128, 0.35)' : 'rgba(245, 230, 54, 0.35)'}`,
                }}
              >
                <span
                  className="pulse-dot"
                  style={{ background: completed >= mine.length ? '#4ade80' : '#F5E636' }}
                />
                {completed >= mine.length
                  ? `HAZIRSIN (${readyPlayersCount}/${room.players.length} OYUNCU HAZIR)`
                  : `${readyPlayersCount}/${room.players.length} OYUNCU HAZIR`}
              </span>
            </div>
            <strong>{completed} / {mine.length} replik tamamlandı</strong>
          </div>
        );
      })()}
      <div className={`video-wrap ${recording ? 'recording-active-glow' : ''}`}>
        <video
          ref={video}
          src={scene.video}
          poster={scene.poster}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => {
            if (video.current)
              video.current.currentTime = scene.start + current.start;
          }}
          onError={() =>
            setError(
              'Sahne videosu yüklenemedi. Sayfayı yenileyip tekrar dene.',
            )
          }
        />

        {/* Video Altyazı Kutusu - Karakter adı ve replik metni */}
        <div className="video-subtitle-overlay">
          <span className="video-char-badge">
            {current.roleName}
            {mine.length > 1
              ? ` · Replik ${mine.findIndex((c) => c.id === selected) + 1}/${mine.length}`
              : ''}
          </span>
          <p className="video-subtitle-line">“{current.text}”</p>
        </div>

        {listeningOriginal && (
          <div
            className="active-recording-pill"
            style={{ background: '#9E8CA9', borderColor: '#9E8CA9' }}
          >
            <span className="recording-dot" style={{ background: '#fff' }} />
            <span>Orijinal bölüm oynuyor · {formatTimecode(position)}</span>
          </div>
        )}

        {countdown > 0 && (
          <div className="recording-countdown-overlay">
            <div className="countdown-number">{countdown}</div>
            <span className="countdown-sub">Şimdi sıra sende! Dublaj kaydı başlıyor…</span>
          </div>
        )}

        {recording && (
          <div className="active-recording-pill">
            <span className="recording-dot" />
            <span>Kaydediliyor · Vokalsiz müzik + efektler · {formatTimecode(position)}</span>
          </div>
        )}
      </div>

      <div className="cue-editor">
        {/* Eğer oyuncu tüm repliklerini tamamladıysa Canlı Hazır & Turn Tracker Paneli göster */}
        {completed >= mine.length && !recording && !countdown && !listeningOriginal ? (
          (() => {
            const preferredRoles = room.players.map((p) => p.role);
            const readyPlayersCount = room.players.filter((p, pIdx) => {
              const pAssigned = playerCues(room.scene, pIdx, room.players.length, customScenes, preferredRoles);
              const pDone = pAssigned.length > 0 ? pAssigned.every((c) => p.segments?.includes(c.id)) : p.audio;
              return p.ready === 1 && pDone;
            }).length;
            const isAllPlayersReady = room.players.length > 0 && readyPlayersCount === room.players.length;

            return (
              <div className="turn-tracker-card">
                <div className="turn-tracker-header">
                  <span
                    className="turn-tracker-badge"
                    style={{
                      color: isAllPlayersReady ? '#4ade80' : 'var(--primary)',
                    }}
                  >
                    <span
                      className="pulse-dot"
                      style={{
                        background: isAllPlayersReady ? '#4ade80' : 'var(--primary)',
                        boxShadow: isAllPlayersReady ? '0 0 8px #4ade80' : undefined,
                      }}
                    />
                    {isAllPlayersReady
                      ? 'HERKES HAZIR'
                      : `DİĞER OYUNCULAR BEKLENİYOR (${readyPlayersCount}/${room.players.length})`}
                  </span>
                  <h3>
                    {isAllPlayersReady
                      ? 'Büyük Final Başlıyor! 🎬'
                      : 'Repliklerini Tamamladın — Hazırsın!'}
                  </h3>
                  <p>
                    {isAllPlayersReady
                      ? 'Tüm oyuncular hazır oldu. Odadaki herkesle birlikte senkronize izleme başlıyor...'
                      : 'Odadaki diğer oyuncular da kendi repliklerini seslendirip hazır olana kadar oyun bitirilmez. Aşağıdan kayıtlarını dinleyebilir veya düzenleyebilirsin.'}
                  </p>
                </div>

                <div className="turn-players-list">
                  {room.players.map((p, pIdx) => {
                    const pAssigned = playerCues(room.scene, pIdx, room.players.length, customScenes, preferredRoles);
                    const pDone = pAssigned.length > 0
                      ? pAssigned.every((c) => p.segments?.includes(c.id))
                      : p.audio;
                    const pReady = p.ready === 1 && pDone;
                    const pPct = pDone
                      ? 100
                      : Math.round(((p.segments?.length || 0) / Math.max(1, pAssigned.length)) * 100);

                    return (
                      <div key={p.id} className={`turn-player-item ${pReady ? 'done' : 'waiting'}`}>
                        <div className="turn-player-info">
                          <span className="avatar">
                            {p.name[0]?.toLocaleUpperCase('tr') || '?'}
                          </span>
                          <div>
                            <strong>
                              {p.name} {p.id === me.id && <small>(Sen)</small>}
                            </strong>
                            <span>
                              {pReady
                                ? 'Bütün replikleri tamamladı & Hazır ✓'
                                : pDone
                                  ? 'Tüm replikleri kaydetti'
                                  : `${p.segments?.length || 0}/${pAssigned.length} replik kaydetti`}
                            </span>
                          </div>
                        </div>

                        <div className="turn-player-progress-wrap">
                          <div className="turn-progress-bar">
                            <div
                              className={`turn-progress-fill ${pReady ? 'complete' : ''}`}
                              style={{ width: `${pPct}%` }}
                            />
                          </div>
                          <span className={`turn-status-badge ${pReady ? 'ready' : 'in-progress'}`}>
                            {pReady ? (
                              <>
                                <Check size={13} /> Hazır (Ready)
                              </>
                            ) : (p.segments?.length || 0) > 0 ? (
                              'Kaydediyor…'
                            ) : (
                              'Bekleniyor'
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Final Sahnesine Geç Butonu */}
                {me.host === 1 && (
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      style={{ width: '100%' }}
                      onClick={async () => {
                        if (!isAllPlayersReady && room.players.length > 1) {
                          const ok = window.confirm(
                            'Tüm oyuncular henüz dublajlarını tamamlamadı. Yine de finali başlatmak istiyor musunuz?',
                          );
                          if (!ok) return;
                        }
                        setBusy(true);
                        try {
                          const finalRoom = await executeGameRoomAction(
                            room.code,
                            session.token,
                            'finish',
                            { force: true },
                          );
                          onRoom(finalRoom);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {isAllPlayersReady || room.players.length === 1
                        ? 'Final Sahnesine Geç 🎬'
                        : 'Oda Kurucusu: Finali Şimdi Başlat'}
                    </button>
                  </div>
                )}

            <div className="turn-listen-box">
              <div className="turn-listen-header">
                <h4>Kaydettiğin Replikleri Dinle</h4>
                <span className="turn-listen-count">{mine.length} Replik</span>
              </div>
              <div className="cue-steps">
                {mine.map((c, i) => {
                  const isSelected = Number(c.id) === Number(selected);
                  return (
                    <button
                      type="button"
                      disabled={locked}
                      key={c.id}
                      onClick={() => select(c.id)}
                      className={`cue-step-card ${isSelected ? 'active' : ''} done`}
                      aria-label={`${i + 1}. repliğin`}
                    >
                      <div className="cue-step-top">
                        <span className="cue-step-badge">
                          <Check size={12} strokeWidth={2.5} /> #{String(i + 1).padStart(2, '0')}
                        </span>
                        <strong className="cue-step-time">
                          {formatTimecode(c.start)} – {formatTimecode(c.end)}
                        </strong>
                      </div>
                      {c.text && (
                        <p className="cue-step-text" title={c.text}>
                          “{c.text}”
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {(take || savedUrls[selected]) && (
                <div className="cue-review">
                  <span>Replik {Math.max(0, mine.findIndex((c) => Number(c.id) === Number(selected))) + 1} Kaydın</span>
                  {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio
                    controls
                    ref={savedAudio}
                    src={take?.url ?? savedUrls[selected]}
                    aria-label="Kaydını dinle"
                    onPlay={() => {
                      video.current?.pause();
                      instrumentalAudio.current?.pause();
                    }}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      // Allow re-recording
                      setTakes((t) => {
                        const copy = { ...t };
                        delete copy[selected];
                        return copy;
                      });
                      void record();
                    }}
                  >
                    <RotateCcw size={16} /> Bu Bölümü Yeniden Kaydet
                  </button>
                </div>
              )}
            </div>
          </div>
            );
          })()
        ) : (
          <>
            <div className="cue-timebar">
              <div className="cue-timebar-left">
                <span>SAHNE ZAMAN ÇİZELGESİ</span>
                <div className="cue-wave-legend">
                  <span className="cue-wave-legend-item">
                    <i className="cue-wave-dot original" /> Orijinal ses
                  </span>
                  <span className="cue-wave-legend-item">
                    <i className="cue-wave-dot user" /> Senin kaydın
                  </span>
                </div>
              </div>
              <strong>
                {formatTimecode(position)} <span>/ {formatTimecode(scene.duration)}</span>
              </strong>
            </div>
            <div className="cue-track">
              <svg
                viewBox="0 0 1000 100"
                preserveAspectRatio="none"
                aria-label="Orijinal video ve kayıtların ses dalgası"
              >
                <line
                  x1="0"
                  y1="50"
                  x2="1000"
                  y2="50"
                  stroke="#44443c"
                  strokeWidth="1"
                />
                {/* 1. Katman: Videonun Orijinal Ses Dalgası (Turkuaz / Mavi) */}
                <g className="original-waveform-layer">
                  {originalPeaks.map((peak, i) => {
                    const x = ((i + 0.5) / originalPeaks.length) * 1000;
                    const t = ((i + 0.5) / originalPeaks.length) * Math.max(1, scene.duration);
                    const coveredByUserWave = cues.some(
                      (c) => t >= c.start && t <= c.end && (waves[c.id]?.length ?? 0) > 0,
                    );
                    return (
                      <line
                        key={`orig-${i}`}
                        x1={x}
                        x2={x}
                        y1={50 - peak * 36}
                        y2={50 + peak * 36}
                        stroke={coveredByUserWave ? 'rgba(158, 140, 169, 0.3)' : 'rgba(158, 140, 169, 0.76)'}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>

                {/* 2. Katman: Kullanıcının Kaydettiği Ses Dalgası (Neon Yeşil / Sarı - Üst Katman) */}
                {cues.map((c) => (
                  <g key={c.id} className="user-waveform-layer">
                    {(waves[c.id] ?? []).map((peak, i) => (
                      <line
                        key={i}
                        x1={
                          ((c.start + ((i + 0.5) / 80) * (c.end - c.start)) /
                            Math.max(1, scene.duration)) *
                          1000
                        }
                        x2={
                          ((c.start + ((i + 0.5) / 80) * (c.end - c.start)) /
                            Math.max(1, scene.duration)) *
                          1000
                        }
                        y1={50 - peak * 43}
                        y2={50 + peak * 43}
                        stroke={
                          Number(c.id) === Number(selected)
                            ? '#F5E636'
                            : mine.some((m) => Number(m.id) === Number(c.id))
                              ? '#CDE2CD'
                              : '#9E8CA9'
                        }
                        strokeWidth="2.8"
                        strokeLinecap="round"
                      />
                    ))}
                  </g>
                ))}
              </svg>
              {cues.map((c, cIndex) => {
                const own = mine.some((m) => Number(m.id) === Number(c.id));
                const hasRecorded =
                  Boolean(takes[c.id]) ||
                  Boolean(savedUrls[c.id]) ||
                  Boolean(me.segments?.includes(c.id));
                const isPlayingThis = Number(playingSegment) === Number(c.id);

                return (
                  <div
                    role="button"
                    tabIndex={own && !locked ? 0 : -1}
                    key={c.id}
                    className={`cue-region ${own ? 'own' : ''} ${Number(c.id) === Number(selected) ? 'selected' : ''} ${me.segments?.includes(c.id) ? 'done' : ''} ${isPlayingThis ? 'playing-segment' : ''}`}
                    style={{
                      left: `${(c.start / Math.max(1, scene.duration)) * 100}%`,
                      width: `${((c.end - c.start) / Math.max(1, scene.duration)) * 100}%`,
                    }}
                    onClick={() => {
                      if (own && !locked) select(c.id);
                    }}
                    onKeyDown={(e) => {
                      if (own && !locked && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        select(c.id);
                      }
                    }}
                    aria-label={`Replik ${cIndex + 1}: ${formatTimecode(c.start)}–${formatTimecode(c.end)}${own ? ', senin repliğin' : ', diğer oyuncu'}`}
                    aria-pressed={Number(c.id) === Number(selected)}
                  >
                    <span className="cue-region-num">
                      {String(cIndex + 1).padStart(2, '0')}
                      {hasRecorded && <span className="cue-region-check">✓</span>}
                    </span>

                    {hasRecorded && (
                      <button
                        type="button"
                        className={`cue-track-play-btn ${isPlayingThis ? 'playing' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void playSegment(c.id);
                        }}
                        disabled={locked && !isPlayingThis}
                        title={
                          isPlayingThis
                            ? 'Durdur'
                            : `Replik ${cIndex + 1} kaydını dinle`
                        }
                        aria-label={`Replik ${cIndex + 1} kaydını ${isPlayingThis ? 'durdur' : 'dinle'}`}
                      >
                        {isPlayingThis ? (
                          <Square size={11} fill="currentColor" />
                        ) : (
                          <Play size={11} fill="currentColor" />
                        )}
                        <span className="cue-track-play-text">
                          {isPlayingThis ? 'Durdur' : 'Dinle'}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
              <div
                className="cue-playhead"
                style={{
                  left: `${Math.min(100, (position / Math.max(1, scene.duration)) * 100)}%`,
                }}
              />
            </div>
            <div className="cue-ruler">
              {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                <span key={n}>{formatTimecode(scene.duration * n)}</span>
              ))}
            </div>
            <div className="cue-segment-list" aria-label="Sahnedeki bütün replikler">
              {cues.map((cue, index) => {
                const own = mine.some((mineCue) => mineCue.id === cue.id);
                const done = Boolean(me.segments?.includes(cue.id));
                return (
                  <button
                    key={cue.id}
                    type="button"
                    className={`cue-segment-item ${own ? 'own' : 'other'} ${done ? 'done' : ''} ${selected === cue.id ? 'selected' : ''}`}
                    disabled={!own || locked}
                    onClick={() => select(cue.id)}
                  >
                    <strong>#{String(index + 1).padStart(2, '0')}</strong>
                    <span>{cue.roleName} · {own ? done ? 'Tamamlandı' : 'Senin bölümün' : 'Diğer oyuncu'}</span>
                    <time>{formatTimecode(cue.start)} – {formatTimecode(cue.end)}</time>
                  </button>
                );
              })}
            </div>
            {listeningOriginal ? (
              <div className="cue-countdown">
                <strong>Orijinal bölüm</strong>
                <span>
                  {formatTimecode(current.start)}–{formatTimecode(current.end)} oynuyor. Ardından kaydın başlayacak.
                </span>
              </div>
            ) : countdown > 0 ? (
              <div className="cue-countdown">
                <strong>{countdown}</strong>
                <span>
                  {formatTimecode(current.start)} konumunda kaydın başlıyor.
                </span>
              </div>
            ) : recording ? (
              <>
                <div className="cue-record-progress">
                  <div style={{ width: `${progress}%` }} />
                </div>
                <button className="record-button" onClick={stop}>
                  <Square size={18} /> Kaydı bitir
                </button>
              </>
            ) : (
              <button
                className="primary cue-record"
                onClick={() => {
                  if (take) {
                    void save();
                  } else {
                    void record();
                  }
                }}
                disabled={busy}
              >
                {take ? <Check size={19} /> : <Mic size={19} />}
                {take ? 'Kaydı kaydet ve devam et' : isSaved ? 'Yeniden kaydet' : 'Şimdi seslendir'}
              </button>
            )}
            <div className="cue-selected-summary">
              <span>BÖLÜM {String(selectedNumber).padStart(2, '0')} · {isSaved ? 'Tamamlandı' : take ? 'Kaydın hazır' : 'Sıradaki'}</span>
              <strong>{current.roleName}</strong>
              <p>“{current.text}”</p>
              <div className="cue-selected-times">
                <span>BAŞLANGIÇ <b>{formatTimecode(current.start)}</b></span>
                <span>BİTİŞ <b>{formatTimecode(current.end)}</b></span>
                <span>SÜRE <b>{formatTimecode(duration)}</b></span>
              </div>
            </div>
            {(take || savedUrls[selected]) && !recording && !countdown && !listeningOriginal && (
              <div className="cue-review">
                <span>Son kaydın — Replik {Math.max(0, mine.findIndex((c) => Number(c.id) === Number(selected))) + 1} ({current.roleName})</span>
                {/* Player-created speech has no automatic transcript. */}
                {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  controls
                  ref={savedAudio}
                  src={take?.url ?? savedUrls[selected]}
                  aria-label="Kaydını dinle"
                  onPlay={() => {
                    if (playingSegment !== null) stop();
                    video.current?.pause();
                    instrumentalAudio.current?.pause();
                  }}
                  onEnded={() => setReviewedTakeId(selected)}
                />
                {take && <button className="secondary" disabled={busy} onClick={() => void record()}><RotateCcw size={16} /> Yeniden kaydet</button>}
              </div>
            )}
            <button
              className="cue-replay"
              onClick={previewing ? stop : preview}
              disabled={locked}
            >
              {previewing ? <Square size={16} /> : <RotateCcw size={16} />}{' '}
              {previewing ? 'Önizlemeyi durdur' : 'Bölümü tekrar izle'}
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
