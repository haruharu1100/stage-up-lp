import { redirect } from 'next/navigation';
import { resolveTableCode } from '../../../lib/tenant-db.js';

export const dynamic = 'force-dynamic';

/**
 * テーブルに貼るQRの行き先。
 * 会計のたびに入場トークンは入れ替わるが、このURLは永久に変わらないので
 * QRは一度印刷すれば貼りっぱなしで使い続けられる。
 */
export default async function TableQrEntry({ params }) {
  const r = await resolveTableCode(params.code);

  if (!r) {
    return (
      <div className="wrap-narrow">
        <div className="card" style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 40 }}>🔍</div>
          <div className="h2" style={{ marginTop: 10 }}>ページが見つかりません</div>
          <div className="muted">お手数ですが、店員をお呼びください。</div>
        </div>
      </div>
    );
  }

  redirect(`/t/${r.table.token}`);
}
