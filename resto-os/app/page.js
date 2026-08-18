import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCtx, ROLE_LABEL } from '../lib/auth.js';
import { planFeatures, PLANS } from '../lib/plans.js';
import { demoEnabled } from '../lib/demo.js';

export const dynamic = 'force-dynamic';

// [パス, 表示名, 説明, アイコン, 見られる権限, 必要な機能]
const MENUS = [
  ['/admin', 'ダッシュボード', '売上・客数・客単価・ランキングを一画面で', '📊', ['owner', 'admin', 'manager'], 'analytics'],
  ['/pos', 'テーブル / 会計', '卓の状況、呼び出し対応、お会計（クーポン・割り勘）', '🧾', ['owner', 'admin', 'manager', 'staff'], 'pos'],
  ['/kitchen', '厨房モニター', '注文を場所ごとに振り分けて表示。経過時間で遅れを警告', '👨‍🍳', ['owner', 'admin', 'manager', 'staff', 'kitchen'], 'kds'],
  ['/staff', 'スタッフ注文', '口頭注文をスタッフのスマホから入力', '📱', ['owner', 'admin', 'manager', 'staff'], 'order'],
  ['/admin/menu', '商品管理', '価格・原価・写真・売り切れ・オプションの設定', '🍽', ['owner', 'admin', 'manager'], 'menu'],
  ['/admin/tables', 'テーブル・QR', 'テーブルごとのQRコード発行と印刷', '🔳', ['owner', 'admin', 'manager'], 'table'],
  ['/admin/orders', '注文履歴', '取消も含めた全注文の記録', '🗂', ['owner', 'admin', 'manager'], 'history'],
  ['/admin/history', 'お店の記憶', '過去の売上・天気・出来事をさかのぼって調べる', '📚', ['owner', 'admin', 'manager'], 'history'],
  ['/admin/ask', '言葉で聞ける検索', '「先月の雨の土曜、どうだった？」と書けば、根拠つきで答える', '💬', ['owner', 'admin', 'manager'], 'history'],
  ['/admin/reports', '朝と閉店後のレポート', 'その日に必要なことだけをLINEに自動で届ける', '📨', ['owner', 'admin', 'manager'], 'history'],
  ['/admin/coupons', 'クーポン', '割引クーポンの発行と利用状況', '🎟', ['owner', 'admin', 'manager'], 'coupon'],
  ['/admin/staff', 'スタッフ', '出入りに合わせて権限とPINを管理', '👥', ['owner', 'admin'], 'staff'],
  ['/admin/logs', '操作ログ', '誰がいつ何をしたかの記録', '🔍', ['owner', 'admin', 'manager'], 'audit'],
];

export default async function Home() {
  const ctx = await getCtx();
  if (!ctx) redirect('/login');

  const features = planFeatures(ctx.plan);
  const menus = MENUS.filter(([, , , , roles, f]) => roles.includes(ctx.role) && features.includes(f));

  // テストプレイ中は、QRを読まなくてもお客様の画面をそのまま開けるようにする
  const demo = demoEnabled();
  const demoTables = demo
    ? await ctx.query('SELECT name, public_id FROM tables WHERE SCOPE() ORDER BY sort_order, id')
    : [];

  return (
    <div>
      <div className="topbar">
        <span className="brand">飲食店OS</span>
        <span style={{ color: '#8b90a0', fontSize: 12 }}>
          {ctx.store?.name}／{ctx.staffName}（{ROLE_LABEL[ctx.role]}）／{PLANS[ctx.plan]?.name || ctx.plan}
        </span>
      </div>

      <div className="wrap">
        <div className="h1" style={{ fontSize: 26, marginTop: 10 }}>店舗の管理メニュー</div>
        <div className="muted" style={{ marginBottom: 16 }}>使いたい画面を選んでください。</div>

        <div className="grid g4">
          {menus.map(([href, title, desc, icon]) => (
            <Link key={href} href={href} className="card" style={{ display: 'block' }}>
              <div style={{ fontSize: 28 }}>{icon}</div>
              <div style={{ fontWeight: 800, marginTop: 6 }}>{title}</div>
              <div className="muted" style={{ marginTop: 4, lineHeight: 1.6 }}>{desc}</div>
            </Link>
          ))}
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <div className="h2">お客様の注文画面</div>
          <div className="muted">
            テーブルのQRコードから開きます。QRコードの発行と印刷は「テーブル・QR」画面で行えます。
          </div>
          {demo && demoTables.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 12, fontWeight: 700 }}>
                テストプレイ用：QRを読まずにお客様の画面を開く
              </div>
              <div className="demoroles" style={{ marginTop: 8 }}>
                {demoTables.map((t) => (
                  <a key={t.public_id} className="btn btn-sm" href={`/q/${t.public_id}`} target="_blank" rel="noreferrer">
                    {t.name}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
