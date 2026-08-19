import Link from 'next/link';
import { all } from '@/lib/db/client';
import { routesForProduct } from '@/lib/routequeries';
import { LIQUIDITY_BASIS_JA, PRICE_BASIS_JA, ROUTE_SKIP_JA } from '@/lib/route';
import { BLOCKED_REASON_JA, type Venue } from '@/lib/venues';
import { DECISION_CLASS, DECISION_JA, num, pct, yen } from '@/lib/format';

const BUY_LABELS: [string, string][] = [
  ['itemPrice', '商品代金'],
  ['buyerFee', '購入手数料'],
  ['paymentFee', '決済手数料'],
  ['domesticShipping', '送料（自分に届くまで）'],
  ['authenticationFee', '鑑定料'],
  ['tax', '税'],
  ['importDuty', '関税'],
  ['currencyFee', '為替手数料'],
  ['otherBuyCost', 'その他'],
];

const SELL_LABELS: [string, string][] = [
  ['sellerFee', '販売手数料'],
  ['paymentFee', '決済手数料'],
  ['currencyFee', '為替手数料'],
  ['outboundShipping', '送料（買った人へ送る）'],
  ['authenticationFee', '鑑定料'],
  ['packingCost', '梱包資材'],
  ['warehouseCost', '保管費'],
  ['advertisingCost', '広告費'],
  ['returnExpectedLoss', '返品・キャンセルの見込み'],
  ['otherSellCost', 'その他'],
];

export default async function RoutePanels({ supplierProductId }: { supplierProductId: number }) {
  const [routes, venuesRaw] = await Promise.all([
    routesForProduct(supplierProductId),
    all('SELECT * FROM venues'),
  ]);
  const venues = venuesRaw as unknown as Venue[];
  const nameOf = (code: string) => venues.find((v) => v.code === code)?.name ?? code;

  if (routes.length === 0) {
    return (
      <div className="note">
        この商品にはまだRouteがありません。商品を特定できる情報（JAN、またはブランドと型番）が無いか、
        市場ごとの相場が登録されていない可能性があります。<Link href="/market">市場ごとの相場</Link> を確認してください。
      </div>
    );
  }

  const best = routes.find((r) => String(r.status) === 'OK') ?? null;
  const blockedBetter = routes.find(
    (r) => String(r.status) === 'BLOCKED'
      && Number(r.expected_net_profit) > Number(best?.expected_net_profit ?? 0),
  );

  const buy = best?.breakdown_json ? JSON.parse(String(best.breakdown_json)).buy : null;
  const sell = best?.breakdown_json ? JSON.parse(String(best.breakdown_json)).sell : null;

  return (
    <>
      {best && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>ベストRoute（どこで買って、どこで売るか）</h3>
          <p style={{ fontSize: 18, margin: '0 0 12px' }}>
            <strong>{nameOf(String(best.buy_venue_code))}</strong> で買って{' '}
            <strong>{nameOf(String(best.sell_venue_code))}</strong> で売る
            <span className={DECISION_CLASS[String(best.decision)] ?? 'badge skip'} style={{ marginLeft: 10 }}>
              {DECISION_JA[String(best.decision)] ?? '—'}
            </span>
          </p>
          <dl className="kv">
            <dt>仕入総額（全部込み）</dt>
            <dd>{yen(Number(best.acquisition_total_cost))}</dd>
            <dt>予想販売価格</dt>
            <dd>{yen(Number(best.expected_sell_price))}</dd>
            <dt>販売後の入金予想</dt>
            <dd>{yen(Number(best.expected_net_receipt))}</dd>
            <dt>予想純利益</dt>
            <dd className={Number(best.expected_net_profit) >= 0 ? 'pos' : 'neg'}>
              <strong>{yen(Number(best.expected_net_profit))}</strong>
            </dd>
            <dt>ROI</dt>
            <dd>{pct(best.expected_roi === null ? null : Number(best.expected_roi))}</dd>
            <dt>30日で売れる確率</dt>
            <dd>{pct(Number(best.sell_probability_30d))}（7日 {pct(Number(best.sell_probability_7d))} ／ 90日 {pct(Number(best.sell_probability_90d))}）</dd>
            <dt>売れるまでの想定日数</dt>
            <dd>{num(Number(best.expected_days_to_sell))}日</dd>
            <dt>ROUTE SCORE</dt>
            <dd>{num(Number(best.route_score))}点</dd>
            <dt>流動性</dt>
            <dd>
              {num(Number(best.liquidity_score))}点
              <span className="muted small">（{LIQUIDITY_BASIS_JA[String(best.liquidity_basis)] ?? String(best.liquidity_basis)}）</span>
            </dd>
            <dt>データ信頼度</dt>
            <dd>
              {num(Number(best.data_confidence))}点
              <span className="muted small">（販売価格の根拠：{PRICE_BASIS_JA[String(best.price_basis)] ?? String(best.price_basis)}）</span>
            </dd>
            <dt>リスク</dt>
            <dd>{num(Number(best.risk_score))}点（高いほど危ない）</dd>
          </dl>
          {(Number(best.fees_estimated) === 1 || String(best.price_basis) === 'REFERENCE_FALLBACK') && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              {Number(best.fees_estimated) === 1 && '手数料は概算です。'}
              {String(best.price_basis) === 'REFERENCE_FALLBACK'
                && 'この販売先の相場が未登録のため、参考相場を当てはめた仮定値で計算しています。'}
            </p>
          )}
        </div>
      )}

      {blockedBetter && (
        <div className="note danger">
          本当は <strong>{nameOf(String(blockedBetter.buy_venue_code))} で買って{nameOf(String(blockedBetter.sell_venue_code))} で売る</strong>
          方が {yen(Number(blockedBetter.expected_net_profit))}（ROI {pct(Number(blockedBetter.expected_roi))}）で有利ですが、
          {BLOCKED_REASON_JA[String(blockedBetter.blocked_reason)] ?? String(blockedBetter.blocked_reason)}のため実行できません。
        </div>
      )}

      {best && buy && sell && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>買う側と売る側の費用（分けて計算しています）</h3>
          <div className="grid2">
            <div>
              <h4 className="muted small">買うときにかかるお金</h4>
              <table>
                <tbody>
                  {BUY_LABELS.filter(([k]) => Number(buy[k] ?? 0) !== 0).map(([k, label]) => (
                    <tr key={k}>
                      <td>{label}</td>
                      <td className="num">{yen(Number(buy[k]))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>仕入総額</strong></td>
                    <td className="num"><strong>{yen(Number(buy.total))}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="muted small">売るときに引かれるお金</h4>
              <table>
                <tbody>
                  <tr>
                    <td>予想販売価格</td>
                    <td className="num">{yen(Number(sell.sellPrice))}</td>
                  </tr>
                  {SELL_LABELS.filter(([k]) => Number(sell[k] ?? 0) !== 0).map(([k, label]) => (
                    <tr key={k}>
                      <td>{label}</td>
                      <td className="num neg">−{yen(Number(sell[k]))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>入金予想</strong></td>
                    <td className="num"><strong>{yen(Number(sell.netReceipt))}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            買う側と売る側は同じ市場でも費用が違うため、別々に持っています。一律◯%のような扱いはしていません。
          </p>
        </div>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>すべての組み合わせ（{num(routes.length)}通り）</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>買う</th>
                <th>売る</th>
                <th className="num">仕入総額</th>
                <th className="num">入金予想</th>
                <th className="num">純利益</th>
                <th className="num">ROI</th>
                <th className="num">30日確率</th>
                <th className="num">日数</th>
                <th className="num">点数</th>
                <th>判定</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const profit = Number(r.expected_net_profit);
                const isBest = best && r.id === best.id;
                return (
                  <tr key={String(r.id)} style={isBest ? { background: '#16241c' } : undefined}>
                    <td>{nameOf(String(r.buy_venue_code))}</td>
                    <td>{nameOf(String(r.sell_venue_code))}</td>
                    <td className="num">{yen(Number(r.acquisition_total_cost))}</td>
                    <td className="num">{yen(Number(r.expected_net_receipt))}</td>
                    <td className={`num ${profit >= 0 ? 'pos' : 'neg'}`}>{yen(profit)}</td>
                    <td className="num">{pct(r.expected_roi === null ? null : Number(r.expected_roi))}</td>
                    <td className="num">{pct(Number(r.sell_probability_30d))}</td>
                    <td className="num">{num(Number(r.expected_days_to_sell))}</td>
                    <td className="num">{num(Number(r.route_score))}</td>
                    <td>
                      <span className={DECISION_CLASS[String(r.decision)] ?? 'badge skip'}>
                        {DECISION_JA[String(r.decision)] ?? '—'}
                      </span>
                    </td>
                    <td className="small">
                      {r.blocked_reason && (
                        <span className="badge skip">
                          {BLOCKED_REASON_JA[String(r.blocked_reason)] ?? String(r.blocked_reason)}
                        </span>
                      )}
                      {r.skip_reason && (
                        <span className="muted">{ROUTE_SKIP_JA[String(r.skip_reason)] ?? String(r.skip_reason)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
