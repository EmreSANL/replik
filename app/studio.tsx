'use client';
import { useEffect, useRef, useState, useEffectEvent } from 'react';
import {
  ArrowLeft,
  Copy,
  Check,
  Play,
  Download,
  Headphones,
  Users,
  Volume2,
} from 'lucide-react';
import SegmentRecorder from './segment-recorder';
import {
  scenes,
  sceneCues,
  playerCues,
  timeLabel,
  type Room,
} from '@/lib/scenes';
export type Session = { code: string; token: string; id: string };
export async function request(path: string, token?: string, body?: unknown) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await r.json()) as {
    room: Room;
    token: string;
    id: string;
    error?: string;
  };
  if (!r.ok) throw new Error(data.error || 'Bağlantı kurulamadı. Tekrar dene.');
  return data;
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
    [audioLoaded, setAudioLoaded] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    ctx = useRef<AudioContext | null>(null),
    buffers = useRef<Map<string, AudioBuffer>>(new Map()),
    sources = useRef<AudioBufferSourceNode[]>([]),
    seenPlay = useRef(0),
    playStop = useRef<ReturnType<typeof setTimeout> | null>(null),
    exportStop = useRef<ReturnType<typeof setTimeout> | null>(null),
    exportRecorder = useRef<MediaRecorder | null>(null),
    frame = useRef(0),
    mounted = useRef(true);
  const clockOffset = useRef(0);
  useEffect(() => {
    clockOffset.current = initial.serverNow - Date.now();
  }, [initial.serverNow]);
  const scene = scenes[room.scene],
    me = room.players.find((p) => p.id === session.id)!,
    slotDuration = scene.duration / room.players.length;
  const api = `/api/rooms/${session.code}`;
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
      sources.current.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
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
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      ctx.current ??= new AudioContext();
      await ctx.current.resume();
      await Promise.all(
        room.players.flatMap((p) => {
          const tracks = p.segments.length
            ? p.segments.map((id) => ({
                key: `${p.id}:${id}`,
                url: `${api}/audio/${p.id}?segment=${id}`,
              }))
            : [{ key: p.id, url: `${api}/audio/${p.id}` }];
          return tracks.map(async (track) => {
            if (buffers.current.has(track.key)) return;
            const r = await fetch(track.url, {
              headers: { Authorization: `Bearer ${session.token}` },
            });
            if (!r.ok) throw new Error('Sesler yüklenemedi. Tekrar dene.');
            buffers.current.set(
              track.key,
              await ctx.current!.decodeAudioData(await r.arrayBuffer()),
            );
          });
        }),
      );
      setAudioLoaded(true);
      await act('ready', { ready: true });
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
      } catch {}
    });
    sources.current = [];
    video.current?.pause();
    if (playStop.current) clearTimeout(playStop.current);
    setPlaying(false);
  }
  async function playFinal(late = 0, destination?: AudioNode) {
    if (!ctx.current || !video.current) return;
    stopPlayback();
    await ctx.current.resume();
    const v = video.current;
    v.currentTime = scene.start + late;
    await v.play();
    const audio = ctx.current;
    const now = audio.currentTime;
    room.players.forEach((p, i) => {
      const tracks = p.segments.length
        ? sceneCues(room.scene)
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
        source.connect(destination || audio.destination);
        source.start(now + Math.max(0, track.at - late), skip, duration);
        sources.current.push(source);
      });
    });
    setPlaying(true);
    playStop.current = setTimeout(
      stopPlayback,
      Math.max(0, scene.duration - late) * 1000,
    );
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
        ).catch((e) =>
          setError(
            'Oynatma başlatılamadı. Önce “Final için hazırım” düğmesine bas. ' +
              e.message,
          ),
        );
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
    if (!ctx.current || buffers.current.size < room.players.length) {
      setError('Önce final için hazır ol düğmesine bas.');
      return;
    }
    setExporting(true);
    let captured: MediaStream | undefined;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 854;
      canvas.height = 480;
      const paint = canvas.getContext('2d')!;
      captured = canvas.captureStream(25);
      const mix = ctx.current.createMediaStreamDestination();
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
          'Replik · Big Buck Bunny © Blender Foundation · CC BY 3.0 · Sesler oyunculara aittir.',
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
        <span>
          <Users size={17} /> {room.players.length}/4 oyuncu
        </span>
      </div>
      <div className="studio-grid">
        <div>
          {room.status !== 'recording' && (
            <div className="video-wrap">
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
              {countdown > 0 && (
                <div className="countdown">
                  {countdown}
                  <span>Final başlıyor…</span>
                </div>
              )}
            </div>
          )}
          {room.status === 'recording' ? (
            <SegmentRecorder room={room} session={session} onRoom={setRoom} />
          ) : (
            <div className="timeline">
              {sceneCues(room.scene).map((c) => (
                <div key={c.id}>
                  <span>BÖLÜM {c.id + 1}</span>
                  <strong>{timeLabel(c.start)}</strong>
                  <span>Bitiş {timeLabel(c.end)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="credit">
            Sahne:{' '}
            <a
              href="https://peach.blender.org/"
              target="_blank"
              rel="noreferrer"
            >
              Big Buck Bunny · Blender Foundation
            </a>{' '}
            ·{' '}
            <a
              href="https://creativecommons.org/licenses/by/3.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 3.0
            </a>
            . Orijinal ses kapalı; replikler doğaçlamadır.
          </p>
        </div>
        <aside className="room-card studio-panel">
          {room.status === 'lobby' ? (
            <>
              <div className="small-icon">
                <Users />
              </div>
              <h2>Kadro tamam mı?</h2>
              <p>
                Oda kodunu paylaş. En fazla 4 kişi katılabilir; tek başına da
                deneyebilirsin.
              </p>
              <ul className="players">
                {room.players.map((p) => (
                  <li key={p.id}>
                    <span className="avatar">
                      {p.name[0].toLocaleUpperCase('tr')}
                    </span>
                    <span>
                      {p.name} {p.id === me.id && <small>(sen)</small>}
                      {p.host === 1 && <small> · kurucu</small>}
                    </span>
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
                  Rolleri dağıt ve başlat <Play size={17} />
                </button>
              ) : (
                <p className="microcopy">Oda kurucusu oyunu başlatacak.</p>
              )}
            </>
          ) : room.status === 'recording' ? (
            <>
              <div className="eyebrow">SENİN KARAKTERİN</div>
              <h2 className="role-name">{scene.roles[me.role]}</h2>
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
              <p>
                Repliğin bitiş noktasında kayıt kendiliğinden durur. Kaydı
                göndermeden önce istediğin kadar tekrar deneyebilirsin.
              </p>
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
              <button
                className="secondary"
                disabled={busy || exporting || playing}
                onClick={prepare}
              >
                {me.ready && audioLoaded
                  ? 'Sesler yüklendi ✓'
                  : 'Final için hazırım'}
                <Headphones size={17} />
              </button>
              {me.host === 1 && (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    playing ||
                    exporting ||
                    countdown > 0 ||
                    !room.players.every((p) => p.ready)
                  }
                  onClick={() => act('play')}
                >
                  {room.playAt
                    ? 'Birlikte tekrar izle'
                    : 'Finali birlikte başlat'}{' '}
                  <Play size={17} />
                </button>
              )}
              <button
                className="secondary"
                disabled={exporting || playing || countdown > 0 || !me.ready}
                onClick={exportVideo}
              >
                <Download size={17} />
                {exporting
                  ? 'Video hazırlanıyor…'
                  : 'Dublajı video olarak indir'}
              </button>
              <p className="microcopy">
                İndirme sahne süresi kadar sürer. Bu sekmeyi açık tut.
              </p>
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
      </div>
    </section>
  );
}
