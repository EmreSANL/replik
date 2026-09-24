'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getPublishedDubsFromSupabase,
  toggleLikePublishedDubInSupabase,
  addCommentToPublishedDubInSupabase,
  deleteCommentFromPublishedDubInSupabase,
  type PublishedDub,
} from '@/lib/game-service';
import { useAuth, MemberTopbarBadge } from '@/components/auth-provider';
import { ReplikLoadingScreen } from '@/components/replik-loading-screen';

const AVATAR_COLORS = ['#F5E636', '#FF6B4A', '#B8E6C1', '#D4C2FC'];

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return 'Az önce';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} saat önce`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} gün önce`;
  return new Date(timestamp).toLocaleDateString('tr-TR');
}

export default function DublajlarSocialFeedPage() {
  const { user, displayName, requireAuth } = useAuth();
  const [dubs, setDubs] = useState<PublishedDub[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(30);
  const [sortBy, setSortBy] = useState<'latest' | 'popular' | 'discussed' | 'liked'>('latest');
  const [selectedCategory, setSelectedCategory] = useState<string>('TÜMÜ');
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [submittingCommentId, setSubmittingCommentId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setProgress(55);
    const list = await getPublishedDubsFromSupabase().catch(() => []);
    setDubs(list);
    setProgress(100);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadFeed();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const postParam = params.get('post');
      if (postParam) setHighlightedPostId(postParam);
    }
    const interval = setInterval(() => {
      void getPublishedDubsFromSupabase()
        .then((list) => setDubs(list))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [loadFeed]);

  const categories = ['TÜMÜ', 'MEME & MİZAH', 'DİZİ & FİLM', 'ANİME', 'YEŞİLÇAM'];

  const filteredAndSortedDubs = useMemo(() => {
    let list = [...dubs];

    if (selectedCategory !== 'TÜMÜ') {
      list = list.filter((d) =>
        (d.category || '')
          .toLocaleLowerCase('tr')
          .includes(selectedCategory.toLocaleLowerCase('tr')),
      );
    }

    if (sortBy === 'liked' && user) {
      list = list.filter((d) => (d.likedBy || []).includes(user.id));
    } else if (sortBy === 'popular') {
      list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    } else if (sortBy === 'discussed') {
      list.sort(
        (a, b) => (b.comments?.length || 0) - (a.comments?.length || 0),
      );
    } else {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    if (highlightedPostId) {
      const targetIdx = list.findIndex((d) => d.id === highlightedPostId);
      if (targetIdx > 0) {
        const [target] = list.splice(targetIdx, 1);
        list.unshift(target);
      }
    }

    return list;
  }, [dubs, selectedCategory, sortBy, user, highlightedPostId]);

  const totalLikes = useMemo(
    () => dubs.reduce((acc, d) => acc + (Number(d.likes) || 0), 0),
    [dubs],
  );
  const totalComments = useMemo(
    () => dubs.reduce((acc, d) => acc + (d.comments?.length || 0), 0),
    [dubs],
  );

  function handleToggleLike(dub: PublishedDub) {
    requireAuth(() => {
      const uid = user?.id;
      if (!uid) return;
      const currentlyLiked = (dub.likedBy || []).includes(uid);

      // Optimistic update
      setDubs((prev) =>
        prev.map((item) => {
          if (item.id !== dub.id) return item;
          const prevLikedBy = item.likedBy || [];
          const nextLikedBy = currentlyLiked
            ? prevLikedBy.filter((id) => id !== uid)
            : [...prevLikedBy, uid];
          const nextLikes = Math.max(
            0,
            currentlyLiked ? (item.likes || 1) - 1 : (item.likes || 0) + 1,
          );
          return { ...item, likes: nextLikes, likedBy: nextLikedBy };
        }),
      );

      void toggleLikePublishedDubInSupabase(dub.id)
        .then((updated) => {
          if (updated) setDubs(updated);
        })
        .catch(() => {});
    });
  }

  function handleCommentSubmit(e: React.FormEvent, dubId: string) {
    e.preventDefault();
    const rawText = (commentInputs[dubId] || '').trim();
    if (!rawText) return;

    requireAuth(() => {
      setSubmittingCommentId(dubId);
      const optimisticComment = {
        id: `temp_${Date.now()}`,
        userId: user?.id || 'me',
        userName: displayName || 'Oyuncu',
        text: rawText,
        createdAt: Date.now(),
      };

      setDubs((prev) =>
        prev.map((item) =>
          item.id === dubId
            ? { ...item, comments: [...(item.comments || []), optimisticComment] }
            : item,
        ),
      );
      setCommentInputs((prev) => ({ ...prev, [dubId]: '' }));

      void addCommentToPublishedDubInSupabase(dubId, rawText)
        .then((updated) => {
          if (updated) setDubs(updated);
        })
        .finally(() => {
          setSubmittingCommentId(null);
        });
    });
  }

  function handleDeleteComment(dubId: string, commentId: string) {
    requireAuth(() => {
      setDubs((prev) =>
        prev.map((item) =>
          item.id === dubId
            ? {
                ...item,
                comments: (item.comments || []).filter((c) => c.id !== commentId),
              }
            : item,
        ),
      );
      void deleteCommentFromPublishedDubInSupabase(dubId, commentId).then(
        (updated) => {
          if (updated) setDubs(updated);
        },
      );
    });
  }

  function handleSharePost(dubId: string) {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/dublajlar?post=${encodeURIComponent(dubId)}`;
    void navigator.clipboard?.writeText(url);
    setCopiedId(dubId);
    setTimeout(() => {
      setCopiedId((prev) => (prev === dubId ? null : prev));
    }, 2000);
  }

  return (
    <div className="bbank-shell" style={{ minHeight: '100vh', background: '#090909' }}>
      <ReplikLoadingScreen
        visible={loading}
        progress={progress}
        statusText="Topluluk dublaj akışı yükleniyor..."
      />

      {/* ÜST BAR (SİTENİN MAXIMALIST SOLID BENTO HEADER'I) */}
      <header className="bbank-topbar">
        <div className="bbank-topbar-left">
          <Link href="/" className="bbank-brand" aria-label="Replik ana sayfa">
            <span className="bbank-brand-title">Replik</span>
          </Link>
          <span className="bbank-date-label">
            Topluluk Dublaj Akışı
          </span>
        </div>

        <div className="bbank-topbar-right">
          <Link href="/" className="bbank-pill-btn bbank-pill-dark">
            Sahneler &amp; Oyun
          </Link>
          <Link
            href="/dublajlar"
            className="bbank-pill-btn bbank-pill-yellow"
          >
            Dublaj Akışı
          </Link>
          <Link href="/editor" className="bbank-pill-btn bbank-pill-coral">
            + Sahne Yükle
          </Link>
          <MemberTopbarBadge />
        </div>
      </header>

      <main
        style={{
          maxWidth: '1240px',
          margin: '0 auto',
          padding: '28px 4% 80px',
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 310px) minmax(0, 1fr)',
          gap: '24px',
          alignItems: 'start',
        }}
        className="replik-social-layout"
      >
        <style>{`
          @media (max-width: 900px) {
            .replik-social-layout {
              grid-template-columns: 1fr !important;
            }
            .replik-social-sidebar {
              position: static !important;
            }
          }
        `}</style>

        {/* SOL SÜTUN: SOSYAL MEDYA MENÜSÜ, SIRALAMA VE İSTATİSTİK BENTO KARTLARI */}
        <aside
          className="replik-social-sidebar"
          style={{
            position: 'sticky',
            top: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Sarı Maximalist Başlık Bloğu */}
          <div
            style={{
              background: '#F5E636',
              color: '#090909',
              borderRadius: '24px',
              padding: '24px',
              border: '2px solid #2a2a2a',
            }}
          >
            <h1
              style={{
                fontSize: '32px',
                fontWeight: 900,
                letterSpacing: '-0.05em',
                lineHeight: 0.98,
                margin: '0 0 8px 0',
                color: '#090909',
              }}
            >
              Dublaj Akışı.
            </h1>
            <p
              style={{
                fontSize: '13.5px',
                fontWeight: 700,
                margin: '0 0 18px 0',
                color: '#1a1a17',
                lineHeight: 1.4,
              }}
            >
              Oyuncuların kaydettiği en komik ve efsane dublajları izle, beğen ve yorum bırak.
            </p>
            <Link
              href="/"
              style={{
                display: 'block',
                textAlign: 'center',
                background: '#090909',
                color: '#F5E636',
                padding: '13px 16px',
                borderRadius: '999px',
                fontWeight: 900,
                fontSize: '13.5px',
              }}
            >
              Yeni Dublaj Kaydet
            </Link>
          </div>

          {/* Akış Sıralama Bento Kartı */}
          <div
            style={{
              background: '#121212',
              border: '2px solid #2a2a2a',
              borderRadius: '24px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 900,
                letterSpacing: '0.08em',
                color: '#888888',
                marginBottom: '4px',
              }}
            >
              AKIŞ SIRALAMASI
            </div>
            {[
              { id: 'latest', label: 'En Son Paylaşılanlar', color: '#F5E636' },
              { id: 'popular', label: 'En Çok Beğenilenler', color: '#FF6B4A' },
              { id: 'discussed', label: 'En Çok Yorum Alanlar', color: '#B8E6C1' },
              { id: 'liked', label: 'Beğendiğim Dublajlar', color: '#D4C2FC' },
            ].map((tab) => {
              const active = sortBy === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'liked' && !user) {
                      requireAuth(() => setSortBy('liked'));
                      return;
                    }
                    setSortBy(tab.id as typeof sortBy);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: '14px',
                    border: active ? '2px solid #090909' : '1.5px solid #242424',
                    background: active ? tab.color : '#1a1a1a',
                    color: active ? '#090909' : '#e4e4e7',
                    fontSize: '13.5px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Kategori Filtreleri Bento Kartı */}
          <div
            style={{
              background: '#121212',
              border: '2px solid #2a2a2a',
              borderRadius: '24px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 900,
                letterSpacing: '0.08em',
                color: '#888888',
                marginBottom: '4px',
              }}
            >
              KATEGORİLER
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {categories.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      padding: '8px 13px',
                      borderRadius: '999px',
                      border: '1.5px solid #2e2e2e',
                      background: active ? '#F5E636' : '#1c1c1c',
                      color: active ? '#090909' : '#b8b8ae',
                      fontSize: '11.5px',
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Topluluk Özeti Bento Kartı */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '8px',
            }}
          >
            <div
              style={{
                background: '#B8E6C1',
                color: '#090909',
                borderRadius: '18px',
                padding: '14px 10px',
                textAlign: 'center',
                border: '2px solid #2a2a2a',
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>
                {dubs.length}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 900, marginTop: '4px' }}>
                DUBLAJ
              </div>
            </div>
            <div
              style={{
                background: '#FF6B4A',
                color: '#090909',
                borderRadius: '18px',
                padding: '14px 10px',
                textAlign: 'center',
                border: '2px solid #2a2a2a',
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>
                {totalLikes}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 900, marginTop: '4px' }}>
                BEĞENİ
              </div>
            </div>
            <div
              style={{
                background: '#D4C2FC',
                color: '#090909',
                borderRadius: '18px',
                padding: '14px 10px',
                textAlign: 'center',
                border: '2px solid #2a2a2a',
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>
                {totalComments}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 900, marginTop: '4px' }}>
                YORUM
              </div>
            </div>
          </div>
        </aside>

        {/* SAĞ ANA SÜTUN: SOSYAL MEDYA POST AKIŞI */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {filteredAndSortedDubs.length === 0 ? (
            <div
              style={{
                background: '#121212',
                border: '2px solid #2a2a2a',
                borderRadius: '26px',
                padding: '48px 28px',
                textAlign: 'center',
              }}
            >
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  margin: '0 0 8px 0',
                  color: '#ffffff',
                }}
              >
                Bu akışta henüz paylaşılan dublaj yok.
              </h2>
              <p
                style={{
                  fontSize: '14px',
                  color: '#888888',
                  margin: '0 0 22px 0',
                }}
              >
                Bir sahne seçip dublajını tamamladıktan sonra &ldquo;Yayınla&rdquo; butonuna basarak ilk gönderiyi sen paylaş!
              </p>
              <Link
                href="/"
                className="bbank-pill-btn bbank-pill-yellow"
                style={{ padding: '12px 24px', fontSize: '14px' }}
              >
                Sahne Seç ve Başla
              </Link>
            </div>
          ) : (
            filteredAndSortedDubs.map((dub, index) => {
              const isLiked = Boolean(user && (dub.likedBy || []).includes(user.id));
              const comments = dub.comments || [];
              const headerThemeColor = AVATAR_COLORS[index % AVATAR_COLORS.length];

              return (
                <article
                  key={dub.id}
                  style={{
                    background: '#121212',
                    border:
                      highlightedPostId === dub.id
                        ? '2px solid #F5E636'
                        : '2px solid #2a2a2a',
                    borderRadius: '26px',
                    overflow: 'hidden',
                    color: '#ffffff',
                  }}
                >
                  {/* 1. SOSYAL POST ÜST BİLGİSİ (OYUNCULAR, ROLLER VE ZAMAN) */}
                  <div
                    style={{
                      padding: '18px 22px',
                      borderBottom: '2px solid #222222',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '12px',
                      background: '#161616',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Oyuncu Baş Harf Bloğu */}
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '12px',
                          background: headerThemeColor,
                          color: '#090909',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '18px',
                          border: '2px solid #090909',
                          flexShrink: 0,
                        }}
                      >
                        {(dub.players?.[0]?.name || 'R').slice(0, 1).toUpperCase()}
                      </div>

                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '6px',
                            fontSize: '15px',
                            fontWeight: 900,
                          }}
                        >
                          {dub.players && dub.players.length > 0 ? (
                            dub.players.map((p, i) => (
                              <span key={i}>
                                @{p.name}
                                {i < dub.players.length - 1 ? ' & ' : ''}
                              </span>
                            ))
                          ) : (
                            <span>@Oyuncu</span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#888888',
                            marginTop: '2px',
                          }}
                        >
                          {formatRelativeTime(dub.createdAt)} &middot; ODA #{dub.roomCode}
                        </div>
                      </div>
                    </div>

                    {/* Kategori & Sahne Etiketi */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          background: '#222222',
                          color: '#F5E636',
                          border: '1.5px solid #333333',
                          borderRadius: '999px',
                          padding: '5px 12px',
                          fontSize: '11px',
                          fontWeight: 900,
                        }}
                      >
                        {dub.category}
                      </span>
                    </div>
                  </div>

                  {/* 2. SAHNE BAŞLIĞI VE SESLENDİRİLEN KARAKTERLER */}
                  <div style={{ padding: '16px 22px 14px' }}>
                    <h3
                      style={{
                        fontSize: '22px',
                        fontWeight: 900,
                        letterSpacing: '-0.03em',
                        margin: '0 0 10px 0',
                      }}
                    >
                      {dub.sceneTitle}
                    </h3>

                    {dub.players && dub.players.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {dub.players.map((p, idx) => (
                          <span
                            key={idx}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              background: '#1c1c1c',
                              border: '1.5px solid #2e2e2e',
                              padding: '5px 11px',
                              borderRadius: '10px',
                              fontSize: '12px',
                              fontWeight: 800,
                            }}
                          >
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: p.roleColor || '#F5E636',
                              }}
                            />
                            <span>{p.name}</span>
                            <span style={{ color: '#888888' }}>({p.roleName})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 3. DUBLAJ VİDEO OYNATICISI (ÇİFT TIKLAYINCA BEĞENİR) */}
                  <div
                    onDoubleClick={() => handleToggleLike(dub)}
                    style={{
                      position: 'relative',
                      background: '#050505',
                      borderTop: '2px solid #222222',
                      borderBottom: '2px solid #222222',
                      aspectRatio: '16 / 9',
                      width: '100%',
                    }}
                  >
                    <video
                      src={dub.videoUrl}
                      poster={dub.posterUrl || undefined}
                      controls
                      playsInline
                      preload="metadata"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  </div>

                  {/* 4. SOSYAL MEDYA ETKİLEŞİM ÇUBUĞU (BEĞEN, YORUM, PAYLAŞ) */}
                  <div
                    style={{
                      padding: '14px 22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px',
                      borderBottom: '1.5px solid #222222',
                      background: '#161616',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* BEĞEN BUTONU */}
                      <button
                        type="button"
                        onClick={() => handleToggleLike(dub)}
                        style={{
                          padding: '10px 18px',
                          borderRadius: '999px',
                          border: isLiked ? '2px solid #090909' : '1.5px solid #333333',
                          background: isLiked ? '#FF6B4A' : '#1c1c1c',
                          color: isLiked ? '#090909' : '#ffffff',
                          fontWeight: 900,
                          fontSize: '13.5px',
                          cursor: 'pointer',
                        }}
                      >
                        {isLiked ? 'Beğenildi' : 'Beğen'} &middot; {dub.likes || 0}
                      </button>

                      {/* YORUM SAYISI GÖSTERGESİ */}
                      <div
                        style={{
                          padding: '10px 16px',
                          borderRadius: '999px',
                          border: '1.5px solid #2e2e2e',
                          background: '#1c1c1c',
                          color: '#e4e4e7',
                          fontWeight: 800,
                          fontSize: '13px',
                        }}
                      >
                        {comments.length} Yorum
                      </div>

                      {/* PAYLAŞ BUTONU */}
                      <button
                        type="button"
                        onClick={() => handleSharePost(dub.id)}
                        style={{
                          padding: '10px 16px',
                          borderRadius: '999px',
                          border: '1.5px solid #2e2e2e',
                          background: copiedId === dub.id ? '#B8E6C1' : '#1c1c1c',
                          color: copiedId === dub.id ? '#090909' : '#e4e4e7',
                          fontWeight: 800,
                          fontSize: '13px',
                          cursor: 'pointer',
                        }}
                      >
                        {copiedId === dub.id ? 'Bağlantı Kopyalandı' : 'Paylaş'}
                      </button>
                    </div>

                    <Link
                      href="/"
                      style={{
                        padding: '10px 16px',
                        borderRadius: '999px',
                        background: '#F5E636',
                        color: '#090909',
                        fontWeight: 900,
                        fontSize: '12.5px',
                      }}
                    >
                      Bu Sahneyi Oyna
                    </Link>
                  </div>

                  {/* 5. YORUMLAR VE YORUM YAZMA ALANI */}
                  <div style={{ padding: '18px 22px 22px', background: '#121212' }}>
                    {/* Mevcut Yorumlar Listesi */}
                    {comments.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          marginBottom: '16px',
                          maxHeight: '280px',
                          overflowY: 'auto',
                        }}
                      >
                        {comments.map((c, cIdx) => {
                          const canDelete = Boolean(user && c.userId === user.id);
                          const badgeColor = AVATAR_COLORS[cIdx % AVATAR_COLORS.length];
                          return (
                            <div
                              key={c.id}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'space-between',
                                gap: '12px',
                                background: '#1a1a1a',
                                border: '1.5px solid #262626',
                                borderRadius: '14px',
                                padding: '11px 14px',
                              }}
                            >
                              <div style={{ display: 'flex', gap: '10px', minWidth: 0 }}>
                                <div
                                  style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '8px',
                                    background: badgeColor,
                                    color: '#090909',
                                    fontWeight: 900,
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    marginTop: '1px',
                                  }}
                                >
                                  {(c.userName || 'O').slice(0, 1).toUpperCase()}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      marginBottom: '2px',
                                    }}
                                  >
                                    <strong style={{ fontSize: '13px', color: '#F5E636' }}>
                                      @{c.userName}
                                    </strong>
                                    <span style={{ fontSize: '11px', color: '#777777', fontWeight: 700 }}>
                                      {formatRelativeTime(c.createdAt)}
                                    </span>
                                  </div>
                                  <p
                                    style={{
                                      margin: 0,
                                      fontSize: '13.5px',
                                      color: '#f4f4f5',
                                      lineHeight: 1.45,
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {c.text}
                                  </p>
                                </div>
                              </div>

                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(dub.id, c.id)}
                                  style={{
                                    background: '#261616',
                                    color: '#ff8881',
                                    border: '1px solid #FA5636',
                                    borderRadius: '8px',
                                    padding: '4px 9px',
                                    fontSize: '11px',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                  }}
                                >
                                  Sil
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: '13px',
                          color: '#777777',
                          fontWeight: 700,
                          marginBottom: '14px',
                        }}
                      >
                        İlk yorumu sen yaz!
                      </div>
                    )}

                    {/* Yorum Yazma Formu */}
                    <form
                      onSubmit={(e) => handleCommentSubmit(e, dub.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: '10px',
                      }}
                    >
                      <input
                        type="text"
                        maxLength={400}
                        value={commentInputs[dub.id] || ''}
                        onChange={(e) =>
                          setCommentInputs((prev) => ({
                            ...prev,
                            [dub.id]: e.target.value,
                          }))
                        }
                        placeholder="Bu dublaja yorum yaz..."
                        className="bbank-input"
                        style={{
                          padding: '12px 15px',
                          fontSize: '13.5px',
                          borderRadius: '14px',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={submittingCommentId === dub.id}
                        style={{
                          padding: '0 22px',
                          borderRadius: '14px',
                          border: 'none',
                          background: '#F5E636',
                          color: '#090909',
                          fontSize: '13.5px',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        {submittingCommentId === dub.id ? '...' : 'Gönder'}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
