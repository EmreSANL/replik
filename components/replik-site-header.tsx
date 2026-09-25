'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MemberTopbarBadge } from '@/components/auth-provider';
import { triggerReplikCurtain } from '@/components/replik-loading-screen';

type Section = 'scenes' | 'feed' | 'guide';

export function ReplikSiteHeader({
  active,
  subtitle,
}: {
  active: Section;
  subtitle: string;
}) {
  const router = useRouter();

  function navigate(
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    label: string,
    accent: string,
  ) {
    event.preventDefault();
    if (href === '/dublajlar' && active === 'feed') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    triggerReplikCurtain(label, () => router.push(href), { accent });
  }

  return (
    <header className="bbank-topbar replik-page-topbar replik-topbar">
      <div className="bbank-topbar-left">
        <Link
          href="/"
          className="bbank-brand"
          aria-label="Replik ana sayfa"
          onClick={(event) =>
            navigate(event, '/', 'Sahneler Açılıyor', '#F5E636')
          }
        >
          <span className="bbank-brand-title">Replik</span>
        </Link>
        <span className="bbank-date-label">{subtitle}</span>
      </div>
      <nav className="bbank-topbar-right replik-topbar-nav" aria-label="Ana menü">
        <Link
          href="/"
          className={`bbank-pill-btn replik-nav-item replik-nav-scenes ${active === 'scenes' ? 'bbank-pill-yellow' : 'bbank-pill-dark'}`}
          aria-current={active === 'scenes' ? 'page' : undefined}
          onClick={(event) =>
            navigate(event, '/', 'Sahneler Açılıyor', '#F5E636')
          }
        >
          <span className="replik-nav-number" aria-hidden="true">01 / KEŞFET</span>
          <span className="replik-nav-label">Sahneler</span>
        </Link>
        <Link
          href="/dublajlar"
          className="bbank-pill-btn bbank-pill-feed replik-nav-item replik-nav-feed"
          aria-current={active === 'feed' ? 'page' : undefined}
          onClick={(event) =>
            navigate(event, '/dublajlar', 'Dublaj Akışı Açılıyor', '#9E8CA9')
          }
        >
          <span className="replik-nav-number" aria-hidden="true">02 / İZLE</span>
          <span className="replik-nav-label">Dublaj Akışı</span>
        </Link>
        <Link
          href="/nasil-oynanir"
          className={`bbank-pill-btn replik-nav-item replik-nav-guide ${active === 'guide' ? 'bbank-pill-sage' : 'bbank-pill-dark'}`}
          aria-current={active === 'guide' ? 'page' : undefined}
          onClick={(event) =>
            navigate(
              event,
              '/nasil-oynanir',
              'Oyun Rehberi Açılıyor',
              '#CDE2CD',
            )
          }
        >
          <span className="replik-nav-number" aria-hidden="true">03 / ÖĞREN</span>
          <span className="replik-nav-label">Nasıl Oynanır?</span>
        </Link>
        <Link
          href="/editor"
          className="bbank-pill-btn bbank-pill-sage replik-nav-item replik-nav-editor"
          onClick={(event) =>
            navigate(event, '/editor', 'Sahne Editörü Açılıyor', '#CDE2CD')
          }
        >
          <span className="replik-nav-number" aria-hidden="true">04 / ÜRET</span>
          <span className="replik-nav-label">Sahne Editörü</span>
        </Link>
        <Link
          href="/"
          className="bbank-pill-btn bbank-pill-coral replik-nav-item replik-nav-join"
          onClick={(event) =>
            navigate(event, '/', 'Sahneye Geçiliyor', '#FA5636')
          }
        >
          <span className="replik-nav-number" aria-hidden="true">ARKADAŞLARINLA OYNA</span>
          <span className="replik-nav-label">Oyun Kur ↗</span>
        </Link>
        <MemberTopbarBadge />
      </nav>
    </header>
  );
}
