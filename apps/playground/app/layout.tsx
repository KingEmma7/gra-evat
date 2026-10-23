import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'gra-evat | Developer manual',
  description:
    'A developer playground for Ghana E-VAT. Build an invoice, inspect its taxes, and try a clearly labelled mock receipt.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GH">
      <body>{children}</body>
    </html>
  );
}
