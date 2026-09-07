// ─────────────────────────────────────────────────────────────
// Amazon「出品規制カテゴリ」除外フィルター
//   Amazonでは以下は出品にカテゴリー承認が必要 or 出品自体が禁止で、
//   仕入れても販売できない（＝利益候補に出しても意味がない）。
//     ・食品＆飲料 … 要承認
//     ・ドラッグストア（サプリ/健康食品） … 要承認
//     ・酒類 … 原則出品不可（酒販免許＋承認）
//     ・医薬品（第1〜3類） … 要件が厳しく実質不可
//     ・たばこ／加熱式たばこ … 出品禁止
//   → これらは仕入れ候補(findings)から必ず EXCLUDE する。
//   ※化粧品・医薬部外品(薬用シャンプー等)・医療機器(血圧計/体温計)は
//     一般に出品可なので除外しない（＝取扱家電を誤って弾かない）。
//
// 一次シグナル: Keepaのカテゴリーツリー名（例 栄養補助食品/ビール・洋酒/医薬品）。
//              最も正確なので、これが取れていれば最優先で判定する。
// 二次(フォールバック): 商品名キーワード（カテゴリーが取れない照合や取りこぼし用）。
//              取扱ブランド(Anker/SanDisk/LEGO/象印/タニタ/オムロン/山善 等)に
//              誤ヒットしない語だけを厳選する。
//
// 方針: 「判断に迷う規制系は EXCLUDE（安全側）」。ただし販売可の非該当品
//        (歯ブラシ/化粧品/医療機器/家電)を誤って弾かないことを最優先で担保する。
// ─────────────────────────────────────────────────────────────

// 規制カテゴリの定義。categoryTerms=カテゴリーツリー名の部分一致、
// titleTerms=商品名の部分一致(小文字比較)。誤除外を避けるため titleTerms は厳選。
const RESTRICTED_GROUPS = [
  {
    label: "食品/サプリ",
    categoryTerms: [
      // サプリ・健康食品
      "栄養補助食品", "サプリメント", "健康食品", "ダイエット・健康", "プロテイン",
      // 食品・飲料
      "食品", "飲料", "ドリンク", "コーヒー", "紅茶", "お茶・コーヒー",
      "スイーツ・お菓子", "菓子", "レトルト", "缶詰", "ミネラルウォーター",
      // ベビー/ペットの食べ物
      "ベビーフード", "ペットフード", "ドッグフード", "キャットフード",
    ],
    titleTerms: [
      // ★食品・健康食品を示す明示ラベル（最も強いシグナル）
      "機能性表示食品", "栄養機能食品", "特定保健用食品", "トクホ",
      "サプリ", "サプリメント", "栄養補助", "健康食品",
      "マルチビタミン", "プロテイン", "ホエイ", "bcaa", "eaa",
      "青汁", "乳酸菌", "コエンザイム", "グルコサミン", "コンドロイチン",
      "dha", "epa", "フィッシュオイル", "魚油", "葉酸", "亜鉛サプリ", "鉄分",
      // ★ほぼサプリ専用の成分名（化粧品/家電に誤ヒットしない語だけを厳選）
      "エクオール", "大豆イソフラボン", "セサミン", "ノコギリヤシ",
      "にんにく卵黄", "すっぽん", "高麗人参", "田七人参", "イチョウ葉", "ルテイン",
      "ベビーフード", "ペットフード", "ドッグフード", "キャットフード",
      "炭酸飲料", "清涼飲料", "スポーツドリンク",
    ],
  },
  {
    label: "酒類",
    // 酒類はカテゴリー名を主軸に判定（「ビールサーバー」等の家電を誤除外しないため
    //  titleTerms には家電と紛れない語だけを入れる）。
    categoryTerms: [
      "お酒", "アルコール飲料", "ビール・洋酒", "ビール・発泡酒", "日本酒・焼酎",
      "ワイン", "ウイスキー", "ブランデー", "チューハイ", "梅酒", "リキュール",
    ],
    titleTerms: ["日本酒", "焼酎", "ウイスキー", "ブランデー", "本格焼酎", "純米酒", "吟醸"],
  },
  {
    label: "医薬品",
    categoryTerms: [
      "医薬品", "第1類医薬品", "第2類医薬品", "第3類医薬品",
      "指定第2類医薬品", "要指導医薬品",
    ],
    // 明示ラベルのみ（医療機器=血圧計/体温計は販売可なので絶対に入れない）。
    titleTerms: [
      "第1類医薬品", "第2類医薬品", "第3類医薬品", "第１類医薬品", "第２類医薬品",
      "第３類医薬品", "指定第2類医薬品", "要指導医薬品",
    ],
  },
  {
    label: "たばこ",
    categoryTerms: ["たばこ", "タバコ", "加熱式たばこ", "紙巻きたばこ"],
    titleTerms: ["加熱式たばこ", "紙巻きたばこ", "リトルシガー", "手巻きたばこ"],
  },
];

// カテゴリーツリー名の配列から規制カテゴリを判定する。
function matchCategoryTree(categoryTree) {
  if (!Array.isArray(categoryTree)) return null;
  for (const raw of categoryTree) {
    const name = String(raw || "");
    for (const g of RESTRICTED_GROUPS) {
      for (const term of g.categoryTerms) {
        if (name.includes(term)) return { label: g.label, hit: name };
      }
    }
  }
  return null;
}

// 商品名（仕入れ元 or Amazonタイトル）から規制カテゴリを判定する。
function matchTitle(title) {
  const s = String(title || "").toLowerCase();
  if (!s) return null;
  for (const g of RESTRICTED_GROUPS) {
    for (const term of g.titleTerms) {
      if (s.includes(String(term).toLowerCase())) return { label: g.label, hit: term };
    }
  }
  return null;
}

/**
 * Amazon出品規制カテゴリ（食品/サプリ・酒類・医薬品・たばこ）かどうかを判定する。
 * @param {object} arg
 * @param {string}   arg.title        仕入れ元の商品名
 * @param {string}   arg.amazonTitle  Amazon側タイトル（あれば）
 * @param {string[]} arg.categoryTree Keepaカテゴリーツリー名（あれば）
 * @returns {{excluded:boolean, reason:string|null, by:string|null, label:string|null}}
 */
export function classifyRestrictedCategory({ title, amazonTitle, categoryTree } = {}) {
  // ① 一次: カテゴリーツリー（最も正確）
  const catHit = matchCategoryTree(categoryTree);
  if (catHit) {
    return {
      excluded: true,
      label: catHit.label,
      by: "category",
      reason: `Amazonカテゴリー「${catHit.hit}」＝${catHit.label}(出品規制)`,
    };
  }
  // ② 二次: 商品名キーワード（Amazonタイトル→仕入れ元名の順で見る）
  const titleHit = matchTitle(amazonTitle) || matchTitle(title);
  if (titleHit) {
    return {
      excluded: true,
      label: titleHit.label,
      by: "title",
      reason: `商品名に「${titleHit.hit}」＝${titleHit.label}(出品規制)の可能性`,
    };
  }
  return { excluded: false, reason: null, by: null, label: null };
}

// 後方互換の別名（既存の呼び出し元 crawler.js / evaluate.js 用）。
export const classifyRestrictedFood = classifyRestrictedCategory;

export const _internal = { RESTRICTED_GROUPS, matchCategoryTree, matchTitle };
