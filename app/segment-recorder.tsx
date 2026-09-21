'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Check, Mic, Square, RotateCcw, ArrowRight, Play, Pause } from 'lucide-react';
import {
  playerCues,
  sceneCues,
  scenes,
  timeLabel,
  type Room,
} from '@/lib/scenes';
import type { Session } from './studio';

type Take = { blob: Blob; url: string; peaks: number[] };
function peaksOf(buffer: AudioBuffer) {
  const samples = buffer.getChannelData(0);
  return Array.from({ length: 80 }, (_, i) => {
    let peak = 0;
    const start = Math.floor((i * samples.length) / 80),
      end = Math.floor(((i + 1) * samples.length) / 80);
    for (let j = start; j < end; j += 8)
      peak = Math.max(peak, Math.abs(samples[j]));
    return Math.min(1, peak * 2.5);
  });
}
export default function SegmentRecorder({
  room,
  session,
  onRoom,
}: {
  room: Room;
  session: Session;
  onRoom: (room: Room) => void;
}) {
  const scene = scenes[room.scene],
    me = room.players.find((p) => p.id === session.id)!,
    index = room.players.findIndex((p) => p.id === session.id),
    cues = sceneCues(room.scene),
    mine = playerCues(room.scene, index, room.players.length);
  const [selected, setSelected] = useState(
      () => mine.find((c) => !me.segments.includes(c.id))?.id ?? mine[0].id,
    ),
    [takes, setTakes] = useState<Record<number, Take>>({}),
    [savedUrls, setSavedUrls] = useState<Record<number, string>>({}),
    [waves, setWaves] = useState<Record<number, number[]>>({}),
    [recording, setRecording] = useState(false),
    [previewing, setPreviewing] = useState(false),
    [playingSegment, setPlayingSegment] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [countdown, setCountdown] = useState(0),
    [position, setPosition] = useState(0),
    [error, setError] = useState('');
  const current = cues[selected],
    duration = current.end - current.start,
    completed = me.audio
      ? mine.length
      : mine.filter((c) => me.segments.includes(c.id)).length,
    take = takes[selected],
    locked = busy || recording || countdown > 0;
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
    segmentAudio = useRef<HTMLAudioElement | null>(null);
  const api = `/api/rooms/${room.code}/audio/${session.id}`;
  function stop() {
    previewEnd.current = null;
    video.current?.pause();
    if (segmentAudio.current) {
      segmentAudio.current.pause();
      segmentAudio.current.currentTime = 0;
    }
    savedAudio.current?.pause();
    setPreviewing(false);
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
  const segmentKey = me.segments.join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of segmentKey.split(',').filter(Boolean).map(Number)) {
      if (loaded.current.has(id)) continue;
      loaded.current.add(id);
      void (async () => {
        try {
          const r = await fetch(`${api}?segment=${id}`, {
            headers: { Authorization: `Bearer ${session.token}` },
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
    setPosition(cues[id].start);
    if (video.current) video.current.currentTime = scene.start + cues[id].start;
  }
  async function playSegment(id: number) {
    if (locked && playingSegment !== id) return;
    if (playingSegment === id) {
      stop();
      return;
    }
    savedAudio.current?.pause();
    stop();
    const c = cues[id];
    let audioUrl = takes[id]?.url ?? savedUrls[id];
    if (!audioUrl && me.segments.includes(id)) {
      setBusy(true);
      try {
        const r = await fetch(`${api}?segment=${id}`, {
          headers: { Authorization: `Bearer ${session.token}` },
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
      const v = await seek(scene.start + c.start);
      if (!mounted.current) return;

      const a = segmentAudio.current;
      if (a) {
        a.src = audioUrl;
        a.currentTime = 0;
        await a.play();
      }
      previewEnd.current = scene.start + c.end;
      setPosition(c.start);
      await v.play();

      timer.current = setInterval(() => {
        if (!v || !mounted.current) return;
        const currentPos = v.currentTime - scene.start;
        setPosition(currentPos);
        if (v.currentTime >= scene.start + c.end || (a && a.ended)) {
          stop();
          v.currentTime = scene.start + c.start;
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
      const v = await seek(scene.start + current.start);
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
      };
      recorder.current = r;
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
  async function save() {
    if (!take) return;
    stop();
    savedAudio.current?.pause();
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${api}?segment=${selected}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': take.blob.type,
        },
        body: take.blob,
      });
      const data = (await r.json()) as { room: Room; error?: string };
      if (!r.ok) throw new Error(data.error);
      onRoom(data.room);
      const next = mine.find(
        (c) =>
          c.id !== selected &&
          !data.room.players
            .find((p) => p.id === me.id)!
            .segments.includes(c.id),
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

        {countdown > 0 && (
          <div className="recording-countdown-overlay">
            <div className="countdown-number">{countdown}</div>
            <span className="countdown-sub">Hazırlan, kayıt başlıyor!</span>
          </div>
        )}

        {recording && (
          <div className="active-recording-pill">
            <span className="recording-dot" />
            <span>KAYIT · {current.roleName.toUpperCase()} · {timeLabel(position)}</span>
          </div>
        )}
      </div>

      <div className="cue-editor">
        {/* Eğer oyuncu tüm repliklerini tamamladıysa Dublaj.io "Sıra Kimde?" Paneli göster */}
        {completed >= mine.length && !recording && !countdown ? (
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
                const pAssigned = playerCues(room.scene, pIdx, room.players.length);
                const pDone = p.audio || p.segments.length >= pAssigned.length;
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

            <div className="turn-listen-box">
              <h4>Kaydettiğin Replikleri Dinle</h4>
              <div className="cue-steps">
                {mine.map((c, i) => (
                  <button
                    disabled={locked}
                    key={c.id}
                    onClick={() => select(c.id)}
                    className={`${c.id === selected ? 'active' : ''} done`}
                    aria-label={`${i + 1}. repliğin`}
                  >
                    <span><Check size={14} /></span>
                    <strong>{timeLabel(c.start)} — {timeLabel(c.end)}</strong>
                  </button>
                ))}
              </div>

              {(take || savedUrls[selected]) && (
                <div className="cue-review">
                  <span>Bölüm {selected + 1} Kaydın</span>
                  {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio
                    controls
                    ref={savedAudio}
                    src={take?.url ?? savedUrls[selected]}
                    aria-label={`Bölüm ${selected + 1} kaydını dinle`}
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
              <span>SAHNE ZAMAN ÇİZELGESİ</span>
              <strong>
                {timeLabel(position)} <span>/ {timeLabel(scene.duration)}</span>
              </strong>
            </div>
            <div className="cue-track">
              <svg
                viewBox="0 0 1000 100"
                preserveAspectRatio="none"
                aria-label="Kayıtların ses dalgası"
              >
                <line
                  x1="0"
                  y1="50"
                  x2="1000"
                  y2="50"
                  stroke="#4c5444"
                  strokeWidth="1"
                />
                {cues.map((c) => (
                  <g key={c.id}>
                    {(waves[c.id] ?? []).map((peak, i) => (
                      <line
                        key={i}
                        x1={
                          ((c.start + ((i + 0.5) / 80) * (c.end - c.start)) /
                            scene.duration) *
                          1000
                        }
                        x2={
                          ((c.start + ((i + 0.5) / 80) * (c.end - c.start)) /
                            scene.duration) *
                          1000
                        }
                        y1={50 - peak * 44}
                        y2={50 + peak * 44}
                        stroke={c.id === selected ? '#d8fb51' : '#839776'}
                        strokeWidth="2"
                      />
                    ))}
                  </g>
                ))}
              </svg>
              {cues.map((c) => {
                const own = mine.some((x) => x.id === c.id);
                const hasRecorded =
                  own &&
                  Boolean(
                    takes[c.id] ||
                      savedUrls[c.id] ||
                      me.segments.includes(c.id),
                  );
                const isPlayingThis = playingSegment === c.id;

                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={own && !locked ? 0 : -1}
                    className={`cue-region ${c.id === selected ? 'selected' : ''} ${own ? 'own' : 'other'} ${hasRecorded ? 'has-recording' : ''}`}
                    style={{
                      left: `${(c.start / scene.duration) * 100}%`,
                      width: `${((c.end - c.start) / scene.duration) * 100}%`,
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
                    aria-label={`Bölüm ${c.id + 1}: ${timeLabel(c.start)}–${timeLabel(c.end)}${own ? ', senin repliğin' : ', diğer oyuncu'}`}
                    aria-pressed={c.id === selected}
                  >
                    <span className="cue-region-num">
                      {String(c.id + 1).padStart(2, '0')}
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
                            : `Bölüm ${c.id + 1} kaydını dinle`
                        }
                        aria-label={`Bölüm ${c.id + 1} kaydını ${isPlayingThis ? 'durdur' : 'dinle'}`}
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
                  left: `${Math.min(100, (position / scene.duration) * 100)}%`,
                }}
              />
            </div>
            <div className="cue-ruler">
              {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                <span key={n}>{timeLabel(scene.duration * n)}</span>
              ))}
            </div>
            {countdown > 0 ? (
              <div className="cue-countdown">
                <strong>{countdown}</strong>
                <span>
                  Hazırlan. {timeLabel(current.start)} konumunda kayıt başlayacak.
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
                {take || me.segments.includes(selected)
                  ? 'Bu bölümü yeniden kaydet'
                  : mine.length > 1
                    ? `Şimdi seslendir (Replik ${mine.findIndex((c) => c.id === selected) + 1}/${mine.length})`
                    : 'Şimdi seslendir'}
                <span>
                  {timeLabel(current.start)} → {timeLabel(current.end)}
                </span>
              </button>
            )}
            {(take || savedUrls[selected]) && !recording && !countdown && (
              <div className="cue-review">
                <span>Son kaydın — Bölüm {selected + 1} ({current.roleName})</span>
                {/* Player-created speech has no automatic transcript. */}
                {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  controls
                  ref={savedAudio}
                  src={take?.url ?? savedUrls[selected]}
                  aria-label={`Bölüm ${selected + 1} kaydını dinle`}
                  onPlay={() => {
                    if (playingSegment !== null) stop();
                  }}
                />
                {take && !me.audio && (
                  <button className="primary" disabled={busy} onClick={save}>
                    Kaydı onayla ve sıradakine geç <ArrowRight size={17} />
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
              {previewing ? 'Önizlemeyi durdur' : 'Seçili bölümü tekrar izle'}
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
