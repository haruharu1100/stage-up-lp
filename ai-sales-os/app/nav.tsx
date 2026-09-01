'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** 左のメニュー。今どこを見ているかが分かるように、開いているページに色を付ける。 */
const GROUPS: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: '全体',
    items: [
      { href: '/', label: 'ダッシュボード' },
      { href: '/approvals', label: '承認待ち（1クリック）' },
    ],
  },
  {
    group: '法人営業',
    items: [
      { href: '/companies', label: '会社一覧' },
      { href: '/leads', label: '営業候補' },
      { href: '/leads/top5', label: '最初に営業する5社' },
      { href: '/first-send', label: '最初に手で送る1社' },
      { href: '/outreach/call', label: '電話営業' },
      { href: '/outreach/email', label: 'メール営業' },
      { href: '/outreach/form', label: 'フォーム営業' },
      { href: '/deals', label: '商談' },
      { href: '/deals/won', label: '成約' },
    ],
  },
  {
    group: '案件受注',
    items: [
      { href: '/jobs/inbox', label: '案件を取り込む' },
      { href: '/jobs', label: '案件検索' },
      { href: '/jobs/sites', label: '規約台帳' },
      { href: '/jobs/candidates', label: '応募候補' },
      { href: '/jobs/top5', label: '最初に応募する5案件' },
      { href: '/jobs/applied', label: '応募済み' },
      { href: '/replies', label: '返信' },
      { href: '/orders', label: '受注' },
      { href: '/orders/production', label: '制作中' },
      { href: '/orders/delivery', label: '納品待ち' },
    ],
  },
  {
    group: 'お金と学習',
    items: [
      { href: '/revenue', label: '売上・利益' },
      { href: '/learning', label: 'AI学習' },
    ],
  },
  {
    group: '設定',
    items: [
      { href: '/pricing', label: '商品・価格設定' },
      { href: '/system', label: 'システム状態' },
      { href: '/obsidian', label: 'Obsidian同期' },
    ],
  },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="side">
      <h1>AI営業・案件受注OS</h1>
      <p className="tagline">
        外部への送信・応募・納品は
        <br />
        すべてOFF（処理コードが無い）
      </p>
      {GROUPS.map((g) => (
        <div key={g.group}>
          <div className="group">{g.group}</div>
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} className={path === it.href ? 'on' : ''}>
              {it.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
