import Link from 'next/link';
import { listFilterOptions, listProducts } from '@/lib/queries';
import { SKIP_REASONS } from '@/lib/score';
import { DECISION_CLASS, DECISION_JA, num, pct, yen } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function s(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v && v !== '' ? v : undefined;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const page = Number(s(sp.page) ?? '1') || 1;
  const filter = {
    decision: s(sp.decision),
    supplier: s(sp.supplier),
    brand: s(sp.brand),
    q: s(sp.q),
    minScore: s(sp.minScore) ? Number(s(sp.minScore)) : undefined,
    sort: s(sp.sort) ?? 'score',
    page,
  };

  const [{ rows, total, perPage }, options] = await Promise.all([listProducts(filter), listFilterOptions()]);
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...over } as Record<string, string | number | undefined>;
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '' && !Array.isArray(v)) p.set(k, String(v));
    }
    return `/products?${p.toString()}`;
  };

  return (
    <main>
      <h1>商品一覧</h1>
      <p className="lead">{num(total)} 件。並び替えと絞り込みができます。商品名をクリックすると「なぜこの判定なのか」が読めます。</p>

      <form className="filters" method="get">
        <input name="q" placeholder="商品名・ブランド・型番・JAN" defaultValue={filter.q ?? ''} style={{ minWidth: 240 }} />
        <select name="decision" defaultValue={filter.decision ?? ''}>
          <option value="">判定：すべて</option>
          <option value="STRONG_BUY">STRONG BUY</option>
          <option value="BUY">BUY</option>
          <option value="WATCH">WATCH</option>
          <option value="LOW_PRIORITY">LOW PRIORITY</option>
          <option value="SKIP">SKIP</option>
        </select>
        <select name="supplier" defaultValue={filter.supplier ?? ''}>
          <option value="">仕入先：すべて</option>
          {options.suppliers.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <select name="brand" defaultValue={filter.brand ?? ''}>
          <option value="">ブランド：すべて</option>
          {options.brands.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <select name="sort" defaultValue={filter.sort}>
          <option value="score">並び替え：BUY SCORE順</option>
          <option value="profit">予想純利益順</option>
          <option value="roi">ROI順</option>
          <option value="discount">あと少しで買える順</option>
          <option value="purchase">仕入価格の安い順</option>
          <option value="newest">新着順</option>
        </select>
        <input name="minScore" type="number" placeholder="最低スコア" defaultValue={filter.minScore ?? ''} style={{ width: 110 }} />
        <button className="primary" type="submit">絞り込む</button>
        <Link href="/products" className="small muted">条件をクリア</Link>
      </form>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>仕入先</th>
              <th className="num">仕入価格</th>
              <th className="num">市場価格</th>
              <th className="num">必要販売価格</th>
              <th className="num">予想純利益</th>
              <th className="num">ROI</th>
              <th className="num">BUY SCORE</th>
              <th>判定</th>
              <th className="num">あといくら安くなれば</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const decision = String(r.decision ?? '');
              const discount = r.discount_needed === null ? null : Number(r.discount_needed);
              return (
                <tr key={String(r.id)}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 380 }}>
                    <Link href={`/products/${r.id}`}>{String(r.name || '(名称なし)')}</Link>
                    <div className="small muted">
                      {[String(r.brand || ''), String(r.model_number || ''), String(r.size || ''), String(r.color || '')]
                        .filter(Boolean)
                        .join(' / ')}
                      {Number(r.is_ai_candidate) === 1 && <span className="badge tag" style={{ marginLeft: 6 }}>AI候補</span>}
                      {Number(r.fees_estimated) === 1 && <span className="badge est" style={{ marginLeft: 6 }}>手数料概算</span>}
                    </div>
                  </td>
                  <td className="small">{String(r.supplier_code)}</td>
                  <td className="num">{yen(r.purchase_price === null ? null : Number(r.purchase_price))}</td>
                  <td className="num">{yen(r.market_price === null ? null : Number(r.market_price))}</td>
                  <td className="num">{yen(r.required_sell_price === null ? null : Number(r.required_sell_price))}</td>
                  <td className={`num ${Number(r.expected_net_profit) > 0 ? 'pos' : Number(r.expected_net_profit) < 0 ? 'neg' : ''}`}>
                    {yen(r.expected_net_profit === null ? null : Number(r.expected_net_profit))}
                  </td>
                  <td className="num">{pct(r.expected_roi === null ? null : Number(r.expected_roi))}</td>
                  <td className="num">{r.buy_score === null ? '—' : num(Number(r.buy_score))}</td>
                  <td>
                    <span className={DECISION_CLASS[decision] ?? 'badge skip'}>{DECISION_JA[decision] ?? '—'}</span>
                    {r.skip_reason && (
                      <div className="small muted">
                        {SKIP_REASONS[String(r.skip_reason) as keyof typeof SKIP_REASONS] ?? String(r.skip_reason)}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {discount === null ? (
                      <span className="muted">—</span>
                    ) : discount === 0 ? (
                      <span className="pos">条件を満たす</span>
                    ) : (
                      <>
                        <div>あと {yen(discount)}</div>
                        <div className="small muted">{yen(Number(r.buyable_purchase_price))} 以下なら買える</div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">該当する商品がありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        {page > 1 && <Link href={qs({ page: page - 1 })}>← 前へ</Link>}
        <span className="muted small">
          {page} / {lastPage} ページ
        </span>
        {page < lastPage && <Link href={qs({ page: page + 1 })}>次へ →</Link>}
      </div>
    </main>
  );
}
