import { migrate } from '../lib/db/client';
import { buildDashboard } from '../lib/dashboard';
import { CATEGORY_LABEL, type Category, type Grade, type JapanStage } from '../lib/types';
import { STAGE_LABEL } from '../lib/japan';

export const dynamic = 'force-dynamic';

const GRADE_LABEL: Record<Grade, string> = {
  S: 'S 最優先',
  A: 'A 事業化候補',
  B: 'B 保留',
  C: 'C 見送り',
  REJECT: '却下',
  INSUFFICIENT_DATA: '判定不能',
};

const TREND_LABEL: Record<string, string> = {
  GROWING: '伸びている',
  FLAT: '横ばい',
  DECLINING: '減っている',
  INSUFFICIENT_DATA: '判定不能',
};

const SALES_LABEL: Record<string, string> = {
  PASS: '合格',
  FAIL: '不合格',
  INSUFFICIENT_DATA: '判定不能',
};

function yen(n: number) {
  return `${n.toLocaleString()}円`;
}

function rateText(r: { rate: number | null; status: string; denominator: number }) {
  if (r.status !== 'OK') return `判定不能（母数${r.denominator}件）`;
  return `${Math.round((r.rate ?? 0) * 1000) / 10}%`;
}

export default async function Page() {
  await migrate();
  const d = await buildDashboard();

  return (
    <main>
      <h1>AI BUSINESS OS</h1>
      <p className="sub">
        海外AIビジネスを発掘 → 日本市場評価 → 100点採点 → バックテスト → 商品化 → 販売 → 計測 → 学習
      </p>

      <div className="flags">
        {Object.entries(d.outboundFlags).map(([k, v]) => (
          <span key={k} className={`flag ${v ? 'on' : 'off'}`}>
            {k}: {String(v)}
            {v ? ' ⚠' : ''}
          </span>
        ))}
      </div>

      <h2>今日やること</h2>
      {d.recommendations.length === 0 ? (
        <p className="empty">推奨アクションはありません。</p>
      ) : (
        d.recommendations.map((r) => (
          <div className="card" key={r.rank}>
            <div className="rec-title">
              {r.rank}. {r.action}
            </div>
            <div className="rec-meta">
              <span>理由</span>
              <b>{r.why}</b>
              <span>根拠</span>
              <b>{r.evidence}</b>
              <span>信頼度</span>
              <b>{r.confidence}</b>
              <span>必要コスト</span>
              <b>{yen(r.costYen)}</b>
              <span>期待効果</span>
              <b>{r.expectedEffect}</b>
              <span>リスク</span>
              <b>{r.risk}</b>
              <span>データ量</span>
              <b>{r.dataVolume}</b>
            </div>
          </div>
        ))
      )}

      <h2>収益</h2>
      <div className="kpis">
        <div className="kpi">
          <div className="label">本日の売上</div>
          <div className="value">{yen(d.today.revenueYen)}</div>
        </div>
        <div className="kpi">
          <div className="label">7日</div>
          <div className="value">{yen(d.last7.revenueYen)}</div>
        </div>
        <div className="kpi">
          <div className="label">30日</div>
          <div className="value">{yen(d.last30.revenueYen)}</div>
        </div>
        <div className="kpi">
          <div className="label">累計</div>
          <div className="value">{yen(d.allTime.revenueYen)}</div>
        </div>
        <div className="kpi">
          <div className="label">MRR</div>
          <div className="value">{yen(d.saas.mrrYen)}</div>
          <div className="note">ARR {yen(d.saas.arrYen)}</div>
        </div>
        <div className="kpi">
          <div className="label">LTV ÷ CAC</div>
          <div className="value">{d.saas.ltvCac ?? '—'}</div>
          <div className="note">{d.saas.ltvCac === null ? 'データ不足で算出しない' : '目標 3以上'}</div>
        </div>
        <div className="kpi">
          <div className="label">回収期間</div>
          <div className="value">{d.saas.paybackMonths === null ? '—' : `${d.saas.paybackMonths}ヶ月`}</div>
        </div>
        <div className="kpi">
          <div className="label">解約率</div>
          <div className="value">{rateText(d.saas.churnRate)}</div>
        </div>
      </div>

      <h2>ファネル（直近30日）</h2>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <th>Xクリック</th>
              <td>{d.last30.counts.X_CLICK}</td>
              <th>note到達</th>
              <td>{d.last30.counts.NOTE_VIEW}</td>
              <th>note購入</th>
              <td>{d.last30.counts.NOTE_PURCHASE}</td>
            </tr>
            <tr>
              <th>デモ開始</th>
              <td>{d.last30.counts.DEMO_START}</td>
              <th>デモ完了</th>
              <td>{d.last30.counts.DEMO_COMPLETE}</td>
              <th>問い合わせ</th>
              <td>{d.last30.counts.LEAD}</td>
            </tr>
            <tr>
              <th>商談</th>
              <td>{d.last30.counts.MEETING}</td>
              <th>契約</th>
              <td>{d.last30.counts.CONTRACT}</td>
              <th>解約</th>
              <td>{d.last30.counts.CHURN}</td>
            </tr>
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
          note購入率 {rateText(d.last30.noteViewToPurchase)} ／ デモ→商談 {rateText(d.last30.demoToMeeting)} ／ 商談→契約{' '}
          {rateText(d.last30.meetingToContract)}
        </p>
      </div>

      <h2>TOP AI BUSINESS OPPORTUNITIES</h2>
      <p className="sub">
        「面白いAI」ではなく「実際に金になる候補」を上から並べています。並び順は Money Score × 確度。
        調べられていない案件が上に来ないようにするため、確度の低い案件は順位が下がります。
        数字が取れていない欄は空欄（—）です。埋めるために推測はしていません。
      </p>
      <div className="card">
        {d.opportunities.length === 0 ? (
          <p className="empty">
            まだ候補がありません。<code>npm run collect</code> のあと <code>npm run pipeline</code> を実行してください。
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>事業名</th>
                <th>海外</th>
                <th>日本市場</th>
                <th>機会</th>
                <th>事業性</th>
                <th>Money</th>
                <th>確度</th>
                <th>価格候補</th>
                <th>LTV÷CAC</th>
                <th>12ヶ月利益<br />中央値</th>
                <th>赤字確率</th>
                <th>推奨販売</th>
                <th>note適性</th>
                <th>SaaS適性</th>
                <th>次アクション</th>
              </tr>
            </thead>
            <tbody>
              {d.opportunities.map((o) => (
                <tr key={o.ideaId}>
                  <td>{o.rank}</td>
                  <td>
                    <a href={o.sourceUrl} target="_blank" rel="noreferrer">
                      {o.title.slice(0, 46)}
                    </a>
                  </td>
                  <td>{o.overseasTrend}</td>
                  <td>{o.japanState}</td>
                  <td>{o.opportunityScore ?? '—'}</td>
                  <td>{o.viability100 ?? '—'}</td>
                  <td>
                    <b>{o.money100 ?? '—'}</b>
                  </td>
                  <td>{o.confidence ?? '—'}</td>
                  <td>{o.priceCandidateYen === null ? '—' : yen(o.priceCandidateYen)}</td>
                  <td>{o.ltvCac ?? '—'}</td>
                  <td>{o.netProfitYear1Median === null ? '—' : yen(Math.round(o.netProfitYear1Median))}</td>
                  <td>{o.lossProbability === null ? '—' : `${Math.round(o.lossProbability * 100)}%`}</td>
                  <td>{o.recommendedChannel}</td>
                  <td>{o.paidNoteFit ?? '—'}</td>
                  <td>{o.saasFit ?? '—'}</td>
                  <td>{o.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>上位5件｜なぜ日本で今やる価値があるのか</h2>
      {d.opportunities.slice(0, 5).map((o) => (
        <div className="card" key={`why-${o.ideaId}`}>
          <div className="rec-title">
            {o.rank}. {o.title}
          </div>
          <p style={{ margin: '8px 0 0', lineHeight: 1.8 }}>{o.whyJapanNow}</p>
          {o.regulatory ? (
            <p className="sub" style={{ marginBottom: 0 }}>
              ⚠ 要専門家確認: {o.regulatory}
            </p>
          ) : null}
        </div>
      ))}

      <h2>どの海外ネタから何円生まれたか</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          最重要データです。まだ1件も公開していない案件は「未計測」であって「成果ゼロ」ではありません。
        </p>
        {d.attribution.map((a) => (
          <div key={a.ideaId} style={{ fontSize: 12, padding: '4px 0' }}>
            {a.chain}
          </div>
        ))}
      </div>

      <h2>
        全案件（{d.ideaCount}件中 採点済み {d.scoredCount}件）
      </h2>
      <div className="card">
        {d.ideas.length === 0 ? (
          <p className="empty">
            まだ案件がありません。<code>npm run collect</code> で海外から収集してください。
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>点数</th>
                <th>判定</th>
                <th>案件</th>
                <th>ジャンル</th>
                <th>日本</th>
                <th>海外の伸び</th>
                <th>販売検証</th>
              </tr>
            </thead>
            <tbody>
              {d.ideas.slice(0, 30).map((i) => (
                <tr key={i.id}>
                  <td>{i.normalized100 ?? '—'}</td>
                  <td>
                    <span
                      className={`badge ${i.grade === 'S' ? 's' : i.grade === 'A' ? 'a' : i.grade === 'REJECT' ? 'bad' : 'none'}`}
                    >
                      {i.grade ? (GRADE_LABEL[i.grade as Grade] ?? i.grade) : '未採点'}
                    </span>
                  </td>
                  <td>
                    <a href={i.source_url} target="_blank" rel="noreferrer">
                      {i.title.slice(0, 60)}
                    </a>
                    <div className="note" style={{ fontSize: 11, color: 'var(--muted)' }}>
                      出典: {i.source_name}
                    </div>
                  </td>
                  <td>{CATEGORY_LABEL[i.category as Category] ?? i.category}</td>
                  <td>{i.japan_stage ? (STAGE_LABEL[i.japan_stage as JapanStage] ?? i.japan_stage) : '未調査'}</td>
                  <td>{i.market_trend ? (TREND_LABEL[i.market_trend] ?? i.market_trend) : '未計測'}</td>
                  <td>{i.sales_verdict ? (SALES_LABEL[i.sales_verdict] ?? i.sales_verdict) : '未実施'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>操作</h2>
      <div className="card">
        <p className="sub" style={{ margin: 0 }}>
          <code>npm run collect</code> 海外から収集 ／ <code>npm run evaluate</code> 採点 ／{' '}
          <code>npm run backtest</code> バックテスト ／ <code>npm run productize -- idea_xxx</code> 商品化 ／{' '}
          <code>npm run obsidian</code> Obsidianへ保存
        </p>
      </div>
    </main>
  );
}
