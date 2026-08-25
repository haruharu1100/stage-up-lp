/**
 * 【Keepaの生データを、当社の形に直す】（Phase 3.10・2026-08-25）
 *
 * ★このファイルが import してよいのは、同じく依存ゼロの `./policy` `./schema` `./images` だけ（ルール37）。
 *   画面から読んでもビルドが落ちないようにするため。
 *
 * ------------------------------------------------------------------
 * 【ここでやらないこと】
 *
 *  1. 通信しない。受け取るのは、すでに取得済みの生データだけ。
 *  2. 空欄を推測で埋めない。無ければ null のまま返す。**0で代用しない。**
 *     Keepa は「値が無い」を -1 で表すので、これを 0 円・0個として通すと
 *     「無料の商品」「在庫ゼロ」といった嘘のデータが出来上がる。
 *  3. URLを組み立てない（ルール55）。
 *  4. 下落回数を販売数と呼ばない（ルール78）。名前は必ず `estimated*`。
 */

import {
  KEEPA_DOMAIN_JP,
  KEEPA_EPOCH_MINUTES,
  KEEPA_FRESHNESS_MAX_DAYS,
  KEEPA_JPY_DIVISOR,
  KEEPA_RANK_DROP_WINDOWS,
} from './policy';
import {
  parseKeepaImages,
  type ImageStatus,
} from './images';
import {
  auditKeepaSchema,
  briefValue,
  classifyUnknown,
  KEEPA_UNIT_JA,
  readPath,
  shapeOf,
  type KeepaSchemaAudit,
  type KeepaShape,
  type KeepaUnit,
  type UnknownField,
} from './schema';

/* ================================================================
 * Keepa の履歴データの並び順
 * ================================================================ */

/**
 * `csv` 配列と `stats.current` 配列の添字。
 *
 * 添字を直接書くと、後から読んだ人に何番が何なのか分からない。
 * ここに名前を付けて1か所に集める。
 */
export const KEEPA_CSV_INDEX = {
  /** Amazon本体の価格 */
  AMAZON: 0,
  /** 新品の最安値（送料別） */
  NEW: 1,
  /** 中古の最安値 */
  USED: 2,
  /** 売れ筋順位 */
  SALES_RANK: 3,
  /** 定価 */
  LIST_PRICE: 4,
  /** 新品FBAの最安値 */
  NEW_FBA: 10,
  /** 新品の出品数 */
  COUNT_NEW: 11,
  /** 中古の出品数 */
  COUNT_USED: 12,
  /** 評価（星） */
  RATING: 16,
  /** レビュー件数 */
  COUNT_REVIEWS: 17,
  /** カート価格（送料込み） */
  BUY_BOX: 18,
} as const;

/** Keepa は「値なし」を -1 で表す。0 と混同しないための入口。 */
function val(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null; // -1 は「値なし」。0円・0個ではない。
  return n;
}

/** 円に直す。Keepa の円は最小単位＝円なので割らない（100で割ると1/100になる）。 */
function yen(v: unknown): number | null {
  const n = val(v);
  return n === null ? null : Math.round(n / KEEPA_JPY_DIVISOR);
}

/** Keepa の分数（2011-01-01起点）を ISO 文字列へ。 */
export function keepaMinutesToIso(minutes: unknown): string | null {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date((n + KEEPA_EPOCH_MINUTES) * 60000).toISOString();
}

function arrAt(a: unknown, i: number): unknown {
  return Array.isArray(a) ? a[i] : undefined;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * 【売り場の階層名を取り出す】（2026-08-25 Phase 3.14）
 *
 * Keepa の `categoryTree` は `[{ catId, name }, …]` の配列で、
 * 先頭が一番おおもとの売り場（本／家電＆カメラ／おもちゃ …）。
 *
 * ★ id から名前を当社が推測しない（ルール55と同じ考え方）。
 *   Keepa が名前を返していないなら、名前は「無い」のままにする。
 */
function categoryTreeNames(raw: any): string[] {
  const tree = raw?.categoryTree;
  if (!Array.isArray(tree)) return [];
  return tree
    .map((x: any) => (x && typeof x === 'object' ? String(x.name ?? '').trim() : String(x ?? '').trim()))
    .filter((s: string) => s !== '');
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x !== '');
}

/* ================================================================
 * 正規化した形
 * ================================================================ */

export type KeepaNormalized = {
  /* --- どの商品か --- */
  asin: string;
  domainId: number | null;
  /** 日本のAmazonのデータか。false なら保存せずに止める。 */
  isJapan: boolean;
  title: string | null;
  brand: string | null;
  model: string | null;
  partNumber: string | null;
  eanList: string[];
  upcList: string[];
  color: string | null;
  packageQuantity: number | null;
  numberOfItems: number | null;

  /* --- どの売り場か（2026-08-25 Phase 3.14 追加） --- */
  /**
   * 【カテゴリ】＝Keepa の `rootCategory` と `categoryTree`。
   *
   * ★これまで当社は**カテゴリを1件も保存していなかった**。
   *   「どの需要指標が、どのカテゴリで使えるのか」を調べるには、
   *   まず商品がどの売り場のものかを記録していないと何も比べられない。
   *
   * 名前の出どころは `categoryTree[0].name`（Keepaが返す日本語名）であって、
   * 当社が id から推測して付けた名前ではない。**推測で埋めない。**
   * 取れなければ null のまま（「その他」等でごまかさない）。
   */
  rootCategoryId: number | null;
  rootCategoryName: string | null;
  /** 売り場の階層名（例：本 → ジャンル別 → 文学・評論 …）。取れなければ空配列。 */
  categoryTreeNames: string[];

  /* --- いまの値 --- */
  currentAmazonPrice: number | null;
  currentNewPrice: number | null;
  currentUsedPrice: number | null;
  currentBuyBoxPrice: number | null;
  currentSalesRank: number | null;
  listPrice: number | null;
  rating: number | null;
  reviewCount: number | null;

  /* --- 平均（期間別） --- */
  avgNewPrice30: number | null;
  avgNewPrice90: number | null;
  avgNewPrice180: number | null;
  avgSalesRank30: number | null;
  avgSalesRank90: number | null;

  /* --- 売れ行きの手がかり（すべて「推定」の材料） --- */
  salesRankDrops30: number | null;
  salesRankDrops90: number | null;
  salesRankDrops180: number | null;
  salesRankDrops365: number | null;
  /**
   * 【Keepa の `monthlySold`】＝「先月この商品が買われた回数」。
   *
   * ★2026-08-25、公式仕様書の本文を読み直して名前を付け直した。
   *   以前は当社もこれを「実測販売数」のように扱いかけたが、それは誤り。
   *   逆に「Keepaの推定」と呼ぶのも誤りである。公式説明は次のとおり：
   *
   *     ・Amazon の検索結果ページに出る「先月◯点購入されました」の値そのもの
   *     ・"It is not an estimate."（推定値ではない）
   *     ・ただし Amazon は "10+" "100+" のような**区切りの粗い段階**でしか出さない
   *     ・"at least"＝**「その数以上」**という下限であって、ちょうどの数ではない
   *     ・"Most ASINs do not have this value set."＝**大半の商品では空**
   *
   *   よって当社での正しい読み方は **「◯個以上」という区分値（出どころ＝Keepa）**。
   *   実測でもなければ推定でもない、という一段目立たない位置づけなので、
   *   名前に `AtLeast`（以上）を入れて、数として素直に割り算しないようにしてある。
   *
   * 値が無ければ null。**0 で代用しない。**（0＝1件も売れていない、とは意味が違う）
   * 仕入判断に使ってよいかは未確認（U4）なので、いまも表示・記録のみ。
   */
  keepaMonthlySoldAtLeast: number | null;

  /* --- ライバル --- */
  offerCountNew: number | null;
  offerCountUsed: number | null;
  offerCountFBA: number | null;
  offerCountFBM: number | null;
  /** Amazon本体が在庫を持っているか。独立したリスク要素として別に持つ。 */
  amazonRetailPresent: 'YES' | 'NO' | 'UNKNOWN';
  buyBoxIsAmazon: 'YES' | 'NO' | 'UNKNOWN';
  outOfStockPercentage30: number | null;
  outOfStockPercentage90: number | null;

  /* --- 費用（Amazonが決める率・額） --- */
  fbaPickAndPackFee: number | null;
  referralFeePercentage: number | null;

  /* --- 商品画像（2026-08-25 追加） --- */
  /**
   * ★これまで当社は画像を**一度も読み取っていなかった**。
   *   見張っていた項目名 `imagesCSV` が現在の Keepa 公式仕様に存在せず、
   *   5件すべてで「項目なし」になり、画面では静かに「不明」に見えていた。
   *   これは市場にデータが無かったのではなく**当社の読み取りの不具合**なので、
   *   `IMAGE_PARSER_ERROR` と `IMAGE_DATA_NOT_AVAILABLE` を必ず別物として持つ。
   *   読み取りの中身は `./images` の1ファイルだけが持つ。
   */
  imageStatus: ImageStatus;
  /** 読めた枚数。読めなければ 0 ではなく null（0枚と不明を混ぜない）。 */
  imageCount: number | null;
  imageMainFileName: string | null;
  imageMainUrl: string | null;
  imageFileNames: string[];
  /** 旧名 imagesCSV から読んだか。true なら取得側の仕様が古い側に落ちている。 */
  imageLegacyFieldUsed: boolean;
  /** そう判定した理由（日本語・監査用）。 */
  imageReasonJa: string;

  /* --- いつの情報か --- */
  lastUpdateIso: string | null;
  trackingSinceIso: string | null;

  /* --- 取れなかったもの --- */
  /**
   * 値が入っていなかった項目の日本語名。画面に「不明」として出す。
   * **人へ見せるのはこれだけ。** 理由の区別は下の `unknownDetails` で内部だけが持つ。
   */
  unknownFields: string[];

  /**
   * 【不明の理由を2つに分けたもの】（2026-08-25 追加）
   *
   *   DATA_NOT_AVAILABLE     … Keepaに値が無い。市場データの問題。直しようがない。
   *   PARSER_OR_SCHEMA_ERROR … 値はあるのに当社が読めていない。**システムの不具合。**
   *
   * この2つを同じ「不明」に混ぜていたせいで、
   * 在庫切れ割合の取り込み漏れ（配列を数値として読んでいた）が長く気づかれなかった。
   * 混ぜない。
   */
  unknownDetails: UnknownField[];

  /** 上のうち「当社の不具合」だけ。0件でなければ、直すべきものが残っている。 */
  parserErrors: UnknownField[];

  /** 応答の「形」が想定と違っていないかの監査結果（開発・監査用）。 */
  schema: KeepaSchemaAudit;
};

/**
 * 生データを当社の形に直す。
 *
 * 【Fail Closed】
 * 形がおかしい・ASINが無い・日本のデータでない、のいずれかなら
 * そのことが分かる形で返す（例外は投げず、`isJapan` と `unknownFields` で伝える）。
 * 呼ぶ側は `isJapan` が false なら保存しない。
 */
export function normalizeKeepaProduct(raw: any): KeepaNormalized {
  const unknownFields: string[] = [];
  const unknownDetails: UnknownField[] = [];

  /**
   * 人へ「不明」と出す項目。
   * 同時に、**なぜ不明になったのか**（Keepaに無い／当社が読めていない）を内部で記録する。
   */
  const mark = <T>(v: T | null, labelJa: string, path: string): T | null => {
    if (v === null || v === undefined) {
      unknownFields.push(labelJa);
      unknownDetails.push(classifyUnknown(raw, path, labelJa));
    }
    return (v ?? null) as T | null;
  };

  /**
   * 人へは出さないが、内部の監査では見張る項目。
   *
   * 画面の「不明」一覧をむやみに長くすると、本当に大事な不明が埋もれる。
   * かといって見張らないと、また静かに読み落とす。だから表示と監査を分けた。
   */
  const watch = <T>(v: T | null, labelJa: string, path: string): T | null => {
    if (v === null || v === undefined) {
      unknownDetails.push(classifyUnknown(raw, path, labelJa));
    }
    return (v ?? null) as T | null;
  };

  const stats = raw?.stats ?? null;
  const cur = stats?.current;
  const avg30 = stats?.avg30;
  const avg90 = stats?.avg90;
  const avg180 = stats?.avg180;

  const domainId = Number.isFinite(Number(raw?.domainId)) ? Number(raw.domainId) : null;

  /*
   * 画像。読み取りの中身は `./images` に閉じてある（ここでは呼ぶだけ）。
   * ★重要：ここで返る `IMAGE_PARSER_ERROR` は**当社の不具合**であって、
   *   「Keepaに画像が無い」（IMAGE_DATA_NOT_AVAILABLE）とは別物である。
   *   だから下で、不具合のときだけ `PARSER_OR_SCHEMA_ERROR` として数え上げる。
   *   ここを一緒くたに「不明」へ落としたことが、画像が1枚も取れないまま
   *   誰も気づかなかった原因そのものである（ルール97の画像版）。
   */
  const img = parseKeepaImages(raw);

  const out: KeepaNormalized = {
    asin: str(raw?.asin) ?? '',
    domainId,
    isJapan: domainId === KEEPA_DOMAIN_JP,
    title: mark(str(raw?.title), '商品名', 'title'),
    brand: mark(str(raw?.brand), 'ブランド', 'brand'),
    model: mark(str(raw?.model), '型番（model）', 'model'),
    partNumber: mark(str(raw?.partNumber), '型番（partNumber）', 'partNumber'),
    eanList: strList(raw?.eanList),
    upcList: strList(raw?.upcList),
    color: mark(str(raw?.color), '色', 'color'),
    packageQuantity: mark(val(raw?.packageQuantity), '梱包内個数', 'packageQuantity'),
    numberOfItems: mark(val(raw?.numberOfItems), '入数', 'numberOfItems'),

    rootCategoryId: watch(val(raw?.rootCategory), '売り場（rootCategory）', 'rootCategory'),
    rootCategoryName: watch(categoryTreeNames(raw)[0] ?? null, '売り場の名前', 'categoryTree'),
    categoryTreeNames: categoryTreeNames(raw),

    currentAmazonPrice: mark(
      yen(arrAt(cur, KEEPA_CSV_INDEX.AMAZON)), 'Amazon本体の価格',
      `stats.current[${KEEPA_CSV_INDEX.AMAZON}]`,
    ),
    currentNewPrice: mark(
      yen(arrAt(cur, KEEPA_CSV_INDEX.NEW)), '新品の最安値',
      `stats.current[${KEEPA_CSV_INDEX.NEW}]`,
    ),
    currentUsedPrice: mark(
      yen(arrAt(cur, KEEPA_CSV_INDEX.USED)), '中古の最安値',
      `stats.current[${KEEPA_CSV_INDEX.USED}]`,
    ),
    currentBuyBoxPrice: mark(
      yen(arrAt(cur, KEEPA_CSV_INDEX.BUY_BOX)), 'カート価格',
      `stats.current[${KEEPA_CSV_INDEX.BUY_BOX}]`,
    ),
    currentSalesRank: mark(
      val(arrAt(cur, KEEPA_CSV_INDEX.SALES_RANK)), '売れ筋順位',
      `stats.current[${KEEPA_CSV_INDEX.SALES_RANK}]`,
    ),
    listPrice: mark(
      yen(arrAt(cur, KEEPA_CSV_INDEX.LIST_PRICE)), '定価',
      `stats.current[${KEEPA_CSV_INDEX.LIST_PRICE}]`,
    ),
    // 評価は10倍で入っている（45 = 星4.5）
    rating: (() => {
      const r = val(arrAt(cur, KEEPA_CSV_INDEX.RATING));
      return r === null ? null : r / 10;
    })(),
    reviewCount: val(arrAt(cur, KEEPA_CSV_INDEX.COUNT_REVIEWS)),

    avgNewPrice30: yen(arrAt(avg30, KEEPA_CSV_INDEX.NEW)),
    avgNewPrice90: yen(arrAt(avg90, KEEPA_CSV_INDEX.NEW)),
    avgNewPrice180: yen(arrAt(avg180, KEEPA_CSV_INDEX.NEW)),
    avgSalesRank30: val(arrAt(avg30, KEEPA_CSV_INDEX.SALES_RANK)),
    avgSalesRank90: val(arrAt(avg90, KEEPA_CSV_INDEX.SALES_RANK)),

    salesRankDrops30: mark(val(stats?.salesRankDrops30), '30日間の順位下落回数', 'stats.salesRankDrops30'),
    salesRankDrops90: mark(val(stats?.salesRankDrops90), '90日間の順位下落回数', 'stats.salesRankDrops90'),
    salesRankDrops180: watch(val(stats?.salesRankDrops180), '180日間の順位下落回数', 'stats.salesRankDrops180'),
    salesRankDrops365: watch(val(stats?.salesRankDrops365), '365日間の順位下落回数', 'stats.salesRankDrops365'),
    // ★呼び方に注意。「実測販売数」でも「推定」でもない。「◯個以上」の区分値である（型定義の説明を参照）。
    keepaMonthlySoldAtLeast: watch(
      val(raw?.monthlySold), 'Keepaの月間購入回数（「◯個以上」の区分値）', 'monthlySold',
    ),

    offerCountNew: mark(
      val(arrAt(cur, KEEPA_CSV_INDEX.COUNT_NEW)), '新品の出品数',
      `stats.current[${KEEPA_CSV_INDEX.COUNT_NEW}]`,
    ),
    offerCountUsed: watch(
      val(arrAt(cur, KEEPA_CSV_INDEX.COUNT_USED)), '中古の出品数',
      `stats.current[${KEEPA_CSV_INDEX.COUNT_USED}]`,
    ),
    offerCountFBA: watch(val(stats?.offerCountFBA), 'FBA出品者数', 'stats.offerCountFBA'),
    offerCountFBM: watch(val(stats?.offerCountFBM), 'FBM出品者数', 'stats.offerCountFBM'),

    amazonRetailPresent: (() => {
      if (!cur) return 'UNKNOWN';
      const a = arrAt(cur, KEEPA_CSV_INDEX.AMAZON);
      if (a === undefined || a === null) return 'UNKNOWN';
      return Number(a) >= 0 ? 'YES' : 'NO';
    })(),
    buyBoxIsAmazon: (() => {
      if (stats?.buyBoxIsAmazon === true) return 'YES';
      if (stats?.buyBoxIsAmazon === false) return 'NO';
      return 'UNKNOWN';
    })(),
    // ★2026-08-25 訂正：ここは1つの数ではなく「配列」で来る。
    //   1件目の実取得（B0978NB1VQ）で発覚した取り込み漏れ。
    //   Keepa の応答は `outOfStockPercentage90: [100, 100, 100, -1, ...]` のように
    //   `stats.current` と同じ添字（0=Amazon本体 / 1=新品 / 2=中古）の配列である。
    //   これをそのまま `val()`（=`Number()`）に渡すと NaN になり、
    //   **値があるのに毎回「不明」になっていた**。
    //   実害：ライバルの多さの判定で「90日間の在庫切れ割合」が常に点に入らず、
    //         品切れが多い（＝入り込む余地がある）商品を見落とす方向に効く。
    //   どの添字を使うか：ここが効くのは「新品で出品する自分が入り込めるか」なので
    //   **新品（NEW=1）** を採る。Amazon本体の在庫の有無は別の材料として持っている。
    outOfStockPercentage30: watch(
      val(arrAt(stats?.outOfStockPercentage30, KEEPA_CSV_INDEX.NEW)), '30日間の在庫切れ割合',
      `stats.outOfStockPercentage30[${KEEPA_CSV_INDEX.NEW}]`,
    ),
    outOfStockPercentage90: watch(
      val(arrAt(stats?.outOfStockPercentage90, KEEPA_CSV_INDEX.NEW)), '90日間の在庫切れ割合',
      `stats.outOfStockPercentage90[${KEEPA_CSV_INDEX.NEW}]`,
    ),

    fbaPickAndPackFee: watch(
      yen(raw?.fbaFees?.pickAndPackFee), 'FBA配送代行手数料', 'fbaFees.pickAndPackFee',
    ),
    referralFeePercentage: watch(
      val(raw?.referralFeePercentage), '販売手数料率', 'referralFeePercentage',
    ),

    imageStatus: img.status,
    imageCount: img.count,
    imageMainFileName: img.mainFileName,
    imageMainUrl: img.mainUrl,
    imageFileNames: img.fileNames,
    imageLegacyFieldUsed: img.legacyFieldUsed,
    imageReasonJa: img.reasonJa,

    lastUpdateIso: watch(keepaMinutesToIso(raw?.lastUpdate), '最終更新日時', 'lastUpdate'),
    trackingSinceIso: watch(keepaMinutesToIso(raw?.trackingSince), '追跡開始日時', 'trackingSince'),

    unknownFields,
    unknownDetails,
    parserErrors: [],
    schema: auditKeepaSchema(raw),
  };

  if (!out.asin) {
    unknownFields.unshift('ASIN');
    unknownDetails.unshift(classifyUnknown(raw, 'asin', 'ASIN'));
  }

  /*
   * 画像の結果を、不明の帳簿へ**正しい理由で**載せる。
   * ここが今回いちばん大事な分岐：
   *   ・Keepa側に画像が無い     → DATA_NOT_AVAILABLE（当社にできることは無い）
   *   ・画像はあるのに読めない   → PARSER_OR_SCHEMA_ERROR（**当社の不具合**。0件でなければ直す）
   * 以前はどちらも同じ「不明」だったので、自分のバグが市場のせいに見えていた。
   */
  if (img.status !== 'IMAGE_OK') {
    unknownFields.push('商品画像');
    unknownDetails.push({
      labelJa: '商品画像',
      path: img.legacyFieldUsed ? 'imagesCSV' : 'images',
      reason: img.status === 'IMAGE_PARSER_ERROR' ? 'PARSER_OR_SCHEMA_ERROR' : 'DATA_NOT_AVAILABLE',
      rawShape: shapeOf(readPath(raw, img.legacyFieldUsed ? 'imagesCSV' : 'images')),
      detailJa: img.reasonJa,
    });
  }

  // ★「値はあるのに読めていない」ものだけを抜き出す。ここが0件でなければ、直す仕事が残っている。
  out.parserErrors = unknownDetails.filter((u) => u.reason === 'PARSER_OR_SCHEMA_ERROR');
  return out;
}

/* ================================================================
 * データの鮮度（KEEPA_DATA_AGE_DAYS）
 * ================================================================ */

export type KeepaFreshness = {
  /** Keepa側の最終更新から何日経ったか。分からなければ null。 */
  ageDays: number | null;
  /** 判定に使ってよいか。 */
  usable: boolean;
  maxDays: number;
  reasonJa: string;
};

/**
 * 「その数字は、いつの数字か」を出す。
 *
 * ★閾値（KEEPA_FRESHNESS_MAX_DAYS）は、目の前のデータが古いからといって動かさない。
 *   緩めれば判定は出るが、それは古い相場で仕入れることを意味する。
 */
export function keepaFreshness(n: KeepaNormalized, now: Date = new Date()): KeepaFreshness {
  const maxDays = KEEPA_FRESHNESS_MAX_DAYS;
  if (!n.lastUpdateIso) {
    return {
      ageDays: null,
      usable: false,
      maxDays,
      reasonJa: 'Keepa側の最終更新日時が取れていないため、いつの数字か分かりません。判定しません。',
    };
  }
  const ms = now.getTime() - Date.parse(n.lastUpdateIso);
  const ageDays = Math.floor(ms / 86400000);
  if (ageDays > maxDays) {
    return {
      ageDays,
      usable: false,
      maxDays,
      reasonJa:
        `Keepa側の最終更新が${ageDays}日前です（${maxDays}日以内なら使う）。`
        + '古い数字で仕入を決めないため、判定しません。',
    };
  }
  return {
    ageDays,
    usable: true,
    maxDays,
    reasonJa: `Keepa側の最終更新は${ageDays}日前です（${maxDays}日以内）。判定に使えます。`,
  };
}

/* ================================================================
 * 項目ごとの監査表（人が1行ずつ追えるようにする）
 * ================================================================ */

export type KeepaAuditRow = {
  /** 項目 */
  labelJa: string;
  /** Keepa上の元フィールド */
  path: string;
  /** RAWの型 */
  rawShape: KeepaShape;
  /** RAW値があったか（-1 / -2 / null / 空 は「無し」） */
  hasRawValue: boolean;
  /** RAWの値（短く） */
  rawValueJa: string;
  /** 当社の値 */
  normalizedJa: string;
  /** 変換ルール */
  ruleJa: string;
  /** どれくらい信用してよいか */
  confidence: 'HIGH' | 'MEDIUM' | 'UNKNOWN';
  /** 状態 */
  issue: 'OK' | 'DATA_NOT_AVAILABLE' | 'PARSER_OR_SCHEMA_ERROR';
};

type AuditPlan = {
  labelJa: string;
  path: string;
  unit: KeepaUnit;
  value: number | string | string[] | null;
  ruleJa: string;
  /** HIGH にしてよいか。仕様が確認できていない項目は MEDIUM 止まり。 */
  topConfidence?: 'HIGH' | 'MEDIUM';
};

function showValue(v: number | string | string[] | null): string {
  if (v === null) return '不明';
  if (Array.isArray(v)) return v.length === 0 ? '不明' : v.join(' / ');
  return String(v);
}

/**
 * 主要フィールドを1行ずつ並べた監査表を作る。
 *
 * ご本人の指示（原文）：
 *   「項目 / Keepa上の元フィールド / RAW型 / RAW値の有無 / Normalized値 / 変換ルール / Confidence」
 *
 * 【なぜ表にするのか】
 * 「不明でした」とだけ言われても、Keepaが持っていないのか、当社が読めていないのか分からない。
 * 元の場所・元の型・元の値・当社の値を横に並べれば、人が自分の目で突き合わせられる。
 */
export function auditKeepaFields(raw: any, n: KeepaNormalized): KeepaAuditRow[] {
  const idx = KEEPA_CSV_INDEX;
  const plans: AuditPlan[] = [
    { labelJa: '商品名', path: 'title', unit: 'TEXT', value: n.title, ruleJa: '文字をそのまま。空文字は「無し」。' },
    { labelJa: 'ブランド', path: 'brand', unit: 'TEXT', value: n.brand, ruleJa: '文字をそのまま。' },
    { labelJa: 'JAN/EAN', path: 'eanList', unit: 'TEXT', value: n.eanList, ruleJa: '配列。空の要素は捨てる。1つに丸めない。' },
    { labelJa: 'UPC', path: 'upcList', unit: 'TEXT', value: n.upcList, ruleJa: '配列。空の要素は捨てる。' },
    { labelJa: '型番（model）', path: 'model', unit: 'TEXT', value: n.model, ruleJa: '文字をそのまま。' },
    { labelJa: '型番（partNumber）', path: 'partNumber', unit: 'TEXT', value: n.partNumber, ruleJa: '文字をそのまま。' },
    {
      labelJa: '売り場（カテゴリ）', path: 'categoryTree[0].name', unit: 'TEXT',
      value: n.rootCategoryName, ruleJa: 'Keepaが返した名前をそのまま。id から名前を推測しない。',
    },

    {
      labelJa: '現在価格（Amazon本体）', path: `stats.current[${idx.AMAZON}]`, unit: 'JPY',
      value: n.currentAmazonPrice, ruleJa: '-1 は「Amazon本体の出品なし」で不明。0円ではない。',
    },
    {
      labelJa: '新品最安値', path: `stats.current[${idx.NEW}]`, unit: 'JPY',
      value: n.currentNewPrice, ruleJa: '送料は含まない。-1 は不明。',
    },
    {
      labelJa: '中古最安値', path: `stats.current[${idx.USED}]`, unit: 'JPY',
      value: n.currentUsedPrice, ruleJa: '-1 は不明。',
    },
    {
      labelJa: 'Buy Box（カート価格）', path: `stats.current[${idx.BUY_BOX}]`, unit: 'JPY',
      value: n.currentBuyBoxPrice, ruleJa: '送料込み。-1 は不明。',
    },
    {
      labelJa: '売れ筋順位', path: `stats.current[${idx.SALES_RANK}]`, unit: 'RANK',
      value: n.currentSalesRank, ruleJa: '-1 は不明。',
    },

    {
      labelJa: '30日間の順位下落回数', path: 'stats.salesRankDrops30', unit: 'COUNT',
      value: n.salesRankDrops30, ruleJa: '★販売個数ではない。0 は「1度も下がらなかった」＝本当に0回。',
    },
    {
      labelJa: '90日間の順位下落回数', path: 'stats.salesRankDrops90', unit: 'COUNT',
      value: n.salesRankDrops90, ruleJa: '★販売個数ではない。',
    },
    {
      labelJa: '180日間の順位下落回数', path: 'stats.salesRankDrops180', unit: 'COUNT',
      value: n.salesRankDrops180, ruleJa: '★販売個数ではない。',
    },
    {
      labelJa: '365日間の順位下落回数', path: 'stats.salesRankDrops365', unit: 'COUNT',
      value: n.salesRankDrops365, ruleJa: '★販売個数ではない。',
    },

    {
      labelJa: '新品Offer数', path: `stats.current[${idx.COUNT_NEW}]`, unit: 'COUNT',
      value: n.offerCountNew, ruleJa: '0 は「出品者ゼロ」。-1 は不明。混ぜない。',
    },
    {
      labelJa: '中古Offer数', path: `stats.current[${idx.COUNT_USED}]`, unit: 'COUNT',
      value: n.offerCountUsed, ruleJa: '0 は「出品者ゼロ」。-1 は不明。',
    },
    {
      labelJa: 'FBA Offer数', path: 'stats.offerCountFBA', unit: 'COUNT',
      value: n.offerCountFBA,
      ruleJa: '★出品明細を頼まないと -2（＝不明）。0人という意味ではない。',
      topConfidence: 'MEDIUM',
    },
    {
      labelJa: 'FBM Offer数', path: 'stats.offerCountFBM', unit: 'COUNT',
      value: n.offerCountFBM,
      ruleJa: '★同上。-2 は不明。',
      topConfidence: 'MEDIUM',
    },
    {
      labelJa: 'Amazon本体の在庫', path: `stats.current[${idx.AMAZON}]`, unit: 'FLAG',
      value: n.amazonRetailPresent === 'UNKNOWN' ? null : n.amazonRetailPresent,
      ruleJa: 'Amazon本体の価格が0以上なら「あり」、-1 なら「なし」。項目自体が無ければ不明。',
    },
    {
      labelJa: 'Buy Boxの保持者', path: 'stats.buyBoxIsAmazon', unit: 'FLAG',
      value: n.buyBoxIsAmazon === 'UNKNOWN' ? null : n.buyBoxIsAmazon,
      ruleJa: 'true/false のみ採用。null は不明（false と混ぜない）。',
    },
    {
      labelJa: '30日間の在庫切れ割合', path: `stats.outOfStockPercentage30[${idx.NEW}]`, unit: 'PERCENT',
      value: n.outOfStockPercentage30,
      ruleJa: '★配列の「新品(1)」を読む。配列のまま数値化するとNaNになる（2026-08-25に修正）。',
    },
    {
      labelJa: '90日間の在庫切れ割合', path: `stats.outOfStockPercentage90[${idx.NEW}]`, unit: 'PERCENT',
      value: n.outOfStockPercentage90,
      ruleJa: '★同上。',
    },

    {
      labelJa: 'FBA手数料', path: 'fbaFees.pickAndPackFee', unit: 'JPY',
      value: n.fbaPickAndPackFee,
      ruleJa: 'そのまま円。fbaFees が丸ごと null のことがあり、その場合は0円ではなく不明。',
      topConfidence: 'MEDIUM',
    },
    {
      labelJa: '販売手数料率', path: 'referralFeePercentage', unit: 'PERCENT',
      value: n.referralFeePercentage,
      ruleJa: 'パーセント（15 = 15%）。項目が無いことがある。',
      topConfidence: 'MEDIUM',
    },

    {
      labelJa: '最終更新日時', path: 'lastUpdate', unit: 'MINUTES_FROM_2011',
      value: n.lastUpdateIso, ruleJa: '2011-01-01からの分数に起点を足して日時にする。',
    },
  ];

  return plans.map((p): KeepaAuditRow => {
    const r = readPath(raw, p.path);
    const cls = classifyUnknown(raw, p.path, p.labelJa);
    const hasRawValue = cls.reason === 'PARSER_OR_SCHEMA_ERROR'
      || (r.exists && r.value !== null && !(typeof r.value === 'number' && r.value < 0));

    let issue: KeepaAuditRow['issue'] = 'OK';
    let confidence: KeepaAuditRow['confidence'] = p.topConfidence ?? 'HIGH';

    const missing = p.value === null || (Array.isArray(p.value) && p.value.length === 0);
    if (missing) {
      issue = cls.reason;
      confidence = 'UNKNOWN';
    }

    return {
      labelJa: p.labelJa,
      path: p.path,
      rawShape: r.exists ? shapeOf(r.value) : 'missing',
      hasRawValue,
      rawValueJa: briefValue(r.exists ? r.value : undefined),
      normalizedJa: showValue(p.value),
      ruleJa: `${KEEPA_UNIT_JA[p.unit]}。${p.ruleJa}`,
      confidence,
      issue,
    };
  });
}

/* ================================================================
 * 売れ行きの期間分け（7日 / 30日 / 90日）
 * ================================================================ */

export const SELLABILITY_WINDOWS = ['SELLABILITY_7D', 'SELLABILITY_30D', 'SELLABILITY_90D'] as const;
export type SellabilityWindow = (typeof SELLABILITY_WINDOWS)[number];

export type WindowSignal = {
  window: SellabilityWindow;
  days: number;
  /** 期間中の順位下落回数。**販売数ではない。** */
  rankDrops: number | null;
  /** データの出どころ。Keepaが持っている値か、当社で計算した値か。 */
  provenance: 'KEEPA_FIELD' | 'SELF_COMPUTED' | 'NOT_AVAILABLE';
  /** 使える状態か。 */
  status: 'AVAILABLE' | 'UNKNOWN';
  noteJa: string;
};

/**
 * 期間ごとの手がかりを取り出す。
 *
 * 【7日だけ扱いが違う】
 * Keepa の下落回数は 30 / 90 / 180 / 365 日しか無い。**7日は存在しない。**
 * 価格履歴から自分で数えれば作れるが、それは Keepa の数字ではなく自社計算になる。
 * 出どころを混ぜると「Keepaにそう書いてあった」と誤読されるので、
 * 方法が固まるまで 7日は `UNKNOWN` のままにする（ルール78の延長）。
 *
 * 一時的なブームと安定した売れ筋を分けたい、という狙い自体は正しいので、
 * いまは 30日と90日の差でその代わりを見る（`judgeTrend`）。
 */
export function extractWindowSignals(n: KeepaNormalized): WindowSignal[] {
  return [
    {
      window: 'SELLABILITY_7D',
      days: 7,
      rankDrops: null,
      provenance: 'NOT_AVAILABLE',
      status: 'UNKNOWN',
      noteJa:
        'Keepa に「7日間の下落回数」という項目がありません'
        + `（あるのは ${KEEPA_RANK_DROP_WINDOWS.join(' / ')} 日）。`
        + '価格履歴から自分で数えることはできますが、それは Keepa の数字ではなく自社計算になるため、'
        + '数え方が決まるまでは「不明」にしています。',
    },
    {
      window: 'SELLABILITY_30D',
      days: 30,
      rankDrops: n.salesRankDrops30,
      provenance: n.salesRankDrops30 === null ? 'NOT_AVAILABLE' : 'KEEPA_FIELD',
      status: n.salesRankDrops30 === null ? 'UNKNOWN' : 'AVAILABLE',
      noteJa: '直近30日。短期の動きを見ます。',
    },
    {
      window: 'SELLABILITY_90D',
      days: 90,
      rankDrops: n.salesRankDrops90,
      provenance: n.salesRankDrops90 === null ? 'NOT_AVAILABLE' : 'KEEPA_FIELD',
      status: n.salesRankDrops90 === null ? 'UNKNOWN' : 'AVAILABLE',
      noteJa: '直近90日。安定して売れているかを見ます。',
    },
  ];
}

/* ================================================================
 * 勢い（一時的なブームか、安定した売れ筋か）
 * ================================================================ */

export const TREND_VERDICTS = [
  'ACCELERATING',
  'STABLE',
  'DECELERATING',
  'VOLATILE',
  'INSUFFICIENT_DATA',
] as const;
export type TrendVerdict = (typeof TREND_VERDICTS)[number];

export const TREND_VERDICT_JA: Record<TrendVerdict, string> = {
  ACCELERATING: '最近になって売れ始めている',
  STABLE: '安定して売れている',
  DECELERATING: '以前より売れなくなっている',
  VOLATILE: '動きが激しく、読みにくい',
  INSUFFICIENT_DATA: '材料が足りず、勢いは判断できない',
};

export const TREND_THRESHOLDS = {
  /** 30日の1日あたりが90日の1日あたりの何倍以上なら「加速」か */
  ACCELERATING: 1.5,
  /** 何倍以下なら「減速」か */
  DECELERATING: 0.6,
  /** 30日でこの回数に満たなければ判断しない */
  MIN_DROPS_30: 3,
  /** 90日でこの回数に満たなければ判断しない */
  MIN_DROPS_90: 5,
} as const;

export type TrendResult = {
  verdict: TrendVerdict;
  ratio: number | null;
  reasonJa: string;
};

/**
 * 30日と90日の「1日あたりの下落回数」を比べて、勢いを見る。
 *
 * 【なぜ比にするのか】
 * 回数そのものを比べると、期間が3倍なので必ず90日の方が多くなる。
 * 1日あたりに直して初めて、増えているのか減っているのかが分かる。
 *
 * 【材料が足りなければ判断しない】
 * 回数が少ないと、1回の差で倍率が跳ねる。たまたまを「加速」と読まない。
 */
export function judgeTrend(n: KeepaNormalized): TrendResult {
  const d30 = n.salesRankDrops30;
  const d90 = n.salesRankDrops90;

  if (d30 === null || d90 === null) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      ratio: null,
      reasonJa: '30日または90日の下落回数が取れていないため、勢いは判断できません。',
    };
  }
  if (d30 < TREND_THRESHOLDS.MIN_DROPS_30 || d90 < TREND_THRESHOLDS.MIN_DROPS_90) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      ratio: null,
      reasonJa:
        `動いた回数が少なすぎます（30日で${d30}回・90日で${d90}回）。`
        + 'この回数では、増えたのか減ったのかを、たまたまと区別できません。',
    };
  }

  const perDay30 = d30 / 30;
  const perDay90 = d90 / 90;
  if (perDay90 <= 0) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      ratio: null,
      reasonJa: '90日間で動きがないため、勢いを比べられません。',
    };
  }

  const ratio = perDay30 / perDay90;

  // 90日のうち直近30日にほぼ全部が集中している＝短期のブームの疑い。
  if (d30 >= d90 * 0.9 && d90 >= TREND_THRESHOLDS.MIN_DROPS_90) {
    return {
      verdict: 'VOLATILE',
      ratio,
      reasonJa:
        `90日間の動き${d90}回のうち${d30}回が直近30日に集中しています。`
        + '一時的なブームの可能性があり、この先も続くとは限りません。',
    };
  }

  if (ratio >= TREND_THRESHOLDS.ACCELERATING) {
    return {
      verdict: 'ACCELERATING',
      ratio,
      reasonJa: `直近30日のペースが90日平均の${ratio.toFixed(2)}倍です。最近になって動きが増えています。`,
    };
  }
  if (ratio <= TREND_THRESHOLDS.DECELERATING) {
    return {
      verdict: 'DECELERATING',
      ratio,
      reasonJa: `直近30日のペースが90日平均の${ratio.toFixed(2)}倍まで落ちています。以前より売れなくなっています。`,
    };
  }
  return {
    verdict: 'STABLE',
    ratio,
    reasonJa: `直近30日のペースは90日平均の${ratio.toFixed(2)}倍で、大きな変化はありません。`,
  };
}

/* ================================================================
 * ライバルの多さ（COMPETITION_SCORE）
 * ================================================================ */

export type CompetitionMaterial = {
  labelJa: string;
  points: number;
  detailJa: string;
  known: boolean;
};

export type CompetitionResult = {
  /** 0〜100。高いほど競争が激しい。材料が足りなければ null。 */
  score: number | null;
  status: 'AVAILABLE' | 'UNKNOWN';
  materials: CompetitionMaterial[];
  reasonJa: string;
};

/**
 * ライバルの多さを点数にする。
 *
 * ご本人の指示（原文）：「ただし単純に seller count だけを使わない。」
 * その通りで、出品者数だけでは実態を外す。
 *
 *   ・出品者が3人でも、そのうち1人がAmazon本体なら、実質かなり厳しい
 *   ・出品者が20人いても、全員が高値で寝ていれば取れることがある
 *   ・在庫切れが多い商品は、出品者数が少なく見えるだけ
 *
 * だから材料を分けて持ち、内訳を画面に出す。
 * **材料が足りなければ点を作らず `UNKNOWN` を返す。**
 */
export function scoreCompetition(n: KeepaNormalized): CompetitionResult {
  const materials: CompetitionMaterial[] = [];

  // --- ① 新品の出品数（無ければ判定しない） ---
  if (n.offerCountNew === null) {
    return {
      score: null,
      status: 'UNKNOWN',
      materials: [{
        labelJa: '新品の出品数',
        points: 0,
        detailJa: '取れていません',
        known: false,
      }],
      reasonJa: '出品数が取れていないため、ライバルの多さは判断できません。',
    };
  }

  // 出品数は増えるほど厳しくなるが、比例ではない。
  // 0人→0点、1人→約10点、5人→約35点、20人→約60点、100人→約80点。
  const c = n.offerCountNew;
  const offerPoints = c <= 0 ? 0 : Math.min(80, Math.round(23 * Math.log(c + 1)));
  materials.push({
    labelJa: '新品の出品数',
    points: offerPoints,
    detailJa: `${c}人`,
    known: true,
  });

  // --- ② Amazon本体がいるか（独立したリスク要素） ---
  if (n.amazonRetailPresent === 'YES') {
    materials.push({
      labelJa: 'Amazon本体の在庫',
      points: 25,
      detailJa: 'あり（値下げに追随できず、カートを取りにくい）',
      known: true,
    });
  } else if (n.amazonRetailPresent === 'NO') {
    materials.push({ labelJa: 'Amazon本体の在庫', points: 0, detailJa: 'なし', known: true });
  } else {
    materials.push({ labelJa: 'Amazon本体の在庫', points: 0, detailJa: '不明', known: false });
  }

  // --- ③ カートをAmazonが持っているか ---
  if (n.buyBoxIsAmazon === 'YES') {
    materials.push({ labelJa: 'カートの保持者', points: 10, detailJa: 'Amazon本体', known: true });
  } else if (n.buyBoxIsAmazon === 'NO') {
    materials.push({ labelJa: 'カートの保持者', points: 0, detailJa: 'Amazon本体ではない', known: true });
  } else {
    materials.push({ labelJa: 'カートの保持者', points: 0, detailJa: '不明', known: false });
  }

  // --- ④ FBA出品者の厚み ---
  if (n.offerCountFBA !== null) {
    const p = n.offerCountFBA >= 5 ? 10 : n.offerCountFBA >= 2 ? 5 : 0;
    materials.push({
      labelJa: 'FBA出品者',
      points: p,
      detailJa: `${n.offerCountFBA}人`,
      known: true,
    });
  } else {
    materials.push({ labelJa: 'FBA出品者', points: 0, detailJa: '不明', known: false });
  }

  // --- ⑤ 在庫切れの起きやすさ（起きるほど、入り込む余地がある） ---
  if (n.outOfStockPercentage90 !== null) {
    const oos = n.outOfStockPercentage90;
    const p = oos >= 30 ? -15 : oos >= 10 ? -8 : 0;
    materials.push({
      labelJa: '90日間の在庫切れ割合',
      points: p,
      detailJa: `${oos}%${p < 0 ? '（品切れが多く、入り込む余地があります）' : ''}`,
      known: true,
    });
  } else {
    materials.push({ labelJa: '90日間の在庫切れ割合', points: 0, detailJa: '不明', known: false });
  }

  const raw = materials.reduce((s, m) => s + m.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const unknownCount = materials.filter((m) => !m.known).length;

  return {
    score,
    status: 'AVAILABLE',
    materials,
    reasonJa:
      `${score}点（100点に近いほど競争が激しい）。`
      + materials.filter((m) => m.known).map((m) => `${m.labelJa}：${m.detailJa}`).join(' / ')
      + (unknownCount > 0 ? `／ ${unknownCount}項目は取れていないので点に入れていません。` : ''),
  };
}

export const COMPETITION_SCORE_NOTE_JA =
  'ライバルの多さは、出品者の人数だけでは決めていません。'
  + 'Amazon本体が在庫を持っているか、カートを誰が持っているか、FBA出品者の厚み、'
  + '品切れの起きやすさを別々の材料として持ち、内訳を出しています。'
  + '取れていない材料は点に入れません（分からないものを都合よく0点＝安全と読まないため）。';
