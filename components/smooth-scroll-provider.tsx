'use client';

import React, { useEffect } from 'react';

declare global {
  interface Window {
    __replikActiveScrolling?: boolean;
  }
}

/**
 * Sayfa genelinde 120fps akıcı (inertial lerp) kaydırma deneyimi sağlar ve
 * aktif kaydırma (scroll) sırasında ağır video seek/hover işlemlerini erteleyerek
 * takılmaları (frame drop) tamamen ortadan kaldırır.
 */
export function SmoothScrollProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (prefersReducedMotion) return;

    let currentY = window.scrollY;
    let targetY = window.scrollY;
    let rafId: number | null = null;
    let lastTime = performance.now();
    let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
    let isWheelAnimating = false;

    const markScrollingActive = () => {
      window.__replikActiveScrolling = true;
      if (document.documentElement.dataset.scrolling !== 'true') {
        document.documentElement.dataset.scrolling = 'true';
      }
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        window.__replikActiveScrolling = false;
        delete document.documentElement.dataset.scrolling;
      }, 140);
    };

    const getMaxScroll = () =>
      Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );

    // İçeride kendi scroll barı olan (modal, yorum kutusu, timeline vb.) bir elemanda mıyız kontrol et
    const hasScrollableParent = (el: EventTarget | null, deltaY: number): boolean => {
      let node = el as HTMLElement | null;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.getAttribute?.('role') === 'dialog') return true;
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 2
        ) {
          const canScrollDown =
            deltaY > 0 &&
            node.scrollTop + node.clientHeight < node.scrollHeight - 1;
          const canScrollUp = deltaY < 0 && node.scrollTop > 1;
          if (canScrollDown || canScrollUp) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const tick = (now: number) => {
      const dt = Math.min(0.064, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      // Frame-rate bağımsız üstel yumuşatma (120Hz ve 60Hz ekranlarda aynı akıcılık)
      const lerpFactor = 1 - Math.exp(-14 * dt);
      const diff = targetY - currentY;

      if (Math.abs(diff) > 0.35) {
        currentY += diff * lerpFactor;
        window.scrollTo(0, currentY);
        rafId = requestAnimationFrame(tick);
      } else {
        currentY = targetY;
        window.scrollTo(0, targetY);
        isWheelAnimating = false;
        rafId = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      // Ctrl+wheel (zoom) veya iç modal/liste kaydırmalarına dokunma
      if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      if (hasScrollableParent(e.target, e.deltaY)) return;

      markScrollingActive();

      // Mouse tekerleği (discrete steps) veya orta/büyük trackpad hareketlerini pürüzsüzleştir
      const deltaMultiplier = e.deltaMode === 1 ? 36 : e.deltaMode === 2 ? window.innerHeight : 1;
      const rawDelta = e.deltaY * deltaMultiplier;

      // Çok küçük trackpad mikro-dokunuşlarında tarayıcı native momentumunu koru,
      // diğer tüm kaydırmalarda 120fps inertial lerp uygula
      const isMouseWheel = e.deltaMode === 1 || Math.abs(rawDelta) >= 18;
      if (!isMouseWheel && !isWheelAnimating) {
        currentY = window.scrollY;
        targetY = window.scrollY;
        return;
      }

      e.preventDefault();

      if (!isWheelAnimating) {
        currentY = window.scrollY;
        targetY = window.scrollY;
      }

      const maxScroll = getMaxScroll();
      targetY = Math.max(0, Math.min(maxScroll, targetY + rawDelta * 0.95));

      if (!rafId) {
        isWheelAnimating = true;
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    const onNativeScroll = () => {
      markScrollingActive();
      if (!isWheelAnimating) {
        currentY = window.scrollY;
        targetY = window.scrollY;
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onNativeScroll, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onNativeScroll);
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    };
  }, []);

  return <>{children}</>;
}
