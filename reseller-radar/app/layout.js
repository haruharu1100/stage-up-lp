import "./globals.css";

export const metadata = {
  title: "仕入れセンサー（ShiireSensor）",
  description: "仕入れ先を毎日巡回し、利益商品を自動検知する",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <header className="header">
          <div className="header-inner">
            <a className="logo" href="/">
              <span className="mark">仕</span>
              <span className="name">仕入れセンサー</span>
            </a>
            <nav className="nav">
              <a href="/">通知</a>
              <a href="/tasks">巡回タスク</a>
              <a href="/suppliers">仕入れ先</a>
              <a href="/settings">設定</a>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
