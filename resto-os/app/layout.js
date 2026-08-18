import './globals.css';

export const metadata = {
  title: '飲食店OS',
  description: 'セルフオーダー / 厨房管理 / POS / 売上分析 をひとつにまとめた飲食店の管理システム',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
