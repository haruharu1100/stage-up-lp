'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// [パス, 表示名, 見られる権限, 必要な機能]
const LINKS = [
  ['/admin', 'ダッシュボード', ['owner', 'admin', 'manager'], 'analytics'],
  ['/pos', 'テーブル / 会計', ['owner', 'admin', 'manager', 'staff'], 'pos'],
  ['/pos/close', 'レジ締め', ['owner', 'admin', 'manager'], 'pos'],
  ['/kitchen', '厨房モニター', ['owner', 'admin', 'manager', 'staff', 'kitchen'], 'kds'],
  ['/staff', 'スタッフ注文', ['owner', 'admin', 'manager', 'staff'], 'order'],
  ['/admin/menu', '商品管理', ['owner', 'admin', 'manager'], 'menu'],
  ['/admin/tables', 'テーブル・QR', ['owner', 'admin', 'manager'], 'table'],
  ['/admin/orders', '注文履歴', ['owner', 'admin', 'manager'], 'history'],
  ['/admin/history', 'お店の記憶', ['owner', 'admin', 'manager'], 'history'],
  ['/admin/coupons', 'クーポン', ['owner', 'admin', 'manager'], 'coupon'],
  ['/admin/staff', 'スタッフ', ['owner', 'admin'], 'staff'],
  ['/admin/printers', 'プリンター', ['owner', 'admin', 'manager'], 'pos'],
  ['/admin/logs', '操作ログ', ['owner', 'admin', 'manager'], 'audit'],
  ['/admin/store', 'お店の設定', ['owner', 'admin', 'manager'], 'pos'],
];

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((r) => {
        if (r.ok && r.authenticated) setMe(r.me);
        else router.replace('/login');
      })
      .catch(() => {});
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const visible = me
    ? LINKS.filter(([, , roles, feature]) => roles.includes(me.role) && me.features.includes(feature))
    : [];

  return (
    <div className="topbar">
      <Link href="/" className="brand" style={{ color: '#fff' }}>飲食店OS</Link>
      {visible.map(([href, label]) => (
        <Link key={href} href={href} className={path === href ? 'on' : ''}>
          {label}
        </Link>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {me && (
          <span className="muted" style={{ fontSize: 12 }}>
            {me.storeName}／{me.name}（{me.roleLabel}）
          </span>
        )}
        <button className="btn btn-sm" onClick={logout}>ログアウト</button>
      </div>
    </div>
  );
}
