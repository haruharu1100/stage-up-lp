import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Amazon AI Seller Factory',
  description: 'AI社員が商品を探し、分析し、商品ページまで作る工場',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="topbar">
          <div className="inner">
            <h1>
              <a href="/" style={{ color: 'inherit' }}>
                Amazon AI Seller Factory
              </a>
            </h1>
            <span className="sub">AI社員が商品を探し、調べ、商品ページまで作ります</span>
            <nav>
              <a href="/research">① リサーチツール</a>
              <a href="/discover">② 商品を発掘する</a>
              <a href="/">③ 商品ページを作る</a>
              <a href="/lifecycle">④ 仕入れ・販売の記録</a>
              <a href="/learning">⑤ 予測の答え合わせ</a>
              <a href="/ops">⑥ 自動運転とAPI代</a>
              <a href="/health">⑦ アカウントを守る</a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
