'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Check, Mic, Square, RotateCcw, ArrowRight } from 'lucide-react';
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
    savedAudio = useRef<HTMLAudioElement>(null);
  const api = `/api/rooms/${room.code}/audio/${session.id}`;
  function stop() {
    previewEnd.current = null;
    video.current?.pause();
    setPreviewing(false);
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
      <div className="video-wrap">
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
        {countdown > 0 && (
          <div className="countdown">
            {countdown}
            <span>Hazırlan, kayıt başlıyor…</span>
          </div>
        )}
        {recording && (
          <span className="record-indicator">
            ● KAYIT · BÖLÜM {selected + 1} · {timeLabel(position)}
          </span>
        )}
      </div>
      <div className="cue-editor">
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
            return (
              <button
                key={c.id}
                className={`cue-region ${c.id === selected ? 'selected' : ''} ${own ? 'own' : 'other'}`}
                style={{
                  left: `${(c.start / scene.duration) * 100}%`,
                  width: `${((c.end - c.start) / scene.duration) * 100}%`,
                }}
                onClick={() => select(c.id)}
                disabled={!own || locked}
                aria-label={`Bölüm ${c.id + 1}: ${timeLabel(c.start)}–${timeLabel(c.end)}${own ? ', senin repliğin' : ', diğer oyuncu'}`}
                aria-pressed={c.id === selected}
              >
                <span>
                  {String(c.id + 1).padStart(2, '0')}
                  {me.segments.includes(c.id) && ' ✓'}
                </span>
              </button>
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
        <p className="cue-caption">
          İşaretli alan senin seçili repliğin. Ses dalgası kaydından sonra
          görünür.
        </p>
        <div className="cue-script">
          <div>
            <span>
              BÖLÜM {selected + 1} / {cues.length}
            </span>
            <strong>
              {timeLabel(current.start)} <ArrowRight size={14} />{' '}
              {timeLabel(current.end)}
            </strong>
          </div>
          <blockquote>“{current.text}”</blockquote>
          <span className="cue-duration">
            {duration.toFixed(1)} saniye · {scene.roles[me.role]} · İstersen
            doğaçla.
          </span>
        </div>
        <div className="cue-steps">
          {mine.map((c, i) => (
            <button
              disabled={locked}
              key={c.id}
              onClick={() => select(c.id)}
              className={`${c.id === selected ? 'active' : ''} ${me.segments.includes(c.id) ? 'done' : ''}`}
              aria-label={`${i + 1}. repliğin, bölüm ${c.id + 1}`}
            >
              <span>
                {me.segments.includes(c.id) ? <Check size={14} /> : i + 1}
              </span>
              <strong>
                {timeLabel(c.start)} — {timeLabel(c.end)}
              </strong>
            </button>
          ))}
        </div>
        <div className="cue-completion">
          <strong>
            {completed} / {mine.length}
          </strong>{' '}
          REPLİĞİN TAMAMLANDI
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
        ) : me.audio ? (
          <div className="cue-finished">
            <Check size={19} /> Bütün repliklerin hazır. Ekibin tamamlaması
            bekleniyor.
          </div>
        ) : (
          <button
            className="primary cue-record"
            onClick={record}
            disabled={busy}
          >
            <Mic size={19} />
            {take || me.segments.includes(selected)
              ? 'Bu bölümü yeniden kaydet'
              : 'Şimdi seslendir'}
            <span>
              {timeLabel(current.start)} → {timeLabel(current.end)}
            </span>
          </button>
        )}
        {(take || savedUrls[selected]) && !recording && !countdown && (
          <div className="cue-review">
            <span>Son kaydın — Bölüm {selected + 1}</span>
            {/* Player-created speech has no automatic transcript. */}
            {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              controls
              ref={savedAudio}
              src={take?.url ?? savedUrls[selected]}
              aria-label={`Bölüm ${selected + 1} kaydını dinle`}
            />
            {take && !me.audio && (
              <button className="primary" disabled={busy} onClick={save}>
                Kaydı kullan ve devam et <ArrowRight size={17} />
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
