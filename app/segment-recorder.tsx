'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Check, Mic, Square, RotateCcw, ArrowRight, Play, Pause } from 'lucide-react';
import {
  playerCues,
  sceneCues,
  getSceneById,
  timeLabel,
  type Room,
  type Cue,
  type Scene,
} from '@/lib/scenes';
import type { Session } from './studio';
import { saveAudioRecording, getAudioRecordingUrl, executeGameRoomAction } from '@/lib/game-service';

type Take = { blob: Blob; url: string; peaks: number[] };
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
  const [selected, setSelected] = useState<number>(() => {
    const unrecorded = mine.find((c) => !me.segments?.includes(c.id));
    if (unrecorded) return unrecorded.id;
    if (mine[0]) return mine[0].id;
    if (cues[0]) return cues[0].id;
    return 0;
  });
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
  const [position, setPosition] = useState(0);
  const [error, setError] = useState('');

  const current: Cue =
    cues.find((c) => Number(c.id) === Number(selected)) ||
    cues[0] || {
      id: 0,
      roleIndex: 0,
      roleName: scene.roles?.[0] || '1. Karakter',
      roleColor: scene.roleDetails?.[0]?.color || '#d8fb51',
      text: '',
      start: 0,
      end: scene.duration || 10,
    };
  const duration = Math.max(0.1, current.end - current.start);
  const completed = mine.filter((c) => me.segments?.includes(c.id)).length;
  const take = takes[selected];
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
  const api = `/api/rooms/${room.code}/audio/${session.id}`;

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
        const blob = new Blob(parts, { type: r.mimeType }),
          url = URL.createObjectURL(blob);
        urls.current.push(url);
        setTakes((t) => ({ ...t, [id]: { blob, url, peaks: [] } }));
        void blob
          .arrayBuffer()
          .then((data) => audioContext.current!.decodeAudioData(data))
          .then((buffer) => {
            if (mounted.current) {
              const peaks = peaksOf(buffer);
              setWaves((w) => ({ ...w, [id]: peaks }));
              setTakes((t) => ({ ...t, [id]: { blob, url, peaks } }));
            }
          })
          .catch(() =>
            setError('Ses önizlemesi hazırlanamadı. Tekrar kaydet.'),
          );
        // Kayıt biter bitmez otomatik olarak sunucuya kaydet ve sıradaki repliğe (veya son replikse Büyük Final'e) geç!
        void save(id, blob);
      };
      recorder.current = r;
      // Kayıt sırasında orijinal ses kapalı, sadece görüntü oynatılır (oyuncu dublajını yapar)
      v.muted = true;
      await v.play();
      if (!mounted.current) return;
      r.start();
      setRecording(true);
      setPosition(current.start);
      previewEnd.current = scene.start + end;
      timer.current = setInterval(() => {
        setPosition(v.currentTime - scene.start);
        if (v.currentTime - scene.start >= end) {
          stop();
          v.currentTime = scene.start + end;
        }
      }, 25);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setListeningOriginal(false);
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
      let updatedRoom: Room | null = null;
      try {
        const res = await saveAudioRecording(
          room.code,
          session.id,
          targetId,
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
      const myUpdatedSegs =
        updatedRoom.players.find((p) => p.id === me.id)?.segments || [];
      const next = mine.find(
        (c) => c.id !== targetId && !myUpdatedSegs.includes(c.id),
      );
      if (next) {
        setSelected(next.id);
        setPosition(next.start);
        if (video.current) video.current.currentTime = scene.start + next.start;
      } else {
        // Bu oyuncunun tüm replikleri bitti; odadaki diğer oyuncular da bitirdiyse hemen Büyük Final'e geç
        const updatedPreferredRoles = updatedRoom.players.map((p) => p.role);
        const everyoneDone = updatedRoom.players.every((p, idx) => {
          const pAssigned = playerCues(
            room.scene,
            idx,
            updatedRoom!.players.length,
            customScenes,
            updatedPreferredRoles,
          );
          return pAssigned.every((c) => p.segments?.includes(c.id));
        });
        if (everyoneDone && updatedRoom.status !== 'final') {
          const finalRoom = await executeGameRoomAction(
            room.code,
            session.token,
            'finish',
          ).catch(() => null);
          if (finalRoom) onRoom(finalRoom);
        }
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
      {scene.instrumental && (
        <audio
          ref={instrumentalAudio}
          src={scene.instrumental}
          preload="auto"
          playsInline
          aria-hidden="true"
          style={{ display: 'none' }}
        />
      )}

      {/* Oyun Başlangıcı & Kayıt Boyunca Görünür Karakter - Oyuncu Eşleşme ve Eşit Replik Tablosu */}
      <div className="stage-role-table-card">
        <div className="stage-role-table-header">
          <span>🎭 KARAKTER & REPLİK DAĞILIM TABLOSU</span>
          <span className="stage-fair-pill">
            🔒 1 Karakter = 1 Oyuncu ({cues.length} Replik / {room.players.length} Oyuncu)
          </span>
        </div>
        <div className="stage-role-table-grid">
          {room.players.map((p, pIdx) => {
            const pAssigned = playerCues(
              room.scene,
              pIdx,
              room.players.length,
              customScenes,
              preferredRoles,
            );
            const pRoles = Array.from(
              new Set(pAssigned.map((c) => c.roleName).filter(Boolean)),
            );
            const roleLabel =
              pRoles.join(' / ') ||
              scene.roles?.[pIdx % Math.max(1, scene.roles.length)] ||
              `${pIdx + 1}. Karakter`;
            const roleColor =
              pAssigned[0]?.roleColor ||
              scene.roleDetails?.[
                pIdx % Math.max(1, scene.roleDetails?.length || 1)
              ]?.color ||
              '#d8fb51';
            const doneCount = pAssigned.filter((c) =>
              p.segments?.includes(c.id),
            ).length;
            const isMe = p.id === me.id;

            return (
              <div
                key={p.id}
                className={`stage-role-player-box ${isMe ? 'is-me' : ''} ${doneCount >= pAssigned.length && pAssigned.length > 0 ? 'all-done' : ''}`}
                style={{ borderColor: isMe ? roleColor : undefined }}
              >
                <div className="stage-role-player-top">
                  <div className="stage-role-player-name">
                    <span
                      className="stage-role-dot"
                      style={{ background: roleColor }}
                    />
                    <strong>{p.name}</strong>
                    {isMe && <span className="stage-me-badge">SEN</span>}
                  </div>
                  <span className="stage-role-count">
                    {doneCount}/{pAssigned.length} Replik
                  </span>
                </div>
                <div className="stage-role-char-line">
                  <span
                    className="stage-role-char-tag"
                    style={{
                      color: roleColor,
                      background: `${roleColor}18`,
                      borderColor: `${roleColor}55`,
                    }}
                  >
                    Seslendirdiği Karakter: <strong>{roleLabel}</strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
          <span
            className="video-char-badge"
            style={{ backgroundColor: current.roleColor }}
          >
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
            style={{ background: 'rgba(14, 165, 233, 0.92)', borderColor: '#38bdf8' }}
          >
            <span className="recording-dot" style={{ background: '#fff' }} />
            <span>1. ADIM: ORİJİNAL REPLİK OYNATILIYOR · {timeLabel(position)}</span>
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
            <span>2. ADIM: DUBLAJ KAYDI · {current.roleName.toUpperCase()} · {timeLabel(position)}</span>
          </div>
        )}
      </div>

      <div className="cue-editor">
        {/* Eğer oyuncu tüm repliklerini tamamladıysa Dublaj.io "Sıra Kimde?" Paneli göster */}
        {completed >= mine.length && !recording && !countdown && !listeningOriginal ? (
          <div className="turn-tracker-card">
            <div className="turn-tracker-header">
              <span className="turn-tracker-badge">
                <span className="pulse-dot" /> CANLI DURUM
              </span>
              <h3>SIRA KİMDE?</h3>
              <p>Tüm oyuncuların repliklerini tamamlaması bekleniyor. Final çok yakında başlayacak!</p>
            </div>

            <div className="turn-players-list">
              {room.players.map((p, pIdx) => {
                const pAssigned = playerCues(room.scene, pIdx, room.players.length, customScenes);
                const pDone = pAssigned.length > 0
                  ? pAssigned.every((c) => p.segments?.includes(c.id))
                  : p.audio;
                const pPct = pDone
                  ? 100
                  : Math.round((p.segments.length / Math.max(1, pAssigned.length)) * 100);

                return (
                  <div key={p.id} className={`turn-player-item ${pDone ? 'done' : 'waiting'}`}>
                    <div className="turn-player-info">
                      <span className="avatar">
                        {p.name[0].toLocaleUpperCase('tr')}
                      </span>
                      <div>
                        <strong>
                          {p.name} {p.id === me.id && <small>(Sen)</small>}
                        </strong>
                        <span>
                          {pDone
                            ? 'Bütün replikleri tamamladı'
                            : `${p.segments.length}/${pAssigned.length} replik kaydetti`}
                        </span>
                      </div>
                    </div>

                    <div className="turn-player-progress-wrap">
                      <div className="turn-progress-bar">
                        <div
                          className={`turn-progress-fill ${pDone ? 'complete' : ''}`}
                          style={{ width: `${pPct}%` }}
                        />
                      </div>
                      <span className={`turn-status-badge ${pDone ? 'ready' : 'in-progress'}`}>
                        {pDone ? (
                          <>
                            <Check size={13} /> Tamamlandı
                          </>
                        ) : p.segments.length > 0 ? (
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

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const finalRoom = await executeGameRoomAction(
                      room.code,
                      session.token,
                      'finish',
                    );
                    onRoom(finalRoom);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                style={{ width: '100%', justifyContent: 'center', padding: '14px 20px', fontSize: '15px' }}
              >
                <Play size={18} fill="currentColor" /> Bitmiş Halini Şimdi İzle (Büyük Final) 🎬
              </button>
            </div>

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
                          {timeLabel(c.start)} – {timeLabel(c.end)}
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
                      record();
                    }}
                  >
                    <RotateCcw size={16} /> Bu Bölümü Yeniden Kaydet
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="cue-timebar">
              <div className="cue-timebar-left">
                <span>SAHNE ZAMAN ÇİZELGESİ</span>
                <div className="cue-wave-legend">
                  <span className="cue-wave-legend-item">
                    <i className="cue-wave-dot original" /> Orijinal Video Sesi
                  </span>
                  <span className="cue-wave-legend-item">
                    <i className="cue-wave-dot user" /> Senin Kaydın
                  </span>
                </div>
              </div>
              <strong>
                {timeLabel(position)} <span>/ {timeLabel(scene.duration)}</span>
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
                  stroke="#3b4336"
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
                        stroke={coveredByUserWave ? 'rgba(56, 189, 248, 0.32)' : 'rgba(56, 189, 248, 0.72)'}
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
                            ? '#d8fb51'
                            : mine.some((m) => Number(m.id) === Number(c.id))
                              ? '#34d399'
                              : '#a3e635'
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
                    aria-label={`Replik ${cIndex + 1}: ${timeLabel(c.start)}–${timeLabel(c.end)}${own ? ', senin repliğin' : ', diğer oyuncu'}`}
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
                <span key={n}>{timeLabel(scene.duration * n)}</span>
              ))}
            </div>
            {listeningOriginal ? (
              <div className="cue-countdown" style={{ borderColor: '#38bdf8' }}>
                <strong style={{ color: '#38bdf8', fontSize: '18px' }}>🔊 Orijinal Sahne</strong>
                <span>
                  Önce orijinal replik oynatılıyor ({timeLabel(current.start)} → {timeLabel(current.end)}), hemen ardından dublaj kaydın başlayacak!
                </span>
              </div>
            ) : countdown > 0 ? (
              <div className="cue-countdown">
                <strong>{countdown}</strong>
                <span>
                  Şimdi sıra sende! {timeLabel(current.start)} konumunda dublaj kaydın başlıyor.
                </span>
              </div>
            ) : recording ? (
              <>
                <div className="cue-record-progress">
                  <div style={{ width: `${progress}%` }} />
                </div>
                <button className="record-button" onClick={stop}>
                  <Square size={18} /> Kaydı bitir · Kalan{' '}
                  {Math.max(0, current.end - position).toFixed(1)} sn
                </button>
              </>
            ) : (
              <button
                className="primary cue-record"
                onClick={record}
                disabled={busy}
              >
                <Mic size={19} />
                {take || me.segments?.includes(selected)
                  ? 'Bu repliği yeniden kaydet (Önce Orijinal Sesi Dinletir)'
                  : mine.length > 1
                    ? `Şimdi seslendir (Replik ${Math.max(0, mine.findIndex((c) => Number(c.id) === Number(selected))) + 1}/${mine.length})`
                    : 'Şimdi seslendir'}
                <span>
                  {timeLabel(current.start)} → {timeLabel(current.end)}
                </span>
              </button>
            )}
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
                />
                {take && (
                  <button className="primary" disabled={busy} onClick={() => void save()}>
                    {mine.filter((c) => c.id !== selected && !me.segments?.includes(c.id)).length === 0
                      ? 'Son Kaydı Onayla ve Bitmiş Halini İzle 🎬'
                      : 'Kaydı Onayla ve Sıradaki Repliğe Geç'}
                    <ArrowRight size={17} />
                  </button>
                )}
              </div>
            )}
            <button
              className="cue-replay"
              onClick={previewing ? stop : preview}
              disabled={locked}
            >
              {previewing ? <Square size={16} /> : <RotateCcw size={16} />}{' '}
              {previewing ? 'Önizlemeyi durdur' : 'Seçili bölümü orijinal sesiyle izle'}
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
