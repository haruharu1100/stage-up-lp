import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from './nav';

export const metadata: Metadata = {
  title: 'AI営業・案件自動受注OS',
  description: '法人営業と案件受注を1つにまとめた管理画面。外部への送信は既定でOFF。',
  // 管理画面なので検索エンジンには載せない（robots.txt・応答ヘッダと合わせて三重）。
  robots: { index: false, follow: false, nocache: true },
};

/**
 * スマホで開いたときに、勝手に縮小表示されないようにする。
 * これが無いと、スマホでは横1000px相当の画面を無理に縮めて表示するので、文字が小さくて貼り付けができない。
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1621',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <Nav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
