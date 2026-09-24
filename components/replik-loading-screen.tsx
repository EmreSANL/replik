'use client';

import React, { useEffect, useRef, useState } from 'react';

interface ReplikLoadingScreenProps {
  progress: number;
  statusText?: string;
  visible: boolean;
}

type CurtainCommand = {
  label: string;
  sublabel?: string;
  accent?: string;
  onMidpoint: () => void;
};

type CurtainListener = (cmd: CurtainCommand) => void;

const globalForCurtain = globalThis as unknown as {
  __replikCurtainListeners?: Set<CurtainListener>;
};

const curtainListeners =
  globalForCurtain.__replikCurtainListeners ??
  (globalForCurtain.__replikCurtainListeners = new Set<CurtainListener>());

/**
 * Üst menü butonlarına veya sayfa geçişlerine basıldığında
 * tam ekran renk değiştiren sağdan sola perde geçişini (curtain wipe) tetikler.
 */
export function triggerReplikCurtain(
  label: string,
  onMidpoint: () => void,
  options?: { sublabel?: string; accent?: string },
) {
  if (curtainListeners.size === 0) {
    onMidpoint();
    return;
  }
  curtainListeners.forEach((fn) =>
    fn({
      label,
      sublabel: options?.sublabel,
      accent: options?.accent,
      onMidpoint,
    }),
  );
}

/**
 * RootLayout / AuthProvider içinde sürekli hazır bekleyen,
 * tetiklendiğinde sağdan (102%) merkeze (0%) gelip aksiyonu çalıştıran
 * ve ardından merkezden sola (-102%) kayarak yeni ekranı açan geçiş perdesi.
 */
export function ReplikCurtainTransition() {
  const [phase, setPhase] = useState<'idle' | 'covering' | 'revealing'>('idle');
  const [label, setLabel] = useState('Replik.');
  const [sublabel, setSublabel] = useState('Sahne hazırlanıyor...');
  const [startColor, setStartColor] = useState('#F5E636');
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const clearTimers = () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current = [];
    };

    const handleTrigger: CurtainListener = (cmd) => {
      clearTimers();
      setLabel(cmd.label || 'Replik.');
      setSublabel(cmd.sublabel || 'Ekran değiştiriliyor...');
      setStartColor(cmd.accent || '#F5E636');

      // 1. Perdeyi sağ kenara (102%) konumlandır ve hemen merkeze (0%) kaydır
      setPhase('idle');
      const t1 = setTimeout(() => {
        setPhase('covering');
      }, 16);

      // 2. Perde ekranı tam kapladığında (400ms) hedef aksiyonu / sayfa geçişini çalıştır
      const t2 = setTimeout(() => {
        try {
          cmd.onMidpoint();
        } catch {}
      }, 400);

      // 3. Yeni ekran arkada hazırlandıktan hemen sonra (510ms) perdeyi sağdan sola (-102%) kaydırarak aç
      const t3 = setTimeout(() => {
        setPhase('revealing');
      }, 510);

      // 4. Animasyon bittiğinde (1100ms) sessizce başlangıç konumuna (idle) al
      const t4 = setTimeout(() => {
        setPhase('idle');
      }, 1100);

      timersRef.current.push(t1, t2, t3, t4);
    };

    curtainListeners.add(handleTrigger);
    return () => {
      curtainListeners.delete(handleTrigger);
      clearTimers();
    };
  }, []);

  const isIdle = phase === 'idle';
  const mainTransform =
    phase === 'idle'
      ? 'translate3d(102%, 0, 0)'
      : phase === 'covering'
        ? 'translate3d(0%, 0, 0)'
        : 'translate3d(-102%, 0, 0)';

  const mainTransition =
    phase === 'idle'
      ? 'none'
      : phase === 'covering'
        ? 'transform 0.38s cubic-bezier(0.76, 0, 0.24, 1)'
        : 'transform 0.56s cubic-bezier(0.76, 0, 0.24, 1)';

  const trailTransition =
    phase === 'idle'
      ? 'none'
      : phase === 'covering'
        ? 'transform 0.34s cubic-bezier(0.76, 0, 0.24, 1)'
        : 'transform 0.62s cubic-bezier(0.76, 0, 0.24, 1) 0.05s';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10005,
        pointerEvents: isIdle ? 'none' : 'all',
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

      {/* İkincil Siyah Katman */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#090909',
          transform: mainTransform,
          transition: trailTransition,
          willChange: 'transform',
        }}
      />

      {/* Ana Renk Değiştiren Geçiş Perdesi */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: startColor,
          animation: isIdle ? 'none' : 'replikFullColorCycle 2.2s ease-in-out infinite',
          color: '#090909',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          fontFamily: 'var(--font-geist-sans), sans-serif',
          transform: mainTransform,
          transition: mainTransition,
          willChange: 'transform',
          borderLeft: '4px solid #090909',
          borderRight: '4px solid #090909',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '460px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              fontSize: 'clamp(40px, 5.8vw, 62px)',
              fontWeight: 900,
              letterSpacing: '-0.055em',
              lineHeight: 0.96,
              color: '#090909',
            }}
          >
            {label}
          </div>
          <div
            style={{
              width: '100%',
              height: '10px',
              borderRadius: '999px',
              background: '#090909',
            }}
          />
          <div
            style={{
              fontSize: '14px',
              fontWeight: 800,
              color: '#090909',
            }}
          >
            {sublabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tam ekran renk değiştiren (Sarı -> Mercan -> Adaçayı -> Lila) Maximalist Solid yükleme perdesi.
 * Yükleme tamamlandığında (visible = false) ekran sağdan sola doğru (translate3d(-102%, 0, 0))
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
      {/* Arkadan gelen ikincil siyah perde */}
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
