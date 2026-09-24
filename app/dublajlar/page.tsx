'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Clapperboard,
  Heart,
  MessageCircle,
  Mic2,
  Pause,
  Play,
  Send,
  Share2,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  getPublishedDubsFromSupabase,
  toggleLikePublishedDubInSupabase,
  addCommentToPublishedDubInSupabase,
  deleteCommentFromPublishedDubInSupabase,
  type PublishedDub,
} from '@/lib/game-service';
import { useAuth } from '@/components/auth-provider';
import { ReplikLoadingScreen } from '@/components/replik-loading-screen';
import { ReplikSiteHeader } from '@/components/replik-site-header';

type SortBy = 'latest' | 'popular' | 'discussed' | 'liked';
const sortTabs: { id: SortBy; label: string }[] = [
  { id: 'latest', label: 'Yeni' },
  { id: 'popular', label: 'Popüler' },
  { id: 'discussed', label: 'Çok konuşulan' },
  { id: 'liked', label: 'Beğendiklerim' },
];
const accents = ['#F5E636', '#9E8CA9', '#FA5636', '#CDE2CD'];

function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Az önce';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa önce`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} gün önce`;
  return new Date(timestamp).toLocaleDateString('tr-TR');
}

export default function DublajlarPage() {
  const { user, displayName, requireAuth } = useAuth();
  const [dubs, setDubs] = useState<PublishedDub[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortBy>('latest');
  const [category, setCategory] = useState('TÜMÜ');
  const [highlightedId] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('post'),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [commentsId, setCommentsId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedInView, setFeedInView] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const refresh = useCallback(async () => {
    const list = await getPublishedDubsFromSupabase().catch(() => []);
    setDubs(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);

  const categories = useMemo(
    () => [
      'TÜMÜ',
      ...Array.from(new Set(dubs.map((dub) => dub.category).filter(Boolean))),
    ],
    [dubs],
  );
  const visibleDubs = useMemo(() => {
    const list = dubs.filter(
      (dub) => category === 'TÜMÜ' || dub.category === category,
    );
    if (sortBy === 'liked') {
      const liked = list.filter(
        (dub) => user && (dub.likedBy || []).includes(user.id),
      );
      list.splice(0, list.length, ...liked);
    } else if (sortBy === 'popular')
      list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else if (sortBy === 'discussed')
      list.sort(
        (a, b) => (b.comments?.length || 0) - (a.comments?.length || 0),
      );
    else list.sort((a, b) => b.createdAt - a.createdAt);
    if (highlightedId) {
      const index = list.findIndex((dub) => dub.id === highlightedId);
      if (index > 0) list.unshift(...list.splice(index, 1));
    }
    return list;
  }, [dubs, category, sortBy, user, highlightedId]);

  const currentActiveId = visibleDubs.some((dub) => dub.id === activeId)
    ? activeId
    : visibleDubs[0]?.id || null;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !visibleDubs.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best && best.intersectionRatio >= 0.55)
          setActiveId((best.target as HTMLElement).dataset.dubId || null);
      },
      { root, threshold: [0.55, 0.7, 0.9] },
    );
    root
      .querySelectorAll<HTMLElement>('[data-dub-id]')
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [visibleDubs]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setFeedInView(
          entry.isIntersecting && document.visibilityState === 'visible',
        ),
      { threshold: 0.25 },
    );
    observer.observe(element);
    const onVisibilityChange = () =>
      setFeedInView(
        document.visibilityState === 'visible' &&
          element.getBoundingClientRect().top < window.innerHeight &&
          element.getBoundingClientRect().bottom > 0,
      );
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [visibleDubs.length]);
  useEffect(() => {
    videoRefs.current.forEach((video, id) => {
      video.muted = muted;
      if (
        !feedInView ||
        id !== currentActiveId ||
        pausedId === id ||
        commentsId
      )
        video.pause();
      else void video.play().catch(() => setPausedId(id));
    });
  }, [currentActiveId, muted, pausedId, commentsId, visibleDubs, feedInView]);

  const activeIndex = Math.max(
    0,
    visibleDubs.findIndex((dub) => dub.id === currentActiveId),
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        if (activeIndex < visibleDubs.length - 1) scrollTo(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeIndex > 0) scrollTo(activeIndex - 1);
      } else if (e.key === 'm' || e.key === 'M') {
        setMuted((current) => !current);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, visibleDubs.length]);
  const commentsDub = dubs.find((dub) => dub.id === commentsId);
  const totalLikes = dubs.reduce((sum, dub) => sum + (dub.likes || 0), 0);

  function scrollTo(index: number) {
    const dub = visibleDubs[index];
    if (!dub) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-dub-index="${index}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(dub.id);
    setPausedId(null);
  }
  function changeSort(next: SortBy) {
    if (next === 'liked' && !user)
      requireAuth(() => {
        setSortBy('liked');
        setActiveId(null);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
    else {
      setSortBy(next);
      setActiveId(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }
  function toggleLike(dub: PublishedDub) {
    requireAuth(() => {
      if (user) {
        const liked = (dub.likedBy || []).includes(user.id);
        setDubs((current) =>
          current.map((item) =>
            item.id === dub.id
              ? {
                  ...item,
                  likes: Math.max(0, (item.likes || 0) + (liked ? -1 : 1)),
                  likedBy: liked
                    ? (item.likedBy || []).filter((id) => id !== user.id)
                    : [...(item.likedBy || []), user.id],
                }
              : item,
          ),
        );
      }
      void toggleLikePublishedDubInSupabase(dub.id)
        .then(setDubs)
        .catch(() => void refresh());
    });
  }
  function submitComment(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commentText.trim();
    if (!commentsDub || !text || submitting) return;
    const dubId = commentsDub.id;
    requireAuth(() => {
      setSubmitting(true);
      setCommentText('');
      setDubs((current) =>
        current.map((dub) =>
          dub.id === dubId
            ? {
                ...dub,
                comments: [
                  ...(dub.comments || []),
                  {
                    id: `temp-${Date.now()}`,
                    userId: user?.id || 'me',
                    userName: displayName || 'Oyuncu',
                    text,
                    createdAt: Date.now(),
                  },
                ],
              }
            : dub,
        ),
      );
      void addCommentToPublishedDubInSupabase(dubId, text)
        .then(setDubs)
        .catch(() => {
          setCommentText(text);
          void refresh();
        })
        .finally(() => setSubmitting(false));
    });
  }
  function deleteComment(dubId: string, commentId: string) {
    requireAuth(() => {
      setDubs((current) =>
        current.map((dub) =>
          dub.id === dubId
            ? {
                ...dub,
                comments: (dub.comments || []).filter(
                  (comment) => comment.id !== commentId,
                ),
              }
            : dub,
        ),
      );
      void deleteCommentFromPublishedDubInSupabase(dubId, commentId)
        .then(setDubs)
        .catch(() => void refresh());
    });
  }
  async function share(dubId: string) {
    const url = `${window.location.origin}/dublajlar?post=${encodeURIComponent(dubId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(dubId);
      window.setTimeout(
        () => setCopiedId((current) => (current === dubId ? null : current)),
        2200,
      );
    } catch {
      if (navigator.share)
        await navigator.share({ title: 'Replik dublajı', url }).catch(() => {});
    }
  }

  return (
    <div className="bbank-shell dub-page">
      <ReplikLoadingScreen
        visible={loading}
        progress={loading ? 56 : 100}
        statusText="Dublaj akışı yükleniyor..."
      />
      <ReplikSiteHeader
        active="feed"
        subtitle="Topluluğun seslendirdiği sahneler."
      />
      <main className="dub-main">

        <section
          id="akis"
          className="dub-feed-section"
          aria-label="Dublaj akışı"
        >
          <div className="dub-feed-toolbar">
            <div className="dub-toolbar-title">
              <span className="dub-toolbar-icon">
                <Clapperboard size={22} />
              </span>
              <div>
                <span>ŞİMDİ OYNATILIYOR</span>
                <strong>Topluluk akışı</strong>
              </div>
            </div>
            <div className="dub-feed-tabs" aria-label="Akış sıralaması">
              {sortTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={sortBy === tab.id ? 'is-active' : ''}
                  aria-pressed={sortBy === tab.id}
                  onClick={() => changeSort(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="dub-count-label">
              {dubs.length} DUBLAJ • {totalLikes} BEĞENİ
            </span>
          </div>
          {categories.length > 1 && (
            <div className="dub-categories" aria-label="Kategori filtreleri">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={category === item ? 'is-active' : ''}
                  aria-pressed={category === item}
                  onClick={() => {
                    setCategory(item);
                    setActiveId(null);
                    if (scrollRef.current) scrollRef.current.scrollTop = 0;
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
          {visibleDubs.length ? (
            <div className="dub-feed-frame">
              <div
                className="dub-feed-scroller"
                ref={scrollRef}
                aria-label="Dublajlar arasında yukarı aşağı kaydır"
              >
                {visibleDubs.map((dub, index) => {
                  const isLiked = Boolean(
                    user && (dub.likedBy || []).includes(user.id),
                  );
                  const isActive = currentActiveId === dub.id;
                  const accent = accents[index % accents.length];
                  return (
                      <article
                      className="dub-slide"
                      key={dub.id}
                      data-dub-id={dub.id}
                      data-dub-index={index}
                      style={{ '--dub-accent': accent } as React.CSSProperties}
                    >
                      <div className="dub-slide-info">
                        <span className="dub-video-category">
                          {dub.category || 'SAHNE'}
                        </span>
                        <h2>{dub.sceneTitle}</h2>
                        <p>
                          {dub.players?.length
                            ? dub.players
                                .map((player) => `@${player.name}`)
                                .join('  ×  ')
                            : '@Oyuncu'}
                        </p>
                        <span className="dub-slide-time">
                          {relativeTime(dub.createdAt)}
                        </span>
                      </div>
                      <div className="dub-video-shell">
                        {dub.posterUrl && (
                          <div
                            className="dub-video-backdrop"
                            style={{
                              backgroundImage: `url("${dub.posterUrl}")`,
                            }}
                            aria-hidden="true"
                          />
                        )}
                        {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                          ref={(element) => {
                            if (element)
                              videoRefs.current.set(dub.id, element);
                            else videoRefs.current.delete(dub.id);
                          }}
                          src={dub.videoUrl}
                          poster={dub.posterUrl || undefined}
                          muted={muted}
                          playsInline
                          loop
                          preload={
                            index <= activeIndex + 1 ? 'metadata' : 'none'
                          }
                          onClick={() => {
                            if (isActive)
                              setPausedId((current) =>
                                current === dub.id ? null : dub.id,
                              );
                          }}
                          onDoubleClick={() => toggleLike(dub)}
                          aria-label={`${dub.sceneTitle} dublaj videosu`}
                        />

                        {isActive && pausedId === dub.id && (
                          <button
                            type="button"
                            className="dub-big-play"
                            aria-label="Videoyu oynat"
                            onClick={() => setPausedId(null)}
                          >
                            <Play size={31} fill="currentColor" />
                          </button>
                        )}
                        <div className="dub-video-controls">
                          <button
                            type="button"
                            aria-label={
                              pausedId === dub.id ? 'Oynat' : 'Duraklat'
                            }
                            onClick={() =>
                              setPausedId((current) =>
                                current === dub.id ? null : dub.id,
                              )
                            }
                          >
                            {pausedId === dub.id ? (
                              <Play size={18} fill="currentColor" />
                            ) : (
                              <Pause size={18} fill="currentColor" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={muted ? 'Sesi aç' : 'Sesi kapat'}
                            onClick={() => setMuted((current) => !current)}
                          >
                            {muted ? (
                              <VolumeX size={20} />
                            ) : (
                              <Volume2 size={20} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="dub-action-rail">
                        <button
                          type="button"
                          className={isLiked ? 'is-liked' : ''}
                          onClick={() => toggleLike(dub)}
                          aria-label={`Beğen, ${dub.likes || 0} beğeni`}
                          aria-pressed={isLiked}
                        >
                          <Heart
                            size={25}
                            fill={isLiked ? 'currentColor' : 'none'}
                          />
                          <span>{dub.likes || 0}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCommentsId(dub.id);
                            setCommentText('');
                          }}
                          aria-label={`${dub.comments?.length || 0} yorumu aç`}
                        >
                          <MessageCircle size={25} />
                          <span>{dub.comments?.length || 0}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void share(dub.id)}
                          aria-label="Dublajı paylaş"
                        >
                          <Share2 size={25} />
                          <span>
                            {copiedId === dub.id ? 'Kopyalandı' : 'Paylaş'}
                          </span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="dub-feed-navigation">
                <span>
                  {String(activeIndex + 1).padStart(2, '0')} <i>/</i>{' '}
                  {String(visibleDubs.length).padStart(2, '0')}
                </span>
                <div>
                  <button
                    type="button"
                    onClick={() => scrollTo(activeIndex - 1)}
                    disabled={activeIndex === 0}
                    aria-label="Önceki dublaj"
                  >
                    <ArrowUp size={21} />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollTo(activeIndex + 1)}
                    disabled={activeIndex >= visibleDubs.length - 1}
                    aria-label="Sonraki dublaj"
                  >
                    <ArrowDown size={21} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            !loading && (
              <div className="dub-empty">
                <div className="dub-empty-symbol">
                  <Clapperboard size={76} strokeWidth={1.3} />
                </div>
                <span>
                  {sortBy === 'liked'
                    ? 'BEĞENDİKLERİM'
                    : category === 'TÜMÜ'
                      ? 'İLK PERDE'
                      : category}
                </span>
                <h2>
                  {sortBy === 'liked'
                    ? 'Henüz beğendiğin bir dublaj yok.'
                    : category !== 'TÜMÜ'
                      ? 'Bu kategoride henüz dublaj yok.'
                      : 'Sahne hazır. İlk ses seninki olsun.'}
                </h2>
                <p>
                  Bir sahne seç, dublajını kaydet ve burada herkesle paylaş.
                </p>
                <div>
                  <Link href="/#sahneler">
                    <Mic2 size={19} /> Sahne seç ve başla{' '}
                    <ArrowRight size={18} />
                  </Link>
                  {(sortBy === 'liked' || category !== 'TÜMÜ') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSortBy('latest');
                        setCategory('TÜMÜ');
                      }}
                    >
                      Tüm akışı gör
                    </button>
                  )}
                </div>
              </div>
            )
          )}
        </section>
        <div className="dub-footer-strip">
          <span>SESİNİ DUYUR ✳ SAHNEYİ PAYLAŞ ✳ TOPLULUĞA KATIL</span>
          <Link href="/nasil-oynanir">
            Nasıl oynanır? <ArrowRight size={18} />
          </Link>
        </div>
      </main>
      {commentsDub && (
        <div className="dub-comments-layer">
          <button type="button" className="dub-comments-backdrop" aria-label="Yorumları kapat" onClick={() => setCommentsId(null)} />
          <dialog
            open
            className="dub-comments-drawer"
            aria-modal="true"
            aria-label={`${commentsDub.sceneTitle} yorumları`}
          >
            <div className="dub-comments-head">
              <div>
                <span>TOPLULUK SOHBETİ</span>
                <h2>
                  Yorumlar <b>{commentsDub.comments?.length || 0}</b>
                </h2>
              </div>
              <button
                type="button"
                aria-label="Yorumları kapat"
                onClick={() => setCommentsId(null)}
              >
                <X size={22} />
              </button>
            </div>
            <p className="dub-comments-context">
              {commentsDub.sceneTitle} ·{' '}
              {commentsDub.players
                ?.map((player) => `@${player.name}`)
                .join(', ')}
            </p>
            <div className="dub-comments-list">
              {commentsDub.comments?.length ? (
                commentsDub.comments.map((comment, index) => (
                  <div className="dub-comment" key={comment.id}>
                    <span
                      className="dub-avatar"
                      style={{ background: accents[index % accents.length] }}
                    >
                      {comment.userName?.slice(0, 1).toUpperCase() || 'O'}
                    </span>
                    <div>
                      <div className="dub-comment-meta">
                        <strong>@{comment.userName}</strong>
                        <time>{relativeTime(comment.createdAt)}</time>
                      </div>
                      <p>{comment.text}</p>
                    </div>
                    {user?.id === comment.userId && (
                      <button
                        type="button"
                        onClick={() =>
                          deleteComment(commentsDub.id, comment.id)
                        }
                        aria-label="Yorumu sil"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="dub-no-comments">
                  <MessageCircle size={43} />
                  <strong>İlk yorumu sen yaz!</strong>
                  <span>Bu dublaja ne diyorsun?</span>
                </div>
              )}
            </div>
            <form onSubmit={submitComment} className="dub-comment-form">
              <input
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                maxLength={400}
                placeholder="Bir yorum bırak..."
                aria-label="Yorumun"
              />
              <button
                type="submit"
                disabled={!commentText.trim() || submitting}
                aria-label="Yorumu gönder"
              >
                {submitting ? <span>...</span> : <Send size={20} />}
              </button>
            </form>
          </dialog>
        </div>
      )}
    </div>
  );
}
