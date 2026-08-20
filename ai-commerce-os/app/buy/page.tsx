import { autoPurchaseStatusJa, AUTO_PURCHASE_CONDITIONS } from '@/lib/autopurchase';
import {
  openBlockedReasonJa, urlFreshnessJa,
  URL_SOURCE_JA, URL_STATUS_JA, PURCHASE_OUTCOME_JA,
  type PurchaseOutcome,
} from '@/lib/producturl';
import { buyOpportunities, openWithoutOutcome, purchaseLinkSummary } from '@/lib/purchaselink';
import OpenPurchaseLink from './OpenPurchaseLink';
import OutcomeForm from './OutcomeForm';
import UrlStatusForm from './UrlStatusForm';

export const dynamic = 'force-dynamic';

/**
 * BUY OPPORTUNITIES（ユーザー指示12 13 14）。
 *
 * 【この画面は商品を買わない】
 * 「購入ページを開く」は、商品ページへのただのリンクである。
 * 買うかどうかは、開いた先で人が判断する。AIは注文も決済もログインもしない。
 *
 * 【いま出せない数字は出さない（正直に書く）】
 * 設計上ここには 予想販売価格 / RAW利益 / 補正利益 / 保守利益 / ROI / 保守ROI /
 * 売却確率 / Liquidity Score / Route Score / Opportunity Lifetime / データConfidence
 * が並ぶ。しかし、いまの Route は「仕入先商品」が起点で、
 * 「この1件の実出品を、この価格で買ったらいくらになるか」という計算がまだ無い。
 * だから、それらしい数字をここで作らない。
 * 画面は立派になるが、根拠の無い利益額を見て人が現金を出すことになる。
 */
function yen(n: number | null): string {
  return n === null ? '不明' : `${n.toLocaleString('ja-JP')}円`;
}

export default async function BuyOpportunitiesPage() {
  const [rows, summary, waiting] = await Promise.all([
    buyOpportunities(200),
    purchaseLinkSummary(),
    openWithoutOutcome(50),
  ]);

  const statusOptions = rows.map((r) => ({
    listingKey: r.listingKey,
    label: `${r.venueCode}／${r.productName ?? '（商品名なし）'}／いまの状態：${URL_STATUS_JA[r.urlStatus]}`,
  }));

  const outcomeOptions = waiting.map((w: any) => ({
    openId: Number(w.id),
    label: `${String(w.opened_at).slice(0, 16).replace('T', ' ')}／${String(w.venue_code)}／`
      + `${w.product_name ? String(w.product_name) : '（商品名なし）'}／`
      + `開いた時の価格：${w.opened_price === null || w.opened_price === undefined ? '不明' : `${Number(w.opened_price).toLocaleString('ja-JP')}円`}`,
  }));

  const openable = rows.filter((r) => r.canOpen);

  return (
    <>
      <h1>仕入候補（BUY OPPORTUNITIES）</h1>
      <p className="lead">
        AIが見つけた仕入候補です。<strong>買うのはご自身です。</strong>
        「購入ページを開く」を押すと、その市場の商品ページが新しいタブで開きます。
        このシステムは注文も決済もログインもしません。
      </p>

      <div className="cards">
        <div className={openable.length > 0 ? 'card hi' : 'card'}>
          <div className="k">🔥 いま開ける候補</div>
          <div className="v">{openable.length}</div>
          <div className="sub">商品ページが「出品中」と確認できているもの</div>
        </div>
        <div className="card">
          <div className="k">開いた回数</div>
          <div className="v">{summary.opened}</div>
          <div className="sub">うち結果記入済み {summary.answered}件</div>
        </div>
        <div className="card">
          <div className="k">購入したと報告された件数</div>
          <div className="v">{summary.purchasedCount}</div>
          <div className="sub">ご自身が商品ページで買ったもの</div>
        </div>
        <div className={summary.severeCount > 0 ? 'card' : 'card'}>
          <div className="k">違う商品だった</div>
          <div className={`v ${summary.severeCount > 0 ? 'neg' : ''}`}>{summary.severeCount}</div>
          <div className="sub">1件でもあると次の段階へ進みません</div>
        </div>
        <div className="card">
          <div className="k">状態が未確認</div>
          <div className="v">{summary.unknownStatus}</div>
          <div className="sub">確認するまで開けません</div>
        </div>
      </div>

      <div className={summary.severeCount > 0 ? 'note danger' : 'note'}>{summary.verdictJa}</div>

      <div className="note warn">{autoPurchaseStatusJa()}</div>

      <h2>仕入候補の一覧</h2>
      <p className="lead small">
        利益額・ROI・Route Score はまだ出していません。
        いまの計算は「仕入先の商品」を起点にしており、「この1件の出品を買ったらいくらになるか」の形になっていないためです。
        <strong>根拠のない金額をここに並べない</strong>という方針です。実出品を仕入候補として扱う変換ができ次第、この列を追加します。
      </p>

      {rows.length === 0 ? (
        <div className="note">
          仕入候補がまだありません。実市場の出品が登録されると、ここに並びます。
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>市場</th>
                <th>商品名</th>
                <th className="num">出品価格</th>
                <th>商品ページの状態</th>
                <th>最終確認</th>
                <th>URLの出どころ</th>
                <th className="num">開いた回数</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const blocked = r.hasIncorrectMatch
                  ? 'この出品は「違う商品だった」と記録されています。'
                  : (openBlockedReasonJa(r.urlStatus) ?? '');
                return (
                  <tr key={r.listingKey}>
                    <td><span className="badge tag">{r.venueCode}</span></td>
                    <td>{r.productName ?? <span className="muted">（商品名なし）</span>}</td>
                    <td className="num">{yen(r.listingPrice)}</td>
                    <td>
                      {r.hasIncorrectMatch
                        ? <span className="badge skip">違う商品</span>
                        : <span className={`badge ${r.urlStatus === 'ACTIVE' ? 'strong' : 'low'}`}>
                            {URL_STATUS_JA[r.urlStatus]}
                          </span>}
                    </td>
                    <td className="small muted">{urlFreshnessJa(r.urlVerifiedAt)}</td>
                    <td className="small muted">{URL_SOURCE_JA[r.urlSource]}</td>
                    <td className="num">{r.openCount}</td>
                    <td className="right">
                      <OpenPurchaseLink
                        listingKey={r.listingKey}
                        url={r.productUrl}
                        canOpen={r.canOpen}
                        blockedReason={blocked}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="split">
        <div>
          <h2>開いたあと、どうでしたか</h2>
          <p className="lead small">
            結果が入らないと、AIの判断が実際に合っていたかを数えられません。
          </p>
          <OutcomeForm options={outcomeOptions} />

          {summary.answered > 0 && (
            <div className="panel">
              <h3>これまでの結果</h3>
              <dl className="kv">
                {Object.entries(summary.byOutcome).map(([code, n]) => (
                  <div key={code} style={{ display: 'contents' }}>
                    <dt>{PURCHASE_OUTCOME_JA[code as PurchaseOutcome] ?? code}</dt>
                    <dd>{n}件</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div>
          <h2>商品ページの状態を記録する</h2>
          <p className="lead small">
            このシステムは商品ページへ通信しません。
            まだ売っているかどうかは、ご自身がページを見て記録してください。
            <strong>見ていないものを「出品中」にしないでください。</strong>
          </p>
          <UrlStatusForm options={statusOptions} />

          <h2>自動購入について</h2>
          <div className="note">
            自動購入は<strong>まだ作っていません</strong>（機能を止めているのではなく、処理そのものがありません）。
            将来これを可能にするには、次の9つが<strong>すべて</strong>そろう必要があります。
          </div>
          <ol className="small muted">
            {AUTO_PURCHASE_CONDITIONS.map((c) => (
              <li key={c.code} style={{ marginBottom: 6 }}>
                {c.ja}<br /><span className="muted">{c.why}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
