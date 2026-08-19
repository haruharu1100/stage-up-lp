import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct } from '@/lib/queries';
import { SKIP_REASONS } from '@/lib/score';
import { PRICING_MODE_LABELS, type PricingMode } from '@/lib/pricing';
import { CONDITION_JA, DECISION_CLASS, DECISION_JA, num, pct, yen } from '@/lib/format';
import RoutePanels from './RoutePanels';

export const dynamic = 'force-dynamic';

const COST_LABELS: Record<string, string> = {
  purchase_price: '仕入価格',
  shipping_cost: '送料',
  authentication_fee: '鑑定料',
  packing_cost: '梱包資材',
  expected_return_cost: '返品・キャンセルの見込み費用',
  other_cost: 'その他',
  marketplace_fee: '販売手数料',
  payment_fee: '決済手数料',
};

const SCORE_LABELS: Record<string, string> = {
  profit: '予想純利益',
  roi: 'ROI',
  market: '相場との余裕',
  reliability: 'データ信頼度',
  stock: '在庫・状態リスク',
};

const SCORE_MAX: Record<string, number> = { profit: 30, roi: 30, market: 20, reliability: 10, stock: 10 };

export default async function ProductDetail({ params }: { params: { id: string } }) {
  const data = await getProduct(Number(params.id));
  if (!data) notFound();
  const { product: p, analysis: a, plan, shadowTrade, supplier, fee, siblings } = data;

  const decision = String(p.decision ?? '');
  const reasons: string[] = a?.reasons_json ? JSON.parse(String(a.reasons_json)) : [];
  const score = a?.score_json ? JSON.parse(String(a.score_json)) : null;
  const costs = a?.cost_breakdown_json ? JSON.parse(String(a.cost_breakdown_json)) : null;

  return (
    <main>
      <p className="small" style={{ marginTop: 20 }}>
        <Link href="/products">← 商品一覧へ戻る</Link>
      </p>
      <h1 style={{ marginTop: 8 }}>{String(p.name || '(名称なし)')}</h1>
      <p className="lead">
        <span className={DECISION_CLASS[decision] ?? 'badge skip'}>{DECISION_JA[decision] ?? '—'}</span>{' '}
        {p.buy_score !== null && <strong style={{ marginLeft: 8 }}>BUY SCORE {num(Number(p.buy_score))}点</strong>}
        {p.skip_reason && (
          <span className="muted" style={{ marginLeft: 12 }}>
            除外理由：{SKIP_REASONS[String(p.skip_reason) as keyof typeof SKIP_REASONS] ?? String(p.skip_reason)}
          </span>
        )}
      </p>

      {Number(p.fees_estimated) === 1 && (
        <div className="note">
          この計算に使った手数料は<strong>概算値（ESTIMATED）</strong>です。実額が確定すると利益額は変わります。
        </div>
      )}

      <RoutePanels supplierProductId={Number(params.id)} />

      <div className="split">
        <div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>なぜこの判定なのか</h3>
            <ul className="reasons">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
              {reasons.length === 0 && <li className="muted">まだ分析されていません。</li>}
            </ul>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>お金の内訳</h3>
            <dl className="kv">
              <dt>相場で売れた場合の売上</dt>
              <dd>{yen(a?.expected_revenue === null || a?.expected_revenue === undefined ? null : Number(a.expected_revenue))}</dd>
            </dl>
            <div className="scroll" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>費用</th>
                    <th className="num">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {costs &&
                    Object.entries(costs).map(([k, v]) => (
                      <tr key={k}>
                        <td>{COST_LABELS[k] ?? k}</td>
                        <td className="num">{yen(Number(v))}</td>
                      </tr>
                    ))}
                  {costs && (
                    <tr>
                      <td>
                        <strong>費用合計</strong>
                      </td>
                      <td className="num">
                        <strong>{yen(a?.total_cost === null || a?.total_cost === undefined ? null : Number(a.total_cost))}</strong>
                      </td>
                    </tr>
                  )}
                  {!costs && (
                    <tr>
                      <td colSpan={2} className="muted">相場が無いため計算できません</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>予想純利益</dt>
              <dd className={Number(p.expected_net_profit) > 0 ? 'pos' : 'neg'}>
                <strong>{yen(p.expected_net_profit === null ? null : Number(p.expected_net_profit))}</strong>
              </dd>
              <dt>予想ROI</dt>
              <dd>{pct(p.expected_roi === null ? null : Number(p.expected_roi))}</dd>
              <dt>損益分岐となる販売価格</dt>
              <dd>{yen(a?.break_even_price === null || a?.break_even_price === undefined ? null : Number(a.break_even_price))}</dd>
              <dt>目標利益を満たす必要販売価格</dt>
              <dd>{yen(p.required_sell_price === null ? null : Number(p.required_sell_price))}</dd>
              <dt>必要販売価格 ÷ 市場価格</dt>
              <dd>
                {p.market_premium_ratio === null ? '—' : Number(p.market_premium_ratio).toFixed(3)}
                {p.market_premium_ratio !== null && Number(p.market_premium_ratio) > 1 && (
                  <span className="neg small"> ← 相場では成立しない</span>
                )}
              </dd>
            </dl>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>あといくらで買えるようになるか</h3>
            <div className="split" style={{ gap: 20 }}>
              <dl className="kv">
                <dt>現在の仕入価格</dt>
                <dd>{yen(p.purchase_price === null ? null : Number(p.purchase_price))}</dd>
                <dt>BUY可能な仕入価格</dt>
                <dd>{yen(p.buyable_purchase_price === null ? null : Number(p.buyable_purchase_price))}</dd>
                <dt>あといくら安くなれば</dt>
                <dd className={Number(p.discount_needed) > 0 ? 'neg' : 'pos'}>
                  <strong>
                    {p.discount_needed === null
                      ? '—'
                      : Number(p.discount_needed) === 0
                        ? '現在の価格で条件を満たす'
                        : `あと ${yen(Number(p.discount_needed))} 安くなればBUY`}
                  </strong>
                </dd>
              </dl>
              <dl className="kv">
                <dt>現在の市場価格</dt>
                <dd>{yen(p.market_price === null ? null : Number(p.market_price))}</dd>
                <dt>必要な市場価格</dt>
                <dd>{yen(p.required_market_price === null ? null : Number(p.required_market_price))}</dd>
                <dt>あといくら高く売れれば</dt>
                <dd className={Number(p.uplift_needed) > 0 ? 'neg' : 'pos'}>
                  <strong>
                    {p.uplift_needed === null
                      ? '—'
                      : Number(p.uplift_needed) === 0
                        ? '現在の相場で条件を満たす'
                        : `相場があと ${yen(Number(p.uplift_needed))} 上がればBUY`}
                  </strong>
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>スコアの内訳</h3>
            {score ? (
              <>
                {(['profit', 'roi', 'market', 'reliability', 'stock'] as const).map((k) => (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{SCORE_LABELS[k]}</span>
                      <span className="muted">
                        {score[k]} / {SCORE_MAX[k]}
                      </span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${(score[k] / SCORE_MAX[k]) * 100}%` }} />
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 12 }}>
                  <strong>合計 {score.total} 点</strong>
                </div>
              </>
            ) : (
              <p className="muted">未分析</p>
            )}
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>商品情報</h3>
            <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>仕入先</dt>
              <dd>
                {String(p.supplier_code)}
                {supplier && Number(supplier.terms_checked) === 0 && (
                  <span className="badge est" style={{ marginLeft: 6 }}>規約未確認</span>
                )}
              </dd>
              <dt>ブランド</dt>
              <dd>{String(p.brand || '—')}</dd>
              <dt>カテゴリ</dt>
              <dd>{String(p.category_key || '—')}</dd>
              <dt>型番</dt>
              <dd>{String(p.model_number || '—')}</dd>
              <dt>JAN</dt>
              <dd>{String(p.jan || '—')}</dd>
              <dt>サイズ / 色</dt>
              <dd>
                {String(p.size || '—')} / {String(p.color || '—')}
              </dd>
              <dt>状態</dt>
              <dd>
                {p.condition_rank ? `${String(p.condition_rank)}（${CONDITION_JA[String(p.condition_rank)]}）` : '—'}
                {p.raw_condition && <span className="muted small"> ／ 元表記: {String(p.raw_condition)}</span>}
              </dd>
              <dt>在庫</dt>
              <dd>{p.stock === null ? '—' : `${num(Number(p.stock))} 点`}</dd>
              <dt>状態</dt>
              <dd>{String(p.pipeline_state)}</dd>
              <dt>商品ページ</dt>
              <dd>
                {p.product_url ? (
                  <a href={String(p.product_url)} target="_blank" rel="noreferrer noopener">
                    開く
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>価格の考え方</h3>
            {plan ? (
              <>
                <p style={{ marginTop: 0 }}>
                  <strong>{PRICING_MODE_LABELS[String(plan.pricing_mode) as PricingMode]}</strong>
                </p>
                <dl className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
                  <dt>出品価格の案</dt>
                  <dd>{yen(plan.planned_listing_price === null ? null : Number(plan.planned_listing_price))}</dd>
                  <dt>相場に対する倍率</dt>
                  <dd>{plan.planned_premium_ratio === null ? '—' : Number(plan.planned_premium_ratio).toFixed(3)}</dd>
                  {plan.next_price_hint !== null && (
                    <>
                      <dt>売れた場合の次回価格</dt>
                      <dd>{yen(Number(plan.next_price_hint))}</dd>
                    </>
                  )}
                  <dt>学習単位</dt>
                  <dd className="small">
                    {String(plan.segment_type)} / {String(plan.segment_key)}
                  </dd>
                </dl>
                <p className="small muted" style={{ marginBottom: 0 }}>{String(plan.note)}</p>
                <div className="note" style={{ marginBottom: 0 }}>
                  Phase 1 では価格は<strong>提案するだけ</strong>で、自動で値上げも出品もしません。
                </div>
              </>
            ) : (
              <p className="muted">未算出</p>
            )}
          </div>

          {shadowTrade && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>SHADOW（仮想取引）</h3>
              <dl className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
                <dt>判断日時</dt>
                <dd className="small">{String(shadowTrade.decided_at).slice(0, 16).replace('T', ' ')}</dd>
                <dt>判定</dt>
                <dd>{DECISION_JA[String(shadowTrade.decision)]}</dd>
                <dt>状態</dt>
                <dd>{String(shadowTrade.status)}</dd>
                <dt>ルール版</dt>
                <dd className="small">{String(shadowTrade.rule_version)}</dd>
              </dl>
              <p className="small muted" style={{ marginBottom: 0 }}>
                実際には買っていません。後で本当に利益が出たかを検証するための記録です。
              </p>
            </div>
          )}

          {fee && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>使った手数料設定</h3>
              <dl className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
                <dt>販路</dt>
                <dd>{String(fee.channel_code)}</dd>
                <dt>販売手数料</dt>
                <dd>{pct(Number(fee.marketplace_fee_rate))}</dd>
                <dt>決済手数料</dt>
                <dd>{pct(Number(fee.payment_fee_rate))}</dd>
                <dt>送料</dt>
                <dd>{yen(Number(fee.shipping_cost))}</dd>
                <dt>確定/概算</dt>
                <dd>{Number(fee.is_estimated) === 1 ? <span className="badge est">概算</span> : '確定'}</dd>
              </dl>
              {fee.source_note && <p className="small muted" style={{ marginBottom: 0 }}>{String(fee.source_note)}</p>}
            </div>
          )}

          {siblings.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>同じ商品の他の出品</h3>
              <table>
                <tbody>
                  {siblings.map((sib) => (
                    <tr key={String(sib.id)}>
                      <td className="small">{String(sib.supplier_code)}</td>
                      <td className="num">{yen(Number(sib.purchase_price))}</td>
                      <td>
                        <span className={DECISION_CLASS[String(sib.decision)] ?? 'badge skip'}>
                          {DECISION_JA[String(sib.decision)] ?? '—'}
                        </span>
                      </td>
                      <td>
                        <Link href={`/products/${sib.id}`} className="small">
                          見る
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
