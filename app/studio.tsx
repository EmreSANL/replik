'use client';
import { useEffect, useRef, useState, useEffectEvent } from 'react';
import {
  ArrowLeft,
  Copy,
  Check,
  Play,
  Pause,
  Download,
  Headphones,
  Users,
  Volume2,
  VolumeX,
  Mic,
  Film,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Loader2,
  Globe,
  Trash2,
  Captions,
} from 'lucide-react';
import SegmentRecorder from './segment-recorder';
import { formatTimecode } from '@/lib/timecode';
import { scheduleBackgroundDucking } from '@/lib/dubbing-mix';
import {
  decodeMediaAudioBuffer,
} from '@/lib/vocal-remover';
import MicTestDialog from '@/components/mic-test-dialog';
import RoleRevealDialog from '@/components/role-reveal-dialog';
import ScenePickerDialog from '@/components/scene-picker-dialog';
import {
  sceneCues,
  playerCues,
  getSceneById,
  getCustomScenes,
  getCharacterColor,
  getPlayerCharacterMap,
  type Room,
  type Scene,
} from '@/lib/scenes';
import { getScenesFromSupabase } from '@/lib/supabase';
import {
  createGameRoom,
  joinGameRoom,
  getGameRoom,
  executeGameRoomAction,
  getAudioRecordingUrl,
  publishRoomDubbingToSupabase,
  deleteUnpublishedRoomFromSupabase,
} from '@/lib/game-service';

export type Session = { code: string; token: string; id: string };

export async function request(path: string, token?: string, body?: unknown) {
  try {
    // 1. Oda oluşturma: POST /api/rooms
    if (path === '/api/rooms' && body && typeof body === 'object') {
      const b = body as { name: string; scene: number; maxPlayers?: number };
      return await createGameRoom(b.name, Number(b.scene), b.maxPlayers ?? 4);
    }

    // 2. Odaya katılma, oda durumu alma veya aksiyon çalıştırma: /api/rooms/[code]
    if (path.startsWith('/api/rooms/')) {
      const parts = path.split('?')[0].split('/');
      const code = parts[3];
      if (code && !parts[4]) {
        // GET /api/rooms/[code] (Snapshot alma)
        if (!body) {
          const room = await getGameRoom(code);
          return { room, token: token || '', id: '' };
        }
        // POST /api/rooms/[code] (Join veya Action)
        const b = body as { action: string; name?: string; [key: string]: unknown };
        if (b.action === 'join' && b.name) {
          return await joinGameRoom(code, b.name);
        }
        if (token) {
          const room = await executeGameRoomAction(code, token, b.action, b);
          return { room, token, id: '' };
        }
      }
    }
  } catch (supabaseErr) {
    console.warn('Game service request handler:', supabaseErr);
    throw supabaseErr;
  }

  // Fallback: Standart fetch çağrısı
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    const text = await r.text();
    let msg = 'Bağlantı kurulamadı. Tekrar dene.';
    try {
      const json = JSON.parse(text);
      msg = json.error || msg;
    } catch {
      msg = `Sunucu hatası: ${text.slice(0, 60)}`;
    }
    throw new Error(msg);
  }
  return (await r.json()) as {
    room: Room;
    token: string;
    id: string;
    error?: string;
  };
}

export default function Studio({
  session,
  initial,
  onExit,
}: {
  session: Session;
  initial: Room;
  onExit: () => void;
}) {
  const [room, setRoom] = useState(initial),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    [exporting, setExporting] = useState(false),
    [countdown, setCountdown] = useState(0),
    [audioLoaded, setAudioLoaded] = useState(false),
    [audioLoading, setAudioLoading] = useState(false),
    [isMuted, setIsMuted] = useState(false),
    [subtitlesVisible, setSubtitlesVisible] = useState(true),
    [micTestOpen, setMicTestOpen] = useState(false),
    [scenePickerOpen, setScenePickerOpen] = useState(false),
    [roleRevealOpen, setRoleRevealOpen] = useState(false),
    [autoplayPrompt, setAutoplayPrompt] = useState(false),
    [lobbyPlaying, setLobbyPlaying] = useState(false),
    [playbackTime, setPlaybackTime] = useState(0),
    [activeSubtitle, setActiveSubtitle] = useState<{
      roleName: string;
      playerName: string;
      roleColor: string;
      text: string;
    }[]>([]);

  const video = useRef<HTMLVideoElement>(null),
    lobbyAudio = useRef<HTMLAudioElement | null>(null),
    ctx = useRef<AudioContext | null>(null),
    masterGain = useRef<GainNode | null>(null),
    buffers = useRef<Map<string, AudioBuffer>>(new Map()),
    bufferUrls = useRef<Map<string, string>>(new Map()),
    roomRequestVersion = useRef(0),
    sources = useRef<AudioBufferSourceNode[]>([]),
    seenPlay = useRef(0),
    playStop = useRef<ReturnType<typeof setTimeout> | null>(null),
    exportStop = useRef<ReturnType<typeof setTimeout> | null>(null),
    exportRecorder = useRef<MediaRecorder | null>(null),
    subtitleInterval = useRef<ReturnType<typeof setInterval> | null>(null),
    frame = useRef(0),
    clockOffset = useRef(0),
    mounted = useRef(true),
    prevStatus = useRef(initial.status);

  useEffect(() => {
    clockOffset.current = initial.serverNow - Date.now();
  }, [initial.serverNow]);

  const [customScenes, setCustomScenes] = useState<Scene[]>(() => {
    if (typeof window !== 'undefined') return getCustomScenes();
    return [];
  });

  // Supabase'den özel sahneleri senkronize et
  useEffect(() => {
    void getScenesFromSupabase().then((remoteScenes) => {
      if (remoteScenes && remoteScenes.length > 0 && mounted.current) {
        setCustomScenes(remoteScenes);
      }
    });
  }, [room.scene]);

  const scene = getSceneById(room.scene, customScenes),
    me = room.players.find((p) => p.id === session.id) ?? room.players[0],
    slotDuration = scene.duration / Math.max(1, room.players.length),
    cues = sceneCues(room.scene, customScenes);

  const api = `/api/rooms/${session.code}`;

  function receiveRoom(updated: Room) {
    roomRequestVersion.current++;
    setRoom(updated);
  }

  const revealedSceneRef = useRef<string | null>(null);

  // Lobi -> Kayıt geçişinde veya kayıt başında "Rolün Belli Oldu & Replik Tablosu" ekranını otomatik aç
  useEffect(() => {
    if (room.status === 'recording') {
      const revealKey = `${room.code}:${room.scene}`;
      if (
        prevStatus.current === 'lobby' ||
        (revealedSceneRef.current !== revealKey && (me?.segments?.length ?? 0) === 0)
      ) {
        revealedSceneRef.current = revealKey;
        setRoleRevealOpen(true);
      }
    }
    if (room.status !== 'lobby') {
      setLobbyPlaying(false);
      lobbyAudio.current?.pause();
    }
    prevStatus.current = room.status;
  }, [room.status, room.code, room.scene, me?.segments?.length]);

  // Final aşamasına geçildiğinde sesleri arka planda otomatik yükle
  async function loadAudio(): Promise<boolean> {
    setAudioLoading(true);
    try {
      if (!ctx.current || ctx.current.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctx.current = new AudioCtx();
      }
      if (ctx.current.state === 'suspended') {
        await ctx.current.resume().catch(() => {});
      }

      const instKey = `__scene_instrumental__:${scene.id}`;
      // Rooms only load the background already prepared and saved in the editor.
      if (!scene.instrumental) {
        throw new Error('Bu sahnenin arka plan sesi hazır değil. Sahneyi editörde hazırlayıp kaydedin.');
      }
      if (!buffers.current.has(instKey) || bufferUrls.current.get(instKey) !== scene.instrumental) {
        const rawBuf = await decodeMediaAudioBuffer(scene.instrumental);
        buffers.current.set(instKey, rawBuf);
        bufferUrls.current.set(instKey, scene.instrumental);
      }

      // 1. Öncelikle odadaki tüm kayıtları (room.recordings) doğrudan önbelleğe al
      const directRecs = (room.recordings || []).map((rec) => ({
        key: `${rec.player}:${rec.segment}`,
        cueKey: `cue:${rec.segment}`,
        segment: rec.segment,
        playerId: rec.player,
        directUrl: rec.url,
        fallbackUrl: `${api}/audio/${rec.player}?segment=${rec.segment}`,
      }));

      // 2. Oyuncu segment listelerinden de eksik kalanları tamamla
      const playerTracks = room.players.flatMap((p) =>
        p.segments.length
          ? p.segments.map((id) => ({
              key: `${p.id}:${id}`,
              cueKey: `cue:${id}`,
              segment: id,
              playerId: p.id,
              directUrl: null as string | null,
              fallbackUrl: `${api}/audio/${p.id}?segment=${id}`,
            }))
          : [
              {
                key: p.id,
                cueKey: null as string | null,
                segment: null as number | null,
                playerId: p.id,
                directUrl: null as string | null,
                fallbackUrl: `${api}/audio/${p.id}`,
              },
            ],
      );

      const allTracks = Array.from(new Map(
        [...playerTracks, ...directRecs]
          .map((track) => [track.key, track]),
      ).values());
      await Promise.all(
        allTracks.map(async (track) => {
          if (
            (!track.directUrl || bufferUrls.current.get(track.key) === track.directUrl) &&
            buffers.current.has(track.key) &&
            (!track.cueKey || buffers.current.has(track.cueKey))
          ) {
            return;
          }
          try {
            let audioUrl =
              track.directUrl ||
              (await getAudioRecordingUrl(session.code, track.playerId, track.segment));
            if (!audioUrl) audioUrl = track.fallbackUrl;

            const r = await fetch(audioUrl, {
              headers:
                audioUrl.startsWith('http') && !audioUrl.includes('/api/rooms')
                  ? {}
                  : { Authorization: `Bearer ${session.token}` },
            });
            if (!r.ok) return;
            const buf = await r.arrayBuffer();
            if (buf.byteLength === 0) return;
            const decoded = await ctx.current!.decodeAudioData(buf);
            buffers.current.set(track.key, decoded);
            bufferUrls.current.set(track.key, audioUrl);
            if (track.cueKey) {
              buffers.current.set(track.cueKey, decoded);
            }
          } catch (err) {
            console.warn('Track load warning:', track.key, err);
          }
        }),
      );
      setAudioLoaded(true);
      return true;
    } catch (e) {
      console.warn('Audio preload warning:', e);
      setAudioLoaded(false);
      setError((e as Error).message || 'Arka plan sesi yüklenemedi.');
      return false;
    } finally {
      setAudioLoading(false);
    }
  }

  const recordingsVersion = JSON.stringify(room.recordings);
  useEffect(() => {
    if (room.status === 'final') {
      void loadAudio();
    }
  }, [room.status, recordingsVersion]);

  useEffect(() => {
    if (masterGain.current && ctx.current) {
      masterGain.current.gain.setValueAtTime(
        isMuted ? 0 : 1,
        ctx.current.currentTime,
      );
    }
  }, [isMuted]);

  async function prepare() {
    await loadAudio();
    await act('ready', { ready: !me.ready });
  }

  useEffect(() => {
    mounted.current = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const before = Date.now();
        const version = ++roomRequestVersion.current;
        const d = await request(api, session.token);
        if (mounted.current && version === roomRequestVersion.current) {
          clockOffset.current = d.room.serverNow - (before + Date.now()) / 2;
          setRoom(d.room);
        }
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      } finally {
        refreshing = false;
      }
    };
    const t = setInterval(refresh, 1500);
    return () => {
      mounted.current = false;
      clearInterval(t);
      if (subtitleInterval.current) clearInterval(subtitleInterval.current);
      sources.current.forEach((s) => {
        try {
          s.stop();
          s.disconnect();
        } catch {}
      });
      sources.current = [];
      void ctx.current?.close();
      if (playStop.current) clearTimeout(playStop.current);
      if (exportStop.current) clearTimeout(exportStop.current);
      if (exportRecorder.current?.state === 'recording')
        exportRecorder.current.stop();
      cancelAnimationFrame(frame.current);
    };
  }, [api, session.token]);

  async function act(action: string, extra = {}) {
    setBusy(true);
    setError('');
    try {
      const d = await request(api, session.token, { action, ...extra });
      receiveRoom(d.room);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function stopPlayback() {
    sources.current.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch {}
    });
    sources.current = [];
    if (video.current) {
      video.current.pause();
    }
    if (playStop.current) clearTimeout(playStop.current);
    if (subtitleInterval.current) clearInterval(subtitleInterval.current);
    setActiveSubtitle([]);
    setPlaying(false);
  }

  async function playFinal(late = 0, destination?: AudioNode) {
    const v = video.current;
    if (!v) return;
    stopPlayback();
    setAutoplayPrompt(false);

    try {
      if (!ctx.current || ctx.current.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctx.current = new AudioCtx();
      }
      if (ctx.current.state === 'suspended') {
        await ctx.current.resume().catch(() => {});
      }

      if (!(await loadAudio())) {
        setAutoplayPrompt(true);
        return;
      }

      const audio = ctx.current;

      // Keep recorded voices at their set level even when cues overlap.
      // A compressor after the shared master gain ducks every voice together.
      if (audio) {
        if (!masterGain.current) {
          masterGain.current = audio.createGain();
        }
        masterGain.current.gain.setValueAtTime(
          isMuted ? 0 : 1,
          audio.currentTime,
        );
        masterGain.current.disconnect();
        masterGain.current.connect(destination || audio.destination);
      }

      v.currentTime = scene.start + late;
      v.muted = true; // Video sound is silenced; players' dubbed tracks are heard

      const playPromise = v.play();
      if (playPromise !== undefined) {
        await playPromise;
      }

      const now = audio ? audio.currentTime : 0;

      if (audio && masterGain.current) {
        // 1. Orijinal arka plan müziği & ses efektleri (İnsan sesleri temizlenmiş M&E track)
        const instBuffer = buffers.current.get(`__scene_instrumental__:${scene.id}`);
        const allCues = sceneCues(room.scene, customScenes);
        let instGain: GainNode | null = null;
        if (instBuffer) {
          const instSource = audio.createBufferSource();
          instSource.buffer = instBuffer;
          instGain = audio.createGain();
          scheduleBackgroundDucking(instGain.gain, allCues, now, late);

          instSource.connect(instGain);
          instGain.connect(masterGain.current);
          const instDuration = Math.max(0, Math.min(instBuffer.duration - late, scene.duration - late));
          if (instDuration > 0) {
            instSource.start(now, late, instDuration);
            sources.current.push(instSource);
          }
        }

        // 2. Odadaki tüm oyuncuların kaydettiği dublaj parçaları (tam senkronize)
        const scheduledCues = new Set<number>();

        allCues.forEach((c) => {
          let buffer = buffers.current.get(`cue:${c.id}`);
          if (!buffer) {
            for (const p of room.players) {
              const b = buffers.current.get(`${p.id}:${c.id}`);
              if (b) {
                buffer = b;
                break;
              }
            }
          }
          if (!buffer) return;
          scheduledCues.add(c.id);
          const skip = Math.max(0, late - c.start),
            duration = Math.min(buffer.duration, c.end - c.start) - skip;
          if (duration <= 0) return;
          const startAt = now + Math.max(0, c.start - late);
          const source = audio.createBufferSource();
          source.buffer = buffer;
          const voiceGain = audio.createGain();
          voiceGain.gain.setValueAtTime(1.15, now);
          source.connect(voiceGain);
          voiceGain.connect(masterGain.current!);
          source.start(startAt, skip, duration);
          sources.current.push(source);
        });

        // Eğer sahnede replik yoksa tek parça oyuncu kayıtlarını oynat
        if (scheduledCues.size === 0) {
          room.players.forEach((p, i) => {
            const buffer = buffers.current.get(p.id);
            if (!buffer) return;
            const at = i * slotDuration;
            const skip = Math.max(0, late - at),
              duration = Math.min(buffer.duration, slotDuration) - skip;
            if (duration <= 0) return;
            const startAt = now + Math.max(0, at - late);
            const source = audio.createBufferSource();
            source.buffer = buffer;
            const voiceGain = audio.createGain();
            voiceGain.gain.setValueAtTime(1.15, now);
            source.connect(voiceGain);
            voiceGain.connect(masterGain.current!);
            source.start(startAt, skip, duration);
            sources.current.push(source);
          });
        }
      }

      // Senkronize Altyazı ve İlerleme Takibi (Birden fazla karakter aynı anda konuşabilir)
      const preferredRoles = room.players.map((p) => p.role);
      const charToPlayer = getPlayerCharacterMap(room.scene, room.players.length, customScenes, preferredRoles);
      if (subtitleInterval.current) clearInterval(subtitleInterval.current);
      subtitleInterval.current = setInterval(() => {
        if (!v || !mounted.current) return;
        const t = v.currentTime - scene.start;
        setPlaybackTime(Math.max(0, Math.min(t, scene.duration)));
        const activeCues = cues.filter((c) => t >= c.start && t < c.end);
        if (activeCues.length > 0) {
          setActiveSubtitle(activeCues.map((c) => {
            const roleIdx = typeof c.roleIndex === 'number' && c.roleIndex >= 0 ? c.roleIndex : 0;
            const playerIdx = charToPlayer.get(roleIdx) ?? (c.id % room.players.length);
            const player = room.players[playerIdx];
            return {
              roleName: c.roleName,
              playerName: player ? player.name : 'Oyuncu',
              roleColor: c.roleColor,
              text: c.text,
            };
          }));
        } else {
          setActiveSubtitle([]);
        }
      }, 80);

      setPlaying(true);
      if (playStop.current) clearTimeout(playStop.current);
      playStop.current = setTimeout(
        () => {
          stopPlayback();
          if (video.current) {
            video.current.currentTime = scene.start;
            setPlaybackTime(0);
          }
        },
        Math.max(0, scene.duration - late) * 1000,
      );
    } catch (err) {
      console.warn('playFinal error:', err);
      setAutoplayPrompt(true);
      setPlaying(false);
    }
  }

  const scheduledPlay = useEffectEvent(playFinal);

  useEffect(() => {
    if (room.status !== 'final') return;

    const targetPlayAt = room.playAt || -1;
    if (seenPlay.current === targetPlayAt) return;

    window.scrollTo({ top: 0, behavior: 'smooth' });

    const effectivePlayAt =
      room.playAt && room.playAt > Date.now() - 5000
        ? room.playAt
        : Date.now() + 1800;

    const remaining = Math.max(
      0,
      effectivePlayAt - Date.now() - (room.playAt ? clockOffset.current : 0),
    );

    const update = () =>
      setCountdown(
        Math.max(
          0,
          Math.ceil(
            (effectivePlayAt -
              Date.now() -
              (room.playAt ? clockOffset.current : 0)) /
              1000,
          ),
        ),
      );
    update();
    const tick = setInterval(update, 100);

    const timer = setTimeout(() => {
      seenPlay.current = targetPlayAt;
      clearInterval(tick);
      setCountdown(0);
      void scheduledPlay(0);
    }, remaining);

    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [room.playAt, room.status, scene.duration]);

  const [exportProgress, setExportProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [isPublished, setIsPublished] = useState(() =>
    Boolean(initial.recordings?.some((r) => r.player === '__published_mp4__')),
  );
  const isPublishedRef = useRef(isPublished);

  useEffect(() => {
    const alreadyPub = Boolean(room.recordings?.some((r) => r.player === '__published_mp4__'));
    if (alreadyPub) {
      setIsPublished(true);
      isPublishedRef.current = true;
    }
  }, [room.recordings]);

  // Eğer kullanıcı "Yayınla"ya basmadan sayfayı kapatır veya odadan çıkarsa Supabase'den kayıtları sil
  useEffect(() => {
    const handleUnload = () => {
      if (room.status === 'final' && !isPublishedRef.current) {
        void deleteUnpublishedRoomFromSupabase(room.code);
      }
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [room.status, room.code]);

  async function handleExitRoom() {
    if (!isPublishedRef.current) {
      await deleteUnpublishedRoomFromSupabase(room.code).catch(() => {});
    }
    onExit();
  }

  async function publishVideo() {
    if (isPublished || publishing) return;
    setError('');
    setNotice('');
    setPublishProgress(0);

    if (playing) {
      stopPlayback();
    }

    setPublishing(true);
    try {
      const ok = await loadAudio();
      if (!ok) {
        throw new Error('Ses dosyaları yüklenemedi. Lütfen "Sesleri Tekrar Yükle" butonuna basıp tekrar deneyin.');
      }

      const { generateDubbedMp4Blob } = await import('@/lib/mp4-exporter');
      const mp4Blob = await generateDubbedMp4Blob({
        room,
        scene,
        cues,
        buffers: buffers.current,
        onProgress: (pct) => {
          if (mounted.current) {
            setPublishProgress(Math.round(pct * 0.85));
          }
        },
      });

      if (mounted.current) setPublishProgress(92);

      const playersInfo = room.players.map((p) => ({
        name: p.name,
        roleName: scene.roles?.[p.role >= 0 ? p.role : 0] || 'Oyuncu',
        roleColor: getCharacterColor(p.role >= 0 ? p.role : 0, scene.roleDetails?.[p.role >= 0 ? p.role : 0]?.color),
      }));

      await publishRoomDubbingToSupabase(
        room,
        scene.title,
        scene.category,
        scene.poster,
        scene.duration,
        playersInfo,
        mp4Blob,
      );

      if (mounted.current) {
        setPublishProgress(100);
        setIsPublished(true);
        isPublishedRef.current = true;
        setNotice('Dublaj ana sayfada yayınlandı. Geçici kayıt parçaları temizlendi.');
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message || 'Yayınlama sırasında bir hata oluştu.');
      }
    } finally {
      if (mounted.current) {
        setPublishing(false);
        setPublishProgress(0);
      }
    }
  }

  async function exportVideo() {
    setError('');
    setNotice('');
    setExportProgress(0);

    if (playing) {
      stopPlayback();
    }

    setExporting(true);
    try {
      const ok = await loadAudio();
      if (!ok) {
        throw new Error('Ses dosyaları yüklenemedi. Lütfen "Sesleri Tekrar Yükle" butonuna basıp tekrar deneyin.');
      }

      const { exportDubbedMp4 } = await import('@/lib/mp4-exporter');
      await exportDubbedMp4({
        room,
        scene,
        cues,
        buffers: buffers.current,
        onProgress: (pct) => {
          if (mounted.current) {
            setExportProgress(pct);
          }
        },
      });

      if (mounted.current) {
        setNotice(`replik-${room.code}.mp4 başarıyla indirildi!`);
        setTimeout(() => {
          if (mounted.current) setNotice('');
        }, 4000);
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message || 'MP4 indirme sırasında bir hata oluştu.');
      }
    } finally {
      if (mounted.current) {
        setExporting(false);
        setExportProgress(0);
      }
    }
  }

  return (
    <section className="studio">
      <div className="studio-heading">
        <button className="text-button" onClick={handleExitRoom}>
          <ArrowLeft size={17} /> Oyun alanı
        </button>
        <div className="studio-heading-actions">
          {room.status === 'lobby' && (
            <button
              className="mic-test-btn"
              onClick={() => setMicTestOpen(true)}
            >
              <Mic size={15} />
              {me?.micTested ? (
                <span className="mic-ok-tag">
                  <Check size={12} /> Mikrofon Hazır
                </span>
              ) : (
                'Mikrofon Testi'
              )}
            </button>
          )}
          <button
            className="code-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(room.code);
                setNotice('Oda kodu kopyalandı.');
              } catch {
                setNotice(`Oda kodun: ${room.code}`);
              }
            }}
          >
            ODA <strong>{room.code}</strong>
            <Copy size={15} />
          </button>
        </div>
      </div>

      {room.status !== 'recording' && (
        <div className="section-heading">
          <div>
            <div className="eyebrow">
              {room.status === 'lobby'
                ? 'EKİP TOPLANIYOR'
                : 'BÜYÜK FİNAL'}
            </div>
            <h1 className="studio-title">{scene.title}</h1>
          </div>
          <div className="studio-header-meta">
            {room.status === 'lobby' && me.host === 1 && (
              <button
                className="change-scene-btn"
                onClick={() => setScenePickerOpen(true)}
              >
                <Film size={15} /> Sahneyi Değiştir
              </button>
            )}
            <span>
              <Users size={17} /> {room.players.length}/{room.maxPlayers || 4} oyuncu
            </span>
          </div>
        </div>
      )}

      <div
        className={`studio-grid ${room.status === 'recording' ? 'recording-stage-grid' : ''}`}
      >
        <div>
          {room.status !== 'recording' && (
            <>
              <div
                className={`video-wrap ${playing ? 'cinema-glow' : ''} ${room.status === 'final' ? 'final-video-wrap' : ''}`}
                onClick={(e) => {
                  if (room.status !== 'final') return;
                  if ((e.target as HTMLElement).closest('button')) return;
                  if (playing) {
                    stopPlayback();
                  } else {
                    playFinal(
                      playbackTime >= scene.duration ? 0 : playbackTime,
                    );
                  }
                }}
              >
                {scene.instrumental && (
                  /* oxlint-disable-next-line jsx-a11y/media-has-caption */
                  <audio
                    ref={lobbyAudio}
                    src={scene.instrumental}
                    preload="auto"
                    playsInline
                    onEnded={() => {
                      video.current?.pause();
                      setLobbyPlaying(false);
                    }}
                    style={{ display: 'none' }}
                  />
                )}
                <video
                  ref={video}
                  src={scene.video}
                  poster={scene.poster}
                  crossOrigin="anonymous"
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={() => {
                    if (video.current) video.current.currentTime = scene.start;
                  }}
                  onError={() =>
                    setError(
                      'Sahne videosu yüklenemedi. Bağlantını kontrol edip sayfayı yenile.',
                    )
                  }
                  onPause={() => {
                    if (room.status === 'lobby') {
                      lobbyAudio.current?.pause();
                      setLobbyPlaying(false);
                    }
                  }}
                  onTimeUpdate={() => {
                    if (lobbyPlaying && scene.instrumental && video.current && lobbyAudio.current &&
                        Math.abs(lobbyAudio.current.currentTime - video.current.currentTime) > 0.35) {
                      lobbyAudio.current.currentTime = video.current.currentTime;
                    }
                    if (
                      !playing &&
                      video.current &&
                      video.current.currentTime > scene.start + scene.duration
                    ) {
                      video.current.pause();
                      lobbyAudio.current?.pause();
                      setLobbyPlaying(false);
                    }
                  }}
                />

                {room.status === 'lobby' && (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const v = video.current;
                      if (!v) return;
                      const backing = scene.instrumental ? lobbyAudio.current : null;
                      if (lobbyPlaying) {
                        v.pause();
                        backing?.pause();
                        setLobbyPlaying(false);
                      } else {
                        try {
                          v.pause();
                          backing?.pause();
                          v.currentTime = scene.start;
                          // A previous original-audio preview may have unmuted
                          // this same video element. Never play both tracks.
                          v.muted = Boolean(backing);
                          if (backing) {
                            backing.currentTime = scene.start;
                            backing.volume = 1;
                          }
                          await v.play();
                          if (backing) await backing.play();
                          setError('');
                          setLobbyPlaying(true);
                        } catch {
                          v.pause();
                          backing?.pause();
                          setLobbyPlaying(false);
                          setError('Sahne sesi oynatılamadı. Sayfayı yenileyip tekrar deneyin.');
                        }
                      }
                    }}
                    className="studio-preview-button"
                  >
                    {lobbyPlaying ? <Pause size={15} /> : <Volume2 size={15} />}
                    {lobbyPlaying
                      ? 'Önizlemeyi Durdur'
                      : scene.instrumental
                        ? 'Sahneyi Dinle (Vokalsiz Efektli)'
                        : 'Sahneyi Önizle'}
                  </button>
                )}

                {/* Tarayıcı otomatik oynatmayı engellediğinde çıkan uyarı */}
                {autoplayPrompt && (
                  <button
                    type="button"
                    className="autoplay-prompt-banner"
                    onClick={(e) => {
                      e.stopPropagation();
                      playFinal(
                        playbackTime >= scene.duration ? 0 : playbackTime,
                      );
                    }}
                  >
                    <Volume2 size={20} className="pulse-icon" />
                    <div className="autoplay-prompt-info">
                      <strong>Dublajı oynat</strong>
                      <span>Tarayıcın otomatik başlatmayı durdurdu.</span>
                    </div>
                  </button>
                )}

                {/* Finalde Videonun Üzerindeki Büyük Oynat Butonu */}
                {room.status === 'final' && !playing && countdown === 0 && (
                  <div
                    className="final-big-play-overlay"
                    onClick={(e) => {
                      e.stopPropagation();
                      playFinal(
                        playbackTime >= scene.duration ? 0 : playbackTime,
                      );
                    }}
                  >
                    <div className="final-big-play-btn">
                      {audioLoading ? (
                        <Loader2 className="animate-spin" size={44} />
                      ) : (
                        <Play size={44} fill="#141511" />
                      )}
                    </div>
                    <span className="final-big-play-label">
                      {audioLoading
                        ? 'Dublaj Sesleri Hazırlanıyor…'
                        : playbackTime > 0 && playbackTime < scene.duration
                          ? 'Kaldığı Yerden Devam Et'
                          : 'Dublajı Oynat'}
                    </span>
                  </div>
                )}

                {/* Senkronize Dublaj Altyazısı (Birden fazla karakter aynı anda konuşabilir) */}
                {subtitlesVisible && activeSubtitle.length > 0 && (
                  <div className="final-subtitle-overlay">
                    {activeSubtitle.map((sub, subIdx) => (
                      <div key={subIdx} className="final-subtitle-entry" style={activeSubtitle.length > 1 ? { borderLeft: `3px solid ${sub.roleColor}`, paddingLeft: '8px', marginBottom: '4px' } : undefined}>
                        <span className="final-char-badge" style={activeSubtitle.length > 1 ? { color: sub.roleColor } : undefined}>
                          {sub.roleName} ({sub.playerName})
                        </span>
                        <p className="final-subtitle-line">
                          “{sub.text}”
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {countdown > 0 && (
                  <div className="countdown">
                    {countdown}
                    <span>Final başlıyor…</span>
                  </div>
                )}
              </div>

              {/* Final Video Kontrol Çubuğu */}
              {room.status === 'final' && (
                <div className="final-controls-bar">
                  <button
                    type="button"
                    className="final-ctrl-btn play-pause-btn"
                    onClick={() =>
                      playing
                        ? stopPlayback()
                        : playFinal(
                            playbackTime >= scene.duration ? 0 : playbackTime,
                          )
                    }
                    title={playing ? 'Durdur' : 'Oynat'}
                  >
                    {playing ? (
                      <Pause size={18} />
                    ) : (
                      <Play size={18} fill="currentColor" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="final-ctrl-btn replay-btn"
                    onClick={() => {
                      stopPlayback();
                      if (video.current)
                        video.current.currentTime = scene.start;
                      setPlaybackTime(0);
                      playFinal(0);
                    }}
                    title="Baştan Oynat"
                  >
                    <RotateCcw size={16} />
                  </button>
                  <div className="final-scrubber-container">
                    <input
                      type="range"
                      min={0}
                      max={scene.duration}
                      step={0.1}
                      value={playbackTime}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setPlaybackTime(val);
                        if (video.current)
                          video.current.currentTime = scene.start + val;
                        if (playing) playFinal(val);
                      }}
                      className="final-scrubber-slider"
                    />
                    <div className="final-timer-badge">
                      <span>{formatTimecode(playbackTime)}</span>
                      <span className="timer-sep">/</span>
                      <span>{formatTimecode(scene.duration)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="final-ctrl-btn mute-btn"
                    onClick={() => setIsMuted(!isMuted)}
                    title={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
                  >
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <button
                    type="button"
                    className={`final-ctrl-btn ${subtitlesVisible ? 'subtitles-on' : ''}`}
                    onClick={() => setSubtitlesVisible((visible) => !visible)}
                    aria-label={subtitlesVisible ? 'Altyazıyı kapat' : 'Altyazıyı aç'}
                    aria-pressed={subtitlesVisible}
                    title={subtitlesVisible ? 'Altyazıyı kapat' : 'Altyazıyı aç'}
                  >
                    <Captions size={19} />
                  </button>
                </div>
              )}
            </>
          )}

          {/* Final Ekranında Reaksiyon Çubuğu */}
          {room.status === 'final' && (
            <div className="final-reactions-bar">
              <span className="reactions-title">BU DUBLAJA REAKSİYON VER:</span>
              <div className="reaction-buttons-row">
                {[
                  { emoji: '😂', label: 'Kahkaha' },
                  { emoji: '🔥', label: 'Ateş' },
                  { emoji: '👏', label: 'Alkış' },
                  { emoji: '❤️', label: 'Sevdim' },
                ].map(({ emoji, label }) => (
                  <button
                    key={emoji}
                    type="button"
                    className="reaction-badge-btn"
                    onClick={() => act('reaction', { emoji })}
                  >
                    <span className="reaction-badge-count">
                      {room.reactions?.[emoji] || 0}
                    </span>
                    <span className="reaction-badge-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {room.status === 'recording' && (
            <SegmentRecorder
              room={room}
              session={session}
              onRoom={receiveRoom}
              customScenes={customScenes}
            />
          )}

          {/* Jenerik / Seslendirenler Kadrosu */}
          {room.status === 'final' && (
            <div className="cast-credits-box">
              <h3>DUBLAJ KADROSU</h3>
              <div className="cast-grid">
                {room.players.map((p, i) => {
                  const roleIdx = p.role >= 0 ? p.role : i % scene.roles.length;
                  const roleDetail = scene.roleDetails[roleIdx];
                  return (
                    <div key={p.id} className="cast-card">
                      <div className="cast-avatar">
                        {p.name[0].toLocaleUpperCase('tr')}
                      </div>
                      <div className="cast-info">
                        <strong>{p.name}</strong>
                        <span>
                          {roleDetail?.name || scene.roles[roleIdx]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {room.status === 'recording' ? (
          (() => {
            const preferredRoles = room.players.map((p) => p.role);
            const playerStats = room.players.map((p, pIdx) => {
              const assigned = playerCues(
                room.scene,
                pIdx,
                room.players.length,
                customScenes,
                preferredRoles,
              );
              const total = Math.max(1, assigned.length);
              const done = assigned.filter((c) => p.segments?.includes(c.id)).length;
              const pct = Math.min(100, Math.round((done / total) * 100));
              const isDone = (assigned.length > 0 && done >= assigned.length) || p.ready === 1;
              const roleNames = Array.from(
                new Set(assigned.map((c) => c.roleName).filter(Boolean)),
              );
              const roleLabel =
                roleNames.join(' + ') ||
                scene.roles?.[p.role >= 0 ? p.role : pIdx] ||
                `${pIdx + 1}. Karakter`;
              return {
                player: p,
                pIdx,
                assigned,
                total,
                done,
                pct,
                isDone,
                roleLabel,
              };
            });
            const totalCuesSum = playerStats.reduce((acc, s) => acc + s.total, 0);
            const totalDoneSum = playerStats.reduce((acc, s) => acc + s.done, 0);
            const roomPct =
              totalCuesSum > 0 ? Math.min(100, Math.round((totalDoneSum / totalCuesSum) * 100)) : 0;
            const slotPalette = ['#F5E636', '#FF6B4A', '#D4C2FC', '#FFD166'];

            return (
              <aside
                aria-label="Oyuncu replik tamamlanma barı"
                style={{
                  background: '#11110e',
                  border: '2px solid #282821',
                  borderRadius: '20px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '6px',
                    borderBottom: '1.5px solid #22221c',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 900,
                      letterSpacing: '0.08em',
                      color: '#A0A096',
                      fontFamily: 'var(--font-technical)',
                    }}
                  >
                    OYUNCU İLERLEME BARI
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 950,
                      fontFamily: 'var(--font-technical)',
                      background: roomPct === 100 ? '#7BF1A8' : '#F5E636',
                      color: '#090909',
                      border: '1.5px solid #090909',
                      borderRadius: '6px',
                      padding: '2px 7px',
                    }}
                  >
                    %{roomPct}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {playerStats.map(({ player: p, pIdx, total, done, pct, isDone, roleLabel }) => {
                    const baseColor = slotPalette[pIdx % slotPalette.length];
                    const activeColor = isDone ? '#7BF1A8' : baseColor;
                    const isMe = p.id === me.id;
                    const segmentBlocks = Math.min(10, Math.max(2, total));

                    return (
                      <div
                        key={p.id}
                        style={{
                          background: isDone ? '#14221a' : '#181814',
                          border: `2px solid ${isDone ? '#7BF1A8' : '#090909'}`,
                          boxShadow: '4px 4px 0 #090909',
                          borderRadius: '14px',
                          padding: '11px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                width: '26px',
                                height: '26px',
                                borderRadius: '7px',
                                background: activeColor,
                                color: '#090909',
                                border: '1.5px solid #090909',
                                display: 'grid',
                                placeItems: 'center',
                                fontSize: '12px',
                                fontWeight: 950,
                                flexShrink: 0,
                              }}
                            >
                              {p.name[0]?.toLocaleUpperCase('tr') || '?'}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: '13.5px',
                                  fontWeight: 950,
                                  color: '#F4F4E9',
                                  letterSpacing: '-0.02em',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {p.name}
                                {isMe ? ' (Sen)' : ''}
                              </div>
                              <div
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 700,
                                  color: '#9e9e93',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {roleLabel}
                              </div>
                            </div>
                          </div>

                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 950,
                              fontFamily: 'var(--font-technical)',
                              padding: '3px 7px',
                              borderRadius: '6px',
                              background: '#090909',
                              color: activeColor,
                              border: `1.5px solid ${activeColor}`,
                              flexShrink: 0,
                            }}
                          >
                            {isDone ? 'TAMAM ✓' : `${done}/${total}`}
                          </span>
                        </div>

                        {/* Maksimalist Bento Parçalı İlerleme Barı */}
                        <div
                          style={{
                            position: 'relative',
                            height: '16px',
                            borderRadius: '7px',
                            background: '#090909',
                            border: '1.5px solid #090909',
                            padding: '2px',
                            display: 'grid',
                            gridTemplateColumns: `repeat(${segmentBlocks}, minmax(0, 1fr))`,
                            gap: '2px',
                            overflow: 'hidden',
                          }}
                        >
                          {Array.from({ length: segmentBlocks }).map((_, bIdx) => {
                            const blockThreshold = ((bIdx + 1) / segmentBlocks) * 100;
                            const blockHalf = ((bIdx + 0.35) / segmentBlocks) * 100;
                            const filled = pct >= blockThreshold || (done > 0 && pct >= blockHalf);
                            return (
                              <span
                                key={bIdx}
                                style={{
                                  borderRadius: '3px',
                                  background: filled ? activeColor : '#23231e',
                                  transition: 'background 0.22s ease',
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </aside>
            );
          })()
        ) : (
        <aside className="room-card studio-panel">
          {room.status === 'lobby' ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '20px' }}>
                  {room.maxPlayers === 1 ? 'Solo Oda' : 'Oyuncular'}
                </h2>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#A0A096',
                    background: '#1c1c1c',
                    border: '1px solid #2a2a2a',
                    padding: '4px 10px',
                    borderRadius: '999px',
                  }}
                >
                  {room.players.length}/{room.maxPlayers || 4}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '12px',
                  marginBottom: '16px',
                }}
              >
                {Array.from({
                  length: Math.max(room.players.length, room.maxPlayers || 1),
                }).map((_, slotIdx) => {
                  const p = room.players[slotIdx];
                  const waitingColors = ['#F5E636', '#D4C2FC', '#FFD166', '#A8DADC'];
                  const readyColors = ['#7BF1A8', '#FF6B4A', '#7BF1A8', '#FF6B4A'];

                  if (!p) {
                    return (
                      <div
                        key={`empty-slot-${slotIdx}`}
                        style={{
                          aspectRatio: '1 / 1',
                          minHeight: '136px',
                          borderRadius: '18px',
                          border: '2.5px dashed #32322b',
                          background: '#141412',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          padding: '14px',
                          color: '#6e6e66',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            right: '10px',
                            bottom: '-8px',
                            fontSize: '54px',
                            fontWeight: 950,
                            color: 'rgba(255,255,255,0.04)',
                            lineHeight: 1,
                            pointerEvents: 'none',
                          }}
                        >
                          0{slotIdx + 1}
                        </span>
                        <Users size={22} />
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 900,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            textAlign: 'center',
                          }}
                        >
                          KOLTUK BOŞ
                        </span>
                      </div>
                    );
                  }

                  const isMe = p.id === me.id;
                  const isReady = Boolean(p.ready);
                  const bg = isReady
                    ? readyColors[slotIdx % readyColors.length]
                    : waitingColors[slotIdx % waitingColors.length];

                  return (
                    <div
                      key={p.id}
                      role={isMe ? 'button' : undefined}
                      tabIndex={isMe ? 0 : undefined}
                      onClick={() => {
                        if (isMe && !busy) {
                          act('ready', { ready: !me.ready });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (isMe && !busy && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          act('ready', { ready: !me.ready });
                        }
                      }}
                      title={isMe ? 'Hazır durumunu değiştirmek için tıkla' : undefined}
                      style={{
                        aspectRatio: '1 / 1',
                        minHeight: '136px',
                        borderRadius: '18px',
                        border: '2.5px solid #090909',
                        background: bg,
                        color: '#090909',
                        boxShadow: isReady ? '6px 6px 0 #090909' : '3px 3px 0 #090909',
                        transform: isReady
                          ? 'translateY(-4px) rotate(-1.5deg)'
                          : 'translateY(0) rotate(0deg)',
                        transition:
                          'background-color 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.28s ease',
                        padding: '13px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        position: 'relative',
                        overflow: 'hidden',
                        cursor: isMe ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      {/* Arka plan dev sıra numarası */}
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          right: '6px',
                          bottom: '16px',
                          fontSize: '64px',
                          fontWeight: 950,
                          letterSpacing: '-0.08em',
                          lineHeight: 0.85,
                          color: 'rgba(9, 9, 9, 0.08)',
                          pointerEvents: 'none',
                        }}
                      >
                        0{slotIdx + 1}
                      </span>

                      {/* Üst Satır: Harf Avatarı + Hazır/Bekliyor Rozeti */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '6px',
                          position: 'relative',
                          zIndex: 1,
                        }}
                      >
                        <span
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '11px',
                            background: '#090909',
                            color: bg,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '17px',
                            fontWeight: 950,
                            flexShrink: 0,
                            transform: isReady ? 'rotate(6deg) scale(1.06)' : 'none',
                            transition: 'transform 0.25s ease, color 0.25s ease',
                          }}
                        >
                          {p.name[0]?.toLocaleUpperCase('tr') || '?'}
                        </span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '5px 9px',
                            borderRadius: '999px',
                            fontSize: '10px',
                            fontWeight: 950,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            background: isReady ? '#090909' : '#141412',
                            color: isReady ? '#7BF1A8' : '#F5E636',
                            border: '2px solid #090909',
                            transform: isReady ? 'scale(1.05)' : 'scale(1)',
                            transition: 'all 0.25s ease',
                          }}
                        >
                          {isReady ? (
                            <>
                              <Check size={12} strokeWidth={3.5} /> HAZIR
                            </>
                          ) : (
                            'BEKLİYOR'
                          )}
                        </span>
                      </div>

                      {/* Alt Satır: Oyuncu Rolü ve İsmi */}
                      <div style={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 900,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            opacity: 0.78,
                            marginBottom: '2px',
                          }}
                        >
                          {p.host === 1 ? 'KURUCU' : 'OYUNCU'}
                          {isMe ? ' · SEN' : ''}
                        </div>
                        <div
                          style={{
                            fontSize: '19px',
                            fontWeight: 950,
                            letterSpacing: '-0.045em',
                            lineHeight: 1.05,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="lobby-action-buttons">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => act('ready', { ready: !me.ready })}
                  style={{
                    backgroundColor: me.ready ? '#7BF1A8' : '#1c1c18',
                    color: me.ready ? '#090909' : '#F4F4E9',
                    borderColor: me.ready ? '#090909' : '#383830',
                    fontWeight: 900,
                    transition: 'all 0.22s ease',
                  }}
                >
                  {me.ready ? 'Hazırım (İptal)' : 'Hazırım'} <Check size={17} />
                </button>

                {(() => {
                  const requiredPlayers = Math.max(1, room.maxPlayers || 1);
                  const missingPlayers = Math.max(0, requiredPlayers - room.players.length);
                  const allPlayersPresent = room.players.length >= requiredPlayers;
                  const allPlayersReady =
                    allPlayersPresent && room.players.every((p) => p.ready);

                  if (me.host === 1) {
                    return (
                      <button
                        className="primary"
                        disabled={busy || !allPlayersReady}
                        onClick={() => act('start')}
                        style={
                          !allPlayersReady
                            ? {
                                background: '#1c1c18',
                                color: '#8a8a7e',
                                borderColor: '#2e2e27',
                                cursor: 'not-allowed',
                                opacity: 1,
                              }
                            : undefined
                        }
                      >
                        {missingPlayers > 0
                          ? `${missingPlayers} oyuncu daha bekleniyor (${room.players.length}/${requiredPlayers})`
                          : !allPlayersReady
                            ? 'Herkesin hazır olması bekleniyor'
                            : requiredPlayers === 1
                              ? 'Başlat'
                              : 'Rolleri dağıt ve başlat'}{' '}
                        {allPlayersReady && <Play size={17} />}
                      </button>
                    );
                  }
                  return (
                    <p className="microcopy">
                      {missingPlayers > 0
                        ? `${missingPlayers} oyuncu daha bekleniyor (${room.players.length}/${requiredPlayers})`
                        : 'Kurucu oyunu başlatacak.'}
                    </p>
                  );
                })()}
              </div>
            </>
          ) : (
            <>
              <div className="small-icon">
                <Volume2 />
              </div>
              <h2>Final hazır</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                {room.players.map((p, pIdx) => {
                  const tileColors = ['#F5E636', '#FF6B4A', '#B8E6C1', '#D4C2FC'];
                  const bg = tileColors[pIdx % tileColors.length];
                  return (
                    <div
                      key={p.id}
                      style={{
                        aspectRatio: '1 / 1',
                        minHeight: '100px',
                        borderRadius: '14px',
                        border: '2px solid #090909',
                        background: bg,
                        color: '#090909',
                        boxShadow: '0 3px 0 #090909',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            background: '#090909',
                            color: bg,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '13px',
                            fontWeight: 950,
                          }}
                        >
                          {p.name[0]?.toLocaleUpperCase('tr') || '?'}
                        </span>
                        {p.ready ? <Check size={16} strokeWidth={3} /> : <span className="waiting-dot" />}
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 950, letterSpacing: '-0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Ana Dublaj Oynat/Durdur Butonu */}
              <button
                className={`primary final-main-play-btn ${playing ? 'is-playing' : ''}`}
                disabled={busy || exporting || countdown > 0}
                onClick={() =>
                  playing
                    ? stopPlayback()
                    : playFinal(
                        playbackTime >= scene.duration ? 0 : playbackTime,
                      )
                }
              >
                {playing ? (
                  <>
                    <Pause size={18} /> Dublajı Durdur
                  </>
                ) : (
                  <>
                    <Play size={18} fill="currentColor" /> Dublajı Oynat
                  </>
                )}
              </button>

              {/* Odadaki Herkes İçin Senkronize Birlikte İzle Butonu */}
              <button
                className="secondary sync-play-btn"
                disabled={busy || playing || exporting || countdown > 0}
                onClick={() => act('play')}
              >
                <Users size={16} />
                {room.playAt
                  ? 'Odadaki Herkesle Beraber Tekrar İzle'
                  : 'Odadaki Herkesle Beraber Başlat (3 sn)'}
              </button>

              {/* Ses Durumu / Yenileme */}
              <button
                className="secondary"
                disabled={busy || exporting || playing}
                onClick={prepare}
              >
                {audioLoaded
                  ? 'Sesler Yüklendi ✓'
                  : 'Sesleri Tekrar Yükle'}
                <Headphones size={17} />
              </button>

              {/* Dublaj Akışında Yayınla Butonu */}
              <button
                className={isPublished ? 'secondary publish-btn is-published' : 'secondary publish-btn'}
                disabled={publishing || exporting || playing || countdown > 0}
                onClick={
                  isPublished
                    ? () => {
                        window.location.href = '/dublajlar';
                      }
                    : publishVideo
                }
              >
                {publishing ? (
                  <>
                    <Loader2 size={17} className="spin-icon" />
                    Dublaj Akışında Yayınlanıyor… %{publishProgress}
                  </>
                ) : isPublished ? (
                  <>
                    <Check size={17} />
                    Yayınlandı! (Dublaj Akışına Git)
                  </>
                ) : (
                  <>
                    <Globe size={17} />
                    Dublaj Akışında Yayınla
                  </>
                )}
              </button>

              {/* Video İndirme (MP4) */}
              <button
                className="secondary"
                disabled={exporting || publishing || playing || countdown > 0}
                onClick={exportVideo}
              >
                {exporting ? (
                  <>
                    <Loader2 size={17} className="spin-icon" />
                    MP4 Hazırlanıyor… %{exportProgress}
                  </>
                ) : (
                  <>
                    <Download size={17} />
                    Dublajı MP4 olarak indir
                  </>
                )}
              </button>

              {!isPublished && (
                <button
                  className="secondary"
                  disabled={publishing || exporting}
                  onClick={handleExitRoom}
                  style={{
                    borderColor: '#FA5636',
                    color: '#FA5636',
                  }}
                >
                  <Trash2 size={16} />
                  Yayınlamadan Sil ve Çık
                </button>
              )}

              <p
                className="microcopy"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 10,
                  padding: '8px 11px',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                }}
              >
                {isPublished
                  ? 'Dublaj sosyal akışta (/dublajlar) yayınlandı. Geçici ses parçaları temizlendi.'
                  : 'Yayınlarsan video Dublaj Akışı sayfasında görünür, beğenilip yorum alabilir.'}
              </p>

              {/* Yeniden Oyna / Yeni Sahne Butonu (Aynı Ekiple) */}
              {me.host === 1 && (
                <div className="restart-section">
                  <button
                    className="primary restart-btn"
                    onClick={() => setScenePickerOpen(true)}
                  >
                    <Film size={17} /> Yeni Sahneyle Yeniden Oyna <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </>
          )}

          {busy && <p className="microcopy">Bir saniye…</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <output className="notice">{notice}</output>}
        </aside>
        )}
      </div>

      {/* Diyaloglar */}
      <MicTestDialog
        open={micTestOpen}
        onOpenChange={setMicTestOpen}
        onComplete={() => act('mic_tested')}
      />

      <RoleRevealDialog
        open={roleRevealOpen}
        room={room}
        playerId={session.id}
        customScenes={customScenes}
        onStart={() => setRoleRevealOpen(false)}
      />

      <ScenePickerDialog
        open={scenePickerOpen}
        currentScene={room.scene}
        onOpenChange={setScenePickerOpen}
        onSelectScene={(sceneId) => {
          if (room.status === 'final') {
            act('restart', { scene: sceneId });
          } else {
            act('change_scene', { scene: sceneId });
          }
        }}
      />
    </section>
  );
}
