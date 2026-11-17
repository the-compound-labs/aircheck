import type { Metadata, Viewport } from 'next';
import Analytics from '@/components/Analytics';
import { AdsClaim } from '@/components/AdsMeasurement';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

/* The on-air mark (2026-11-15 redesign, aircheck-new.svg) for every surface: the SVG
 * favicon and the PNG a phone puts on its home screen. Pages may add their own metadata on top. */
export const metadata: Metadata = {
  /* Resolves each route's share card (opengraph-image.jpg beside a guide or the docs) to the live host. */
  metadataBase: new URL('https://aircheck.dev'),
  icons: { icon: [{ url: '/aircheck-mark.svg', type: 'image/svg+xml' }], apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] },
};

/* THE ONE ROOT. It carries the document and the type every surface shares, and no stylesheet:
 * the app ((app)/layout.tsx), the landing and the reader pages ((site)/) each import their own, and
 * every link between them is a plain anchor, so a document load never carries one surface's CSS
 * into another.
 *
 * The 2026-11-15 redesign's three families: Newsreader (light serif, headlines), Inter (UI and
 * body) and JetBrains Mono (paths, tokens, logs). */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body><Analytics /><AdsClaim />{children}</body>
    </html>
  );
}
