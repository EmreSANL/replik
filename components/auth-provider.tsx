'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, getScenesFromSupabase } from '@/lib/supabase';
import { getCustomScenes, type Scene } from '@/lib/scenes';
import {
  ReplikLoadingScreen,
  ReplikCurtainTransition,
  triggerReplikCurtain,
} from '@/components/replik-loading-screen';
import { LogOut, LogIn } from 'lucide-react';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  displayName: string;
  email: string;
  openAuthModal: (onSuccess?: () => void) => void;
  requireAuth: (onSuccess: () => void) => void;
  signOut: () => Promise<void>;
};

const defaultAuthContextValue: AuthContextValue = {
  user: null,
  loading: false,
  displayName: '',
  email: '',
  openAuthModal: () => {},
  requireAuth: (onSuccess) => onSuccess(),
  signOut: async () => {},
};

const globalForAuth = globalThis as unknown as {
  __replikAuthContext?: React.Context<AuthContextValue | null>;
};

const AuthContext =
  globalForAuth.__replikAuthContext ??
  (globalForAuth.__replikAuthContext = createContext<AuthContextValue | null>(
    defaultAuthContextValue,
  ));

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  return ctx ?? defaultAuthContextValue;
}

/**
 * Arka planda tek bir kare hücrede sahnenin belirli bir kesitini
 * sonsuz GIF döngüsü (loop) olarak oynatan bileşen.
 */
function LoopingGifTile({
  videoUrl,
  offsetSeed,
  onReady,
}: {
  videoUrl: string;
  offsetSeed: number;
  onReady?: () => void;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visibleRef = useRef(true);
  const readyFiredRef = useRef(false);
  const loopRangeRef = useRef<{ start: number; end: number }>({
    start: 1,
    end: 4.2,
  });

  useEffect(() => {
    const el = tileRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        visibleRef.current = entry.isIntersecting;
        const v = videoRef.current;
        if (!v) return;
        if (entry.isIntersecting) {
          if (v.paused) void v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      },
      { rootMargin: '80px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;

    const markReady = () => {
      if (!readyFiredRef.current) {
        readyFiredRef.current = true;
        onReady?.();
      }
    };

    const onLoaded = () => {
      const dur = Number.isFinite(v.duration) && v.duration > 2 ? v.duration : 15;
      const frac = ((offsetSeed * 0.29) % 0.72) + 0.1;
      const start = Math.max(0.2, Math.min(dur - 3.2, dur * frac));
      const end = Math.min(dur - 0.1, start + 3.0);
      loopRangeRef.current = { start, end };
      try {
        v.currentTime = start;
      } catch {}
      if (visibleRef.current) void v.play().catch(() => {});
      markReady();
    };

    const onTimeUpdate = () => {
      markReady();
      if (!visibleRef.current) return;
      const { start, end } = loopRangeRef.current;
      if (v.currentTime >= end || v.currentTime < start - 0.3) {
        try {
          v.currentTime = start;
        } catch {}
        if (v.paused) void v.play().catch(() => {});
      }
    };

    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('canplay', markReady);
    v.addEventListener('timeupdate', onTimeUpdate);
    if (v.readyState >= 1) onLoaded();

    return () => {
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('canplay', markReady);
      v.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [videoUrl, offsetSeed, onReady]);

  return (
    <div
      ref={tileRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        borderRadius: '16px',
        overflow: 'hidden',
        background: '#141418',
        border: '1px solid rgba(255, 255, 255, 0.07)',
      }}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        autoPlay
        loop
        preload="metadata"
        disablePictureInPicture
        disableRemotePlayback
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [mosaicReady, setMosaicReady] = useState(false);
  const [mosaicProgress, setMosaicProgress] = useState(18);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [bgScenes, setBgScenes] = useState<Scene[]>([]);
  const readyTilesCountRef = useRef(0);
  const pendingCallbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!active) return;
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setLoading(false);
      if (nextUser) {
        setModalOpen(false);
        if (pendingCallbackRef.current) {
          const cb = pendingCallbackRef.current;
          pendingCallbackRef.current = null;
          setTimeout(() => cb(), 50);
        }
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Arka plan kare GIF duvarı için sahneleri yükle ve videolar hazır olana kadar loading ekranını tut
  useEffect(() => {
    if (!modalOpen) return;
    readyTilesCountRef.current = 0;
    setMosaicReady(false);
    setMosaicProgress(24);

    const fallbackTimer = setTimeout(() => {
      setMosaicProgress(100);
      setMosaicReady(true);
    }, 2200);

    if (bgScenes.length === 0) {
      void getScenesFromSupabase().then((list) => {
        const valid = (list && list.length > 0 ? list : getCustomScenes()).filter(
          (s) => Boolean(s.video),
        );
        setBgScenes(valid);
        setMosaicProgress(45);
        if (valid.length === 0) {
          setMosaicProgress(100);
          setMosaicReady(true);
        }
      });
    } else {
      setMosaicProgress(50);
    }

    return () => clearTimeout(fallbackTimer);
  }, [modalOpen, bgScenes.length]);

  const handleTileReady = useCallback(() => {
    readyTilesCountRef.current += 1;
    const target = 6;
    const pct = Math.min(100, 45 + Math.round((readyTilesCountRef.current / target) * 55));
    setMosaicProgress(pct);
    if (readyTilesCountRef.current >= target) {
      setMosaicReady(true);
    }
  }, []);

  // Eğer doğrudan /editor sayfasına giriş yapmadan girildiyse giriş sayfasını aç
  useEffect(() => {
    if (!loading && !user && typeof window !== 'undefined') {
      if (window.location.pathname.startsWith('/editor')) {
        setModalOpen(true);
      }
    }
  }, [loading, user]);

  const openAuthModal = useCallback((onSuccess?: () => void) => {
    pendingCallbackRef.current = onSuccess || null;
    setError('');
    triggerReplikCurtain(
      'Giriş Yap / Üye Ol.',
      () => {
        setMosaicReady(true);
        setModalOpen(true);
      },
      { sublabel: 'Üyelik ekranı açılıyor...', accent: '#F5E636' },
    );
  }, []);

  const requireAuth = useCallback(
    (onSuccess: () => void) => {
      if (user) {
        onSuccess();
      } else {
        pendingCallbackRef.current = onSuccess;
        setError('');
        triggerReplikCurtain(
          'Giriş Yap / Üye Ol.',
          () => {
            setMosaicReady(true);
            setModalOpen(true);
          },
          { sublabel: 'Oynamak için giriş ekranı açılıyor...', accent: '#F5E636' },
        );
      }
    },
    [user],
  );

  async function handleAuthSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Lütfen geçerli bir e-posta adresi girin.');
      return;
    }
    if (password.length < 6) {
      setError('Şifreniz en az 6 karakter olmalıdır.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        const cleanName = playerName.trim().slice(0, 24);
        if (cleanName.length < 2) {
          setError('Lütfen en az 2 karakterlik bir oyuncu adı girin.');
          setSubmitting(false);
          return;
        }

        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              name: cleanName,
            },
          },
        });

        if (signUpErr) {
          if (
            signUpErr.message.toLowerCase().includes('already registered') ||
            signUpErr.message.toLowerCase().includes('already exists')
          ) {
            throw new Error(
              'Bu e-posta adresi zaten kayıtlı. Lütfen "Giriş Yap" sekmesinden giriş yapın.',
            );
          }
          throw new Error(signUpErr.message);
        }

        if (data.session?.user) {
          setUser(data.session.user);
          setModalOpen(false);
        } else {
          const { data: loginData, error: loginErr } =
            await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            });
          if (loginErr) throw new Error(loginErr.message);
          if (loginData.user) {
            setUser(loginData.user);
            setModalOpen(false);
          }
        }
      } else {
        const { data, error: signInErr } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

        if (signInErr) {
          if (signInErr.message.toLowerCase().includes('invalid login')) {
            throw new Error('E-posta adresi veya şifre hatalı.');
          }
          throw new Error(signInErr.message);
        }
        if (data.user) {
          setUser(data.user);
          setModalOpen(false);
        }
      }
    } catch (err) {
      setError((err as Error).message || 'Kimlik doğrulama başarısız oldu.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    sessionStorage.removeItem('replik-session');
    await supabase.auth.signOut();
    setUser(null);
    if (
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/editor')
    ) {
      window.location.href = '/';
    }
  }

  function closeAuthPage() {
    if (submitting) return;
    triggerReplikCurtain(
      'Replik.',
      () => {
        setModalOpen(false);
        pendingCallbackRef.current = null;
        if (
          typeof window !== 'undefined' &&
          !user &&
          window.location.pathname.startsWith('/editor')
        ) {
          window.location.href = '/';
        }
      },
      { sublabel: 'Ana sayfaya dönülüyor...', accent: '#B8E6C1' },
    );
  }

  // Ekranı üstten alta, soldan sağa boşluksuz dolduracak 32 adet optimize kare GIF kutusu üret
  const mosaicTiles = useMemo(() => {
    if (bgScenes.length === 0) return [];
    const count = 32;
    return Array.from({ length: count }, (_, idx) => {
      const sc = bgScenes[idx % bgScenes.length]!;
      return {
        key: `tile-${idx}-${sc.id}`,
        videoUrl: sc.video,
        seed: idx + 1,
      };
    });
  }, [bgScenes]);

  const displayName = user
    ? (user.user_metadata?.name as string)?.trim() ||
      user.email?.split('@')[0] ||
      'Oyuncu'
    : '';

  const accentColor = mode === 'login' ? '#F5E636' : '#FF6B4A';
  const accentInk = '#090909';

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        displayName,
        email: user?.email || '',
        openAuthModal,
        requireAuth,
        signOut: handleSignOut,
      }}
    >
      <ReplikCurtainTransition />
      {children}

      {/* TAM EKRAN KARE KARE GIF DUVARLI GİRİŞ / ÜYE OL SAYFASI */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#090909',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: 'var(--font-geist-sans), sans-serif',
          }}
        >
          <ReplikLoadingScreen
            visible={!mosaicReady}
            progress={mosaicProgress}
            statusText="Videolar yükleniyor..."
          />

          {/* 1. KATMAN: Üst ve Alt Dahil Tüm Ekranı Dolduran Kare GIF Mozaik Duvarı */}
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: '-64px',
              bottom: '-64px',
              left: '-48px',
              right: '-48px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gridAutoRows: 'max-content',
              gap: '10px',
              padding: '0',
              alignContent: 'start',
              pointerEvents: 'none',
            }}
          >
            {mosaicTiles.map((tile) => (
              <LoopingGifTile
                key={tile.key}
                videoUrl={tile.videoUrl}
                offsetSeed={tile.seed}
                onReady={handleTileReady}
              />
            ))}
          </div>

          {/* 2. KATMAN: Düz Yarı Karanlık Katman (Glow veya blur yok) */}
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(9, 9, 9, 0.62)',
              pointerEvents: 'none',
            }}
          />

          {/* Sol Üst: Ana Sayfaya Dön Butonu (Düz Solid Hap Buton) */}
          <button
            type="button"
            onClick={closeAuthPage}
            className="bbank-pill-btn bbank-pill-dark"
            style={{
              position: 'fixed',
              top: '22px',
              left: '22px',
              zIndex: 20,
              background: '#121212',
              border: '2px solid #2a2a2a',
              color: '#ffffff',
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 800,
            }}
          >
            Ana Sayfaya Dön
          </button>

          {/* 3. KATMAN: Sitenin Maximalist Solid Bento Tasarım Diline Uygun Giriş Kartı */}
          <div
            style={
              {
                position: 'relative',
                zIndex: 10,
                width: '100%',
                maxWidth: '440px',
                background: '#121212',
                border: '2px solid #2a2a2a',
                borderRadius: '26px',
                overflow: 'hidden',
                color: '#ffffff',
                '--input-focus-color': accentColor,
              } as React.CSSProperties
            }
          >
            {/* Üst Maximalist Solid Renk Bloğu (Sarı / Mercan Bento Başlığı) */}
            <div
              style={{
                background: accentColor,
                color: accentInk,
                padding: '26px 28px 22px',
                borderBottom: '2px solid #2a2a2a',
                transition: 'background-color 0.34s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div
                style={{
                  fontSize: '38px',
                  fontWeight: 900,
                  letterSpacing: '-0.055em',
                  lineHeight: 0.96,
                  marginBottom: '8px',
                }}
              >
                Replik.
              </div>
              <p
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  margin: 0,
                  color: '#1a1a17',
                  lineHeight: 1.35,
                }}
              >
                {mode === 'login'
                  ? 'Odaya katılmak ve dublaj yapmak için giriş yap.'
                  : 'Yeni oyuncu hesabı oluştur ve hemen sahneye çık.'}
              </p>
            </div>

            {/* Alt Form Gövdesi (Mat Siyah Bento İçeriği) */}
            <div style={{ padding: '24px 28px 28px' }}>
              {/* Giriş Yap / Üye Ol Kayar Animasyonlu Sekmeler (Solid Blok, Glow Yok) */}
              <div
                style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  background: '#1c1c1c',
                  padding: '6px',
                  borderRadius: '14px',
                  marginBottom: '20px',
                  border: '1.5px solid #2e2e2e',
                  overflow: 'hidden',
                }}
              >
                {/* Kayar Aktif Sekme Bloğu (Sliding Solid Indicator) */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: '6px',
                    bottom: '6px',
                    left: '6px',
                    width: 'calc(50% - 10px)',
                    borderRadius: '10px',
                    background: accentColor,
                    transform:
                      mode === 'login'
                        ? 'translate3d(0%, 0, 0)'
                        : 'translate3d(calc(100% + 8px), 0, 0)',
                    transition:
                      'transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.34s cubic-bezier(0.22, 1, 0.36, 1)',
                    pointerEvents: 'none',
                  }}
                />

                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    padding: '11px 14px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: mode === 'login' ? '#090909' : '#888888',
                    transition: 'color 0.25s ease',
                  }}
                >
                  Giriş Yap
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    padding: '11px 14px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: mode === 'register' ? '#090909' : '#888888',
                    transition: 'color 0.25s ease',
                  }}
                >
                  Üye Ol
                </button>
              </div>

              <form
                onSubmit={handleAuthSubmit}
                style={{ display: 'grid', gap: '0px' }}
              >
                {/* OYUNCU ADIN Alanı: Sekme Değişiminde Yumuşak Yükseklik & Kayma Animasyonu */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: mode === 'register' ? '1fr' : '0fr',
                    opacity: mode === 'register' ? 1 : 0,
                    marginBottom: mode === 'register' ? '14px' : '0px',
                    transform:
                      mode === 'register'
                        ? 'translate3d(0, 0, 0)'
                        : 'translate3d(0, -8px, 0)',
                    transition:
                      'grid-template-rows 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.26s ease, margin-bottom 0.34s cubic-bezier(0.22, 1, 0.36, 1), transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)',
                    pointerEvents: mode === 'register' ? 'auto' : 'none',
                  }}
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div className="bbank-form-field" style={{ paddingTop: '2px' }}>
                      <label htmlFor="mosaic-player-name">OYUNCU ADIN</label>
                      <input
                        id="mosaic-player-name"
                        type="text"
                        required={mode === 'register'}
                        tabIndex={mode === 'register' ? 0 : -1}
                        minLength={2}
                        maxLength={24}
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        placeholder="Sahnede görünecek adın"
                        className="bbank-input"
                      />
                    </div>
                  </div>
                </div>

                <div className="bbank-form-field" style={{ marginBottom: '14px' }}>
                  <label htmlFor="mosaic-auth-email">E-POSTA ADRESİ</label>
                  <input
                    id="mosaic-auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ornek@eposta.com"
                    autoComplete="email"
                    className="bbank-input"
                  />
                </div>

                <div className="bbank-form-field" style={{ marginBottom: '14px' }}>
                  <label htmlFor="mosaic-auth-password">ŞİFRE</label>
                  <input
                    id="mosaic-auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="En az 6 karakter"
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    className="bbank-input"
                  />
                </div>

                {error && (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: '12px',
                      background: '#241414',
                      border: '1.5px solid #FA5636',
                      color: '#ff8881',
                      fontSize: '13px',
                      fontWeight: 700,
                      marginBottom: '14px',
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="bbank-modal-submit-btn"
                  style={{
                    marginTop: '6px',
                    background: accentColor,
                    color: accentInk,
                    borderRadius: '999px',
                    padding: '15px 18px',
                    fontSize: '15px',
                    fontWeight: 900,
                    transition:
                      'background-color 0.34s cubic-bezier(0.22, 1, 0.36, 1), transform 0.15s ease',
                  }}
                >
                  {submitting
                    ? mode === 'login'
                      ? 'Giriş yapılıyor...'
                      : 'Üyelik oluşturuluyor...'
                    : mode === 'login'
                      ? 'Giriş Yap'
                      : 'Üye Ol'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function MemberTopbarBadge() {
  const { user, displayName, openAuthModal, signOut } = useAuth();

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => openAuthModal()}
        className="bbank-pill-btn bbank-pill-yellow"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
        }}
      >
        <LogIn size={13} /> Giriş Yap / Üye Ol
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: '#18181b',
        border: '1px solid #27272a',
        borderRadius: '999px',
        padding: '4px 6px 4px 12px',
        fontSize: '12px',
        fontWeight: 700,
        color: '#f4f4f5',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '999px',
          background: '#22c55e',
          display: 'inline-block',
        }}
      />
      <span>{displayName}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        title="Oturumu Kapat"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: '#27272a',
          color: '#fca5a5',
          border: 'none',
          borderRadius: '999px',
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <LogOut size={12} /> Çıkış
      </button>
    </div>
  );
}
