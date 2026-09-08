'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  ArrowUpRight,
  ArrowRight,
  Users,
  Headphones,
  Play,
  Sparkles,
  AudioLines,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import Studio, { request, type Session } from './studio';
import { scenes, type Room } from '@/lib/scenes';
export default function Home() {
  const [parked, setParked] = useState<{ session: Session; room: Room } | null>(
      null,
    ),
    [help, setHelp] = useState(false),
    [modal, setModal] = useState<'create' | 'join' | null>(null),
    [selected, setSelected] = useState(0),
    [preview, setPreview] = useState<number | null>(null),
    [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [game, setGame] = useState<{ session: Session; room: Room } | null>(null);
  const clip = useRef<HTMLVideoElement>(null);
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
          ? { name, scene: selected }
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
          <button onClick={() => setHelp(true)}>Nasıl oynanır?</button>
          {!game && parked && (
            <button onClick={() => setGame(parked)}>Odana dön ↗</button>
          )}
        </nav>
        <span className="top-note">
          <span className="live-dot" /> Tarayıcında, arkadaşlarınla.
        </span>
      </header>
      <main>
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
                  backgroundImage: `linear-gradient(0deg,#0b160df5 2%,#08130b00 90%),url('${scenes[selected].poster}')`,
                }}
              >
                <div className="feature-top">
                  <span className="pill">
                    <Sparkles size={14} /> SEÇİLİ SAHNENİZ
                  </span>
                  <span className="outline-pill">ANİMASYON</span>
                </div>
                <div className="feature-bottom">
                  <span className="eyebrow">
                    BİRAZ DOĞAÇLAMA, BOLCA KAHKAHA
                  </span>
                  <h2>{scenes[selected].title}.</h2>
                  <div className="feature-meta">
                    <span>
                      <Users size={16} /> 1–4 oyuncu
                    </span>
                    <span>00:{scenes[selected].duration}</span>
                    <span>Big Buck Bunny</span>
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
                {scenes.map((s, i) => (
                  <button
                    key={s.id}
                    className={
                      'scene-card ' + (selected === i ? 'selected' : '')
                    }
                    onClick={() => {
                      setSelected(i);
                      setPreview(i);
                    }}
                  >
                    <div className={'scene-art art-' + i}>
                      <span className="scene-num">0{i + 1}</span>
                      {selected === i && (
                        <span className="selected-label">
                          <Check size={12} /> SEÇİLİ
                        </span>
                      )}
                      <span className="duration">00:{s.duration}</span>
                    </div>
                    <div className="scene-info">
                      <h3>{s.title}</h3>
                      <ArrowUpRight size={19} />
                      <span>Animasyon · 1–4 oyuncu</span>
                    </div>
                  </button>
                ))}
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
          <span>REPLİK / BİRLİKTE OYNA</span>
        </footer>
        <div className="source-credit">
          Sahneler:{' '}
          <a href="https://peach.blender.org/" target="_blank" rel="noreferrer">
            Big Buck Bunny © Blender Foundation
          </a>{' '}
          ·{' '}
          <a
            href="https://creativecommons.org/licenses/by/3.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 3.0
          </a>{' '}
          · Kesitler alınmış, ses kapatılmıştır.
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
              başlatır. Karakterler rastgele dağıtılır.
            </li>
            <li>
              <strong>Kendi bölümünü kaydet.</strong> Önerilen repliği kullan
              veya doğaçla. Beğenmezsen kaydı göndermeden tekrar dene.
            </li>
            <li>
              <strong>Finali birlikte izle.</strong> Herkes sesleri yükleyip
              hazır olsun. Kurucu başlattığında geri sayım hepinizde görünür.
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
            {modal === 'create' ? 'Sahnedeki adın ne?' : 'Ekibine katıl.'}
          </DialogTitle>
          <DialogDescription>
            {modal === 'create'
              ? `${scenes[selected].title} · 1–4 oyuncu`
              : 'Arkadaşının paylaştığı oda koduyla katıl.'}
          </DialogDescription>
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
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="preview-dialog">
          <DialogTitle>{scenes[preview ?? 0].title}</DialogTitle>
          <DialogDescription>
            {scenes[preview ?? 0].duration} saniye · 1–4 oyuncu · Sessiz
            önizleme
          </DialogDescription>
          {preview !== null && (
            <video
              key={preview}
              ref={clip}
              src={scenes[preview].video}
              poster={scenes[preview].poster}
              muted
              playsInline
              autoPlay
              controls
              onLoadedMetadata={() => {
                if (clip.current)
                  clip.current.currentTime = scenes[preview].start;
              }}
              onTimeUpdate={() => {
                const v = clip.current;
                if (
                  v &&
                  v.currentTime >=
                    scenes[preview].start + scenes[preview].duration
                ) {
                  v.pause();
                  v.currentTime = scenes[preview].start;
                }
              }}
            />
          )}
          <button
            className="primary"
            onClick={() => {
              const id = preview ?? 0;
              setPreview(null);
              openCreate(id);
            }}
          >
            Bu sahneyle oda kur <ArrowUpRight size={18} />
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
