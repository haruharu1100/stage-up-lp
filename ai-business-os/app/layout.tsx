import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI BUSINESS OS',
  description: '海外AIビジネスを発掘し、検証して、売上まで数字で追う',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
