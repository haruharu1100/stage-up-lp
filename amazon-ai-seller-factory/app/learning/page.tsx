import LearningBoard from '@/components/LearningBoard';
import { migrate } from '@/lib/db/client';
import { yen, jstDateTime } from '@/lib/format';
import { categoryBiasList } from '@/lib/learning/categoryBias';
import { accuracyList, overallAccuracy } from '@/lib/learning/forecastAccuracy';
import { failureStats, lateralSeedList } from '@/lib/learning/postmortem';
import { currentWeights, proposalList } from '@/lib/learning/scoreWeights';
import { loadResearchSettings } from '@/lib/research/settings';
import { LATERAL_KIND_LABEL, RESEARCH_SCORE_LABEL, type LateralKind, type ResearchScoreBreakdown } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 実績からの学習。
 * ★重みの変更は提案どまり。承認するまで採点は変わらない。
 * ★実績5件未満では学習を動かさない（少ない実績で数字をいじらない）。
 */
export default async function LearningPage() {
  await migrate();
  const settings = await loadResearchSettings();
  const [accuracy, rows, bias, proposals, weights, failures, seeds] = await Promise.all([
    overallAccuracy(),
    accuracyList(50),
    categoryBiasList(),
    proposalList(20),
    currentWeights(),
    failureStats(),
    lateralSeedList(50),
  ]);

  const weightKeys = Object.keys(weights) as (keyof ResearchScoreBreakdown)[];
  const queued = seeds.filter((s) => String(s.status) === 'queued');

  return (
    <main className="wrap">
      <div className="notice info">
        <strong>ここはシステムが「自分の予測のハズレ具合」を反省する画面です。</strong>
        AIが勝手に採点基準を書き換えることはありません。配点の変更は<strong>あなたが承認したときだけ</strong>反映されます。
      </div>

      {/* ---- 予測はどれくらい当たっているか ---- */}
      <div className="card">
        <h2>予測はどれくらい当たっているか</h2>
        <p className="desc">
          需要（売れる数）・利益・価格を<strong>別々に</strong>採点しています。
          どれが外れているかが分かれば、直すところが分かります。
        </p>
        {accuracy.samples < settings.minSamplesForBias ? (
          <div className="notice warn">
            実績がまだ{accuracy.samples}件です。{settings.minSamplesForBias}
            件たまるまで、精度の数字は出しません（少ないデータで判断すると間違った学習をするためです）。
          </div>
        ) : (
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">実績の件数</div>
              <div className="kpi-value">{accuracy.samples}</div>
              <div className="kpi-note">件</div>
            </div>
            <div className="kpi strong">
              <div className="kpi-label">需要（売れる数）の的中率</div>
              <div className="kpi-value">{accuracy.demand ?? '—'}</div>
              <div className="kpi-note">%</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">利益の的中率</div>
              <div className="kpi-value">{accuracy.profit ?? '—'}</div>
              <div className="kpi-note">%</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">価格の的中率</div>
              <div className="kpi-value">{accuracy.price ?? '—'}</div>
              <div className="kpi-note">%</div>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary className="small">商品ごとの「予測 vs 実績」を見る</summary>
            <table className="table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>カテゴリー</th>
                  <th>予測した月販</th>
                  <th>実際の月販</th>
                  <th>予測した利益</th>
                  <th>実際の利益</th>
                  <th>需要の的中</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)}>
                    <td>{String(r.category || '未分類')}</td>
                    <td>{r.forecast_monthly_sales != null ? `${Number(r.forecast_monthly_sales)}個` : '—'}</td>
                    <td>
                      {r.actual_monthly_sales != null ? `${Math.round(Number(r.actual_monthly_sales))}個` : '—'}
                    </td>
                    <td>{r.forecast_profit_jpy != null ? yen(Number(r.forecast_profit_jpy)) : '—'}</td>
                    <td>{r.actual_profit_jpy != null ? yen(Number(r.actual_profit_jpy)) : '—'}</td>
                    <td>{r.demand_accuracy != null ? `${Math.round(Number(r.demand_accuracy))}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>

      {/* ---- 学習を動かすボタン ---- */}
      <div className="card">
        <h2>学習を動かす</h2>
        <p className="desc">
          カテゴリーごとの「いつも何倍ズレるか」を計算し直したり、採点の配点の見直し案を作ります。
          <strong>提案を作るだけで、勝手には変えません。</strong>
        </p>
        <LearningBoard proposals={proposals} minSamples={settings.minSamplesForBias} />
      </div>

      {/* ---- カテゴリー別の補正 ---- */}
      <div className="card">
        <h2>カテゴリーごとの補正（統計で計算しています）</h2>
        <p className="desc">
          たとえば「キッチン用品はいつも予測の0.7倍しか売れない」なら、次からは0.7倍して見積もります。
          AIの感覚ではなく、あなたの実績の中央値から計算しています。
        </p>
        {!bias.length ? (
          <div className="muted">まだ補正はありません。実績がたまると自動で作られます。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>カテゴリー</th>
                <th>実績件数</th>
                <th>需要の倍率</th>
                <th>利益の倍率</th>
                <th>価格の倍率</th>
                <th>使っているか</th>
              </tr>
            </thead>
            <tbody>
              {bias.map((b) => (
                <tr key={String(b.category)}>
                  <td>{String(b.category)}</td>
                  <td>{Number(b.samples)}件</td>
                  <td>{b.demand_multiplier != null ? `×${Number(b.demand_multiplier).toFixed(2)}` : '—'}</td>
                  <td>{b.profit_multiplier != null ? `×${Number(b.profit_multiplier).toFixed(2)}` : '—'}</td>
                  <td>{b.price_multiplier != null ? `×${Number(b.price_multiplier).toFixed(2)}` : '—'}</td>
                  <td>
                    {Number(b.applied) === 1 ? (
                      <strong>使っています</strong>
                    ) : (
                      <span className="muted">実績が足りないので使いません</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- 今の配点 ---- */}
      <div className="card">
        <h2>今の採点の配点（Research Score）</h2>
        <table className="table">
          <tbody>
            {weightKeys.map((k) => (
              <tr key={String(k)}>
                <th style={{ width: 260, textAlign: 'left' }}>{RESEARCH_SCORE_LABEL[k] ?? String(k)}</th>
                <td>{Math.round(Number(weights[k]))}点</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          この配点は、あなたが承認した提案だけが反映されています。承認していない提案は1点も効いていません。
        </p>
      </div>

      {/* ---- 失敗の分類 ---- */}
      <div className="card">
        <h2>うまくいかなかった理由の内訳</h2>
        <p className="desc">同じ失敗を2回しないために、失敗を10種類に分けて数えています。</p>
        {!failures.total ? (
          <div className="muted">まだ失敗の記録はありません。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>理由</th>
                <th>件数</th>
                <th>損失の合計</th>
                <th>次からの対策</th>
              </tr>
            </thead>
            <tbody>
              {failures.stats.map((s) => (
                <tr key={s.reason}>
                  <td>{s.label}</td>
                  <td>{s.count}件</td>
                  <td>{yen(s.lossJpy)}</td>
                  <td className="small">{s.advice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- 横展開 ---- */}
      <div className="card">
        <h2>売れた商品の周辺を掘る（横展開）</h2>
        <p className="desc">
          1個当たったら、その周辺を掘ります。同じ仕入先の別商品・同じカテゴリー・色違い・サイズ違い・上位モデル・
          セット売り・消耗品など8方向に自動で種をまき、次のリサーチで順番に探します。
        </p>
        {!seeds.length ? (
          <div className="muted">まだ種はありません。売れた商品の実績を入れると作られます。</div>
        ) : (
          <>
            <p className="small">
              未探索の種：<strong>{queued.length}件</strong>（次のリサーチで上から順に探します）
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>掘る方向</th>
                  <th>探す言葉</th>
                  <th>理由</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {seeds.slice(0, 30).map((s) => (
                  <tr key={String(s.id)}>
                    <td>{LATERAL_KIND_LABEL[String(s.kind) as LateralKind] ?? String(s.kind)}</td>
                    <td>{String(s.query)}</td>
                    <td className="small">{String(s.reason || '')}</td>
                    <td className="small">
                      {String(s.status) === 'queued'
                        ? 'これから探します'
                        : `探し済み（${Number(s.found)}件見つかりました／${
                            s.explored_at ? jstDateTime(String(s.explored_at)) : ''
                          }）`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </main>
  );
}
