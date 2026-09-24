'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  CircleHelp,
  Clapperboard,
  Film,
  Sparkles,
} from 'lucide-react';
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
    <header className="bbank-topbar replik-page-topbar">
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
      <nav className="bbank-topbar-right" aria-label="Ana menü">
        <Link
          href="/"
          className={`bbank-pill-btn ${active === 'scenes' ? 'bbank-pill-yellow' : 'bbank-pill-dark'}`}
          onClick={(event) =>
            navigate(event, '/', 'Sahneler Açılıyor', '#F5E636')
          }
        >
          <Film size={16} /> Sahneler
        </Link>
        <Link
          href="/dublajlar"
          className="bbank-pill-btn bbank-pill-feed"
          aria-current={active === 'feed' ? 'page' : undefined}
          onClick={(event) =>
            navigate(event, '/dublajlar', 'Dublaj Akışı Açılıyor', '#9E8CA9')
          }
        >
          <Clapperboard size={17} /> Dublaj Akışı{' '}
          <span className="bbank-feed-live-dot" aria-hidden="true" />
        </Link>
        <Link
          href="/nasil-oynanir"
          className={`bbank-pill-btn ${active === 'guide' ? 'bbank-pill-sage' : 'bbank-pill-dark'}`}
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
          <CircleHelp size={16} /> Nasıl Oynanır?
        </Link>
        <Link
          href="/editor"
          className="bbank-pill-btn bbank-pill-sage"
          onClick={(event) =>
            navigate(event, '/editor', 'Sahne Editörü Açılıyor', '#CDE2CD')
          }
        >
          <Sparkles size={16} /> Sahne Editörü
        </Link>
        <Link
          href="/"
          className="bbank-pill-btn bbank-pill-coral"
          onClick={(event) =>
            navigate(event, '/', 'Sahneye Geçiliyor', '#FA5636')
          }
        >
          Oyun Kur <ArrowUpRight size={16} />
        </Link>
        <MemberTopbarBadge />
      </nav>
    </header>
  );
}
