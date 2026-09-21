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
} from 'lucide-react';
import SegmentRecorder from './segment-recorder';
import MicTestDialog from '@/components/mic-test-dialog';
import RoleRevealDialog from '@/components/role-reveal-dialog';
import ScenePickerDialog from '@/components/scene-picker-dialog';
import {
  sceneCues,
  playerCues,
  timeLabel,
  getSceneById,
  getCustomScenes,
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
} from '@/lib/game-service';

export type Session = { code: string; token: string; id: string };

export async function request(path: string, token?: string, body?: unknown) {
  try {
    // 1. Oda oluşturma: POST /api/rooms
    if (path === '/api/rooms' && body && typeof body === 'object') {
      const b = body as { name: string; scene: number; maxPlayers?: number };
      return await createGameRoom(b.name, b.scene, b.maxPlayers ?? 4);
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
    [micTestOpen, setMicTestOpen] = useState(false),
    [scenePickerOpen, setScenePickerOpen] = useState(false),
    [roleRevealOpen, setRoleRevealOpen] = useState(false),
    [autoplayPrompt, setAutoplayPrompt] = useState(false),
    [playbackTime, setPlaybackTime] = useState(0),
    [activeSubtitle, setActiveSubtitle] = useState<{
      roleName: string;
      playerName: string;
      roleColor: string;
      text: string;
    } | null>(null);

  const video = useRef<HTMLVideoElement>(null),
    ctx = useRef<AudioContext | null>(null),
    masterGain = useRef<GainNode | null>(null),
    buffers = useRef<Map<string, AudioBuffer>>(new Map()),
    sources = useRef<AudioBufferSourceNode[]>([]),
    seenPlay = useRef(0),
    playStop = useRef<ReturnType<typeof setTimeout> | null>(null),
    exportStop = useRef<ReturnType<typeof setTimeout> | null>(null),
    exportRecorder = useRef<MediaRecorder | null>(null),
    frame = useRef(0),
    mounted = useRef(true),
    subtitleInterval = useRef<ReturnType<typeof setInterval> | null>(null),
    prevStatus = useRef(initial.status);

  const clockOffset = useRef(0);
  useEffect(() => {
    clockOffset.current = initial.serverNow - Date.now();
  }, [initial.serverNow]);

  const [customScenes, setCustomScenes] = useState<Scene[]>(() => {
    if (typeof window !== 'undefined') return getCustomScenes();
    return [];
  });
  useEffect(() => {
    void getScenesFromSupabase().then((sc) => {
      if (sc && sc.length > 0) setCustomScenes(sc);
    });
  }, []);

  const scene = getSceneById(room.scene, customScenes),
    me = room.players.find((p) => p.id === session.id)!,
    slotDuration = scene.duration / Math.max(1, room.players.length),
    cues = sceneCues(room.scene, customScenes);

  const api = `/api/rooms/${session.code}`;

  // Karakter tanıtım kartını oyun başlangıcında göster
  useEffect(() => {
    if (prevStatus.current === 'lobby' && room.status === 'recording') {
      setRoleRevealOpen(true);
    }
    prevStatus.current = room.status;
  }, [room.status]);

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

      // Sahnenin insan sesleri temizlenmiş enstrümantal / M&E parçasını preload et
      if (scene.instrumental && !buffers.current.has('__scene_instrumental__')) {
        try {
          const r = await fetch(scene.instrumental);
          if (r.ok) {
            const buf = await r.arrayBuffer();
            if (buf.byteLength > 0 && ctx.current) {
              const decoded = await ctx.current.decodeAudioData(buf);
              buffers.current.set('__scene_instrumental__', decoded);
            }
          }
        } catch (instErr) {
          console.warn('Sahne arka plan müziği yükleme uyarısı:', instErr);
        }
      }

      await Promise.all(
        room.players.flatMap((p) => {
          const tracks = p.segments.length
            ? p.segments.map((id) => ({
                key: `${p.id}:${id}`,
                segment: id,
                playerId: p.id,
                fallbackUrl: `${api}/audio/${p.id}?segment=${id}`,
              }))
            : [{ key: p.id, segment: null, playerId: p.id, fallbackUrl: `${api}/audio/${p.id}` }];
          return tracks.map(async (track) => {
            if (buffers.current.has(track.key)) return;
            try {
              let audioUrl = await getAudioRecordingUrl(session.code, track.playerId, track.segment);
              if (!audioUrl) audioUrl = track.fallbackUrl;

              const r = await fetch(audioUrl, {
                headers: audioUrl.startsWith('http') && !audioUrl.includes('/api/rooms')
                  ? {}
                  : { Authorization: `Bearer ${session.token}` },
              });
              if (!r.ok) return;
              const buf = await r.arrayBuffer();
              if (buf.byteLength === 0) return;
              const decoded = await ctx.current!.decodeAudioData(buf);
              buffers.current.set(track.key, decoded);
            } catch (err) {
              console.warn('Track load warning:', track.key, err);
            }
          });
        }),
      );
      setAudioLoaded(true);
      return true;
    } catch (e) {
      console.warn('Audio preload warning:', e);
      return false;
    } finally {
      setAudioLoading(false);
    }
  }

  useEffect(() => {
    if (room.status === 'final') {
      void loadAudio();
    }
  }, [room.status]);

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
    const refresh = async () => {
      try {
        const before = Date.now();
        const d = await request(api, session.token);
        if (mounted.current) {
          clockOffset.current = d.room.serverNow - (before + Date.now()) / 2;
          setRoom(d.room);
        }
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
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
      setRoom(d.room);
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
    setActiveSubtitle(null);
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

      if (buffers.current.size === 0) {
        await loadAudio();
      }

      const audio = ctx.current;

      // Master Gain Setup
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
        if (scene.instrumental) {
          const instBuffer = buffers.current.get('__scene_instrumental__');
          if (instBuffer) {
            const instSource = audio.createBufferSource();
            instSource.buffer = instBuffer;
            const instGain = audio.createGain();
            // Arka plan müziğinin ses seviyesini oyuncuların seslerinin arkasında dengeli tutmak için 0.75 gain
            instGain.gain.setValueAtTime(0.75, audio.currentTime);
            instSource.connect(instGain);
            instGain.connect(masterGain.current);
            const instDuration = Math.max(0, Math.min(instBuffer.duration - late, scene.duration - late));
            if (instDuration > 0) {
              instSource.start(now, late, instDuration);
              sources.current.push(instSource);
            }
          }
        }

        // 2. Oyuncuların mikrofondan kaydettiği dublaj parçaları
        room.players.forEach((p, i) => {
          const tracks = p.segments.length
            ? sceneCues(room.scene, customScenes)
                .filter((c) => p.segments.includes(c.id))
                .map((c) => ({
                  key: `${p.id}:${c.id}`,
                  at: c.start,
                  length: c.end - c.start,
                }))
            : [{ key: p.id, at: i * slotDuration, length: slotDuration }];

          tracks.forEach((track) => {
            const buffer = buffers.current.get(track.key);
            if (!buffer) return;
            const skip = Math.max(0, late - track.at),
              duration = Math.min(buffer.duration, track.length) - skip;
            if (duration <= 0) return;
            const source = audio.createBufferSource();
            source.buffer = buffer;
            source.connect(masterGain.current!);
            source.start(now + Math.max(0, track.at - late), skip, duration);
            sources.current.push(source);
          });
        });
      }

      // Senkronize Altyazı ve İlerleme Takibi
      if (subtitleInterval.current) clearInterval(subtitleInterval.current);
      subtitleInterval.current = setInterval(() => {
        if (!v || !mounted.current) return;
        const t = v.currentTime - scene.start;
        setPlaybackTime(Math.max(0, Math.min(t, scene.duration)));
        const active = cues.find((c) => t >= c.start && t < c.end);
        if (active) {
          const playerIdx = active.id % room.players.length;
          const player = room.players[playerIdx];
          setActiveSubtitle({
            roleName: active.roleName,
            playerName: player ? player.name : 'Oyuncu',
            roleColor: active.roleColor,
            text: active.text,
          });
        } else {
          setActiveSubtitle(null);
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
    if (
      room.status !== 'final' ||
      !room.playAt ||
      seenPlay.current === room.playAt
    )
      return;

    const remaining = room.playAt - Date.now() - clockOffset.current;
    if (remaining < -scene.duration * 1000) {
      seenPlay.current = room.playAt;
      return;
    }

    const update = () =>
      setCountdown(
        Math.max(
          0,
          Math.ceil((room.playAt - Date.now() - clockOffset.current) / 1000),
        ),
      );
    update();
    const tick = setInterval(update, 100);

    const timer = setTimeout(
      () => {
        seenPlay.current = room.playAt;
        clearInterval(tick);
        setCountdown(0);
        scheduledPlay(
          Math.max(0, (Date.now() + clockOffset.current - room.playAt) / 1000),
        ).catch(() => {
          setAutoplayPrompt(true);
        });
      },
      Math.max(0, remaining),
    );

    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [room.playAt, room.status, scene.duration]);

  async function exportVideo() {
    setError('');
    if (!window.MediaRecorder) {
      setError('Bu tarayıcı video indirmeyi desteklemiyor. Chrome ile dene.');
      return;
    }
    if (buffers.current.size === 0) {
      const ok = await loadAudio();
      if (!ok) {
        setError('Ses dosyaları yüklenemedi. Sayfayı yenileyip tekrar dene.');
        return;
      }
    }
    setExporting(true);
    let captured: MediaStream | undefined;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 854;
      canvas.height = 480;
      const paint = canvas.getContext('2d')!;
      captured = canvas.captureStream(25);
      const mix = ctx.current!.createMediaStreamDestination();
      mix.stream.getAudioTracks().forEach((t) => captured!.addTrack(t));
      const type = [
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!type)
        throw new Error(
          'Bu tarayıcı video çıktısını desteklemiyor. Chrome ile dene.',
        );
      const output = new MediaRecorder(captured, { mimeType: type });
      exportRecorder.current = output;
      const chunks: BlobPart[] = [];
      output.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      output.onstop = () => {
        cancelAnimationFrame(frame.current);
        captured?.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        const url = URL.createObjectURL(new Blob(chunks, { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `replik-${room.code}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setExporting(false);
      };
      const draw = () => {
        paint.drawImage(video.current!, 0, 0, 854, 480);
        paint.fillStyle = '#0009';
        paint.fillRect(0, 445, 854, 35);
        paint.fillStyle = '#fff';
        paint.font = '12px Arial';
        paint.fillText(
          'Replik · Dublaj.io Deneyimi · Sesler oyunculara aittir.',
          14,
          467,
        );
        frame.current = requestAnimationFrame(draw);
      };
      await playFinal(0, mix);
      draw();
      output.start();
      exportStop.current = setTimeout(() => {
        if (output.state === 'recording') output.stop();
      }, scene.duration * 1000);
    } catch (e) {
      captured?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(frame.current);
      setError((e as Error).message);
      setExporting(false);
    }
  }

  return (
    <section className="studio">
      <div className="studio-heading">
        <button className="text-button" onClick={onExit}>
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

      <div className="section-heading">
        <div>
          <div className="eyebrow">
            {room.status === 'lobby'
              ? 'EKİP TOPLANIYOR'
              : room.status === 'recording'
                ? 'KAYITTAYIZ'
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

      <div className="studio-grid">
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
                <video
                  ref={video}
                  src={scene.video}
                  poster={scene.poster}
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
                  onTimeUpdate={() => {
                    if (
                      !playing &&
                      video.current &&
                      video.current.currentTime > scene.start + scene.duration
                    )
                      video.current.pause();
                  }}
                />

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
                      <strong>Dublajı Sesli Başlatmak İçin Tıkla ▶</strong>
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

                {/* Senkronize Dublaj Altyazısı */}
                {activeSubtitle && (
                  <div className="final-subtitle-overlay">
                    <span
                      className="final-char-badge"
                      style={{ backgroundColor: activeSubtitle.roleColor }}
                    >
                      {activeSubtitle.roleName} ({activeSubtitle.playerName})
                    </span>
                    <p className="final-subtitle-line">
                      “{activeSubtitle.text}”
                    </p>
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
                      <span>{timeLabel(playbackTime)}</span>
                      <span className="timer-sep">/</span>
                      <span>{timeLabel(scene.duration)}</span>
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
                    <span className="reaction-badge-emoji">{emoji}</span>
                    <span className="reaction-badge-count">
                      {room.reactions?.[emoji] || 0}
                    </span>
                    <span className="reaction-badge-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {room.status === 'recording' ? (
            <SegmentRecorder room={room} session={session} onRoom={setRoom} />
          ) : (
            <div className="timeline">
              {sceneCues(room.scene, customScenes).map((c) => (
                <div key={c.id}>
                  <span style={{ color: c.roleColor }}>{c.roleName}</span>
                  <strong>{timeLabel(c.start)}</strong>
                  <span>Bitiş {timeLabel(c.end)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Jenerik / Seslendirenler Kadrosu */}
          {room.status === 'final' && (
            <div className="cast-credits-box">
              <h3>🎙️ DUBLAJ KADROSU</h3>
              <div className="cast-grid">
                {room.players.map((p, i) => {
                  const roleIdx = p.role >= 0 ? p.role : i % scene.roles.length;
                  const roleDetail = scene.roleDetails[roleIdx];
                  return (
                    <div key={p.id} className="cast-card">
                      <div
                        className="cast-avatar"
                        style={{ borderColor: roleDetail?.color || '#d8fb51' }}
                      >
                        {p.name[0].toLocaleUpperCase('tr')}
                      </div>
                      <div className="cast-info">
                        <strong>{p.name}</strong>
                        <span style={{ color: roleDetail?.color || '#d8fb51' }}>
                          {roleDetail?.name || scene.roles[roleIdx]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="credit">
            Sahne: <strong>{scene.title}</strong> · {scene.category} · Orijinal ses kapalı; replikler oyuncuların doğaçlamasıdır.
          </p>
        </div>

        <aside className="room-card studio-panel">
          {room.status === 'lobby' ? (
            <>
              <div className="small-icon">
                <Users />
              </div>
              <h2>
                {room.maxPlayers === 1
                  ? 'Solo Dublaj Odası'
                  : 'Kadro tamam mı?'}
              </h2>
              <p>
                {room.maxPlayers === 1
                  ? 'Tek başına dublaj modu seçtin. Tüm karakter ve replikler sana ait! Hazır olduğunda hemen başla.'
                  : `Hedef ${room.maxPlayers || 4} oyuncu. Oda kodunu paylaş, arkadaşların katılsın.`}
              </p>

              <div className="lobby-scene-preview">
                <span className="lobby-scene-label">Seçili Sahne & Mod:</span>
                <strong>{scene.title}</strong>
                <small>
                  {room.maxPlayers === 1
                    ? 'Solo Mod (Tüm Replikler)'
                    : `${room.maxPlayers || 4} Kişilik Oda (${room.players.length}/${room.maxPlayers || 4} Katıldı)`}
                  {' · '}00:{scene.duration} sn
                </small>
              </div>

              <ul className="players">
                {room.players.map((p) => (
                  <li key={p.id}>
                    <span className="avatar">
                      {p.name[0].toLocaleUpperCase('tr')}
                    </span>
                    <div className="player-details">
                      <span>
                        {p.name} {p.id === me.id && <small>(sen)</small>}
                        {p.host === 1 && <small> · kurucu</small>}
                      </span>
                      {p.micTested && (
                        <span className="mic-verified-badge">
                          <Check size={11} /> Mikrofon OK
                        </span>
                      )}
                    </div>
                    <span className={p.ready ? 'ready' : ''}>
                      {p.ready ? (
                        <Check size={16} />
                      ) : (
                        <span className="waiting-dot" />
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {room.maxPlayers && room.players.length < room.maxPlayers && (
                <div className="lobby-waiting-players-hint">
                  <Users size={14} />
                  <span>
                    {room.maxPlayers - room.players.length} oyuncu daha bekleniyor ({room.players.length}/{room.maxPlayers})
                  </span>
                </div>
              )}

              <div className="lobby-action-buttons">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => act('ready', { ready: !me.ready })}
                >
                  {me.ready ? 'Hazır değilim' : 'Hazırım'} <Check size={17} />
                </button>

                {me.host === 1 ? (
                  <button
                    className="primary"
                    disabled={busy || !room.players.every((p) => p.ready)}
                    onClick={() => act('start')}
                  >
                    {room.maxPlayers === 1
                      ? 'Sahneye çık ve başla'
                      : 'Rolleri dağıt ve başlat'}{' '}
                    <Play size={17} />
                  </button>
                ) : (
                  <p className="microcopy">Oda kurucusu oyunu başlatacak.</p>
                )}
              </div>
            </>
          ) : room.status === 'recording' ? (
            <>
              <div className="eyebrow">SENİN KARAKTERİN</div>
              <h2
                className="role-name"
                style={{
                  color:
                    scene.roleDetails[me.role >= 0 ? me.role : 0]?.color ||
                    '#d8fb51',
                }}
              >
                {scene.roles[me.role >= 0 ? me.role : 0]}
              </h2>
              <p>{scene.mood}</p>
              <p>
                İşaretli bölümü izle, geri sayımdan sonra seslendir. Her kaydı
                dinleyip onayladığında sıradaki repliğin açılır.
              </p>
              <ul className="assigned-cues">
                {playerCues(
                  room.scene,
                  room.players.findIndex((p) => p.id === me.id),
                  room.players.length,
                  customScenes,
                ).map((c) => (
                  <li key={c.id}>
                    <span>Bölüm {c.id + 1}</span>
                    <strong>
                      {timeLabel(c.start)} — {timeLabel(c.end)}
                    </strong>
                    {me.segments.includes(c.id) ? (
                      <Check size={16} />
                    ) : (
                      <span className="waiting-dot" />
                    )}
                  </li>
                ))}
              </ul>
              <span className="microcopy">
                <Headphones size={14} /> Kayıtta kulaklık kullan.
              </span>
            </>
          ) : (
            <>
              <div className="small-icon">
                <Volume2 />
              </div>
              <h2>Şimdi birlikte dinleyin.</h2>
              <p>
                Herkes sesleri yükleyip hazır olsun. Oda kurucusu finali
                birlikte başlatır.
              </p>
              <ul className="players">
                {room.players.map((p) => (
                  <li key={p.id}>
                    <span className="avatar">{p.name[0]}</span>
                    <span>{p.name}</span>
                    {p.ready ? (
                      <Check size={16} />
                    ) : (
                      <span className="waiting-dot" />
                    )}
                  </li>
                ))}
              </ul>
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

              {/* Kurucu için Senkronize Birlikte Başlat Butonu */}
              {me.host === 1 && (
                <button
                  className="secondary sync-play-btn"
                  disabled={busy || playing || exporting || countdown > 0}
                  onClick={() => act('play')}
                >
                  <Users size={16} />
                  {room.playAt
                    ? 'Ekipçe Birlikte Tekrar İzle'
                    : 'Ekipçe Birlikte Başlat (3 sn)'}
                </button>
              )}

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

              {/* Video İndirme */}
              <button
                className="secondary"
                disabled={exporting || playing || countdown > 0}
                onClick={exportVideo}
              >
                <Download size={17} />
                {exporting
                  ? 'Video hazırlanıyor…'
                  : 'Dublajı video olarak indir'}
              </button>

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

          {/* Canlı Oda Aktivite Akışı */}
          {room.activities && room.activities.length > 0 && (
            <div className="activity-box">
              <div className="activity-box-title">
                <Sparkles size={13} /> ODA CANLI AKIŞI
              </div>
              <ul className="activity-list">
                {room.activities.slice(0, 5).map((a) => (
                  <li key={a.id} className="activity-item">
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {busy && <p className="microcopy">Bir saniye…</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <output className="notice">{notice}</output>}
        </aside>
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
