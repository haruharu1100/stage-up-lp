// ─────────────────────────────────────────────────────────────
// 商品同一性判定エンジン（純粋関数・DB/通信に一切依存しない）
//
// 目的：「似た別商品」を同一商品と誤判定する事故を極力ゼロにする。
// 方針：タイトル類似度が高くても、HARD CONFLICT（型番末尾・有線/無線・容量・
//       セット数・世代・サイズ・対応機種・エディション・色）が1つでもあれば
//       スコアに関係なく即 reject（CONFLICT）する。Precision（誤仕入れ防止）最優先。
//
// 照合優先順位：
//   1. JAN完全一致            → JAN_VERIFIED
//   2. 型番完全一致            → MODEL_VERIFIED
//   3. 型番正規化完全一致      → MODEL_VERIFIED
//   4. 属性一致(ブランド＋固有) → ATTRIBUTE_VERIFIED
//   5. 名前一致のみ            → NAME_UNVERIFIED（MANUAL_ONLY・自動仕入れ/通知の対象外）
//   ○ HARD CONFLICT あり       → CONFLICT（reject）
//
// このモジュールは単体テスト（scripts/test-matching.mjs）で検証する。
// ─────────────────────────────────────────────────────────────

// 自動仕入れ・自動通知を許可してよい match_status（確実な一致のみ）
export const AUTO_ELIGIBLE_STATUSES = new Set(["JAN_VERIFIED", "MODEL_VERIFIED"]);

// HARD CONFLICT として扱う属性（1つでも食い違えば即 reject）
export const HARD_CONFLICT_ATTRS = [
  "model",
  "capacity",
  "connectivity",
  "packCount",
  "generation",
  "size",
  "device",
  "edition",
  "color",
];

// ブランド表記ゆれ（英語／カタカナ／漢字を同一概念に寄せる）
const BRAND_GROUPS = [
  ["sandisk", "サンディスク"],
  ["samsung", "サムスン", "サムソン"],
  ["kioxia", "キオクシア", "toshiba", "東芝"],
  ["transcend", "トランセンド"],
  ["buffalo", "バッファロー"],
  ["elecom", "エレコム"],
  ["logitec", "logicool", "ロジテック", "ロジクール"],
  ["sony", "ソニー"],
  ["panasonic", "パナソニック"],
  ["apple", "アップル"],
  ["anker", "アンカー"],
  ["hori", "ホリ"],
  ["nintendo", "ニンテンドー", "任天堂"],
  ["microsoft", "マイクロソフト"],
  ["western", "wd", "ウエスタンデジタル"],
  ["seagate", "シーゲート"],
  ["lexar", "レキサー"],
  ["verbatim", "バーベイタム"],
  ["epson", "エプソン"],
  ["canon", "キヤノン", "キャノン"],
  ["brother", "ブラザー"],
];
const BRAND_TOKEN = new Map();
for (const g of BRAND_GROUPS) for (const t of g) BRAND_TOKEN.set(t, g[0]);

// 一般語・売り文句（一致してもマッチ根拠にしない）
const STOPWORDS = new Set([
  "送料無料", "送料", "無料", "特売", "母の日", "父の日", "ポイント",
  "クーポン", "セール", "最安", "限定", "新品", "中古", "未使用", "正規品",
  "保証", "対応", "当日", "発送", "あす楽", "翌日", "店内", "ランキング",
  "人気", "おすすめ", "激安", "在庫", "即納", "国内", "海外", "純正",
  "公式", "割引", "値下げ", "税込", "税抜", "本体", "予約",
  "for", "the", "and", "with", "new", "set", "pro", "max", "plus", "mini",
  "ゲーム", "game", "usb", "pc", "windows", "対応機種",
]);

function norm(s) {
  return String(s || "").toLowerCase();
}

// 型番らしい英数字混在コードを抽出（例: SPF-040U, SDSQUNR128G）。
// 区切り（- _ . 空白）を除いた形で返す。
export function extractModels(text) {
  const flat = norm(text).replace(/[-_.]/g, "");
  const out = new Set();
  for (const m of flat.matchAll(/[a-z0-9]+/g)) {
    const t = m[0];
    // 英字と数字が混在し、5文字以上のものだけ型番候補とする
    if (t.length >= 5 && /[a-z]/.test(t) && /\d/.test(t)) out.add(t);
  }
  return [...out];
}

// 2つの型番集合の関係を返す： exact / conflict / unknown
//   exact    … 正規化後に完全一致するコードが存在
//   conflict … 一致は無いが「近縁（接頭辞が共通で末尾/中間だけ違う）」＝別バリアント
//   unknown  … 片方でも型番が無い、または無関係
export function modelRelation(supModels, amzModels) {
  const A = supModels.map((s) => s.toLowerCase());
  const B = amzModels.map((s) => s.toLowerCase());
  if (!A.length || !B.length) return "unknown";
  for (const a of A) for (const b of B) if (a === b) return "exact";
  // 近縁（変種）判定：一方が他方の接頭辞＋余分な英数字、または共通接頭辞4文字以上で分岐
  for (const a of A) {
    for (const b of B) {
      const lo = a.length <= b.length ? a : b;
      const hi = a.length <= b.length ? b : a;
      if (hi.startsWith(lo) && hi.length > lo.length) return "conflict"; // 例: spf040 ⊂ spf040u
      let p = 0;
      while (p < lo.length && lo[p] === hi[p]) p++;
      if (p >= 4 && p < lo.length) return "conflict"; // 例: sdsqunr128g vs sdsqunr256g
    }
  }
  return "unknown";
}

// 容量（GB/TB/MB）を GB換算の集合で返す
export function extractCapacities(text) {
  const set = new Set();
  for (const m of norm(text).matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/g)) {
    const n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) continue;
    const u = m[2];
    set.add(Math.round(u === "tb" ? n * 1000 : u === "mb" ? n / 1000 : n));
  }
  return [...set];
}

// 有線/無線
export function extractConnectivity(text) {
  const s = norm(text);
  const wireless = /(無線|ワイヤレス|wireless|bluetooth|ブルートゥース)/.test(s);
  const wired = /(有線|wired|usb\s*ケーブル|ケーブル接続)/.test(s);
  if (wireless && !wired) return "wireless";
  if (wired && !wireless) return "wired";
  return null; // 不明 or 両対応
}

// セット数（明示が無ければ 1 とみなす）
export function extractPackCount(text) {
  const s = norm(text);
  let m =
    s.match(/(\d+)\s*(個|枚|本|台|点|パック|pack|pcs|set)\s*(セット|組|入|入り|セット組)?/) ||
    s.match(/(\d+)\s*(セット|組)/) ||
    s.match(/[×x]\s*(\d+)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 999) return n;
  }
  return 1;
}

// 世代
export function extractGeneration(text) {
  const s = norm(text);
  let m =
    s.match(/第\s*(\d+)\s*世代/) ||
    s.match(/\bgen(?:eration)?\s*\.?\s*(\d+)\b/) ||
    s.match(/\bmk\s*\.?\s*(\d+)\b/) ||
    s.match(/\bv\s*(\d+)\b/);
  if (m) return parseInt(m[1], 10);
  return null;
}

// サイズ（S/M/L 系、または数値＋単位）
export function extractSize(text) {
  const s = norm(text);
  const m1 = s.match(/(?:サイズ|size)\s*[:：]?\s*(xxl|xl|x|s|m|l|ss)\b/);
  if (m1) return m1[1].toUpperCase();
  const m2 = s.match(/\b(\d+(?:\.\d+)?)\s*(inch|インチ|cm|mm)\b/);
  if (m2) return `${m2[1]}${m2[2]}`;
  return null;
}

// 対応機種（ゲーム機・端末）
export function extractDevices(text) {
  const s = norm(text);
  const set = new Set();
  const patterns = [
    ["ps5", /\bps\s*5\b|playstation\s*5|プレステ5|プレイステーション5/],
    ["ps4", /\bps\s*4\b|playstation\s*4|プレステ4|プレイステーション4/],
    ["switch", /nintendo\s*switch|ニンテンドースイッチ|スイッチ\b/],
    ["xbox", /xbox/],
    ["iphone15", /iphone\s*15/],
    ["iphone14", /iphone\s*14/],
    ["iphone13", /iphone\s*13/],
    ["ipad", /ipad|アイパッド/],
  ];
  for (const [k, re] of patterns) if (re.test(s)) set.add(k);
  return [...set];
}

// 色
const COLOR_WORDS = [
  ["black", /(ブラック|黒|black)/],
  ["white", /(ホワイト|白|white)/],
  ["red", /(レッド|赤|red)/],
  ["blue", /(ブルー|青|blue)/],
  ["green", /(グリーン|緑|green)/],
  ["yellow", /(イエロー|黄|yellow)/],
  ["pink", /(ピンク|pink)/],
  ["purple", /(パープル|紫|purple)/],
  ["gray", /(グレー|グレイ|gray|grey)/],
  ["silver", /(シルバー|銀|silver)/],
  ["gold", /(ゴールド|金|gold)/],
];
export function extractColors(text) {
  const s = norm(text);
  const set = new Set();
  for (const [k, re] of COLOR_WORDS) if (re.test(s)) set.add(k);
  return [...set];
}

// ブランド集合
function extractBrands(text) {
  const s = norm(text);
  const set = new Set();
  for (const [tok, canon] of BRAND_TOKEN) {
    if (s.includes(tok)) set.add(canon);
  }
  return set;
}

// 「その商品ならでは」の固有語（ブランド・一般語・スペックを除く）
function distinctiveTokens(text) {
  const s = norm(text);
  const tokens = new Set();
  for (const m of s.matchAll(/[a-z0-9]+/g)) {
    const t = m[0];
    if (/^\d+$/.test(t)) continue;
    if (t.length >= 2) tokens.add(t);
  }
  for (const m of s.matchAll(/[ァ-ヶー]{2,}/g)) tokens.add(m[0]);
  for (const m of s.matchAll(/[一-龠]{2,}/g)) tokens.add(m[0]);
  for (const w of STOPWORDS) tokens.delete(w);
  for (const t of [...tokens]) {
    if (BRAND_TOKEN.has(t)) tokens.delete(t);
    if (/^\d+(gb|tb|mb|g|t|w|v|a|mah|mm|cm|inch|型|枚|本|個|色)$/.test(t)) tokens.delete(t);
  }
  return tokens;
}

// テキストから全属性を抽出
export function extractAttributes(text) {
  return {
    models: extractModels(text),
    capacities: extractCapacities(text),
    connectivity: extractConnectivity(text),
    packCount: extractPackCount(text),
    generation: extractGeneration(text),
    size: extractSize(text),
    devices: extractDevices(text),
    colors: extractColors(text),
    brands: extractBrands(text),
    distinct: distinctiveTokens(text),
  };
}

function setsDisjoint(a, b) {
  for (const x of a) if (b.includes(x)) return false;
  return true;
}

// 2商品の属性を突き合わせ、HARD CONFLICT の一覧を返す。
// 「両方に値があって食い違う」場合のみ conflict（片方不明は conflict にしない）。
// ただし packCount は明示が無ければ 1 とみなして比較する。
export function detectConflicts(sup, amz) {
  const conflicts = [];

  // 型番
  const mrel = modelRelation(sup.models, amz.models);
  if (mrel === "conflict") conflicts.push("model");

  // 容量
  if (sup.capacities.length && amz.capacities.length) {
    if (setsDisjoint(sup.capacities, amz.capacities)) conflicts.push("capacity");
  }

  // 有線/無線
  if (sup.connectivity && amz.connectivity && sup.connectivity !== amz.connectivity) {
    conflicts.push("connectivity");
  }

  // セット数（明示が無い側は 1）
  if (sup.packCount !== amz.packCount) conflicts.push("packCount");

  // 世代
  if (sup.generation != null && amz.generation != null && sup.generation !== amz.generation) {
    conflicts.push("generation");
  }

  // サイズ
  if (sup.size && amz.size && sup.size !== amz.size) conflicts.push("size");

  // 対応機種（両方が機種を明示し、共通が1つも無い）
  if (sup.devices.length && amz.devices.length && setsDisjoint(sup.devices, amz.devices)) {
    conflicts.push("device");
  }

  // 色（両方が単色を明示し食い違う）
  if (sup.colors.length && amz.colors.length && setsDisjoint(sup.colors, amz.colors)) {
    conflicts.push("color");
  }

  return { conflicts, modelRelation: mrel };
}

function normJan(j) {
  return String(j || "").replace(/\D/g, "");
}

// メインの判定関数
// 入力: { supplierName, supplierJan, supplierModel?, amazonTitle, amazonJan?, amazonModel? }
// 出力: { status, matchType, score, conflicts, reason, autoEligible }
export function classifyMatch(input) {
  const supplierName = input.supplierName || "";
  const amazonTitle = input.amazonTitle || "";
  const supplierJan = normJan(input.supplierJan);
  const amazonJan = normJan(input.amazonJan);

  // 1. JAN完全一致（最優先・タイトルの解釈より確実）
  if (supplierJan && amazonJan && supplierJan === amazonJan) {
    return mk("JAN_VERIFIED", "jan", 100, [], "JAN完全一致");
  }
  // JANが両方あって食い違う → 別商品
  if (supplierJan && amazonJan && supplierJan !== amazonJan) {
    return mk("CONFLICT", "conflict", 0, ["jan"], "JAN不一致");
  }

  if (!amazonTitle) return mk("NO_MATCH", null, 0, [], "Amazon側の名前が取得できない");

  const supText = [supplierName, input.supplierModel].filter(Boolean).join(" ");
  const amzText = [amazonTitle, input.amazonModel].filter(Boolean).join(" ");
  const sup = extractAttributes(supText);
  const amz = extractAttributes(amzText);

  // HARD CONFLICT があれば即 reject
  const { conflicts, modelRelation: mrel } = detectConflicts(sup, amz);
  if (conflicts.length) {
    return mk("CONFLICT", "conflict", 0, conflicts, "HARD CONFLICT: " + conflicts.join(","));
  }

  // 2–3. 型番一致（完全 or 正規化完全）
  if (mrel === "exact") {
    return mk("MODEL_VERIFIED", "model", 90, [], "型番一致");
  }

  // 4. 属性一致：ブランド一致＋固有語1つ以上一致（かつ矛盾なし）
  let sharedBrand = false;
  for (const b of sup.brands) if (amz.brands.has(b)) sharedBrand = true;
  let sharedDistinct = 0;
  for (const t of sup.distinct) if (amz.distinct.has(t)) sharedDistinct++;
  if (sharedBrand && sharedDistinct >= 1) {
    return mk("ATTRIBUTE_VERIFIED", "attribute", 70, [], "ブランド＋固有語一致");
  }
  // 固有語が2つ以上一致してもブランド不明なら属性一致とみなす
  if (sharedDistinct >= 2) {
    return mk("ATTRIBUTE_VERIFIED", "attribute", 65, [], "固有語2つ以上一致");
  }

  // 5. 名前だけ一致（弱い）→ MANUAL_ONLY
  if (sharedDistinct >= 1 || sharedBrand) {
    return mk("NAME_UNVERIFIED", "name", 40, [], "名前のみ一致（要確認）");
  }

  return mk("NO_MATCH", null, 0, [], "一致なし");
}

function mk(status, matchType, score, conflicts, reason) {
  return {
    status,
    matchType,
    score,
    conflicts,
    reason,
    autoEligible: AUTO_ELIGIBLE_STATUSES.has(status),
  };
}
