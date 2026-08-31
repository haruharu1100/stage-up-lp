import { priceBoard, unpricedSellableCount } from '../../lib/catalog/price-board';
import { priceCaveatJa } from '../../lib/catalog/pricing';
import { Money, Page, Panel, Tag, Unknown } from '../ui';
import { savePriceAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * 商品・価格設定。
 *
 * ★この画面が「値段を決める唯一の場所」。
 *   ここが空のあいだは、予想売上も予想利益も「計算できない」と出す。
 *   AIが相場から値段を埋めることはしない。埋めた瞬間、それは事実として画面に出るから。
 */

const STATUS_JA: Record<string, { kind: 'ok' | 'warn' | 'stop'; label: string }> = {
  SELLABLE: { kind: 'ok', label: '今すぐ売れる' },
  DEV: { kind: 'warn', label: '開発中（まだ売らない）' },
  BLOCKED: { kind: 'stop', label: '売らない' },
};

const TIER_JA: Record<string, string> = {
  LIGHT: '入口（小さく試す）',
  STANDARD: '標準（業務1つ）',
  CUSTOM: '専用（複数業務・基幹連携）',
};

const MODEL_JA: Record<string, string> = { monthly: '月額', onetime: '一括', unknown: '課金の形も未定' };

export default async function Pricing({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  const rows = await priceBoard();
  const todo = unpricedSellableCount(rows);

  return (
    <Page
      title="商品・価格設定"
      lead="商品ごとの値段・原価・想定作業時間を決める場所です。ここが空のあいだ、その商品の予想売上と予想利益は「計算できない」と表示します。"
    >
      {sp?.err ? (
        <div className="banner stop">
          <b>保存しませんでした。</b>
          {sp.err}
        </div>
      ) : null}

      <div className="banner">
        <b>値段を決めないと先へ進めない商品：{todo}件</b>
        （「今すぐ売れる」のに値段が入っていない商品の数）。値段を保存すると、営業候補の順位をその場で計算し直します。
      </div>

      <div className="banner safe">
        <b>AIが相場から値段を埋めることはしません。</b>
        入っている金額は、事業Vault（Obsidian）に書いてあるものか、この画面で入力したものだけです。
        「仮」と出ている金額は、案として書いてあるだけで、まだ決定されていないものです。
      </div>

      {rows.map((r) => {
        const st = STATUS_JA[r.status] ?? { kind: 'stop' as const, label: r.status };
        const caveat = priceCaveatJa(r.price);
        return (
          <Panel key={r.code} title={`${r.name}`} note={r.code}>
            <table>
              <tbody>
                <tr>
                  <th style={{ width: 190 }}>成熟度</th>
                  <td>
                    <Tag kind={st.kind}>{st.label}</Tag>
                    {r.statusReason ? <span className="small" style={{ marginLeft: 8 }}>{r.statusReason}</span> : null}
                  </td>
                </tr>
                {r.tier ? (
                  <tr>
                    <th>段階</th>
                    <td>{TIER_JA[r.tier] ?? r.tier}</td>
                  </tr>
                ) : null}
                <tr>
                  <th>課金の形</th>
                  <td>{MODEL_JA[r.priceModel] ?? r.priceModel}</td>
                </tr>
                <tr>
                  <th>価格状態</th>
                  <td>
                    {r.price.priceStatus === 'CONFIRMED' ? (
                      <Tag kind="ok">確定</Tag>
                    ) : r.price.priceStatus === 'PROVISIONAL' ? (
                      <Tag kind="warn">仮</Tag>
                    ) : (
                      <Tag kind="mute">未定</Tag>
                    )}
                    <span className="small" style={{ marginLeft: 8 }}>{r.priceStatusLabel}</span>
                  </td>
                </tr>
                <tr>
                  <th>金額の出どころ</th>
                  <td className="small">{r.price.priceEvidence ?? '—（どこにも金額が書かれていません）'}</td>
                </tr>
                <tr>
                  <th>標準価格（1件あたり）</th>
                  <td>
                    {r.standardValue === null ? (
                      <Unknown why={r.price.unsetReasonJa} />
                    ) : (
                      <>
                        <Money v={r.standardValue} />
                        {r.priceModel === 'monthly' ? <span className="small">（月額×12ヶ月）</span> : null}
                        {caveat ? <span className="small" style={{ marginLeft: 8 }}>{caveat}</span> : null}
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>想定粗利</th>
                  <td>
                    {r.grossProfit === null ? <Unknown why={r.grossProfitUnsetReason} /> : <Money v={r.grossProfit} />}
                  </td>
                </tr>
                <tr>
                  <th>想定時給</th>
                  <td>
                    {r.hourlyProfit === null ? (
                      <Unknown why="想定作業時間が未設定なので、時給は出せません。" />
                    ) : (
                      <Money v={r.hourlyProfit} />
                    )}
                  </td>
                </tr>
                <tr>
                  <th>最終更新日</th>
                  <td className="small">{r.updatedAt ? r.updatedAt.slice(0, 16).replace('T', ' ') : '—（まだ何も入力していません）'}</td>
                </tr>
              </tbody>
            </table>

            <form action={savePriceAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="code" value={r.code} />
              <input type="hidden" name="key_min" value={r.keys.min} />
              <input type="hidden" name="key_max" value={r.keys.max} />
              <input type="hidden" name="key_margin" value={r.keys.margin} />
              <input type="hidden" name="key_costDirect" value={r.keys.costDirect} />
              <input type="hidden" name="key_estHours" value={r.keys.estHours} />
              <table>
                <thead>
                  <tr>
                    <th>最低価格（円）</th>
                    <th>上限価格（円）</th>
                    <th>手元に残る割合（0〜1）</th>
                    <th>原価（円）</th>
                    <th>想定作業時間（時間）</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><input name="val_min" defaultValue={r.input.min} placeholder="空欄＝未設定" /></td>
                    <td><input name="val_max" defaultValue={r.input.max} placeholder="空欄＝未設定" /></td>
                    <td><input name="val_margin" defaultValue={r.input.margin} placeholder="例 0.7" /></td>
                    <td><input name="val_costDirect" defaultValue={r.input.costDirect} placeholder="空欄＝未設定" /></td>
                    <td><input name="val_estHours" defaultValue={r.input.estHours} placeholder="空欄＝未設定" /></td>
                    <td><button type="submit">保存して再計算</button></td>
                  </tr>
                </tbody>
              </table>
              <p className="small">
                数字だけを入れてください（「20万」「約10」は読めません）。空欄にすると未設定に戻ります。0とは別の扱いです。
                原価を入れると「金額−原価」で粗利を出します。原価も割合も空欄なら、粗利は0円ではなく「計算できない」と表示します。
              </p>
            </form>
          </Panel>
        );
      })}
    </Page>
  );
}
