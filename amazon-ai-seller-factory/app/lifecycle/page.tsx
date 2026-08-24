import FinanceBoard, { type FinanceProductRow } from '@/components/FinanceBoard';
import LifecycleBoard from '@/components/LifecycleBoard';
import ReorderBoard, { type ReorderBoardRow } from '@/components/ReorderBoard';
import { reorderList } from '@/lib/inventory/stockLedger';
import { migrate } from '@/lib/db/client';
import { config } from '@/lib/env';
import { yen } from '@/lib/format';
import { buildFinanceFromRow, cashOverview } from '@/lib/finance/ledger';
import { REAL_COST_KEYS } from '@/lib/finance/realProfit';
import { lifecycleCounts, lifecycleList } from '@/lib/learning/lifecycle';
import { overallAccuracy } from '@/lib/learning/forecastAccuracy';
import { LIFECYCLE_LABEL, LIFECYCLE_STATUSES } from '@/lib/types';

const COST_COLUMN: Record<string, string> = {
  purchaseJpy: 'cost_purchase_jpy',
  supplierShippingJpy: 'cost_supplier_shipping_jpy',
  intlShippingJpy: 'cost_intl_shipping_jpy',
  dutyJpy: 'cost_duty_jpy',
  amazonFeeJpy: 'cost_amazon_fee_jpy',
  fulfillmentJpy: 'cost_fulfillment_jpy',
  adJpy: 'cost_ad_jpy',
  returnJpy: 'cost_return_jpy',
  discountJpy: 'cost_discount_jpy',
  disposalJpy: 'cost_disposal_jpy',
  storageJpy: 'cost_storage_jpy',
  otherJpy: 'cost_other_jpy',
};

export const dynamic = 'force-dynamic';

/**
 * 仕入れ・販売の記録（商品の一生）。
 * ★ここでも発注はしない。人が仕入先サイトで注文し、その結果を記録する台帳。
 */
export default async function LifecyclePage() {
  await migrate();
  const [rows, counts, accuracy, cash, reorders] = await Promise.all([
    lifecycleList({ limit: 200 }),
    lifecycleCounts(),
    overallAccuracy(),
    cashOverview(),
    reorderList(100),
  ]);

  const reorderRows: ReorderBoardRow[] = reorders as ReorderBoardRow[];
  const reorderNow = reorderRows.filter((r) => r.action === 'REORDER_NOW').length;
  const reorderSoon = reorderRows.filter((r) => r.action === 'REORDER_SOON').length;

  // ---- 実費・キャッシュフロー・資金効率（承認より先に進んだ商品だけ）----
  const financeRows: FinanceProductRow[] = rows
    .filter((r) => !['DISCOVERED', 'WATCHING'].includes(String(r.status)))
    .map((r: any) => {
      const built = buildFinanceFromRow(r);
      const costs: Record<string, number | null> = {};
      for (const k of REAL_COST_KEYS) {
        const v = r[COST_COLUMN[k]];
        costs[k] = v == null ? null : Number(v);
      }
      return {
        id: String(r.id),
        title: String(r.title ?? ''),
        status: String(r.status ?? ''),
        costs,
        grossSalesJpy: r.gross_sales_jpy != null ? Number(r.gross_sales_jpy) : null,
        realNetProfitJpy: built.profit.realNetProfitJpy,
        realRoi: built.profit.realRoi,
        missing: built.profit.missing,
        cashPaidJpy: r.cash_paid_jpy != null ? Number(r.cash_paid_jpy) : null,
        cashPaidAt: r.cash_paid_at ? String(r.cash_paid_at) : null,
        payoutExpectedJpy: r.payout_expected_jpy != null ? Number(r.payout_expected_jpy) : null,
        payoutExpectedAt: built.cash.payoutExpectedAt,
        payoutEstimated: built.cash.payoutDateEstimated,
        inventoryValueJpy: r.inventory_value_jpy != null ? Number(r.inventory_value_jpy) : null,
        adUnrecoveredJpy: r.ad_unrecovered_jpy != null ? Number(r.ad_unrecovered_jpy) : null,
        cashReceivedJpy: r.cash_received_jpy != null ? Number(r.cash_received_jpy) : null,
        cashConversionDays: built.cash.cashConversionDays,
        gmroi: built.efficiency.gmroi,
        turnoverPerYear: built.efficiency.turnoverPerYear,
        profitPer30DaysJpy: built.efficiency.profitPer30DaysJpy,
        cashTiedDays: built.efficiency.cashTiedDays,
        cashEfficiencyPer10k: built.efficiency.cashEfficiencyPer10kPer30Days,
        efficiencyReasons: built.efficiency.reasons,
      };
    });

  const withActuals = rows.filter((r) => r.actual_units_sold != null);
  const totalProfit = withActuals.reduce((a, r) => a + (Number(r.actual_profit_jpy) || 0), 0);
  const totalCost = rows
    .filter((r) => ['ORDERED', 'RECEIVED', 'LISTED', 'SELLING', 'SOLD_OUT'].includes(String(r.status)))
    .reduce((a, r) => a + (Number(r.planned_total_cost_jpy) || 0), 0);

  return (
    <main className="wrap">
      <div className="notice info">
        <strong>この画面はお金を動かしません。</strong>
        「仕入れ承認」も「発注した」も、あなたの操作を<strong>記録するだけ</strong>です。
        実際の注文は仕入先サイトでご自身で行ってください（AUTO_PURCHASE={String(config.autoPurchase)}）。
      </div>

      <div className="card">
        <h2>いま何がどこまで進んでいるか</h2>
        <div className="statusgrid">
          {LIFECYCLE_STATUSES.map((s) => (
            <div className="statuscell" key={s}>
              <strong>{counts[s] ?? 0}</strong>
              {LIFECYCLE_LABEL[s]}
            </div>
          ))}
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">実績を入れ終わった商品</div>
            <div className="kpi-value">{withActuals.length}</div>
            <div className="kpi-note">件（5件たまると学習が動きます）</div>
          </div>
          <div className="kpi strong">
            <div className="kpi-label">実績の利益合計</div>
            <div className="kpi-value">{totalProfit.toLocaleString()}</div>
            <div className="kpi-note">円</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">いま仕入れに使った金額</div>
            <div className="kpi-value">{totalCost.toLocaleString()}</div>
            <div className="kpi-note">円（承認時の予定額の合計）</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">需要予測の当たり具合</div>
            <div className="kpi-value">{accuracy.demand != null ? accuracy.demand : '—'}</div>
            <div className="kpi-note">
              {accuracy.demand != null ? `%（実績${accuracy.samples}件）` : `実績${accuracy.samples}件（5件から計算）`}
            </div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          実績を入れると、次のリサーチが「あなたの実際の売れ方」に合わせて補正されます。
          入れないままだと、いつまでも机上の予測のままです。
        </p>
      </div>

      {reorderNow > 0 && (
        <div className="notice err">
          <strong>いま発注しないと欠品する商品が{reorderNow}件あります。</strong>
          下の「補充（再発注）の推奨」で中身を確認してください
          {reorderSoon > 0 ? `（もうすぐ発注が必要なものも${reorderSoon}件あります）` : ''}。
        </div>
      )}

      <div className="card">
        <h2>補充（再発注）の推奨</h2>
        <p className="desc">
          売れ続けている商品を切らさないための画面です。在庫・直近の販売数・仕入先の納期を入れると、
          <strong>いつまでに何個注文すればよいか</strong>を計算します。
          初回の商品は推奨数の{Math.round(config.newProductSafetyFactor * 100)}%に抑え、
          実績が黒字なら次から段階的に増やします（一度に増やすのは前回の2倍まで）。
        </p>
        <ReorderBoard rows={reorderRows} autoReorder={config.autoReorder} />
      </div>

      <div className="card">
        <h2>会社全体のお金の流れ</h2>
        <p className="desc">
          「利益が出ている」と「手元に現金がある」は別ものです。
          ここは<strong>いま現金がどこにあるか</strong>だけを見る場所です。入力された金額だけで計算しています（推測では埋めません）。
        </p>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">仕入れで出ていった現金</div>
            <div className="kpi-value">{yen(cash.paidJpy)}</div>
            <div className="kpi-note">対象{cash.productCount}商品</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">すでに戻ってきた現金</div>
            <div className="kpi-value">{yen(cash.receivedJpy)}</div>
            <div className="kpi-note">回収済み</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Amazonからの入金予定</div>
            <div className="kpi-value">{yen(cash.payoutExpectedJpy)}</div>
            <div className="kpi-note">これから入る予定</div>
          </div>
          <div className="kpi strong">
            <div className="kpi-label">まだ戻っていない現金</div>
            <div className="kpi-value">{yen(cash.outstandingJpy)}</div>
            <div className="kpi-note">いまリスクにさらしている金額</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">在庫として眠っている金額</div>
            <div className="kpi-value">{yen(cash.inventoryValueJpy)}</div>
            <div className="kpi-note">売れるまで現金に戻りません</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">広告の未回収額</div>
            <div className="kpi-value">{yen(cash.adUnrecoveredJpy)}</div>
            <div className="kpi-note">先に払って回収待ちの分</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">現金化までの日数（中央値）</div>
            <div className="kpi-value">
              {cash.medianCashConversionDays != null ? cash.medianCashConversionDays : '—'}
            </div>
            <div className="kpi-note">
              {cash.medianCashConversionDays != null
                ? `日（${config.slowCashDays}日を超えると要注意）`
                : '入出金日を入れると出ます'}
            </div>
          </div>
        </div>

        {cash.upcoming.length > 0 && (
          <>
            <h4>30日以内に入る予定のお金</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>入金予定日</th>
                  <th>商品</th>
                  <th>金額</th>
                </tr>
              </thead>
              <tbody>
                {cash.upcoming.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {String(u.date).slice(0, 10)}
                      {u.estimated && <span className="small muted">（推定）</span>}
                    </td>
                    <td>{u.title.slice(0, 30)}</td>
                    <td>{yen(u.jpy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              「推定」は入金予定日が未入力のため、売れた日＋{config.amazonPayoutLagDays}日で置いた日付です。
              正しい日付を入れると推定は消えます。
            </p>
          </>
        )}

        {cash.slow.length > 0 && (
          <div className="notice warn" style={{ marginTop: 10 }}>
            <strong>現金が戻るのが遅い商品があります（{config.slowCashDays}日超）。</strong>
            <ul className="small" style={{ marginBottom: 0 }}>
              {cash.slow.map((s) => (
                <li key={s.id}>
                  {s.title.slice(0, 30)}：{s.days}日
                </li>
              ))}
            </ul>
            利益率が高くても、現金が戻るのが遅い商品は次の仕入れができません。同じ資金なら早く回る商品を優先してください。
          </div>
        )}
      </div>

      <div className="card">
        <h2>本当の手残りと資金効率</h2>
        <p className="desc">
          仕入代・送料・関税・Amazon手数料・FBA送料・広告費・返品・値引き・廃棄・保管費まで、
          <strong>12項目すべてを引いた金額</strong>が「本当の手残り」です。Amazonの売上だけを見て黒字と判断しません。
          商品同士を比べるときは<strong>「1万円が30日で生む額」</strong>を見てください（利益率より正確です）。
        </p>
        <FinanceBoard rows={financeRows} />
      </div>

      <div className="card">
        <h2>商品ごとの記録</h2>
        <p className="desc">
          承認した商品を、注文→入荷→出品→販売→売り切れ の順に進めていきます。
          売れ終わったら「売れた数」と「手元に残った利益」を入れてください。そこが学習の入口です。
        </p>
        <LifecycleBoard rows={rows} />
      </div>

      <div className="card">
        <h2>この画面でできないこと</h2>
        <ul className="small">
          <li>仕入先への自動発注（このシステムは外部へ注文しません）</li>
          <li>Amazonへの自動出品・自動価格変更（AMAZON_AUTO_PUBLISH={String(config.autoPublish)}）</li>
          <li>広告の自動入札変更（AD_AUTO_OPTIMIZE={String(config.adAutoOptimize)}）</li>
          <li>在庫が減ったときの自動追加発注（AUTO_REORDER={String(config.autoReorder)}）</li>
        </ul>
        <p className="small muted">
          お金が動く行為は、必ずあなたの手で行う設計です。システムは「調べる・数える・学ぶ」だけを担当します。
        </p>
      </div>
    </main>
  );
}
