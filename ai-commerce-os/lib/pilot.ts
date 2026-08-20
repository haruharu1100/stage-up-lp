import { all } from './db/client';
import { validationFunnel, type ValidationFunnel } from './funnel';
import { workStepJa } from './listing';
import { getCostSettings } from './settings';
import { dropoutSummary, type DropoutSummary } from './dropout';
import { matchReviewSummary, type MatchReviewSummary } from './matchreview';
import { automationPlan, type AutomationPlan } from './automation';
import { integrityReport, type IntegrityReport } from './integrity';

/**
 * 操作性テスト（PILOT）＝ まず10件だけ入れてみる（Phase 3.7）。
 *
 * 【なぜいきなり100件を入れないのか】
 * ユーザー指示：「修正後、いきなり100件入力しないでください。まず10件で操作性テスト。」
 *
 * 100件を1回入力してから「この項目は要らなかった」と気づくと、90件分の手間が無駄になる。
 * 10件で止めれば、直すのは10件分で済む。
 * さらに大事なのは、ここで**人間が面倒だと感じた工程が、次に自動化すべき機能**になるということ。
 * つまりこの10件は「データを集めるため」ではなく「どこを自動化するか決めるため」に入れる。
 *
 * 【合格しないうちは100件へ進めない】
 * 進んでよいかどうかを人の気分で決めると、必ず「まあ大丈夫だろう」で進む。
 * だから条件を数字で書いておく。
 *
 * 【ここでも実購入・実出品はしない】
 * このファイルがするのは、既に人が入力したものを数えることだけ。
 * 外部サイトへアクセスする処理は1行も無い。
 */

export type PilotCheck = {
  code: string;
  ja: string;
  ok: boolean;
  /** 測れていない（0件など）ときは true。ok=false とは意味が違う。 */
  unmeasurable: boolean;
  valueJa: string;
  targetJa: string;
};

export type PilotReport = {
  /** 目標件数（既定10件）。設定で変えられる。 */
  pilotSize: number;
  /** 実際に入った実市場の出品の件数 */
  entered: number;

  // --- ① 総時間 / ② 1件平均 ---
  totalSeconds: number;
  rowsWithSeconds: number;
  avgSecondsPerItem: number | null;

  // --- ③ 入力できなかった情報 ---
  missingFields: { field: string; ja: string; missing: number; rate: number }[];
  /** 型番・JAN・状態が「取れた」割合。取れなかった項目が、次に手を入れる場所になる。 */
  captureRates: { field: string; ja: string; captured: number; total: number; rate: number | null }[];

  // --- ④⑤⑥ ファネル ---
  funnel: ValidationFunnel;
  /** Routeにならなかった理由の内訳（8分類） */
  dropout: DropoutSummary;
  /** 同一商品判定の答え合わせ（取り違えは重大） */
  match: MatchReviewSummary;
  /** 次に自動化すべき工程と、1000件換算の削減見込み */
  automation: AutomationPlan;
  /** データの点検結果（重複・汚染・矛盾） */
  integrity: IntegrityReport;

  /** 材料が足りずに判断できなかった件数 */
  insufficientDataCount: number;
  /** 人の確認が必要な件数（まだ答え合わせしていない＋判断が付かない） */
  humanReviewCount: number;

  // --- ⑦ 見つかった問題 ---
  issues: string[];

  // --- ⑧ 100件へ進んでよいか ---
  checks: PilotCheck[];
  passedCount: number;
  totalCount: number;
  canProceed: boolean;
  /** 100件へ進むための安全条件（操作性の7項目とは別の7項目） */
  gateChecks: PilotCheck[];
  gatePassedCount: number;
  gateTotalCount: number;
  gateCanProceed: boolean;
  verdictJa: string;
  /** 次に自動化すべき工程（いちばん時間がかかっている工程）。 */
  automateNextJa: string;
  /** ユーザー指示14の①〜⑧の報告。画面にもレポートにも同じ文が出る。 */
  report8: { no: number; title: string; bodyJa: string }[];
};

/** 入力できているか数える項目。全部を必須にはしない（推測で埋めさせないため）。 */
const CHECK_FIELDS: { field: string; ja: string; important: boolean }[] = [
  { field: 'product_name', ja: '商品名', important: true },
  { field: 'first_listing_price', ja: '出品価格', important: true },
  { field: 'condition_rank', ja: '状態', important: true },
  { field: 'brand', ja: 'ブランド', important: true },
  { field: 'model_number', ja: '型番', important: true },
  { field: 'jan', ja: 'JAN', important: false },
  { field: 'category', ja: 'カテゴリ', important: false },
  { field: 'size', ja: 'サイズ', important: false },
  { field: 'color', ja: '色', important: false },
  { field: 'package_size', ja: '荷物サイズ', important: false },
  { field: 'shipping_method', ja: '発送方法', important: false },
  { field: 'estimated_shipping_cost', ja: '見込み送料', important: false },
];

export async function pilotReport(): Promise<PilotReport> {
  const cs = await getCostSettings();
  const pilotSize = cs.pilotSize;

  const listings = await all(
    `SELECT * FROM tracked_listings WHERE real_market_data = 1 ORDER BY created_at`,
  );
  const entered = listings.length;

  // ① ② 入力にかかった時間。書いてある行だけで測る。書いていない行を0秒扱いしない。
  const secs = await all(
    `SELECT entry_seconds FROM listing_observations
      WHERE real_market_data = 1 AND entry_seconds IS NOT NULL AND entry_seconds > 0`,
  );
  const totalSeconds = secs.reduce((a, r) => a + Number(r.entry_seconds), 0);
  const rowsWithSeconds = secs.length;
  const avgSecondsPerItem = rowsWithSeconds > 0 ? Math.round(totalSeconds / rowsWithSeconds) : null;

  // ③ 入力できなかった情報
  const missingFields = CHECK_FIELDS.map((f) => {
    const missing = listings.filter((r) => {
      const v = (r as Record<string, unknown>)[f.field];
      return v === null || v === undefined || String(v) === '' || String(v) === 'UNKNOWN';
    }).length;
    return { field: f.field, ja: f.ja, missing, rate: entered > 0 ? missing / entered : 0 };
  }).sort((a, b) => b.missing - a.missing);

  /*
   * ③-2 取得率。
   * 「空欄が何件か」だけでなく「取れた割合」も出す。
   * 型番が3/10しか取れないなら、商品の選び方かカテゴリの選び方が間違っている、と分かる。
   * 分母が0のときは 0% ではなく「測れない（null）」にする（CLAUDE.md ルール35）。
   */
  const CAPTURE_FIELDS: { field: string; ja: string }[] = [
    { field: 'model_number', ja: '型番' },
    { field: 'jan', ja: 'JAN' },
    { field: 'condition_rank', ja: '状態' },
  ];
  const captureRates = CAPTURE_FIELDS.map((f) => {
    const captured = listings.filter((r) => {
      const v = (r as Record<string, unknown>)[f.field];
      const s = v === null || v === undefined ? '' : String(v);
      return s !== '' && s !== 'UNKNOWN' && s !== 'MANUAL_REVIEW';
    }).length;
    return {
      field: f.field, ja: f.ja, captured, total: entered,
      rate: entered > 0 ? captured / entered : null,
    };
  });

  // ④⑤⑥
  const funnel = await validationFunnel();
  const dropout = await dropoutSummary();
  const match = await matchReviewSummary();
  const automation = await automationPlan();
  const integrity = await integrityReport();

  /*
   * 材料が足りずに判断できなかった件数。
   * 「利益が足りない」で落ちたものは**判断できている**ので、ここには入れない。
   * ここに入るのは「まだ判断していない」もの。両者を混ぜると、
   * 仕入先を増やすべきなのか、データを足すべきなのかが分からなくなる。
   */
  const insufficientDataCount = dropout.rows.filter(
    (r) => r.reason !== 'INSUFFICIENT_MARGIN' && r.reason !== 'PRODUCT_MATCH_FAILED',
  ).length;

  // 人の確認が必要な件数。「判断が付かない」を放置せず数える。
  const humanReviewCount = match.unreviewed + match.uncertain;

  // ⑦ 見つかった問題。黙って直さず、必ず言葉にして出す。
  const issues: string[] = [];
  if (entered === 0) {
    issues.push('実市場の出品がまだ1件も入っていません。まずは手元で見た出品を入力してください。');
  }
  if (entered > 0 && rowsWithSeconds === 0) {
    issues.push('入力秒数が1件も書かれていません。どの工程に時間がかかったか分からず、自動化の順番を決められません。');
  }
  for (const m of missingFields) {
    const f = CHECK_FIELDS.find((x) => x.field === m.field);
    if (!f?.important) continue;
    if (entered > 0 && m.rate >= 0.5) {
      issues.push(`「${m.ja}」が ${m.missing}/${entered}件で空欄です。この項目は画面から読み取りにくい可能性があります。`);
    }
  }
  if (entered > 0 && funnel.matchableProducts === 0) {
    issues.push('他市場と同じ商品だと確かめられた件数が0件です。型番付きの商品を選ぶか、比べる市場の相場を登録してください。');
  }
  if (funnel.topCategoryShare !== null && funnel.topCategoryShare > 0.6 && entered >= 5) {
    const top = funnel.byCategory[0];
    issues.push(
      `カテゴリが「${top.category}」に ${Math.round(top.share * 100)}% 偏っています。`
      + '1種類だけで判断すると、他のカテゴリで同じ結果になるとは限りません。',
    );
  }
  if (avgSecondsPerItem !== null && avgSecondsPerItem > 180) {
    issues.push(`1件あたり平均 ${avgSecondsPerItem}秒 かかっています。100件だと約 ${Math.round(avgSecondsPerItem * 100 / 60)}分。先に入力の手間を減らすべきです。`);
  }
  // 点検で見つかった重大な問題は、そのまま問題として並べる。黙って直さない。
  for (const i of integrity.issues.filter((x) => x.severe)) {
    issues.push(`【重大】${i.ja}：${i.count}件。${i.detailJa}`);
  }
  if (match.incorrect > 0) {
    issues.push(
      `【重大】違う商品を同じ商品として扱っていたものが ${match.incorrect}件ありました。`
      + '利益商品の見逃しより危険な種類の間違いです（実際にお金を失う側）。原因を確かめるまで進みません。',
    );
  }
  for (const c of captureRates) {
    if (c.rate !== null && entered >= 3 && c.rate < 0.5 && c.field !== 'jan') {
      issues.push(
        `「${c.ja}」が取れたのは ${c.captured}/${c.total}件（${Math.round(c.rate * 100)}%）です。`
        + '商品を特定できないと他市場と比べられないので、型番の載っている商品を選ぶか、カテゴリを見直してください。',
      );
    }
  }

  // ⑧ 100件へ進んでよいか
  const pct = (x: number | null) => (x === null ? '測れない' : `${Math.round(x * 100)}%`);
  const checks: PilotCheck[] = [
    {
      code: 'PILOT_ENTERED',
      ja: `まず${pilotSize}件を実際に入力した`,
      ok: entered >= pilotSize,
      unmeasurable: false,
      valueJa: `${entered}件`,
      targetJa: `${pilotSize}件以上`,
    },
    {
      code: 'ENTRY_TIME_MEASURED',
      ja: '入力にかかった時間を測れている',
      ok: rowsWithSeconds >= Math.min(pilotSize, Math.max(1, Math.ceil(pilotSize * 0.8))),
      unmeasurable: rowsWithSeconds === 0,
      valueJa: rowsWithSeconds === 0 ? '未計測' : `${rowsWithSeconds}件で計測（合計${Math.round(totalSeconds / 60)}分・1件平均${avgSecondsPerItem}秒）`,
      targetJa: `${Math.max(1, Math.ceil(pilotSize * 0.8))}件以上で計測`,
    },
    {
      code: 'MATCHABLE_RATE',
      ja: '他市場と同じ商品だと確かめられた割合',
      ok: (funnel.matchableRate ?? 0) >= 0.5,
      unmeasurable: entered === 0,
      valueJa: `${funnel.matchableProducts}件（${pct(funnel.matchableRate)}）`,
      targetJa: '50%以上',
    },
    {
      code: 'ROUTE_GENERATION_RATE',
      ja: 'Routeを作れた割合',
      ok: (funnel.routeGenerationRate ?? 0) >= 0.3,
      unmeasurable: entered === 0,
      valueJa: `${funnel.routeGeneratedProducts}件（${pct(funnel.routeGenerationRate)}）`,
      targetJa: '30%以上',
    },
    {
      code: 'CATEGORY_SPREAD',
      ja: 'カテゴリが1種類に偏っていない',
      ok: funnel.topCategoryShare === null ? false : funnel.topCategoryShare <= 0.6,
      unmeasurable: entered === 0,
      valueJa: funnel.byCategory.length === 0
        ? '—'
        : `${funnel.byCategory.length}種類（最多は「${funnel.byCategory[0].category}」で${Math.round((funnel.topCategoryShare ?? 0) * 100)}%）`,
      targetJa: '最多カテゴリが60%以下',
    },
    {
      code: 'REQUIRED_FIELDS_FILLED',
      ja: '大事な項目がだいたい埋まっている',
      ok: entered > 0 && missingFields
        .filter((m) => CHECK_FIELDS.find((x) => x.field === m.field)?.important)
        .every((m) => m.rate <= 0.5),
      unmeasurable: entered === 0,
      valueJa: entered === 0 ? '—' : missingFields
        .filter((m) => m.missing > 0)
        .slice(0, 4)
        .map((m) => `${m.ja}${m.missing}件`)
        .join('／') || '空欄なし',
      targetJa: '大事な項目の空欄が半分以下',
    },
    {
      code: 'NO_BLOCKING_ISSUE',
      ja: '入力を止めるほどの問題が出ていない',
      ok: issues.length === 0,
      unmeasurable: false,
      valueJa: issues.length === 0 ? '問題なし' : `${issues.length}件の気になる点`,
      targetJa: '0件',
    },
  ];

  const passedCount = checks.filter((c) => c.ok).length;
  const totalCount = checks.length;
  const operabilityOk = passedCount === totalCount;

  /*
   * ---------------------------------------------------------------------
   * 100件へ進むための安全条件（ユーザー指示15）。
   *
   * 上の7項目は「入力してみてどうだったか（操作性）」を見ている。
   * こちらの7項目は「集まったデータを信用してよいか（安全性）」を見ている。
   * 別物なので分けてある。操作性が良くてもデータが汚れていれば進んではいけないし、
   * その逆もある。
   *
   * ここは「だいたい大丈夫」を認めない。
   * 進んでよいかを人の気分で決めると、必ず「まあ大丈夫だろう」で進むため。
   * --------------------------------------------------------------------- */
  const routeStatus = await all(
    `SELECT status, COUNT(*) AS n FROM arbitrage_routes GROUP BY status`,
  );
  const routeTotal = routeStatus.reduce((a, r) => a + Number(r.n), 0);
  const routeError = routeStatus
    .filter((r) => String(r.status) === 'ERROR' || String(r.status) === 'FAILED')
    .reduce((a, r) => a + Number(r.n), 0);

  const shadowRows = await all(`SELECT COUNT(*) AS n FROM route_shadow_trades`);
  const shadowSaved = Number(shadowRows[0]?.n ?? 0);

  const gateChecks: PilotCheck[] = [
    {
      code: 'NO_SEVERE_BUG',
      ja: '重大な不具合が出ていない',
      ok: integrity.severeCount === 0,
      unmeasurable: entered === 0,
      valueJa: integrity.severeCount === 0 ? '0件' : `${integrity.severeCount}件`,
      targetJa: '0件',
    },
    {
      code: 'NO_FALSE_MATCH',
      ja: '違う商品を同じ商品として扱っていない（取り違え0件）',
      ok: match.incorrect === 0,
      // 1件も答え合わせしていない状態を「合格」にしない。測れていないと言う。
      unmeasurable: match.candidates > 0 && match.reviewed === 0,
      valueJa: match.candidates === 0
        ? '比べられる出品がまだ無い'
        : match.reviewed === 0
          ? `未確認（確認すべき組み合わせ ${match.candidates}件）`
          : `取り違え ${match.incorrect}件／確認済み ${match.reviewed}件`,
      targetJa: '取り違え0件（見逃しより危険なため、ここだけは0を求める）',
    },
    {
      code: 'NO_DUPLICATE_ENTRY',
      ja: '同じ商品ページを2回登録していない',
      ok: integrity.duplicateCount === 0,
      unmeasurable: entered === 0,
      valueJa: `${integrity.duplicateCount}件`,
      targetJa: '0件',
    },
    {
      code: 'NO_DATA_CONTAMINATION',
      ja: '記入見本やテスト用の行が混ざっていない',
      ok: integrity.contaminationCount === 0,
      unmeasurable: entered === 0,
      valueJa: `${integrity.contaminationCount}件`,
      targetJa: '0件',
    },
    {
      code: 'ENTRY_TIME_REALISTIC',
      ja: '入力にかかる時間が現実的な範囲に収まっている',
      ok: avgSecondsPerItem !== null && avgSecondsPerItem <= 180,
      unmeasurable: avgSecondsPerItem === null,
      valueJa: avgSecondsPerItem === null
        ? '未計測'
        : `1件平均${avgSecondsPerItem}秒（100件で約${Math.round(avgSecondsPerItem * 100 / 60)}分）`,
      targetJa: '1件平均180秒以下',
    },
    {
      code: 'ROUTE_CALC_HEALTHY',
      ja: 'Routeの計算が正常に動いている',
      ok: routeTotal > 0 && routeError === 0,
      unmeasurable: routeTotal === 0,
      valueJa: routeTotal === 0
        ? 'Routeがまだ1本も作られていない'
        : `${routeTotal}本中 エラー${routeError}本`,
      targetJa: 'Routeが作られていて、計算エラーが0本',
    },
    {
      code: 'SHADOW_SAVE_HEALTHY',
      ja: '答え合わせ（SHADOW）の記録が保存できている',
      ok: shadowSaved > 0,
      unmeasurable: shadowSaved === 0 && funnel.routeGeneratedProducts === 0,
      valueJa: shadowSaved === 0 ? '0件' : `${shadowSaved}件を保存済み`,
      targetJa: '1件以上',
    },
  ];

  const gatePassedCount = gateChecks.filter((c) => c.ok).length;
  const gateTotalCount = gateChecks.length;
  const gateCanProceed = gatePassedCount === gateTotalCount;

  // 両方そろって初めて100件へ進める。片方だけで進まない。
  const canProceed = operabilityOk && gateCanProceed;

  /*
   * 次に自動化すべき工程。
   * 「面倒だった気がする」ではなく、実際に測った秒数で決める。
   * 工程ごとの計測（work_time_logs）があればそちらを優先する。
   */
  const steps = await all(
    `SELECT step, SUM(seconds) AS total FROM observation_work_log
      GROUP BY step ORDER BY total DESC LIMIT 1`,
  );
  const automateNextJa = steps.length > 0 && Number(steps[0].total) > 0
    ? `いちばん時間がかかっているのは「${workStepJa(String(steps[0].step))}」の工程`
      + `（合計${Math.round(Number(steps[0].total) / 60)}分）。ここから自動化を考えます。`
    : '工程ごとの作業時間がまだ記録されていないため、どこを自動化すべきかは決められません。';

  const verdictJa = entered === 0
    ? `まだ1件も入力されていません。まず${pilotSize}件だけ入力してください。100件はそのあとです。`
    : canProceed
      ? `${pilotSize}件の操作性テストと安全条件を、どちらも満たしました。100件へ進んで構いません。`
      : `操作性 ${passedCount}/${totalCount}項目、安全条件 ${gatePassedCount}/${gateTotalCount}項目。`
        + `両方そろうまで100件へ進みません（進めても、同じ問題が90件分増えるだけです）。`;

  /*
   * ユーザー指示14の①〜⑧。
   * 数字だけ並べても読めないので、必ず「だから何をするか」まで書く。
   * 測れていないものは「測れない」と書く。近そうな方を選んで埋めない。
   */
  const pctOrNa = (x: number | null) => (x === null ? '測れない' : `${Math.round(x * 100)}%`);
  const worstCapture = [...captureRates]
    .filter((c) => c.rate !== null)
    .sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1))[0];

  const report8: { no: number; title: string; bodyJa: string }[] = [
    {
      no: 1,
      title: '実際に入力した結果',
      bodyJa: entered === 0
        ? '実市場の出品がまだ1件も入っていません。'
        : `${entered}件を入力。合計 約${Math.round(totalSeconds / 60)}分`
          + `（${rowsWithSeconds}件で時間を計測、1件平均${avgSecondsPerItem ?? '—'}秒）。`
          + `${funnel.verdictJa}`,
    },
    {
      no: 2,
      title: 'いちばん時間がかかった工程',
      bodyJa: automation.measured
        ? `${automation.verdictJa}${automation.cautionJa ? ' ' + automation.cautionJa : ''}`
        : '工程ごとの秒数がまだ記録されていないため、決められません。'
          + '観測CSVの「発見秒数／情報確認秒数／型番確認秒数／状態確認秒数／記入秒数」を埋めてください。',
    },
    {
      no: 3,
      title: 'いちばんデータが取れなかった項目',
      bodyJa: entered === 0
        ? '入力が0件のため測れません。'
        : worstCapture
          ? `取得率がいちばん低いのは「${worstCapture.ja}」で ${worstCapture.captured}/${worstCapture.total}件`
            + `（${pctOrNa(worstCapture.rate)}）。`
            + captureRates.map((c) => `${c.ja}${pctOrNa(c.rate)}`).join('／')
          : '測れません。',
    },
    {
      no: 4,
      title: '同一商品判定で起きた問題',
      bodyJa: match.verdictJa
        + (match.falseMatches.length > 0
          ? ' 具体例：' + match.falseMatches
              .map((f) => `${f.productName ?? f.listingKey}（${f.matchedVenueCode}）${f.note ? '：' + f.note : ''}`)
              .join('／')
          : ''),
    },
    {
      no: 5,
      title: 'Routeにならなかった主な理由',
      bodyJa: `${dropout.verdictJa} ${dropout.topReasonJa}`
        + (dropout.byReason.length > 0
          ? ' 内訳：' + dropout.byReason.map((r) => `${r.ja}${r.count}件`).join('／')
          : ''),
    },
    {
      no: 6,
      title: '見つかった不具合',
      bodyJa: issues.length === 0
        ? `${integrity.verdictJa} 入力を止めるほどの問題は出ていません。`
        : `${issues.length}件。` + issues.map((s, i) => `(${i + 1}) ${s}`).join(' '),
    },
    {
      no: 7,
      title: '次に自動化すべき工程 TOP3',
      bodyJa: automation.top3Ja.length > 0
        ? automation.top3Ja.join(' ') + ' ' + automation.roi.ja
        : '工程ごとの秒数が無いため、順番を決められません。'
          + '（感覚で決めると、時間の1割しか占めていない工程を自動化することになります）',
    },
    {
      no: 8,
      title: '100件へ進んでよいか',
      bodyJa: `${verdictJa} `
        + `操作性で未達：${checks.filter((c) => !c.ok).map((c) => c.ja).join('／') || 'なし'}。`
        + `安全条件で未達：${gateChecks.filter((c) => !c.ok).map((c) => c.ja).join('／') || 'なし'}。`,
    },
  ];

  return {
    pilotSize, entered,
    totalSeconds, rowsWithSeconds, avgSecondsPerItem,
    missingFields, captureRates,
    funnel, dropout, match, automation, integrity,
    insufficientDataCount, humanReviewCount,
    issues,
    checks, passedCount, totalCount, canProceed,
    gateChecks, gatePassedCount, gateTotalCount, gateCanProceed,
    verdictJa, automateNextJa, report8,
  };
}
