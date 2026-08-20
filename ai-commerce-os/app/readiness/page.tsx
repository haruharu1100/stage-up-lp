import Link from 'next/link';
import { connectorStatus, fetchLog } from '@/lib/connectors/observe';
import { buildDailyReport } from '@/lib/dailyreport';
import { REACHABILITY_JA, halfLifeTable } from '@/lib/halflife';
import { num, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * 実購入に進めるかどうかの1画面（Phase 3.5・§20 §24 §25）。
 *
 * 一番上に結論を1行だけ置く。
 * その下は「なぜまだ進めないのか」の内訳。
 * 数字が良く見えても、卒業条件を1つでも満たしていなければ結論は変わらない。
 */
export default async function ReadinessPage() {
  const r = await buildDailyReport();
  const connectors = await connectorStatus();
  const log = await fetchLog(15);
  const hl = (await halfLifeTable()).filter((x) => String(x.segment_type) === 'pair').slice(0, 10);

  const sb = r.precision.strongBuy;

  return (
    <main>
      <h1>実購入に進めるか</h1>

      <div className={r.gate.passed ? 'note ok' : 'note danger'}>
        <strong style={{ fontSize: '1.1em' }}>{r.headline}</strong>
      </div>

      <p className="lead small">
        この結論は、下の卒業条件の判定から機械的に作られています。
        AIが「そろそろ良さそう」と書き換えることはできません。
        条件を1つでも満たしていなければ、必ず「まだ実購入に進めません」と表示されます。
      </p>

      <div className="cards">
        <div className="card hi">
          <div className="k">実市場データのSHADOW</div>
          <div className="v">{num(r.realShadow.real)}</div>
          <div className="sub">目標 {num(r.gate.thresholds.minRealShadow)} 件／テストデータ {num(r.realShadow.total - r.realShadow.real)} 件は数えていません</div>
        </div>
        <div className="card">
          <div className="k">STRONG BUY の的中率</div>
          <div className="v sm">{sb.precision === null ? '測定不能' : pct(sb.precision)}</div>
          <div className="sub">
            {sb.decidedBuy === 0
              ? '実市場データでの判断がまだ0件'
              : `${num(sb.truePositive)} / ${num(sb.decidedBuy)} 件（95%下限 ${pct(sb.precisionLower)}）`}
          </div>
        </div>
        <div className="card">
          <div className="k">卒業条件</div>
          <div className="v">{num(r.gate.passedCount)} / {num(r.gate.totalCount)}</div>
          <div className="sub">項目クリア</div>
        </div>
        <div className="card">
          <div className="k">手数料の実額確認</div>
          <div className="v sm">{r.fees.total === 0 ? '—' : pct(r.fees.verifiedRatio)}</div>
          <div className="sub">{num(r.fees.verified)} / {num(r.fees.total)} 件</div>
        </div>
        <div className="card">
          <div className="k">正規の自動取得ができる市場</div>
          <div className="v">{num(r.connectors.autoFetchAllowed)} / {num(r.connectors.total)}</div>
          <div className="sub">契約済みのAPI・データフィード</div>
        </div>
        <div className="card">
          <div className="k">人による解錠</div>
          <div className="v sm">{r.gate.humanUnlocked ? '済み' : 'まだ'}</div>
          <div className="sub">AIは自分で解錠できません</div>
        </div>
      </div>

      <h2>次にやること（1つだけ）</h2>
      <div className="note">{r.nextAction}</div>

      <h2>卒業条件の内訳</h2>
      <p className="lead small">
        測れていない項目は「不合格」として扱います。データが無いほど通りやすくなってはいけないためです。
      </p>
      <table>
        <thead>
          <tr><th>判定</th><th>項目</th><th>今の状態</th></tr>
        </thead>
        <tbody>
          {r.gate.checks.map((c) => (
            <tr key={c.key}>
              <td>{c.passed ? '○' : '×'}</td>
              <td>{c.label}</td>
              <td className="small">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>判断の間違い方（実市場データのみ）</h2>
      <p className="lead small">
        同じ「1件の間違い」でも痛みが違います。買って損すると現金が減りますが、
        見送った取り逃しは儲け損ねただけです。だから前者を {r.precision.falsePositiveWeight} 倍の重さで数えています。
      </p>
      <table>
        <thead>
          <tr><th>絞り込み</th><th>買うと判断</th><th>実際に利益</th><th>実際は損</th><th>見送ったが儲かっていた</th><th>的中率</th></tr>
        </thead>
        <tbody>
          {[r.precision.strongBuy, r.precision.buyOrBetter, r.precision.all].map((b) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td>{num(b.decidedBuy)}</td>
              <td>{num(b.truePositive)}</td>
              <td>{num(b.falsePositive)}</td>
              <td>{num(b.falseNegative)}</td>
              <td>{b.precision === null ? '測定不能' : pct(b.precision)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.precision.evaluated === 0 && <div className="note">{r.precision.note}</div>}

      <h2>データの取り方（市場ごと）</h2>
      <p className="lead small">
        無断でサイトを自動巡回することはしません。取得手段は公式API・法人API・正式なデータフィード・
        人が実際の画面を見て記録したCSVのみです。使えない市場は「使えない」と表示し、推測で埋めません。
      </p>
      <table>
        <thead>
          <tr><th>市場</th><th>相場</th><th>手数料</th><th>自動取得</th><th>今できること</th></tr>
        </thead>
        <tbody>
          {connectors.map((c) => (
            <tr key={c.venueCode}>
              <td>{c.name}</td>
              <td>{c.marketStats}</td>
              <td>{c.fees}</td>
              <td>{c.autoFetchAllowed ? '可' : '不可'}</td>
              <td className="small">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hl.length > 0 && (
        <>
          <h2>利益機会が消えるまでの時間</h2>
          <p className="lead small">
            価格差は永遠には残りません。半分が消えるまでの時間が、人が確認するのに必要な時間より短ければ、
            その組み合わせは今の体制では取りに行きません。速さのために安全確認を飛ばすことはしません。
          </p>
          <table>
            <thead>
              <tr><th>市場の組み合わせ</th><th>半減期</th><th>消滅の実績</th><th>判定</th></tr>
            </thead>
            <tbody>
              {hl.map((x) => (
                <tr key={String(x.segment_key)}>
                  <td>{String(x.segment_key)}</td>
                  <td>{x.half_life_hours === null ? '—' : `${Number(x.half_life_hours).toFixed(1)}時間`}</td>
                  <td>{num(Number(x.expired_count))}</td>
                  <td className="small">
                    {REACHABILITY_JA[String(x.reachability) as keyof typeof REACHABILITY_JA] ?? String(x.reachability)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {log.length > 0 && (
        <>
          <h2>取得の記録</h2>
          <p className="lead small">
            「0件だった」のか「規約上できなかった」のか「実行していない」のかを区別して残しています。
          </p>
          <table>
            <thead>
              <tr><th>日時</th><th>市場</th><th>結果</th><th>件数</th><th>内容</th></tr>
            </thead>
            <tbody>
              {log.map((x, i) => (
                <tr key={i}>
                  <td className="small">{String(x.attempted_at).slice(0, 19).replace('T', ' ')}</td>
                  <td>{String(x.venue_code)}</td>
                  <td>{String(x.reason)}</td>
                  <td>{num(Number(x.item_count))}</td>
                  <td className="small">{String(x.message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>安全の確認</h2>
      <div className="note">
        {r.safety.message}
        <br />
        少額の実取引を始めるときの上限（1件1万円・1日3万円・同一商品1個・STRONG BUYのみ・手数料が実額確認済みのみ）は
        設計だけ済ませてあります。実行する処理は作っていません。
      </div>

      <p className="lead small">
        関連：<Link href="/accuracy">予測精度</Link> ／ <Link href="/routes">どこで買ってどこで売るか</Link> ／{' '}
        <Link href="/market">市場ごとの相場</Link>
      </p>
    </main>
  );
}
