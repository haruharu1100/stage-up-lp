/**
 * 【二段階取得：安い下見（Stage A）と、深追い（Stage B）】（Phase 3.12・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（CLAUDE.md ルール37）。
 *   画面（'use client'）から読んでもビルドが落ちないようにするため。
 *
 * ------------------------------------------------------------------
 * 【なぜ分けるのか】
 *
 * ご本人の指示（原文・2026-08-25）：
 *   「5件すべてについて、基本1 Token相当の取得を優先してください。
 *     最初から、Offers詳細 / Buy Box詳細 / Seller一覧 等の高Token取得を付けないでください。」
 *   「UNKNOWNを埋めるためだけに全商品へ重い取得をしないでください。」
 *   「目的は、Tokenを多く使った商品ほど良い分析になる という雑な設計を防ぐことです。」
 *
 * 空欄（UNKNOWN）があると、つい「もっと取れば埋まる」と考えたくなる。
 * だが埋めた先に判断が変わらないなら、その枠は捨てただけである。
 * だからこのファイルは、**「その空欄は、判断に要るのか」を先に聞く**形にした。
 *
 * ------------------------------------------------------------------
 * 【このファイルがやらないこと】
 *
 *  1. 通信しない。どこへも取りに行かない。「取ってよいか」を決めるだけ。
 *  2. 深追いを自動で始めない。候補として名前を挙げるところで必ず止まる。
 *  3. 空欄を埋めない。埋まらなかったことをそのまま数える。
 */

/* ================================================================
 * 1. 二段階（Stage A / Stage B）
 * ================================================================ */

export const KEEPA_SCAN_STAGES = ['CHEAP_SCAN', 'DEEP_SCAN'] as const;
export type KeepaScanStage = (typeof KEEPA_SCAN_STAGES)[number];

export const KEEPA_SCAN_STAGE_JA: Record<KeepaScanStage, string> = {
  CHEAP_SCAN: '下見（安い取得・1件1枠）',
  DEEP_SCAN: '深追い（追加の枠を使う取得）',
};

/**
 * 【Keepa 公式の実額】
 *
 * ★2026-08-25 に `https://keepa.com/api-docs/product.html` を実際に開いて確かめた原文。
 *   推測ではない。原文（Token Cost の表）：
 *
 *     Basic request (per requested product) ................ 1 token
 *     offers used .......................................... 6 tokens per found offer page
 *                                                            (up to 10 offers per page) per product;
 *                                                            the basic 1 token per ASIN does not apply
 *     offers used, succeeds but the product has no offers .. 5 tokens
 *     offers used, but offers retrieval/refresh fails ...... 1 token
 *     buybox=1 ............................................. +2 tokens per product
 *     stock=1 (with offers) ................................ +2 tokens per product
 *     rating=1 ............................................. up to +1 token per product
 *     historical-variations=1 .............................. +1 token per product with a parent ASIN
 *     stats, history, days, code-limit, only-live-offers,
 *     videos, aplus ........................................ no extra token cost
 *
 * つまり「下見」は1件1枠。「深追い」は**1件で最低5〜8枠**かかる。
 * 5件全部を深追いすると 40枠。下見だけなら 5枠。この差が、分ける理由そのものである。
 */
export const KEEPA_SCAN_COSTS = {
  /** 下見：商品1件あたり1枠 */
  CHEAP_SCAN_PER_ASIN: 1,
  /** 深追い：出品ページ1枚（最大10出品）あたり6枠 */
  DEEP_SCAN_PER_OFFER_PAGE: 6,
  /** 深追いに成功したが出品が1件も無かったとき（最低額） */
  DEEP_SCAN_MIN_IF_NO_OFFERS: 5,
  /** 深追いに失敗したとき（商品データは返る） */
  DEEP_SCAN_IF_FAILED: 1,
  /** Buy Box の詳細を頼んだときの追加 */
  DEEP_SCAN_BUYBOX_EXTRA: 2,
  /** 在庫数を頼んだときの追加（頼まない） */
  DEEP_SCAN_STOCK_EXTRA: 2,
} as const;

/**
 * 深追いを1件やると、だいたい何枠かかるか（人に見せる目安）。
 *
 * 出品ページ1枚（＝出品10件まで）＋Buy Box詳細 で 6 + 2 = 8。
 * ★これは**目安**であって請求額ではない。出品が11件以上あればページが増えて上がる。
 *   だから深追いを実行するときは、実際の消費額を必ず記録して照合する。
 */
export const KEEPA_DEEP_SCAN_TYPICAL_TOKENS =
  KEEPA_SCAN_COSTS.DEEP_SCAN_PER_OFFER_PAGE + KEEPA_SCAN_COSTS.DEEP_SCAN_BUYBOX_EXTRA;

/* ================================================================
 * 2. 下見で取る項目（Stage A）
 * ================================================================ */

export type KeepaScanFieldSpec = {
  key: string;
  labelJa: string;
  /** この項目が「判断のどこ」に効くか。効かない項目は、そもそも取らない。 */
  usedForJa: string;
};

/**
 * 【下見で取る13項目】
 *
 * ご本人が挙げた候補（原文）：
 *   商品名 / ブランド / JAN・EAN / 型番 / 現在価格 / 新品・中古価格 / Sales Rank /
 *   Rank Drops / Offer数 / Amazon本体 / 在庫切れ割合 / 手数料 / データ鮮度
 *
 * これらは全部、基本1枠の取得（`stats` を付けても追加枠なし）で返ってくる。
 * つまり**この13項目のために追加の枠を払う必要は無い**。
 */
export const KEEPA_CHEAP_SCAN_FIELDS: KeepaScanFieldSpec[] = [
  { key: 'title', labelJa: '商品名', usedForJa: '同一商品かどうかの確認' },
  { key: 'brand', labelJa: 'ブランド', usedForJa: '同一商品かどうかの確認' },
  { key: 'eanList', labelJa: 'JAN/EANコード', usedForJa: '同一商品かどうかの確認（いちばん強い手がかり）' },
  { key: 'model', labelJa: '型番', usedForJa: '同一商品かどうかの確認' },
  { key: 'currentNewPrice', labelJa: 'いまの新品価格', usedForJa: '利益が出るかの下ごしらえ' },
  { key: 'currentUsedPrice', labelJa: 'いまの中古価格', usedForJa: '状態違いの比較' },
  { key: 'salesRank', labelJa: '売れ筋順位', usedForJa: '売れているかの手がかり' },
  { key: 'rankDrops', labelJa: '順位が下がった回数（30/90/180/365日）', usedForJa: '売れているかの判定の中心' },
  { key: 'offerCountNew', labelJa: '新品の出品者数', usedForJa: 'ライバルの多さ' },
  { key: 'amazonOnListing', labelJa: 'Amazon本体が出品しているか', usedForJa: '別枠のリスク記録' },
  { key: 'outOfStockPercentage', labelJa: '在庫切れだった割合（30/90日）', usedForJa: '品切れが多い＝売れている可能性の裏取り' },
  { key: 'fees', labelJa: '手数料（FBA・紹介料）', usedForJa: '利益が出るかの下ごしらえ' },
  { key: 'lastUpdate', labelJa: 'データの鮮度（最終更新）', usedForJa: '古い数字で判断しないため' },
];

/**
 * 【下見では取れない項目（Stage B）】
 *
 * 下見の応答では、この3つは `-1`（値なし）や `-2`（今回は頼んでいない）で返る。
 * ★「-2 が返った」は**実装の失敗ではない**。頼んでいないだけである（ルール97）。
 */
export const KEEPA_DEEP_SCAN_FIELDS: KeepaScanFieldSpec[] = [
  { key: 'buyBoxDetail', labelJa: 'Buy Box（カート）の詳細', usedForJa: 'Amazonで実際に売るときの最終的な利益計算' },
  { key: 'offerList', labelJa: '出品者一覧（1件ずつの中身）', usedForJa: '誰がいくらで出しているかの内訳' },
  { key: 'fbaFbmSplit', labelJa: 'FBA / 自己発送の内訳', usedForJa: '自分がどちらで戦うかの判断' },
];

/* ================================================================
 * 3. Buy Box は本当に要るのか
 * ================================================================ */

export const BUY_BOX_PURPOSES = [
  'SELLABILITY_ONLY',
  'AMAZON_PROFIT_FINAL',
] as const;
export type BuyBoxPurpose = (typeof BUY_BOX_PURPOSES)[number];

export const BUY_BOX_PURPOSE_JA: Record<BuyBoxPurpose, string> = {
  SELLABILITY_ONLY: 'いまは「売れているか」を見ているだけ',
  AMAZON_PROFIT_FINAL: 'Amazonで実際に売ったときの利益を最終計算する',
};

export type BuyBoxRequirement = {
  required: boolean;
  reasonJa: string;
};

/**
 * 【Buy Box の詳細を取るべきか】
 *
 * ご本人の指示（原文）：
 *   「売れ行き判定にはBuy Box不要 → 基本取得だけ。
 *     最終的なAmazon販売利益計算に進む商品 → Buy Box詳細取得を検討。」
 *
 * 売れているかどうかは、順位が下がった回数と出品者数で見る。
 * カートを誰が持っているかは、そこには効かない。
 * 効くのは「自分がいくらで売れるか」を確定させる段になってからである。
 */
export function buyBoxRequiredForDecision(purpose: BuyBoxPurpose): BuyBoxRequirement {
  if (purpose === 'AMAZON_PROFIT_FINAL') {
    return {
      required: true,
      reasonJa:
        'Amazonで実際に売る値段を決める段階なので、いまカートを誰がいくらで持っているかが要ります。'
        + `深追いに切り替えると、目安で1件あたり${KEEPA_DEEP_SCAN_TYPICAL_TOKENS}枠かかります。`,
    };
  }
  return {
    required: false,
    reasonJa:
      'いまは「売れているか」だけを見ています。カートの持ち主はこの判定に効きません。'
      + 'そのため Buy Box が空欄でも、判定は「材料不足」になりません。追加の枠は使いません。',
  };
}

/* ================================================================
 * 4. 深追いしてよい商品を選ぶ関門
 * ================================================================ */

export type DeepScanGateInput = {
  /** データが新しいか（鮮度の線の内側か） */
  dataFresh: boolean | null | undefined;
  /** 売れるか判定の答え。'DOES_NOT_SELL' なら深追いしない。 */
  sellabilityVerdict: string | null | undefined;
  /** 下見で取れた項目の数 */
  cheapFieldsPresent: number | null | undefined;
  /** 読み取り側の不具合の件数。1件でもあれば深追いしない。 */
  parserErrorCount: number | null | undefined;
};

export type DeepScanGateResult = {
  /** 深追いの候補にしてよいか */
  candidate: boolean;
  /** 通った条件・落ちた条件を、日本語でそのまま並べたもの */
  checksJa: { labelJa: string; passed: boolean; detailJa: string }[];
  reasonJa: string;
};

/**
 * 下見の材料が「深追いに進めるだけ揃っているか」の線。
 *
 * ここを下げれば候補は増える。だから下げない（ルールと同じ考え方）。
 * 13項目のうち9項目未満しか取れていない商品は、深追いしても土台が無い。
 */
export const DEEP_SCAN_MIN_CHEAP_FIELDS = 9;

/**
 * 【深追いの候補にしてよいか】
 *
 * ご本人の指示（原文）：
 *   「DATA_FRESH = true / SELLABILITY != NOT_SELLING / PRODUCT_DATA_SUFFICIENT = true
 *     を満たすものだけ DEEP_SCAN_CANDIDATE に。
 *     ただし今回の5件テストでは、Deep Scanを実行する前に候補だけ報告してください。
 *     勝手に追加Tokenを使わないでください。」
 *
 * ★この関数は**候補かどうかを返すだけ**である。取得は一切しない。
 */
export function deepScanGate(i: DeepScanGateInput): DeepScanGateResult {
  const checksJa: DeepScanGateResult['checksJa'] = [];

  const fresh = i.dataFresh === true;
  checksJa.push({
    labelJa: 'データが新しい',
    passed: fresh,
    detailJa: fresh
      ? 'Keepa側の最終更新が、判定に使ってよい範囲の内側です。'
      : 'データが古い（または鮮度が分からない）ため、深追いしても古い相場を詳しく見るだけになります。',
  });

  const verdict = typeof i.sellabilityVerdict === 'string' ? i.sellabilityVerdict : '';
  const notDead = verdict !== '' && verdict !== 'DOES_NOT_SELL';
  checksJa.push({
    labelJa: '売れていない、ではない',
    passed: notDead,
    detailJa: notDead
      ? `売れるか判定は「${verdict}」です。深追いする値打ちが残っています。`
      : verdict === 'DOES_NOT_SELL'
        ? '売れていないと判定された商品です。カートの持ち主を詳しく調べても、売れない事実は変わりません。'
        : '売れるか判定そのものが出ていません。',
  });

  const present = typeof i.cheapFieldsPresent === 'number' ? i.cheapFieldsPresent : -1;
  const enough = present >= DEEP_SCAN_MIN_CHEAP_FIELDS;
  checksJa.push({
    labelJa: '下見の材料が足りている',
    passed: enough,
    detailJa: enough
      ? `下見の${KEEPA_CHEAP_SCAN_FIELDS.length}項目のうち${present}項目が取れています。`
      : `下見の${KEEPA_CHEAP_SCAN_FIELDS.length}項目のうち${present < 0 ? '不明' : present}項目しか取れていません（${DEEP_SCAN_MIN_CHEAP_FIELDS}項目以上が必要）。`,
  });

  const parserErrors = typeof i.parserErrorCount === 'number' ? i.parserErrorCount : -1;
  const clean = parserErrors === 0;
  checksJa.push({
    labelJa: '読み取り側の不具合が0件',
    passed: clean,
    detailJa: clean
      ? '読み取りの取りこぼしはありません。'
      : `読み取り側の不具合が${parserErrors < 0 ? '数えられていません' : `${parserErrors}件あります`}。直すのが先です。`,
  });

  const candidate = checksJa.every((c) => c.passed);
  const failed = checksJa.filter((c) => !c.passed).map((c) => c.labelJa);

  return {
    candidate,
    checksJa,
    reasonJa: candidate
      ? '深追いの候補にできます。ただし、ここでは候補に挙げるだけで、追加の枠は使いません。'
      : `深追いの候補にしません（満たしていない条件：${failed.join(' / ')}）。`,
  };
}

/**
 * 一度に深追いしてよい商品の数の上限。
 *
 * ご本人の指示（原文）：「Deep Scan候補　最大2件まで選ぶ。選ぶだけ。まだ取得しない。」
 * ★この数字は書き換えないと増えない。設定で増やせるようにしていない（ルール84）。
 */
export const KEEPA_DEEP_SCAN_MAX_CANDIDATES = 2;

/**
 * 深追いを自動で始めてよいか。**いいえ。**
 *
 * 候補を選ぶところまでが自動で、実際に枠を使うのは人が決める。
 */
export const KEEPA_DEEP_SCAN_AUTO_EXECUTE = false;

/* ================================================================
 * 5. 枠（Token）を用途別に分ける
 * ================================================================ */

export const KEEPA_TOKEN_BUCKETS = [
  'DISCOVERY_TOKENS',
  'BASE_SCAN_TOKENS',
  'DEEP_SCAN_TOKENS',
] as const;
export type KeepaTokenBucket = (typeof KEEPA_TOKEN_BUCKETS)[number];

export const KEEPA_TOKEN_BUCKET_JA: Record<KeepaTokenBucket, string> = {
  DISCOVERY_TOKENS: '候補を探すのに使った枠',
  BASE_SCAN_TOKENS: '下見（安い取得）に使った枠',
  DEEP_SCAN_TOKENS: '深追いに使った枠',
};

/**
 * 取得の目的から、どの入れ物に足すかを決める。
 *
 * ご本人の指示（原文）：
 *   「候補検索に使うTokenと、商品データ取得に使うTokenを分けて管理してください。
 *     DISCOVERY_TOKENS / PRODUCT_FETCH_TOKENS / DEEP_SCAN_TOKENS」
 *
 * 混ぜて1つの合計にすると、「候補探しが高いのか、商品取得が高いのか」が永久に分からない。
 */
export function tokenBucketOfPurpose(purpose: string): KeepaTokenBucket | null {
  switch (purpose) {
    case 'DISCOVERY': return 'DISCOVERY_TOKENS';
    // 分類番号をもらう1枠も「候補を探すための費用」である。
    // 商品取得の側に入れると、商品1件あたりの単価が実際より高く見える。
    case 'CATEGORY_LOOKUP': return 'DISCOVERY_TOKENS';
    case 'PRODUCT_FETCH': return 'BASE_SCAN_TOKENS';
    case 'DEEP_SCAN': return 'DEEP_SCAN_TOKENS';
    default: return null;
  }
}

export type TokenLedger = Record<KeepaTokenBucket, number> & { TOTAL_TOKENS: number };

export function emptyTokenLedger(): TokenLedger {
  return {
    DISCOVERY_TOKENS: 0,
    BASE_SCAN_TOKENS: 0,
    DEEP_SCAN_TOKENS: 0,
    TOTAL_TOKENS: 0,
  };
}

export function addToLedger(ledger: TokenLedger, purpose: string, tokens: number): TokenLedger {
  const bucket = tokenBucketOfPurpose(purpose);
  const next: TokenLedger = { ...ledger };
  if (bucket) next[bucket] += tokens;
  // ★入れ物が分からない取得も、合計にはきちんと足す。
  //   足さないと「どこにも数えられていない枠」ができて、実消費と合わなくなる。
  next.TOTAL_TOKENS += tokens;
  return next;
}

/* ================================================================
 * 6. 「枠あたり、どれだけ役に立つ材料が取れたか」
 * ================================================================ */

export type UsefulDataPerToken = {
  /** 判断に使える形で取れた項目の数 */
  usefulFields: number;
  /** その商品に使った枠 */
  tokens: number;
  /** 枠1つあたりの項目数。枠が0なら null（0で割らない）。 */
  ratio: number | null;
  noteJa: string;
};

/**
 * 【この指標の意味と、意味しないこと】
 *
 * ご本人の指示（原文）：
 *   「目的は、Tokenを多く使った商品ほど良い分析になる という雑な設計を防ぐことです。」
 *
 * ★これは「良い商品かどうか」の点数**ではない**。
 *   取り方の効率だけを見る数字である。高いほど良い商品、ではない。
 *   ここを取り違えると、材料が少ない商品を「効率が良い」と褒めることになる。
 */
export function usefulDataPerToken(usefulFields: number, tokens: number): UsefulDataPerToken {
  const ratio = tokens > 0 ? usefulFields / tokens : null;
  return {
    usefulFields,
    tokens,
    ratio,
    noteJa:
      'これは取り方の効率だけを見る数字です。商品の良し悪しの点数ではありません。'
      + '枠をたくさん使った商品ほど良い、という読み方をしないでください。',
  };
}

/* ================================================================
 * 6b. 商品ごとに「形」が変わっていないかを見張る場所
 * ================================================================ */

export type ShapeWatchGroup = {
  group: string;
  labelJa: string;
  /** Keepa の応答の中での場所 */
  paths: string[];
  whyJa: string;
};

/**
 * 【5件テストで特に見る10か所】
 *
 * ご本人の指示（原文）：
 *   「5件で特に確認するSchema　price fields / csv arrays / stats / offers /
 *     availability / outOfStockPercentage / fees / salesRanks / images / identifiers
 *     の実際の型が商品ごとにどう違うか。」
 *
 * ★ここが今回の**本題**である。売れる商品を5件見つけることではない。
 *   本は `eanList` があるが家電には無い、ゲームには `fees` が付くが日用品には付かない、
 *   といった違いが商品ごとに出る。その違いを読み違えたまま件数を増やすと、
 *   増えた分だけ間違ったデータが貯まる。
 */
export const KEEPA_SHAPE_WATCH_GROUPS: ShapeWatchGroup[] = [
  {
    group: 'price',
    labelJa: '価格',
    paths: ['stats.current', 'stats.avg30', 'stats.avg90', 'listPrice'],
    whyJa: '円をそのまま扱う。100で割る商品と割らない商品が混ざっていないかを見る。',
  },
  {
    group: 'csv',
    labelJa: '履歴の配列（csv）',
    paths: ['csv'],
    whyJa: '配列の中に null が混ざる商品がある。長さも商品ごとに違う。',
  },
  {
    group: 'stats',
    labelJa: '集計（stats）',
    paths: ['stats'],
    whyJa: 'stats そのものが無い商品があるかを見る。',
  },
  {
    group: 'offers',
    labelJa: '出品（offers）',
    paths: ['offers', 'liveOffersOrder', 'offerCountNew'],
    whyJa: '下見では頼んでいないので、無い／-2 が正しい。ここが -1 か -2 かで意味が変わる。',
  },
  {
    group: 'availability',
    labelJa: '在庫の状態',
    paths: ['availabilityAmazon', 'availabilityAmazonDelay'],
    whyJa: 'Amazon本体の在庫。無い商品と、値が無い商品を分ける。',
  },
  {
    group: 'outOfStock',
    labelJa: '在庫切れだった割合',
    paths: ['stats.outOfStockPercentage30', 'stats.outOfStockPercentage90'],
    whyJa: '配列で返る。要素の位置がどの状態を指すかを取り違えると意味が反転する。',
  },
  {
    group: 'fees',
    labelJa: '手数料',
    paths: ['fbaFees', 'referralFeePercentage', 'referralFeePercent'],
    whyJa: '項目名が商品によって揺れることがある。両方見る。',
  },
  {
    group: 'salesRanks',
    labelJa: '売れ筋順位',
    paths: ['salesRanks', 'salesRankReference', 'rootCategory', 'categories'],
    whyJa: 'どの売り場での順位かを取り違えると、比較にならない数字を比べることになる。',
  },
  {
    group: 'images',
    labelJa: '画像',
    // ★2026-08-25 修正。ここは長らく `imagesCSV` だけを見ていたが、
    //   その名前は現在の Keepa 公式仕様書に1回も出てこない（本文で確認済み）。
    //   その結果5件すべてで「項目なし」になり、画像が1枚も取れない状態が静かに続いていた。
    //   現在仕様（images）を先に置き、旧名は「まだ来ていないか」を確かめるためだけに後ろへ残す。
    paths: ['images', 'imagesCSV'],
    whyJa: '現在仕様は images（画像1枚ごとの入れ物が並んだ配列）。'
      + '旧名 imagesCSV は現在仕様に存在しないため、来ていないことを確認する目的で並べて見張る。',
  },
  {
    group: 'identifiers',
    labelJa: '商品を指すコード',
    paths: ['eanList', 'upcList', 'model', 'partNumber', 'parentAsin'],
    whyJa: '同一商品の確認に使う。無い商品と空配列の商品を分ける。',
  },
];

/* ================================================================
 * 7. 5件テストの合格条件
 * ================================================================ */

export type FiveItemGateInput = {
  apiErrors: number;
  parserSchemaErrors: number;
  wrongMarketplace: number;
  tokenEstimateMismatch: number;
  secretLeak: number;
  falseAsin: number;
};

export type FiveItemGateResult = {
  passed: boolean;
  rows: { labelJa: string; value: number; passed: boolean }[];
  verdictJa: string;
};

/**
 * 【5件テストの合格条件（6つ全部が0）】
 *
 * ご本人の指示（原文）：
 *   「API_ERRORS = 0 / PARSER_SCHEMA_ERRORS = 0 / WRONG_MARKETPLACE = 0 /
 *     TOKEN_ESTIMATE_MISMATCH = 0 / SECRET_LEAK = 0 / FALSE_ASIN = 0
 *     重大項目が1つでもあれば20件へ進まない。」
 *
 * ★この関数が true を返しても、20件へ自動で進まない。進めるかどうかは人が決める。
 */
export function judgeFiveItemGate(i: FiveItemGateInput): FiveItemGateResult {
  const rows = [
    { labelJa: '通信の失敗', value: i.apiErrors },
    { labelJa: '読み取り・形の食い違い', value: i.parserSchemaErrors },
    { labelJa: '日本以外のAmazonが混じった', value: i.wrongMarketplace },
    { labelJa: '枠の見積と実消費のズレ', value: i.tokenEstimateMismatch },
    { labelJa: 'カギの漏れ', value: i.secretLeak },
    { labelJa: '実在しないASIN', value: i.falseAsin },
  ].map((r) => ({ ...r, passed: r.value === 0 }));

  const passed = rows.every((r) => r.passed);
  const bad = rows.filter((r) => !r.passed).map((r) => `${r.labelJa}=${r.value}`);

  return {
    passed,
    rows,
    verdictJa: passed
      ? '6項目すべて0件です。20件へ進めるかどうかは、結果を見てご本人が決めてください（自動では進みません）。'
      : `20件へは進みません（0でない項目：${bad.join(' / ')}）。`,
  };
}

/**
 * 5件テストの次に進むかを、この仕組みが自分で決めてよいか。**いいえ。**
 */
export const KEEPA_AUTO_ADVANCE_STAGE = false;
