import type { Metadata } from 'next';
import Link from 'next/link';
import { config } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Commerce OS',
  description: '仕入→販売→学習を回すAI物販経営システム（Phase 1）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="top">
          <div className="inner">
            <span className="brand">AI Commerce OS</span>
            <nav>
              <Link href="/">経営ダッシュボード</Link>
              <Link href="/routes">どこで買ってどこで売るか</Link>
              <Link href="/matrix">市場マトリクス</Link>
              <Link href="/capital">予算の使い道</Link>
              <Link href="/products">商品一覧</Link>
              <Link href="/venues">市場一覧</Link>
              <Link href="/market">市場ごとの相場</Link>
              <Link href="/import">CSV取込</Link>
              <Link href="/review">人間確認</Link>
              <Link href="/settings">設定</Link>
            </nav>
            <span className="mode">
              Phase 2 ／ モード <strong>{config.autoMode}</strong> ／ 自動購入 <strong>OFF</strong>
            </span>
          </div>
        </header>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
