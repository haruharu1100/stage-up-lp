/**
 * 【ASINの出所と、商品ページURLの決め方】（Phase 3.11・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。画面から読んでよい。
 *
 * ==================================================================
 * 【なぜ作ったか】
 *
 * ご本人の指示（2026-08-25）：
 *   「『次のKeepaテスト用ASINは必ず人間がAmazonを開いて探して渡す必要がある』
 *     という制約は外してください。ASINそのものは公開情報・正式データ等から
 *     実在確認できるため、人間が毎回Amazonの商品ページを手作業で探すことを
 *     必須にはしません。**ただし、架空ASIN・推測ASINは禁止を維持します。**」
 *
 * つまり縛るのは「誰が入力したか」ではなく「**どこから来たか**」に変わった。
 * 人が打ち込んだASINでも、それが記憶や当てずっぽうなら危険なことに変わりはない。
 * 逆に、Keepa の正式な検索機能が返したASINは、実在が確認されている。
 *
 * ==================================================================
 * 【いちばん大事な区別】
 *
 *   ASINの出所が正しい（URL_VALID）
 *        ≠
 *   そのASINが、いま仕入れようとしている商品と同じ（PRODUCT_MATCH_CONFIRMED）
 *
 * URLの形が公式どおりでも、中身が別の商品なら、人は間違った商品ページを開く。
 * 「AIが出したリンクだから合っている」と思われるので、**いちばん気づきにくい取り違え**になる。
 * だからこの2つは、最後まで別の変数として持つ。片方から片方を導かない。
 */

/* ================================================================
 * 1. ASINの出所
 * ================================================================ */

/**
 * 使ってよい出所。**この4つだけ。**
 *
 *   KEEPA_API             … Keepa の正式なAPI（商品検索・Product Finder・Deals など）が返した
 *   OFFICIAL_AMAZON_SOURCE… Amazon の公式な画面・公式ドキュメント・公式ツールから得た
 *   AUTHORIZED_DATA_FEED  … 正式に提供を受けているデータフィード
 *   HUMAN_INPUT           … 人が実物の商品ページを見て書き写した
 */
export const ASIN_SOURCES = [
  'KEEPA_API',
  'OFFICIAL_AMAZON_SOURCE',
  'AUTHORIZED_DATA_FEED',
  'HUMAN_INPUT',
] as const;
export type AsinSource = (typeof ASIN_SOURCES)[number];

export const ASIN_SOURCE_JA: Record<AsinSource, string> = {
  KEEPA_API: 'Keepaの正式なAPIが返したASIN',
  OFFICIAL_AMAZON_SOURCE: 'Amazonの公式な情報源から得たASIN',
  AUTHORIZED_DATA_FEED: '正式に提供を受けたデータフィードのASIN',
  HUMAN_INPUT: '人が商品ページを見て書き写したASIN',
};

/**
 * 使ってはいけない出所。**ここに当たるものは1つも通さない。**
 *
 *   AI_GUESS                 … AIが「たぶんこれ」で出した
 *   STRING_GENERATION        … 文字列として組み立てた・生成した
 *   UNVERIFIED_SEARCH_RESULT … 検索で見かけただけで、実在を確かめていない
 *
 * ★3つ目が地味に危ない。検索結果には、廃番・別国・そもそも存在しないASINが
 *   平気で混ざる。「見かけた」は「在る」ではない。
 */
export const FORBIDDEN_ASIN_SOURCES = [
  'AI_GUESS',
  'STRING_GENERATION',
  'UNVERIFIED_SEARCH_RESULT',
] as const;
export type ForbiddenAsinSource = (typeof FORBIDDEN_ASIN_SOURCES)[number];

export const FORBIDDEN_ASIN_SOURCE_JA: Record<ForbiddenAsinSource, string> = {
  AI_GUESS: 'AIの推測（実在を確認していない）',
  STRING_GENERATION: '文字列として組み立てたもの（実在を確認していない）',
  UNVERIFIED_SEARCH_RESULT: '検索で見かけただけ（実在を確認していない）',
};

export function isAllowedAsinSource(s: string): s is AsinSource {
  return (ASIN_SOURCES as readonly string[]).includes(s);
}

/* ================================================================
 * 2. 確からしさ
 * ================================================================ */

/**
 * ASINの確からしさ。
 *
 *   VERIFIED_EXISTS … 正式な情報源が「この商品がある」と返した（実在が確認できている）
 *   REPORTED        … 出所は正しいが、実在をこちらで確かめていない
 *   UNVERIFIED      … 確かめていない。**使わない。**
 *
 * ★「たぶん在る」という段は作らない。作ると、そこに全部が流れ込む。
 */
export const ASIN_CONFIDENCE_LEVELS = ['VERIFIED_EXISTS', 'REPORTED', 'UNVERIFIED'] as const;
export type AsinConfidence = (typeof ASIN_CONFIDENCE_LEVELS)[number];

export const ASIN_CONFIDENCE_JA: Record<AsinConfidence, string> = {
  VERIFIED_EXISTS: '実在を確認済み（正式な情報源が商品を返した）',
  REPORTED: '出所は正しいが、実在はこちらで未確認',
  UNVERIFIED: '未確認（使いません）',
};

/** URLを作ってよい確からしさの下限。**REPORTED では作らない。** */
export const ASIN_CONFIDENCE_FOR_URL: AsinConfidence = 'VERIFIED_EXISTS';

/* ================================================================
 * 3. 出所の記録
 * ================================================================ */

export type AsinProvenance = {
  asin: string;
  /** どこから来たか */
  asinSource: AsinSource;
  /** いつ実在を確認したか（ISO8601） */
  asinVerifiedAt: string | null;
  /** どのくらい確からしいか */
  asinConfidence: AsinConfidence;
  /** どうやって実在を確認したか（日本語・人が読んで分かる説明） */
  verificationMethodJa: string;
  /** 対象の市場（Amazon.co.jp = 5） */
  domainId: number;
};

/** 日本のAmazon。 */
export const AMAZON_JP_DOMAIN_ID = 5;

/** ASINの形（半角英数字10桁）。 */
export const ASIN_LENGTH = 10;
export function isAsinShape(asin: string): boolean {
  return /^[A-Z0-9]{10}$/.test(String(asin ?? '').trim().toUpperCase());
}

/* ================================================================
 * 4. 親ASIN / 子ASIN
 * ================================================================ */

/**
 * 【親ASINは買えないことがある】
 *
 * Amazon には色・サイズ違いをまとめる「親ASIN（PARENT）」と、
 * 実際に買える「子ASIN（CHILD）」がある。
 * 親のページを開くと、どの色・どのサイズを買うかがまだ決まっていない状態になる。
 *
 * Keepa の Product Finder では `productType` で見分けられる（公式仕様）：
 *   0 = STANDARD          … ふつうの商品
 *   1 = DOWNLOADABLE      … ダウンロード商品（第三者の価格データが無い）
 *   2 = EBOOK             … 電子書籍（出品データが無い）
 *   5 = VARIATION_PARENT  … ★親。実際の出品はぶら下がっている子の側にある
 *
 * よって購入導線に載せてよいのは **STANDARD か CHILD** だけ。
 * 親しか分からないときは `PURCHASE_URL_AVAILABLE = false` にする。
 */
export const KEEPA_PRODUCT_TYPES = {
  STANDARD: 0,
  DOWNLOADABLE: 1,
  EBOOK: 2,
  VARIATION_PARENT: 5,
} as const;

export const ASIN_VARIATION_ROLES = ['STANDALONE', 'CHILD', 'PARENT', 'UNKNOWN'] as const;
export type AsinVariationRole = (typeof ASIN_VARIATION_ROLES)[number];

export const ASIN_VARIATION_ROLE_JA: Record<AsinVariationRole, string> = {
  STANDALONE: '単独の商品（色・サイズ違いのまとめ役ではない）',
  CHILD: '子ASIN（実際に買える側）',
  PARENT: '親ASIN（色・サイズのまとめ役。そのままでは買えないことがある）',
  UNKNOWN: '親か子か分からない',
};

/**
 * Keepa の商品データから、親か子かを判定する。
 *
 * ★分からないときは `UNKNOWN` を返す。**STANDALONE に寄せない。**
 *   寄せると「たぶん買えるはず」で購入ページを出すことになる（ルール56と同じ考え方）。
 */
export function judgeVariationRole(product: any): AsinVariationRole {
  if (!product || typeof product !== 'object') return 'UNKNOWN';

  const pt = product.productType;
  if (pt === KEEPA_PRODUCT_TYPES.VARIATION_PARENT) return 'PARENT';

  const parent = product.parentAsin;
  if (typeof parent === 'string' && isAsinShape(parent)) {
    const self = String(product.asin ?? '').toUpperCase();
    // 自分自身が親として記録されている場合も親とみなす。
    return parent.toUpperCase() === self ? 'PARENT' : 'CHILD';
  }

  // variations（子の一覧）を持っているなら、それは親である。
  if (Array.isArray(product.variations) && product.variations.length > 0) return 'PARENT';

  // productType が「ふつうの商品」で、親も子の一覧も無ければ単独商品。
  if (pt === KEEPA_PRODUCT_TYPES.STANDARD) return 'STANDALONE';

  return 'UNKNOWN';
}

/** 購入導線に載せてよい役割か。**UNKNOWN は載せない（Fail Closed）。** */
export function roleAllowsPurchaseUrl(role: AsinVariationRole): boolean {
  return role === 'STANDALONE' || role === 'CHILD';
}

/* ================================================================
 * 5. 商品ページURLの決定
 * ================================================================ */

/**
 * 【AIが作るURLと、公式の形で決まるURLは別物である】
 *
 * ご本人の指示（2026-08-25）：
 *   「以前の『AIにURLを作らせない』ルールと、
 *     『正式に取得したASINからAmazon公式形式のURLを決定論的に生成』は
 *     分けて扱ってください。」
 *
 * これは筋が通っている。ルール55が防ごうとしていたのは
 * 「**実在しないASINから、実在するが別の商品のURLを作ってしまうこと**」であって、
 * URLを組み立てる行為そのものではなかった。
 *
 * 危険なのは組み立てではなく、**材料が確かめられていないこと**である。
 * だから材料（ASIN）の実在が確認できていれば、組み立ててよい。
 * 逆に、材料が怪しければ、どんな正しい形で組み立てても危険なままである。
 *
 * ------------------------------------------------------------------
 * 【URLを作ってよい条件（全部そろったときだけ）】
 *
 *   ① 出所が禁止リストに入っていない（AI_GUESS / STRING_GENERATION / UNVERIFIED_SEARCH_RESULT）
 *   ② 出所が許可リストの4つのどれか
 *   ③ 確からしさが VERIFIED_EXISTS
 *   ④ 実在を確認した日時が入っている
 *   ⑤ ASINが半角英数字10桁
 *   ⑥ 対象が Amazon.co.jp（domainId = 5）
 *   ⑦ 親ASINではない（親しか分からないときは出さない）
 *
 * 1つでも欠けたら `available: false` を返し、理由を日本語で書く。
 */
export const URL_SOURCES = [
  'AMAZON_OFFICIAL_ASIN_PATTERN',
  'CONNECTOR_API',
  'CONNECTOR_FEED',
  'OFFICIAL_CSV',
  'HUMAN_ENTRY',
] as const;
export type UrlSource = (typeof URL_SOURCES)[number];

export const URL_SOURCE_JA: Record<UrlSource, string> = {
  AMAZON_OFFICIAL_ASIN_PATTERN: 'Amazon公式のASIN形式（実在確認済みのASINから決定論的に組み立て）',
  CONNECTOR_API: '正式APIが返したURL',
  CONNECTOR_FEED: '正式データフィードのURL',
  OFFICIAL_CSV: '正式提供CSVのURL',
  HUMAN_ENTRY: '人が貼ったURL',
};

/**
 * ★`AI_GENERATED` という選択肢はここに無い。作らない（ルール55の生きている部分）。
 */
export const AMAZON_JP_PRODUCT_URL_PREFIX = 'https://www.amazon.co.jp/dp/';

export type ProductUrlResolution = {
  /** URLを出してよいか */
  available: boolean;
  /** 出してよいときのURL。だめなときは null。 */
  url: string | null;
  /** URLの出どころ。**AI生成としては扱わない。** */
  urlSource: UrlSource | null;
  /** そのASINが親か子か */
  variationRole: AsinVariationRole;
  /**
   * ★これは「URLの形が正しいか」であって「商品が合っているか」ではない。
   *   商品の一致は `PRODUCT_MATCH_CONFIRMED` として**完全に別**に持つ。
   */
  urlValid: boolean;
  /** 通らなかった条件（日本語） */
  blockersJa: string[];
  reasonJa: string;
};

export function resolveAmazonProductUrl(
  provenance: AsinProvenance,
  variationRole: AsinVariationRole = 'UNKNOWN',
): ProductUrlResolution {
  const blockersJa: string[] = [];
  const asin = String(provenance?.asin ?? '').trim().toUpperCase();

  // ① 禁止された出所（文字列で来ることがあるので、そのまま突き合わせる）
  const src = String(provenance?.asinSource ?? '');
  if ((FORBIDDEN_ASIN_SOURCES as readonly string[]).includes(src)) {
    blockersJa.push(`出所が「${FORBIDDEN_ASIN_SOURCE_JA[src as ForbiddenAsinSource]}」です。URLは作りません。`);
  }
  // ② 許可された出所か
  if (!isAllowedAsinSource(src)) {
    blockersJa.push(`出所（${src || '未記入'}）が、使ってよい4つのどれにも当たりません。`);
  }
  // ③ 確からしさ
  if (provenance?.asinConfidence !== ASIN_CONFIDENCE_FOR_URL) {
    blockersJa.push(
      `確からしさが「${ASIN_CONFIDENCE_JA[provenance?.asinConfidence as AsinConfidence] ?? '未記入'}」です。`
      + `URLを出すには「${ASIN_CONFIDENCE_JA.VERIFIED_EXISTS}」が要ります。`,
    );
  }
  // ④ 確認日時
  if (!provenance?.asinVerifiedAt) {
    blockersJa.push('実在を確認した日時が記録されていません。');
  }
  // ⑤ 形
  if (!isAsinShape(asin)) {
    blockersJa.push(`ASINの形が半角英数字${ASIN_LENGTH}桁ではありません。`);
  }
  // ⑥ 市場
  if (Number(provenance?.domainId) !== AMAZON_JP_DOMAIN_ID) {
    blockersJa.push('対象が Amazon.co.jp ではありません。日本以外のURLは出しません。');
  }
  // ⑦ 親ASIN
  if (!roleAllowsPurchaseUrl(variationRole)) {
    blockersJa.push(
      `このASINは「${ASIN_VARIATION_ROLE_JA[variationRole]}」です。`
      + '親ASINはそのままでは買えないことがあるため、購入ページは出しません。',
    );
  }

  const available = blockersJa.length === 0;
  return {
    available,
    url: available ? `${AMAZON_JP_PRODUCT_URL_PREFIX}${asin}` : null,
    urlSource: available ? 'AMAZON_OFFICIAL_ASIN_PATTERN' : null,
    variationRole,
    urlValid: available,
    blockersJa,
    reasonJa: available
      ? 'ASINの実在が確認できているため、Amazon公式の形で商品ページを開けます。'
        + '※ただし「URLが正しいこと」と「この商品が仕入れたい商品と同じであること」は別です。'
      : `商品ページを開きません：${blockersJa.join(' ／ ')}`,
  };
}

/* ================================================================
 * 6. URLの正しさと、商品の一致は別
 * ================================================================ */

/**
 * 【ここを混ぜたら全部が台無しになる】
 *
 * ご本人の指示（2026-08-25）：
 *   「URLが正式形式でも、ASINの商品自体が仕入対象と同じ商品かは別問題です。
 *     そのため URL_VALID = true と PRODUCT_MATCH_CONFIRMED = true は完全に分けてください。
 *     URLが正しくても商品一致が低ければ購入候補にしません。」
 *
 * 商品の一致は `lib/keepa/match.ts` の判定（バーコード・入数・ブランド）で決める。
 * このファイルは**一致には一切触れない**。触れると、いつか片方がもう片方を上書きする。
 */
export type PurchaseGate = {
  urlValid: boolean;
  productMatchConfirmed: boolean;
  /** 購入候補にしてよいか。**両方 true のときだけ true。** */
  purchaseUrlAvailable: boolean;
  reasonJa: string;
};

export function purchaseGate(
  resolution: ProductUrlResolution,
  productMatchConfirmed: boolean,
): PurchaseGate {
  const urlValid = resolution.urlValid === true;
  const both = urlValid && productMatchConfirmed === true;
  return {
    urlValid,
    productMatchConfirmed: productMatchConfirmed === true,
    purchaseUrlAvailable: both,
    reasonJa: both
      ? 'URLの形が正しく、商品の一致も確認できています。'
      : !urlValid
        ? resolution.reasonJa
        : 'URLの形は正しいですが、この商品が仕入れたい商品と同じかどうかが未確認です。'
          + '一致が確認できるまで購入候補にしません。',
  };
}

/**
 * 画面に必ず添える一文。
 * 「AIがリンクを作った」と誤解されないため、そして
 * 「リンクが出た＝買ってよい」と誤解されないための歯止め。
 */
export const PRODUCT_URL_NOTE_JA =
  'このリンクは、実在が確認できたASINから Amazon 公式の形（/dp/ASIN）で組み立てたものです。'
  + 'AIが推測で作ったURLではありません。'
  + 'ただし「リンクが正しいこと」と「この商品が仕入れたい商品と同じであること」は別です。'
  + '商品の一致が確認できるまで、購入候補にはしません。'
  + 'また、押しても新しいタブで開くだけです。カートに入れる・購入する・決済する・ログインする、はしません。';
