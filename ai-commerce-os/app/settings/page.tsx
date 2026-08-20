import { all } from '@/lib/db/client';
import { config } from '@/lib/env';
import { listSuppliers } from '@/lib/connectors/registry';
import { ensureReady } from '@/lib/queries';
import { getCostSettings, listSettings, ruleVersion } from '@/lib/settings';
import { paymentMethodCoverage } from '@/lib/payment';
import { FeeForm, ThresholdForm } from './SettingsForms';

export const dynamic = 'force-dynamic';

const CAP_JA: Record<string, string> = {
  api: '自動で可能（API）',
  csv: 'CSVのみ',
  webhook: '通知受信のみ',
  manual: '人間の手作業のみ',
  unavailable: '不可',
};

export default async function SettingsPage() {
  await ensureReady();

  const settings = (await listSettings()).map((s) => ({
    key: String(s.key),
    value: String(s.value),
    value_type: String(s.value_type),
    label: String(s.label),
    group_key: String(s.group_key),
    hint: s.hint === null ? null : String(s.hint),
  }));

  const feeRows = await all(`
    SELECT f.*, c.name AS channel_name
      FROM fee_rules f LEFT JOIN channels c ON c.code = f.channel_code
     ORDER BY f.channel_code
  `);
  const fees = feeRows.map((f) => ({
    id: Number(f.id),
    channel_code: String(f.channel_code),
    channel_name: String(f.channel_name ?? f.channel_code),
    category_key: String(f.category_key),
    marketplace_fee_rate: Number(f.marketplace_fee_rate),
    payment_fee_rate: Number(f.payment_fee_rate),
    shipping_cost: Number(f.shipping_cost),
    authentication_fee: Number(f.authentication_fee),
    packing_cost: Number(f.packing_cost),
    expected_return_cost: Number(f.expected_return_cost),
    other_cost: Number(f.other_cost),
    is_estimated: Number(f.is_estimated),
    source_note: f.source_note === null ? null : String(f.source_note),
  }));

  const suppliers = await listSuppliers();
  const channels = await all('SELECT * FROM channels ORDER BY code');
  const rv = await ruleVersion();

  // 支払方法ごとの手数料（Phase 3.7）。分かっていない支払方法を隠さない。
  const cost = await getCostSettings();
  const pay = await paymentMethodCoverage('MERCARI', cost.mercariBuyPaymentMethod);
  const unknownFeeMethods = pay.rows
    .filter((r) => r.feeFixed === null && r.feeRate === null)
    .map((r) => r.methodCode);

  return (
    <main>
      <h1>設定</h1>
      <p className="lead">
        ここを変えると、判定のしかたが変わります。保存すると全商品を自動で計算しなおします。
      </p>

      <div className="note">
        変更できるのは人間だけです。AIは自分でこの数字を変えられません。
        現在の判定ルール版：<code>{rv}</code>
      </div>

      <h2>安全設定（変更にはコードの修正が必要）</h2>
      <div className="panel">
        <dl className="kv">
          <dt>動作モード</dt>
          <dd>{config.autoMode}</dd>
          <dt>自動リサーチ</dt>
          <dd>{config.autoResearch ? 'ON' : 'OFF'}</dd>
          <dt>自動購入</dt>
          <dd className="neg">OFF（Phase 1 では機能そのものが存在しません）</dd>
          <dt>自動出品</dt>
          <dd className="neg">OFF（同上）</dd>
          <dt>自動値付け変更</dt>
          <dd className="neg">OFF（同上）</dd>
          <dt>自動注文処理・自動再仕入</dt>
          <dd className="neg">OFF（同上）</dd>
          <dt>AI（LLM）呼び出し</dt>
          <dd>{config.aiEnabled ? 'ON' : 'OFF（候補に印を付けるだけ）'}</dd>
        </dl>
      </div>

      <h2>手数料と費用</h2>
      <p className="small muted">
        利益はここの数字で決まります。「概算」のままだと、実際の利益は変わります。公式の料金ページで実額を確認して入れてください。
      </p>
      {fees.map((f) => (
        <FeeForm key={f.id} fee={f} />
      ))}

      <h2>メルカリで仕入れるときの支払方法</h2>
      <p className="small muted">
        同じ商品を同じ値段で買っても、支払方法が違えば支払総額が変わります。
        いま設定されているのは <strong>{pay.rows.find((r) => r.methodCode === pay.defaultMethod)?.methodJa ?? pay.defaultMethod}</strong> です。
        安い方法をAIが勝手に選ぶことはしません。実際に使う方法を選んでください。
      </p>
      {!pay.defaultKnown && (
        <div className="note neg">
          いま選ばれている支払方法の手数料が分かっていません。
          仕入総額が確定しないため、この状態では最上位の判定（STRONG BUY）まで上げません。
        </div>
      )}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>支払方法</th>
              <th>手数料</th>
              <th>確からしさ</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {pay.rows.map((r) => (
              <tr key={r.methodCode}>
                <td>
                  {r.methodJa}
                  {r.methodCode === pay.defaultMethod && <span className="badge buy" style={{ marginLeft: 8 }}>使用中</span>}
                </td>
                <td>
                  {r.feeFixed === null && r.feeRate === null
                    ? <span className="neg">不明</span>
                    : `${(r.feeRate ?? 0) > 0 ? `${((r.feeRate ?? 0) * 100).toFixed(1)}% + ` : ''}${(r.feeFixed ?? 0).toLocaleString()}円`}
                </td>
                <td className="small">
                  {r.feeStatus === 'VERIFIED' ? '公式で確認済み' : r.feeStatus === 'ESTIMATED' ? '概算（未確認）' : '未確認'}
                </td>
                <td className="small muted" style={{ whiteSpace: 'normal', maxWidth: 380 }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {pay.total} 件のうち、手数料が分かっているのは {pay.known} 件、分かっていないのは {pay.unknown} 件です。
        分からないものは0円ではなく「不明」として扱います。
      </p>

      <h2>判定のしきい値</h2>
      <ThresholdForm settings={settings} unknownFeeMethods={unknownFeeMethods} />

      <h2>仕入先</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>仕入先</th>
              <th>商品一覧の取得</th>
              <th>価格の取得</th>
              <th>購入</th>
              <th>取引条件</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={String(s.code)}>
                <td>
                  {String(s.name)}
                  <div className="small muted">{String(s.code)}</div>
                </td>
                <td className="small">{CAP_JA[String(s.cap_read_catalog)] ?? String(s.cap_read_catalog)}</td>
                <td className="small">{CAP_JA[String(s.cap_read_price)] ?? String(s.cap_read_price)}</td>
                <td className="small">{CAP_JA[String(s.cap_purchase)] ?? String(s.cap_purchase)}</td>
                <td>
                  {Number(s.terms_checked) === 1 ? (
                    <span className="badge buy">確認済み</span>
                  ) : (
                    <span className="badge watch">未確認</span>
                  )}
                </td>
                <td className="small muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{String(s.note ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        「購入」が「人間の手作業のみ」である限り、システムは絶対に自動で購入しません。
        自動購入ができるのは、公式APIが使えて取引条件も確認できた仕入先だけです。
      </p>

      <h2>販路</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>販路</th>
              <th>出品</th>
              <th>価格変更</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={String(c.code)}>
                <td>
                  {String(c.name)}
                  <div className="small muted">{String(c.code)}</div>
                </td>
                <td className="small">{CAP_JA[String(c.cap_list)] ?? String(c.cap_list)}</td>
                <td className="small">{CAP_JA[String(c.cap_reprice)] ?? String(c.cap_reprice)}</td>
                <td className="small muted" style={{ whiteSpace: 'normal', maxWidth: 360 }}>{String(c.note ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
