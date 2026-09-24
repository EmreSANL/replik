import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Replik — Ses sende, sahne sizde',
  description:
    'Arkadaşlarınla bir odaya gir, rollerini paylaş ve sahneleri kendi sesinle yeniden canlandır.',
};

import { AuthProvider } from '@/components/auth-provider';
import { SmoothScrollProvider } from '@/components/smooth-scroll-provider';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SmoothScrollProvider>
          <AuthProvider>{children}</AuthProvider>
        </SmoothScrollProvider>
      </body>
    </html>
  );
}
