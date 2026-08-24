import AnomalyBoard, { type AnomalyRow } from '@/components/AnomalyBoard';
import ApproveButton from '@/components/ApproveButton';
import ResearchPanel from '@/components/ResearchPanel';
import { all, parseJson } from '@/lib/db/client';
import { migrate } from '@/lib/db/client';
import { config, secret } from '@/lib/env';
import { yen, pct, jstDateTime } from '@/lib/format';
import { getAmazonSearchProvider } from '@/lib/providers/amazonSearch';
import { getEmbeddingProvider } from '@/lib/providers/embedding';
import { getNotificationProvider, recentNotifications } from '@/lib/providers/notification';
import { supplierProviderStatus } from '@/lib/providers/supplier';
import {
  DISCOVERY_MODE_LABEL,
  discoveryProviderStatus,
  discoveryLiveReady,
  discoveryLiveReadyReason,
  type DiscoveryMode,
  type DiscoveryProviderStatus,
} from '@/lib/providers/supplierDiscovery';
import { discoveryRejectionSummary } from '@/lib/research/discoveryRun';
// ★「0件」と「失敗」を画面で区別するための集計
import { outcomeSummary, OUTCOME_LABEL } from '@/lib/research/discoveryOutcome';
import { latestKpi, KPI_LABEL, kpiValueText, type DiscoveryKpi } from '@/lib/research/discoveryKpi';
import { REJECT_REASON_LABEL, type DiscoveryRejectReason } from '@/lib/research/discoveryFilter';
import { getVisionProvider } from '@/lib/providers/vision';
import { imageDecoderAvailable } from '@/lib/matching/imageHash';
import {
  isStrongPickValues,
  latestResearchRun,
  oemCandidateList,
  researchCandidatesOf,
  watchListCandidates,
} from '@/lib/research/pipeline';
import { loadResearchSettings } from '@/lib/research/settings';
import {
  MATCH_SCORE_LABEL,
  MATCH_SCORE_MAX,
  MATCH_VERDICT_LABEL,
  RESEARCH_SCORE_LABEL,
  RESEARCH_SCORE_MAX,
  SALES_BASIS_LABEL,
  GRADE_LABEL,
  type Grade,
  type MatchScoreBreakdown,
  type MatchVerdict,
  type ResearchScoreBreakdown,
  type SalesBasis,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D'];

export default async function ResearchPage() {
  await migrate();
  const settings = await loadResearchSettings();
  const runRow = await latestResearchRun();
  const rows = runRow ? await researchCandidatesOf(String(runRow.id), { limit: 300 }) : [];
  const [watching, oem, notes] = await Promise.all([
    watchListCandidates(30),
    oemCandidateList(20),
    recentNotifications(5),
  ]);
  const decoderOk = await imageDecoderAvailable();

  // ---- 異常データ（DATA_ANOMALY）------------------------------------
  const anomalyRows: AnomalyRow[] = (
    await all(
      `SELECT id, asin, amazon_title, supplier, supplier_title, amazon_price_jpy, supplier_price_jpy,
              monthly_sales_est, bsr, seller_count, anomaly_level, anomaly_items, anomaly_summary,
              anomaly_cleared_at, anomaly_cleared_by, anomaly_cleared_note, created_at
         FROM research_candidates
        WHERE anomaly = 1
        ORDER BY (anomaly_cleared_at IS NOT NULL), created_at DESC
        LIMIT 100`,
    )
  ).map((r: any) => ({
    id: String(r.id),
    asin: r.asin ? String(r.asin) : null,
    amazonTitle: r.amazon_title ? String(r.amazon_title) : null,
    supplier: r.supplier ? String(r.supplier) : null,
    supplierTitle: r.supplier_title ? String(r.supplier_title) : null,
    amazonPriceJpy: r.amazon_price_jpy != null ? Number(r.amazon_price_jpy) : null,
    supplierPriceJpy: r.supplier_price_jpy != null ? Number(r.supplier_price_jpy) : null,
    monthlySalesEst: r.monthly_sales_est != null ? Number(r.monthly_sales_est) : null,
    bsr: r.bsr != null ? Number(r.bsr) : null,
    sellerCount: r.seller_count != null ? Number(r.seller_count) : null,
    summary: r.anomaly_summary ? String(r.anomaly_summary) : null,
    level: r.anomaly_level ? String(r.anomaly_level) : null,
    items: parseJson<AnomalyRow['items']>(r.anomaly_items, []),
    clearedAt: r.anomaly_cleared_at ? String(r.anomaly_cleared_at) : null,
    clearedBy: r.anomaly_cleared_by ? String(r.anomaly_cleared_by) : null,
    clearedNote: r.anomaly_cleared_note ? String(r.anomaly_cleared_note) : null,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
  const anomalyOpen = anomalyRows.filter((r) => !r.clearedAt).length;

  // ★本番テストモード（Keepaの鍵がある時だけ意味を持つ）
  const keepaReady = !!secret('KEEPA_API_KEY');
  const liveTestOn = config.liveTestMode && keepaReady;

  const suppliers = supplierProviderStatus();

  // ★仕入先の自動探索（システムが自分で商品を探す）の状態と、直近の結果
  const discoveryProviders = discoveryProviderStatus();
  // ★以前はここで「鍵が入っている＝自動探索できる」と表示していましたが、それは誤りでした。
  //   ユーザー指示の4段階（存在確認→権限→認証成功→実商品取得）を全部通った時だけ「できる」と出します。
  //   コードがあるだけ・鍵があるだけを、完成扱いにしません。
  const discoveryReady = await discoveryLiveReady();
  const discoveryReadyReason = await discoveryLiveReadyReason();
  const discoveryRejects = runRow ? await discoveryRejectionSummary(String(runRow.id)) : [];
  // ★「0件だった」と「そもそも失敗していた」を画面で必ず見分けられるようにする
  const discoveryOutcomes = await outcomeSummary(7).catch(() => null);
  // ★Discovery KPI 10項目（数えていない項目は 0 ではなく「まだ出せません」と出す）
  const discoveryKpi = await latestKpi().catch(() => null);

  // ★仕入先データが本物かどうかを集計する。
  //   「SUPPLIER DATA: LIVE」と出してよいのは、実際に仕入先から取れている時だけ。
  const supplierTally = { LIVE: 0, ESTIMATED: 0, UNKNOWN: 0, MOCK: 0 } as Record<string, number>;
  for (const r of rows) {
    const q = String(r.supplier_data_quality || 'UNKNOWN');
    if (supplierTally[q] === undefined) supplierTally.UNKNOWN += 1;
    else supplierTally[q] += 1;
  }
  // 実データを取れる入口が「今つながっているか」（まだ1回も調べていない時の表示に使う）
  const supplierLiveNow = suppliers.some((s) => s.isReal && s.enabled && s.name !== 'sample');

  const amazon = getAmazonSearchProvider();
  const emb = getEmbeddingProvider();
  const vis = getVisionProvider();
  const notifier = getNotificationProvider();

  // 「強い推奨」の条件はパイプラインと同じ関数を使う（画面と件数が食い違わないように）
  const strong = rows
    .filter((r) =>
      isStrongPickValues(
        {
          grade: String(r.grade),
          score: Number(r.research_score) || 0,
          riskCount: parseJson<string[]>(r.risks, []).length,
          salesUnits: Number(r.monthly_sales_est) || 0,
          netProfitJpy: Number(r.net_profit_jpy) || 0,
        },
        settings,
      ),
    )
    .slice(0, 3);

  return (
    <main className="wrap">
      <div className="notice info">
        <strong>この画面は「探して並べる」だけです。</strong>
        仕入れの発注も、Amazonへの出品も、ここからは実行されません（AUTO_PURCHASE=
        {String(config.autoPurchase)} / RESEARCH_AUTO_APPROVE={String(config.researchAutoApprove)}）。
        仕入れは必ずご自身の承認で行ってください。
      </div>

      {/* ★本番テストモード：いきなり大量にAPIを叩かないための安全弁 */}
      {liveTestOn && (
        <div className="notice warn">
          <strong>本番テストモード中です（1回に{config.liveTestLimit}商品まで）。</strong>
          Keepaの本番データを使い始めた直後なので、わざと少数だけ調べます。
          結果に問題が無いと確認できたら、<code>LIVE_TEST_LIMIT</code> を 20 → 50 → 100 と手で上げてください。
          いきなり数千商品を取りにいくことはありません。
        </div>
      )}
      {anomalyOpen > 0 && (
        <div className="notice err">
          <strong>おかしなデータが{anomalyOpen}件あります。</strong>
          その商品は仕入判断から外しています（Aランクにも承認にも進めません）。
          このページ下の「異常データ」で中身を確認してください。
        </div>
      )}

      {/* ★仕入先データが本物かどうか。ここがLIVEでなければ利益計算は信用できない */}
      <SupplierDataBanner tally={supplierTally} live={supplierLiveNow} />

      {/* ★自動探索：商品一覧を作らなくても、システムが自分で探せる状態か */}
      <DiscoveryBoard
        providers={discoveryProviders}
        ready={discoveryReady}
        readyReason={discoveryReadyReason}
        run={runRow}
        rejects={discoveryRejects}
        outcomes={discoveryOutcomes}
        kpi={discoveryKpi}
      />

      {/* ================= 今日のおすすめ仕入候補 ================= */}
      <div className="card">
        <h2>今日のおすすめ仕入候補</h2>
        {!runRow ? (
          <div className="muted">
            まだリサーチしていません。下の「リサーチを開始する」を押すと、仕入先の商品を集めてAmazonと突き合わせます。
          </div>
        ) : (
          <>
            {/* ★本番データかサンプルかを、まず最初に大きく出す */}
            {Number(runRow.live_data) === 1 || String(runRow.data_source) === 'live' ? (
              <div className="notice info" style={{ marginBottom: 10 }}>
                <span className="livebadge">LIVE DATA</span>{' '}
                <strong>本番データです。</strong>
                {runRow.provider_name ? `（${String(runRow.provider_name)}）` : ''}
                実際のAmazonの価格・売れ行きをもとに計算しています。
              </div>
            ) : (
              <div className="notice warn" style={{ marginBottom: 10 }}>
                <span className="samplebadge">サンプルデータ</span>{' '}
                <strong>これは練習用の仮データです。この数字で仕入れを判断しないでください。</strong>
                KEEPA_API_KEY を設定すると、次のリサーチから自動で LIVE DATA に切り替わります。
              </div>
            )}
            {Number(runRow.mixed_data_blocked) > 0 && (
              <div className="notice err" style={{ marginBottom: 10 }}>
                ★本番データとサンプルデータが混ざりかけたため、{Number(runRow.mixed_data_blocked)}件を自動で捨てました。
                混ざったまま計算することはありません。
              </div>
            )}

            <div className="kpis">
              <Kpi label="本日調査した商品" value={runRow.surveyed} note="件" />
              <Kpi label="Amazon一致候補" value={runRow.amazon_matched} note="件" />
              <Kpi label={`月${runRow.min_monthly_sales}個以上`} value={runRow.sales_passed} note="件" />
              <Kpi label="利益条件クリア" value={runRow.profit_passed} note="件" />
              <Kpi label="Aランク" value={runRow.grade_a} note="件" />
              <Kpi label="今日の強い推奨" value={runRow.strong_picks} note="件" strong />
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              実行日時 {jstDateTime(String(runRow.started_at))}／データ元{' '}
              {parseJson<string[]>(runRow.sources, []).join('・')}／この実行で使ったAI課金は{' '}
              <strong>{runRow.paid_ai_calls}回</strong> です。
              {runRow.est_cost_jpy != null && (
                <>
                  {' '}
                  この実行にかかったAPI代の目安は <strong>{yen(Number(runRow.est_cost_jpy))}</strong>
                  （Keepa {Number(runRow.keepa_calls ?? 0)}回／OpenAI {Number(runRow.openai_calls ?? 0)}回）です。
                </>
              )}
            </p>
            {parseJson<string[]>(runRow.notes, []).map((n, i) => (
              <div key={i} className="notice warn" style={{ marginTop: 8 }}>
                {n}
              </div>
            ))}

            {strong.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <h3>この{strong.length}件だけ見れば判断できます</h3>
                {strong.map((r) => (
                  <StrongPick key={String(r.id)} r={r} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ResearchPanel settings={settings} />

      {/* ================= 異常データ（仕入判断から外したもの） ============ */}
      <AnomalyBoard rows={anomalyRows} />

      {/* ================= ランク別の結果 ================= */}
      {GRADE_ORDER.map((g) => {
        const list = rows.filter((r) => r.grade === g);
        if (!list.length) return null;
        return (
          <div className="card" key={g}>
            <h2>
              {g}ランク：{GRADE_LABEL[g]}（{list.length}件）
            </h2>
            {list.map((r) => (
              <CandidateCard key={String(r.id)} r={r} />
            ))}
          </div>
        );
      })}

      {/* ================= 値下がり待ちの監視 ================= */}
      <div className="card">
        <h2>値下がり・競合減を見張っている商品</h2>
        <p className="desc">
          今は条件に届かないB・Cランクです。「あといくら下がればAになるか」を毎回計算し直し、
          条件を満たした瞬間にAランクへ上げます。
        </p>
        {!watching.length ? (
          <div className="muted">監視中の商品はまだありません。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>ランク</th>
                <th>今の仕入値</th>
                <th>いくらまで下がればAか</th>
                <th>Amazon価格がいくらになればAか</th>
              </tr>
            </thead>
            <tbody>
              {watching.map((r) => (
                <tr key={String(r.id)}>
                  <td>{String(r.supplier_title).slice(0, 40)}</td>
                  <td>{String(r.grade)}</td>
                  <td>{yen(Number(r.supplier_price_jpy))}</td>
                  <td>
                    {r.trigger_supplier_price_jpy != null ? (
                      <strong>{yen(Number(r.trigger_supplier_price_jpy))}以下</strong>
                    ) : (
                      <span className="muted">仕入値だけでは届きません</span>
                    )}
                  </td>
                  <td>
                    {r.trigger_sell_price_jpy != null ? (
                      <strong>{yen(Number(r.trigger_sell_price_jpy))}以上</strong>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ================= OEM候補 ================= */}
      <div className="card">
        <h2>OEM候補（自社商品を作る候補）</h2>
        <p className="desc">
          需要はあるのに、既存商品の評価が低い＝同じ不満が多い商品です。転売候補とは別に貯めています。
        </p>
        {!oem.length ? (
          <div className="muted">OEM候補はまだありません。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>推定月販</th>
                <th>Amazon価格</th>
                <th>評価</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {oem.map((o) => (
                <tr key={String(o.id)}>
                  <td>{String(o.title).slice(0, 40)}</td>
                  <td>約{Number(o.monthly_sales_est).toLocaleString()}個</td>
                  <td>{yen(Number(o.amazon_price_jpy))}</td>
                  <td>{o.rating ?? '—'}</td>
                  <td className="small">{String(o.reason || '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ================= 今この機能で何が本物か ================= */}
      <div className="card">
        <h2>今つながっているもの／まだ仮のもの</h2>
        <p className="desc">
          鍵を入れた瞬間に本データへ切り替わります。仮のところは「仮です」と必ず表示します。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>役割</th>
              <th>今の状態</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.name}>
                <td>仕入先：{s.name}</td>
                <td>
                  <ReadinessTag kind={s.readiness} />
                  <br />
                  {s.enabled ? <strong className="small">使用中</strong> : <span className="muted small">未使用</span>}
                </td>
                <td className="small">
                  {s.readinessReason}
                  {s.needs ? (
                    <>
                      <br />
                      <span className="muted">必要なもの：{s.needs}</span>
                    </>
                  ) : null}
                </td>
            </tr>
            ))}
            <tr>
              <td>Amazon商品検索</td>
              <td>{amazon.isReal ? <strong>本データ（{amazon.name}）</strong> : <span className="muted">仮（サンプル）</span>}</td>
              <td className="small">{amazon.note}</td>
            </tr>
            <tr>
              <td>画像の一致判定（pHash）</td>
              <td>{decoderOk ? <strong>本物</strong> : <span className="muted">使えません</span>}</td>
              <td className="small">
                {decoderOk
                  ? '画像を実際に読み込んでハッシュ化して比べます。AI料金はかかりません'
                  : '画像デコーダ（jimp）が読み込めていません'}
              </td>
            </tr>
            <tr>
              <td>意味の近さ（Embedding）</td>
              <td>{emb.isReal ? <strong>本データ</strong> : <span className="muted">未接続</span>}</td>
              <td className="small">
                {emb.isReal
                  ? `${emb.model}。判定が割れた候補にだけ使います`
                  : 'OPENAI_API_KEY が無いため使いません（推測で「似ている」とは言いません）'}
              </td>
            </tr>
            <tr>
              <td>画像の最終確認（AI Vision）</td>
              <td>{vis.isReal ? <strong>本データ</strong> : <span className="muted">未接続</span>}</td>
              <td className="small">
                {vis.isReal
                  ? `${vis.model}。1回の実行で最大${settings.maxVisionCalls}回まで`
                  : 'OPENAI_API_KEY が無いため使いません。分からないものは「分からない」と表示します'}
              </td>
            </tr>
            <tr>
              <td>通知</td>
              <td>{notifier.isReal ? <strong>{notifier.name}</strong> : <span className="muted">画面内のみ</span>}</td>
              <td className="small">{notifier.note}</td>
            </tr>
          </tbody>
        </table>

        {notes.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>最近のお知らせ</h3>
            <ul className="small">
              {notes.map((n) => (
                <li key={String(n.id)}>
                  {jstDateTime(String(n.created_at))}｜{String(n.title)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function Kpi({ label, value, note, strong }: { label: string; value: any; note: string; strong?: boolean }) {
  return (
    <div className={strong ? 'kpi strong' : 'kpi'}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{Number(value ?? 0)}</div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}

/**
 * 今日の強い推奨カード。
 * 「なぜ良いか／何個買うか／最悪ケース／予想利益／予想売り切り期間」を必ず全部出す。
 */
function StrongPick({ r }: { r: Record<string, any> }) {
  const qtyReasons = parseJson<string[]>(r.qty_reasons, []);
  const worst = parseJson<{ monthlySales?: number; sellDays?: number; tiedUpCashJpy?: number; note?: string }>(
    r.qty_worst_case,
    {},
  );
  const warnings = parseJson<string[]>(r.failure_warnings, []);
  const qty = Number(r.recommended_qty ?? 0);
  const profitEach = Number(r.net_profit_jpy ?? 0);

  return (
    <div className="notice info" style={{ marginTop: 8 }}>
      <strong>{String(r.amazon_title).slice(0, 60)}</strong>
      {r.confidence != null && <span className="small"> ／ 信頼度 {Number(r.confidence)}%</span>}
      <div style={{ marginTop: 4 }}>{String(r.recommendation)}</div>
      <table className="table" style={{ marginTop: 8 }}>
        <tbody>
          <Row label="なぜ良いか" value={parseJson<string[]>(r.grade_reasons, []).join('／') || '—'} />
          <Row
            label="何個買うか（推奨）"
            value={
              qty > 0 ? (
                <>
                  <strong>{qty}個</strong>
                  <div className="small muted">{qtyReasons.join('／')}</div>
                </>
              ) : (
                <span className="muted">計算できていません（数量が出るまで承認しないでください）</span>
              )
            }
          />
          <Row
            label="予想利益（この個数を売り切ったとき）"
            value={qty > 0 ? <strong>{yen(profitEach * qty)}</strong> : '—'}
          />
          <Row
            label="予想売り切り期間"
            value={r.est_selldays != null ? `約${Number(r.est_selldays)}日` : <span className="muted">不明</span>}
          />
          <Row
            label="最悪ケース（売れ行きが半分だったら）"
            value={
              worst.sellDays != null ? (
                <>
                  約{worst.sellDays}日かかり、<strong>{yen(Number(worst.tiedUpCashJpy ?? 0))}</strong>が在庫として寝ます
                  <div className="small muted">{worst.note ?? ''}</div>
                </>
              ) : (
                <span className="muted">計算できていません</span>
              )
            }
          />
          {warnings.length > 0 && <Row label="過去の失敗からの注意" value={warnings.join('／')} />}
        </tbody>
      </table>
      <ApproveButton
        candidateId={String(r.id)}
        defaultQty={qty}
        title={String(r.amazon_title || r.supplier_title || '')}
        alreadyApproved={String(r.approval_status || '') === 'approved'}
      />
    </div>
  );
}

function CandidateCard({ r }: { r: Record<string, any> }) {
  const matchBd = parseJson<MatchScoreBreakdown>(r.match_breakdown, {
    image: 0,
    identifier: 0,
    title: 0,
    size: 0,
    colorSpec: 0,
    other: 0,
  });
  const scoreBd = parseJson<ResearchScoreBreakdown>(r.score_breakdown, {
    demand: 0,
    profit: 0,
    matchAccuracy: 0,
    weakCompetition: 0,
    priceGap: 0,
    priceStability: 0,
    supplyStability: 0,
    listingUpside: 0,
    lowRisk: 0,
  });
  const stages = parseJson<{ stage: string; cost: string; passed: boolean; detail: string }[]>(r.match_stages, []);
  const cost = parseJson<Record<string, any>>(r.cost_detail, {});
  const risks = parseJson<string[]>(r.risks, []);
  const tags = parseJson<string[]>(r.hidden_gem_tags, []);
  const gradeReasons = parseJson<string[]>(r.grade_reasons, []);
  const scoreReasons = parseJson<string[]>(r.score_reasons, []);
  const basis = String(r.monthly_sales_basis) as SalesBasis;
  const verdict = String(r.match_verdict) as MatchVerdict;

  // ---- 第3段階：鮮度・信頼度・仕入数量 ----
  const confBd = parseJson<Record<string, number>>(r.confidence_breakdown, {});
  const confReasons = parseJson<string[]>(r.confidence_reasons, []);
  const freshParts = parseJson<{ field: string; label: string }[]>(r.freshness_parts, []);
  const unknownFields = parseJson<string[]>(r.unknown_fields, []);
  const qtyReasons = parseJson<string[]>(r.qty_reasons, []);
  const qtyWorst = parseJson<{ monthlySales?: number; sellDays?: number; tiedUpCashJpy?: number; note?: string }>(
    r.qty_worst_case,
    {},
  );
  const warnings = parseJson<string[]>(r.failure_warnings, []);
  const bsrHistory = parseJson<number[]>(r.bsr_history, []);
  const qty = Number(r.recommended_qty ?? 0);
  const isLive = Number(r.live_data) === 1 || String(r.data_source) === 'live';

  return (
    <details className="cand" style={{ borderTop: '1px solid #e6e6e6', padding: '12px 0' }}>
      <summary>
        <span className={isLive ? 'livebadge' : 'samplebadge'}>{isLive ? 'LIVE' : 'サンプル'}</span>{' '}
        <SupplierQualityTag kind={String(r.supplier_data_quality || 'UNKNOWN')} />{' '}
        <strong>{String(r.amazon_title).slice(0, 70)}</strong>
        <span className="small muted">
          {' '}
          ／ Research Score <strong>{r.research_score}</strong> ／ 一致 {r.match_score} ／ 1個
          {yen(Number(r.net_profit_jpy))} ／ {salesText(basis, Number(r.monthly_sales_est))}
          {r.confidence != null && ` ／ ${String(r.grade)}ランク Confidence ${Number(r.confidence)}%`}
          {Number(r.stale) === 1 && ' ／ ★データが古い'}
        </span>
      </summary>

      <div style={{ marginTop: 10 }}>
        <p>{String(r.recommendation)}</p>

        {/*
          ★「仕入先を見る」ボタン（ユーザー指示）
            押したら実際の購入ページへ直接飛べること。
            URLはAPIが返した値だけを通しており、商品IDから組み立てていません。
            そのため「無い」ときは正直に無いと出します（それらしいURLを作らない）。
        */}
        <SupplierLinkButton url={r.supplier_url} />

        <table className="table">
          <tbody>
            <Row label="仕入先の商品名" value={String(r.supplier_title)} />
            <Row label="仕入先名" value={String(r.supplier)} />
            <Row
              label="仕入先URL（購入ページ）"
              value={
                r.supplier_url ? (
                  <a href={String(r.supplier_url)} target="_blank" rel="noreferrer">
                    開く
                  </a>
                ) : (
                  <span className="small">
                    取れていません（推測でURLは作りません。この商品はAランクにしません）
                  </span>
                )
              }
            />
            <Row label="仕入先の画像" value={imgCell(r.supplier_image)} />
            {/* ★仕入先データが本物かどうか。ここが LIVE でなければ「本物の仕入値」として扱わない */}
            <Row
              label="仕入先データの状態"
              value={
                <>
                  <SupplierQualityTag kind={String(r.supplier_data_quality || 'UNKNOWN')} />{' '}
                  <span className="small">{String(r.supplier_quality_note || '不明')}</span>
                  {(() => {
                    const uf = parseJson<string[]>(r.supplier_unknown_fields, []);
                    return uf.length > 0 ? (
                      <div className="small muted">取れていない項目：{uf.join(' / ')}（推測では埋めていません）</div>
                    ) : null;
                  })()}
                </>
              }
            />
            <Row
              label="仕入先の在庫数"
              value={r.supplier_stock != null ? `${Number(r.supplier_stock)}個` : <span className="muted">不明</span>}
            />
            <Row
              label="仕入先データの更新日時"
              value={r.supplier_updated_at ? String(r.supplier_updated_at) : <span className="muted">不明</span>}
            />
            <Row label="Amazonの商品名" value={String(r.amazon_title)} />
            <Row label="ASIN" value={String(r.asin)} />
            <Row
              label="Amazon URL"
              value={<a href={String(r.amazon_url)} target="_blank" rel="noreferrer">開く</a>}
            />
            <Row label="Amazonの画像" value={imgCell(r.amazon_image)} />
            <Row
              label="MATCH SCORE"
              value={
                <>
                  <strong>{r.match_score} / 100</strong>（{MATCH_VERDICT_LABEL[verdict] ?? verdict}）
                  <div className="small muted">
                    {(Object.keys(MATCH_SCORE_MAX) as (keyof MatchScoreBreakdown)[])
                      .map((k) => `${MATCH_SCORE_LABEL[k]} ${Math.round(matchBd[k])}/${MATCH_SCORE_MAX[k]}`)
                      .join('｜')}
                  </div>
                </>
              }
            />
            <Row label="仕入価格" value={yen(Number(r.supplier_price_jpy))} />
            <Row
              label="着地原価（送料・関税・検品込み）"
              value={
                <>
                  <strong>{yen(Number(r.landed_cost_jpy))}</strong>
                  <div className="small muted">
                    仕入{yen(cost.supplierUnitPriceJpy)}＋国内送料{yen(cost.domesticShippingJpy)}＋国際送料
                    {yen(cost.intlShippingJpy)}＋関税等{yen(cost.dutyJpy)}＋輸入関連{yen(cost.importOtherJpy)}＋検品
                    {yen(cost.inspectionJpy)}
                  </div>
                </>
              }
            />
            <Row label="Amazon販売価格" value={yen(Number(r.amazon_price_jpy))} />
            <Row
              label="30日平均価格"
              value={r.avg_price_30d_jpy != null ? yen(Number(r.avg_price_30d_jpy)) : <span className="muted">UNKNOWN（取れていません）</span>}
            />
            <Row
              label="90日平均価格"
              value={r.avg_price_90d_jpy != null ? yen(Number(r.avg_price_90d_jpy)) : <span className="muted">UNKNOWN（取れていません）</span>}
            />
            <Row
              label="カート（Buy Box）"
              value={
                r.buybox_price_jpy != null ? (
                  <>
                    {yen(Number(r.buybox_price_jpy))}
                    <div className="small muted">
                      {Number(r.buybox_is_amazon) === 1 ? 'Amazon本体が取っています（勝ちにくい）' : '出品者が取っています'}
                      {Number(r.buybox_is_fba) === 1 ? '／FBA' : ''}
                    </div>
                  </>
                ) : (
                  <span className="muted">UNKNOWN（取れていません）</span>
                )
              }
            />
            <Row
              label="推定月間販売数"
              value={
                <>
                  {salesText(basis, Number(r.monthly_sales_est))}
                  <div className="small muted">
                    根拠：{SALES_BASIS_LABEL[basis] ?? basis}（確からしさ {String(r.monthly_sales_confidence)}）
                  </div>
                </>
              }
            />
            <Row label="推定月間売上" value={yen(Number(r.monthly_revenue_jpy))} />
            <Row
              label="1個あたり純利益"
              value={
                <>
                  <strong>{yen(Number(r.net_profit_jpy))}</strong>
                  <div className="small muted">
                    販売手数料{yen(cost.referralFeeJpy)}／{String(cost.fulfillmentLabel ?? '')}
                    {yen(cost.fulfillmentFeeJpy)}／保管料{yen(cost.storageFeeJpy)}／広告{yen(cost.adCostJpy)}／返品リスク
                    {yen(cost.returnRiskJpy)}／その他{yen(cost.otherVariableJpy)}
                  </div>
                  <FeeBreakdown cost={cost} sellPriceJpy={Number(r.amazon_price_jpy)} netProfitJpy={Number(r.net_profit_jpy)} />
                </>
              }
            />
            <Row label="利益率" value={pct(Number(r.profit_rate), 1)} />
            <Row label="ROI（投資回収率）" value={pct(Number(r.roi), 1)} />
            <Row label="競合数（出品者）" value={r.seller_count ?? '—'} />
            <Row
              label="Sales Rank（BSR）"
              value={
                <>
                  {r.bsr ? Number(r.bsr).toLocaleString() : <span className="muted">UNKNOWN</span>}
                  <div className="small muted">
                    30日平均 {r.bsr_avg_30d != null ? Number(r.bsr_avg_30d).toLocaleString() : 'UNKNOWN'}／90日平均{' '}
                    {r.bsr_avg_90d != null ? Number(r.bsr_avg_90d).toLocaleString() : 'UNKNOWN'}
                    {bsrHistory.length > 0 ? `／履歴${bsrHistory.length}点あり` : ''}
                  </div>
                </>
              }
            />
            <Row label="レビュー数／評価" value={`${r.review_count ?? '—'}件 ／ ${r.rating ?? '—'}`} />
            <Row label="Amazon本体の販売" value={r.amazon_selling ? 'あり（勝ちにくい）' : 'なし'} />
            <Row label="PRICE GAP（仕入の安さ）" value={`${r.price_gap_score} / 100`} />
            <Row
              label="RESEARCH SCORE"
              value={
                <>
                  <strong>{r.research_score} / 100</strong>
                  <div className="small muted">
                    {(Object.keys(RESEARCH_SCORE_MAX) as (keyof ResearchScoreBreakdown)[])
                      .map((k) => `${RESEARCH_SCORE_LABEL[k]} ${Math.round(scoreBd[k])}/${RESEARCH_SCORE_MAX[k]}`)
                      .join('｜')}
                  </div>
                </>
              }
            />
            <Row
              label="リスク"
              value={risks.length ? risks.join('／') : <span className="muted">目立ったリスクはありません</span>}
            />
            <Row label="この商品の良いところ" value={tags.length ? tags.join('／') : '—'} />
            <Row label="最小ロット／納期" value={`${r.moq}個 ／ ${r.lead_time_days}日`} />

            {/* ---- 第3段階：この判断がどれだけ信用できるか ---- */}
            <Row
              label="CONFIDENCE（この判断の信頼度）"
              value={
                r.confidence != null ? (
                  <>
                    <strong>
                      {String(r.grade)}ランク Confidence {Number(r.confidence)}%
                    </strong>
                    <div className="small muted">
                      新しさ{Math.round(confBd.freshness ?? 0)}／同一商品{Math.round(confBd.match ?? 0)}／販売数の根拠
                      {Math.round(confBd.salesBasis ?? 0)}／仕入価格{Math.round(confBd.supplierPrice ?? 0)}／送料
                      {Math.round(confBd.shipping ?? 0)}／規制{Math.round(confBd.regulation ?? 0)}／価格の安定
                      {Math.round(confBd.priceStability ?? 0)}
                    </div>
                    {confReasons.length > 0 && <div className="small muted">{confReasons.join('／')}</div>}
                  </>
                ) : (
                  <span className="muted">計算していません</span>
                )
              }
            />
            <Row
              label="データの新しさ"
              value={
                <>
                  {Number(r.stale) === 1 ? (
                    <strong style={{ color: '#b00' }}>★古すぎます（Aランクにはしません）</strong>
                  ) : (
                    <>いちばん古い項目で約{Math.round(Number(r.freshness_hours ?? 0))}時間前</>
                  )}
                  <div className="small muted">
                    {freshParts.length
                      ? freshParts.map((p) => `${p.field}：${p.label}`).join('／')
                      : `Amazon側 ${r.market_fetched_at ? jstDateTime(String(r.market_fetched_at)) : '不明'}／仕入先 ${
                          r.supplier_fetched_at ? jstDateTime(String(r.supplier_fetched_at)) : '不明'
                        }`}
                  </div>
                </>
              }
            />
            <Row
              label="取れなかった項目（UNKNOWN）"
              value={
                unknownFields.length ? (
                  <>
                    <strong>{unknownFields.join('／')}</strong>
                    <div className="small muted">分からない項目は推測で埋めていません。UNKNOWNのまま扱っています</div>
                  </>
                ) : (
                  <span className="muted">ありません（必要な項目はすべて取れています）</span>
                )
              }
            />
            <Row
              label="推奨仕入数"
              value={
                qty > 0 ? (
                  <>
                    <strong>{qty}個</strong>
                    <div className="small muted">{qtyReasons.join('／')}</div>
                  </>
                ) : (
                  <span className="muted">計算できていません</span>
                )
              }
            />
            <Row
              label="想定売切日数"
              value={r.est_selldays != null ? `約${Number(r.est_selldays)}日` : <span className="muted">不明</span>}
            />
            <Row
              label="最悪ケース（売れ行きが半分）"
              value={
                qtyWorst.sellDays != null ? (
                  <>
                    約{qtyWorst.sellDays}日かかり、{yen(Number(qtyWorst.tiedUpCashJpy ?? 0))}が在庫として寝ます
                    <div className="small muted">{qtyWorst.note ?? ''}</div>
                  </>
                ) : (
                  <span className="muted">計算できていません</span>
                )
              }
            />
            {warnings.length > 0 && <Row label="過去の失敗からの注意" value={warnings.join('／')} />}
            {r.promotion_reason && (
              <Row
                label="ランクが動いた理由"
                value={
                  <>
                    <strong>{String(r.promotion_reason)}</strong>
                    {r.prev_grade && <div className="small muted">前回は{String(r.prev_grade)}ランクでした</div>}
                  </>
                }
              />
            )}
          </tbody>
        </table>

        {(String(r.grade) === 'A' || String(r.grade) === 'B') && (
          <ApproveButton
            candidateId={String(r.id)}
            defaultQty={qty}
            title={String(r.amazon_title || r.supplier_title || '')}
            alreadyApproved={String(r.approval_status || '') === 'approved'}
          />
        )}

        <h4 style={{ marginTop: 12 }}>AIおすすめ理由</h4>
        <ul className="small">
          {[...gradeReasons, ...scoreReasons].map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>

        <h4 style={{ marginTop: 12 }}>同一商品かどうかの判定手順（かかった費用つき）</h4>
        <table className="table">
          <thead>
            <tr>
              <th>段階</th>
              <th>費用</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s, i) => (
              <tr key={i}>
                <td>{s.stage}</td>
                <td>{s.cost === 'free' ? '無料' : s.cost === 'cheap' ? 'ほぼ無料' : 'AI課金'}</td>
                <td className="small">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ marginTop: 12 }}>計算の前提（必ずご確認ください）</h4>
        <ul className="small muted">
          {(cost.assumptions || []).map((a: string, i: number) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * 仕入先の自動探索（Supplier Discovery）の状態と、直近の絞り込み経過。
 *
 * ★ここが答えるのは1つだけ：
 *   「私が商品一覧を作らなくても、システムは自分で安い商品を探してこられるのか？」
 *
 * ★DISCOVERY FUNNEL は「どこで候補が消えたか」を見るための表。
 *   数字を良く見せるための表ではないので、0件でも 0件と正直に出す。
 */
const DISCOVERY_BADGE: Record<string, { text: string; color: string }> = {
  LIVE_DISCOVERY_READY: { text: 'LIVE DISCOVERY READY（自分で探せる）', color: '#0a7d32' },
  PARTIAL: { text: 'PARTIAL（鍵・審査が必要）', color: '#a86a00' },
  MOCK_ONLY: { text: 'MOCK ONLY（練習用）', color: '#b00' },
  UNAVAILABLE: { text: 'UNAVAILABLE（今は使えない）', color: '#b00' },
};

function DiscoveryBoard({
  providers,
  ready,
  readyReason,
  run,
  rejects,
  outcomes,
  kpi,
}: {
  providers: DiscoveryProviderStatus[];
  ready: boolean;
  readyReason?: string;
  run: any;
  rejects: { stage: string; reasonCode: string; count: number }[];
  outcomes?: Awaited<ReturnType<typeof outcomeSummary>> | null;
  kpi?: DiscoveryKpi | null;
}) {
  const discovered = Number(run?.discovered_count ?? 0);
  const usedDiscovery = !!run?.discovery_mode || discovered > 0;
  const mode = run?.discovery_mode ? String(run.discovery_mode) : null;

  return (
    <div className="card">
      <h2>仕入先の自動探索（商品一覧を作らなくても探せるか）</h2>

      {ready ? (
        <div className="notice info">
          <strong>自動探索できます。</strong>
          いまつながっている仕入先から、システムが自分で商品を探してAmazonと突き合わせられます。
          <br />
          <code>npm run discover:supplier STANDARD 100 20</code> で実行できます
          （仕入先から最大100件 → そのうち20件だけAmazonと照合、という意味です）。
        </div>
      ) : (
        <div className="notice err">
          <strong>いまは自動探索できません。</strong>
          自分で商品を探してくる仕入先が1つもつながっていないので、
          現状は「あなたが用意した商品一覧を読む」ことしかできません。下の表の
          <strong>「必要なもの」</strong>を用意すると自動探索に切り替わります。
          {readyReason && (
            <div className="small" style={{ marginTop: 6 }}>
              いまの判定理由：{readyReason}
            </div>
          )}
        </div>
      )}

      {/*
        ★「0件でした」と「そもそも失敗していました」を必ず見分けるための欄（ユーザー指示）。
          以前、逆方向の探索が壊れていたのに画面には「0件」とだけ出ていた事故があったため、
          直近7日ぶんの呼び出し結果を、種類ごとに日本語で出します。
      */}
      <div style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 6 }}>直近7日の探索結果（0件と失敗を分けて表示）</h3>
        {!outcomes || outcomes.totalCalls === 0 ? (
          <p className="small muted">
            まだ1回も探索していないため、成功も失敗もありません
            （「0件」ではなく「まだ実行していない」という意味です）。
          </p>
        ) : (
          <>
            <p className="small">{outcomes.headline}</p>
            <table className="tbl small">
              <thead>
                <tr>
                  <th>結果の種類</th>
                  <th>回数</th>
                  <th>これは失敗か</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.rows.map((o) => (
                  <tr key={o.outcome}>
                    <td>{o.label}</td>
                    <td>{o.count}回</td>
                    <td style={{ color: o.isFailure ? '#b00' : '#0a7d32' }}>
                      {o.isFailure ? '★失敗（0件ではありません）' : '失敗ではありません'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/*
        ★DISCOVERY KPI 10項目（ユーザー指示 2026-08-20）。
          数えていない項目は 0 と書かず「まだ出せません」と正直に書く。
          特に⑦は「呼び出し回数」ではなく「消費トークン数」なので、混同して埋めない。
      */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 6 }}>DISCOVERY KPI（直近の実行の成績表・10項目）</h3>
        {!kpi ? (
          <p className="small muted">
            まだ1回も探索していないため、成績表はありません
            （「すべて0件」ではなく「まだ実行していない」という意味です）。
          </p>
        ) : (
          <>
            <table className="tbl small">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>数字</th>
                  <th>意味</th>
                </tr>
              </thead>
              <tbody>
                {KPI_LABEL.map((k) => {
                  const v = kpi[k.key];
                  const unknown = v === null || v === undefined;
                  return (
                    <tr key={String(k.key)}>
                      <td>{k.label}</td>
                      <td style={{ fontWeight: 700, color: unknown ? '#999' : undefined }}>
                        {kpiValueText(kpi, k.key, k.unit)}
                      </td>
                      <td className="muted">{k.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 6 }}>
              ★「まだ出せません」は0件という意味ではありません。数えられていない、という意味です。
              数字をよく見せるために、推測でうめることはしません。
            </p>
          </>
        )}
      </div>

      <table className="tbl small" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>仕入先</th>
            <th>地域</th>
            <th>状態</th>
            <th>そう判定した理由</th>
            <th>必要なもの</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const b = DISCOVERY_BADGE[p.readiness] ?? DISCOVERY_BADGE.UNAVAILABLE;
            return (
              <tr key={p.name}>
                <td>
                  <strong>{p.name}</strong>
                  {p.enabled && <span className="livebadge" style={{ marginLeft: 6 }}>使用中</span>}
                </td>
                <td>{p.region}</td>
                <td style={{ color: b.color, fontWeight: 700 }}>{b.text}</td>
                <td className="muted">{p.readinessReason}</td>
                <td className="muted">{p.enabled ? '—' : p.needs}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {usedDiscovery && (
        <>
          <h3 style={{ marginTop: 16 }}>
            DISCOVERY FUNNEL（直近の実行：
            {mode ? DISCOVERY_MODE_LABEL[mode as DiscoveryMode] ?? mode : '—'}）
          </h3>
          <p className="small muted">
            どこで候補が消えたかを見る表です。Aランクを増やすために基準を甘くはしません。
            減り方が偏っている段が、いま一番改善すべき場所です。
          </p>
          <table className="tbl small">
            <tbody>
              <FunnelRow n="①" label="仕入先から自動で見つけた" v={run?.discovered_count} />
              <FunnelRow n="②" label="無料のルールを通った（AI費用0円）" v={run?.prefilter_passed} />
              <FunnelRow n="③" label="Amazonで照合した（ここからKeepaを使う）" v={run?.amazon_checked} />
              <FunnelRow n="④" label="同一商品と言い切れた" v={run?.amazon_matched} />
              <FunnelRow n="⑤" label={`月${run?.min_monthly_sales ?? '—'}個以上売れている`} v={run?.sales_passed} />
              <FunnelRow n="⑥" label="利益条件を満たした" v={run?.profit_passed} />
              <FunnelRow n="⑦" label="Aランク" v={run?.grade_a} />
            </tbody>
          </table>

          {rejects.length > 0 && (
            <>
              <h4 style={{ marginTop: 12 }}>落とした理由の内訳</h4>
              <table className="tbl small">
                <thead>
                  <tr>
                    <th>件数</th>
                    <th>理由</th>
                    <th>どの段で</th>
                  </tr>
                </thead>
                <tbody>
                  {rejects.map((r) => (
                    <tr key={`${r.stage}/${r.reasonCode}`}>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.count}</td>
                      <td>{REJECT_REASON_LABEL[r.reasonCode as DiscoveryRejectReason] ?? r.reasonCode}</td>
                      <td className="muted">{r.stage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

function FunnelRow({ n, label, v }: { n: string; label: string; v: any }) {
  return (
    <tr>
      <td style={{ width: 32 }}>{n}</td>
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontWeight: 700, width: 80 }}>{Number(v ?? 0)}件</td>
    </tr>
  );
}

/**
 * SUPPLIER DATA バッジ。
 *
 * ★ユーザー指定：「画面に SUPPLIER DATA: LIVE と出せるのは、
 *   実際の仕入先データを取得している場合だけです。」
 *   1件でもサンプルが混ざっていたら LIVE とは名乗らない。
 */
function SupplierDataBanner({ tally, live }: { tally: Record<string, number>; live: boolean }) {
  const total = tally.LIVE + tally.ESTIMATED + tally.UNKNOWN + tally.MOCK;

  if (total === 0) {
    return live ? (
      <div className="notice info">
        <strong>SUPPLIER DATA: 準備OK</strong>
        {' — '}本物の仕入先につながっています。リサーチを実行すると、実際の仕入先商品で計算します。
      </div>
    ) : (
      <div className="notice err">
        <strong>SUPPLIER DATA: MOCK（サンプル）</strong>
        {' — '}
        本物の仕入先がまだ1つもつながっていません。このまま実行すると
        <strong>Amazon側＝本番／仕入値＝架空の値段</strong>という一番危険な混ざり方になります。
        下の「仕入先」の行から、スプレッドシートかCSVをつないでください。
      </div>
    );
  }

  const worst =
    tally.MOCK > 0 ? 'MOCK' : tally.UNKNOWN > 0 ? 'UNKNOWN' : tally.ESTIMATED > 0 ? 'ESTIMATED' : 'LIVE';
  const cls = worst === 'LIVE' ? 'info' : worst === 'ESTIMATED' ? 'warn' : 'err';
  const label =
    worst === 'LIVE'
      ? 'SUPPLIER DATA: LIVE（すべて本物の仕入先データです）'
      : worst === 'ESTIMATED'
        ? 'SUPPLIER DATA: ESTIMATED（本物ですが、一部の項目が取れていません）'
        : worst === 'UNKNOWN'
          ? 'SUPPLIER DATA: UNKNOWN（必須項目が足りない商品が混ざっています）'
          : 'SUPPLIER DATA: MOCK（サンプルの架空価格が混ざっています）';

  return (
    <div className={`notice ${cls}`}>
      <strong>{label}</strong>
      {' — '}
      本物 {tally.LIVE}件 ／ 一部不足 {tally.ESTIMATED}件 ／ 必須項目なし {tally.UNKNOWN}件 ／ サンプル{' '}
      {tally.MOCK}件（全{total}件）。
      {worst !== 'LIVE' && ' 本物でない商品はAランクにしていません。'}
    </div>
  );
}

/**
 * 仕入先Providerが「本当に本物のデータを取れる状態か」を1目で出す。
 * ★差込口があるだけ／Adapterがあるだけ、を「使える」と見せないための表示。
 */
const READINESS_BADGE: Record<string, { text: string; color: string }> = {
  LIVE_READY: { text: 'LIVE READY（本物が取れる）', color: '#0a7d32' },
  PARTIAL: { text: 'PARTIAL（審査・契約が必要）', color: '#a86a00' },
  MOCK_ONLY: { text: 'MOCK ONLY（練習用）', color: '#b00' },
  UNAVAILABLE: { text: 'UNAVAILABLE（今は使えない）', color: '#b00' },
};

function ReadinessTag({ kind }: { kind?: string }) {
  const b = READINESS_BADGE[kind || 'UNAVAILABLE'] ?? READINESS_BADGE.UNAVAILABLE;
  return (
    <span style={{ color: b.color, border: `1px solid ${b.color}`, borderRadius: 4, padding: '0 4px', fontSize: 11 }}>
      {b.text}
    </span>
  );
}

const SUPPLIER_QUALITY_BADGE: Record<string, { text: string; color: string }> = {
  LIVE: { text: '本物', color: '#0a7d32' },
  ESTIMATED: { text: '一部不足', color: '#a86a00' },
  UNKNOWN: { text: '項目不足', color: '#b00' },
  MOCK: { text: 'サンプル', color: '#b00' },
};

function SupplierQualityTag({ kind }: { kind?: string }) {
  const b = SUPPLIER_QUALITY_BADGE[kind || 'UNKNOWN'] ?? SUPPLIER_QUALITY_BADGE.UNKNOWN;
  return (
    <span style={{ color: b.color, border: `1px solid ${b.color}`, borderRadius: 4, padding: '0 4px', fontSize: 11 }}>
      {b.text}
    </span>
  );
}

/**
 * 「Amazon販売価格 − 各費用 ＝ 手残り」を1円単位で並べる表。
 *
 * ★各費用の横に必ず 実データ／推定値／不明 を出す。
 *   推定値を確定値のように見せない。不明を0円として黙って足さない。
 */
const FEE_BADGE: Record<string, { text: string; color: string }> = {
  ACTUAL: { text: '実データ', color: '#0a7d32' },
  ESTIMATED: { text: '推定値', color: '#a86a00' },
  UNKNOWN: { text: '不明', color: '#b00' },
};

function FeeTag({ kind }: { kind?: string }) {
  const b = FEE_BADGE[String(kind || '')];
  if (!b) return null;
  return (
    <span
      className="small"
      style={{ marginLeft: 6, padding: '0 6px', borderRadius: 4, border: `1px solid ${b.color}`, color: b.color }}
    >
      {b.text}
    </span>
  );
}

function FeeBreakdown({
  cost,
  sellPriceJpy,
  netProfitJpy,
}: {
  cost: Record<string, any>;
  sellPriceJpy: number;
  netProfitJpy: number;
}) {
  const conf = (cost.feeConfidence || {}) as Record<string, string>;
  const notes = (cost.feeNotes || {}) as Record<string, string>;
  const fresh = cost.feeFreshness as { label?: string; stale?: boolean } | undefined;
  const criticalUnknown: string[] = cost.feeCriticalUnknown || [];
  const legacy = cost.legacyComparison as
    | { legacyNetProfitJpy: number; deltaJpy: number; note: string }
    | null
    | undefined;
  const tiers = (cost.feeTiers || {}) as { size?: string | null; weight?: string | null };

  const lines: { label: string; jpy: number; kind?: string; note?: string }[] = [
    { label: 'Amazon販売価格', jpy: Number(cost.sellPriceJpy ?? sellPriceJpy ?? 0) },
    { label: '− 仕入価格', jpy: -Number(cost.supplierUnitPriceJpy ?? 0) },
    { label: '− 中国国内送料', jpy: -Number(cost.domesticShippingJpy ?? 0) },
    { label: '− 国際送料', jpy: -Number(cost.intlShippingJpy ?? 0) },
    { label: '− 関税・輸入消費税', jpy: -Number(cost.dutyJpy ?? 0) },
    { label: '− 輸入関連費', jpy: -Number(cost.importOtherJpy ?? 0) },
    { label: '− 検品費', jpy: -Number(cost.inspectionJpy ?? 0) },
    { label: '− Amazon販売手数料（紹介料）', jpy: -Number(cost.referralFeeJpy ?? 0), kind: conf.referral, note: notes.referral },
    {
      label: `− ${String(cost.fulfillmentLabel ?? '配送費')}`,
      jpy: -Number(cost.fulfillmentFeeJpy ?? 0),
      kind: conf.fulfillment,
      note: notes.fulfillment,
    },
    { label: '− FBA在庫保管料', jpy: -Number(cost.storageFeeJpy ?? 0), kind: conf.storage, note: notes.storage },
    { label: '− 想定広告費', jpy: -Number(cost.adCostJpy ?? 0) },
    { label: '− 返品リスク概算', jpy: -Number(cost.returnRiskJpy ?? 0) },
    { label: '− その他変動費', jpy: -Number(cost.otherVariableJpy ?? 0) },
  ];

  return (
    <details style={{ marginTop: 8 }}>
      <summary className="small">1円単位の内訳を見る（各費用が実データか推定かも表示）</summary>
      <table className="table small" style={{ marginTop: 6 }}>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={{ width: 260 }}>
                {l.label}
                <FeeTag kind={l.kind} />
              </td>
              <td style={{ textAlign: 'right', width: 110 }}>{Math.round(l.jpy).toLocaleString()}円</td>
              <td className="muted">{l.note || ''}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>＝ NET PROFIT（手残り）</strong>
            </td>
            <td style={{ textAlign: 'right' }}>
              <strong>{Math.round(Number(cost.netProfitJpy ?? netProfitJpy ?? 0)).toLocaleString()}円</strong>
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <ul className="small" style={{ marginTop: 6 }}>
        {(tiers.size || tiers.weight) && (
          <li className="muted">
            サイズ区分：{tiers.size ?? '不明'}／重量区分：{tiers.weight ?? '不明'}
          </li>
        )}
        {fresh?.label && (
          <li style={{ color: fresh.stale ? '#b00' : undefined }}>手数料データの鮮度：{fresh.label}</li>
        )}
        {criticalUnknown.length > 0 && (
          <li style={{ color: '#b00' }}>
            ★利益に効く手数料が分かっていません（{criticalUnknown.join('・')}）。この商品はAランクにしません
          </li>
        )}
        {legacy && (
          <li style={{ color: legacy.deltaJpy < 0 ? '#b00' : undefined }}>
            仮置き計算との比較：{legacy.note}
          </li>
        )}
      </ul>
    </details>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <th style={{ width: 220, textAlign: 'left', verticalAlign: 'top' }}>{label}</th>
      <td>{value}</td>
    </tr>
  );
}

/**
 * ★「仕入先を見る」ボタン（ユーザー指示）
 *   押したら、その仕入先の購入ページへ新しいタブで直接飛びます。
 *
 *   ★ここが大事：URLは仕入先APIが返した値だけを使っています。
 *     商品番号から「たぶんこのURLだろう」と組み立てることは、していません。
 *     組み立てたURLは、実際に開けるか誰も確かめていないためです。
 *     なのでURLが無いときは、それらしいボタンを出さずに理由を日本語で書きます。
 */
function SupplierLinkButton({ url }: { url: any }) {
  const u = url ? String(url) : '';
  // 念のため画面側でももう一度だけ確認する（http/https 以外はボタンにしない）
  const safe = /^https?:\/\//i.test(u) ? u : '';
  if (!safe) {
    return (
      <p className="small muted" style={{ margin: '8px 0 12px' }}>
        仕入先の購入ページURLが取れていません。推測でURLは作らないため、
        ボタンは出していません（この商品はAランクにしません）。
      </p>
    );
  }
  let host = '';
  try {
    host = new URL(safe).hostname;
  } catch {
    host = '';
  }
  return (
    <p style={{ margin: '8px 0 12px' }}>
      <a className="btn" href={safe} target="_blank" rel="noreferrer noopener">
        仕入先を見る（購入ページを開く）
      </a>
      {host && <span className="small muted" style={{ marginLeft: 8 }}>飛び先：{host}</span>}
    </p>
  );
}

function imgCell(url: any): React.ReactNode {
  const u = String(url || '');
  if (!u) return '—';
  if (u.startsWith('http')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={u} alt="" style={{ maxWidth: 90, maxHeight: 90, borderRadius: 6 }} />;
  }
  return <span className="small muted">{u}（サンプル画像のため表示されません）</span>;
}

function salesText(basis: SalesBasis, units: number): string {
  if (basis === 'unknown') return '販売数不明';
  if (basis === 'keepa_monthly_sold') return `月${units.toLocaleString()}個（Amazon表示の購入数）`;
  if (basis === 'csv') return `月${units.toLocaleString()}個（取込データ）`;
  return `推定月販 約${units.toLocaleString()}個`;
}
