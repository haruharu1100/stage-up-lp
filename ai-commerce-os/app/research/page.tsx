/**
 * 毎朝、いちばん最初に見る画面（Phase 5・§2）。
 *
 * ------------------------------------------------------------------
 * 【この画面が守っていること】
 *
 * ご本人の指示（原文・§2）には
 *   「調査商品 82,431件 ／ 利益候補 347件 ／ BUY 42件 …」
 * のような例が書かれているが、**あれは形の例であって、当社の実績ではない。**
 * よってこの画面は、**保存してある記録から出せる数字だけ**を出す（ルール63・ルール35）。
 * 出せないものは「—」と書き、なぜ出せないかを日本語で添える。
 *
 * 【この画面がしないこと】
 *   ・外部への通信（保存済みデータを読むだけ）
 *   ・自動リサーチの実行（ボタンを置かない。実行はコマンドから・ルール94と同じ考え方）
 *   ・購入・出品・決済・発送（コードごと存在しない・§53）
 */

import Link from 'next/link';
import { ensureReady } from '@/lib/queries';
import {
  CANDIDATE_VENUES,
  REGISTERED_CONNECTORS,
  autoResearchReachJa,
  buySideAutoConnectorCount,
  canAutoResearch,
  sellSideAutoConnectorCount,
} from '@/lib/phase5/connector';
import {
  AUTO_LISTING_IMPLEMENTED,
  AUTO_PAYMENT_IMPLEMENTED,
  AUTO_PURCHASE_IMPLEMENTED,
  AUTO_SHIPPING_IMPLEMENTED,
  HUMAN_ONLY_ACTIONS_JA,
  PIPELINE_STAGES,
  planRun,
} from '@/lib/phase5/orchestrator';
import { buildEffectivenessFunnel, morningSummaryLinesJa } from '@/lib/phase5/effectiveness';
import { PENDING_REASON_JA, type PendingReason } from '@/lib/phase5/watch';
import {
  connectorViews,
  countPendingByReason,
  latestRunSummary,
  listPendingSuppliers,
  listResearchRuns,
} from '@/lib/phase5/store';

export const dynamic = 'force-dynamic';

/** 数えられないものは 0 ではなく「—」。ルール115。 */
function n(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : Number(v).toLocaleString('ja-JP');
}

function day(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return s === '' ? '—' : s.slice(0, 16).replace('T', ' ');
}

export default async function ResearchPage() {
  await ensureReady();

  const views = connectorViews();
  const plan = planRun('DEMAND_FIRST', views);
  const latest = await latestRunSummary();
  const byReason = await countPendingByReason();
  const pending = await listPendingSuppliers(50);
  const runs = await listResearchRuns(10);

  const buySide = buySideAutoConnectorCount();
  const sellSide = sellSideAutoConnectorCount();

  const lastRun = runs[0] ?? null;
  const researched = lastRun ? Number(lastRun.researched_products ?? 0) : 0;
  const matched = lastRun ? Number(lastRun.matched_products ?? 0) : 0;
  const routes = lastRun ? Number(lastRun.profitable_routes ?? 0) : 0;
  const buys = lastRun ? Number(lastRun.buy_opportunities ?? 0) : 0;

  const funnel = buildEffectivenessFunnel({
    RESEARCHED_PRODUCTS: researched,
    MATCHED_PRODUCTS: matched,
    PROFITABLE_ROUTES: routes,
    BUY_OPPORTUNITIES: buys,
  });

  // 保守側の予想利益は **必ず null**。仕入価格が1件も入っていない以上、
  // 利益額は計算できない。ここを 0 円と書くと「利益ゼロと分かっている」に見える（ルール115）。
  const summaryLines = morningSummaryLinesJa({
    researchedProducts: researched,
    profitCandidates: routes,
    buyCount: buys,
    strongBuyCount: 0,
    needsAttentionCount: latest.pending,
    requiredCapitalJpy: 0,
    conservativeProfitJpy: null,
    dataNoteJa:
      '※ この数字は、保存済みのデータを読んで数えたものだけです。'
      + '仕入側に自動で使える市場が0件なので、購入候補はまだ出ません。',
  });

  return (
    <main>
      <h1>自動リサーチ（毎朝ここを見る）</h1>
      <p className="lead">
        主経路は <strong>AIが自分で商品を探す</strong>（AUTO RESEARCH）。
        人が仕入商品を手で入れる <Link href="/buy">10件入力</Link> は、
        いまも残してある予備の道（MANUAL FALLBACK）です。
      </p>

      <div className="note ok">
        この画面は外部へ1回も接続しません。保存済みのデータを読んで並べているだけです。
        取得の枠（Keepa Token）も1つも使いません。
      </div>

      {/* ---------------- 朝の要約 ---------------- */}
      <div className="panel">
        <h2>今朝の要約</h2>
        <ul className="reasons">
          {summaryLines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <p className="small muted">{latest.messageJa}</p>
      </div>

      {/* ---------------- いま自動で使える市場 ---------------- */}
      <div className="panel">
        <h2>いま自動で使える市場</h2>
        <div className="cards">
          <div className="card">
            <div className="k">仕入側（買う）</div>
            <div className="v">{buySide}</div>
            <div className="sub">自動で商品を探せる市場</div>
          </div>
          <div className="card">
            <div className="k">販売側（売る）</div>
            <div className="v">{sellSide}</div>
            <div className="sub">自動で相場を読める市場</div>
          </div>
          <div className="card">
            <div className="k">名前だけの候補</div>
            <div className="v">{CANDIDATE_VENUES.length}</div>
            <div className="sub">1つも接続していません</div>
          </div>
        </div>
        <p className="small">{autoResearchReachJa()}</p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>市場</th>
                <th>いま自動で使えるか</th>
                <th>使えない理由</th>
              </tr>
            </thead>
            <tbody>
              {REGISTERED_CONNECTORS.map((d) => {
                const chk = canAutoResearch(d);
                return (
                  <tr key={d.venueCode}>
                    <td>{d.labelJa}</td>
                    <td>
                      <span className={chk.ok ? 'badge strong' : 'badge est'}>
                        {chk.ok ? '使えます' : '使えません'}
                      </span>
                    </td>
                    <td className="small">{chk.ok ? '' : chk.reasonsJa.join(' / ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          市場ごとの許可の中身は <Link href="/venues">市場一覧</Link> にあります。
          「APIがある」ことは「使ってよい」ことではありません。
        </p>
      </div>

      {/* ---------------- この回の段取り ---------------- */}
      <div className="panel">
        <h2>どこまで自動で進めるか</h2>
        <p className="small">
          需要から探す道（Demand First）で、いま通れるのは{' '}
          <strong>{PIPELINE_STAGES.find((s) => s.key === plan.reachableUpTo)?.labelJa ?? '—'}</strong> までです。
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>工程</th>
                <th>いま通れるか</th>
                <th>止まる理由</th>
              </tr>
            </thead>
            <tbody>
              {plan.stages.map((s) => {
                const st = PIPELINE_STAGES.find((x) => x.key === s.key);
                return (
                  <tr key={s.key}>
                    <td>
                      {st?.labelJa ?? s.key}
                      <div className="small muted">{st?.purposeJa ?? ''}</div>
                    </td>
                    <td>
                      <span className={s.runnable ? 'badge strong' : 'badge skip'}>
                        {s.runnable ? '通れます' : '止まります'}
                      </span>
                    </td>
                    <td className="small">{s.runnable ? '' : s.blockedReasonsJa.join(' / ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">{plan.summaryJa}</p>
      </div>

      {/* ---------------- 効き目 ---------------- */}
      <div className="panel">
        <h2>リサーチの効き目</h2>
        <p className="small">
          見るのは「たくさん調べたか」ではなく、
          <strong>少ない費用と少ない手作業で、利益商品をいくつ見つけられたか</strong>です（§48）。
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>段</th>
                <th className="num">件数</th>
                <th className="num">前の段から残った割合</th>
                <th className="num">最初からの割合</th>
              </tr>
            </thead>
            <tbody>
              {funnel.rows.map((s) => (
                <tr key={s.key}>
                  <td>{s.labelJa}</td>
                  <td className="num">{n(s.count)}</td>
                  <td className="num">{s.survivalRate === null ? '—' : `${Math.round(s.survivalRate * 100)}%`}</td>
                  <td className="num">{s.overallRate === null ? '—' : `${Math.round(s.overallRate * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {funnel.warningsJa.length > 0 && (
          <div className="note danger">
            {funnel.warningsJa.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- 仕入先探し待ち ---------------- */}
      <div className="panel">
        <h2>仕入先探し待ち（{latest.pending.toLocaleString('ja-JP')}件）</h2>
        <p className="small">
          需要の条件は満たしたが、<strong>買える市場に正式な接続が無いので先へ進めない</strong>商品です（§40）。
          無断でWebを見に行くことはしません。ここに貯めて待ちます。
        </p>
        {byReason.length > 0 && (
          <div className="cards">
            {byReason.map((r) => (
              <div className="card" key={r.reason}>
                <div className="k">{PENDING_REASON_JA[r.reason as PendingReason] ?? r.reason}</div>
                <div className="v">{r.count.toLocaleString('ja-JP')}</div>
                <div className="sub">件</div>
              </div>
            ))}
          </div>
        )}
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>ASIN</th>
                <th>商品名</th>
                <th className="num">30日の値下がり回数</th>
                <th>止まっている理由</th>
                <th>次にやること</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    まだ1件もありません。
                  </td>
                </tr>
              )}
              {pending.map((p) => (
                <tr key={String(p.id)}>
                  <td>{String(p.sell_side_id ?? '—')}</td>
                  <td className="small">{String(p.title ?? '—')}</td>
                  <td className="num">{p.demand_rank === null ? '—' : n(Number(p.demand_rank))}</td>
                  <td className="small">
                    {PENDING_REASON_JA[String(p.reason) as PendingReason] ?? String(p.reason)}
                  </td>
                  <td className="small">{String(p.next_step_ja ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- 実行の記録 ---------------- */}
      <div className="panel">
        <h2>回した記録</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>回した日時</th>
                <th>向き</th>
                <th>どこまで進んだか</th>
                <th className="num">調べた件数</th>
                <th className="num">購入候補</th>
                <th className="num">費用</th>
                <th>外部へ通信したか</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    まだ一度も回していません。
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={String(r.id)}>
                  <td className="small">{day(r.started_at)}</td>
                  <td className="small">{r.direction === 'DEMAND_FIRST' ? '需要から探す' : '仕入から探す'}</td>
                  <td className="small">
                    {PIPELINE_STAGES.find((s) => s.key === r.reached_stage)?.labelJa ?? String(r.reached_stage ?? '—')}
                    {r.stopped_reason_ja ? <div className="muted">{String(r.stopped_reason_ja)}</div> : null}
                  </td>
                  <td className="num">{n(r.researched_products === null ? null : Number(r.researched_products))}</td>
                  <td className="num">{n(r.buy_opportunities === null ? null : Number(r.buy_opportunities))}</td>
                  <td className="num">{r.api_cost_jpy === null ? '—' : `${n(Number(r.api_cost_jpy))}円`}</td>
                  <td className="small">
                    <span className={Number(r.network_used) === 1 ? 'badge est' : 'badge strong'}>
                      {Number(r.network_used) === 1 ? 'しました' : 'していません'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- しないこと ---------------- */}
      <div className="panel">
        <h2>この仕組みがしないこと</h2>
        <ul className="reasons">
          <li>自動購入：{AUTO_PURCHASE_IMPLEMENTED ? 'あり' : '実装していません（コードごとありません）'}</li>
          <li>自動出品：{AUTO_LISTING_IMPLEMENTED ? 'あり' : '実装していません（コードごとありません）'}</li>
          <li>自動決済：{AUTO_PAYMENT_IMPLEMENTED ? 'あり' : '実装していません（コードごとありません）'}</li>
          <li>自動発送：{AUTO_SHIPPING_IMPLEMENTED ? 'あり' : '実装していません（コードごとありません）'}</li>
          <li>外部サイトの無断巡回：しません</li>
        </ul>
        <p className="small muted">人がやることは4つだけです：{HUMAN_ONLY_ACTIONS_JA.join(' ／ ')}。</p>
      </div>
    </main>
  );
}
