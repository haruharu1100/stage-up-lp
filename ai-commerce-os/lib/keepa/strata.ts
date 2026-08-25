/**
 * 100件の「売り場のばらけさせ方」を決める（Phase 3.15・2026-08-25）
 * ================================================================
 *
 * 【なぜこのファイルができたか】
 * ご本人の指示（原文・2026-08-25）：
 *   「100件へ進むこと自体は許可します。ただし、**現在の候補取得方法のまま、
 *     単純にあと80件増やすことは禁止**とします。」
 *   「本が10/20件と偏っているので、このまま100件にすると
 *     『本に強い判定ロジック』へ寄る可能性があります。」
 *
 * 20件テストの中身は 本10 ／ おもちゃ4 ／ ゲーム2 ／ ビューティー1 ／
 * PCソフト1 ／ 家電1 ／ 洋書1 だった。半分が本である。
 * このまま80件足すと「本で使える指標」を「全体で使える指標」と誤解する。
 * だから**先に配分表を決めて、足りない売り場から順に取る**。
 *
 * 【このファイルが絶対にしないこと】
 *  1. **通信しない。** 枠（Token）を1つも使わない。ここは計画を立てるだけ。
 *  2. **売り場の番号（catId）を1つも書かない。**
 *     番号を推測で書くと、間違っていても検索は成功してしまう（ルール108）。
 *     実行時に Keepa の公式一覧をもらって**名前で**突き合わせる。
 *  3. **数を見栄え良く揃えない。** ご本人の指示（原文）：
 *     「見つからなければ TARGET_NOT_REACHED として終了。
 *       **無理に100件を見栄え良く揃えないこと。**」
 *  4. **すでに取得済みの商品を取り直さない。** 追加で取るのは80件だけ。
 *
 * 【このファイルは何も import しない】
 * 画面（'use client'）へそのまま載せられるようにするため（ルール37）。
 */

/* ================================================================
 * 1. 配分表（100件をどう割るか）
 * ================================================================ */

/**
 * ご本人の指示（原文・2026-08-25）：
 *   「本・洋書 15 ／ ゲーム 10 ／ おもちゃ・ホビー 15 ／ 家電・カメラ 15 ／
 *     PC・PC周辺・ソフト 10 ／ 日用品 10 ／ ビューティー 10 ／ その他型番商品 15 ＝ 100件」
 *   「既存20件はこの中へ含めます。既に多いカテゴリは追加数を減らしてください。」
 *   「**厳密な市場構成比を再現する必要はありません。**」
 *
 * ★`searchableByName` が false の枠は、**名前では探しに行かない**。
 *   「その他型番商品」は売り場の名前ではなく商品の性質なので、
 *   Keepa の売り場一覧に同じ名前は存在しない。
 *
 * ★ただし「名前で探せない」＝「一生0件」にはしない（2026-08-25 修正）。
 *   受け皿にしただけだと、その枠は**構造上ぜったいに埋まらない**。
 *   それは「探したけれど見つからなかった（TARGET_NOT_REACHED）」とは別物で、
 *   最初から届かないと分かっている目標を配分表に置いていることになる。
 *   そこで「その他型番商品」だけは **`searchByExclusion`＝上の7枠のどの言葉にも
 *   当てはまらない売り場**を、Keepa の公式な売り場一覧の中から拾って探す。
 *   売り場の番号を直書きするわけではないので、ルール108（名前で突き合わせる）は守られている。
 */
export const KEEPA_HUNDRED_STRATA: {
  key: string;
  labelJa: string;
  /** この売り場で目標とする件数（既存分を含む） */
  target: number;
  /** Keepa の売り場名にこの言葉が含まれていたら、この枠とみなす */
  keywords: string[];
  /** 名前で探しに行ける枠か。false なら名前では探さない */
  searchableByName: boolean;
  /** ほかのどの枠にも当てはまらない売り場を選んで探す枠か（「その他」用） */
  searchByExclusion: boolean;
  noteJa: string;
}[] = [
  {
    key: 'BOOKS',
    labelJa: '本・洋書',
    target: 15,
    keywords: ['本', '洋書'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: '20件テストで最も多かった枠（11件）。目標15なので、追加はごくわずかで足りる。',
  },
  {
    key: 'GAMES',
    labelJa: 'ゲーム',
    target: 10,
    keywords: ['ゲーム', 'テレビゲーム'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: 'ダウンロード版が混ざると型番商品ではなくなるため、結果の売り場名を必ず確認する。',
  },
  {
    key: 'TOYS_HOBBY',
    labelJa: 'おもちゃ・ホビー',
    target: 15,
    keywords: ['おもちゃ', 'ホビー'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: 'Keepa 側で「おもちゃ」と「ホビー」が別売り場のことがある。どちらもこの枠に数える。',
  },
  {
    key: 'ELECTRONICS',
    labelJa: '家電・カメラ',
    target: 15,
    keywords: ['家電', 'カメラ'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: '20件テストで1件しか取れなかった枠。ここが薄いままだと家電で使える指標が分からない。',
  },
  {
    key: 'PC',
    labelJa: 'PC・PC周辺・ソフト',
    target: 10,
    keywords: ['パソコン', 'PC', 'ソフトウェア'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: 'ソフトは在庫切れの出方が他と違う可能性がある。分けて数える。',
  },
  {
    key: 'DAILY',
    labelJa: '日用品',
    target: 10,
    keywords: ['ドラッグストア', '日用品'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: '消耗品は順位の下落回数が多く出やすい。ここが Rank Drops の上振れを見る枠になる。',
  },
  {
    key: 'BEAUTY',
    labelJa: 'ビューティー',
    target: 10,
    keywords: ['ビューティー', 'コスメ'],
    searchableByName: true,
    searchByExclusion: false,
    noteJa: '20件テストでは1件だけ。日用品と分けて数える（同じ枠に混ぜない）。',
  },
  {
    key: 'OTHER_MODEL_NUMBER',
    labelJa: 'その他型番商品',
    target: 15,
    keywords: [],
    searchableByName: false,
    searchByExclusion: true,
    noteJa:
      '「その他型番商品」という売り場は Keepa に存在しないので、名前では探せない。'
      + 'かわりに**上の7枠のどの言葉にも当てはまらない売り場**（文房具・スポーツ・車用品・楽器など）'
      + 'から探す。売り場の番号を直書きしないので、名前で突き合わせる決まりは守られている。',
  },
];

/** 配分表の合計（＝100）。ここがずれていたら計画そのものが間違っている。 */
export const KEEPA_HUNDRED_TARGET_TOTAL = KEEPA_HUNDRED_STRATA.reduce((s, x) => s + x.target, 0);

/** 売り場の名前が取れていない商品を入れる場所。**「その他型番商品」に混ぜない。** */
export const STRATUM_UNASSIGNED = 'UNASSIGNED' as const;

/** 売り場の名前が取れていない商品の説明。 */
export const STRATUM_UNASSIGNED_JA =
  '売り場不明（Keepaから名前が取れず）。'
  + '「その他型番商品」とは別に数えます。名前が取れなかっただけで、型番商品とは限らないためです。';

/**
 * 売り場の名前から、どの枠に入るかを決める。
 *
 * ★名前が無い（null／空）ときは UNASSIGNED を返す。
 *   ここで「その他」に落とすと、**取れなかった商品**と**その他だった商品**が同じ顔になる。
 */
export function assignStratum(categoryJa: string | null | undefined): {
  key: string;
  labelJa: string;
  matchedKeywordJa: string | null;
} {
  const name = String(categoryJa ?? '').trim();
  if (name === '') {
    return { key: STRATUM_UNASSIGNED, labelJa: STRATUM_UNASSIGNED_JA, matchedKeywordJa: null };
  }
  for (const s of KEEPA_HUNDRED_STRATA) {
    for (const k of s.keywords) {
      if (name.includes(k)) return { key: s.key, labelJa: s.labelJa, matchedKeywordJa: k };
    }
  }
  const other = KEEPA_HUNDRED_STRATA.find((s) => s.searchByExclusion);
  return {
    key: other ? other.key : STRATUM_UNASSIGNED,
    labelJa: other ? other.labelJa : STRATUM_UNASSIGNED_JA,
    matchedKeywordJa: null,
  };
}

/**
 * 「その他型番商品」の枠として探してよい売り場かどうか。
 * ＝ 上の7枠のどのキーワードにも当てはまらない売り場。
 * **番号ではなく名前で判定する**（ルール108）。
 */
export function isExclusionCategory(categoryNameJa: string): boolean {
  const name = String(categoryNameJa ?? '').trim();
  if (name === '') return false;
  for (const s of KEEPA_HUNDRED_STRATA) {
    for (const k of s.keywords) {
      if (name.includes(k)) return false;
    }
  }
  return true;
}

/* ================================================================
 * 2. 既存分を配分表へ当てはめて、あと何件必要かを出す
 * ================================================================ */

export type StratumPlan = {
  key: string;
  labelJa: string;
  target: number;
  /** すでに保存してある件数 */
  already: number;
  /** これから取る件数（目標を超えていたら0。マイナスにしない） */
  remaining: number;
  /** 目標より多く持っている件数（0以上）。減らしはしない（消さない） */
  overshoot: number;
  searchableByName: boolean;
  searchByExclusion: boolean;
  noteJa: string;
};

export type HundredPlan = {
  strata: StratumPlan[];
  /** 目標合計（100） */
  targetTotal: number;
  /** 保存済み合計 */
  alreadyTotal: number;
  /** これから取る合計 */
  remainingTotal: number;
  /** 売り場名が取れず、どの枠にも入れられなかった件数 */
  unassigned: number;
  noteJa: string;
};

/**
 * ご本人の指示（原文）：
 *   「既存20件はこの中へ含めます。既に多いカテゴリは追加数を減らしてください。」
 *   「**既存20件を再取得しないこと。追加80件だけ取得。**」
 *
 * ★目標を超えている枠は remaining = 0 にするだけで、**持っている分は捨てない**。
 *   すでに枠を使って取ったデータを捨てるのは、二重に無駄である。
 */
export function planHundred(saved: { asin: string; categoryJa: string | null }[]): HundredPlan {
  const counts = new Map<string, number>();
  let unassigned = 0;

  for (const row of saved) {
    const a = assignStratum(row.categoryJa);
    if (a.key === STRATUM_UNASSIGNED) {
      unassigned += 1;
      continue;
    }
    counts.set(a.key, (counts.get(a.key) ?? 0) + 1);
  }

  const strata: StratumPlan[] = KEEPA_HUNDRED_STRATA.map((s) => {
    const already = counts.get(s.key) ?? 0;
    return {
      key: s.key,
      labelJa: s.labelJa,
      target: s.target,
      already,
      remaining: s.searchableByName || s.searchByExclusion ? Math.max(0, s.target - already) : 0,
      overshoot: Math.max(0, already - s.target),
      searchableByName: s.searchableByName,
      searchByExclusion: s.searchByExclusion,
      noteJa: s.noteJa,
    };
  });

  return {
    strata,
    targetTotal: KEEPA_HUNDRED_TARGET_TOTAL,
    alreadyTotal: saved.length,
    remainingTotal: strata.reduce((sum, s) => sum + s.remaining, 0),
    unassigned,
    noteJa:
      '売り場名が取れなかった商品は、どの枠にも数えていません（「その他型番商品」に混ぜていません）。'
      + 'そのぶん、これから取る合計は80件より多く見えることがあります。'
      + '**足りない分を埋めるために条件を緩めることはしません。**'
      + '見つからない売り場は、足りないまま「届かなかった」として終わります。',
  };
}

/* ================================================================
 * 3. 1つの売り場に、どこまで枠を使ってよいか
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「カテゴリを揃えるために大量Tokenを浪費してはいけません。
 *     カテゴリごとに MAX_DISCOVERY_ATTEMPTS MAX_DISCOVERY_TOKENS を設定してください。
 *     見つからなければ TARGET_NOT_REACHED として終了。」
 *
 * 1回の候補探しは 13 枠（10 + 300件ぶん3）。
 * 2回で 26 枠。1つの売り場にこれ以上は使わない。
 */
export const KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS = 2;
export const KEEPA_STRATUM_MAX_DISCOVERY_TOKENS = 26;

/**
 * 全部の売り場を合わせた候補探しの上限。
 * 7売り場 × 2回 = 182 枠まで理屈上は行けるが、そこまでは使わせない。
 * 1回目（7売り場 × 13 = 91）＋ 足りない売り場の2回目を数回ぶん、で打ち切る。
 */
export const KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL = 120;

/** 追加で下見する商品数の上限（1件1枠）。既存20件は取り直さないので80。 */
export const KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS = 80;

/** Deep Scan の予算。**0**。ご本人の指示：「まだDeep Scanは禁止。」 */
export const KEEPA_HUNDRED_DEEP_SCAN_TOKENS = 0;

/** 100件ぶん全体の枠の上限（分類の一覧1＋候補探し120＋下見80＋Deep Scan 0）。 */
export const KEEPA_HUNDRED_TOKEN_BUDGET_TOTAL =
  1 + KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL + KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS
  + KEEPA_HUNDRED_DEEP_SCAN_TOKENS;

/** 1つの売り場の探索がどう終わったか。 */
export const STRATUM_OUTCOMES = [
  'TARGET_REACHED',
  'TARGET_NOT_REACHED',
  'ALREADY_FULL',
  'NOT_SEARCHED_BY_DESIGN',
] as const;
export type StratumOutcome = (typeof STRATUM_OUTCOMES)[number];

export const STRATUM_OUTCOME_JA: Record<StratumOutcome, string> = {
  TARGET_REACHED: '目標の件数に届きました。',
  TARGET_NOT_REACHED:
    '目標の件数に届きませんでした。**条件を緩めていません。**'
    + '足りないまま終わるのが正しい終わり方です（見栄えのために水増ししません）。',
  ALREADY_FULL: 'すでに目標の件数を持っていたので、探しませんでした（枠0）。',
  NOT_SEARCHED_BY_DESIGN:
    '設計上、探しに行かない枠です。ほかの枠に入らなかった商品が入ります。',
};

/**
 * 1つの売り場について、まだ探してよいかを判定する。
 * 「もう1回探すか」を決めるのはここだけ。呼び出し側で条件を書き足さない。
 */
export function canSearchStratum(state: {
  attemptsSoFar: number;
  tokensSpentOnThisStratum: number;
  tokensSpentOnDiscoveryTotal: number;
  remaining: number;
  searchableByName: boolean;
  /** 「その他」枠のように、除外条件で探しに行く枠か */
  searchByExclusion?: boolean;
  nextAttemptCost: number;
}): { allowed: boolean; reasonJa: string; outcomeIfStopped: StratumOutcome | null } {
  if (!state.searchableByName && !state.searchByExclusion) {
    return {
      allowed: false,
      reasonJa: STRATUM_OUTCOME_JA.NOT_SEARCHED_BY_DESIGN,
      outcomeIfStopped: 'NOT_SEARCHED_BY_DESIGN',
    };
  }
  if (state.remaining <= 0) {
    return { allowed: false, reasonJa: STRATUM_OUTCOME_JA.ALREADY_FULL, outcomeIfStopped: 'ALREADY_FULL' };
  }
  if (state.attemptsSoFar >= KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS) {
    return {
      allowed: false,
      reasonJa: `この売り場の探索は${KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS}回までと決めています。`
        + STRATUM_OUTCOME_JA.TARGET_NOT_REACHED,
      outcomeIfStopped: 'TARGET_NOT_REACHED',
    };
  }
  if (state.tokensSpentOnThisStratum + state.nextAttemptCost > KEEPA_STRATUM_MAX_DISCOVERY_TOKENS) {
    return {
      allowed: false,
      reasonJa: `この売り場に使ってよい枠（${KEEPA_STRATUM_MAX_DISCOVERY_TOKENS}）を超えるので探しません。`
        + STRATUM_OUTCOME_JA.TARGET_NOT_REACHED,
      outcomeIfStopped: 'TARGET_NOT_REACHED',
    };
  }
  if (
    state.tokensSpentOnDiscoveryTotal + state.nextAttemptCost
    > KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL
  ) {
    return {
      allowed: false,
      reasonJa: `候補探し全体の上限（${KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL}枠）を超えるので探しません。`
        + STRATUM_OUTCOME_JA.TARGET_NOT_REACHED,
      outcomeIfStopped: 'TARGET_NOT_REACHED',
    };
  }
  return { allowed: true, reasonJa: '探してよい範囲です。', outcomeIfStopped: null };
}

/* ================================================================
 * 4. チェックポイント（20 → 40 → 70 → 100）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「いきなり80件全部を一気に取得しないでください。
 *     20件 → 40件 → 70件 → 100件 の区切りで確認してください。
 *     各チェックポイントで問題がなければ、人間承認を毎回求めなくて構いません。」
 */
export const KEEPA_HUNDRED_CHECKPOINTS = [20, 40, 70, 100] as const;

/** 区切りごとに人間の承認をもらうか。**もらわない**（問題が無ければ進んでよい、というご本人の指示）。 */
export const KEEPA_HUNDRED_CHECKPOINT_NEEDS_HUMAN_APPROVAL = false;

/** 100件に届いたあと、自動で次（Deep Scan）へ進むか。**進まない。** */
export const KEEPA_HUNDRED_AUTO_ADVANCE_TO_DEEP_SCAN = false;

/**
 * ご本人の指示（原文）：
 *   「自動停止条件（これが出たら止める）
 *     PARSER_ERROR > 0 ／ 未対応の NEW_SCHEMA_DRIFT ／ TOKEN_MISMATCH > 0 ／
 *     WRONG_MARKETPLACE > 0 ／ FALSE_ASIN > 0 ／ SECRET_LEAK > 0 ／ 異常なUNKNOWN急増」
 *
 * ★逆に言えば、**この7つ以外では止めない**。
 *   「なんとなく少ない」「なんとなく偏っている」で止めると、
 *   止めた理由が後から検算できない。
 */
export const KEEPA_HUNDRED_STOP_CONDITIONS = [
  { code: 'PARSER_ERROR', labelJa: '当社の読み取り不具合' },
  { code: 'NEW_SCHEMA_DRIFT', labelJa: 'まだ扱いを決めていない、新しい形の違い' },
  { code: 'TOKEN_MISMATCH', labelJa: '枠の見積りと実消費のズレ' },
  { code: 'WRONG_MARKETPLACE', labelJa: '日本以外のAmazonが混ざった' },
  { code: 'FALSE_ASIN', labelJa: '実在しないASIN' },
  { code: 'SECRET_LEAK', labelJa: 'APIキーが外へ出た' },
  { code: 'UNKNOWN_RATE_ANOMALY', labelJa: '「不明」の割合が急に増えた' },
] as const;

/**
 * 5件テスト・20件テストで**すでに見つけていて、扱いを決めてある**形の違い。
 * ここに載っている場所は「新しい形の違い」に数えない。
 * 逆に、ここに無い場所で形が割れたら NEW_SCHEMA_DRIFT として止める。
 *
 * ・availabilityAmazonDelay … 「要素2個の配列」と「項目そのものが無い」
 * ・model / partNumber      … 「空」と「文字」（本には型番が無い、など正常な違い）
 *
 * ★2026-08-25、100件取得の**40件の区切りで実際に止まって**、2か所を追加した。
 *   歯止めが設計どおり働いた記録として、経緯を残す。
 *
 *   止まった時点で見つかったのは `eanList` と `upcList` の2つ。
 *   保存済みの生データだけで調べた（**枠は1つも使っていない**。ルール「修正の検算は生データで」）：
 *     eanList … 配列36件／null 2件（B07B8J2WPF・B0FLY19YXD）
 *     upcList … null 36件／配列 2件（B009S333U4・B0F38KCL5N）
 *
 *   原因はバーコードの規格が地域で違うことで、**Keepaの異常でも当社の不具合でもない**。
 *   日本で売られている商品にはJAN（＝EAN）が付き、アメリカ由来の商品にはUPCが付く。
 *   片方しか無い商品も、両方とも無い商品も普通にある。
 *
 *   ★「実害が無さそうだから黙って通す」ではない。ここを取り違えるとルール95の再来になる。
 *     `lib/keepa/schema.ts` はこの2か所を最初から `expected: ['array', 'null']` と
 *     宣言してあり、`normalize.ts` の strList() は配列でない値を必ず空配列にする。
 *     実際、40件の区切りで**当社の読み取り不具合は0件**だった。
 *     「値はあるのに読めていない」（PARSER_OR_SCHEMA_ERROR）とは別物であることを
 *     確かめたうえで、扱い済みへ移している。
 *
 * ★同日、**70件の区切りでもう一度止まった**。今度は手数料の3か所。
 *   `fbaFees` / `referralFeePercentage` / `referralFeePercent`。
 *   手数料は利益計算に直結するので、前より慎重に調べた（ここも枠は0）。
 *
 *   ①68件のうち **67件は手数料が付いてきていて、付いてこなかったのは1件だけ**
 *     （B085QS1PST。fbaFees が null で、率は項目そのものが無い）。
 *     これは「Keepa側に値が無い」＝ DATA_NOT_AVAILABLE であって当社の不具合ではない。
 *     ルール40のとおり、**不明な手数料を0円として足していない**ので、
 *     この1件は手数料不明のまま残る（0円で埋めると利益が過大に出る）。
 *
 *   ②`referralFeePercentage`（新）と `referralFeePercent`（旧）は**別の数字**だった。
 *     68件中67件で値が違い、新は 15.41 / 15.4 / 15.43 のような小数、旧は一律 15。
 *     旧は「カテゴリの区分としての率」、新は「その商品に実際に当たる率」である。
 *     **当社が読んでいるのは新しい方（`referralFeePercentage`）だけ**で、これは正しい。
 *     ★ここで旧名の方が「きれいな数字」に見えるからと乗り換えてはいけない。
 *       乗り換えると、1件あたり0.4%ぶん手数料を少なく見積もることになる。
 *       ルール109（現在仕様を先に、旧名は後ろに）の具体例なので、旧名は
 *       「まだ来ているか」を見張る目的だけで並べておく。
 */
export const KEEPA_KNOWN_SCHEMA_DRIFT_PATHS = [
  'availabilityAmazonDelay',
  'model',
  'partNumber',
  'eanList',
  'upcList',
  'fbaFees',
  'referralFeePercentage',
  'referralFeePercent',
] as const;

/**
 * ご本人の指示（原文）：
 *   「UNKNOWN_RATE_ANOMALY を追加してください。
 *     例：40件までは価格取得率95%だったのに、70件で60%へ急落した場合、
 *     単なる『データなし』と決めつけず停止してください。
 *     Parser側の問題や、Keepa仕様変更の可能性があります。」
 *
 * ★「20ポイント以上下がったら異常」とする。
 *   95% → 60% は35ポイントの低下なので、当然ここに引っかかる。
 */
export const KEEPA_UNKNOWN_RATE_DROP_LIMIT_POINTS = 20;

export function judgeUnknownRateAnomaly(
  previousPercent: number | null,
  currentPercent: number | null,
): { anomaly: boolean; dropPoints: number | null; messageJa: string } {
  if (previousPercent === null || currentPercent === null) {
    return {
      anomaly: false,
      dropPoints: null,
      messageJa: '前回の割合が無いので比べられません（比べられないことを「異常なし」とは書きません）。',
    };
  }
  const drop = Math.round((previousPercent - currentPercent) * 10) / 10;
  if (drop >= KEEPA_UNKNOWN_RATE_DROP_LIMIT_POINTS) {
    return {
      anomaly: true,
      dropPoints: drop,
      messageJa:
        `取得できた割合が ${previousPercent}% → ${currentPercent}%（${drop}ポイント低下）。`
        + '**「データが無いだけ」と決めつけず、いったん止めます。**'
        + '当社の読み取りが壊れたか、Keepa側の仕様が変わった可能性があります。',
    };
  }
  return {
    anomaly: false,
    dropPoints: drop,
    messageJa: `取得できた割合の変化は ${drop}ポイント（上限${KEEPA_UNKNOWN_RATE_DROP_LIMIT_POINTS}）。範囲内です。`,
  };
}

export type CheckpointInput = {
  reachedCount: number;
  parserError: number;
  newSchemaDrift: number;
  tokenMismatch: number;
  wrongMarketplace: number;
  falseAsin: number;
  secretLeak: number;
  /** 直前の区切りでの「値が取れた割合」（%）。最初の区切りでは null。 */
  previousCoveragePercent: number | null;
  /** 今の区切りでの「値が取れた割合」（%）。分母0なら null。 */
  currentCoveragePercent: number | null;
};

export type CheckpointJudgement = {
  reachedCount: number;
  rows: { code: string; labelJa: string; value: string; passed: boolean }[];
  stop: boolean;
  verdictJa: string;
  needsHumanApproval: boolean;
};

/** 区切りごとの自動停止判定。**7つの条件だけを見る。** */
export function judgeCheckpoint(input: CheckpointInput): CheckpointJudgement {
  const anomaly = judgeUnknownRateAnomaly(input.previousCoveragePercent, input.currentCoveragePercent);

  const rows = [
    { code: 'PARSER_ERROR', labelJa: '当社の読み取り不具合', value: `${input.parserError}件`, passed: input.parserError === 0 },
    { code: 'NEW_SCHEMA_DRIFT', labelJa: 'まだ扱いを決めていない、新しい形の違い', value: `${input.newSchemaDrift}件`, passed: input.newSchemaDrift === 0 },
    { code: 'TOKEN_MISMATCH', labelJa: '枠の見積りと実消費のズレ', value: `${input.tokenMismatch}`, passed: input.tokenMismatch === 0 },
    { code: 'WRONG_MARKETPLACE', labelJa: '日本以外のAmazonが混ざった', value: `${input.wrongMarketplace}件`, passed: input.wrongMarketplace === 0 },
    { code: 'FALSE_ASIN', labelJa: '実在しないASIN', value: `${input.falseAsin}件`, passed: input.falseAsin === 0 },
    { code: 'SECRET_LEAK', labelJa: 'APIキーが外へ出た', value: `${input.secretLeak}件`, passed: input.secretLeak === 0 },
    { code: 'UNKNOWN_RATE_ANOMALY', labelJa: '「不明」の割合が急に増えた', value: anomaly.messageJa, passed: !anomaly.anomaly },
  ];

  const stop = rows.some((r) => !r.passed);
  return {
    reachedCount: input.reachedCount,
    rows,
    stop,
    verdictJa: stop
      ? `【止まります】${input.reachedCount}件の区切りで、上の×が出ました。次の区切りへは進みません。`
      : `${input.reachedCount}件の区切り：7つの停止条件はどれも出ていません。次の区切りへ進みます。`,
    needsHumanApproval: KEEPA_HUNDRED_CHECKPOINT_NEEDS_HUMAN_APPROVAL,
  };
}

/** 100件が終わったあとに何をするか。**Deep Scanも実購入もしない。** */
export const KEEPA_HUNDRED_AFTER_JA =
  '100件が集まっても、購入・出品・決済・発送には進みません。'
  + 'Keepa 100件は「Amazonの需要を読む仕組みが使えるか」の検証であって、'
  + '実売買の解禁条件ではありません（ご本人の指示・原文）。';
