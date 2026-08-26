import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { FEE_SOURCE_JA } from '@/lib/fees';
import { AUTOMATION_JA, TERMS_STATUS_JA, VENUE_KIND_JA, type Venue } from '@/lib/venues';
import { connectorRanking, ensureConnectorResearch } from '@/lib/connectors/permissions';
import {
  CONNECTOR_STATE_JA,
  FIRST_LIVE_CONNECTOR_STATUS_JA,
  USAGE_VERDICT_JA,
  type ConnectorState,
  type UsageVerdict,
} from '@/lib/venuepermissions';
import {
  GATE_DISPLAY_STATE_JA,
  SUPPLIER_GATE_WAY_JA,
  firstLiveSupplier,
  supplierGateBoard,
  supplierEntryGateBoard,
  SUPPLIER_ENTRY_GATE_RESULT_JA,
  SUPPLIER_ENTRY_GATE_STEPS,
  SUPPLIER_ENTRY_GATE_STEP_JA,
  type GateDisplayState,
} from '@/lib/phase6/legalgate';
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

/**
 * 仕入先の門の状態は5つだけ表示する（回答待ち／人間確認待ち／条件付き／不可／通過）。
 * 「通過」以外はすべて接続禁止。条件付きも、条件を満たしきるまでは通過にしない。
 */
function GateStateBadge({ state }: { state: GateDisplayState }) {
  const cls =
    state === 'PASSED' ? 'badge strong' : state === 'CONDITIONAL' ? 'badge est' : 'badge skip';
  return <span className={cls}>{GATE_DISPLAY_STATE_JA[state]}</span>;
}

/** 日付は「いつ確認したか」だけ分かればよい。時刻まで出すと表が読みにくくなる。 */
function day(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return s === '' ? '' : s.slice(0, 10);
}

export default async function VenuesPage() {
  await ensureReady();
  // 2026-08-20 の再調査結果をDBへ反映する。何度実行しても同じ結果になる。
  await ensureConnectorResearch();
  const ranking = connectorRanking();
  const venues = (await all('SELECT * FROM venues ORDER BY kind, code')) as unknown as Venue[];
  // 概算のままの手数料を上に集める。目立たせないと「確認したつもり」で使い続けてしまう。
  const fees = await all(
    'SELECT * FROM venue_fee_profiles ORDER BY is_estimated DESC, venue_code, side',
  );
  const feeChanges = await all(
    'SELECT * FROM fee_change_log ORDER BY detected_at DESC, id DESC LIMIT 20',
  );

  const buyable = venues.filter((v) => v.can_buy === 1).length;
  const sellable = venues.filter((v) => v.can_sell === 1 && v.terms_status !== 'BLOCKED').length;
  const blocked = venues.filter((v) => v.terms_status === 'BLOCKED').length;
  const estimated = fees.filter((f) => Number(f.is_estimated) === 1).length;
  const verified = fees.length - estimated;
  const withUrl = fees.filter((f) => f.source_url).length;

  // 仕入先の門（Phase 6.5）。通信はしない。誰の返事を待っているかを見せるだけ。
  const gateBoard = supplierGateBoard();
  // 入口の門（規約より先に見る）。これも表示のみ。外部へは一切つながない。
  const entryBoard = supplierEntryGateBoard();
  const firstLive = firstLiveSupplier();

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

      <h2>入口の門（SUPPLIER ENTRY GATE）— そもそも客として認められるか</h2>
      <p className="lead">
        規約やAPIを調べる<strong>前に</strong>、この5つを先に確認します。
        「APIが使えるか」より先に「<strong>そもそも当社が買い手として認めてもらえるか</strong>」を見る、という順番です。
        ここで1つでも「不可」が出たら、<strong>その相手の調査はその場で終了</strong>します。規約やAPIの確認に時間を使いません。
      </p>
      <div className="note" style={{ marginTop: 10 }}>
        この門を作った理由：orosy で、規約13項目を読む準備を進めていたところ、
        その手前の「バイヤー審査基準」に<strong>モール（Amazon・楽天・Yahoo!等）だけで販売する事業者は利用できない</strong>と明記されており、
        当社が対象外だと分かりました（2026-08-26）。順番を間違えると、通らない相手の規約を読むために時間を使ってしまいます。
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>相手</th>
              <th>入口の門</th>
              <th>いまの状態</th>
              <th>不可だった項目（原文つき）</th>
              <th>まだ確認できていない項目</th>
              <th>規約・API調査へ進めるか</th>
            </tr>
          </thead>
          <tbody>
            {entryBoard.map((e) => (
              <tr key={e.gate.supplierCode}>
                <td><strong>{e.gate.labelJa}</strong></td>
                <td>
                  <span
                    className={
                      e.result === 'PASS' ? 'badge strong' : e.result === 'FAIL' ? 'badge skip' : 'badge est'
                    }
                  >
                    {SUPPLIER_ENTRY_GATE_RESULT_JA[e.result]}
                  </span>
                </td>
                <td className="small">{e.statusJa}</td>
                <td className="small">
                  {e.failedJa.length === 0 ? '—' : e.failedJa.map((t, i) => <div key={i}>{t}</div>)}
                </td>
                <td className="small muted">
                  {e.unknownJa.length === 0 ? '—' : e.unknownJa.map((t, i) => <div key={i}>{t}</div>)}
                </td>
                <td className="small">{e.canProceedToLegalGate ? '進んでよい' : '進まない'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 10 }}>
        確認する順番：{SUPPLIER_ENTRY_GATE_STEPS.map((k) => SUPPLIER_ENTRY_GATE_STEP_JA[k]).join(' → ')}
        {' → '}そのあとで規約・API・保存・比較・AI利用（下のLEGAL GATE）。
      </div>

      <h2>仕入先の門（LEGAL GATE）— いま誰の返事を待っているか</h2>
      <p className="lead">
        正式に接続してよいかを確かめている相手の一覧です。<strong>問い合わせを送るのも、規約を読むのも人間が行います</strong>（システムは連絡しません）。
        必要な質問がすべて「可」になった相手だけが門を通ります。1つでも「不明」が残る間は接続しません。
        <strong>最初に門を通過した仕入先が、最初の接続先（FIRST_LIVE_SUPPLIER）</strong>になります。順位や点数では決めません。
      </p>
      <div className="note" style={{ marginTop: 10 }}>
        {firstLive
          ? `最初の接続先：${firstLive.labelJa}（まず読むだけ。1件 → 5件 → 10件 → 47件の順に広げます）`
          : '最初の接続先は、まだ決まっていません。門を通過した仕入先が1件もないためです。この間、新しい外部通信は追加しません。'}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>順</th>
              <th>相手</th>
              <th>役割</th>
              <th>確認の方法</th>
              <th>いまの状態</th>
              <th>可</th>
              <th>条件付き</th>
              <th>不可</th>
              <th>不明</th>
              <th>門</th>
              <th>文案・チェックリストの場所</th>
            </tr>
          </thead>
          <tbody>
            {gateBoard.map((s) => (
              <tr key={s.waiting.supplierCode}>
                <td className="small">{s.waiting.order}</td>
                <td><strong>{s.waiting.labelJa}</strong></td>
                <td className="small">{s.waiting.roleJa}</td>
                <td className="small">{SUPPLIER_GATE_WAY_JA[s.waiting.way]}</td>
                <td className="small">{s.statusJa}</td>
                <td className="small">{num(s.yes)}</td>
                <td className="small">{num(s.conditional)}</td>
                <td className="small">{num(s.no)}</td>
                <td className="small">{num(s.unknown)}</td>
                <td>
                  <GateStateBadge state={s.display} />
                </td>
                <td className="small muted">{s.waiting.docJa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 10 }}>
        返事が届いたら、1問ずつ「可 / 不可 / 条件付きで可 / 不明」に分けて記録します。
        条件付きの場合は<strong>条件の原文</strong>も残し、その条件を安全装置として実装しきってから通過にします。
        あわせて<strong>回答メール・規約を確認した日・出典</strong>を必ず保存します。原文・出典・確認日のどれかが欠けている回答は、自動的に「不明」に戻します。
      </div>

      <h2>どの市場から自動でデータを取るか（CONNECTOR PRIORITY SCORE）</h2>
      <p className="lead">
        10市場を10の観点・各10点で採点しました。<strong>調べても分からなかった項目には点を付けていません</strong>（0点です）。
        点数の高さだけで選ぶと、「技術的には取れるが、規約で当社の目的が禁じられている市場」を選んでしまいます。
        そこで「使ってよいか」に関する4観点のうち1つでも0点の市場は、<strong>合計点が何点でも候補から外しています</strong>。
      </p>
      <div className="note" style={{ marginTop: 10 }}>{FIRST_LIVE_CONNECTOR_STATUS_JA}</div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>接続先</th>
              <th>市場</th>
              <th>点数</th>
              <th>候補にできるか</th>
              <th>いまの状態</th>
              <th>公式情報の確認</th>
              <th>未確認の項目</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r) => (
              <tr key={r.connector_code}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="small muted">{r.connector_code}</div>
                </td>
                <td className="small">{r.venue_ref}</td>
                <td>
                  <strong>{num(r.score)}</strong>
                  <span className="small muted"> / 100</span>
                </td>
                <td className="small">
                  {r.passes_gate
                    ? <span className="badge strong">候補にできる</span>
                    : <span className="badge skip">候補にしない</span>}
                  {r.gate_reason_ja && <div className="small muted">{r.gate_reason_ja}</div>}
                </td>
                <td className="small">{CONNECTOR_STATE_JA[r.state as ConnectorState] ?? r.state}</td>
                <td className="small">{USAGE_VERDICT_JA[r.verdict as UsageVerdict] ?? r.verdict}</td>
                <td className="small">
                  {/* 0件と書けるのは、本当に全部確認できたときだけ */}
                  {r.unknown_count > 0
                    ? <>{num(r.unknown_count)} 件</>
                    : <span className="muted">なし</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 10 }}>
        いま自動でデータを取っている市場は <strong>0件</strong> です。
        「Yahoo!ショッピングが0点に近い」のは<strong>禁止されているからではなく、商用に使ってよいかを確認できていないから</strong>です。
        確認が取れれば、この市場は一気に上位に変わります。詳しい根拠は
        事業Vault「19_Connector再調査_市場別スコア」に全部書いてあります。
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
      </p>

      {estimated > 0 && (
        <div className="note danger">
          <strong>手数料 {num(fees.length)} 件のうち {num(estimated)} 件が「概算」のままです。</strong>
          <div className="small" style={{ marginTop: 6 }}>
            概算とは、公式の料金ページ・契約書・請求書のどれでもまだ確認できていない数字のことです。
            この状態の市場は、利益の見込みがどれだけ良く出ても「最優先で買う（STRONG BUY）」には上がりません。
            自動購入も許可されません。数字を良く見せるために概算のまま進めることはしません。
          </div>
        </div>
      )}

      <div className="cards" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="k">手数料の設定数</div>
          <div className="v">{num(fees.length)}</div>
          <div className="sub">市場 × 買う／売る</div>
        </div>
        <div className="card">
          <div className="k">概算のまま</div>
          <div className="v">{num(estimated)}</div>
          <div className="sub">要・公式確認</div>
        </div>
        <div className="card">
          <div className="k">確認済み</div>
          <div className="v">{num(verified)}</div>
          <div className="sub">公式ページ／契約書／請求書</div>
        </div>
        <div className="card">
          <div className="k">出典URLあり</div>
          <div className="v">{num(withUrl)}</div>
          <div className="sub">あとから見返せる</div>
        </div>
      </div>

      <div className="scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>確からしさ</th>
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
              <th>出どころ</th>
              <th>確認日</th>
              <th>確認した人</th>
              <th>版</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((f) => (
              <tr key={String(f.id)}>
                <td>
                  {Number(f.is_estimated) === 1
                    ? <span className="badge est">概算</span>
                    : <span className="badge strong">確認済み</span>}
                </td>
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
                  {f.source_url
                    ? <a href={String(f.source_url)} target="_blank" rel="noreferrer">
                        {FEE_SOURCE_JA[String(f.source_type ?? '')] ?? String(f.source_type ?? '未記入')}
                      </a>
                    : (FEE_SOURCE_JA[String(f.source_type ?? '')] ?? <span className="muted">未記入</span>)}
                  {!f.source_url && <div className="small muted">出典URLなし</div>}
                </td>
                <td className="small">
                  {f.verified_at ? day(f.verified_at) : <span className="muted">未確認</span>}
                </td>
                <td className="small">
                  {f.manually_verified_by
                    ? String(f.manually_verified_by)
                    : <span className="muted">—</span>}
                </td>
                <td className="small muted">{String(f.fee_version ?? '—')}</td>
                <td className="small muted">{String(f.source_note ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>手数料が変わったときの記録</h2>
      <p className="lead small">
        手数料は変わります。変わったあとの料金で過去の利益を計算し直すと、
        「当時いくらの利益を見込んで買うと判断したのか」が消えてしまい、答え合わせが嘘になります。
        そのため過去の判断は当時の版のまま残し、変更はここに記録だけします。
      </p>
      {feeChanges.length === 0 ? (
        <div className="note">まだ手数料の変更は検知されていません。</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>検知日</th>
                <th>市場</th>
                <th>区分</th>
                <th>変わった項目</th>
                <th>旧版</th>
                <th>新版</th>
              </tr>
            </thead>
            <tbody>
              {feeChanges.map((c) => (
                <tr key={String(c.id)}>
                  <td className="small">{day(c.detected_at)}</td>
                  <td>{String(c.venue_code)}</td>
                  <td className="small">{c.side === 'BUY' ? '買う' : '売る'}</td>
                  <td className="small">{changedFieldsJa(c.changed_fields)}</td>
                  <td className="small muted">{String(c.old_fee_version ?? '—')}</td>
                  <td className="small muted">{String(c.new_fee_version ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const FEE_FIELD_JA: Record<string, string> = {
  fee_rate: '手数料率', payment_fee_rate: '決済手数料', currency_fee_rate: '為替',
  tax_rate: '税', import_duty_rate: '関税', advertising_fee_rate: '広告費',
  return_loss_rate: '返品見込', fixed_fee: '固定費', shipping_cost: '送料',
  authentication_fee: '鑑定料', packing_cost: '梱包費', warehouse_cost: '保管費',
  return_loss_fixed: '返品固定費', other_cost: 'その他費用',
};

function changedFieldsJa(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '—';
  try {
    const j = JSON.parse(raw);
    const fields: string[] = Array.isArray(j?.fields) ? j.fields : [];
    if (fields.length === 0) return '金額に影響する項目';
    return fields.map((f) => FEE_FIELD_JA[f] ?? f).join('・');
  } catch {
    return '—';
  }
}
