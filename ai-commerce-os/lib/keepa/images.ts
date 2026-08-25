/**
 * Keepa の商品画像の読み取り（Phase 3.12b・2026-08-25）
 * ================================================================
 *
 * 【なぜこのファイルができたか】
 * 5件の取得で、**5件すべて画像が取れていなかった**。
 * 当社が見張っていた項目名 `imagesCSV` は、
 * **いまの Keepa 公式仕様書に1回も出てこない**（2026-08-25 に本文を確認済み）。
 * つまり「値が無かった」のではなく「**存在しない項目名を見ていた**」。
 * これはルール97でいう `PARSER_OR_SCHEMA_ERROR`（当社の不具合）であって、
 * `DATA_NOT_AVAILABLE`（市場に値が無い）ではない。
 *
 * 【このファイルは何も import しない】
 * 画面（'use client'）へバンドルできるようにするため（ルール37）。
 *
 * 【公式仕様（2026-08-25 に keepa.com/api-docs/product-object.html の本文で確認）】
 *   images : Object array
 *     "Provides metadata for images associated with the product."
 *     配列の各要素＝1枚の画像で、次を持つ：
 *       l  (String)  大きい画像のファイル名
 *       lH (Integer) 大きい画像の高さ
 *       lW (Integer) 大きい画像の幅
 *       m  (String)  中くらいの画像のファイル名
 *       mH (Integer) 中くらいの画像の高さ
 *       mW (Integer) 中くらいの画像の幅
 *       variant (String) 画像の役割コード（MAIN / PT01 など）
 *     "Full Amazon image path: https://m.media-amazon.com/images/I/<image name>"
 *
 * 【URLを組み立ててよい理由（ルール98の考え方をそのまま当てる）】
 * 危ないのは「AIが推測でURLを作ること」であって「決まった形に当てはめること」ではない。
 * ここで使う材料は **Keepa が返したファイル名だけ**で、
 * 形は **Keepa の公式仕様書に書いてある通り**。推測が入る余地が無い。
 * ファイル名が無ければURLは作らない（null）。
 * なお商品ページのURLの組み立ては、いまも `lib/keepa/asinsource.ts` の1ファイルだけで行う。
 * こちらは画像であって商品ページではない。
 */

/** 画像の置き場所。公式仕様書に書かれている形をそのまま定数にしてある。 */
export const KEEPA_IMAGE_BASE_URL = 'https://m.media-amazon.com/images/I/';

/**
 * 画像が取れなかったときの理由。**この2つを絶対に混ぜない**（ご本人の指示・2026-08-25）。
 *
 *   IMAGE_OK                 … 読めた。
 *   IMAGE_DATA_NOT_AVAILABLE … Keepa側に本当に画像が無い。当社にできることは無い。
 *   IMAGE_PARSER_ERROR       … Keepa側に画像情報があるのに当社が読めない。**当社の不具合。**
 *
 * 「不明」の一語に混ぜると、自分のバグが市場のせいに見える（ルール97の画像版）。
 */
export const IMAGE_STATUSES = [
  'IMAGE_OK',
  'IMAGE_DATA_NOT_AVAILABLE',
  'IMAGE_PARSER_ERROR',
] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

export const IMAGE_STATUS_JA: Record<ImageStatus, string> = {
  IMAGE_OK: '読めました',
  IMAGE_DATA_NOT_AVAILABLE: 'Keepa側に画像がありません（市場データの問題）',
  IMAGE_PARSER_ERROR: '画像はあるのに当社が読めていません（システムの不具合）',
};

/**
 * 生の項目 → 当社の項目 の対応表。
 *
 * ご本人の指示：「RAW_FIELD / RAW_TYPE / RAW_VALUE_PRESENT / NORMALIZED_FIELD /
 * CONVERSION_RULE を明示してください」。
 * **現在仕様が先。Legacy（旧名）は後ろ。**黙って旧名へ落ちない。
 */
export type ImageFieldMapRow = {
  rawField: string;
  rawType: string;
  normalizedField: string;
  conversionRuleJa: string;
  /** 現在の公式仕様にある項目か。false＝旧名（Legacy互換）。 */
  current: boolean;
};

export const KEEPA_IMAGE_FIELD_MAP: ImageFieldMapRow[] = [
  {
    rawField: 'images',
    rawType: 'Object array（各要素に l / lH / lW / m / mH / mW / variant）',
    normalizedField: 'imageFileNames / imageCount / imageMainFileName / imageMainUrl',
    conversionRuleJa:
      '各要素の l（大）を優先し、無ければ m（中）を使う。'
      + `URLは ${KEEPA_IMAGE_BASE_URL} にファイル名をつなぐ（公式仕様に記載の形）。`
      + 'variant が MAIN の要素を主画像とし、MAIN が無ければ先頭を主画像にする。',
    current: true,
  },
  {
    rawField: 'imagesCSV',
    rawType: 'String（カンマ区切りのファイル名。※現在の公式仕様書には存在しない）',
    normalizedField: 'imageFileNames（Legacy経路）',
    conversionRuleJa:
      'カンマで分けてファイル名の並びにする。**現在仕様（images）が無いときだけ**使い、'
      + '使ったことを legacyFieldUsed = true として必ず記録する（黙って落ちない）。',
    current: false,
  },
];

export type KeepaImages = {
  status: ImageStatus;
  /** 読めた画像の枚数。読めなければ 0 ではなく null（0枚と不明を混ぜない）。 */
  count: number | null;
  /** 主画像のファイル名（variant が MAIN のもの。無ければ先頭）。 */
  mainFileName: string | null;
  /** 主画像のURL（公式の形に当てはめただけ。ファイル名が無ければ null）。 */
  mainUrl: string | null;
  fileNames: string[];
  /** 旧名（imagesCSV）から読んだか。true なら仕様が古い側に落ちている。 */
  legacyFieldUsed: boolean;
  /** なぜその判定になったかの日本語。監査用にそのまま残す。 */
  reasonJa: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** ファイル名からURLを作る。材料が無ければ作らない（推測しない）。 */
export function keepaImageUrl(fileName: string | null | undefined): string | null {
  if (!isNonEmptyString(fileName)) return null;
  // ファイル名に「/」や「:」が混じっていたら、それはファイル名ではない。作らない。
  if (fileName.includes('/') || fileName.includes(':')) return null;
  return KEEPA_IMAGE_BASE_URL + fileName.trim();
}

/**
 * 画像を読み取る。
 *
 * 【判定の順番（これを変えない）】
 *  1. `images` が配列で、1枚でもファイル名が取れた → IMAGE_OK
 *  2. `images` があるのにファイル名が1つも取れない → **IMAGE_PARSER_ERROR**（当社の不具合）
 *  3. `images` が無く、旧名 `imagesCSV` に中身がある → Legacyで読む。読めれば IMAGE_OK、
 *     読めなければ IMAGE_PARSER_ERROR。**どちらの場合も legacyFieldUsed = true。**
 *  4. どちらの項目も無い → IMAGE_DATA_NOT_AVAILABLE（市場データの問題）
 *
 * 2 と 4 を混ぜないことがこの関数の存在理由である。
 */
export function parseKeepaImages(raw: unknown): KeepaImages {
  const r = (raw ?? {}) as Record<string, unknown>;
  const empty = (status: ImageStatus, reasonJa: string, legacyFieldUsed = false): KeepaImages =>
    ({ status, count: null, mainFileName: null, mainUrl: null, fileNames: [], legacyFieldUsed, reasonJa });

  const images = r.images;
  const hasImagesKey = Object.prototype.hasOwnProperty.call(r, 'images') && images !== null && images !== undefined;

  if (hasImagesKey) {
    if (!Array.isArray(images)) {
      // 項目はあるのに配列でない＝当社の想定と形が違う。市場のせいにしない。
      return empty('IMAGE_PARSER_ERROR', `images が配列ではありません（実際の形：${typeof images}）。`);
    }
    if (images.length === 0) {
      return empty('IMAGE_DATA_NOT_AVAILABLE', 'images は空の配列でした（Keepa側に画像がありません）。');
    }
    const names: string[] = [];
    let mainFileName: string | null = null;
    for (const item of images) {
      const o = (item ?? {}) as Record<string, unknown>;
      // 大（l）を優先し、無ければ中（m）。どちらも無ければその1枚は飛ばす。
      const name = isNonEmptyString(o.l) ? o.l.trim() : (isNonEmptyString(o.m) ? o.m.trim() : null);
      if (name === null) continue;
      names.push(name);
      if (mainFileName === null && String(o.variant ?? '').toUpperCase() === 'MAIN') mainFileName = name;
    }
    if (names.length === 0) {
      return empty(
        'IMAGE_PARSER_ERROR',
        `images に ${images.length} 件入っているのに、ファイル名を1つも取り出せませんでした。`,
      );
    }
    const main = mainFileName ?? names[0];
    return {
      status: 'IMAGE_OK',
      count: names.length,
      mainFileName: main,
      mainUrl: keepaImageUrl(main),
      fileNames: names,
      legacyFieldUsed: false,
      reasonJa: `images から ${names.length} 枚を読みました`
        + `（主画像の選び方：${mainFileName === null ? 'MAIN が無いので先頭' : 'variant=MAIN'}）。`,
    };
  }

  /*
   * ここから下は旧名（Legacy）。
   * ★2026-08-25 時点の公式仕様書に `imagesCSV` は**1回も出てこない**。
   *   それでも黙って消さずに残すのは、古い保存済みデータを読み直すことがあるため。
   *   ただし**使ったら必ず legacyFieldUsed = true で分かるようにする**。
   *   「昔の名前でも読めてしまう」状態を黙って作ると、仕様が変わったことに誰も気づかない。
   */
  const legacy = r.imagesCSV;
  if (isNonEmptyString(legacy)) {
    const names = legacy.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (names.length === 0) {
      return empty('IMAGE_PARSER_ERROR', 'imagesCSV に中身があるのに、ファイル名を取り出せませんでした。', true);
    }
    return {
      status: 'IMAGE_OK',
      count: names.length,
      mainFileName: names[0],
      mainUrl: keepaImageUrl(names[0]),
      fileNames: names,
      legacyFieldUsed: true,
      reasonJa: `旧名 imagesCSV から ${names.length} 枚を読みました。`
        + '現在の公式仕様には imagesCSV はありません。取得側の見直しが必要です。',
    };
  }
  if (legacy !== null && legacy !== undefined && !isNonEmptyString(legacy)) {
    return empty('IMAGE_PARSER_ERROR', `imagesCSV はありますが文字列ではありません（${typeof legacy}）。`, true);
  }

  return empty('IMAGE_DATA_NOT_AVAILABLE', 'images も imagesCSV も応答にありませんでした。');
}

export const KEEPA_IMAGE_NOTE_JA =
  '画像は Keepa の `images`（画像1枚ごとの入れ物が並んだもの）から読みます。'
  + '当社は以前 `imagesCSV` という名前を見ていましたが、これは現在の公式仕様には存在しません。'
  + 'そのため5件すべてで画像が取れておらず、画面上は「不明」に見えていました。'
  + 'これは市場にデータが無かったのではなく、**当社の読み取りの不具合**です。';
