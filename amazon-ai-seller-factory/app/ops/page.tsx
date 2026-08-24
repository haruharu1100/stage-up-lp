import BackupBoard from '@/components/BackupBoard';
import OpsBoard from '@/components/OpsBoard';
import { all, migrate } from '@/lib/db/client';
import { config } from '@/lib/env';
import { yen, jstDateTime } from '@/lib/format';
import { PROVIDER_LABEL, usageHistory, usageSummary, type UsageProvider } from '@/lib/ops/apiUsage';
import { CRITICAL_TABLES, backupList, backupStatus } from '@/lib/ops/backup';
import { heartbeatStatus } from '@/lib/ops/heartbeat';
import {
  ERROR_KIND_LABEL,
  JOB_STATUS_LABEL,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MIN,
  jobRunList,
  jobRunSummary,
  type ErrorKind,
  type JobStatus,
} from '@/lib/ops/jobRuns';
import {
  PROVIDER_STATUS_COLOR,
  PROVIDER_STATUS_LABEL,
  providerHealthList,
} from '@/lib/ops/providerHealth';
import { duePlans } from '@/lib/ops/schedule';
import { loadResearchSettings } from '@/lib/research/settings';
import { adapterStatus } from '@/lib/suppliers/importAdapters';
import { supplierImportHistory, supplierPriceChanges } from '@/lib/suppliers/supplierImport';

export const dynamic = 'force-dynamic';

/**
 * 自動運転の管理画面（予定表・API代・仕入先データの取込）。
 * ★ここから動くのは「調べる・数える・学ぶ」だけ。お金は1円も動かない。
 */
export default async function OpsPage() {
  await migrate();
  const settings = await loadResearchSettings();
  const [
    plans,
    usage,
    history,
    imports,
    changes,
    promoted,
    heartbeat,
    runs,
    runSummary,
    providers,
    backup,
    backups,
  ] = await Promise.all([
    duePlans(settings),
    usageSummary({ monthlyBudgetJpy: settings.monthlyBudgetJpy, budgetStopRatio: settings.budgetStopRatio }),
    usageHistory(14),
    supplierImportHistory(20),
    supplierPriceChanges(50),
    all(
      `SELECT id, amazon_title, supplier_title, grade, prev_grade, promotion_reason, promoted_at
         FROM research_candidates
        WHERE promotion_reason IS NOT NULL
        ORDER BY promoted_at DESC LIMIT 30`,
    ),
    heartbeatStatus(),
    jobRunList(40),
    jobRunSummary(),
    providerHealthList(),
    backupStatus(),
    backupList(10),
  ]);
  const adapters = adapterStatus();

  const STATUS_COLOR: Partial<Record<JobStatus, string>> = {
    FAILED: '#b00',
    RETRYING: '#b36b00',
    RUNNING: '#0a6',
  };

  return (
    <main className="wrap">
      <div className="notice info">
        <strong>自動で動くのは「調べる・数える・学ぶ」だけです。</strong>
        発注・出品公開・価格変更・広告の入札は、自動では絶対に起きません（AUTO_PURCHASE=
        {String(config.autoPurchase)} ／ AMAZON_AUTO_PUBLISH={String(config.autoPublish)} ／ AD_AUTO_OPTIMIZE=
        {String(config.adAutoOptimize)}）。
      </div>

      {/* ---- ① 自動運転は生きているか ---- */}
      <div className="card">
        <h2>自動運転は動いていますか</h2>
        <div className={heartbeat.alive ? 'notice info' : 'notice err'}>
          <strong>{heartbeat.headline}</strong>
          {heartbeat.advice.map((a, i) => (
            <div key={i} className="small">
              ・{a}
            </div>
          ))}
        </div>
        <div className="kpis" style={{ marginTop: 10 }}>
          <div className="kpi">
            <div className="kpi-label">最後に確認できた時刻</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>
              {heartbeat.beatAt ? jstDateTime(heartbeat.beatAt) : '—'}
            </div>
            <div className="kpi-note">{heartbeat.ageMinutes != null ? `${heartbeat.ageMinutes}分前` : '記録なし'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">24時間で動いた仕事</div>
            <div className="kpi-value">{runSummary.last24hTotal}</div>
            <div className="kpi-note">件（成功{runSummary.last24hSuccess}／失敗{runSummary.last24hFailed}）</div>
          </div>
          <div className={runSummary.retrying > 0 ? 'kpi strong' : 'kpi'}>
            <div className="kpi-label">やり直し待ち</div>
            <div className="kpi-value">{runSummary.retrying}</div>
            <div className="kpi-note">件（自動でもう一度試します）</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">成功率（24時間）</div>
            <div className="kpi-value">
              {runSummary.successRate != null ? Math.round(runSummary.successRate * 100) : '—'}
            </div>
            <div className="kpi-note">％</div>
          </div>
        </div>
        <div className={runSummary.last24hFailed > 0 ? 'notice warn' : 'notice info'} style={{ marginTop: 10 }}>
          {runSummary.headline}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          <strong>パソコンをつけっぱなしにする必要はありません。</strong>
          ターミナルで<code> npm run scheduler:install </code>
          を一度だけ実行すると、パソコンの起動時に自動で立ち上がり、途中で落ちても自動で立ち上げ直します。
          今どうなっているかは<code> npm run scheduler:status </code>で見られます。
          （動くのは「調べる・数える・学ぶ」だけです）
        </p>
      </div>

      {/* ---- ② 大事なデータのバックアップ ---- */}
      <div className="card">
        <h2>大事なデータのバックアップ</h2>
        <div className={backup.ok ? 'notice info' : 'notice err'}>
          <strong>{backup.headline}</strong>
          {backup.advice.map((a, i) => (
            <div key={i} className="small">
              ・{a}
            </div>
          ))}
        </div>
        <p className="desc" style={{ marginTop: 10 }}>
          {backup.intervalHours}時間おきに自動で保存し、{backup.keep}
          世代ぶん残します。保存するのは<strong>買い直せないデータ</strong>
          （承認の履歴・仕入れた記録・売れた実績・広告実績・予測と実績のズレ・学習した重み・ランクが動いた理由）です。
          <br />
          保存先：<code>{backup.dir}</code>
          <br />
          <strong>★戻す作業は必ず人の手で行います。</strong>
          このシステムが勝手にデータを戻すことはありません。
        </p>
        <BackupBoard />

        <details style={{ marginTop: 12 }}>
          <summary className="small">何を守っているのかを見る（{CRITICAL_TABLES.length}種類）</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>データ</th>
                <th>買い直せるか</th>
                <th>なぜ大事か</th>
              </tr>
            </thead>
            <tbody>
              {CRITICAL_TABLES.map((t) => (
                <tr key={t.table}>
                  <td className="small">{t.label}</td>
                  <td className="small">
                    {t.irreplaceable ? <strong style={{ color: '#b00' }}>買い直せない</strong> : '取り直せる'}
                  </td>
                  <td className="small muted">{t.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        {backups.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>バックアップの履歴</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>結果</th>
                  <th>件数</th>
                  <th>置き場所</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td className="small">{jstDateTime(b.startedAt)}</td>
                    <td className="small">
                      <strong style={{ color: b.status === 'FAILED' ? '#b00' : b.status === 'PARTIAL' ? '#b36b00' : undefined }}>
                        {b.status === 'SUCCESS' ? '成功' : b.status === 'PARTIAL' ? '一部だけ成功' : b.status === 'FAILED' ? '失敗' : b.status}
                      </strong>
                      {b.error && <div className="small muted">{b.error}</div>}
                    </td>
                    <td className="small">
                      {b.rowsCount != null ? `${b.rowsCount.toLocaleString()}件` : '—'}
                      {b.dbCopied && <div className="small muted">まるごとの写しもあり</div>}
                    </td>
                    <td className="small muted">{b.dir ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ---- ③ 外部APIの調子 ---- */}
      <div className="card">
        <h2>外部サービスの調子</h2>
        <p className="desc">
          Keepa や OpenAI などが止まっているとき、<strong>推測の数字で埋めることは絶対にしません</strong>。
          止まっている間はその仕事ごと見送り、直ってから動かします。
          {' '}5回続けて失敗すると「止まっている」と判断し、10分間は呼び出しを控えます。
        </p>
        {!providers.length ? (
          <div className="muted">まだ外部サービスを呼んでいません（記録がありません）。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>サービス</th>
                <th>調子</th>
                <th>直近の状況</th>
                <th>速さ</th>
                <th>最後の失敗</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider}>
                  <td>{p.label}</td>
                  <td>
                    <strong style={{ color: PROVIDER_STATUS_COLOR[p.status] }}>
                      {PROVIDER_STATUS_LABEL[p.status]}
                    </strong>
                  </td>
                  <td className="small">{p.message}</td>
                  <td className="small">{p.avgLatencyMs != null ? `${p.avgLatencyMs}ms` : '—'}</td>
                  <td className="small muted">
                    {p.lastFailAt ? jstDateTime(p.lastFailAt) : '—'}
                    {p.lastError && <div>{p.lastError.slice(0, 80)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- ④ 仕事の実行記録 ---- */}
      <div className="card">
        <h2>仕事の実行記録（何時・何を・どこで失敗したか）</h2>
        <p className="desc">
          1回動かすごとに1行残します。失敗したときは
          <strong>
            {RETRY_DELAYS_MIN.join('分後 → ')}分後
          </strong>
          の順で自動的にやり直し、<strong>最大{MAX_ATTEMPTS}回で必ず止まります</strong>（際限なく繰り返しません）。
          APIキーの間違いや設定不足など「やり直しても直らない失敗」は、1回であきらめます。
          電源が落ちて途中で止まった仕事は、次に動いたときに自動で拾い直します。
        </p>
        {!runs.length ? (
          <div className="muted">まだ実行記録はありません。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>日時</th>
                <th>仕事</th>
                <th>結果</th>
                <th>どこまで</th>
                <th>中身</th>
                <th>時間</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.startedAt ? jstDateTime(r.startedAt) : '—'}</td>
                  <td className="small">
                    {r.label}
                    <div className="small muted">
                      {r.attempt > 1 ? `${r.attempt}回目／` : ''}
                      {r.trigger === 'schedule' ? '予定' : r.trigger === 'retry' ? 'やり直し' : '手動'}
                    </div>
                  </td>
                  <td className="small">
                    <strong style={{ color: STATUS_COLOR[r.status] }}>
                      {JOB_STATUS_LABEL[r.status] ?? r.status}
                    </strong>
                    {r.errorKind && (
                      <div className="small muted">{ERROR_KIND_LABEL[r.errorKind as ErrorKind] ?? r.errorKind}</div>
                    )}
                    {r.nextAttemptAt && <div className="small">次回 {jstDateTime(r.nextAttemptAt)}</div>}
                  </td>
                  <td className="small">{r.stage ?? '—'}</td>
                  <td className="small">{r.message ? r.message.slice(0, 120) : '—'}</td>
                  <td className="small muted">
                    {r.durationMs != null ? `${Math.round(r.durationMs / 100) / 10}秒` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- API代 ---- */}
      <div className="card">
        <h2>API代（使いすぎを見張っています）</h2>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">今日の呼び出し回数</div>
            <div className="kpi-value">{usage.today.calls}</div>
            <div className="kpi-note">回（{yen(usage.today.costJpy)}）</div>
          </div>
          <div className="kpi strong">
            <div className="kpi-label">今月の合計</div>
            <div className="kpi-value">{Math.round(usage.month.costJpy).toLocaleString()}</div>
            <div className="kpi-note">
              円 ／ 上限{usage.budget.limitJpy ? `${usage.budget.limitJpy.toLocaleString()}円` : 'なし'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">商品1件あたり</div>
            <div className="kpi-value">{usage.perItemJpy != null ? usage.perItemJpy : '—'}</div>
            <div className="kpi-note">円（今月{usage.itemsThisMonth}件を調査）</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">上限に対して</div>
            <div className="kpi-value">
              {usage.budget.usedRatio != null ? Math.round(usage.budget.usedRatio * 100) : '—'}
            </div>
            <div className="kpi-note">％使用</div>
          </div>
        </div>
        <div className={usage.budget.shouldThrottle ? 'notice warn' : 'notice info'} style={{ marginTop: 10 }}>
          {usage.budget.message}
        </div>

        {usage.today.byProvider.length > 0 && (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>今日つかった先</th>
                <th>回数</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {usage.today.byProvider.map((p) => (
                <tr key={p.provider}>
                  <td>{PROVIDER_LABEL[p.provider as UsageProvider] ?? p.label}</td>
                  <td>{p.calls}回</td>
                  <td>{yen(p.costJpy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {history.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="small">日ごとの使用量を見る（直近14日）</summary>
            <table className="table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>回数</th>
                  <th>金額</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h: any, i: number) => (
                  <tr key={i}>
                    <td>{String(h.day)}</td>
                    <td>{Number(h.calls ?? 0)}回</td>
                    <td>{yen(Number(h.cost_jpy ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          上限の{Math.round(settings.budgetStopRatio * 100)}
          ％を超えると、B・Cランクの見張りのような「急がない仕事」から自動で止まります。Aランクの見張りは止まりません。
        </p>
      </div>

      {/* ---- 予定表 ---- */}
      <div className="card">
        <h2>自動実行の予定表</h2>
        <p className="desc">
          この表は「いつ何を動かすか」の計画です。実際に時間どおり起こすには、パソコン側で
          <code> npm run scheduler:loop </code>を動かしっぱなしにするか、cron / launchd に登録してください。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>仕事</th>
              <th>動かすか</th>
              <th>いつ</th>
              <th>前回</th>
              <th>次回</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={`${p.job}-${i}`}>
                <td>{p.label}</td>
                <td>{p.enabled ? <strong>動かす</strong> : <span className="muted">止めています</span>}</td>
                <td className="small">
                  {p.timeOfDay
                    ? `毎日 ${p.timeOfDay}`
                    : p.intervalMinutes
                      ? `${Math.round((p.intervalMinutes / 60) * 10) / 10}時間ごと`
                      : '—'}
                </td>
                <td className="small">{p.lastRunAt ? jstDateTime(p.lastRunAt) : '—'}</td>
                <td className="small">{p.nextDueAt ? jstDateTime(p.nextDueAt) : '—'}</td>
                <td className="small muted">{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- 設定と手動実行 ---- */}
      <div className="card">
        <h2>設定を変える／今すぐ動かす</h2>
        <OpsBoard settings={settings} />
      </div>

      {/* ---- 仕入先データの取込 ---- */}
      <div className="card">
        <h2>仕入先データの取込</h2>
        <p className="desc">
          CSV・Googleスプレッドシート・共有URLなどから仕入先の在庫表を読み込みます。
          <strong>前回と中身が同じ商品は再計算しません</strong>（API代を使わないためです）。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>読み込み口</th>
              <th>状態</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {adapters.map((a) => (
              <tr key={a.name}>
                <td>{a.name}</td>
                <td>{a.ready ? <strong>使えます</strong> : <span className="muted">未設定</span>}</td>
                <td className="small">{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {imports.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>取込の履歴</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>読み込み口</th>
                  <th>結果</th>
                  <th>件数</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((im: any) => (
                  <tr key={String(im.id)}>
                    <td className="small">{jstDateTime(String(im.started_at))}</td>
                    <td>{String(im.adapter)}</td>
                    <td>
                      {String(im.status) === 'done' ? (
                        <strong>成功</strong>
                      ) : String(im.status) === 'failed' ? (
                        <span style={{ color: '#b00' }}>失敗</span>
                      ) : (
                        String(im.status)
                      )}
                      {im.error && <div className="small muted">{String(im.error)}</div>}
                    </td>
                    <td className="small">
                      読込{Number(im.rows_seen ?? 0)}／新規{Number(im.rows_new ?? 0)}／変更
                      {Number(im.rows_changed ?? 0)}／変化なし{Number(im.rows_unchanged ?? 0)}／消えた
                      {Number(im.rows_gone ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {changes.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>仕入先データの変化</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>商品</th>
                  <th>変わったもの</th>
                  <th>前</th>
                  <th>後</th>
                </tr>
              </thead>
              <tbody>
                {changes.slice(0, 30).map((c: any) => (
                  <tr key={String(c.id)}>
                    <td className="small">{jstDateTime(String(c.created_at))}</td>
                    <td className="small">{String(c.external_id ?? '')}</td>
                    <td>{String(c.field)}</td>
                    <td>{String(c.old_value ?? '—')}</td>
                    <td>
                      <strong>{String(c.new_value ?? '—')}</strong>
                      {c.delta != null && Number(c.delta) !== 0 && (
                        <span className="small muted">
                          {' '}
                          （{Number(c.delta) > 0 ? '+' : ''}
                          {Math.round(Number(c.delta)).toLocaleString()}）
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ---- ランクが動いた理由 ---- */}
      <div className="card">
        <h2>値下がり・条件割れでランクが動いた商品</h2>
        <p className="desc">
          仕入価格が下がってAランクの条件を満たしたら、理由を書いて自動でAに上げます。
          逆に、Aの条件を割ったらBに下げて理由を残します。<strong>上がっても、買うかどうかは人が決めます。</strong>
        </p>
        {!promoted.length ? (
          <div className="muted">まだランクが動いた商品はありません。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>日時</th>
                <th>商品</th>
                <th>変化</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {promoted.map((p: any) => (
                <tr key={String(p.id)}>
                  <td className="small">{p.promoted_at ? jstDateTime(String(p.promoted_at)) : '—'}</td>
                  <td className="small">{String(p.amazon_title || p.supplier_title || '').slice(0, 40)}</td>
                  <td>
                    {p.prev_grade ? `${String(p.prev_grade)} → ` : ''}
                    <strong>{String(p.grade)}</strong>
                  </td>
                  <td className="small">{String(p.promotion_reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
