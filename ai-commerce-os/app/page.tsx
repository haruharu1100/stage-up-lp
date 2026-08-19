import Link from 'next/link';
import { getDashboard, recentImports, recentRuns, shadowSummary, skipReasonBreakdown, supplierBreakdown } from '@/lib/queries';
import { routeOverview } from '@/lib/routequeries';
import { SKIP_REASONS } from '@/lib/score';
import { num, pct, yen } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [d, skips, suppliers, shadow, imports, runs, ro] = await Promise.all([
    getDashboard(),
    skipReasonBreakdown(),
    supplierBreakdown(),
    shadowSummary(),
    recentImports(),
    recentRuns(),
    routeOverview(),
  ]);

  const empty = d.imported === 0;

  return (
    <main>
      <h1>経営ダッシュボード</h1>
      <p className="lead">
        CSVを入れるだけで「この中で何を買えば利益が出そうか」を順位付けします。実際の購入・出品は行いません。
      </p>

      {empty && (
        <div className="note">
          まだ商品がありません。<Link href="/import">CSV取込</Link> からデータを入れてください。
          テスト用の架空データは <code>npm run seed</code> で作れます。
        </div>
      )}

      <div className="cards">
        <div className="card">
          <div className="k">取込商品数</div>
          <div className="v">{num(d.imported)}</div>
          <div className="sub">本日 {num(d.todayImported)} 件</div>
        </div>
        <div className="card">
          <div className="k">分析完了数</div>
          <div className="v">{num(d.analyzed)}</div>
          <div className="sub">本日 {num(d.todayAnalyzed)} 件</div>
        </div>
        <div className="card hi">
          <div className="k">STRONG BUY</div>
          <div className="v">{num(d.strongBuy)}</div>
          <div className="sub">最優先で検討する商品</div>
        </div>
        <div className="card">
          <div className="k">BUY</div>
          <div className="v">{num(d.buy)}</div>
        </div>
        <div className="card">
          <div className="k">WATCH</div>
          <div className="v">{num(d.watch)}</div>
        </div>
        <div className="card">
          <div className="k">LOW PRIORITY</div>
          <div className="v">{num(d.lowPriority)}</div>
        </div>
        <div className="card">
          <div className="k">SKIP</div>
          <div className="v">{num(d.skip)}</div>
          <div className="sub">うち重複 {num(d.duplicated)} / データ不備 {num(d.invalid)}</div>
        </div>
        <div className="card">
          <div className="k">人間確認まち</div>
          <div className="v">{num(d.manualReview)}</div>
          <div className="sub">
            <Link href="/review">確認する</Link>
          </div>
        </div>
      </div>

      <h2>どこで買って、どこで売るか</h2>
      <p className="lead small">
        市場を「仕入先」「販売先」に固定していません。同じ市場が、安ければ買う場所に、高く売れるなら売る場所になります。
        全部の組み合わせを計算して、利益・売れる確率・資金の回転・リスクで順位をつけています。
      </p>
      <div className="cards">
        <div className="card hi">
          <div className="k">成立した組み合わせ</div>
          <div className="v">{num(ro.ok)}</div>
          <div className="sub">
            計算した組み合わせ {num(ro.total)} 件 ／ <Link href="/routes">一覧を見る</Link>
          </div>
        </div>
        <div className="card">
          <div className="k">ベストが決まった商品</div>
          <div className="v">{num(ro.productsWithRoute)}</div>
          <div className="sub">平均ROI {pct(ro.avgBestRoi)}</div>
        </div>
        <div className="card">
          <div className="k">ベスト合計の予想純利益</div>
          <div className="v sm">{yen(ro.totalBestProfit)}</div>
          <div className="sub">全部売れた場合の机上の値</div>
        </div>
        <div className="card">
          <div className="k">使った市場の組み合わせ</div>
          <div className="v">{num(ro.pairs)}</div>
          <div className="sub">
            <Link href="/matrix">市場マトリクスを見る</Link>
          </div>
        </div>
        <div className="card">
          <div className="k">規約・仕様で使えない</div>
          <div className="v">{num(ro.blockedProfitable)}</div>
          <div className="sub">最大 {yen(ro.blockedBestProfit)} の取り逃し</div>
        </div>
        <div className="card">
          <div className="k">Route SHADOW記録</div>
          <div className="v">{num(ro.shadowOpen)}</div>
          <div className="sub">実際の購入はしていません</div>
        </div>
      </div>

      {ro.marketRows === 0 && (
        <div className="note">
          市場ごとの相場がまだ1件も登録されていません。相場が無い市場は「参考相場を当てはめた仮定値」となり、
          信頼度が下がって判定に通りません。<Link href="/market">市場ごとの相場</Link> から登録してください。
        </div>
      )}

      <h2>仕入候補（STRONG BUY ＋ BUY）の合計</h2>
      <div className="cards">
        <div className="card">
          <div className="k">必要仕入資金</div>
          <div className="v sm">{yen(d.requiredCapital)}</div>
          <div className="sub">全部買った場合に必要な金額</div>
        </div>
        <div className="card hi">
          <div className="k">予想純利益</div>
          <div className="v sm">{yen(d.expectedProfit)}</div>
          <div className="sub">相場で売れた場合の見込み</div>
        </div>
        <div className="card">
          <div className="k">平均予想ROI</div>
          <div className="v sm">{pct(d.averageRoi)}</div>
          <div className="sub">投じたお金に対する利益率</div>
        </div>
        <div className="card">
          <div className="k">AI判定にかける候補</div>
          <div className="v sm">
            {num(d.aiCandidates)} <span className="muted small">({pct(d.aiCandidateRate)})</span>
          </div>
          <div className="sub">全体の1〜5%に絞れていれば正常</div>
        </div>
      </div>

      {d.feesEstimated && (
        <div className="note">
          手数料は<strong>まだ概算値（ESTIMATED）</strong>です。利益額は実額が確定すると変わります。
          <Link href="/settings">設定</Link> から実額を入れてください。
        </div>
      )}

      <div className="split">
        <div>
          <h2>仕入先別の成績</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>仕入先</th>
                  <th className="num">取込</th>
                  <th className="num">買える候補</th>
                  <th className="num">通過率</th>
                  <th className="num">予想純利益</th>
                  <th className="num">平均ROI</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => {
                  const total = Number(s.total);
                  const buyable = Number(s.buyable);
                  return (
                    <tr key={String(s.supplier_code)}>
                      <td>{String(s.supplier_code)}</td>
                      <td className="num">{num(total)}</td>
                      <td className="num">{num(buyable)}</td>
                      <td className="num">{total > 0 ? pct(buyable / total) : '—'}</td>
                      <td className="num pos">{yen(Number(s.profit))}</td>
                      <td className="num">{s.avg_roi === null ? '—' : pct(Number(s.avg_roi))}</td>
                    </tr>
                  );
                })}
                {suppliers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">データがありません</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            ※ 件数が少ないうちの順位は偶然の影響が大きいため、得意分野の判断には使えません。
          </p>
        </div>

        <div>
          <h2>除外された理由</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>理由</th>
                  <th className="num">件数</th>
                </tr>
              </thead>
              <tbody>
                {skips.map((s) => (
                  <tr key={String(s.skip_reason)}>
                    <td>{SKIP_REASONS[String(s.skip_reason) as keyof typeof SKIP_REASONS] ?? String(s.skip_reason)}</td>
                    <td className="num">{num(Number(s.n))}</td>
                  </tr>
                ))}
                {skips.length === 0 && (
                  <tr>
                    <td colSpan={2} className="muted">まだありません</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2>SHADOW（仮想取引）</h2>
          <div className="panel">
            <dl className="kv">
              <dt>記録した判断</dt>
              <dd>{num(shadow.count)} 件</dd>
              <dt>見込み純利益の合計</dt>
              <dd>{yen(shadow.profit)}</dd>
              <dt>平均ROI</dt>
              <dd>{pct(shadow.avgRoi)}</dd>
              <dt>検証済み</dt>
              <dd>{num(shadow.verified)} 件</dd>
            </dl>
            <p className="small muted" style={{ marginBottom: 0 }}>
              実際には買っていません。後日、本当に利益が出たかを検証するための記録です。
            </p>
          </div>
        </div>
      </div>

      <h2>最近の取込</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>仕入先</th>
              <th>ファイル</th>
              <th className="num">行数</th>
              <th className="num">新規</th>
              <th className="num">更新</th>
              <th className="num">重複</th>
              <th className="num">不備</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((i) => (
              <tr key={String(i.id)}>
                <td className="muted small">{String(i.created_at).slice(0, 16).replace('T', ' ')}</td>
                <td>{String(i.supplier_code)}</td>
                <td className="muted small">{i.filename ? String(i.filename) : '—'}</td>
                <td className="num">{num(Number(i.row_count))}</td>
                <td className="num">{num(Number(i.inserted))}</td>
                <td className="num">{num(Number(i.updated))}</td>
                <td className="num">{num(Number(i.duplicated))}</td>
                <td className="num">{num(Number(i.invalid))}</td>
              </tr>
            ))}
            {imports.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">まだありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="small muted" style={{ marginTop: 24 }}>
        直近の処理: {runs.length > 0 ? `${String(runs[0].kind)} / ${String(runs[0].started_at).slice(0, 16).replace('T', ' ')}` : 'なし'}
      </p>
    </main>
  );
}
