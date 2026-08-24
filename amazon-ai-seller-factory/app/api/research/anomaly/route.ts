import { NextResponse } from 'next/server';
import { all, migrate, nowIso, run } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/**
 * 異常データ（DATA_ANOMALY）の一覧と「人が確認した」の記録。
 *
 * ★ここで「確認済み」にしても、発注も出品も起きない。
 *   起きるのは「次のリサーチからこの商品を普通に判定してよい」という記録だけ。
 */

export async function GET() {
  await migrate();
  const rows = await all(
    `SELECT id, asin, amazon_title, supplier, supplier_title, amazon_price_jpy, supplier_price_jpy,
            monthly_sales_est, bsr, seller_count, grade, anomaly, anomaly_level, anomaly_items,
            anomaly_summary, anomaly_cleared_at, anomaly_cleared_by, anomaly_cleared_note, created_at
       FROM research_candidates
      WHERE anomaly = 1
      ORDER BY (anomaly_cleared_at IS NOT NULL), created_at DESC
      LIMIT 200`,
  );
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const id = String(body?.id || '').trim();
    if (!id) return NextResponse.json({ error: 'idが指定されていません' }, { status: 400 });

    const action = String(body?.action || 'clear');
    if (action === 'clear') {
      const note = String(body?.note || '').slice(0, 300);
      const actor = String(body?.actor || '本人').slice(0, 60);
      await run(
        `UPDATE research_candidates
            SET anomaly_cleared_at = ?, anomaly_cleared_by = ?, anomaly_cleared_note = ?
          WHERE id = ?`,
        [nowIso(), actor, note || null, id],
      );
      return NextResponse.json({
        ok: true,
        message: 'この商品を「人が確認済み」にしました。次のリサーチから通常どおり判定されます',
      });
    }
    if (action === 'reopen') {
      await run(
        `UPDATE research_candidates
            SET anomaly_cleared_at = NULL, anomaly_cleared_by = NULL, anomaly_cleared_note = NULL
          WHERE id = ?`,
        [id],
      );
      return NextResponse.json({ ok: true, message: '確認済みを取り消し、隔離した状態に戻しました' });
    }
    return NextResponse.json({ error: '知らない操作です' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
