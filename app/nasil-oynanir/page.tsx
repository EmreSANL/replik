import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  Clapperboard,
  Copy,
  Film,
  Headphones,
  Heart,
  Mic2,
  Play,
  Radio,
  Sparkles,
  Users,
  WandSparkles,
} from 'lucide-react';
import { ReplikSiteHeader } from '@/components/replik-site-header';

const steps = [
  {
    n: '01',
    title: 'Sahneni seç.',
    text: 'Katalogdan bir sahne seç. Tek başına oynayabilir veya arkadaşların için bir oda kurabilirsin.',
    icon: Film,
    className: 'guide-yellow',
    hint: 'SAHNE KATALOĞU → ODA KUR',
  },
  {
    n: '02',
    title: 'Ekibini topla.',
    text: 'Oda kodunu arkadaşlarına gönder. Her oyuncu kendi adıyla katılır; roller oyuna başlarken dağıtılır.',
    icon: Users,
    className: 'guide-lilac',
    hint: 'KODU PAYLAŞ → OYUNCULAR KATILSIN',
  },
  {
    n: '03',
    title: 'Mikrofonu kap.',
    text: 'Sahneyi izle, geri sayımı takip et ve sıran geldiğinde kendi yorumunu kaydet. Kaydını dinleyip kullanabilirsin.',
    icon: Mic2,
    className: 'guide-coral',
    hint: 'DİNLE → SESLENDİR → KAYDET',
  },
  {
    n: '04',
    title: 'Finali yayınla.',
    text: 'Herkes bitirince dublajınızı birlikte izleyin. MP4 indir veya Dublaj Akışı’nda yayınlayıp topluluğa gösterin.',
    icon: Clapperboard,
    className: 'guide-sage',
    hint: 'İZLE → PAYLAŞ → ALKIŞI TOPLA',
  },
];

export default function HowToPlayPage() {
  return (
    <div className="bbank-shell guide-page">
      <ReplikSiteHeader
        active="guide"
        subtitle="Sahneye çıkmadan önce bilmen gereken her şey."
      />
      <main className="guide-main">
        <section className="guide-hero" aria-labelledby="guide-title">
          <div className="guide-hero-copy">
            <span className="guide-kicker">
              <span className="replik-hero-status-dot" /> REPLİK OYUN REHBERİ{' '}
              <span> / 01—04</span>
            </span>
            <h1 id="guide-title">
              PERDE
              <br />
              AÇILIYOR<span>.</span>
            </h1>
            <p>
              Bir sahne. Birkaç arkadaş. Sayısız farklı ses. Replik&apos;te
              kendi dublajını yapmak için tek ihtiyacın olan şey mikrofonun ve
              biraz cesaret.
            </p>
            <div className="guide-hero-actions">
              <Link href="/#sahneler" className="guide-main-cta">
                <Play size={18} fill="currentColor" /> Hemen sahne seç{' '}
                <ArrowRight size={19} />
              </Link>
              <a href="#adimlar" className="guide-secondary-cta">
                Adımları keşfet <ArrowDown size={17} />
              </a>
            </div>
          </div>
          <div className="guide-hero-art" aria-hidden="true">
            <div className="guide-art-orbit guide-art-orbit-one" />
            <div className="guide-art-orbit guide-art-orbit-two" />
            <span className="guide-art-star guide-star-one">✳</span>
            <span className="guide-art-star guide-star-two">✳</span>
            <div className="guide-art-ticket">
              <span>REPLİK ORIGINAL</span>
              <strong>
                SES
                <br />
                SENDE!
              </strong>
              <small>OYNA • KAYDET • PAYLAŞ</small>
            </div>
            <div className="guide-art-mic">
              <Mic2 size={76} strokeWidth={1.5} />
            </div>
            <div className="guide-art-sticker">
              <Radio size={19} /> KAYITTAYIZ
            </div>
          </div>
        </section>

        <div className="guide-ticker" aria-hidden="true">
          <span>SAHNE SENİN</span>
          <b>✳</b>
          <span>SESİNİ DUYUR</span>
          <b>✳</b>
          <span>ARKADAŞLARINI ÇAĞIR</span>
          <b>✳</b>
          <span>SAHNE SENİN</span>
          <b>✳</b>
          <span>SESİNİ DUYUR</span>
        </div>

        <section
          id="adimlar"
          className="guide-steps-section"
          aria-labelledby="guide-steps-title"
        >
          <div className="guide-section-head">
            <span className="guide-eyebrow">NASIL OYNANIR? / 4 ADIM</span>
            <h2 id="guide-steps-title">
              Önce oyna.
              <br />
              <em>Sonra efsane ol.</em>
            </h2>
            <p>İlk sahnenden topluluk akışına kadar yolun burada.</p>
          </div>
          <div className="guide-steps-grid">
            {steps.map(({ n, title, text, icon: Icon, className, hint }) => (
              <article className={`guide-step ${className}`} key={n}>
                <div className="guide-step-top">
                  <span>ADIM {n}</span>
                  <Icon size={35} strokeWidth={1.8} />
                </div>
                <div className="guide-step-bottom">
                  <strong>{n}</strong>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <span className="guide-step-hint">{hint}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="guide-tips" aria-labelledby="guide-tips-title">
          <div className="guide-tips-heading">
            <span className="guide-eyebrow">KÜÇÜK TÜYOLAR</span>
            <h2 id="guide-tips-title">İyi bir dublaj için.</h2>
            <p>
              Kulaklığını tak, repliği dinle ve karaktere kendi yorumunu kat.
            </p>
          </div>
          <div className="guide-tip-list">
            <div>
              <Headphones size={24} />
              <strong>Kulaklık kullan</strong>
              <span>Orijinal ses kayda karışmasın.</span>
            </div>
            <div>
              <Copy size={24} />
              <strong>Kodu paylaş</strong>
              <span>Arkadaşların aynı odaya katılsın.</span>
            </div>
            <div>
              <WandSparkles size={24} />
              <strong>Doğaçla</strong>
              <span>Repliğe kendi enerjini ekle.</span>
            </div>
            <div>
              <Heart size={24} />
              <strong>Yayınla</strong>
              <span>Akışta beğeni ve yorum topla.</span>
            </div>
          </div>
        </section>

        <section className="guide-final-cta">
          <div>
            <span>
              <Sparkles size={17} /> ŞİMDİ SIRA SENDE
            </span>
            <h2>
              Bu sahnenin yıldızı
              <br />
              neden sen olmayasın?
            </h2>
          </div>
          <div className="guide-final-actions">
            <Link href="/#sahneler">
              Sahne seç <ArrowRight size={20} />
            </Link>
            <Link href="/dublajlar">
              Dublajları izle <Clapperboard size={19} />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
