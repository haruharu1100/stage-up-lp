import DiscoverPanel from '@/components/DiscoverPanel';
import { latestDiscovery, type DiscoveryRowOut } from '@/lib/agents/hunter';
import { listOemRequirements, oemOpportunityByCategory } from '@/lib/oem';
import { sourcingStatus } from '@/lib/sourcing';
import { config } from '@/lib/env';
import { yen, pct } from '@/lib/format';
import { GRADE_LABEL, GRADE_DETAIL, SALES_ROUTE_LABEL, SUPPLIER_CHANNEL_LABEL, type Grade } from '@/lib/types';

export const dynamic = 'force-dynamic';

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D'];

export default async function DiscoverPage() {
  const [latest, oem, oemByCat] = await Promise.all([
    latestDiscovery(),
    listOemRequirements({ limit: 15 }),
    oemOpportunityByCategory(),
  ]);
  const src = sourcingStatus();
  const s = latest?.summary;

  return (
    <main className="wrap">
      <div className="notice info">
        <strong>この画面は「調べて並べる」だけです。</strong>
        仕入れの発注も、Amazonへの出品も、ここからは実行されません。仕入れ発注と新規商品の公開は必ず人が承認します。
      </div>

      <DiscoverPanel />

      {/* ---- 毎朝の4つの数字 ---- */}
      <div className="card">
        <h2>今朝の発掘結果</h2>
        {!s ? (
          <div className="muted">まだ発掘していません。上のボタンを押してください。</div>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="kpi-label">調べた商品</div>
                <div className="kpi-value">{s.analyzed}</div>
                <div className="kpi-note">件</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">見込みあり</div>
                <div className="kpi-value">{s.promising}</div>
                <div className="kpi-note">A＋B＋C</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">利益基準を突破</div>
                <div className="kpi-value">{s.profitCleared}</div>
                <div className="kpi-note">利益率{pct(config.minProfitRate, 0)}以上</div>
              </div>
              <div className="kpi strong">
                <div className="kpi-label">今すぐ仕入れ</div>
                <div className="kpi-value">{s.strongBuy}</div>
                <div className="kpi-note">Aランク</div>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              判定の基準：利益率{pct(config.minProfitRate, 0)}以上／1個あたり利益{yen(config.minProfitJpy)}以上／
              ROI{pct(config.minRoi, 0)}以上／出品者{config.maxSellerCount}人以下。
              数字は環境設定で変えられます。
            </p>
            {(latest?.notes || []).map((n, i) => (
              <div key={i} className="notice warn" style={{ marginTop: 8 }}>
                {n}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ---- ランク別リスト ---- */}
      {latest &&
        GRADE_ORDER.map((g) => {
          const rows = latest.rows.filter((r) => r.grade === g);
          if (!rows.length) return null;
          return <GradeSection key={g} grade={g} rows={rows} />;
        })}

      {/* ---- OEMの設計図 ---- */}
      <div className="card">
        <h2>自社商品（OEM）を作るときの設計図</h2>
        <p className="desc">
          他社商品のレビューに出てきた不満を、カテゴリー別に積み上げています。同じ不満が何度も出るほど「そこを直した商品を作れば勝てる」ということです。
          これは商品を1つ分析するたびに自動で溜まります。
        </p>
        {!oem.length ? (
          <div className="muted">
            まだデータがありません。トップページの「商品を探す」で商品を分析すると、レビューの不満がここに溜まります。
          </div>
        ) : (
          <>
            {oemByCat.length > 1 && (
              <p className="small">
                不満が多いカテゴリー：
                {oemByCat.slice(0, 5).map((c) => `${c.category}（${c.totalHits}件）`).join('・')}
              </p>
            )}
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">カテゴリー</th>
                    <th className="l">不満・改善要望</th>
                    <th>件数</th>
                    <th>優先度</th>
                  </tr>
                </thead>
                <tbody>
                  {oem.map((o, i) => (
                    <tr key={i}>
                      <td className="l">{o.category}</td>
                      <td className="l title">{o.complaint}</td>
                      <td>{o.hitCount}</td>
                      <td>
                        <span className={`badge ${o.priority === 'high' ? 'error' : o.priority === 'medium' ? 'warn' : 'idle'}`}>
                          {o.priority === 'high' ? '高' : o.priority === 'medium' ? '中' : '低'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ---- 仕入先データの状態 ---- */}
      <div className="card">
        <h2>仕入先データ</h2>
        {src.hasCsv ? (
          <p className="small">
            使える仕入先 <strong>{src.usable}件</strong>
            {src.rejected > 0 && <span className="neg">／規約違反で除外 {src.rejected}件</span>}
            <br />
            <span className="muted">{src.path}</span>
          </p>
        ) : (
          <p className="small">
            まだ仕入先データがありません。<code>samples/suppliers.csv</code> を <code>data/suppliers.csv</code> にコピーして、
            実際の問屋・メーカー・eBay・Alibabaの価格を入れてください。入れるまで仕入価格は販売価格の45%で仮置きしています。
          </p>
        )}
        <p className="small muted">
          ★Amazon内の他の出品者は仕入先にできません（ドロップシッピングポリシー違反）。CSVに書いても自動で除外します。
        </p>
      </div>
    </main>
  );
}

function GradeSection({ grade, rows }: { grade: Grade; rows: DiscoveryRowOut[] }) {
  const cls = grade === 'A' ? 'done' : grade === 'B' ? 'working' : grade === 'C' ? 'warn' : 'idle';
  return (
    <div className="card">
      <h2>
        <span className={`badge ${cls}`}>{grade}</span> {GRADE_LABEL[grade]}（{rows.length}件）
      </h2>
      <p className="desc">{GRADE_DETAIL[grade]}</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>点</th>
              <th className="l">商品</th>
              <th className="l">売り方</th>
              <th>Amazon価格</th>
              <th>仕入</th>
              <th>利益</th>
              <th>利益率</th>
              <th>競合</th>
              <th className="l">仕入先</th>
              <th className="l">発動条件・注意</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="score">{Math.round(r.scoreTotal)}</td>
                <td className="l title">
                  {r.title}
                  {r.asin && <div className="small muted">{r.asin}</div>}
                </td>
                <td className="l small">
                  {SALES_ROUTE_LABEL[r.route]}
                  <div className="muted">{r.routeReason}</div>
                </td>
                <td>{yen(r.sellPriceJpy)}</td>
                <td>{yen(r.landedCostJpy ?? r.supplierPriceJpy)}</td>
                <td className={r.profitJpy >= 0 ? 'pos' : 'neg'}>{yen(r.profitJpy)}</td>
                <td className={r.profitRate >= 0.15 ? 'pos' : 'neg'}>{pct(r.profitRate)}</td>
                <td>{r.sellerCount || '—'}</td>
                <td className="l small">
                  {r.supplierName ? (
                    <>
                      {r.supplierName}
                      <div className="muted">
                        {r.supplierChannel ? SUPPLIER_CHANNEL_LABEL[r.supplierChannel as keyof typeof SUPPLIER_CHANNEL_LABEL] : ''}
                      </div>
                    </>
                  ) : (
                    <span className="muted">未確定（仮の値）</span>
                  )}
                </td>
                <td className="l small">
                  <ul className="reasons">
                    {r.reasons.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                  {r.importFlags.length > 0 && (
                    <div className="neg">
                      {r.importFlags.map((f, i) => (
                        <div key={i}>
                          【{f.severity === 'blocking' ? '販売不可' : '要確認'}】{f.category}：{f.detail}
                        </div>
                      ))}
                    </div>
                  )}
                  {r.purchasePlan?.recommendedUnits ? (
                    <div className="muted" style={{ marginTop: 4 }}>
                      仕入れの目安：{r.purchasePlan.recommendedUnits}個（現金{yen(r.purchasePlan.cashOutlayJpy)}／想定利益
                      {yen(r.purchasePlan.expectedProfitJpy)}）
                      {r.purchasePlan.readyForFba && <span className="pos">／FBA切替の目安に到達</span>}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
