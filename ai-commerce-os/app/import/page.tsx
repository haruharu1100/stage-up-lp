import { listSuppliers } from '@/lib/connectors/registry';
import { ensureReady } from '@/lib/queries';
import ImportForm from './ImportForm';

export const dynamic = 'force-dynamic';

const COLUMNS: { key: string; label: string; required: boolean; note: string }[] = [
  { key: 'supplier_product_id', label: '商品ID・管理番号', required: false, note: '無ければ中身から自動で作ります' },
  { key: 'product_name', label: '商品名', required: false, note: '' },
  { key: 'brand', label: 'ブランド', required: false, note: '表記ゆれは自動でそろえます' },
  { key: 'category', label: 'カテゴリ', required: false, note: '手数料の判定に使います' },
  { key: 'model_number', label: '型番', required: false, note: '同一商品の判定に使います' },
  { key: 'jan', label: 'JANコード', required: false, note: 'あるとデータ信頼度が上がります' },
  { key: 'sku', label: '商品コード', required: false, note: '' },
  { key: 'size', label: 'サイズ', required: false, note: '' },
  { key: 'color', label: '色', required: false, note: '' },
  { key: 'condition', label: '状態', required: false, note: '新品/S/A/B/C/D など。知らない表記は人間確認へ回します' },
  { key: 'purchase_price', label: '仕入価格', required: true, note: 'これが無い行は判定できません' },
  { key: 'market_price', label: '市場価格', required: false, note: '無い行は「相場データ不足」で除外します' },
  { key: 'stock', label: '在庫数', required: false, note: '1なら一点物として価格方式を変えます' },
  { key: 'product_url', label: '商品URL', required: false, note: '' },
  { key: 'image_url', label: '画像URL', required: false, note: '' },
  { key: 'market_price_source', label: '相場の出典', required: false, note: 'あるとデータ信頼度が上がります' },
  { key: 'market_fetched_at', label: '相場の取得日', required: false, note: '古いと信頼度が下がります' },
];

export default async function ImportPage() {
  await ensureReady();
  const suppliers = (await listSuppliers()).map((s) => ({
    code: String(s.code),
    name: String(s.name),
    terms_checked: Number(s.terms_checked),
  }));

  return (
    <main>
      <h1>CSV取込</h1>
      <p className="lead">
        仕入先からもらったCSVをそのまま入れてください。列の名前は日本語でも英語でも読み取ります。
        足りない項目があっても取り込めます（判定できない商品は理由つきで除外されます）。
      </p>

      <div className="note">
        取り込みと同時に自動で分析します。<strong>この画面では商品の購入・出品は一切行いません。</strong>
      </div>

      <ImportForm suppliers={suppliers} />

      <h2>読み取れる列</h2>
      <p className="small muted">
        1行目を見出し行として読みます。ここに無い列は無視されるので、余計な列が入っていても問題ありません。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>必須</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {COLUMNS.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td>{c.required ? <span className="badge strong">必須</span> : <span className="muted small">任意</span>}</td>
                <td className="muted small" style={{ whiteSpace: 'normal' }}>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>仕入先の状態</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>仕入先</th>
              <th>コード</th>
              <th>取引条件の確認</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.code}>
                <td>{s.name}</td>
                <td className="small muted">{s.code}</td>
                <td>
                  {s.terms_checked === 1 ? (
                    <span className="badge buy">確認済み</span>
                  ) : (
                    <span className="badge watch">未確認（CSVのみ）</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        「未確認」の仕入先は、自動で商品を取りに行くことも購入することもしません。人間が用意したCSVだけを読みます。
      </p>
    </main>
  );
}
