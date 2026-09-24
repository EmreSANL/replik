'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  ArrowRight,
  Play,
  Sparkles,
  Check,
  Plus,
  Edit3,
  Flame,
  Volume2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import Studio, { request, type Session } from './studio';
import {
  getCustomScenes,
  fallbackScene,
  sceneCues,
  type Scene,
  type Room,
} from '@/lib/scenes';
import { getScenesFromSupabase } from '@/lib/supabase';
import { SceneVideoGifCover } from '@/components/scene-video-gif-cover';
import {
  getPublishedDubsFromSupabase,
  likePublishedDubInSupabase,
  cleanupStaleUnpublishedRooms,
  type PublishedDub,
} from '@/lib/game-service';
import { useAuth, MemberTopbarBadge } from '@/components/auth-provider';
import { ReplikLoadingScreen } from '@/components/replik-loading-screen';

export default function Home() {
  const { displayName, requireAuth } = useAuth();
  const [allScenes, setAllScenes] = useState<Scene[]>(() => {
    if (typeof window !== 'undefined') {
      const local = getCustomScenes();
      if (local.length > 0) return local;
    }
    return [];
  });
  const [siteReady, setSiteReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(12);
  const [loadingStatus, setLoadingStatus] = useState(
    'Sahne kataloğu bağlanıyor...',
  );
  const [publishedDubs, setPublishedDubs] = useState<PublishedDub[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('TÜMÜ');
  const [parked, setParked] = useState<{ session: Session; room: Room } | null>(null);
  const [help, setHelp] = useState(false);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [selected, setSelected] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [preview, setPreview] = useState<number | null>(null);
  const [name, setName] = useState(() => displayName || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [game, setGame] = useState<{ session: Session; room: Room } | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (displayName && !name) {
      setName(displayName);
    }
  }, [displayName, name]);

  async function refreshPublishedFeed() {
    const dubs = await getPublishedDubsFromSupabase().catch(() => []);
    setPublishedDubs(dubs);
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingProgress(20);
    setLoadingStatus('Sahneler veritabanından alınıyor...');

    void getScenesFromSupabase().then((dbScenes) => {
      if (cancelled) return;
      const list = dbScenes && dbScenes.length > 0 ? dbScenes : getCustomScenes();
      setAllScenes(list);
      if (list.length > 0) {
        const withVideoIndices = list
          .map((s, idx) => (s.video ? idx : -1))
          .filter((idx) => idx >= 0);
        const pool = withVideoIndices.length > 0 ? withVideoIndices : list.map((_, idx) => idx);
        const randomIdx = pool[Math.floor(Math.random() * pool.length)] ?? 0;
        setSelected(randomIdx);
      }

      const videoUrls = Array.from(
        new Set(list.map((s) => s.video).filter(Boolean)),
      ).slice(0, 7);

      if (videoUrls.length === 0) {
        setLoadingProgress(100);
        setLoadingStatus('Stüdyo hazır!');
        setTimeout(() => {
          if (!cancelled) setSiteReady(true);
        }, 250);
        return;
      }

      setLoadingProgress(35);
      setLoadingStatus(`Videolar yükleniyor (0 / ${videoUrls.length})...`);

      let loadedCount = 0;
      const total = videoUrls.length;
      const finishLoading = () => {
        if (cancelled) return;
        setLoadingProgress(100);
        setLoadingStatus('Tüm sahneler ve videolar hazır!');
        setTimeout(() => {
          if (!cancelled) setSiteReady(true);
        }, 280);
      };

      const fallbackTimer = setTimeout(() => {
        finishLoading();
      }, 2200);

      videoUrls.forEach((url) => {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.muted = true;
        vid.playsInline = true;
        let done = false;
        const markOne = () => {
          if (done || cancelled) return;
          done = true;
          // Arka planda bellek ve bant genişliği sızıntısını önlemek için geçici video nesnesini temizle
          try {
            vid.pause();
            vid.removeAttribute('src');
            vid.load();
          } catch {}
          loadedCount += 1;
          const pct = 35 + Math.round((loadedCount / total) * 65);
          setLoadingProgress(pct);
          setLoadingStatus(
            `Videolar yükleniyor (${loadedCount} / ${total})...`,
          );
          if (loadedCount >= total) {
            clearTimeout(fallbackTimer);
            finishLoading();
          }
        };
        vid.addEventListener('loadedmetadata', markOne, { once: true });
        vid.addEventListener('loadeddata', markOne, { once: true });
        vid.addEventListener('error', markOne, { once: true });
        vid.src = url;
      });
    });

    void cleanupStaleUnpublishedRooms();

    return () => {
      cancelled = true;
    };
  }, []);

  const [heroPaused, setHeroPaused] = useState(false);

  // Ana sayfa Hero alanında sitedeki videoların GIF önizlemelerini rastgele sırayla oynat
  useEffect(() => {
    if (allScenes.length <= 1 || modal !== null || preview !== null || game !== null || heroPaused) {
      return;
    }
    const timer = setInterval(() => {
      setSelected((prev) => {
        const withVideoIndices = allScenes
          .map((s, idx) => (s.video ? idx : -1))
          .filter((idx) => idx >= 0);
        const pool =
          withVideoIndices.length > 1
            ? withVideoIndices.filter((idx) => idx !== prev)
            : allScenes.map((_, idx) => idx).filter((idx) => idx !== prev);
        if (pool.length === 0) return prev;
        return pool[Math.floor(Math.random() * pool.length)] ?? prev;
      });
    }, 4500);
    return () => clearInterval(timer);
  }, [allScenes, modal, preview, game, heroPaused]);

  const activeScene = allScenes[selected] || allScenes[0] || fallbackScene;
  const hasScenes = allScenes.length > 0;
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
    requireAuth(() => {
      if (!hasScenes) {
        setError('Önce editörden bir sahne ekle.');
        return;
      }
      setSelected(id);
      setError('');
      setModal('create');
    });
  }

  function openJoin() {
    requireAuth(() => {
      setError('');
      setModal('join');
    });
  }

  function openEditor(path = '/editor') {
    requireAuth(() => {
      window.location.href = path;
    });
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
    sessionStorage.removeItem('replik-session');
    setParked(null);
    setGame(null);
    void refreshPublishedFeed();
  }

  const categories = ['TÜMÜ', 'MEME & MİZAH', 'DİZİ & FİLM', 'ANİME', 'YEŞİLÇAM'];
  const filteredScenes =
    selectedCategory === 'TÜMÜ'
      ? allScenes
      : allScenes.filter((s) =>
          s.category
            ?.toLocaleLowerCase('tr')
            .includes(selectedCategory.toLocaleLowerCase('tr')),
        );

  const activeCues = sceneCues(activeScene.id, allScenes);
  const activeCuesCount = activeCues.length;

  // Distinct color themes for scene catalog cards
  const colorThemes = ['theme-lilac', 'theme-yellow', 'theme-sage', 'theme-coral', 'theme-olive'];

  return (
    <div className="bbank-shell">
      <ReplikLoadingScreen
        visible={!siteReady}
        progress={loadingProgress}
        statusText={loadingStatus}
      />
      {!game && (
        <header className="bbank-topbar">
          <div className="bbank-topbar-left">
            <Link href="/" className="bbank-brand" aria-label="Replik ana sayfa">
              <span className="bbank-brand-title">Replik</span>
            </Link>
            <span className="bbank-date-label">
              Arkadaşlarınla sahneye gir, sesleri paylaş.
            </span>
          </div>

          <div className="bbank-topbar-right">
            <button
              type="button"
              className="bbank-pill-btn bbank-pill-dark"
              onClick={() => {
                if (game) leave();
                else
                  document
                    .getElementById('sahneler')
                    ?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Sahneler
            </button>
            <Link
              href="/dublajlar"
              className="bbank-pill-btn bbank-pill-dark"
            >
              Dublaj Akışı
            </Link>
            <button
              type="button"
              className="bbank-pill-btn bbank-pill-dark"
              onClick={() => setHelp(true)}
            >
              Nasıl Oynanır?
            </button>
            <a
              href="/editor"
              onClick={(e) => {
                e.preventDefault();
                openEditor('/editor');
              }}
              className="bbank-pill-btn bbank-pill-sage"
            >
              <Sparkles size={13} /> Sahne Editörü
            </a>
            <button
              type="button"
              className="bbank-pill-btn bbank-pill-coral"
              onClick={() => openJoin()}
            >
              # ODA KODUYLA GİR
            </button>
            {!game && parked && (
              <button
                type="button"
                className="bbank-pill-btn bbank-pill-yellow"
                onClick={() => setGame(parked)}
              >
                Odana dön ↗
              </button>
            )}
            <MemberTopbarBadge />
          </div>
        </header>
      )}

      <main className={game ? 'game-mode-main' : 'bbank-main'}>
        {game ? (
          <Studio session={game.session} initial={game.room} onExit={leave} />
        ) : (
          <>
            <section className="replik-hero" aria-labelledby="replik-hero-title">
              <div className="replik-hero-copy">
                <h1 id="replik-hero-title">
                  Sahne senin.<br />
                  <span>Sesini duyur.</span>
                </h1>
                <p>
                  Bir sahne seç, arkadaşlarınla rolleri paylaş ve kendi seslerinizle dublaj yapın.
                </p>
                <div className="replik-hero-actions">
                  {hasScenes ? (
                    <button
                      type="button"
                      className="replik-hero-primary"
                      onClick={() => openCreate(selected)}
                    >
                      Bu sahneyle oda kur <ArrowRight size={18} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="replik-hero-primary"
                      onClick={() => openEditor('/editor')}
                    >
                      İlk sahneni oluştur <ArrowRight size={18} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="replik-hero-secondary"
                    onClick={() => openJoin()}
                  >
                    Oda kodum var
                  </button>
                </div>
              </div>

              <div
                className="replik-hero-feature"
                onMouseEnter={() => setHeroPaused(true)}
                onMouseLeave={() => setHeroPaused(false)}
              >
                <div
                  className="replik-hero-feature-art"
                  style={{ overflow: 'hidden', position: 'relative' }}
                  aria-hidden="true"
                >
                  {activeScene.video ? (
                    <SceneVideoGifCover
                      key={`hero-gif-${activeScene.id}-${selected}`}
                      scene={activeScene}
                      cues={sceneCues(activeScene.id, allScenes)}
                      showBadge={false}
                    />
                  ) : (
                    !activeScene.poster && <span>R.</span>
                  )}
                </div>
                <div className="replik-hero-feature-bottom">
                  <h2>{hasScenes ? activeScene.title : 'İlk sahneni oluştur.'}</h2>
                </div>
              </div>
            </section>

            {/* ============================================================
                SCENE CATALOG (SOLID COLOR BENTO TILES)
                ============================================================ */}
            <section id="sahneler" className="bbank-catalog-section">
              <div className="bbank-section-heading">
                <div>
                  <h2 className="bbank-section-title">Sahne Kataloğu</h2>
                  <p className="bbank-section-desc">
                    Tüm sahnelerde 1 karakter = 1 oyuncu kuralı geçerlidir.
                  </p>
                </div>

                {/* Category Pills matching the palette */}
                <div className="bbank-cat-pills">
                  {categories.map((cat, idx) => {
                    const theme = colorThemes[idx % colorThemes.length];
                    const isActive = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`bbank-cat-pill ${theme} ${isActive ? 'is-active' : ''}`}
                        onClick={() => setSelectedCategory(cat)}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Grid of solid color bento cards */}
              <div className="bbank-scenes-grid">
                {filteredScenes.map((s, i) => {
                  const cues = sceneCues(s.id, allScenes);
                  const theme = colorThemes[i % colorThemes.length];
                  const sceneIndex = allScenes.findIndex(
                    (scene) => scene.id === s.id,
                  );
                  const isSelected = selected === sceneIndex;

                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      className={`bbank-scene-tile ${theme} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelected(sceneIndex);
                        setPreview(sceneIndex);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelected(sceneIndex);
                          setPreview(sceneIndex);
                        }
                      }}
                    >
                      <div
                        className="bbank-scene-tile-top"
                        style={{ justifyContent: 'flex-end' }}
                      >
                        <span className="bbank-scene-dur">00:{s.duration} sn</span>
                      </div>

                      {/* Poster & Animated GIF Mid-Video Loop Frame */}
                      <div
                        className="bbank-scene-poster-frame"
                        style={{
                          position: 'relative',
                          overflow: 'hidden',
                          ...(s.poster
                            ? {
                                backgroundImage: `url('${s.poster}')`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                              }
                            : {}),
                        }}
                      >
                        <SceneVideoGifCover scene={s} cues={cues} showBadge={false} />
                        <a
                          href={`/editor?sceneId=${s.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openEditor(`/editor?sceneId=${s.id}`);
                          }}
                          className="bbank-scene-edit-btn"
                          style={{ zIndex: 5 }}
                          title="Editörde Düzenle"
                        >
                          <Edit3 size={12} /> Düzenle
                        </a>
                      </div>

                      <div className="bbank-scene-tile-body">
                        <span className="bbank-scene-cat-label">{s.category}</span>
                        <h3 className="bbank-scene-name">{s.title}</h3>

                        <div className="bbank-scene-meta-row">
                          <span>{s.roles.length} Karakter</span>
                          <span>&middot;</span>
                          <span>{cues.length} Replik</span>
                        </div>

                        <div className="bbank-scene-tile-actions">
                          <button
                            type="button"
                            className="bbank-scene-start-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCreate(sceneIndex);
                            }}
                          >
                            <Mic size={14} /> Oda Kur
                          </button>
                          <button
                            type="button"
                            className="bbank-scene-listen-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview(sceneIndex);
                            }}
                          >
                            <Play size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add Custom Meme Tile */}
                <a
                  href="/editor"
                  onClick={(e) => {
                    e.preventDefault();
                    openEditor('/editor');
                  }}
                  className="bbank-scene-tile bbank-add-tile"
                >
                  <div className="bbank-add-icon">
                    <Plus size={28} />
                  </div>
                  <h3>Kendi Sahnini Ekle</h3>
                  <p>Video yükle, repliklerin zamanını belirle.</p>
                  <span className="bbank-add-btn-tag">Editöre git</span>
                </a>
              </div>
            </section>
          </>
        )}
      </main>

      {/* ============================================================
          HELP DIALOG (SOLID BENTO STYLE)
          ============================================================ */}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="bbank-dialog">
          <DialogTitle className="bbank-dialog-title">
            Her Ses Başka Bir Hikâye
          </DialogTitle>
          <DialogDescription className="bbank-dialog-desc">
            1–4 kişiyle, dört adımda kendi dublajınız.
          </DialogDescription>
          <ol className="bbank-help-list">
            <li>
              <strong>1. Odanı Kur:</strong> Sahneni seç, oyuncu adını yaz. Oda kodunu arkadaşlarınla paylaş.
            </li>
            <li>
              <strong>2. Rolünü Keşfet:</strong> 1 Karakter = 1 Oyuncu kuralıyla karakterler bölünmeden adil dağıtılır.
            </li>
            <li>
              <strong>3. Bölümünü Kaydet:</strong> Önce orijinal sahne sesi çalar, ardından mikrofona kendi doğaçlamanı kaydet.
            </li>
            <li>
              <strong>4. Finali Birlikte İzle:</strong> Herkes bitirdiğinde odadakilerle aynı anda izle, reaksiyon ver ve MP4 indir!
            </li>
          </ol>
        </DialogContent>
      </Dialog>

      {/* ============================================================
          CREATE & JOIN ROOM MODAL (SOLID COLOR TILES)
          ============================================================ */}
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <DialogContent className="bbank-dialog bbank-modal-content">
          <div className="bbank-modal-inner">
            <div className="bbank-modal-header">
              <span className="bbank-inner-pill">
                {modal === 'create' ? 'ODANI KUR' : 'EKİBİNE KATIL'}
              </span>
              <DialogTitle className="bbank-modal-title">
                {modal === 'create' ? activeScene.title : 'Canlı Odaya Katıl'}
              </DialogTitle>
              <DialogDescription className="bbank-modal-desc">
                {modal === 'create'
                  ? `${activeScene.roles.length} Karakter · ${activeCuesCount} Replik · 00:${activeScene.duration} sn`
                  : 'Arkadaşının paylaştığı 6 haneli kodla ekibe dahil ol.'}
              </DialogDescription>
            </div>

            <form onSubmit={enter} className="bbank-modal-form">
              <div className="bbank-form-field">
                <label htmlFor="player-name">OYUNCU ADIN</label>
                <input
                  id="player-name"
                  className="bbank-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  required
                  placeholder="Sahnede sana ne diyelim?"
                  autoComplete="off"
                />
              </div>

              {/* Player Count Selection (4 Solid Color Tiles) */}
              {modal === 'create' && (() => {
                const options = [
                  {
                    count: 1,
                    label: '1 Kişi',
                    badge: 'Solo',
                    desc: `Tüm roller & ${activeCuesCount} replik`,
                    theme: 'tile-yellow',
                  },
                  {
                    count: 2,
                    label: '2 Kişi',
                    badge: 'Düet',
                    desc: `~${Math.round(activeCuesCount / 2)}'şer replik`,
                    theme: 'tile-coral',
                  },
                  {
                    count: 3,
                    label: '3 Kişi',
                    badge: 'Trio',
                    desc: `~${Math.round(activeCuesCount / 3)}'er replik`,
                    theme: 'tile-sage',
                  },
                  {
                    count: 4,
                    label: '4 Kişi',
                    badge: 'Ekip',
                    desc: `~${Math.max(1, Math.round(activeCuesCount / 4))}'er replik`,
                    theme: 'tile-lilac',
                  },
                ];

                return (
                  <div className="bbank-player-count-box">
                    <label>KİŞİ SAYISI SEÇENEĞİ</label>
                    <div className="bbank-player-tiles-grid">
                      {options.map((opt) => {
                        const isSelected = maxPlayers === opt.count;
                        return (
                          <button
                            type="button"
                            key={opt.count}
                            className={`bbank-player-choice-tile ${opt.theme} ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => setMaxPlayers(opt.count)}
                          >
                            <div className="bbank-choice-head">
                              <span className="bbank-choice-type">{opt.badge}</span>
                              {isSelected && <Check size={14} className="bbank-choice-check" />}
                            </div>
                            <strong className="bbank-choice-val">{opt.label}</strong>
                            <span className="bbank-choice-desc">{opt.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {modal === 'join' && (
                <div className="bbank-form-field">
                  <label htmlFor="join-code">6 HANELİ ODA KODU</label>
                  <input
                    id="join-code"
                    className="bbank-input bbank-code-input"
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
                </div>
              )}

              <button type="submit" className="bbank-modal-submit-btn" disabled={busy}>
                {busy
                  ? 'Odaya giriliyor…'
                  : modal === 'create'
                    ? 'Odamı Oluştur ve Sahneye Çık ➔'
                    : 'Odaya Katıl ➔'}
              </button>

              {error && <p className="bbank-error">{error}</p>}
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================
          SCENE PREVIEW DIALOG
          ============================================================ */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            previewAudio.current?.pause();
            setPreview(null);
          }
        }}
      >
        <DialogContent className="bbank-dialog">
          <DialogTitle className="bbank-dialog-title">
            {previewScene?.title}
          </DialogTitle>
          <DialogDescription className="bbank-dialog-desc">
            {previewScene?.duration} saniye · {previewScene?.roles.length} karakter ·{' '}
            {previewScene?.instrumental
              ? 'Vokalsiz (Ses Efektli M&E) Önizleme'
              : 'Sahne Önizlemesi'}
          </DialogDescription>
          {previewScene && (
            <>
              {previewScene.instrumental && (
                /* oxlint-disable-next-line jsx-a11y/media-has-caption */
                <audio
                  ref={previewAudio}
                  src={previewScene.instrumental}
                  autoPlay
                  playsInline
                />
              )}
              {previewScene.video ? (
                /* oxlint-disable-next-line jsx-a11y/media-has-caption */
                <video
                  src={previewScene.video}
                  controls
                  autoPlay
                  playsInline
                  style={{
                    width: '100%',
                    borderRadius: 16,
                    aspectRatio: '16/9',
                    backgroundColor: '#000',
                  }}
                />
              ) : previewScene.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewScene.poster}
                  alt={previewScene.title}
                  style={{
                    width: '100%',
                    borderRadius: 16,
                    aspectRatio: '16/9',
                    objectFit: 'cover',
                  }}
                />
              ) : null}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 16,
                }}
              >
                <div style={{ fontSize: 13, color: '#a0a0a0' }}>
                  Karakterler: {previewScene.roles.join(', ')}
                </div>
                <button
                  type="button"
                  className="bbank-pill-btn bbank-pill-yellow"
                  style={{ padding: '10px 20px', fontSize: '14px' }}
                  onClick={() => {
                    previewAudio.current?.pause();
                    setPreview(null);
                    openCreate(selected);
                  }}
                >
                  Bu Sahneyle Başla ➔
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
