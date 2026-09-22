'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  ArrowUpRight,
  ArrowRight,
  Users,
  User,
  Headphones,
  Play,
  Sparkles,
  AudioLines,
  Check,
  Plus,
  Edit3,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import Studio, { request, type Session } from './studio';
import { getAllScenes, getCustomScenes, fallbackScene, type Scene, type Room } from '@/lib/scenes';
import { getScenesFromSupabase } from '@/lib/supabase';
export default function Home() {
  const [allScenes, setAllScenes] = useState<Scene[]>(() => {
    if (typeof window !== 'undefined') {
      const local = getCustomScenes();
      if (local.length > 0) return local;
    }
    return [];
  });
  const [parked, setParked] = useState<{ session: Session; room: Room } | null>(
      null,
    ),
    [help, setHelp] = useState(false),
    [modal, setModal] = useState<'create' | 'join' | null>(null),
    [selected, setSelected] = useState(0),
    [maxPlayers, setMaxPlayers] = useState(4),
    [preview, setPreview] = useState<number | null>(null),
    [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [game, setGame] = useState<{ session: Session; room: Room } | null>(null);
  const clip = useRef<HTMLVideoElement>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    void getScenesFromSupabase().then((dbScenes) => {
      if (dbScenes && dbScenes.length > 0) {
        setAllScenes(dbScenes);
      } else {
        setAllScenes(getCustomScenes());
      }
    });
  }, []);
  const activeScene = allScenes[selected] || allScenes[0] || fallbackScene;
  const previewScene =
    preview !== null ? allScenes[preview] || allScenes[0] || fallbackScene : null;
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('replik-session');
      if (cached) {
        const session = JSON.parse(cached) as Session;
        request(`/api/rooms/${session.code}`, session.token)
          .then((d) => setGame({ session, room: d.room }))
          .catch(() => sessionStorage.removeItem('replik-session'));
      }
    } catch {}
  }, []);
  function openCreate(id = selected) {
    setSelected(id);
    setError('');
    setModal('create');
  }
  async function enter(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const path =
        modal === 'create'
          ? '/api/rooms'
          : `/api/rooms/${code.toUpperCase().trim()}`;
      const data = await request(
        path,
        undefined,
        modal === 'create'
          ? { name, scene: activeScene.id, maxPlayers }
          : { action: 'join', name },
      );
      const session = { code: data.room.code, token: data.token, id: data.id };
      sessionStorage.setItem('replik-session', JSON.stringify(session));
      setGame({ session, room: data.room });
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function leave() {
    setParked(game);
    setGame(null);
  }
  return (
    <div className="app-shell">
      {!game && (
        <header className="topbar">
          <Link href="/" className="brand" aria-label="Replik ana sayfa">
            <span className="brand-icon">
              <AudioLines size={25} />
            </span>
            replik<span className="brand-dot">®</span>
          </Link>
          <nav>
            <button
              className="active"
              onClick={() => {
                if (game) leave();
                else
                  document
                    .getElementById('sahneler')
                    ?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Oyun alanı
            </button>
            <Link
              href="/editor"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '20px',
                background: 'rgba(216, 251, 81, 0.12)',
                border: '1px solid rgba(216, 251, 81, 0.35)',
                color: '#d8fb51',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <Sparkles size={14} /> Sahne Editörü 🎬
            </Link>
            <button onClick={() => setHelp(true)}>Nasıl oynanır?</button>
            {!game && parked && (
              <button onClick={() => setGame(parked)}>Odana dön ↗</button>
            )}
          </nav>
          <span className="top-note">
            <span className="live-dot" /> Tarayıcında, arkadaşlarınla.
          </span>
        </header>
      )}
      <main className={game ? 'game-mode-main' : ''}>
        {game ? (
          <Studio session={game.session} initial={game.room} onExit={leave} />
        ) : (
          <>
            <div className="heading-row">
              <div>
                <div className="eyebrow">AYNI SAHNE. BAMBAŞKA HİKÂYE.</div>
                <h1>
                  Sahne hazır.
                  <br />
                  Ses <span>sende.</span>
                </h1>
              </div>
              <p>
                Rolleri paylaş, repliğini patlat.
                <br />
                Ortaya ne çıkacağını kimse bilmiyor.
              </p>
            </div>
            <section className="play-grid">
              <div
                className="featured"
                style={{
                  backgroundImage: activeScene.poster
                    ? `linear-gradient(0deg,#0b160df5 2%,#08130b00 90%),url('${activeScene.poster}')`
                    : undefined,
                }}
              >
                <div className="feature-top">
                  <span className="pill">
                    <Sparkles size={14} /> SEÇİLİ SAHNENİZ
                  </span>
                  <span className="outline-pill">
                    {activeScene.category.toUpperCase()}
                  </span>
                </div>
                <div className="feature-bottom">
                  <span className="eyebrow">
                    {activeScene.mood.toUpperCase()}
                  </span>
                  <h2>{activeScene.title}.</h2>
                  <div className="feature-meta">
                    <span>
                      <Users size={16} /> 1–{activeScene.roles.length} oyuncu
                    </span>
                    <span>00:{activeScene.duration}</span>
                    <span>{activeScene.roles.join(', ')}</span>
                  </div>
                </div>
                <button
                  className="play-circle"
                  aria-label="Seçili sahneyi önizle"
                  onClick={() => setPreview(selected)}
                >
                  <Play fill="currentColor" />
                </button>
              </div>
              <section className="room-card">
                <div className="small-icon">
                  <Mic />
                </div>
                <h2>Ekibini sahneye al.</h2>
                <p>
                  Bir oda aç. Kodu paylaş.
                  <br />
                  Gerisi sizin sesiniz.
                </p>
                <button className="primary" onClick={() => openCreate()}>
                  Oda oluştur <ArrowUpRight size={19} />
                </button>
                <div className="divider">YA DA ARKADAŞLARINA KATIL</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError('');
                    setModal('join');
                  }}
                >
                  <label htmlFor="code">Oda kodu</label>
                  <div className="join-row">
                    <input
                      id="code"
                      placeholder="6 haneli kod"
                      value={code}
                      onChange={(e) =>
                        setCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, ''),
                        )
                      }
                      required
                      minLength={6}
                      maxLength={6}
                      autoComplete="off"
                    />
                    <button aria-label="Odaya katıl">
                      <ArrowRight />
                    </button>
                  </div>
                </form>
                <span className="microcopy">
                  <Headphones size={14} /> Kulaklığını tak, sahne senin.
                </span>
              </section>
            </section>
            <section id="sahneler" className="catalog">
              <div className="section-heading">
                <h2>Bir sahne, bin ihtimal.</h2>
                <span>Özgürce doğaçla.</span>
              </div>
              <div className="scene-grid">
                {allScenes.map((s, i) => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    className={
                      'scene-card ' + (selected === i ? 'selected' : '')
                    }
                    onClick={() => {
                      setSelected(i);
                      setPreview(i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelected(i);
                        setPreview(i);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div
                      className={'scene-art art-' + (i % 4)}
                      style={
                        s.poster
                          ? {
                              backgroundImage: `url('${s.poster}')`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : undefined
                      }
                    >
                      <span className="scene-num">0{i + 1}</span>
                      {selected === i && (
                        <span className="selected-label">
                          <Check size={12} /> SEÇİLİ
                        </span>
                      )}
                      <Link
                        href={`/editor?sceneId=${s.id}`}
                        target="_blank"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        title="Bu sahneyi editörde düzenle"
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: 'rgba(16, 17, 13, 0.88)',
                          backdropFilter: 'blur(4px)',
                          color: '#d8fb51',
                          border: '1px solid rgba(216, 251, 81, 0.4)',
                          borderRadius: '6px',
                          padding: '3px 7px',
                          fontSize: '11px',
                          fontWeight: 700,
                          textDecoration: 'none',
                          zIndex: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <Edit3 size={11} /> Düzenle ↗
                      </Link>
                      {s.isCustom && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: '8px',
                            left: '8px',
                            background: '#d8fb51',
                            color: '#10110d',
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          MEME / ÖZEL
                        </span>
                      )}
                      <span className="duration">00:{s.duration}</span>
                    </div>
                    <div className="scene-info">
                      <h3>{s.title}</h3>
                      <ArrowUpRight size={19} />
                      <span>{s.category} · {s.roles.length} karakter</span>
                    </div>
                  </div>
                ))}

                {/* Yeni Sahne / Meme Ekle Kartı */}
                <Link
                  href="/editor"
                  className="scene-card"
                  style={{
                    border: '2px dashed #3e4133',
                    background: 'rgba(25, 27, 20, 0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '24px',
                    textAlign: 'center',
                    textDecoration: 'none',
                    minHeight: '180px',
                    borderRadius: '16px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      background: '#d8fb51',
                      color: '#10110d',
                      borderRadius: '50%',
                      width: '42px',
                      height: '42px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '10px',
                    }}
                  >
                    <Plus size={22} />
                  </div>
                  <h3
                    style={{
                      color: '#f4f4e9',
                      fontSize: '15px',
                      fontWeight: 700,
                      margin: '0 0 4px',
                    }}
                  >
                    Kendi Meme Sahnini Yap
                  </h3>
                  <span style={{ color: '#8c8e82', fontSize: '12px' }}>
                    Video yükle & altyazı zamanla 🎬
                  </span>
                </Link>
              </div>
            </section>
            <div className="how-strip">
              <span>
                <b>01</b> Odanı kur
              </span>
              <ArrowRight size={15} />
              <span>
                <b>02</b> Rolünü kap
              </span>
              <ArrowRight size={15} />
              <span>
                <b>03</b> Sesini kaydet
              </span>
              <ArrowRight size={15} />
              <span>
                <b>04</b> Birlikte izle
              </span>
            </div>
          </>
        )}
        <footer>
          <span>Sesler sizin. Eğlence hepimizin.</span>
          <span>REPLİK / DUBLAJ.IO DENEYİMİ</span>
        </footer>
        <div className="source-credit">
          Sahneler ve replikler kullanıcılar tarafından oluşturulmuştur · Sesler oyuncuların doğaçlamasıdır.
        </div>
      </main>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="help-dialog">
          <DialogTitle>Her ses başka bir hikâye.</DialogTitle>
          <DialogDescription>
            1–4 kişiyle, dört adımda kendi dublajınız.
          </DialogDescription>
          <ol className="help-list">
            <li>
              <strong>Bir oda kur.</strong> Sahneni seç, oyuncu adını yaz. Oda
              kodunu arkadaşlarınla paylaş.
            </li>
            <li>
              <strong>Rolünü keşfet.</strong> Herkes hazır olduğunda kurucu
              başlatır. Karakterler renkli kartlarla tanıtılır.
            </li>
            <li>
              <strong>Kendi bölümünü kaydet.</strong> Önerilen repliği kullan
              veya doğaçla. Kırmızı parlayan kayıt çerçevesi ve altyazı sana rehberlik eder.
            </li>
            <li>
              <strong>Finali birlikte izle.</strong> Herkes sesleri yüklediğinde senkronize
              sinema başlar. Reaksiyonlar ver ve aynı ekiple yeni sahnelere geç!
            </li>
          </ol>
          <p className="microcopy">
            Odalar 24 saat açık kalır. Kayıt yalnızca düğmeye bastığında başlar.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {modal === 'create' ? 'ODANI KUR' : 'EKİBİNE KATIL'}
          </DialogTitle>
          <DialogDescription>
            {modal === 'create'
              ? `${activeScene.title} · ${activeScene.category} · ${maxPlayers} kişilik oda`
              : 'Arkadaşının paylaştığı 6 haneli oda koduyla katıl.'}
          </DialogDescription>

          {modal === 'create' && (
            <div className="lobby-scene-preview" style={{ margin: '8px 0 16px' }}>
              <span className="lobby-scene-label">Seçili Sahne:</span>
              <strong>{activeScene.title}</strong>
              <small>{activeScene.roles.length} Karakter · 00:{activeScene.duration} sn · {activeScene.roles.join(', ')}</small>
            </div>
          )}

          <form onSubmit={enter} className="entry-form">
            <label htmlFor="name">Oyuncu adın</label>
            <input
              id="name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              placeholder="Sahnede sana ne diyelim?"
              autoComplete="off"
            />

            {modal === 'create' && (
              <div className="player-count-picker">
                <div className="player-count-title">
                  <Users size={14} /> KİŞİ SAYISI SEÇENEĞİ
                </div>
                <div className="player-count-grid">
                  {[
                    {
                      count: 1,
                      label: '1 Kişi',
                      badge: 'Solo',
                      desc: '4 repliğin hepsi sana ait',
                      icon: User,
                    },
                    {
                      count: 2,
                      label: '2 Kişi',
                      badge: 'Düet',
                      desc: "2'şer replik paylaşırsınız",
                      icon: Users,
                    },
                    {
                      count: 3,
                      label: '3 Kişi',
                      badge: 'Trio',
                      desc: '1-2 replik paylaşırsınız',
                      icon: Users,
                    },
                    {
                      count: 4,
                      label: '4 Kişi',
                      badge: 'Ekip',
                      desc: "1'er replik tam kadro",
                      icon: Users,
                    },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = maxPlayers === opt.count;
                    return (
                      <button
                        type="button"
                        key={opt.count}
                        className={`player-count-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setMaxPlayers(opt.count)}
                      >
                        <div className="player-count-card-header">
                          <span className="count-badge-icon">
                            <Icon size={14} />
                          </span>
                          <span className="count-badge-type">{opt.badge}</span>
                        </div>
                        <strong className="count-val">{opt.label}</strong>
                        <span className="count-subdesc">{opt.desc}</span>
                        {isSelected && (
                          <span className="count-selected-check">
                            <Check size={11} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {modal === 'join' && (
              <>
                <label htmlFor="join-code">Oda kodu</label>
                <input
                  id="join-code"
                  className="field"
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                    )
                  }
                  minLength={6}
                  maxLength={6}
                  required
                  placeholder="ABC123"
                  autoComplete="off"
                />
              </>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? 'Odaya giriliyor…'
                : modal === 'create'
                  ? 'Odamı oluştur'
                  : 'Odaya katıl'}
              <ArrowRight size={17} />
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            previewAudio.current?.pause();
            setPreview(null);
          }
        }}
      >
        <DialogContent className="preview-dialog">
          <DialogTitle>{previewScene?.title}</DialogTitle>
          <DialogDescription>
            {previewScene?.duration} saniye · {previewScene?.roles.length} oyuncu ·{' '}
            {previewScene?.instrumental
              ? 'Vokalsiz (Ses Efektli M&E) Önizleme'
              : 'Sahne Önizlemesi'}
          </DialogDescription>
          {previewScene && (
            <>
              {previewScene.instrumental && (
                /* oxlint-disable-next-line jsx-a11y/media-has-caption */
                <audio
                  key={`audio-${previewScene.id}`}
                  ref={previewAudio}
                  src={previewScene.instrumental}
                  preload="auto"
                  playsInline
                  style={{ display: 'none' }}
                />
              )}
              <video
                key={previewScene.id}
                ref={clip}
                src={previewScene.video}
                poster={previewScene.poster}
                muted={Boolean(previewScene.instrumental)}
                playsInline
                autoPlay
                controls
                onLoadedMetadata={() => {
                  if (clip.current) {
                    clip.current.currentTime = previewScene.start;
                  }
                  if (previewAudio.current && previewScene.instrumental) {
                    previewAudio.current.currentTime = previewScene.start;
                    previewAudio.current.volume = 1.0;
                    void previewAudio.current.play().catch(() => {});
                  }
                }}
                onPlay={() => {
                  if (previewAudio.current && clip.current && previewScene.instrumental) {
                    previewAudio.current.currentTime = clip.current.currentTime;
                    void previewAudio.current.play().catch(() => {});
                  }
                }}
                onPause={() => {
                  previewAudio.current?.pause();
                }}
                onSeeked={() => {
                  if (previewAudio.current && clip.current && previewScene.instrumental) {
                    previewAudio.current.currentTime = clip.current.currentTime;
                  }
                }}
                onTimeUpdate={() => {
                  const v = clip.current;
                  if (
                    v &&
                    v.currentTime >=
                      previewScene.start + previewScene.duration
                  ) {
                    v.pause();
                    previewAudio.current?.pause();
                    v.currentTime = previewScene.start;
                    if (previewAudio.current) {
                      previewAudio.current.currentTime = previewScene.start;
                    }
                  }
                }}
              />
            </>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              className="primary"
              style={{ flex: 1 }}
              onClick={() => {
                const id = preview ?? 0;
                setPreview(null);
                openCreate(id);
              }}
            >
              Bu sahneyle oda kur <ArrowUpRight size={18} />
            </button>
            {previewScene && (
              <Link
                href={`/editor?sceneId=${previewScene.id}`}
                target="_blank"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0 16px',
                  background: 'rgba(216, 251, 81, 0.12)',
                  color: '#d8fb51',
                  border: '1px solid rgba(216, 251, 81, 0.35)',
                  borderRadius: '10px',
                  fontWeight: 600,
                  fontSize: '14px',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <Edit3 size={15} /> Editörde Düzenle ↗
              </Link>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
