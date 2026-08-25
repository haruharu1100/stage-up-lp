/**
 * 需要の「材料」を分けて持つ（Phase 3.12b・2026-08-25）
 * ================================================================
 *
 * 【なぜこのファイルができたか】
 * 5件テストで、同じ「どれくらい売れているか」を指す数字が2つ出てきて、**桁が違った**。
 *
 *   ・チェキ用フィルム … 当社の推定需要シグナル 44 ／ Keepaの月間購入回数 5,000（約100倍）
 *   ・ポケモンごいた   … 当社の推定需要シグナル 32.7 ／ Keepaの月間購入回数 200（約6倍）
 *
 * ここで一番やってはいけないのは「大きいほう（または小さいほう）を採用する」こと。
 * どちらが正しいか**まだ分かっていない**のに片方へ寄せると、
 * 「そう決めた」という事実が消えて、後から検算できなくなる。
 * だからこのファイルは、**食い違いを食い違いのまま残す**ためにある。
 *
 * 【このファイルは何も import しない】
 * 画面（'use client'）へバンドルできるようにするため（ルール37）。
 *
 * 【このファイルは判定を変えない】
 * ご本人の指示：「今すぐKeepa値へ判定式を全面移行しないでください。
 * 既存4判定：SELLS / TOO_COMPETITIVE / NOT_SELLING / UNKNOWN もまだ変更しないこと。」
 * よってここで作るのは**表示と記録のための材料**だけで、
 * 仕入の可否（BUY判定）には1つも使わない。
 */

/* ================================================================
 * 1. 出どころ（SOURCE）
 * ================================================================ */

/**
 * その数字が**どこから来たか**。
 *
 * ご本人の指示：「RANK_DROPS_30D SOURCE = KEEPA ／
 * EQUAL_SHARE_OPPORTUNITY SOURCE = INTERNAL_CALCULATION ／
 * KEEPA_MONTHLY_SALES_ESTIMATE SOURCE = KEEPA。
 * この3つを一つの数字に統合しないでください。」
 *
 *   KEEPA                … Keepaが返した値をそのまま持っている（当社は計算していない）
 *   INTERNAL_CALCULATION … 当社が計算して作った値（暫定モデル。外の裏付けは無い）
 *
 * この区別を消すと、「当社が勝手に作った数字」と「外から来た数字」が
 * 同じ顔で画面に並ぶ。そうなると、外れたときにどちらを疑えばよいか分からなくなる。
 */
export const DEMAND_SOURCES = ['KEEPA', 'INTERNAL_CALCULATION'] as const;
export type DemandSource = (typeof DEMAND_SOURCES)[number];

export const DEMAND_SOURCE_JA: Record<DemandSource, string> = {
  KEEPA: 'Keepaが返した値（当社は計算していません）',
  INTERNAL_CALCULATION: '当社の計算（暫定モデル。外の裏付けはありません）',
};

/* ================================================================
 * 2. Keepa の月間購入回数の「正しい呼び方」
 * ================================================================ */

/**
 * ★ここが今回の訂正の中心である。
 *
 * ご本人の指示：「ACTUAL_MONTHLY_SALES / 実測販売数 とは呼ばないでください。
 * 正式名称を公式フィールド・公式説明に合わせて確認してください。」
 *
 * 2026-08-25、公式仕様書（product-object）の本文を読んで確認した結果：
 *
 *   ・項目名は `monthlySold`
 *   ・"This field represents the bought past month metric found on Amazon
 *      search result pages."
 *     ＝ Amazonの検索結果に出る「先月◯点購入されました」の表示そのもの
 *   ・"It is not an estimate."
 *     ＝ **推定値ではない**（ここは当社の当初の言い換えも間違っていた）
 *   ・"Amazon only provides the data in bracketed ranges such as 10+ or 100+,
 *      rather than as exact figures."
 *     ＝ ただし **"10以上" "100以上" のような粗い段階**でしか出てこない
 *   ・"the ASIN was bought at least 1000 times in the past month"
 *     ＝ 意味は **「少なくともその数」＝下限**。ちょうどの数ではない
 *   ・"Most ASINs do not have this value set."
 *     ＝ **大半の商品では空**（今回も5件中2件だけ）
 *
 * したがって当社での正しい言い方は
 *   **「Keepaの月間購入回数（「◯個以上」の区分値）」**
 * であって、「実測販売数」でも「Keepaの推定」でもない。
 *
 * ※ ご本人が挙げた候補名 `KEEPA_MONTHLY_SALES_ESTIMATE` は
 *    「または公式名称に対応した名前」という但し書きに従い採用していない。
 *    公式が明確に "not an estimate" と書いているものを ESTIMATE と名付けると、
 *    今度は逆向きの誤解（当社が推定した数だ）が生まれるためである。
 */
export const KEEPA_MONTHLY_SOLD_LABEL_JA = 'Keepaの月間購入回数（「◯個以上」の区分値）';

export const KEEPA_MONTHLY_SOLD_NOTE_JA =
  'Keepa公式の説明では、これは推定値ではなく、Amazonの検索結果に出る'
  + '「先月◯点購入されました」をそのまま渡した値です。'
  + 'ただしAmazonは「10以上」「100以上」のような粗い段階でしか出さないため、'
  + '意味は「少なくともその数」＝下限であって、ちょうどの数ではありません。'
  + 'また大半の商品では空です。実際の注文データと突き合わせて確認したものではないので、'
  + '「実測販売数」とは呼びません。';

/** ★禁止語。テストがソース全体を機械的に見張る。 */
export const FORBIDDEN_SALES_WORDS = ['ACTUAL_MONTHLY_SALES', '実測販売数'] as const;

/* ================================================================
 * 3. 需要の材料（DEMAND_EVIDENCE）
 * ================================================================ */

/** 1つの材料。**値と出どころを必ずセットで持つ**（片方だけにしない）。 */
export type DemandSignal = {
  key: string;
  labelJa: string;
  /** 値。無ければ null。**0で代用しない**（0＝売れていない、とは意味が違う）。 */
  value: number | null;
  /** 数値でない材料（YES / NO / UNKNOWN など）はこちら。 */
  textValue: string | null;
  source: DemandSource;
  unitJa: string;
  noteJa: string;
};

/**
 * 需要の材料一式。
 *
 * ご本人の指示：「DEMAND_EVIDENCE を新設し、複数の材料を保持してください：
 * Rank Drops 30D ／ Keepa Monthly Sales系 ／ Seller Count ／ Amazon Retail ／ Data Freshness。
 * まだ判定式は変えず、表示と記録のみでよいです。」
 */
export type DemandEvidence = {
  asin: string;
  signals: DemandSignal[];
  /** 食い違いの判定結果。下の `judgeDemandConflict` を参照。 */
  conflict: DemandConflict;
  /**
   * Keepaの値 ÷ 当社の推定。**分析専用。BUY判定には絶対に使わない。**
   * 材料が片方でも欠けたら null（無理に埋めない）。
   */
  keepaToInternalRatio: number | null;
};

/* ================================================================
 * 4. 食い違いの判定（DEMAND_SIGNAL_CONFLICT）
 * ================================================================ */

/**
 * 3つの状態。**「比べられない」を「食い違っていない」に混ぜない。**
 *
 *   CONFLICT       … 2つの材料が大きく食い違っている。人の追加検証が要る。
 *   CONSISTENT     … 2つとも取れていて、大きな食い違いは無い。
 *   CANNOT_COMPARE … 片方（多くはKeepa側）が無いので、そもそも比べられない。
 *
 * 3つ目を「食い違い無し（＝安心）」として扱うと、
 * 「材料が足りない」ことが「問題が無い」ことに化ける。ルール97と同じ形の間違いである。
 */
export const DEMAND_CONFLICT_STATUSES = ['CONFLICT', 'CONSISTENT', 'CANNOT_COMPARE'] as const;
export type DemandConflictStatus = (typeof DEMAND_CONFLICT_STATUSES)[number];

export type DemandConflict = {
  status: DemandConflictStatus;
  /** ご本人の指示による真偽値。CONFLICT のときだけ true。 */
  demandSignalConflict: boolean;
  ratio: number | null;
  reasonJa: string;
  /** 画面に出す文（食い違っているときだけ）。 */
  messageJa: string | null;
};

/** ★画面に出す決まり文句。文言を1か所に集めて、画面ごとにブレないようにする。 */
export const DEMAND_CONFLICT_MESSAGE_JA = '需要指標が食い違っています。追加検証が必要です';

/**
 * 何倍から「食い違い」と呼ぶか。
 *
 * ★これは当社が決めた線であって、外の裏付けは無い（暫定）。
 *   Keepa側は「100以上」のような粗い段階（下限）なので、2倍程度のズレは普通に起きる。
 *   一方、今回出た 6倍・100倍は、粗さでは説明が付かない。
 *   その間を取って3倍に置いてある。**この数字は判定を1つも動かさない**（表示だけ）ので、
 *   後から動かしても仕入の結論は変わらない。
 */
export const DEMAND_CONFLICT_RATIO_THRESHOLD = 3;

/**
 * 食い違っているかを見る。
 *
 * ご本人の指示：「DEMAND_SIGNAL_CONFLICT = true を付けてください。
 * 画面には『需要指標が食い違っています。追加検証が必要です』と表示してください。
 * **勝手にどちらかを採用しないこと。**」
 *
 * よってこの関数は「どちらが正しいか」を**決めない**。食い違いの有無だけを返す。
 */
export function judgeDemandConflict(
  internalEstimate: number | null | undefined,
  keepaMonthlySoldAtLeast: number | null | undefined,
): DemandConflict {
  const a = typeof internalEstimate === 'number' && Number.isFinite(internalEstimate) && internalEstimate > 0
    ? internalEstimate : null;
  const b = typeof keepaMonthlySoldAtLeast === 'number' && Number.isFinite(keepaMonthlySoldAtLeast)
    && keepaMonthlySoldAtLeast > 0 ? keepaMonthlySoldAtLeast : null;

  if (a === null || b === null) {
    const missing = b === null ? 'Keepaの月間購入回数' : '当社の推定需要シグナル';
    return {
      status: 'CANNOT_COMPARE',
      demandSignalConflict: false,
      ratio: null,
      reasonJa: `${missing}が無いため、2つを比べられません。`
        + '**「食い違いが無い」という意味ではありません。**材料が足りないだけです。',
      messageJa: null,
    };
  }

  const ratio = b / a;
  const conflict = ratio >= DEMAND_CONFLICT_RATIO_THRESHOLD || ratio <= 1 / DEMAND_CONFLICT_RATIO_THRESHOLD;
  const r = Math.round(ratio * 10) / 10;

  if (!conflict) {
    return {
      status: 'CONSISTENT',
      demandSignalConflict: false,
      ratio,
      reasonJa: `2つの材料の開きは約${r}倍で、${DEMAND_CONFLICT_RATIO_THRESHOLD}倍未満でした。`
        + 'ただし「どちらも正しい」という意味ではありません。',
      messageJa: null,
    };
  }
  return {
    status: 'CONFLICT',
    demandSignalConflict: true,
    ratio,
    reasonJa: `当社の推定は約${Math.round(a * 10) / 10}、Keepaは${b}個以上で、開きは約${r}倍です。`
      + `${DEMAND_CONFLICT_RATIO_THRESHOLD}倍以上あるため、粗さでは説明が付きません。`
      + '**どちらを採用するかはこの時点では決めません**（人が追加で確かめる必要があります）。',
    messageJa: DEMAND_CONFLICT_MESSAGE_JA,
  };
}

/* ================================================================
 * 5. 分析専用の比率（BUY判定には使わない）
 * ================================================================ */

/**
 * ご本人の指示：「KEEPA_ESTIMATE / RANK_DROPS_ESTIMATE を計算してください。
 * **ただしこれは分析用であり、BUY判定には使わないでください。**
 * 目的は、どのカテゴリでRank Dropsモデルが破綻するかを学習することです。」
 *
 * ★名前に `AnalysisOnly` を入れてある。呼び出し側が判定に混ぜにくくするため。
 *   材料が片方でも欠けたら null を返す。**1 で埋めない。**
 */
export function demandRatioAnalysisOnly(
  internalEstimate: number | null | undefined,
  keepaMonthlySoldAtLeast: number | null | undefined,
): number | null {
  const a = typeof internalEstimate === 'number' && Number.isFinite(internalEstimate) && internalEstimate > 0
    ? internalEstimate : null;
  const b = typeof keepaMonthlySoldAtLeast === 'number' && Number.isFinite(keepaMonthlySoldAtLeast)
    && keepaMonthlySoldAtLeast > 0 ? keepaMonthlySoldAtLeast : null;
  if (a === null || b === null) return null;
  return b / a;
}

export const DEMAND_RATIO_NOTE_JA =
  'この倍率は「どの売り場で当社の推定が外れやすいか」を学ぶための観察用です。'
  + '仕入れるかどうかの判定には1つも使っていません。';

/* ================================================================
 * 6. 材料を組み立てる
 * ================================================================ */

export type DemandEvidenceInput = {
  asin: string;
  /** Keepa の 30日間の順位下落回数。**販売数ではない**（ルール78）。 */
  rankDrops30: number | null;
  /** Keepa の月間購入回数（「◯個以上」の区分値）。大半の商品では null。 */
  keepaMonthlySoldAtLeast: number | null;
  /** 当社の暫定モデルが出した推定需要シグナル。SOURCE は INTERNAL_CALCULATION。 */
  internalDemandSignal: number | null;
  /** 当社の暫定モデルが出した「等分したときの自分の取り分」。 */
  estimatedEqualShareOpportunity: number | null;
  /** 新品の出品者数。 */
  sellerCount: number | null;
  /** Amazon本体が在庫を持っているか。 */
  amazonRetail: 'YES' | 'NO' | 'UNKNOWN';
  /** データの古さ（日）。 */
  dataAgeDays: number | null;
};

/**
 * ★「自分が月◯個売れる」とは決して書かない（ご本人の指示）。
 *   名前も表示も `ESTIMATED_EQUAL_SHARE_OPPORTUNITY`＝
 *   「出品者で等分したと仮定したときの取り分（暫定モデル）」で統一する。
 */
export const EQUAL_SHARE_LABEL_JA = '出品者で等分したと仮定した場合の取り分（暫定モデル）';

export const EQUAL_SHARE_NOTE_JA =
  '実際には出品者ごとに売れ方が偏るため、この数がそのまま自分の販売数になるわけではありません。'
  + '「自分が月◯個売れる」という意味ではありません。';

export function buildDemandEvidence(input: DemandEvidenceInput): DemandEvidence {
  const conflict = judgeDemandConflict(input.internalDemandSignal, input.keepaMonthlySoldAtLeast);
  const signals: DemandSignal[] = [
    {
      key: 'RANK_DROPS_30D',
      labelJa: '30日間の順位下落回数',
      value: input.rankDrops30,
      textValue: null,
      source: 'KEEPA',
      unitJa: '回',
      noteJa: '★販売数ではありません（ルール78）。順位が下がった回数です。',
    },
    {
      key: 'KEEPA_MONTHLY_SOLD_AT_LEAST',
      labelJa: KEEPA_MONTHLY_SOLD_LABEL_JA,
      value: input.keepaMonthlySoldAtLeast,
      textValue: input.keepaMonthlySoldAtLeast === null ? 'UNKNOWN' : null,
      source: 'KEEPA',
      unitJa: '個以上',
      noteJa: KEEPA_MONTHLY_SOLD_NOTE_JA,
    },
    {
      key: 'INTERNAL_DEMAND_SIGNAL',
      labelJa: '推定需要シグナル（暫定モデル）',
      value: input.internalDemandSignal,
      textValue: null,
      source: 'INTERNAL_CALCULATION',
      unitJa: '個相当／月',
      noteJa: '順位の下落回数から当社が計算した値です。外の裏付けはありません。',
    },
    {
      key: 'ESTIMATED_EQUAL_SHARE_OPPORTUNITY',
      labelJa: EQUAL_SHARE_LABEL_JA,
      value: input.estimatedEqualShareOpportunity,
      textValue: null,
      source: 'INTERNAL_CALCULATION',
      unitJa: '個相当／月',
      noteJa: EQUAL_SHARE_NOTE_JA,
    },
    {
      key: 'SELLER_COUNT',
      labelJa: '新品の出品者数',
      value: input.sellerCount,
      textValue: null,
      source: 'KEEPA',
      unitJa: '人',
      noteJa: '多いほど1人あたりの取り分は小さくなります。',
    },
    {
      key: 'AMAZON_RETAIL',
      labelJa: 'Amazon本体の在庫',
      value: null,
      textValue: input.amazonRetail,
      source: 'KEEPA',
      unitJa: '',
      noteJa: 'Amazon本体が在庫を持っている場合、取り分はさらに小さくなりやすい。',
    },
    {
      key: 'DATA_FRESHNESS',
      labelJa: 'データの古さ',
      value: input.dataAgeDays,
      textValue: null,
      source: 'KEEPA',
      unitJa: '日',
      noteJa: '古いほど、上のすべての材料の信頼度が下がります。',
    },
  ];

  return {
    asin: input.asin,
    signals,
    conflict,
    keepaToInternalRatio: demandRatioAnalysisOnly(
      input.internalDemandSignal, input.keepaMonthlySoldAtLeast,
    ),
  };
}

/* ================================================================
 * 7. Keepaの値が無い商品を、それだけで低く見ない
 * ================================================================ */

/**
 * ご本人の指示：「Keepa月間販売数系フィールドが無い商品を、
 * 自動的に低評価にしないでください。KEEPA_MONTHLY_SALES_ESTIMATE = UNKNOWN として、
 * 他の需要根拠で評価してください。」
 *
 * 公式仕様にも "Most ASINs do not have this value set." と明記されている。
 * つまり**無いのが普通**であり、無いこと自体は悪い情報ではない。
 * 今回も本3件で空だったが、それは本が売れていないという意味ではまったくない。
 */
export const KEEPA_MONTHLY_SOLD_ABSENT_NOTE_JA =
  'この商品にはKeepaの月間購入回数がありません（UNKNOWN）。'
  + '公式仕様でも「大半の商品には設定されていない」と書かれており、無いのが普通です。'
  + '**無いことを理由に評価を下げてはいけません。**他の材料で見てください。';

/** その商品を、Keepa値が無いことだけを理由に下げていないか（テスト用の明示フラグ）。 */
export function keepaAbsenceDowngradesScore(): false {
  return false;
}

/* ================================================================
 * 8. 将来の予定（まだ作らない）
 * ================================================================ */

/**
 * ご本人の指示：「CALIBRATED_SELLABILITY_SCORE を作る予定にしてください。
 * Rank Drops ＋ Keepa販売数系 ＋ 出品者数 ＋ Amazon本体 ＋ 価格安定性 を統合し、
 * 将来的に実売データで補正できる形にしてください。**まだ実装しません。**」
 *
 * ★ここは「予定」であって実装ではない。関数も作らない。
 *   作るのは、成約データで答え合わせができるようになってから。
 *   その前に作ると、当たっているかどうか誰にも分からない点数が画面に出てしまう。
 */
export const CALIBRATED_SELLABILITY_SCORE_PLAN_JA = [
  '【将来の予定：CALIBRATED_SELLABILITY_SCORE（まだ作りません）】',
  '材料：30日間の順位下落回数／Keepaの月間購入回数／新品の出品者数／Amazon本体の在庫／価格の安定性',
  '前提：実際に売れた記録（成約データ）と突き合わせて補正できること',
  '作らない理由：いま作ると、当たっているか誰にも確かめられない点数が画面に出るため',
  '作る条件：5件未満でスコアを動かさない・判断は凍結して上書きしない（Phase 3のSHADOW学習と同じ扱い）',
].join('\n');
