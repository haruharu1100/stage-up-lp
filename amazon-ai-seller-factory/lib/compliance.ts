import { checkImportRegulations } from './importRules';
import type { ComplianceItem, ComplianceResult, ListingPlan, ProductCore, SupplierQuote } from './types';

/**
 * コンプライアンス判定（AI社員07の頭脳）。
 * 1つでも blocking があれば AUTO PUBLISH は止まる。
 * ※ここは「機械的に確実に弾ける部分」。最終的な法的判断の代わりにはならない。
 */

/** 景品表示法：優良誤認・有利誤認になりやすい断定/最上級 */
const KEIHYO_NG = [
  '必ず', '絶対', '100%', '完全に', '日本一', '世界一', '業界No.1', 'No.1', 'ナンバーワン',
  '最高級', '最安値', '業界最安', '唯一', '他社にはない', '永久', '無制限', '確実に',
  '誰でも', '簡単に稼', '儲か',
];

/** 薬機法：食品・雑貨に書いてはいけない医薬品的な効能 */
const YAKKI_NG = [
  '治る', '治す', '治療', '完治', '効く', '効果があります', '予防', '改善します', '症状',
  '免疫力', 'デトックス', '毒素', 'アンチエイジング', '若返', '痩せる', 'ダイエット効果',
  '脂肪燃焼', '血圧を下げ', '血糖値を下げ', 'がん', '認知症', '花粉症', 'アトピー',
  '医薬品', '薬効', '副作用', '疲労回復', '便秘解消', '不眠',
];

/** Amazonで出品できない／強い制限がある領域 */
const PROHIBITED = [
  { word: '医薬品', reason: '医薬品は出品許可と資格が必要（多くは出品不可）' },
  { word: '処方', reason: '処方薬は出品不可' },
  { word: 'たばこ', reason: 'たばこ製品は出品不可' },
  { word: '電子たばこ', reason: '電子たばこ・ニコチン製品は出品不可' },
  { word: '酒', reason: '酒類は酒類販売業免許とAmazonの出品許可が必要' },
  { word: 'ビール', reason: '酒類は酒類販売業免許とAmazonの出品許可が必要' },
  { word: 'ワイン', reason: '酒類は酒類販売業免許とAmazonの出品許可が必要' },
  { word: '銃', reason: '武器類は出品不可' },
  { word: '刀', reason: '刃物・武器類は制限あり' },
  { word: '医療機器', reason: '医療機器は許認可が必要' },
  { word: 'サプリメント', reason: 'サプリは表示規制が厳しく出品許可が必要な場合がある' },
  { word: '化粧品', reason: '化粧品は薬機法の表示義務と出品許可が必要' },
  { word: '中古', reason: '中古品の販売は古物商許可が必要' },
];

/** 他社ブランド名の無断使用チェック（代表例。運用しながら足す） */
const TRADEMARK_HINTS = [
  'ディズニー', 'サンリオ', 'ポケモン', 'ジブリ', 'マリオ', 'スターバックス', 'コカ・コーラ',
  'Apple', 'iPhone', 'Nintendo', 'ドラえもん', 'アンパンマン', 'ミッキー', 'すみっコぐらし',
];

/** 食品表示法で商品ページに必要な情報 */
const FOOD_LABEL_FIELDS: { key: string; label: string; test: (text: string, p: ProductCore) => boolean }[] = [
  { key: 'name', label: '名称', test: (t) => /名称|品名/.test(t) },
  { key: 'ingredients', label: '原材料名', test: (t) => /原材料/.test(t) },
  { key: 'allergen', label: 'アレルゲン（特定原材料）', test: (t) => /アレルゲン|特定原材料|アレルギー/.test(t) },
  { key: 'content', label: '内容量', test: (t) => /内容量|g|ml|個入|袋/.test(t) },
  { key: 'expiry', label: '賞味期限（または消費期限）', test: (t, p) => /賞味期限|消費期限/.test(t) || (p.shelfLifeDays ?? 0) > 0 },
  { key: 'storage', label: '保存方法', test: (t, p) => /保存方法|冷蔵|冷凍|常温|直射日光/.test(t) || !!p.storageMethod },
  { key: 'maker', label: '製造者・販売者（住所を含む）', test: (t) => /製造者|販売者|製造所|加工所/.test(t) },
  { key: 'nutrition', label: '栄養成分表示', test: (t) => /栄養成分|エネルギー|たんぱく質|kcal/.test(t) },
];

export interface ComplianceInput {
  product: ProductCore;
  plan?: ListingPlan | null;
  hasMasterImage: boolean;
  masterImageRights?: string | null;
  gtin?: string | null;
  brandOwned?: boolean;
  listingText?: string;
  /** 仕入先。海外仕入なら輸入規制（食品衛生法・薬機法・PSE・技適）を必ず点検する */
  quote?: SupplierQuote | null;
}

export function runCompliance(input: ComplianceInput): ComplianceResult {
  const { product: p, plan } = input;
  const items: ComplianceItem[] = [];
  const text = [
    input.listingText || '',
    plan?.titles?.join('\n') || '',
    plan?.bulletPoints?.join('\n') || '',
    plan?.description || '',
    plan?.adAngles?.join('\n') || '',
    plan?.imagePlan?.map((i) => i.overlayText.join(' ')).join('\n') || '',
    p.title,
  ].join('\n');

  const add = (
    category: string,
    check: string,
    passed: boolean,
    severity: ComplianceItem['severity'],
    detail: string,
    law?: string,
    evidence?: string,
  ) => items.push({ category, check, severity, passed, detail, law, evidence });

  // 1. Amazon販売禁止・制限商品 -------------------------------------
  const hits = PROHIBITED.filter((x) => (p.title + ' ' + (p.category || '')).includes(x.word));
  add(
    '販売可否',
    'Amazon販売禁止・制限商品に当たらないか',
    hits.length === 0,
    hits.length ? 'blocking' : 'info',
    hits.length ? hits.map((h) => `「${h.word}」→ ${h.reason}`).join(' / ') : '禁止商品の語は見つかりませんでした',
    'Amazon出品規約',
  );

  // 2. カテゴリー制限 ------------------------------------------------
  const needsApproval = p.isFood || /食品|飲料|ドラッグ|ビューティー|ペット/.test(p.category || '');
  add(
    'カテゴリー',
    '出品許可（カテゴリー申請）が必要か',
    !needsApproval,
    needsApproval ? 'warning' : 'info',
    needsApproval
      ? `「${p.category || '該当カテゴリー'}」は出品許可の申請が必要な場合があります。セラーセントラルで自分のアカウントの出品可否を確認してください`
      : '出品許可が必要なカテゴリーではありません',
    'Amazon出品規約',
  );

  // 3. 食品表示 ------------------------------------------------------
  if (p.isFood) {
    const missing = FOOD_LABEL_FIELDS.filter((f) => !f.test(text, p)).map((f) => f.label);
    add(
      '食品表示',
      '食品表示法で必要な項目が商品ページに揃っているか',
      missing.length === 0,
      missing.length ? 'blocking' : 'info',
      missing.length ? `不足：${missing.join(' / ')}。メーカーの一括表示ラベルの内容を転記してください` : '必要項目は揃っています',
      '食品表示法',
    );

    // 4. 賞味期限 ----------------------------------------------------
    const days = p.shelfLifeDays ?? 0;
    add(
      '賞味期限',
      'FBA納品時に残存期限が足りるか（目安：残り60日以上＋出荷リードタイム）',
      days >= 90,
      days === 0 ? 'blocking' : days < 90 ? 'warning' : 'info',
      days === 0
        ? '賞味期限が未入力です。食品は賞味期限が分からないままFBAに納品できません'
        : `賞味期限 ${days}日。FBAは残存期限の要件があるため、納品時点の残日数で必ず確認してください`,
      'Amazon FBA規約',
    );

    // 5. 保存方法 ----------------------------------------------------
    add(
      '保存方法',
      '保存方法が明記されているか',
      !!p.storageMethod,
      p.storageMethod ? 'info' : 'blocking',
      p.storageMethod ? `保存方法：${p.storageMethod}` : '保存方法が未入力です',
      '食品表示法',
    );
  }

  // 6. 冷凍・冷蔵 ------------------------------------------------------
  const needsCold = p.temperatureControl === 'frozen' || p.temperatureControl === 'chilled';
  add(
    '温度帯',
    '常温以外（冷蔵・冷凍）でないか',
    !needsCold,
    needsCold ? 'blocking' : 'info',
    needsCold
      ? `${p.temperatureControl === 'frozen' ? '冷凍' : '冷蔵'}商品です。Amazon.co.jpのFBAは要冷蔵・冷凍商品を原則取り扱えません。自社出荷（FBM）か別倉庫の前提に切り替えてください`
      : '常温品のためFBAで扱えます',
    'Amazon FBA規約',
  );

  // 7. 権利侵害・商標 ---------------------------------------------------
  const tm = TRADEMARK_HINTS.filter((w) => text.includes(w));
  add(
    '知的財産',
    '他社の商標・キャラクター名を無断で使っていないか',
    tm.length === 0,
    tm.length ? 'blocking' : 'info',
    tm.length ? `検出：${tm.join('、')}。正規の許諾が無い限り使用できません` : '他社商標の無断使用は見つかりませんでした',
    '商標法・著作権法',
  );

  // 8. 商品画像の使用許可 ------------------------------------------------
  add(
    '画像の権利',
    '商品画像が自社/メーカー/問屋/許諾済みのものか',
    input.hasMasterImage,
    input.hasMasterImage ? 'info' : 'blocking',
    input.hasMasterImage
      ? `MASTER PRODUCT IMAGE の権利区分：${input.masterImageRights || '未記入'}`
      : 'MASTER PRODUCT IMAGE が登録されていません。他社やAmazonの商品画像の流用は著作権侵害です。自社撮影・メーカー提供等の画像を登録してください',
    '著作権法',
  );

  // 9. 誇大広告・虚偽表示 ------------------------------------------------
  const keihyo = KEIHYO_NG.filter((w) => text.includes(w));
  add(
    '表示',
    '景品表示法：優良誤認・有利誤認になる表現がないか',
    keihyo.length === 0,
    keihyo.length ? 'blocking' : 'info',
    keihyo.length ? `検出：${keihyo.join('、')}。根拠のない断定・最上級表現は使えません` : '断定・最上級表現は見つかりませんでした',
    '景品表示法',
    keihyo.join('、'),
  );

  // 10. 薬機法 ----------------------------------------------------------
  const yakki = YAKKI_NG.filter((w) => text.includes(w));
  add(
    '表示',
    '薬機法：医薬品的な効能効果をうたっていないか',
    yakki.length === 0,
    yakki.length ? 'blocking' : 'info',
    yakki.length ? `検出：${yakki.join('、')}。食品・雑貨で医薬品的な効能は表現できません` : '医薬品的な表現は見つかりませんでした',
    '医薬品医療機器等法',
    yakki.join('、'),
  );

  // 11. JAN/GTIN --------------------------------------------------------
  const gtin = input.gtin ?? p.gtin ?? null;
  const gtinValid = !!gtin && /^\d{8}$|^\d{12,14}$/.test(gtin);
  add(
    '商品コード',
    'JAN/GTINが登録されているか',
    gtinValid,
    gtinValid ? 'info' : 'warning',
    gtinValid
      ? `GTIN：${gtin}`
      : 'JAN/GTINが未登録です。新規商品として出品する場合はGS1ジャパンで取得したJANコード、または免除申請が必要です',
    'Amazon出品規約',
  );

  // 12. ブランド --------------------------------------------------------
  add(
    'ブランド',
    'ブランド名が決まっているか（新規出品時）',
    !!p.brand,
    p.brand ? 'info' : 'warning',
    p.brand ? `ブランド：${p.brand}` : 'ブランド名が未設定です。新規カタログを作る場合はブランド登録が必要です',
    'Amazon出品規約',
  );

  // 13. FBA納品条件 ------------------------------------------------------
  const dims = p.packageSizeCm ? [p.packageSizeCm.length, p.packageSizeCm.width, p.packageSizeCm.height] : [0, 0, 0];
  const maxSide = Math.max(...dims);
  const weightOk = (p.weightG ?? 0) <= 40000;
  const sizeOk = maxSide <= 200 && dims.reduce((a, b) => a + b, 0) <= 220;
  add(
    'FBA',
    'FBAのサイズ・重量の上限内か',
    weightOk && sizeOk,
    weightOk && sizeOk ? 'info' : 'warning',
    weightOk && sizeOk
      ? `最大辺 ${maxSide}cm / 重量 ${(p.weightG ?? 0) / 1000}kg で問題ありません`
      : 'FBAのサイズまたは重量の上限を超えている可能性があります',
    'Amazon FBA規約',
  );

  // 14. 健康強調表示 -------------------------------------------------------
  if (p.isFood) {
    const healthClaim = /機能性表示食品|特定保健用食品|トクホ|栄養機能食品/.test(text);
    add(
      '食品表示',
      '健康強調表示は届出・許可がある場合だけか',
      !healthClaim,
      healthClaim ? 'blocking' : 'info',
      healthClaim
        ? '機能性表示食品・トクホ等の表示を検出しました。届出番号や許可の証跡が無ければ表示できません'
        : '無許可の健康強調表示はありません',
      '食品表示法・健康増進法',
    );
  }

  // N. 輸入規制（海外から仕入れる場合の許認可）--------------------------
  //    ★これを通っていない商品は仕入れ判断に出さない（事業Vault/05の絶対ルール13）
  items.push(...checkImportRegulations(p, input.quote ?? null));

  const blockingCount = items.filter((i) => !i.passed && i.severity === 'blocking').length;
  const warningCount = items.filter((i) => !i.passed && i.severity === 'warning').length;
  const verdict: ComplianceResult['verdict'] = blockingCount > 0 ? 'block' : warningCount > 0 ? 'warn' : 'pass';

  return { verdict, items, blockingCount, warningCount };
}

/** 文章だけを素早く検査（AI生成直後のフィルタ用） */
export function scanText(text: string): { word: string; law: string }[] {
  const out: { word: string; law: string }[] = [];
  for (const w of KEIHYO_NG) if (text.includes(w)) out.push({ word: w, law: '景品表示法' });
  for (const w of YAKKI_NG) if (text.includes(w)) out.push({ word: w, law: '薬機法' });
  for (const w of TRADEMARK_HINTS) if (text.includes(w)) out.push({ word: w, law: '商標法' });
  return out;
}
