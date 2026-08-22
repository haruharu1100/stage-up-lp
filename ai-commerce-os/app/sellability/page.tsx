import { listVenues } from '@/lib/venues';
import { listSellChecks, sellCheckSummary } from '@/lib/sellcheck';
import {
  SELLABILITY_SCOPE_NOTE,
  SELLABILITY_SOURCE_TOOL_JA,
  SELLABILITY_THRESHOLDS,
  SELLABILITY_VERDICT_JA,
  type SellabilitySourceTool,
  type SellabilityVerdict,
} from '@/lib/sellability';
import SellCheckForm from './SellCheckForm';

export const dynamic = 'force-dynamic';

/**
 * 売れるかテスト（Phase 3.9d）。
 *
 * 【この画面がやること／やらないこと】
 * やること   … 人が Keepa 等で見た数字を受け取り、同じ物差しで判定し、消さずに積む。
 * やらないこと… どこかへ通信する。URLを作る。空欄を推測で埋める。買う。
 *
 * 【なぜ件数を大きく出さないか】
 * 件数を成果にすると、入力すればするほど進んでいるように見えてしまう。
 * 出すのは「別々の商品が何点で、そのうち何点が売れていたか」。
 */
function n(v: number | null | undefined, unit = ''): string {
  return v === null || v === undefined ? '不明' : `${Number(v).toLocaleString('ja-JP')}${unit}`;
}

function f(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '不明' : Number(v).toFixed(digits);
}

export default async function SellabilityPage() {
  const [venues, rows, summary] = await Promise.all([
    listVenues(),
    listSellChecks(200),
    sellCheckSummary(),
  ]);

  const venueOptions = venues.map((v) => ({ code: v.code, name: `${v.name}（${v.code}）` }));

  return (
    <>
      <h1>売れるかテスト</h1>
      <p className="lead">
        「この商品は、そもそも売れているのか」だけを確かめる画面です。
        Keepa などの画面をご自身で開いて、数字をここに書き写してください。
        <strong>このシステムは Keepa にも Amazon にも一切アクセスしません。</strong>
      </p>

      <div className="cards">
        <div className="card hi">
          <div className="k">調べた商品</div>
          <div className="v">{summary.distinctProducts}</div>
          <div className="sub">記録は {summary.total} 件（同じ商品を何度見ても1点と数えます）</div>
        </div>
        <div className="card">
          <div className="k">売れている</div>
          <div className="v">{summary.byVerdict.SELLS}</div>
          <div className="sub">自分にも回ってきそうなもの</div>
        </div>
        <div className="card">
          <div className="k">ライバルが多い</div>
          <div className="v">{summary.byVerdict.CROWDED}</div>
          <div className="sub">売れてはいるが自分に回りにくい</div>
        </div>
        <div className="card">
          <div className="k">判断できない</div>
          <div className="v">{summary.byVerdict.UNKNOWN}</div>
          <div className="sub">材料が足りないもの。埋めずにそのまま残しています</div>
        </div>
      </div>

      <p className="note">{summary.headlineJa}</p>

      <h2>判定の決まり（勝手に緩めません）</h2>
      <table>
        <tbody>
          <tr>
            <th>期間中に順位が1回も下がっていない</th>
            <td>売れていない、と判定します</td>
          </tr>
          <tr>
            <th>下落が{SELLABILITY_THRESHOLDS.MIN_RANK_DROPS}回未満</th>
            <td>たまたまと区別がつかないので、判定しません（「判断できない」）</td>
          </tr>
          <tr>
            <th>自分が加わると月{SELLABILITY_THRESHOLDS.MIN_PER_SELLER_MONTHLY}個に届かない</th>
            <td>「売れてはいるが、ライバルが多い」に分けます</td>
          </tr>
          <tr>
            <th>観測が{SELLABILITY_THRESHOLDS.STALE_DAYS}日より古い</th>
            <td>古い数字で「売れる」とは言いません（見直しをお願いします）</td>
          </tr>
          <tr>
            <th>必要な欄が空いている</th>
            <td>推測で埋めず、「判断できない」にします</td>
          </tr>
        </tbody>
      </table>

      <h2>1件記録する</h2>
      <SellCheckForm venues={venueOptions} />

      <h2>これまでの記録</h2>
      {rows.length === 0 ? (
        <p className="note">まだ1件もありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>観測日</th>
              <th>商品</th>
              <th>市場／見た画面</th>
              <th>期間</th>
              <th>下落回数</th>
              <th>ライバル</th>
              <th>推定 月間販売数</th>
              <th>自分の取り分（月）</th>
              <th>判定</th>
              <th>実市場データに数えたか</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{String(r.observed_at).slice(0, 10)}</td>
                <td>
                  {r.product_name ?? '（商品名なし）'}
                  <div className="small muted">{r.product_key}</div>
                </td>
                <td>
                  {r.venue_code}
                  <div className="small muted">
                    {SELLABILITY_SOURCE_TOOL_JA[r.source_tool as SellabilitySourceTool] ?? r.source_tool}
                  </div>
                </td>
                <td>{r.window_days}日</td>
                <td>{n(r.rank_drops, '回')}</td>
                <td>{n(r.offer_count, '人')}</td>
                <td>{f(r.estimated_monthly_sales)}個</td>
                <td>{f(r.per_seller_monthly, 2)}個</td>
                <td>
                  {SELLABILITY_VERDICT_JA[r.verdict as SellabilityVerdict] ?? r.verdict}
                  <div className="small muted">{r.reason}</div>
                </td>
                <td>{r.counts_as_real_market === 1 ? '数えている' : '数えていない'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>この画面の限界（はっきり書いておきます）</h2>
      <ul>
        <li>{SELLABILITY_SCOPE_NOTE}</li>
        <li>
          売れ筋順位の下落回数は<strong>販売数そのものではありません</strong>。
          このシステムはそこから出した数字を必ず「推定」と呼びます。
        </li>
        <li>
          第三者ツールで見た数字は、<strong>実市場データ100件には数えていません</strong>
          （現在 {summary.countedAsRealMarket} 件）。
          市場から正式に提供されたデータではないためです。
          数え始めてよいかは、ツールの利用規約をご本人が確認してから決めます。
        </li>
      </ul>
    </>
  );
}
