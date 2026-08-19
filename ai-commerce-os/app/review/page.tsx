import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady, manualReviewQueue } from '@/lib/queries';
import { SKIP_REASONS } from '@/lib/score';
import { num, yen } from '@/lib/format';
import { ConditionMapForm, VerdictForm } from './ReviewActions';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  await ensureReady();

  const unknownConditions = await all(
    `SELECT supplier_code, raw_condition, COUNT(*) AS n
       FROM supplier_products
      WHERE pipeline_state = 'MANUAL_REVIEW'
        AND needs_review_reason LIKE 'UNKNOWN_CONDITION:%'
        AND raw_condition IS NOT NULL AND raw_condition != ''
      GROUP BY supplier_code, raw_condition
      ORDER BY n DESC`,
  );

  const rows = await manualReviewQueue();
  const anomalies = rows.filter((r) => String(r.needs_review_reason ?? '').startsWith('PRICE_ANOMALY'));

  return (
    <main>
      <h1>人間確認</h1>
      <p className="lead">
        AIが「分からない」と判断したものだけがここに来ます。分からないまま買わないための画面です。
      </p>

      <h2>意味の分からない状態表記（{num(unknownConditions.length)} 種類）</h2>
      <p className="small muted">
        仕入先ごとに書き方が違うため、推測でランクを当てはめず人間に聞きます。一度登録すれば、次回以降は自動で判定されます。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>仕入先</th>
              <th>CSVの表記</th>
              <th className="num">件数</th>
              <th>どの状態にあたるか</th>
            </tr>
          </thead>
          <tbody>
            {unknownConditions.map((r) => (
              <tr key={`${r.supplier_code}:${r.raw_condition}`}>
                <td className="small">{String(r.supplier_code)}</td>
                <td>
                  <strong>{String(r.raw_condition)}</strong>
                </td>
                <td className="num">{num(Number(r.n))}</td>
                <td>
                  <ConditionMapForm
                    supplierCode={String(r.supplier_code)}
                    rawLabel={String(r.raw_condition)}
                    count={Number(r.n)}
                  />
                </td>
              </tr>
            ))}
            {unknownConditions.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">確認まちはありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>価格がおかしい商品（{num(anomalies.length)} 件）</h2>
      <p className="small muted">
        市場価格に対して仕入価格が安すぎる商品です。データの入力ミスか、本物でない可能性があります。
        自動では買いません。現物・出典を確認してから判断してください。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>仕入先</th>
              <th className="num">仕入価格</th>
              <th className="num">市場価格</th>
              <th className="num">仕入÷市場</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((r) => {
              const pp = r.purchase_price === null ? null : Number(r.purchase_price);
              const mp = r.market_price === null ? null : Number(r.market_price);
              return (
                <tr key={String(r.id)}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                    <Link href={`/products/${r.id}`}>{String(r.name || '(名称なし)')}</Link>
                    <div className="small muted">{String(r.brand || '')}</div>
                  </td>
                  <td className="small">{String(r.supplier_code)}</td>
                  <td className="num">{yen(pp)}</td>
                  <td className="num">{yen(mp)}</td>
                  <td className="num">{pp !== null && mp ? `${((pp / mp) * 100).toFixed(0)}%` : '—'}</td>
                  <td>
                    <VerdictForm id={Number(r.id)} />
                  </td>
                </tr>
              );
            })}
            {anomalies.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">確認まちはありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>確認まちの全件（{num(rows.length)} 件）</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>仕入先</th>
              <th>理由</th>
              <th className="num">仕入価格</th>
              <th className="num">市場価格</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const reason = String(r.needs_review_reason ?? '');
              const label = reason.startsWith('UNKNOWN_CONDITION:')
                ? `状態表記が未登録：${reason.split(':').slice(1).join(':')}`
                : SKIP_REASONS[reason as keyof typeof SKIP_REASONS] ?? reason;
              return (
                <tr key={String(r.id)}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                    <Link href={`/products/${r.id}`}>{String(r.name || '(名称なし)')}</Link>
                  </td>
                  <td className="small">{String(r.supplier_code)}</td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{label}</td>
                  <td className="num">{yen(r.purchase_price === null ? null : Number(r.purchase_price))}</td>
                  <td className="num">{yen(r.market_price === null ? null : Number(r.market_price))}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">確認まちはありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
