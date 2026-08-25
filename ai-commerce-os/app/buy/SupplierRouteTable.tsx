/**
 * 仕入価格 → Amazon販売（Phase 4・§17）を、この画面へ合流させる。
 *
 * ------------------------------------------------------------------
 * 【この表と、下にある「仕入候補の一覧」は別のものである】
 *
 * 下の表は「実市場の出品1件」を起点にしていて、
 * 「この1件を買ったらいくらになるか」の計算がまだ無い。だから金額を出していない（ルール63）。
 *
 * こちらの表は「仕入先の商品」を起点にしていて、
 * 仕入価格 → Amazon想定販売価格 → 手数料 → 保守純利益 まで一本でつながっている。
 * だから金額を出せる。**同じ画面に並ぶが、根拠が違うので混ぜない。**
 *
 * 【Keepaへは通信しない】
 * 出しているのは、すでに保存してあるAmazon側データだけである。
 * 画面を開き直しても枠（Token）は1つも減らない。
 *
 * 【買うのは人】
 * ご本人の指示（原文・§28）：「実際の購入はまだ人間。購入ページを開くだけ。」
 * ここに出るリンクも、仕入先の商品ページを新しいタブで開くだけである。
 */

import { DEMAND_CONFIDENCE_JA, type DemandConfidence } from '@/lib/phase4/decision';
import { DROP_REASON_ACTION_JA, DROP_REASON_JA, checkFunnelBeforeScaling, computeKpis, rankDropReasons } from '@/lib/phase4/funnel';
import { formatPriceWatch } from '@/lib/phase4/route';
import { runAllOfferRoutes } from '@/lib/phase4/store';
import { PHASE4_REAL_LISTING_IMPLEMENTED, PHASE4_REAL_PURCHASE_IMPLEMENTED } from '@/lib/phase4/supplier';

function yen(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v.toLocaleString('ja-JP')}円`;
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

function num(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toLocaleString('ja-JP');
}

const DECISION_JA: Record<string, string> = {
  BUY: '買ってよい',
  WATCH: '価格を見張る',
  REVIEW: '人が確認',
  SKIP: '見送り',
};

const DECISION_BADGE: Record<string, string> = {
  BUY: 'strong',
  WATCH: 'tag',
  REVIEW: 'low',
  SKIP: 'skip',
};

const MATCH_GATE_BADGE: Record<string, string> = {
  HIGH_CONFIDENCE: 'strong',
  REVIEW_REQUIRED: 'low',
  REJECTED: 'skip',
};

const MATCH_GATE_SHORT_JA: Record<string, string> = {
  HIGH_CONFIDENCE: '同じ商品',
  REVIEW_REQUIRED: '要確認',
  REJECTED: '別商品',
};

export default async function SupplierRouteTable() {
  // ★保存しない。画面を開いただけで判断を凍結すると、見るたびに記録が増える。
  //   保存は `npm run phase4:route -- --save` で人が明示的に行う。
  const { results, funnel } = await runAllOfferRoutes({ save: false });

  // 見本データは分けて置く。買う候補として数に混ぜない（§21）。
  const real = results.filter((r) => !r.offer.isSample);
  const samples = results.filter((r) => r.offer.isSample);

  const buyable = real.filter((r) => r.decision.decision === 'BUY');
  const watching = real.filter((r) => r.decision.decision === 'WATCH');
  const reviewing = real.filter((r) => r.decision.decision === 'REVIEW');

  const drops = rankDropReasons(funnel.drops);
  const kpis = computeKpis(funnel.counts);
  const gate = checkFunnelBeforeScaling(funnel.counts);

  return (
    <>
      <h2>仕入価格 → Amazon販売（Phase 4）</h2>
      <p className="lead small">
        仕入先の表に入れた商品を、<strong>仕入価格からAmazonでの保守純利益まで一本で計算</strong>したものです。
        Amazon側の数字は保存済みのものだけを使っています（この画面を開いてもKeepaの枠は減りません）。
        <strong>買うのはご自身です。</strong>このシステムは注文も決済もしません。
      </p>

      <div className="cards">
        <div className={buyable.length > 0 ? 'card hi' : 'card'}>
          <div className="k">買ってよい</div>
          <div className="v">{buyable.length}</div>
          <div className="sub">4つの関門をすべて通ったもの</div>
        </div>
        <div className="card">
          <div className="k">価格を見張る</div>
          <div className="v">{watching.length}</div>
          <div className="sub">もう少し安ければ条件を満たすもの</div>
        </div>
        <div className="card">
          <div className="k">人が確認</div>
          <div className="v">{reviewing.length}</div>
          <div className="sub">同じ商品か言い切れないもの</div>
        </div>
        <div className="card">
          <div className="k">入れた仕入候補</div>
          <div className="v">{funnel.counts.SUPPLIER_OFFERS}</div>
          <div className="sub">
            {funnel.excludedSamples > 0
              ? `見本データ ${funnel.excludedSamples}件は数に入れていません`
              : '見本データはありません'}
          </div>
        </div>
      </div>

      {real.length === 0 ? (
        <div className="note">
          仕入候補がまだ1件も入っていません。仕入先の表を作って取り込むところから始めます。
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>商品名</th>
                <th>仕入先</th>
                <th className="num">仕入価格</th>
                <th className="num">Amazon想定販売（保守）</th>
                <th>Amazonの売れ行き</th>
                <th className="num">30日の値下がり</th>
                <th className="num">出品者数</th>
                <th>Amazon本体</th>
                <th className="num">保守の純利益</th>
                <th className="num">保守のROI</th>
                <th>同じ商品か</th>
                <th>データの確からしさ</th>
                <th>判定</th>
                <th className="right">仕入先ページ</th>
              </tr>
            </thead>
            <tbody>
              {real.map((r) => {
                const watch = formatPriceWatch(r.offer.purchasePrice, r.profit?.maxBuyPrice ?? null);
                const profit = r.profit?.conservativeNetProfit ?? null;
                return (
                  <tr key={r.offer.id}>
                    <td>
                      {r.offer.productName}
                      <br />
                      <span className="small muted">{watch.maxBuyPriceJa}／{watch.gapJa}</span>
                    </td>
                    <td className="small">{r.offer.supplierName}</td>
                    <td className="num">{yen(r.offer.purchasePrice)}</td>
                    <td className="num">
                      {yen(r.sellPrice?.conservativeSellPrice)}
                      <br />
                      <span className="small muted">そのまま {yen(r.sellPrice?.rawExpectedSellPrice)}</span>
                    </td>
                    <td className="small">
                      {DEMAND_CONFIDENCE_JA[r.decision.demandConfidence as DemandConfidence]
                        ?? r.decision.demandConfidence}
                      {r.keepa.monthlySoldAtLeast !== null && (
                        <>
                          <br />
                          {/* ★「◯個以上」の区分値。ぴったり何個ではない（ルール116）。 */}
                          <span className="small muted">
                            Keepa表示「月{num(r.keepa.monthlySoldAtLeast)}個以上」
                          </span>
                        </>
                      )}
                    </td>
                    <td className="num">{num(r.keepa.rankDrops30)}回</td>
                    <td className="num">{num(r.keepa.offerCountNew)}</td>
                    <td className="small muted">
                      {r.decision.amazonRetailRisk === 'NONE'
                        ? 'いません'
                        : r.decision.amazonRetailRisk === 'UNKNOWN'
                          ? '不明'
                          : 'います'}
                    </td>
                    <td className={`num ${profit !== null && profit < 0 ? 'neg' : ''}`}>{yen(profit)}</td>
                    <td className="num">{pct(r.profit?.conservativeRoi)}</td>
                    <td>
                      <span className={`badge ${MATCH_GATE_BADGE[r.matchGate] ?? 'low'}`}>
                        {MATCH_GATE_SHORT_JA[r.matchGate] ?? r.matchGate}
                      </span>
                      <br />
                      <span className="small muted">
                        {r.matchScore === null ? '—' : `${r.matchScore}点`}／候補{r.candidateCount}件
                      </span>
                    </td>
                    <td className="small muted">
                      手数料 {r.costs?.feeConfidence === 'VERIFIED' ? '確認済み' : r.costs?.feeConfidence === 'PARTIAL' ? '一部のみ' : '不明'}
                      <br />
                      販売価格 {r.sellPrice?.confidence ?? '—'}
                      <br />
                      {r.keepa.dataAgeHours === null
                        ? '取得時刻が不明'
                        : `${Math.round(r.keepa.dataAgeHours / 24)}日前のデータ`}
                    </td>
                    <td>
                      <span className={`badge ${DECISION_BADGE[r.decision.decision] ?? 'low'}`}>
                        {DECISION_JA[r.decision.decision] ?? r.decision.decision}
                      </span>
                    </td>
                    <td className="right">
                      {/*
                        ★URLはご本人が表に書いたものをそのまま出す。
                          ここで文字列をつなげて作らない（ルール55・98）。
                      */}
                      {r.canOpenSupplierPage && r.offer.sourceProductUrl ? (
                        <a href={r.offer.sourceProductUrl} target="_blank" rel="noopener noreferrer">
                          仕入先の商品ページを開く
                        </a>
                      ) : (
                        <span className="badge skip" title={r.supplierUrlReasonJa}>開けません</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {samples.length > 0 && (
        <div className="note">
          このほかに<strong>見本データが {samples.length}件</strong>あります。
          動作を確かめるための行なので、上の表にも、下の集計にも入れていません。
          仕入先の商品ページも開けません。
        </div>
      )}

      <div className="split">
        <div>
          <h3>どこまで進んで、どこで落ちたか</h3>
          <table>
            <tbody>
              <tr><td>仕入候補として入れた</td><td className="num">{funnel.counts.SUPPLIER_OFFERS}件</td></tr>
              <tr><td>Amazon側に候補が見つかった</td><td className="num">{funnel.counts.ASIN_CANDIDATES}件</td></tr>
              <tr><td>同じ商品だと言い切れた</td><td className="num">{funnel.counts.HIGH_MATCH}件</td></tr>
              <tr><td>Amazonの売れ行きまで見えた</td><td className="num">{funnel.counts.AMAZON_DATA}件</td></tr>
              <tr><td>利益が計算できた</td><td className="num">{funnel.counts.PROFIT_CALCULABLE}件</td></tr>
              <tr><td>買う候補として残った</td><td className="num">{funnel.counts.BUY_OR_WATCH}件</td></tr>
            </tbody>
          </table>

          <h3>4つの数字</h3>
          <dl className="kv">
            {kpis.map((k) => (
              <div key={k.key} style={{ display: 'contents' }}>
                <dt className="small">{k.labelJa}</dt>
                <dd>{k.displayJa}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3>落ちた理由と、次にやること</h3>
          {drops.length === 0 ? (
            <div className="note">まだ落ちた候補はありません。</div>
          ) : (
            <table>
              <tbody>
                {drops.map((d) => (
                  <tr key={d.reason}>
                    <td className="num">{d.count}件</td>
                    <td>
                      {DROP_REASON_JA[d.reason] ?? d.reason}
                      <br />
                      <span className="small muted">→ {DROP_REASON_ACTION_JA[d.reason]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>件数を増やしてよいか</h3>
          <div className={gate.shouldStop ? 'note warn' : 'note'}>
            {gate.shouldStop && <><strong>ここで一度止まります。</strong><br /></>}
            {gate.reasonJa}
          </div>

          <div className="note">
            実際の購入：{PHASE4_REAL_PURCHASE_IMPLEMENTED ? '実装あり' : <strong>実装していません（人が買います）</strong>}
            <br />
            実際の出品：{PHASE4_REAL_LISTING_IMPLEMENTED ? '実装あり' : <strong>実装していません</strong>}
          </div>
        </div>
      </div>
    </>
  );
}
