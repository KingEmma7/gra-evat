import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'gra-evat | The invoice lab',
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
