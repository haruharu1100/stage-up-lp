import RunPanel from '@/components/RunPanel';
import { migrate } from '@/lib/db/client';
import { getDashboardCandidates, getRunStatus } from '@/lib/db/queries';
import { capabilities } from '@/lib/env';
import { yen, pct } from '@/lib/format';
import { VERDICT_COLOR, VERDICT_LABEL, aiScorecard, gradeHitRate } from '@/lib/learning/hitRate';

export const dynamic = 'force-dynamic';

export default async function Home() {
  await migrate();
  const [status, candidates, hit, card] = await Promise.all([
    getRunStatus(),
    getDashboardCandidates(),
    gradeHitRate(30),
    aiScorecard(30),
  ]);
  const cap = capabilities();

  return (
    <main className="wrap">
      {/* ---- ★最上部：Aランクの的中率（このシステムが当たっているか）---- */}
      <div className="card">
        <h2>Aランクの的中率（過去{hit.days}日）</h2>
        <p className="desc">
          <strong>このシステムを信じてよいかを、いちばん先に見る数字です。</strong>
          「Aランク（買っていい）と判定した商品が、実際に黒字になったか」を実績だけで数えています。
          予測ではありません。実績が入るまでは「まだ分かりません」と出ます（推測では埋めません）。
        </p>
        <div className="kpis">
          <div className="kpi strong">
            <div className="kpi-label">的中率</div>
            <div className="kpi-value">{hit.hitRate != null ? Math.round(hit.hitRate * 100) : '—'}</div>
            <div className="kpi-note">{hit.hitRate != null ? '％が黒字' : '実績待ち'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Aランクにした商品</div>
            <div className="kpi-value">{hit.gradeACount}</div>
            <div className="kpi-note">件</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">実際に仕入れた</div>
            <div className="kpi-value">{hit.purchasedCount}</div>
            <div className="kpi-note">件</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">黒字になった</div>
            <div className="kpi-value">{hit.profitableCount}</div>
            <div className="kpi-note">件</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">赤字になった</div>
            <div className="kpi-value" style={{ color: hit.lossCount > 0 ? '#b00' : undefined }}>
              {hit.lossCount}
            </div>
            <div className="kpi-note">件</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">平均の予測ズレ</div>
            <div className="kpi-value">
              {hit.avgForecastErrorPct != null ? Math.round(hit.avgForecastErrorPct) : '—'}
            </div>
            <div className="kpi-note">％（利益予測が実績からどれだけ外れたか）</div>
          </div>
        </div>
        <div
          className={
            hit.hitRate == null ? 'notice info' : hit.hitRate < 0.6 ? 'notice warn' : 'notice info'
          }
          style={{ marginTop: 10 }}
        >
          <strong>{hit.headline}</strong>
          <div className="small">{hit.note}</div>
        </div>
        {(hit.forecastProfitJpy != null || hit.actualProfitJpy != null) && (
          <p className="small muted" style={{ marginTop: 8 }}>
            実績が確定した{hit.judgedCount}件の合計：予測利益 {yen(hit.forecastProfitJpy)} ／ 実際の利益{' '}
            {yen(hit.actualProfitJpy)}
          </p>
        )}
      </div>

      {/* ---- AI社員の成績表 ---- */}
      <div className="card">
        <h2>AI社員の成績表（実績にもとづく）</h2>
        <p className="desc">
          誰の判断が当たっていて、誰が外しているかを分けて見ます。
          <strong>点数は全部わり算です。AIが自分を採点することはありません。</strong>
          実績が{3}件に満たないものは、正直に「まだ判定できません」と出します。
        </p>
        <div className="notice info">{card.headline}</div>
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>AI社員</th>
              <th>担当</th>
              <th>点数</th>
              <th>判定</th>
              <th>なにを数えたか</th>
              <th>よくするには</th>
            </tr>
          </thead>
          <tbody>
            {card.agents.map((a) => (
              <tr key={a.key}>
                <td>
                  <strong>{a.name}</strong>
                </td>
                <td className="small muted">{a.role}</td>
                <td>
                  <strong>{a.score != null ? `${a.score}点` : '—'}</strong>
                  <div className="small muted">{a.samples}件で判定</div>
                </td>
                <td className="small">
                  <strong style={{ color: VERDICT_COLOR[a.verdict] }}>{VERDICT_LABEL[a.verdict]}</strong>
                </td>
                <td className="small">{a.basis}</td>
                <td className="small muted">{a.advice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!cap.autoPublish && (
        <div className="notice info">
          <strong>Amazonへの本番出品は止めてあります</strong>（AMAZON_AUTO_PUBLISH=false）。
          出品データは下書きまで作られ、Amazonには送信されません。
        </div>
      )}

      <RunPanel initial={status} />

      <div className="card">
        <h2>本日の候補商品</h2>
        <p className="desc">
          AIが100点満点で採点した順です。ランキング上位だけでなく「売れているのに商品ページが弱い商品」を高く評価します。
          金額は想定値で、実際の仕入価格・手数料で変わります。
        </p>
        {candidates.length === 0 ? (
          <div className="muted">まだ候補がありません。上の「商品を探す」を押してください。</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>順位</th>
                  <th>点</th>
                  <th className="l">商品</th>
                  <th>Amazon価格</th>
                  <th>想定仕入</th>
                  <th>手数料</th>
                  <th>広告費</th>
                  <th>想定利益</th>
                  <th>利益率</th>
                  <th>ランキング</th>
                  <th>レビュー</th>
                  <th>評価</th>
                  <th>競合数</th>
                  <th className="l">販売リスク</th>
                  <th className="l">工程</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.candidateId}>
                    <td>{c.rank}</td>
                    <td className="score">{Math.round(c.scoreTotal)}</td>
                    <td className="l title">
                      <a href={`/products/${c.productId}`}>{c.title}</a>
                      {c.reason && <div className="small muted">{c.reason}</div>}
                    </td>
                    <td>{yen(c.amazonPriceJpy)}</td>
                    <td>{yen(c.supplierPriceJpy)}</td>
                    <td>{yen(c.feeJpy)}</td>
                    <td>{yen(c.adCostJpy)}</td>
                    <td className={(c.profitJpy ?? 0) >= 0 ? 'pos' : 'neg'}>{yen(c.profitJpy)}</td>
                    <td className={(c.profitRate ?? 0) >= 0 ? 'pos' : 'neg'}>{pct(c.profitRate)}</td>
                    <td>{c.bsr ? `${c.bsr.toLocaleString()}位` : '—'}</td>
                    <td>{c.reviewCount?.toLocaleString() ?? '—'}</td>
                    <td>{c.rating ?? '—'}</td>
                    <td>{c.sellerCount ?? '—'}</td>
                    <td className="l">{c.risk}</td>
                    <td className="l">{c.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>いま使える機能</h2>
        <p className="desc">鍵（APIキー）が入っている機能だけ本物で動きます。入っていない部分はサンプルで動作確認できます。</p>
        <div className="agents">
          <Cap title="文章を書くAI" ok={cap.llm.anthropic || cap.llm.openai} on="本物のAIで生成" off="サンプル文で動作確認" />
          <Cap title="商品画像の生成" ok={cap.image.openai} on="OpenAIで生成" off="生成しません（偽物を作らないため）" />
          <Cap title="Amazon市場データ" ok={cap.market.keepa || cap.market.paapi} on="正規APIで取得" off="サンプル／CSV読み込み" />
          <Cap title="紹介動画の生成" ok={cap.video.fal || cap.video.runway} on="動画を生成" off="絵コンテと台本まで" />
          <Cap title="Amazon出品(SP-API)" ok={cap.amazon.spapi} on="接続済み" off="ローカル検証のみ" />
          <Cap title="本番出品スイッチ" ok={cap.autoPublish} on="ON（送信されます）" off="OFF（送信しません）" />
        </div>
      </div>
    </main>
  );
}

function Cap({ title, ok, on, off }: { title: string; ok: boolean; on: string; off: string }) {
  return (
    <div className="agent">
      <div className="name">{title}</div>
      <span className={`badge ${ok ? 'done' : 'idle'}`}>{ok ? '有効' : '未設定'}</span>
      <div className="role">{ok ? on : off}</div>
    </div>
  );
}
