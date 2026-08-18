import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCtx, ROLE_LABEL } from '../../lib/auth.js';
import Nav from '../../components/Nav';

export const dynamic = 'force-dynamic';

// 管理画面はここでまとめて権限を確認する。
// スタッフ・厨房がURLを直接開いても、中身が空の表を見せず「使えない」とはっきり伝える。
const ALLOWED = ['owner', 'admin', 'manager'];

export default async function AdminLayout({ children }) {
  const ctx = await getCtx();
  if (!ctx) redirect('/login');

  if (!ALLOWED.includes(ctx.role)) {
    return (
      <div>
        <Nav />
        <div className="wrap">
          <div className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>🔒</div>
            <div className="h1" style={{ marginTop: 8 }}>この画面は開けません</div>
            <div className="muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
              管理画面は店長以上のみが利用できます。<br />
              今のログインは「{ROLE_LABEL[ctx.role] || ctx.role}」です。<br />
              必要な場合は店長・オーナーにご相談ください。
            </div>
            <div style={{ marginTop: 18 }}>
              <Link className="btn btn-primary" href="/">メニューに戻る</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
