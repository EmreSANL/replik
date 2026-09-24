'use client';

import React from 'react';

interface ReplikLoadingScreenProps {
  progress: number;
  statusText?: string;
  visible: boolean;
}

export function ReplikLoadingScreen({
  progress,
  statusText = 'Yükleniyor...',
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
        background: '#09090c',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'var(--font-geist-sans), sans-serif',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'all' : 'none',
        transition: 'opacity 0.35s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '320px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#e4e4e7',
              letterSpacing: '-0.01em',
            }}
          >
            {statusText}
          </span>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 800,
              color: '#F5E636',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            %{clamped}
          </span>
        </div>

        <div
          style={{
            width: '100%',
            height: '6px',
            borderRadius: '999px',
            background: 'rgba(255, 255, 255, 0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${clamped}%`,
              borderRadius: '999px',
              background: '#F5E636',
              transition: 'width 0.25s ease-out',
            }}
          />
        </div>
      </div>
    </div>
  );
}
