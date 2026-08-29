import { all } from '../../lib/db/client';
import { config } from '../../lib/env';
import { Kpi, Kpis, Money, Page, Panel, Tag } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Obsidian同期。
 *
 * ★正本は Obsidian（事業Vault）側。この画面はその写しの状態を見るだけ。
 *   出典のファイルが消えていたら、その商品・道具は自動で使用停止になる。
 *   根拠が消えたものを売り続けない・受け続けないため。
 *
 * ★APIキー・パスワード・個人情報は Obsidian に書き出さない。
 */

const OFFER_STATUS: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute' }> = {
  SELLABLE: { label: '売れる', kind: 'ok' },
  DEV: { label: '開発中', kind: 'warn' },
  BLOCKED: { label: '停止', kind: 'stop' },
};
const CAP_STATUS: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute' }> = {
  READY: { label: '使える', kind: 'ok' },
  DEV: { label: '開発中', kind: 'warn' },
  BLOCKED: { label: '停止', kind: 'stop' },
};

export default async function Obsidian() {
  const offers = await all('SELECT * FROM offers ORDER BY status, code');
  const caps = await all('SELECT * FROM capabilities ORDER BY status, code');
  const sellable = offers.filter((o) => String(o.status) === 'SELLABLE').length;
  const ready = caps.filter((c) => String(c.status) === 'READY').length;
  const priced = offers.filter((o) => o.price_min !== null || o.price_max !== null).length;

  return (
    <Page title="Obsidian同期" lead="「売れるもの」と「できること」の正本はObsidian側です。この画面はその写しの状態を確認するためのものです。">
      <div className="banner safe">
        <b>APIキー・パスワード・お客さまの個人情報は、Obsidianへ書き出しません。</b>
        書き出すのは、判断の根拠と結果の記録だけです。
      </div>

      <Kpis>
        <Kpi label="売れる商品" value={sellable} unit="件" hint={`登録${offers.length}件のうち`} />
        <Kpi label="価格が確認できている商品" value={priced} unit="件" hint="価格が分からないものは空のままにしています" />
        <Kpi label="使える道具" value={ready} unit="件" hint={`登録${caps.length}件のうち`} />
      </Kpis>

      <Panel title="正本の置き場所">
        <table>
          <tbody>
            <tr>
              <th>事業Vault</th>
              <td className="small">{config.obsidianVaultDir}</td>
            </tr>
            <tr>
              <th>このシステムの記録先</th>
              <td className="small">{config.obsidianVaultDir}/AI営業受注OS/</td>
            </tr>
          </tbody>
        </table>
        <p className="note">
          出典のファイルが見つからない商品・道具は、自動で「停止」に落として営業・受注の対象から外します。根拠が消えたものを売り続けないためです。
        </p>
      </Panel>

      <Panel title="売れるもの（Obsidianが正本）" note="価格が分からないものは0円ではなく空欄にしています。仮の数字で期待値を計算すると、間違った相手に営業してしまうためです。">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>分類</th>
              <th>状態</th>
              <th className="num">価格</th>
              <th>出典</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => {
              const s = OFFER_STATUS[String(o.status)] ?? { label: String(o.status), kind: 'mute' as const };
              return (
                <tr key={String(o.code)}>
                  <td>
                    {String(o.name)}
                    <div className="small">{String(o.summary)}</div>
                    {o.status_reason ? <div className="small">理由：{String(o.status_reason)}</div> : null}
                  </td>
                  <td className="small">{String(o.category)}</td>
                  <td>
                    <Tag kind={s.kind}>{s.label}</Tag>
                  </td>
                  <td className="num">
                    {o.price_min === null && o.price_max === null ? (
                      <span className="small">—（未確認）</span>
                    ) : (
                      <>
                        <Money v={o.price_min === null ? null : Number(o.price_min)} />
                        {o.price_max !== null && o.price_max !== o.price_min ? <> 〜 <Money v={Number(o.price_max)} /></> : null}
                      </>
                    )}
                  </td>
                  <td className="small">{o.evidence_path ? String(o.evidence_path) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="できること（過去に作ったAI・システム）" note="案件を受けるかどうかは、ここにある道具で足りるかどうかで判断しています。">
        <table>
          <thead>
            <tr>
              <th>道具</th>
              <th>種類</th>
              <th>状態</th>
              <th className="num">1単位の想定時間</th>
              <th className="num">自動化</th>
              <th>出典</th>
            </tr>
          </thead>
          <tbody>
            {caps.map((c) => {
              const s = CAP_STATUS[String(c.status)] ?? { label: String(c.status), kind: 'mute' as const };
              return (
                <tr key={String(c.code)}>
                  <td>
                    {String(c.name)}
                    <div className="small">{String(c.summary)}</div>
                  </td>
                  <td className="small">{String(c.kind)}</td>
                  <td>
                    <Tag kind={s.kind}>{s.label}</Tag>
                  </td>
                  <td className="num">
                    {c.unit_hours === null ? '—' : `${Number(c.unit_hours)}h / ${c.unit_label ? String(c.unit_label) : '1件'}`}
                  </td>
                  <td className="num">{c.automation_rate === null ? '—' : `${Math.round(Number(c.automation_rate) * 100)}%`}</td>
                  <td className="small">{c.evidence_path ? String(c.evidence_path) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </Page>
  );
}
