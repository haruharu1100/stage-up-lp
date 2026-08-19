import Link from 'next/link';
import { accuracyBySegment, accuracyOverall, routeWinRates, TIER_JA } from '@/lib/accuracy';
import { all } from '@/lib/db/client';
import { num, pct, yen } from '@/lib/format';
import { CAUSE_JA, fastestOpportunities, opportunitySummary } from '@/lib/opportunity';
import { ensureReady } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}点`;
const errClass = (v: unknown) => (v === null || v === undefined ? '' : Number(v) < 0 ? 'neg' : 'pos');

/** 誤差はプラスが「予想より実際が良かった」、マイナスが「予想が甘かった」。 */
function ErrCell({ v, fmt }: { v: unknown; fmt: (n: number | null) => string }) {
  if (v === null || v === undefined) return <td className="num muted">—</td>;
  return <td className={`num ${errClass(v)}`}>{fmt(Number(v))}</td>;
}

export default async function AccuracyPage() {
  await ensureReady();

  const overall = await accuracyOverall();
  const routes = await routeWinRates(30);
  const byBrand = await accuracyBySegment('brand', 30);
  const byCategory = await accuracyBySegment('category', 30);
  const bySellVenue = await accuracyBySegment('sell_venue', 30);
  const oppSummary = await opportunitySummary();
  const fastest = await fastestOpportunities(15);

  const shadow = await all(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_count,
           SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_count
      FROM route_shadow_trades`);
  const s = shadow[0] ?? {};
  const total = Number(s.total ?? 0);

  const d30 = overall.find((r) => Number(r.horizon_days) === 30);
  const decided30 = Number(d30?.decided_count ?? 0);

  return (
    <main>
      <h1>予測精度（AIの判断が当たっていたか）</h1>
      <p className="lead">
        AIが「これは買うと利益になる」と判断した組み合わせを、実際には買わずに記録し、
        <strong>7日後・30日後・90日後の相場で答え合わせ</strong>した結果です。
        ここで予想と実際のズレが小さくなるまで、実際の購入には進みません。
      </p>

      {total === 0 && (
        <div className="note">
          まだ記録がありません。<Link href="/routes">どこで買ってどこで売るか</Link> を先に作ってください。
        </div>
      )}

      <div className="cards">
        <div className="card">
          <div className="k">記録した仮想取引</div>
          <div className="v">{num(total)}</div>
          <div className="sub">実際には1件も買っていません</div>
        </div>
        <div className="card">
          <div className="k">答え合わせ待ち</div>
          <div className="v">{num(Number(s.open_count ?? 0))}</div>
          <div className="sub">期限が来ると自動で判定します</div>
        </div>
        <div className="card">
          <div className="k">答え合わせ済み</div>
          <div className="v">{num(Number(s.closed_count ?? 0))}</div>
          <div className="sub">7日・30日・90日すべて判定済み</div>
        </div>
        <div className="card">
          <div className="k">30日後の的中率</div>
          <div className="v">{decided30 > 0 ? pct(d30?.hit_rate as number | null) : '—'}</div>
          <div className="sub">判定できた {num(decided30)} 件のうち</div>
        </div>
      </div>

      {/* ------------------------------------------------ 全体の誤差 */}
      <div className="panel">
        <h2>予想と実際のズレ</h2>
        <p className="small muted">
          マイナスは「予想のほうが良く見積もっていた」という意味です。
          判定できなかったもの（成約データが無く、売れたかどうか確認できないもの）は、
          当たりにも外れにも数えていません。無理に勝ち負けを付けると精度が嘘になるためです。
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>期間</th>
                <th className="num">判定できた件数</th>
                <th className="num">判定保留</th>
                <th className="num">売却確率の的中率</th>
                <th className="num">販売価格の平均ズレ</th>
                <th className="num">利益の平均ズレ</th>
                <th className="num">ROIの平均ズレ</th>
                <th className="num">予想ROI → 実績ROI</th>
              </tr>
            </thead>
            <tbody>
              {overall.map((r) => (
                <tr key={String(r.horizon_days)}>
                  <th style={{ textAlign: 'left' }}>{r.horizon_days}日後</th>
                  <td className="num">{num(Number(r.decided_count))}</td>
                  <td className="num muted">{num(Number(r.unconfirmed_count))}</td>
                  <td className="num">{r.hit_rate === null ? '—' : pct(Number(r.hit_rate))}</td>
                  <ErrCell v={r.avg_sell_price_error} fmt={yen} />
                  <ErrCell v={r.avg_net_profit_error} fmt={yen} />
                  <ErrCell v={r.avg_roi_error} fmt={(n) => pct(n)} />
                  <td className="num">
                    {r.avg_predicted_roi === null ? '—' : pct(Number(r.avg_predicted_roi))}
                    {' → '}
                    <strong>{r.avg_actual_roi === null ? '—' : pct(Number(r.avg_actual_roi))}</strong>
                  </td>
                </tr>
              ))}
              {overall.length === 0 && (
                <tr><td colSpan={8} className="muted">まだ答え合わせの期限が来ていません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------------------ Route勝率 */}
      <div className="panel">
        <h2>市場の組み合わせごとの勝率（30日）</h2>
        <p className="small muted">
          「どこで買ってどこで売る」が一番当たっているかです。
          <strong>件数が少ないうちは点数を補正しません</strong>（数件の偶然で順位を動かさないため）。
          補正は最大でも ±10点までで、ここで判定そのものを作ることはありません。
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>仕入 → 販売</th>
                <th className="num">記録</th>
                <th className="num">成功</th>
                <th className="num">失敗</th>
                <th className="num">判定保留</th>
                <th className="num">平均実績ROI</th>
                <th className="num">点数の補正</th>
                <th>補正の強さ</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={String(r.route)}>
                  <th style={{ textAlign: 'left' }}>{String(r.route)}</th>
                  <td className="num">{num(Number(r.sample_count))}</td>
                  <td className="num pos">{num(Number(r.sold_count))}</td>
                  <td className="num neg">{num(Number(r.not_sold_count))}</td>
                  <td className="num muted">{num(Number(r.unconfirmed_count))}</td>
                  <td className="num">{r.avg_actual_roi === null ? '—' : pct(Number(r.avg_actual_roi))}</td>
                  <td className={`num ${Number(r.score_adjustment) === 0 ? 'muted' : errClass(r.score_adjustment)}`}>
                    {signed(Number(r.score_adjustment ?? 0))}
                  </td>
                  <td className="small muted">
                    {TIER_JA[String(r.adjustment_tier) as keyof typeof TIER_JA] ?? String(r.adjustment_tier)}
                  </td>
                </tr>
              ))}
              {routes.length === 0 && (
                <tr><td colSpan={8} className="muted">まだ判定できた組み合わせがありません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------------------ 切り口別 */}
      <div className="panel">
        <h2>どこが弱いか（切り口別の精度・30日）</h2>
        <p className="small muted">
          販売先・ブランド・カテゴリのどれで読み違えが多いかを見ます。
          ここで弱いところが分かれば、しきい値を下げるのではなく「その分野は避ける」判断ができます。
        </p>
        <div className="split">
          <SegmentTable title="販売先ごと" rows={bySellVenue} />
          <SegmentTable title="ブランドごと" rows={byBrand} />
        </div>
        <div style={{ marginTop: 14 }}>
          <SegmentTable title="カテゴリごと" rows={byCategory} />
        </div>
      </div>

      {/* ------------------------------------------------ 利益機会の寿命 */}
      <div className="panel">
        <h2>利益機会がどれくらいで消えるか</h2>
        <p className="small muted">
          価格差は永遠には続きません。誰かが買えば消えます。
          <strong>速度が90以上のものは、見つけた時にはもう間に合わない可能性が高い</strong>種類の価格差です。
          利益の大きさだけを追いかけて、実際には取れない機会ばかり並べないために記録しています。
        </p>
        {oppSummary && (
          <div className="cards" style={{ marginBottom: 12 }}>
            <div className="card">
              <div className="k">追跡中の価格差</div>
              <div className="v">{num(Number(oppSummary.total ?? 0))}</div>
            </div>
            <div className="card">
              <div className="k">まだ生きている</div>
              <div className="v">{num(Number(oppSummary.alive ?? 0))}</div>
            </div>
            <div className="card">
              <div className="k">消えた</div>
              <div className="v">{num(Number(oppSummary.expired ?? 0))}</div>
            </div>
            <div className="card">
              <div className="k">平均寿命</div>
              <div className="v sm">
                {oppSummary.avg_lifetime_hours === null
                  ? '—' : `${Number(oppSummary.avg_lifetime_hours).toFixed(1)}時間`}
              </div>
            </div>
          </div>
        )}
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>仕入 → 販売</th>
                <th className="num">消えるまで</th>
                <th className="num">速度</th>
                <th className="num">最高だった時の利益</th>
                <th>価格差が生まれた理由</th>
              </tr>
            </thead>
            <tbody>
              {fastest.map((r) => (
                <tr key={String(r.id)}>
                  <th style={{ textAlign: 'left' }}>
                    {String(r.buy_venue_code)} → {String(r.sell_venue_code)}
                  </th>
                  <td className="num">
                    {r.lifetime_hours === null ? '—' : `${Number(r.lifetime_hours).toFixed(1)}時間`}
                  </td>
                  <td className="num">
                    <span className={`badge ${Number(r.speed_score) >= 90 ? 'skip' : 'tag'}`}>
                      {num(Number(r.speed_score))}
                    </span>
                  </td>
                  <td className="num">{yen(Number(r.best_net_profit))}</td>
                  <td className="small">
                    {CAUSE_JA[String(r.cause_class) as keyof typeof CAUSE_JA] ?? String(r.cause_class)}
                    <div className="muted">{String(r.cause_note ?? '')}</div>
                  </td>
                </tr>
              ))}
              {fastest.length === 0 && (
                <tr><td colSpan={5} className="muted">まだ消えた価格差の記録がありません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="note">
        この画面の数字は<strong>記録と集計だけ</strong>です。ここまでの機能に、商品を買う処理・出品する処理は
        1行も入っていません。実際の購入に進むかどうかは、予想と実際のズレが十分に小さくなってから、
        人が判断して解禁します。
      </div>
    </main>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  const shown = rows.filter((r) => Number(r.decided_count ?? 0) > 0).slice(0, 12);
  return (
    <div>
      <h3 className="small muted" style={{ margin: '0 0 6px' }}>{title}</h3>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>区分</th>
              <th className="num">判定</th>
              <th className="num">成功</th>
              <th className="num">利益の平均ズレ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={String(r.segment_key)}>
                <th style={{ textAlign: 'left' }}>{String(r.segment_key)}</th>
                <td className="num">{num(Number(r.decided_count))}</td>
                <td className="num pos">{num(Number(r.sold_count))}</td>
                <td className={`num ${errClass(r.avg_net_profit_error)}`}>
                  {r.avg_net_profit_error === null ? '—' : yen(Number(r.avg_net_profit_error))}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="muted small">判定できた件数がまだありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
