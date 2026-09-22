'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  ArrowRight,
  Headphones,
  Play,
  Sparkles,
  Check,
  Plus,
  Edit3,
  KeyRound,
  Flame,
  Volume2,
  Sliders,
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
  const [parked, setParked] = useState<{ session: Session; room: Room } | null>(null);
  const [help, setHelp] = useState(false);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [selected, setSelected] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [preview, setPreview] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [game, setGame] = useState<{ session: Session; room: Room } | null>(null);
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
    if (!hasScenes) {
      setError('Önce editörden bir sahne ekle.');
      return;
    }
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

  const activeCues = sceneCues(activeScene.id, allScenes);
  const activeCuesCount = activeCues.length;

  // Character breakdown for active scene
  const charStatsMap = new Map<string, number>();
  activeCues.forEach((c) => {
    const role = c.roleName || 'Karakter';
    charStatsMap.set(role, (charStatsMap.get(role) || 0) + 1);
  });
  const charStats = Array.from(charStatsMap.entries()).map(([roleName, count]) => ({
    name: roleName,
    count,
    pct: Math.round((count / Math.max(1, activeCuesCount)) * 100),
  }));

  // Distinct color themes for scene catalog cards
  const colorThemes = ['theme-lilac', 'theme-yellow', 'theme-sage', 'theme-coral', 'theme-olive'];

  return (
    <div className="bbank-shell">
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
                window.location.href = '/editor';
              }}
              className="bbank-pill-btn bbank-pill-sage"
            >
              <Sparkles size={13} /> Sahne Editörü
            </a>
            <button
              type="button"
              className="bbank-pill-btn bbank-pill-coral"
              onClick={() => {
                setError('');
                setModal('join');
              }}
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
          </div>
        </header>
      )}

      <main className={game ? 'game-mode-main' : 'bbank-main'}>
        {game ? (
          <Studio session={game.session} initial={game.room} onExit={leave} />
        ) : (
          <>
            {/* ============================================================
                THE BENTO TILES CANVAS (MATCHING REFERENCE IMAGE EXACTLY)
                ============================================================ */}
            <section className="bbank-bento-canvas">
              {/* Column 1 */}
              <div className="bbank-bento-col bbank-col-left">
                {/* Tile 1: Lilac Manifesto Card */}
                <div className="bbank-tile bbank-tile-lilac">
                  <span className="bbank-inner-pill">REPLİK / 01</span>
                  <p className="bbank-manifesto-text">
                    Bir sahne seç. Rolleri paylaş. Replikleri seslendir.
                    <strong> Finali birlikte izle.</strong>
                  </p>
                  <div className="bbank-manifesto-footer">
                    <span>1 Karakter = 1 Oyuncu</span>
                    <span>1–4 Kişilik</span>
                  </div>
                </div>

                {/* Tile 5: Olive Gold Growth / Soundwave Card */}
                <div className="bbank-tile bbank-tile-olive">
                  <div className="bbank-tile-head">
                    <span className="bbank-inner-pill">KAYIT AKIŞI / 02</span>
                    <Sliders size={16} />
                  </div>
                  <strong className="bbank-olive-metric">3 · 2 · 1</strong>
                  <span className="bbank-olive-sub">
                    Bölümü izle, geri sayımı bekle, seslendir.
                  </span>

                  {/* Soundwave Bar Chart Graphic */}
                  <div className="bbank-waveform-bars">
                    {[45, 75, 30, 90, 60, 40, 85, 95, 55, 70, 40, 80, 100, 65, 50, 85, 35, 75, 90, 60].map(
                      (h, idx) => (
                        <div
                          key={idx}
                          className="bbank-wave-bar"
                          style={{ height: `${h}%` }}
                        />
                      ),
                    )}
                  </div>
                </div>
              </div>

              {/* Column 2: Centerpiece Yellow Engagement Card */}
              <div className="bbank-bento-col bbank-col-center">
                {/* Tile 2: Sunny Yellow Scene Spotlight */}
                <div className={`bbank-tile bbank-tile-yellow ${hasScenes ? '' : 'is-empty'}`}>
                  <div className="bbank-tile-head">
                    <span className="bbank-inner-pill">SEÇİLİ SAHNE / 03</span>
                    <button
                      type="button"
                      className="bbank-sound-preview-btn"
                      onClick={() => setPreview(selected)}
                      title="Orijinal sahne sesini dinle"
                      disabled={!hasScenes}
                    >
                      <Volume2 size={16} /> Dinle
                    </button>
                  </div>

                  <div className="bbank-yellow-metric-row">
                    <strong className="bbank-yellow-metric">
                      {hasScenes ? `+${activeCuesCount} Replik` : 'İlk sahneyi ekle'}
                    </strong>
                    <span className="bbank-yellow-sub">
                      {hasScenes ? `${activeScene.roles.length} karakter · ${activeScene.duration} sn` : 'Video ve replikleri editörde hazırla'}
                    </span>
                  </div>

                  <h2 className="bbank-yellow-title">{hasScenes ? activeScene.title : 'Henüz sahne yok'}</h2>

                  {/* Character pill tags inside yellow tile */}
                  <div className="bbank-char-pills-row">
                    {hasScenes && activeScene.roles.map((r) => (
                      <span key={r} className="bbank-char-tag-pill">
                        {r}
                      </span>
                    ))}
                  </div>

                  {/* Action bottom pill button (Just like February 2024 pill button in reference) */}
                  {hasScenes ? (
                    <button type="button" className="bbank-tile-cta-pill" onClick={() => openCreate(selected)}>
                      <span>Bu sahneyle oda kur</span><ArrowRight size={16} />
                    </button>
                  ) : (
                    <Link href="/editor" className="bbank-tile-cta-pill">
                      <span>Sahne editörünü aç</span><ArrowRight size={16} />
                    </Link>
                  )}
                </div>

                {/* Wide Pill Action Buttons (Matching [TRADE CRYPTO] and [BANKWITHBBANK]) */}
                <div className="bbank-action-pills-row">
                  <button
                    type="button"
                    className="bbank-wide-pill bbank-pill-sage"
                    onClick={() => openCreate(selected)}
                    disabled={!hasScenes}
                  >
                    <Mic size={18} /> <strong>ODA KUR</strong>
                  </button>
                  <button
                    type="button"
                    className="bbank-wide-pill bbank-pill-coral"
                    onClick={() => {
                      setError('');
                      setModal('join');
                    }}
                  >
                    <KeyRound size={18} /> <strong>ODAYA GİR</strong>
                  </button>
                </div>
              </div>

              {/* Column 3: Right Side (Direct Debits Mint & Account Coral) */}
              <div className="bbank-bento-col bbank-col-right">
                {/* Tile 3: Sage Mint Character Breakdown ("Direct Debits" style) */}
                <div className="bbank-tile bbank-tile-sage">
                  <div className="bbank-tile-head">
                    <div>
                      <strong className="bbank-sage-title">Karakter Dağılımı</strong>
                      <span className="bbank-sage-subtitle">1 Karakter = 1 Oyuncu</span>
                    </div>
                    <span className="bbank-inner-pill">
                      {hasScenes ? `${activeScene.roles.length} karakter` : 'Sahne bekleniyor'}
                    </span>
                  </div>

                  {/* Spending limits style breakdown list */}
                  <div className="bbank-breakdown-list">
                    {hasScenes && charStats.map((cs) => (
                      <div key={cs.name} className="bbank-breakdown-item">
                        <div className="bbank-breakdown-text">
                          <span className="bbank-char-name">{cs.name}</span>
                          <strong className="bbank-char-cues">
                            {cs.count} Replik
                          </strong>
                        </div>
                        {/* Horizontal black indicator bar */}
                        <div className="bbank-breakdown-bar-track">
                          <div
                            className="bbank-breakdown-bar-fill"
                            style={{ width: `${Math.max(12, cs.pct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tile 4: Coral Orange Account / Quick Joiner */}
                <div className="bbank-tile bbank-tile-coral">
                  <div className="bbank-tile-head">
                    <span className="bbank-inner-pill">ODAYA KATIL / 04</span>
                    <KeyRound size={16} />
                  </div>

                  <form
                    className="bbank-coral-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setError('');
                      setModal('join');
                    }}
                  >
                    <label htmlFor="bbank-code" className="bbank-coral-label">
                      6 HANELİ ODA KODU
                    </label>
                    <input
                      id="bbank-code"
                      placeholder="ABC123"
                      value={code}
                      onChange={(e) =>
                        setCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, ''),
                        )
                      }
                      maxLength={6}
                      autoComplete="off"
                      className="bbank-coral-input"
                    />

                    <button type="submit" className="bbank-coral-submit-btn">
                      Odaya Gir ➔
                    </button>
                  </form>

                  <div className="bbank-coral-footer">
                    <Headphones size={13} />
                    <span>Kulaklığını tak, sahnede konuş!</span>
                  </div>
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
                  const isSelected = selected === i;

                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      className={`bbank-scene-tile ${theme} ${isSelected ? 'is-selected' : ''}`}
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
                      <div className="bbank-scene-tile-top">
                        <span className="bbank-scene-badge">#{i + 1}</span>
                        <span className="bbank-scene-dur">00:{s.duration} sn</span>
                      </div>

                      {/* Poster frame */}
                      <div
                        className="bbank-scene-poster-frame"
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
                        <a
                          href={`/editor?sceneId=${s.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.location.href = `/editor?sceneId=${s.id}`;
                          }}
                          className="bbank-scene-edit-btn"
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
                              openCreate(i);
                            }}
                          >
                            <Mic size={14} /> Oda Kur
                          </button>
                          <button
                            type="button"
                            className="bbank-scene-listen-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview(i);
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
                <Link
                  href="/editor"
                  className="bbank-scene-tile bbank-add-tile"
                >
                  <div className="bbank-add-icon">
                    <Plus size={28} />
                  </div>
                  <h3>Kendi Sahnini Ekle</h3>
                  <p>Video yükle, repliklerin zamanını belirle.</p>
                  <span className="bbank-add-btn-tag">Editöre git</span>
                </Link>
              </div>
            </section>

            {/* ============================================================
                TOPLULUK DUBLAJLARI (YAYINLANANLAR VİTRİNİ)
                ============================================================ */}
            <section id="yayinlanan-dublajlar" className="bbank-catalog-section">
              <div className="bbank-section-heading">
                <div>
                  <h2 className="bbank-section-title">İnsanların Yaptığı Dublajlar</h2>
                  <p className="bbank-section-desc">
                    Finalde &ldquo;Yayınla&rdquo; butonuna basılan topluluk dublajları.
                  </p>
                </div>
              </div>

              {publishedDubs.length === 0 ? (
                <div className="bbank-empty-card">
                  <Sparkles size={24} />
                  <div>
                    <strong>Henüz yayınlanan dublaj yok.</strong>
                    <p>
                      Finalde &ldquo;Dublajı ana sayfada yayınla&rdquo; seçeneğiyle ilk kaydı paylaşabilirsin.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bbank-published-grid">
                  {publishedDubs.map((dub) => (
                    <article key={dub.id} className="bbank-pub-card">
                      <div className="bbank-pub-video-frame">
                        <video
                          src={dub.videoUrl}
                          poster={dub.posterUrl || undefined}
                          controls
                          playsInline
                          preload="metadata"
                        />
                        <span className="bbank-pub-room-pill">
                          ODA #{dub.roomCode}
                        </span>
                      </div>
                      <div className="bbank-pub-body">
                        <div className="bbank-pub-head">
                          <div>
                            <span className="bbank-pub-cat">{dub.category}</span>
                            <h3 className="bbank-pub-title">{dub.sceneTitle}</h3>
                          </div>
                          <button
                            type="button"
                            className="bbank-pub-like-btn"
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
                            <Flame size={14} /> {dub.likes || 1}
                          </button>
                        </div>

                        <div className="bbank-pub-players-row">
                          {dub.players.map((p, idx) => (
                            <span key={idx} className="bbank-pub-player-chip">
                              <span
                                className="bbank-pub-player-dot"
                                style={{ background: p.roleColor || '#F5E636' }}
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
