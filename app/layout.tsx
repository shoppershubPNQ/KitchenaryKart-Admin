import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KitchenaryKart Admin',
  description: 'B2B e-commerce admin dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
