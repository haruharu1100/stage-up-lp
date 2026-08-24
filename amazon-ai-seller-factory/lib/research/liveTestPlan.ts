/**
 * 鍵投入直後テスト手順（LIVE TEST PLAN）
 * ===================================================================
 * ユーザー指示（2026-08-20・待機フェーズ）：
 *   「『鍵を入れた直後に何を実行するか』を自動テスト手順として固定してください。」
 *   「絶対にいきなり20件取得しないでください。」
 *
 * ★なぜ「固定」するのか
 *   手順が人の記憶の中にしか無いと、鍵が届いた日に必ず順番を飛ばす。
 *   飛ばして20件取ってしまうと、失敗したときに「どこが悪いのか」が分からなくなる。
 *   そこで手順そのものをコードにして、機械が順番を守る。
 *
 * ★このファイルは「手順の台本」だけを持つ。実際にAPIを呼ぶのは scripts/aliexpress-live.ts。
 *   台本と実行を分けておくと、鍵が無い今でも「何をやる予定か」を全部表示できる。
 */

/** 1つのSTEPの台本 */
export interface LiveTestStep {
  no: number;
  key: string;
  /** 日本語の見出し */
  title: string;
  /** 使うAPI（STEP1は認証確認だけなので null） */
  apiName: string | null;
  /** 何件取るか。0＝商品は取らない */
  fetchCount: number;
  /** access_token が必要か */
  needsToken: boolean;
  /** このSTEPで「取れたか」を必ず目で確かめる項目 */
  checkFields: string[];
  /** 合格の条件（日本語） */
  passCondition: string;
  /** ★このSTEPで絶対にやらないこと */
  forbidden: string;
}

/**
 * ★鍵が届いた直後に、上から順にこれだけを実行する。
 *   途中で1つでも落ちたら、そこで止める。次のSTEPへは進まない。
 */
export const LIVE_TEST_STEPS: LiveTestStep[] = [
  {
    no: 1,
    key: 'AUTHENTICATE',
    title: '認証確認だけ（商品はまだ取らない）',
    apiName: null,
    fetchCount: 0,
    needsToken: false,
    checkFields: ['APP_KEY', 'APP_SECRET', '署名（HMAC-SHA256）', 'アクセストークンの素性'],
    passCondition:
      'AUTHENTICATED=true。鍵が揃い、署名が作れ、API契約台帳に公式URL付きのAPIがある状態',
    forbidden: '★このSTEPでは商品を1件も取得しない。認証が通るかどうかだけを見る',
  },
  {
    no: 2,
    key: 'SEARCH_ONE',
    title: '商品を1件だけ取得（aliexpress.ds.text.search）',
    apiName: 'aliexpress.ds.text.search',
    fetchCount: 1,
    needsToken: false,
    checkFields: [
      '商品ID',
      '商品名',
      '価格',
      '通貨',
      '商品画像',
      '商品URL',
      '店舗',
      'カテゴリー',
      // ★2026-08-24 追加（ユーザー指示で確定）：価格・通貨は生値も並べて確認する
      '価格・通貨のRAW値（無加工）',
      // ★2026-08-25 追加（ユーザー指示で確定）：3段で並べ、送料・在庫まで同じ1件で追う
      '3段トレース（元レスポンス → 正規化後 → 画面表示値）',
      '送料・在庫・MOQ・重量（参考。STEP3/STEP4で確認し直す）',
    ],
    passCondition:
      'APIの生の応答と、システムが表示した値が1件ぶん一致していること。取れない項目はUNKNOWNと明記。' +
      '★価格・通貨は、APIの生値と解釈後の値を並べて出し、人が食い違いを見られる状態にする。' +
      '★元レスポンス → 正規化後 → 画面表示値 を3段で並べ、変換したなら変換ルールも残す。' +
      '★取れなかった項目が1つでもあれば「正常取得」と表示しない',
    forbidden:
      '★1件で失敗したら5件へ進まない。「たぶん取れている」で先へ行かない。' +
      '★不整合が1件でも残っているうちは5件テストを実行しない（件数を増やして誤魔化さない）',
  },
  {
    no: 3,
    key: 'DETAIL_ONE',
    title: '商品詳細を1件だけ取得（aliexpress.ds.product.get）',
    apiName: 'aliexpress.ds.product.get',
    fetchCount: 1,
    needsToken: true,
    checkFields: ['価格', 'MOQ', '在庫', '重量', 'SKU', '商品詳細'],
    passCondition:
      '応答と表示が一致していること。★取得できない項目は UNKNOWN。推定してACTUAL扱いにしない',
    forbidden: '★MOQ・在庫・重量を「たぶん1個」「たぶん500g」などと埋めない',
  },
  {
    no: 4,
    key: 'FREIGHT_ONE',
    title: '日本向け送料を1件だけ取得（aliexpress.ds.freight.query）',
    apiName: 'aliexpress.ds.freight.query',
    fetchCount: 1,
    needsToken: true,
    checkFields: ['配送方法', '送料', '配送予定日', '配送先が日本か', '数量'],
    passCondition:
      'APIの応答と表示値が一致していることを確認してから、初めて着地原価（LANDED COST）へ渡す',
    forbidden: '★確認前の送料を着地原価へ入れない。送料が取れないなら UNKNOWN のまま利益計算する',
  },
  {
    no: 5,
    key: 'IMAGE_ONE',
    title: '画像検索を1件だけ（aliexpress.ds.image.searchV2）',
    apiName: 'aliexpress.ds.image.searchV2',
    fetchCount: 1,
    needsToken: true,
    checkFields: ['候補が返るか', 'AliExpress側の類似度', '既存のMATCH SCORE'],
    passCondition:
      'Amazonの商品画像を基準に候補が返ること。★AliExpress側の類似度と自前のMATCH SCOREを別々に保存する',
    forbidden: '★AliExpress側の類似度をそのまま「同一商品」と判定しない。判定は自前のMATCH SCOREで行う',
  },
];

/**
 * ★各APIが VERIFIED になれる条件（4つ全部）。
 *   ユーザー指示：「HTTP 200 だっただけで VERIFIED にしない」
 *   エラーをJSONで返しつつ HTTP 200 を返すAPIがあるため、中身まで見る。
 */
export interface VerifyChecklist {
  /** ① 実リクエストが成功した（通信できた） */
  requestOk: boolean;
  /** ② 実レスポンスを受け取った（本文がある） */
  responseOk: boolean;
  /** ③ 解析に成功した（商品配列や必要項目を取り出せた） */
  parseOk: boolean;
  /** ④ システム表示と一致した（人が見る値と生データが同じ） */
  displayOk: boolean;
  /** ★HTTP 200 でも中身がエラーでないことを確認した（success / code / error / message） */
  businessCodeOk: boolean;
}

export const VERIFY_CHECK_LABEL: Record<keyof VerifyChecklist, string> = {
  requestOk: '① 実リクエスト成功（通信できた）',
  responseOk: '② 実レスポンス取得（本文が返ってきた）',
  parseOk: '③ レスポンス解析成功（必要な項目を取り出せた）',
  displayOk: '④ システム表示確認（生データと表示が一致）',
  businessCodeOk: '★HTTP200でも中身がエラーでないことを確認（success/code/error/message）',
};

/** 4つ＋業務コード確認が全部通ったときだけ VERIFIED にしてよい */
export function canVerify(c: VerifyChecklist): boolean {
  return c.requestOk && c.responseOk && c.parseOk && c.displayOk && c.businessCodeOk;
}

/** 通らなかった項目を日本語で並べる */
export function describeVerifyGaps(c: VerifyChecklist): string[] {
  return (Object.keys(VERIFY_CHECK_LABEL) as (keyof VerifyChecklist)[])
    .filter((k) => !c[k])
    .map((k) => `未達：${VERIFY_CHECK_LABEL[k]}`);
}

/**
 * ★20件テストへ進んでよいかの条件（8項目）。
 *   ユーザー指示のとおり、全部満たしたときだけ 20件へ行く。
 */
export interface TwentyGate {
  oneItemPassed: boolean;
  fiveItemSuccessRate100: boolean;
  criticalParseErrorsZero: boolean;
  productUrlOk: boolean;
  imageOk: boolean;
  priceOk: boolean;
  freightOkOrUnknownStated: boolean;
  mockContaminationZero: boolean;
}

export const TWENTY_GATE_LABEL: Record<keyof TwentyGate, string> = {
  oneItemPassed: '1件テストに成功した',
  fiveItemSuccessRate100: '5件テストの成功率が100%だった',
  criticalParseErrorsZero: '重要項目の解析エラーが0件だった',
  productUrlOk: '商品URLが正常（クリックで購入ページへ行ける形）',
  imageOk: '商品画像が正常',
  priceOk: '価格が正常（0円・マイナス・異常通貨が無い）',
  freightOkOrUnknownStated: '送料が正常、または UNKNOWN と明示されている',
  mockContaminationZero: 'Mock（にせデータ）の混入が0件',
};

export function canGoTwenty(g: TwentyGate): boolean {
  return (Object.keys(TWENTY_GATE_LABEL) as (keyof TwentyGate)[]).every((k) => g[k]);
}

export function describeTwentyGate(g: TwentyGate): string[] {
  return (Object.keys(TWENTY_GATE_LABEL) as (keyof TwentyGate)[]).map(
    (k) => `  ${g[k] ? '合格' : '未達  '} ${TWENTY_GATE_LABEL[k]}`,
  );
}

/**
 * ★LIVE_DISCOVERY_READY=true にしてよい条件（4段階＋実データ4つ）。
 *   ユーザー指示：「DOCUMENTED / AUTHORIZED / CONNECTED / VERIFIED に加えて
 *     実商品取得成功・購入URL確認・価格取得・Amazon照合成功 まで通してから true にする」
 */
export const LIVE_READY_CONDITIONS = [
  'DOCUMENTED（公式資料で存在確認）',
  'AUTHORIZED（権限を取得）',
  'CONNECTED（本物のAPIへ認証成功）',
  'VERIFIED（実データを取得して中身を確認）',
  '実商品の取得に成功した',
  '購入ページURLを確認した（人がクリックして買える）',
  '価格を取得した',
  'Amazonとの照合に成功した',
] as const;

/**
 * ★Aランクにしてよい条件。
 *   1つでもUNKNOWNならAランク禁止（B または要確認へ落とす）。
 *   これは変更しない、とユーザーが明言している項目。
 */
export const A_RANK_REQUIRED_FIELDS = [
  '仕入価格',
  '商品URL',
  '商品画像',
  'Amazon価格',
  'Amazon手数料',
  '主要送料',
  'MATCH SCORE',
] as const;

/**
 * ★STEP2（本物の商品1件）が取れた瞬間に、必ず止まる。
 * ===================================================================
 * ユーザー指示（2026-08-22）：
 *   「1商品取得できた瞬間に一度私に戻してください。」
 *   理由：Keepaで実際に、画像形式の読み違い／`-2` の意味の読み違い／
 *         寸法 `-1` のすり抜け が起きた。AliExpressでも最初の実レスポンスで
 *         仕様解釈ミスが見つかる可能性がある。
 *
 * ★止まるのが既定。先へ進むには、人が明示的に `--after-audit` を付けて再実行する。
 *   「勝手に進まない」ことをコードで担保する（人の記憶に頼らない）。
 */
export const AUDIT_PAUSE_FLAG = 'after-audit';

/**
 * ★1商品目で必ず保存する13項目（監査ログ）。
 *   秘密情報（app_key / app_secret / sign / access_token）は含めない。
 */
export const FIRST_PRODUCT_AUDIT_FIELDS = [
  '呼び出したAPI名',
  'request項目（秘密情報を除く）',
  'HTTP status',
  'AliExpress側 code',
  'success / error',
  '取得した product ID',
  '商品名',
  '価格',
  '通貨',
  '画像',
  '商品URL',
  '取得日時',
  'UNKNOWN項目',
] as const;

/**
 * ★上の13項目に加えて、価格・通貨だけは「APIの生値」も別に保存する（5項目）。
 * ===================================================================
 * ユーザー指示（2026-08-24・確定）：
 *   「価格RAW値の監査表示は『実装する』で確定です。
 *     AliExpress初回LIVE商品取得時に、APIが返した価格・通貨の生値と、
 *     システム解釈後の値を必ず並べて表示してください。
 *     RAW値は加工・丸め・換算禁止です。」
 *
 * ★なぜ価格だけ特別扱いするのか
 *   価格の読み違いは、そのまま「赤字商品を黒字と判定する」に直結する唯一の項目。
 *   Keepaでは実際に `-2` を販売価格として利益計算へ流していた。
 *   解釈後の値しか残っていなければ、その事故は監査で見つけられない。
 *
 * ★RAW値には手を加えない
 *   丸めない・換算しない・大文字化しない・カンマを消さない。
 *   JSON表記のまま残すので、引用符の有無で「文字列で来たのか数値で来たのか」まで判る。
 */
export const FIRST_PRODUCT_RAW_AUDIT_FIELDS = [
  '価格RAW（APIの生値・無加工）',
  '価格RAWの項目名（どの項目から取ったか）',
  '通貨RAW（APIの生値・無加工）',
  '通貨RAWの項目名',
  '応答に含まれた価格・通貨らしき項目すべて（選ばなかったものも含む）',
] as const;

/**
 * ★3段トレースとして必ず残す4項目（2026-08-25 ユーザー指示で確定）。
 *
 *   「1商品取得時は、APIから返った元レスポンス → 正規化後 → 画面表示値を
 *     3段で並べて比較する」
 *   「UNKNOWN / NULL / NOT_AVAILABLE / 特殊値 / 0 / 実数 を完全に別状態として扱う」
 *   「価格だけでなく、送料・在庫・通貨・画像・URL・ASIN/商品IDも同じ1件について追跡する」
 *   「値を変換した場合は、元値・変換ルール・変換後を残す」
 *   「取得できなかった項目があれば、商品全体を『正常取得』と表示しない」
 *   「1商品で不整合が1つでも見つかったら、5件テストへ進まない」
 *
 * ★2段（生値⇔解釈後）では足りない理由
 *   解釈までは正しくても、画面へ渡す途中で落ちる・丸まることがある。
 *   ①と③だけを見比べても、どこで壊れたのかを切り分けられない。
 */
export const FIRST_PRODUCT_TRACE_AUDIT_FIELDS = [
  '3段トレース（必須＝商品ID・商品名・価格・通貨・画像・URL／参考＝送料・在庫・MOQ・重量）',
  '取れなかった項目の一覧（状態つき：実数 / 0 / 特殊値 / NOT_AVAILABLE / NULL / MISSING / UNKNOWN）',
  '不整合の件数（★1件でもあれば5件テストへ進まない）',
  '「正常取得」と言ってよいか（必須項目が全部そろった場合のみ 1）',
] as const;

/**
 * ★STEP2で止まったときに、ChatGPTへ渡すためにまとめる10項目。
 *   この10項目がそろわないうちは STEP3 へ進まない。
 */
export const CHATGPT_AUDIT_ITEMS = [
  '1. 使用したAPI',
  '2. 認証結果',
  '3. 実レスポンスから取得できた項目',
  '4. UNKNOWN項目',
  '5. APIレスポンスで想定外だった点',
  '6. 商品URL',
  '7. 価格（★APIの生値と、システム解釈後の値を並べて表示。RAW値は無加工）',
  '8. 画像取得結果',
  '8-2. 3段トレース（★元レスポンス → 正規化後 → 画面表示値／変換ルールつき）',
  '9. VERIFIEDにしてよいか',
  '10. 次のSTEP3へ進めてよいか',
] as const;

/** 手順書をそのまま画面・ログへ出す（鍵が無くても読める） */
export function describePlan(): string[] {
  const out: string[] = [];
  out.push('=== 鍵を入れた直後にやること（固定手順・上から順に。飛ばさない）===');
  out.push('');
  out.push('★2026-08-22 追加：STEP2（本物の商品1件）が取れた時点で、必ず一度止まります。');
  out.push('  止まったら10項目のレポートを出すので、ChatGPTの監査を受けてください。');
  out.push('  監査が済んだら  npm run aliexpress:live:continue  で STEP3 以降へ進みます。');
  out.push('');
  out.push('★2026-08-24 追加：価格・通貨は「APIの生値」も並べて表示します（RAW監査）。');
  out.push('  生値は加工・丸め・換算をしません。JSON表記のまま出します。');
  out.push('  監査ログにも別の欄で保存します：');
  for (const f of FIRST_PRODUCT_RAW_AUDIT_FIELDS) out.push(`    ・${f}`);
  out.push('');
  out.push('★2026-08-25 追加：1商品目は「元レスポンス → 正規化後 → 画面表示値」を3段で並べます。');
  out.push('  取れなかった理由は6つに分けます（実数 / 0 / 特殊値 / NOT_AVAILABLE / NULL / UNKNOWN）。');
  out.push('  ★不整合が1件でも残っているうちは、5件テストへ進みません（件数を増やしません）。');
  out.push('  監査ログにも別の欄で保存します：');
  for (const f of FIRST_PRODUCT_TRACE_AUDIT_FIELDS) out.push(`    ・${f}`);
  for (const s of LIVE_TEST_STEPS) {
    out.push('');
    out.push(`【STEP ${s.no}】${s.title}`);
    out.push(`  使うAPI      ： ${s.apiName ?? '（なし。認証確認だけ）'}`);
    out.push(`  取得件数     ： ${s.fetchCount === 0 ? '0件（商品は取らない）' : `${s.fetchCount}件`}`);
    out.push(`  トークン必要 ： ${s.needsToken ? '必要' : '不要'}`);
    out.push(`  確認する項目 ： ${s.checkFields.join(' / ')}`);
    out.push(`  合格の条件   ： ${s.passCondition}`);
    out.push(`  ${s.forbidden}`);
  }
  out.push('');
  out.push('=== 各APIが VERIFIED になれる条件（全部そろって初めて）===');
  for (const k of Object.keys(VERIFY_CHECK_LABEL) as (keyof VerifyChecklist)[]) {
    out.push(`  ${VERIFY_CHECK_LABEL[k]}`);
  }
  out.push('');
  out.push('=== 20件テストへ進んでよい条件（8項目すべて）===');
  for (const k of Object.keys(TWENTY_GATE_LABEL) as (keyof TwentyGate)[]) {
    out.push(`  ・${TWENTY_GATE_LABEL[k]}`);
  }
  out.push('');
  out.push('=== LIVE_DISCOVERY_READY=true の条件（すべて必要）===');
  for (const c of LIVE_READY_CONDITIONS) out.push(`  ・${c}`);
  out.push('');
  out.push('=== Aランク禁止の条件（1つでもUNKNOWNならAにしない）===');
  out.push(`  ${A_RANK_REQUIRED_FIELDS.join(' / ')}`);
  return out;
}
