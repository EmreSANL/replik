'use client';

import React from 'react';

interface ReplikLoadingScreenProps {
  progress: number;
  statusText?: string;
  visible: boolean;
}

/**
 * Tam ekran renk değiştiren (Sarı -> Mercan -> Adaçayı -> Lila) Maximalist Solid yükleme perdesi.
 * Yükleme tamamlandığında (visible = false) ekran sağdan sola doğru (translate3d(-105%, 0, 0))
 * kayarak sahneyi açar.
 */
export function ReplikLoadingScreen({
  progress,
  statusText = 'Videolar yükleniyor...',
  visible,
}: ReplikLoadingScreenProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      aria-live="polite"
      aria-busy={visible}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        pointerEvents: visible ? 'all' : 'none',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes replikFullColorCycle {
          0%   { background-color: #F5E636; }
          28%  { background-color: #FF6B4A; }
          56%  { background-color: #B8E6C1; }
          82%  { background-color: #D4C2FC; }
          100% { background-color: #F5E636; }
        }
      `}</style>

      {/* Arkadan gelen ikincil siyah perde (Sağdan sola kayarken keskin katman etkisi verir) */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#090909',
          transform: visible ? 'translate3d(0%, 0, 0)' : 'translate3d(-102%, 0, 0)',
          transition: 'transform 0.82s cubic-bezier(0.76, 0, 0.24, 1) 0.06s',
          willChange: 'transform',
        }}
      />

      {/* Ana Tam Ekran Renk Değiştiren Yükleme Ekranı (Bittiğinde Sağdan Sola Kayar) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          animation: 'replikFullColorCycle 4.2s ease-in-out infinite',
          color: '#090909',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          fontFamily: 'var(--font-geist-sans), sans-serif',
          transform: visible ? 'translate3d(0%, 0, 0)' : 'translate3d(-102%, 0, 0)',
          transition: 'transform 0.72s cubic-bezier(0.76, 0, 0.24, 1)',
          willChange: 'transform',
          borderRight: '4px solid #090909',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Üst Büyük Marka ve Yüzde Bloğu */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <span
              style={{
                fontSize: 'clamp(42px, 6vw, 64px)',
                fontWeight: 900,
                letterSpacing: '-0.06em',
                lineHeight: 0.95,
                color: '#090909',
              }}
            >
              Replik.
            </span>
            <span
              style={{
                fontSize: 'clamp(32px, 4.5vw, 48px)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                lineHeight: 0.95,
                color: '#090909',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              %{clamped}
            </span>
          </div>

          {/* Kalın Siyah Yükleme Çubuğu */}
          <div
            style={{
              width: '100%',
              height: '14px',
              borderRadius: '999px',
              background: 'rgba(9, 9, 9, 0.16)',
              border: '2px solid #090909',
              overflow: 'hidden',
              padding: '2px',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${clamped}%`,
                borderRadius: '999px',
                background: '#090909',
                transition: 'width 0.22s ease-out',
              }}
            />
          </div>

          {/* Alt Durum Metni */}
          <div
            style={{
              fontSize: '14px',
              fontWeight: 800,
              color: '#090909',
              letterSpacing: '-0.01em',
            }}
          >
            {statusText}
          </div>
        </div>
      </div>
    </div>
  );
}
