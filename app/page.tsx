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
  Film,
  KeyRound,
  Flame,
  Zap,
  Volume2,
  Share2,
  Download,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import Studio, { request, type Session } from './studio';
import {
  getAllScenes,
  getCustomScenes,
  fallbackScene,
  sceneCues,
  type Scene,
  type Room,
} from '@/lib/scenes';
import { getScenesFromSupabase } from '@/lib/supabase';
import {
  getPublishedDubsFromSupabase,
  likePublishedDubInSupabase,
  cleanupStaleUnpublishedRooms,
  type PublishedDub,
} from '@/lib/game-service';

export default function Home() {
  const [allScenes, setAllScenes] = useState<Scene[]>(() => {
    if (typeof window !== 'undefined') {
      const local = getCustomScenes();
      if (local.length > 0) return local;
    }
    return [];
  });
  const [publishedDubs, setPublishedDubs] = useState<PublishedDub[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('TÜMÜ');
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
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  async function refreshPublishedFeed() {
    const dubs = await getPublishedDubsFromSupabase().catch(() => []);
    setPublishedDubs(dubs);
  }

  useEffect(() => {
    void getScenesFromSupabase().then((dbScenes) => {
      if (dbScenes && dbScenes.length > 0) {
        setAllScenes(dbScenes);
      } else {
        setAllScenes(getCustomScenes());
      }
    });
    void refreshPublishedFeed();
    void cleanupStaleUnpublishedRooms();
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

  const activeCuesCount = sceneCues(activeScene.id, allScenes).length;

  return (
    <div className="app-shell maxi-theme">
      {!game && (
        <header className="topbar maxi-topbar">
          <Link href="/" className="brand maxi-brand" aria-label="Replik ana sayfa">
            <span className="brand-icon maxi-brand-icon">
              <AudioLines size={24} />
            </span>
            <span className="brand-text">
              replik<span className="brand-dot">✦</span>
            </span>
          </Link>
          <nav className="maxi-nav">
            <button
              className="maxi-nav-link active"
              onClick={() => {
                if (game) leave();
                else
                  document
                    .getElementById('sahneler')
                    ?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              🎪 Oyun Alanı
            </button>
            <a
              href="/editor"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = '/editor';
              }}
              className="maxi-nav-pill-btn"
            >
              <Sparkles size={14} /> Sahne Editörü 🎬
            </a>
            <button className="maxi-nav-link" onClick={() => setHelp(true)}>
              ❓ Nasıl Oynanır?
            </button>
            {!game && parked && (
              <button className="maxi-nav-link" onClick={() => setGame(parked)}>
                Odana dön ↗
              </button>
            )}
          </nav>
          <div className="maxi-topbar-actions">
            <span className="maxi-live-badge">
              <span className="maxi-pulse-dot" /> CANLI ODA
            </span>
          </div>
        </header>
      )}

      <main className={game ? 'game-mode-main' : 'maxi-main'}>
        {game ? (
          <Studio session={game.session} initial={game.room} onExit={leave} />
        ) : (
          <>
            {/* HERO SECTION: MAXIMALIST BENTO GRID */}
            <section className="maxi-hero-bento">
              {/* Bento 1: Featured Blockbuster Scene (Large) */}
              <div
                className="maxi-bento-featured"
                style={{
                  backgroundImage: activeScene.poster
                    ? `linear-gradient(180deg, rgba(6,8,5,0.4) 0%, rgba(6,8,5,0.92) 80%, rgba(6,8,5,0.98) 100%), url('${activeScene.poster}')`
                    : undefined,
                }}
              >
                <div className="maxi-featured-top">
                  <div className="maxi-pill-group">
                    <span className="maxi-pill maxi-pill-lime">
                      <Sparkles size={13} /> GÜNÜN SAHNESİ
                    </span>
                    <span className="maxi-pill maxi-pill-pink">
                      {activeScene.category.toUpperCase()}
                    </span>
                    <span className="maxi-pill maxi-pill-cyan">
                      ⏱️ 00:{activeScene.duration} SN
                    </span>
                  </div>
                  <button
                    className="maxi-preview-circle"
                    aria-label="Seçili sahneyi önizle"
                    onClick={() => setPreview(selected)}
                  >
                    <Play size={20} fill="currentColor" />
                  </button>
                </div>

                <div className="maxi-featured-bottom">
                  <span className="maxi-featured-eyebrow">
                    🎭 {activeScene.roles.length} KARAKTER · {activeCuesCount} REPLİK
                  </span>
                  <h1 className="maxi-featured-title">{activeScene.title}</h1>
                  <div className="maxi-featured-roles">
                    {activeScene.roles.map((r, rIdx) => (
                      <span key={r} className="maxi-role-tag">
                        🎭 {r}
                      </span>
                    ))}
                  </div>
                  <div className="maxi-featured-cta-row">
                    <button
                      className="maxi-btn maxi-btn-lime"
                      onClick={() => openCreate(selected)}
                    >
                      <Mic size={18} /> BU SAHNEYLE ODA KUR <ArrowRight size={18} />
                    </button>
                    <button
                      className="maxi-btn maxi-btn-glass"
                      onClick={() => setPreview(selected)}
                    >
                      <Volume2 size={16} /> Orijinal Sesi Dinle
                    </button>
                  </div>
                </div>
              </div>

              {/* Bento 2: Quick Room Joiner (Vivid Card) */}
              <div className="maxi-bento-join">
                <div className="maxi-join-badge">
                  <Zap size={15} /> EKİBİNE KATIL
                </div>
                <h2 className="maxi-join-title">Arkadaşının Odasına Gir</h2>
                <p className="maxi-join-desc">
                  Oda kodunu gir, rolünü kap, saniyeler içinde doğaçlama dublaja başla!
                </p>

                <form
                  className="maxi-join-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError('');
                    setModal('join');
                  }}
                >
                  <label htmlFor="code" className="maxi-join-label">
                    <KeyRound size={13} /> 6 HANELİ ODA KODU
                  </label>
                  <div className="maxi-join-input-wrap">
                    <input
                      id="code"
                      placeholder="ABC123"
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
                      className="maxi-join-input"
                    />
                    <button type="submit" className="maxi-join-submit-btn" aria-label="Odaya katıl">
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </form>

                <div className="maxi-join-divider">VEYA</div>

                <button
                  type="button"
                  className="maxi-btn maxi-btn-pink maxi-full-btn"
                  onClick={() => openCreate()}
                >
                  <Plus size={18} /> Yeni Oda Oluştur
                </button>

                <div className="maxi-join-hint">
                  <Headphones size={13} /> Kulaklığını tak, sahneye çık!
                </div>
              </div>
            </section>

            {/* BENTO STATS & FEATURES STRIP */}
            <section className="maxi-stats-bento">
              <div className="maxi-stat-card maxi-stat-lime">
                <div className="maxi-stat-icon">
                  <Flame size={22} />
                </div>
                <div className="maxi-stat-info">
                  <strong className="maxi-stat-val">1.8K+</strong>
                  <span className="maxi-stat-label">Tamamlanan Dublaj</span>
                </div>
              </div>

              <div className="maxi-stat-card maxi-stat-pink">
                <div className="maxi-stat-icon">
                  <Users size={22} />
                </div>
                <div className="maxi-stat-info">
                  <strong className="maxi-stat-val">1 Karakter</strong>
                  <span className="maxi-stat-label">1 Oyuncu (Adil Bölüşüm)</span>
                </div>
              </div>

              <div className="maxi-stat-card maxi-stat-cyan">
                <div className="maxi-stat-icon">
                  <AudioLines size={22} />
                </div>
                <div className="maxi-stat-info">
                  <strong className="maxi-stat-val">0 Gecikme</strong>
                  <span className="maxi-stat-label">Senkron M&E Ses Mikseri</span>
                </div>
              </div>

              <div className="maxi-stat-card maxi-stat-orange">
                <div className="maxi-stat-icon">
                  <Download size={22} />
                </div>
                <div className="maxi-stat-info">
                  <strong className="maxi-stat-val">MP4 İndir</strong>
                  <span className="maxi-stat-label">Tek Tıkla Reels & TikTok</span>
                </div>
              </div>
            </section>

            {/* 4-STEP HOW-TO-PLAY BENTO CARDS */}
            <section className="maxi-steps-section">
              <div className="maxi-section-head">
                <div className="maxi-section-badge">
                  <Sparkles size={13} /> ADIM ADIM REPLİK DENEYİMİ
                </div>
                <h2 className="maxi-section-title">Nasıl Oynanır?</h2>
              </div>

              <div className="maxi-steps-grid">
                <div className="maxi-step-card maxi-step-lime">
                  <span className="maxi-step-num">01</span>
                  <h3>Sahneni Seç & Odanı Kur</h3>
                  <p>1–4 kişilik oda seçeneğini belirle, oda kodunu arkadaşlarınla paylaş.</p>
                </div>

                <div className="maxi-step-card maxi-step-pink">
                  <span className="maxi-step-num">02</span>
                  <h3>Karakterini Gör</h3>
                  <p>Karakter & Replik tablosundan seslendireceğin replikleri keşfet.</p>
                </div>

                <div className="maxi-step-card maxi-step-cyan">
                  <span className="maxi-step-num">03</span>
                  <h3>Mikrofonla Doğaçla</h3>
                  <p>Önce orijinal sesi dinle, ardından mikrofona kendi yorumunu kaydet.</p>
                </div>

                <div className="maxi-step-card maxi-step-orange">
                  <span className="maxi-step-num">04</span>
                  <h3>Büyük Finali Birlikte İzle</h3>
                  <p>Herkes bitirdiğinde odadakilerle aynı anda izle, reaksiyon ver ve MP4 indir!</p>
                </div>
              </div>
            </section>

            {/* TOPLULUK DUBLAJLARI: YAYINLANAN DUBLAJLAR VİTRİNİ */}
            <section id="yayinlanan-dublajlar" className="maxi-published-section">
              <div className="maxi-section-head">
                <div className="maxi-section-badge">
                  <Flame size={13} /> CANLI TOPLULUK VİTRİNİ
                </div>
                <h2 className="maxi-section-title">İnsanların Yaptığı Dublajlar</h2>
                <p className="maxi-section-desc">
                  Büyük finalde &ldquo;Yayınla&rdquo; butonuna basılan en komik ve yaratıcı dublajlar.
                </p>
              </div>

              {publishedDubs.length === 0 ? (
                <div className="maxi-empty-published-card">
                  <Sparkles size={28} className="maxi-empty-sparkle" />
                  <div>
                    <strong>Henüz vitrinde yayınlanmış bir dublaj yok!</strong>
                    <p>
                      Bir sahneye girip dublajını kaydet, finalde{' '}
                      <b>&ldquo;Dublajı Ana Sayfada Yayınla&rdquo;</b> butonuna basarak ilk yayını sen yap!
                    </p>
                  </div>
                </div>
              ) : (
                <div className="maxi-published-grid">
                  {publishedDubs.map((dub) => (
                    <article key={dub.id} className="maxi-published-card">
                      <div className="maxi-pub-video-wrap">
                        <video
                          src={dub.videoUrl}
                          poster={dub.posterUrl || undefined}
                          controls
                          playsInline
                          preload="metadata"
                        />
                        <span className="maxi-pub-room-pill">
                          ODA #{dub.roomCode}
                        </span>
                      </div>
                      <div className="maxi-pub-content">
                        <div className="maxi-pub-header-row">
                          <div>
                            <span className="maxi-pub-category">{dub.category}</span>
                            <h3 className="maxi-pub-title">{dub.sceneTitle}</h3>
                          </div>
                          <button
                            type="button"
                            className="maxi-pub-like-pill"
                            onClick={async () => {
                              setPublishedDubs((prev) =>
                                prev.map((x) =>
                                  x.id === dub.id ? { ...x, likes: (x.likes || 0) + 1 } : x,
                                ),
                              );
                              const updated = await likePublishedDubInSupabase(dub.id).catch(
                                () => null,
                              );
                              if (updated) setPublishedDubs(updated);
                            }}
                          >
                            🔥 {dub.likes || 1}
                          </button>
                        </div>

                        <div className="maxi-pub-cast-pills">
                          {dub.players.map((p, idx) => (
                            <span key={idx} className="maxi-pub-cast-tag">
                              <span
                                className="maxi-pub-cast-dot"
                                style={{ background: p.roleColor || '#d8fb51' }}
                              />
                              <strong>{p.name}</strong> <small>({p.roleName})</small>
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* SCENE CATALOG BENTO GRID */}
            <section id="sahneler" className="maxi-catalog-section">
              <div className="maxi-section-head">
                <div className="maxi-section-badge">
                  <Film size={13} /> SAHNE KATALOĞU
                </div>
                <h2 className="maxi-section-title">Bir Sahne, Bin İhtimal</h2>
                <p className="maxi-section-desc">
                  İster popüler meme&apos;leri seslendir, ister kendi sahnini yükle!
                </p>
              </div>

              {/* Category Filter Chips */}
              <div className="maxi-category-chips">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`maxi-category-chip ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Scene Grid */}
              <div className="maxi-scenes-grid">
                {filteredScenes.map((s, i) => {
                  const isCur = selected === i;
                  const cues = sceneCues(s.id, allScenes);
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      className={`maxi-scene-card ${isCur ? 'is-selected' : ''}`}
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
                    >
                      <div
                        className="maxi-scene-poster"
                        style={
                          s.poster
                            ? {
                                backgroundImage: `linear-gradient(180deg, rgba(14,18,11,0.2) 0%, rgba(14,18,11,0.85) 100%), url('${s.poster}')`,
                              }
                            : undefined
                        }
                      >
                        <div className="maxi-scene-poster-top">
                          <span className="maxi-scene-index-badge">
                            #{String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="maxi-scene-dur-pill">
                            ⏱️ 00:{s.duration}
                          </span>
                        </div>

                        {s.isCustom && (
                          <span className="maxi-custom-scene-tag">
                            MEME / ÖZEL
                          </span>
                        )}

                        <div className="maxi-scene-poster-bottom">
                          <span className="maxi-scene-cat-badge">{s.category}</span>
                        </div>
                      </div>

                      <div className="maxi-scene-body">
                        <div className="maxi-scene-title-row">
                          <h3 className="maxi-scene-title">{s.title}</h3>
                          <a
                            href={`/editor?sceneId=${s.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.location.href = `/editor?sceneId=${s.id}`;
                            }}
                            className="maxi-edit-shortcut"
                            title="Bu sahneyi editörde düzenle"
                          >
                            <Edit3 size={13} />
                          </a>
                        </div>

                        <div className="maxi-scene-tags-row">
                          <span className="maxi-scene-mini-pill">
                            🎭 {s.roles.length} Karakter
                          </span>
                          <span className="maxi-scene-mini-pill">
                            📝 {cues.length} Replik
                          </span>
                        </div>

                        <div className="maxi-scene-actions">
                          <button
                            type="button"
                            className="maxi-btn maxi-btn-lime maxi-scene-start-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCreate(i);
                            }}
                          >
                            <Mic size={15} /> Oda Kur
                          </button>
                          <button
                            type="button"
                            className="maxi-btn maxi-btn-dark maxi-scene-preview-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview(i);
                            }}
                          >
                            <Play size={14} /> Dinle
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Create Custom Meme Scene Bento Tile */}
                <a
                  href="/editor"
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.href = '/editor';
                  }}
                  className="maxi-add-scene-card"
                >
                  <div className="maxi-add-scene-icon">
                    <Plus size={26} />
                  </div>
                  <h3>Kendi Meme / Sahnini Yükle</h3>
                  <p>YouTube veya yerel video yükle, replikleri saniyeler içinde altyazılandır 🎬</p>
                  <span className="maxi-add-scene-btn">
                    Editöre Git <ArrowRight size={15} />
                  </span>
                </a>
              </div>
            </section>
          </>
        )}
      </main>

      {/* HELP MODAL */}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="help-dialog maxi-dialog">
          <DialogTitle className="maxi-dialog-title">
            <Sparkles size={18} /> Her Ses Başka Bir Hikâye
          </DialogTitle>
          <DialogDescription className="maxi-dialog-desc">
            1–4 kişiyle, dört adımda kendi dublajınızı yaratın.
          </DialogDescription>
          <ol className="help-list maxi-help-list">
            <li>
              <strong>1. Bir Oda Kur:</strong> Sahneni seç, oyuncu adını yaz. Oda kodunu arkadaşlarınla paylaş.
            </li>
            <li>
              <strong>2. Rolünü Keşfet:</strong> Herkes hazır olduğunda kurucu başlatır. 1 Karakter = 1 Oyuncu kuralıyla karakterler adil dağıtılır.
            </li>
            <li>
              <strong>3. Bölümünü Kaydet:</strong> Önce orijinal sahne sesi çalar, ardından mikrofona doğaçlama seslendir.
            </li>
            <li>
              <strong>4. Finali Birlikte İzle:</strong> Herkes sesleri yüklediğinde senkronize sinema başlar. Reaksiyonlar ver ve MP4 indir!
            </li>
          </ol>
        </DialogContent>
      </Dialog>

      {/* CREATE & JOIN ROOM MODAL */}
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <DialogContent className="create-room-dialog maxi-dialog">
          <div className="create-room-container">
            {/* Header */}
            <div className="create-room-header">
              <div className="create-room-title-row">
                <span className="create-room-header-badge">
                  {modal === 'create' ? <Sparkles size={16} /> : <Users size={16} />}
                  {modal === 'create' ? 'ODANI KUR' : 'EKİBİNE KATIL'}
                </span>
                <span className="create-room-mode-tag">
                  {modal === 'create' ? `${maxPlayers} Kişilik Oda` : 'Canlı Oda'}
                </span>
              </div>
              <DialogTitle className="sr-only">
                {modal === 'create' ? 'Odanı Kur' : 'Ekibine Katıl'}
              </DialogTitle>
              <DialogDescription className="create-room-subtitle">
                {modal === 'create'
                  ? `${activeScene.title} · ${activeScene.category}`
                  : 'Arkadaşının paylaştığı 6 haneli oda koduyla hemen dublaj ekibine katıl.'}
              </DialogDescription>
            </div>

            {/* Selected Scene Spotlight Card (Only in Create Mode) */}
            {modal === 'create' && (
              <div className="create-room-scene-card">
                <div className="create-room-scene-top">
                  <div className="create-room-scene-icon">
                    <Film size={16} />
                  </div>
                  <div className="create-room-scene-info">
                    <span className="create-room-scene-eyebrow">SEÇİLİ SAHNE</span>
                    <strong className="create-room-scene-title">{activeScene.title}</strong>
                  </div>
                </div>
                <div className="create-room-scene-tags">
                  <span className="create-scene-tag">⏱️ 00:{activeScene.duration} sn</span>
                  <span className="create-scene-tag">🎭 {activeScene.roles.length} Karakter</span>
                  <span className="create-scene-tag">📝 {sceneCues(activeScene.id, allScenes).length} Replik</span>
                  <span className="create-scene-tag">🎬 {activeScene.category}</span>
                </div>
                {activeScene.roles && activeScene.roles.length > 0 && (
                  <div className="create-room-char-pills">
                    {activeScene.roles.map((r) => (
                      <span key={r} className="create-char-mini-tag">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <form onSubmit={enter} className="create-room-form">
              <div className="create-room-field-group">
                <label htmlFor="name" className="create-room-label">
                  <User size={13} /> Oyuncu Adın
                </label>
                <div className="create-room-input-wrap">
                  <input
                    id="name"
                    className="create-room-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={24}
                    required
                    placeholder="Sahnede sana ne diyelim?"
                    autoComplete="off"
                  />
                </div>
              </div>

              {modal === 'create' && (() => {
                const totalCuesCount = sceneCues(activeScene.id, allScenes).length;
                const options = [
                  {
                    count: 1,
                    label: '1 Kişi',
                    badge: 'Solo',
                    desc: `Tüm roller & ${totalCuesCount} replik sana ait`,
                    icon: User,
                  },
                  {
                    count: 2,
                    label: '2 Kişi',
                    badge: 'Düet',
                    desc: `~${Math.round(totalCuesCount / 2)}'şer replik (Karakter bölüşümü)`,
                    icon: Users,
                  },
                  {
                    count: 3,
                    label: '3 Kişi',
                    badge: 'Trio',
                    desc: `~${Math.round(totalCuesCount / 3)}'er replik (3'lü ekip)`,
                    icon: Users,
                  },
                  {
                    count: 4,
                    label: '4 Kişi',
                    badge: 'Ekip',
                    desc: `~${Math.max(1, Math.round(totalCuesCount / 4))}'er replik (Tam kadro)`,
                    icon: Users,
                  },
                ];

                return (
                  <div className="player-count-picker">
                    <div className="player-count-title">
                      <Users size={13} /> KİŞİ SAYISI SEÇENEĞİ
                    </div>
                    <div className="player-count-grid">
                      {options.map((opt) => {
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
                                <Icon size={13} />
                              </span>
                              <span className="count-badge-type">{opt.badge}</span>
                            </div>
                            <strong className="count-val">{opt.label}</strong>
                            <span className="count-subdesc">{opt.desc}</span>
                            {isSelected && (
                              <span className="count-selected-check">
                                <Check size={10} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {modal === 'join' && (
                <div className="create-room-field-group">
                  <label htmlFor="join-code" className="create-room-label">
                    <KeyRound size={13} /> 6 Haneli Oda Kodu
                  </label>
                  <div className="create-room-input-wrap">
                    <input
                      id="join-code"
                      className="create-room-input join-code-input"
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
                </div>
              )}

              <button className="primary create-room-submit-btn" disabled={busy}>
                {busy
                  ? 'Odaya giriliyor…'
                  : modal === 'create'
                    ? 'Odamı Oluştur ve Başla'
                    : 'Odaya Katıl'}
                <ArrowRight size={17} />
              </button>

              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* SCENE PREVIEW MODAL */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            previewAudio.current?.pause();
            setPreview(null);
          }
        }}
      >
        <DialogContent className="preview-dialog maxi-dialog">
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
                    borderRadius: 14,
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
                    borderRadius: 14,
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
                  marginTop: 14,
                }}
              >
                <div style={{ fontSize: 13, color: '#9ba889' }}>
                  Roller: {previewScene.roles.join(', ')}
                </div>
                <button
                  className="primary"
                  style={{ padding: '10px 18px', fontSize: '14px' }}
                  onClick={() => {
                    previewAudio.current?.pause();
                    setPreview(null);
                    openCreate(selected);
                  }}
                >
                  Bu Sahneyle Başla <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
