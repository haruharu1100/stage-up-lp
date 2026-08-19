import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { AUTOMATION_JA, TERMS_STATUS_JA, VENUE_KIND_JA, type Venue } from '@/lib/venues';
import { num, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CONNECTOR_JA: Record<string, string> = {
  api: '公式API',
  csv: 'CSV連携',
  webhook: 'Webhook',
  manual: '手作業のみ',
  unavailable: '手段なし',
};

function TermsBadge({ status }: { status: string }) {
  const cls = status === 'VERIFIED' ? 'badge strong' : status === 'BLOCKED' ? 'badge skip' : 'badge est';
  return <span className={cls}>{TERMS_STATUS_JA[status] ?? status}</span>;
}

export default async function VenuesPage() {
  await ensureReady();
  const venues = (await all('SELECT * FROM venues ORDER BY kind, code')) as unknown as Venue[];
  const fees = await all('SELECT * FROM venue_fee_profiles ORDER BY venue_code, side');

  const buyable = venues.filter((v) => v.can_buy === 1).length;
  const sellable = venues.filter((v) => v.can_sell === 1 && v.terms_status !== 'BLOCKED').length;
  const blocked = venues.filter((v) => v.terms_status === 'BLOCKED').length;
  const estimated = fees.filter((f) => Number(f.is_estimated) === 1).length;

  return (
    <main>
      <h1>市場（VENUE）一覧</h1>
      <p className="lead">
        市場を「仕入先」「販売先」に固定していません。同じ市場が、安ければ仕入先に、高く売れるなら販売先になります。
        ここでは市場ごとに「買えるか／売れるか／規約を確認できているか／自動化してよいか」を管理します。
      </p>

      <div className="cards">
        <div className="card">
          <div className="k">登録市場数</div>
          <div className="v">{num(venues.length)}</div>
        </div>
        <div className="card">
          <div className="k">仕入先になれる</div>
          <div className="v">{num(buyable)}</div>
        </div>
        <div className="card">
          <div className="k">販売先になれる</div>
          <div className="v">{num(sellable)}</div>
          <div className="sub">規約で止まっている市場を除く</div>
        </div>
        <div className="card">
          <div className="k">規約で使えない</div>
          <div className="v">{num(blocked)}</div>
          <div className="sub">計算はするが実行しない</div>
        </div>
      </div>

      <div className="note" style={{ marginTop: 14 }}>
        自動購入・自動出品ができる市場は <strong>1つもありません</strong>。
        公式APIが使えることを確認できていない市場は、システム側が実行を拒否します。
        {estimated > 0 && <> 手数料が概算のままの設定が {num(estimated)} 件あります（公式の料金ページで実額の確認が必要です）。</>}
      </div>

      <h2>市場ごとの能力</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>市場</th>
              <th>種類</th>
              <th>買う</th>
              <th>売る</th>
              <th>仕入の手段</th>
              <th>販売の手段</th>
              <th>鑑定</th>
              <th>規約確認</th>
              <th>自動化</th>
              <th>通貨</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.code}>
                <td>
                  <strong>{v.name}</strong>
                  <div className="small muted">{v.code}</div>
                </td>
                <td className="small">{VENUE_KIND_JA[v.kind] ?? v.kind}</td>
                <td>{v.can_buy === 1 ? '○' : <span className="muted">—</span>}</td>
                <td>
                  {v.can_sell === 1
                    ? v.terms_status === 'BLOCKED'
                      ? <span className="badge skip">停止中</span>
                      : '○'
                    : <span className="muted">—</span>}
                </td>
                <td className="small">{CONNECTOR_JA[v.buy_connector] ?? v.buy_connector}</td>
                <td className="small">{CONNECTOR_JA[v.sell_connector] ?? v.sell_connector}</td>
                <td className="small">{v.authentication_model === 'VENUE_SIDE' ? '市場が鑑定' : v.authentication_model === 'SELF' ? '自社で鑑定' : 'なし'}</td>
                <td><TermsBadge status={v.terms_status} /></td>
                <td className="small">{AUTOMATION_JA[v.automation_permission] ?? v.automation_permission}</td>
                <td className="small">{v.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>市場ごとの注意点</h2>
      <div className="panel">
        <dl className="kv">
          {venues.filter((v) => v.note).map((v) => (
            <div key={v.code} style={{ display: 'contents' }}>
              <dt>{v.name}</dt>
              <dd className="small">{v.note}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2>手数料（買う側と売る側を分けて持つ）</h2>
      <p className="lead small">
        同じ市場でも、買うときと売るときで費用は違います。一律10%のような扱いはしていません。
        「概算」と付いているものは公式の料金を確認できていないため、その市場を使う自動購入は許可されません。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>市場</th>
              <th>区分</th>
              <th className="num">手数料率</th>
              <th className="num">決済</th>
              <th className="num">為替</th>
              <th className="num">関税</th>
              <th className="num">広告</th>
              <th className="num">返品見込</th>
              <th className="num">送料</th>
              <th className="num">鑑定料</th>
              <th className="num">梱包</th>
              <th className="num">保管</th>
              <th>根拠</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((f) => (
              <tr key={String(f.id)}>
                <td>{String(f.venue_code)}</td>
                <td>{f.side === 'BUY' ? '買う' : '売る'}</td>
                <td className="num">{pct(Number(f.fee_rate))}</td>
                <td className="num">{pct(Number(f.payment_fee_rate))}</td>
                <td className="num">{pct(Number(f.currency_fee_rate))}</td>
                <td className="num">{pct(Number(f.import_duty_rate))}</td>
                <td className="num">{pct(Number(f.advertising_fee_rate))}</td>
                <td className="num">
                  {pct(Number(f.return_loss_rate))}
                  {Number(f.return_loss_fixed) > 0 && <span className="muted"> +{num(Number(f.return_loss_fixed))}円</span>}
                </td>
                <td className="num">{num(Number(f.shipping_cost))}</td>
                <td className="num">{num(Number(f.authentication_fee))}</td>
                <td className="num">{num(Number(f.packing_cost))}</td>
                <td className="num">{num(Number(f.warehouse_cost))}</td>
                <td className="small">
                  {Number(f.is_estimated) === 1 && <span className="badge est">概算</span>}{' '}
                  <span className="muted">{String(f.source_note ?? '')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
