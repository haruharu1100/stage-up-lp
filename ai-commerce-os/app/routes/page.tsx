import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import {
  blockedOpportunities, listRoutes, routeOverview, routeRanking,
  routeShadowSummary, routeStrengths,
} from '@/lib/routequeries';
import { LIQUIDITY_BASIS_JA, PRICE_BASIS_JA, ROUTE_SKIP_JA } from '@/lib/route';
import { BLOCKED_REASON_JA, type Venue } from '@/lib/venues';
import { DECISION_CLASS, DECISION_JA, num, pct, yen } from '@/lib/format';

export const dynamic = 'force-dynamic';

const SORT_LABELS: Record<string, string> = {
  score: '総合点が高い順',
  profit: '利益が大きい順',
  roi: '利益率が高い順',
  fast: '早く現金化できる順',
  return30: '30日あたりの期待リターン順',
};

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: { sort?: string; buy?: string; sell?: string; status?: string };
}) {
  await ensureReady();
  const sort = searchParams.sort ?? 'score';
  const status = searchParams.status ?? 'OK';

  const [venuesRaw, o, rows, ranking, strengths, lost, shadow] = await Promise.all([
    all('SELECT * FROM venues ORDER BY code'),
    routeOverview(),
    listRoutes({ sort, status, buy: searchParams.buy, sell: searchParams.sell, limit: 80 }),
    routeRanking(20),
    routeStrengths(25),
    blockedOpportunities(15),
    routeShadowSummary(),
  ]);
  const venues = venuesRaw as unknown as Venue[];
  const nameOf = (code: string) => venues.find((v) => v.code === code)?.name ?? code;

  return (
    <main>
      <h1>Route（買う場所 × 売る場所）</h1>
      <p className="lead">
        すべての市場を、すべての市場と突き合わせて計算しています。方向は固定していません。
        「スニダンで買ってメルカリで売る」も「メルカリで買ってスニダンで売る」も、どちらも計算対象です。
        <strong>Phase 2 では実際の購入・出品は行いません。</strong>計算と記録だけです。
      </p>

      <div className="cards">
        <div className="card">
          <div className="k">計算したRoute</div>
          <div className="v">{num(o.total)}</div>
          <div className="sub">{num(o.pairs)} 通りの市場の組み合わせ</div>
        </div>
        <div className="card hi">
          <div className="k">成立したRoute</div>
          <div className="v">{num(o.ok)}</div>
          <div className="sub">基準を満たした組み合わせ</div>
        </div>
        <div className="card">
          <div className="k">ベストが決まった商品</div>
          <div className="v">{num(o.productsWithRoute)}</div>
          <div className="sub">平均ROI {pct(o.avgBestRoi)}</div>
        </div>
        <div className="card">
          <div className="k">ベスト合計の予想利益</div>
          <div className="v sm">{yen(o.totalBestProfit)}</div>
          <div className="sub">全部買った場合の机上の合計</div>
        </div>
        <div className="card">
          <div className="k">規約で使えない</div>
          <div className="v">{num(o.blocked)}</div>
          <div className="sub">うち黒字 {num(o.blockedProfitable)} 件</div>
        </div>
        <div className="card">
          <div className="k">SHADOW記録</div>
          <div className="v">{num(o.shadowOpen)}</div>
          <div className="sub">買ったつもりの記録（実購入なし）</div>
        </div>
      </div>

      {o.marketRows === 0 && (
        <div className="note" style={{ marginTop: 14 }}>
          市場ごとの相場がまだ1件も登録されていません。いまは1つの参考相場を全市場に当てはめた仮定値で計算しているため、
          市場間の差が出ません。<Link href="/market">市場ごとの相場</Link> を登録すると精度が上がります。
        </div>
      )}

      <h2>Route一覧</h2>
      <form className="filters" method="get">
        <select name="status" defaultValue={status}>
          <option value="OK">成立したものだけ</option>
          <option value="BLOCKED">規約・仕様で使えないもの</option>
          <option value="SKIP">基準に届かなかったもの</option>
          <option value="all">すべて</option>
        </select>
        <select name="sort" defaultValue={sort}>
          {Object.entries(SORT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="buy" defaultValue={searchParams.buy ?? ''}>
          <option value="">仕入先：すべて</option>
          {venues.filter((v) => v.can_buy === 1).map((v) => (
            <option key={v.code} value={v.code}>{v.name}</option>
          ))}
        </select>
        <select name="sell" defaultValue={searchParams.sell ?? ''}>
          <option value="">販売先：すべて</option>
          {venues.filter((v) => v.can_sell === 1).map((v) => (
            <option key={v.code} value={v.code}>{v.name}</option>
          ))}
        </select>
        <button type="submit">絞り込む</button>
      </form>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>買う</th>
              <th>売る</th>
              <th className="num">仕入総額</th>
              <th className="num">予想販売価格</th>
              <th className="num">入金予想</th>
              <th className="num">予想純利益</th>
              <th className="num">ROI</th>
              <th className="num">30日で売れる確率</th>
              <th className="num">売却日数</th>
              <th className="num">点数</th>
              <th>判定</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={13} className="muted">該当するRouteがありません。</td></tr>
            )}
            {rows.map((r) => {
              const d = String(r.decision ?? '');
              const profit = Number(r.expected_net_profit ?? 0);
              return (
                <tr key={String(r.id)}>
                  <td>
                    <Link href={`/products/${r.supplier_product_id}`}>{String(r.name ?? '(名称なし)')}</Link>
                    <div className="small muted">{String(r.brand ?? '')}</div>
                  </td>
                  <td>{nameOf(String(r.buy_venue_code))}</td>
                  <td>{nameOf(String(r.sell_venue_code))}</td>
                  <td className="num">{yen(Number(r.acquisition_total_cost))}</td>
                  <td className="num">{yen(Number(r.expected_sell_price))}</td>
                  <td className="num">{yen(Number(r.expected_net_receipt))}</td>
                  <td className={`num ${profit >= 0 ? 'pos' : 'neg'}`}>{yen(profit)}</td>
                  <td className="num">{pct(r.expected_roi === null ? null : Number(r.expected_roi))}</td>
                  <td className="num">{pct(Number(r.sell_probability_30d))}</td>
                  <td className="num">{num(Number(r.expected_days_to_sell))}日</td>
                  <td className="num">{num(Number(r.route_score))}</td>
                  <td><span className={DECISION_CLASS[d] ?? 'badge skip'}>{DECISION_JA[d] ?? '—'}</span></td>
                  <td className="small">
                    {r.blocked_reason && (
                      <span className="badge skip">{BLOCKED_REASON_JA[String(r.blocked_reason)] ?? String(r.blocked_reason)}</span>
                    )}
                    {r.skip_reason && <span className="muted">{ROUTE_SKIP_JA[String(r.skip_reason)] ?? String(r.skip_reason)}</span>}
                    {String(r.price_basis) === 'REFERENCE_FALLBACK' && <span className="badge est">相場が仮定値</span>}
                    {Number(r.fees_estimated) === 1 && <span className="badge est">手数料が概算</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>儲かるのに使えない組み合わせ（取り逃し）</h2>
      <p className="lead small">
        規約・出品停止などで実行できない組み合わせです。数字は計算上の値で、実行してはいけません。
        「どこが開けば一番得か」を判断するために残しています。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>買う</th>
              <th>売る</th>
              <th className="num">予想純利益</th>
              <th className="num">ROI</th>
              <th>使えない理由</th>
            </tr>
          </thead>
          <tbody>
            {lost.length === 0 && <tr><td colSpan={6} className="muted">いまのところありません。</td></tr>}
            {lost.map((r) => (
              <tr key={String(r.id)}>
                <td><Link href={`/products/${r.supplier_product_id}`}>{String(r.name ?? '')}</Link></td>
                <td>{nameOf(String(r.buy_venue_code))}</td>
                <td>{nameOf(String(r.sell_venue_code))}</td>
                <td className="num pos">{yen(Number(r.expected_net_profit))}</td>
                <td className="num">{pct(r.expected_roi === null ? null : Number(r.expected_roi))}</td>
                <td className="small">
                  <span className="badge skip">
                    {BLOCKED_REASON_JA[String(r.blocked_reason)] ?? String(r.blocked_reason)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>組み合わせの成績ランキング</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>買う → 売る</th>
              <th className="num">計算件数</th>
              <th className="num">成立件数</th>
              <th className="num">成立率</th>
              <th className="num">平均ROI</th>
              <th className="num">平均利益</th>
              <th className="num">最高利益</th>
              <th className="num">平均売却日数</th>
            </tr>
          </thead>
          <tbody>
            {ranking.length === 0 && <tr><td colSpan={8} className="muted">まだ成績がありません。</td></tr>}
            {ranking.map((r, i) => (
              <tr key={i}>
                <td>{nameOf(String(r.buy_venue_code))} → {nameOf(String(r.sell_venue_code))}</td>
                <td className="num">{num(Number(r.route_count))}</td>
                <td className="num">{num(Number(r.ok_count))}</td>
                <td className="num">{pct(Number(r.success_rate))}</td>
                <td className="num pos">{pct(r.avg_roi === null ? null : Number(r.avg_roi))}</td>
                <td className="num">{yen(r.avg_net_profit === null ? null : Number(r.avg_net_profit))}</td>
                <td className="num">{yen(r.best_net_profit === null ? null : Number(r.best_net_profit))}</td>
                <td className="num">{r.avg_days_to_sell === null ? '—' : `${num(Number(r.avg_days_to_sell))}日`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>組み合わせごとの得意な商品</h2>
      <p className="lead small">
        「この市場で買ってこの市場で売ると、このカテゴリが強い」という傾向です。件数が少ないものは偶然の可能性があります。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>買う → 売る</th>
              <th>カテゴリ</th>
              <th className="num">成立件数</th>
              <th className="num">平均ROI</th>
              <th className="num">平均利益</th>
            </tr>
          </thead>
          <tbody>
            {strengths.length === 0 && <tr><td colSpan={5} className="muted">まだ傾向を出せるだけの件数がありません。</td></tr>}
            {strengths.map((r, i) => (
              <tr key={i}>
                <td>{nameOf(String(r.buy_venue_code))} → {nameOf(String(r.sell_venue_code))}</td>
                <td>{String(r.segment_key)}</td>
                <td className="num">{num(Number(r.ok_count))}</td>
                <td className="num pos">{pct(r.avg_roi === null ? null : Number(r.avg_roi))}</td>
                <td className="num">{yen(r.avg_net_profit === null ? null : Number(r.avg_net_profit))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>SHADOW（買ったつもりの記録）</h2>
      <p className="lead small">
        「買う」と判断したRouteを、実際には買わずに記録しています。30日後に予想と実績を突き合わせて、
        判断が正しかったかを検証するためのものです。現在 {num(shadow.open)} 件が検証待ちです。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>買う → 売る</th>
              <th className="num">仮の仕入総額</th>
              <th className="num">予想販売価格</th>
              <th className="num">予想純利益</th>
              <th className="num">ROI</th>
              <th className="num">30日で売れる確率</th>
              <th>検証予定日</th>
            </tr>
          </thead>
          <tbody>
            {shadow.rows.length === 0 && <tr><td colSpan={8} className="muted">まだ記録がありません。</td></tr>}
            {shadow.rows.map((r) => (
              <tr key={String(r.id)}>
                <td><Link href={`/products/${r.supplier_product_id}`}>{String(r.name ?? '')}</Link></td>
                <td>{nameOf(String(r.buy_venue_code))} → {nameOf(String(r.sell_venue_code))}</td>
                <td className="num">{yen(Number(r.acquisition_total_cost))}</td>
                <td className="num">{yen(Number(r.expected_sell_price))}</td>
                <td className="num pos">{yen(Number(r.expected_net_profit))}</td>
                <td className="num">{pct(r.expected_roi === null ? null : Number(r.expected_roi))}</td>
                <td className="num">{pct(Number(r.sell_probability_30d))}</td>
                <td className="small muted">{String(r.verify_due_at ?? '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>毎日の発見数</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th className="num">計算</th>
              <th className="num">成立</th>
              <th className="num">使えない</th>
              <th className="num">ベスト決定</th>
              <th className="num">最高ROI</th>
              <th className="num">SHADOW</th>
            </tr>
          </thead>
          <tbody>
            {o.kpi.length === 0 && <tr><td colSpan={7} className="muted">まだ記録がありません。</td></tr>}
            {o.kpi.map((k) => (
              <tr key={String(k.day)}>
                <td>{String(k.day)}</td>
                <td className="num">{num(Number(k.routes_generated))}</td>
                <td className="num">{num(Number(k.routes_ok))}</td>
                <td className="num">{num(Number(k.routes_blocked))}</td>
                <td className="num">{num(Number(k.products_with_route))}</td>
                <td className="num">{pct(k.best_roi === null ? null : Number(k.best_roi))}</td>
                <td className="num">{num(Number(k.shadow_opened))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel small" style={{ marginTop: 14 }}>
        <strong>数字の根拠について。</strong>{' '}
        {PRICE_BASIS_JA.SOLD_MEDIAN}をもとにした計算が一番信頼できます。
        {PRICE_BASIS_JA.ASK_MEDIAN}は「その値段で売れた証拠」ではありません。
        {PRICE_BASIS_JA.REFERENCE_FALLBACK}のRouteは、その市場の相場が分からないため信頼度を大きく下げています。
        流動性は{LIQUIDITY_BASIS_JA.OBSERVED}のときだけ実測扱いです。
      </div>
    </main>
  );
}
