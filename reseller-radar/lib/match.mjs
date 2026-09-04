// ─────────────────────────────────────────────────────────────
// 商品同一性判定エンジン（純粋関数・DB/通信に一切依存しない）
//
// 目的：「似た別商品」を同一商品と誤判定する事故を極力ゼロにする。
// 方針：タイトル類似度が高くても、HARD CONFLICT（型番末尾・有線/無線・容量・
//       セット数・世代・サイズ・対応機種・エディション・色）が1つでもあれば
//       スコアに関係なく即 reject（CONFLICT）する。Precision（誤仕入れ防止）最優先。
//
// 照合優先順位：
//   1. JAN完全一致            → JAN_VERIFIED（識別子で実照合できた時だけ）
//   2. 型番完全一致            → MODEL_VERIFIED
//   3. 型番一致だが数量不明    → MODEL_UNVERIFIED（自動対象外・要手動確認）
//   4. 属性一致(ブランド＋固有) → ATTRIBUTE_REVIEW（弱い一致・自動対象外）
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
  "productType", // 商品種別（マウス↔キーボード等）。第6フェーズで追加。
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

// スペック表記（容量・電圧・速度クラス・USB規格・解像度など）は「型番」ではない。
// これらを型番候補に混ぜると、256GB 同士・USB3.2 同士などで誤って「型番一致
// （MODEL_VERIFIED・自動対象）」が成立してしまう。完全一致するものは型番から除外する。
function isSpecCode(t) {
  return (
    /^\d+(gb|tb|mb|kb)$/.test(t) ||            // 記憶容量 256GB / 1TB
    /^\d+(ml|l|cc|oz)$/.test(t) ||             // 内容量 500ML
    /^\d+(mg|g|kg)$/.test(t) ||                // 重量
    /^\d+(w|kw|wh|mah|mwh)$/.test(t) ||        // 電力・電池容量 10000mAh / 65W
    /^\d+(v|kv)$/.test(t) ||                   // 電圧
    /^\d+(a|ma)$/.test(t) ||                   // 電流
    /^\d+(mm|cm|m|inch)$/.test(t) ||           // 長さ・画面サイズ
    /^\d+(hz|khz|mhz|ghz)$/.test(t) ||         // 周波数
    /^\d+(p|k|fps|dpi|ppi|nit|nits)$/.test(t) ||// 解像度・映像スペック 1080p / 4K
    /^\d+x\d+$/.test(t) ||                     // 解像度 1920x1080
    /^usb[abc]$/.test(t) ||                    // USB Type A/B/C
    /^type[abc]$/.test(t) ||                   // Type-A/B/C
    /^[uvac]\d{1,2}$/.test(t) ||               // 速度クラス V30/V60/V90, U3, A2, C10（A1234 等の実型番は除外しない）
    /^class\d+$/.test(t)                       // Class10
  );
}

// 「数値＋単位」で始まる語（例: 256GB-Extreme → 256gbextreme）は、容量などの
// スペックが区切りで別語と連結したものの可能性が高く、型番とはみなさない。
function startsWithSpec(t) {
  return /^\d+(gb|tb|mb|kb|ml|l|cc|oz|mg|g|kg|w|kw|wh|mah|v|kv|a|ma|mm|cm|hz|khz|mhz|ghz|p|k)/.test(t);
}

// スペック・規格・対応OS/機種・速度などが単語連結されてできたノイズ語は型番ではない。
// （例: USB3.1 Gen1→usb31gen1、R:190MB/s→r190mbs、PlayStation5 Windows→playstation5windows）
// これらを MODEL_VERIFIED の根拠にすると、共通スペックが exact 一致して本物の型番違いを
// 隠す事故になる。純関数で機械的に落とす。
function isModelNoise(t) {
  if (/^usb\d/.test(t)) return true;                       // usb31gen1 / usb32 / usb20…
  if (/(playstation|windows|android|macos|iphone|ipad|xbox|nintendo)\d*/.test(t)) return true; // 対応OS/機種の連結
  if (/^[rw]?\d+(mb|gb|kb)s$/.test(t)) return true;        // 読み書き速度 r190mbs / w130mbs / 190mbs
  if (/^\d+(mb|gb|kb)ps$/.test(t)) return true;            // 100mbps 等
  if (/^gen\d$/.test(t)) return true;                      // gen1 / gen2
  return false;
}

// 型番候補の信頼度を推定する。
//   high   … 呼び出し元から「明示された型番/品番欄」として渡された値（構造化データ相当）
//   medium … タイトル中の“型番らしい形”（区切り付きコード SPF-040U / SDSQXAV-256G、
//            もしくは英字始まり英数字コード IC4CL62 など）
//   low    … 単なる英数字混在語（一般語の連結の可能性）。MODEL_VERIFIED の根拠にしない。
function shapeConfidence(rawWordLower, cleaned) {
  // 内部に区切り（- _ . /）を挟む英数字コードは型番らしい（medium）
  if (/[a-z0-9][\-_.\/][a-z0-9]/.test(rawWordLower)) return "medium";
  // 英字2文字以上で始まり数字を含む圧縮品番（IC4CL62 / EJ0250G 等）も medium
  if (/^[a-z]{2,}\d/.test(cleaned) || /\d[a-z]{2,}\d/.test(cleaned)) return "medium";
  return "low";
}

// 型番候補を { value, confidence } の配列で返す。
// confidenceBase を渡すと（"high" など）その値で固定（明示型番欄からの抽出用）。
// 渡さなければタイトル由来として medium/low を推定する。
export function extractModelCandidates(text, confidenceBase) {
  const out = [];
  const seen = new Set();
  // 全角読点・カンマ・縦棒などは語境界として扱う（PlayStation5、Windows の連結を防ぐ）。
  for (const rawWord of String(text || "").toLowerCase().split(/[\s　、，,｜|]+/)) {
    const t = rawWord.replace(/[^a-z0-9]/g, ""); // 区切り・記号を除去
    if (t.length < 5) continue; // 短いコードは型番にしない
    if (!/[a-z]/.test(t) || !/\d/.test(t)) continue; // 英字と数字の混在必須
    if (isSpecCode(t)) continue; // 純粋なスペック表記は除外（256gb / usb32 等）
    if (startsWithSpec(t)) continue; // 数値＋単位始まり（スペック連結）は除外
    if (isModelNoise(t)) continue; // 規格/OS/機種/速度の連結ノイズを除外
    if (seen.has(t)) continue;
    seen.add(t);
    const confidence = confidenceBase || shapeConfidence(rawWord, t);
    out.push({ value: t, confidence });
  }
  return out;
}

// 後方互換：型番文字列の配列だけを返す（値のみ）。
export function extractModels(text) {
  return extractModelCandidates(text, null).map((c) => c.value);
}

// 同一 value の候補をまとめ、信頼度の高い方を残す。
const CONF_RANK = { high: 3, medium: 2, low: 1 };
function mergeCandidates(list) {
  const best = new Map();
  for (const c of list) {
    const prev = best.get(c.value);
    if (!prev || CONF_RANK[c.confidence] > CONF_RANK[prev.confidence]) {
      best.set(c.value, c);
    }
  }
  return [...best.values()];
}

// 2つの型番コードの関係： exact / conflict / unknown
function pairModelRelation(a, b) {
  if (a === b) return "exact";
  const lo = a.length <= b.length ? a : b;
  const hi = a.length <= b.length ? b : a;
  if (hi.startsWith(lo) && hi.length > lo.length) return "conflict"; // 例: spf040 ⊂ spf040u
  let p = 0;
  while (p < lo.length && lo[p] === hi[p]) p++;
  if (p >= 4 && p < lo.length) return "conflict"; // 例: sdsqunr128g vs sdsqunr256g
  return "unknown";
}

// 2つの型番集合の関係を返す： exact / conflict / unknown
//   exact    … 正規化後に完全一致するコードが存在
//   conflict … 近縁（接頭辞が共通で末尾/中間だけ違う）＝別バリアントが存在
//   unknown  … 片方でも型番が無い、または無関係
// ★P0-1: 「1個でも exact があれば exact」を禁止。強い conflict が1つでも存在すれば
//   exact より conflict を優先する（共通ノイズの一致が本物の型番違いを隠すのを防ぐ）。
export function modelRelation(supModels, amzModels) {
  const A = supModels.map((s) => s.toLowerCase());
  const B = amzModels.map((s) => s.toLowerCase());
  if (!A.length || !B.length) return "unknown";
  let hasExact = false;
  for (const a of A) {
    for (const b of B) {
      const rel = pairModelRelation(a, b);
      if (rel === "conflict") return "conflict"; // conflict 最優先
      if (rel === "exact") hasExact = true;
    }
  }
  return hasExact ? "exact" : "unknown";
}

// 型番候補（{value, confidence}）同士の関係＋一致時の信頼度を返す。
//   { relation: exact|conflict|unknown, confidence: high|medium|low|null }
// confidence は exact 成立時のみ設定（一致した2つの候補の低い方＝より慎重な側）。
export function classifyModelRelation(supCands, amzCands) {
  if (!supCands.length || !amzCands.length) return { relation: "unknown", confidence: null };
  let exactConf = null; // 最も信頼できる exact ペアの信頼度
  for (const a of supCands) {
    for (const b of amzCands) {
      const rel = pairModelRelation(a.value, b.value);
      if (rel === "conflict") return { relation: "conflict", confidence: null };
      if (rel === "exact") {
        const pairConf = CONF_RANK[a.confidence] <= CONF_RANK[b.confidence] ? a.confidence : b.confidence;
        if (!exactConf || CONF_RANK[pairConf] > CONF_RANK[exactConf]) exactConf = pairConf;
      }
    }
  }
  if (exactConf) return { relation: "exact", confidence: exactConf };
  return { relation: "unknown", confidence: null };
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

// セット数。明示が無ければ null（＝不明。1個と決めつけない）。
// unknown を 1 と扱うと「一覧タイトルに数量が出ていない実はセット品」を
// 単品と誤判定するため、unknown と 1 は必ず区別する（誤除外・誤一致の両方を防ぐ）。
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
  return null;
}

// 世代（文脈のある表記だけを世代とみなす）。
// ※ "V30" 等は SDカードの動画速度クラス（V30/V60/V90）であり世代ではないので扱わない。
export function extractGeneration(text) {
  const s = norm(text);
  let m =
    s.match(/第\s*(\d+)\s*世代/) ||
    s.match(/\bgen(?:eration)?\s*\.?\s*(\d+)\b/) ||
    s.match(/\bmk\s*\.?\s*(\d+)\b/);
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

// エディション（版）。通常版/限定版/デラックス版などの別商品を弾くために抽出する。
// ※ HARD_CONFLICT_ATTRS に "edition" があるのに実装が無かった不整合を解消（P1-2）。
const EDITION_WORDS = [
  ["deluxe", /(deluxe|デラックス|dx\s*版|dx\s*edition)/],
  ["limited", /(limited\s*edition|限定版|リミテッド)/],
  ["collector", /(collector'?s?\s*edition|コレクター(?:ズ)?(?:\s*エディション|版)?)/],
  ["digital", /(digital\s*edition|ダウンロード版|dl\s*版|デジタル版)/],
  ["firstpress", /(初回限定|初回生産限定|初回版)/],
  ["standard", /(standard\s*edition|通常版|スタンダード版|標準版)/],
];
export function extractEdition(text) {
  const s = norm(text);
  const set = new Set();
  for (const [k, re] of EDITION_WORDS) if (re.test(s)) set.add(k);
  return [...set];
}

// ─────────────────────────────────────────────────────────────
// 第6フェーズ ③ 商品種別（product type）分類
// 「マウス↔キーボード」「インク↔プリンター本体」等、明らかに別カテゴリの商品を
// 同一と誤判定しないための最小限の種別判定。両側で高信頼に取れて食い違えば HARD CONFLICT。
// 片側で種別が取れない場合は推測しない（＝conflict にしない）。
// 一般化された分類なので特定商品名のブラックリストではない。
// ─────────────────────────────────────────────────────────────
const PRODUCT_TYPE_PATTERNS = [
  ["mouse", /(マウス|\bmouse\b)/],
  ["keyboard", /(キーボード|\bkeyboard\b)/],
  ["controller", /(コントローラー|プロコン|ゲームパッド|\bcontroller\b|\bgamepad\b)/],
  ["headphone", /(ヘッドホン|ヘッドフォン|\bheadphones?\b)/],
  ["earphone", /(イヤホン|イヤフォン|\bearphones?\b|\bearbuds?\b)/],
  ["ssd", /(\bssd\b|ソリッドステート)/],
  ["memory_card", /(microsd|micro sd|sdカード|sdxc|sdhc|メモリーカード|メモリカード|cfexpress|コンパクトフラッシュ)/],
  ["ink", /(インク|インクカートリッジ|\bink\b|トナー|\btoner\b)/],
  ["printer", /(プリンター|プリンタ|複合機|\bprinter\b)/],
  ["charger", /(充電器|急速充電|\bcharger\b|acアダプター|acアダプタ)/],
  ["cable", /(ケーブル|\bcable\b)/],
  ["hub", /(usbハブ|\bhub\b|ハブ)/],
  ["camera", /(カメラ|webカメラ|\bcamera\b|\bwebcam\b)/],
  ["book", /(書籍|文庫|単行本|コミック|\bbook\b)/],
  ["cd", /(音楽cd|\bcd\b)/],
  ["dvd", /(dvd|blu-?ray|ブルーレイ)/],
  ["drink", /(飲料|ドリンク|コーヒー|お茶|清涼飲料)/],
  ["toy", /(おもちゃ|玩具|\blego\b|レゴ|フィギュア|ぬいぐるみ)/],
  ["battery", /(乾電池|充電池|エネループ|\beneloop\b|ニッケル水素|アルカリ電池|モバイルバッテリー)/],
];
// 「hub」は「ケーブル」より先に確定させる（USBハブをcableと誤らないため）等、
// 実装は全パターンをスキャンして集合で返す（複数一致もあり得る）。
export function extractProductType(text) {
  const s = norm(text);
  const set = new Set();
  for (const [k, re] of PRODUCT_TYPE_PATTERNS) if (re.test(s)) set.add(k);
  // usbハブは hub、usbケーブルは cable。両方の語が無い限り誤混入しない。
  return set;
}

// ─────────────────────────────────────────────────────────────
// 第6フェーズ ② 型番の“数字だけ違う”別モデル検知（M550↔M650, G304↔G703 等）
// 既存の型番一致(extractModelCandidates)は5文字以上＋接頭辞共通を要求するため、
// "M550" のような短い型番コアの「数字だけ違う」差を conflict に落とせなかった。
// ここでは「英字接頭辞が同じで数値部が違う」＝別モデルの明白な矛盾だけを拾う。
// 完全一致するコアが1つでもあれば conflict にしない（安全側）。一般ルール。
// ─────────────────────────────────────────────────────────────
export function extractModelCores(text) {
  const out = new Set();
  for (const raw of String(text || "").toLowerCase().split(/[\s　、，,｜|＋+]+/)) {
    const t = raw.replace(/[^a-z0-9]/g, "");
    if (t.length < 3 || t.length > 12) continue;
    if (!/^[a-z]{1,4}\d{2,}[a-z0-9]*$/.test(t)) continue; // 英字接頭辞＋2桁以上の数値
    if (isSpecCode(t) || isModelNoise(t) || startsWithSpec(t)) continue;
    out.add(t);
  }
  return [...out];
}
function splitCore(c) {
  const m = c.match(/^([a-z]+)(\d+)(.*)$/);
  return m ? { p: m[1], n: m[2], s: m[3] } : null;
}
export function modelCoreConflict(supCores, amzCores) {
  if (!supCores.length || !amzCores.length) return false;
  for (const a of supCores) if (amzCores.includes(a)) return false; // 完全一致コアあり→矛盾にしない
  for (const a of supCores) {
    const pa = splitCore(a);
    if (!pa) continue;
    for (const b of amzCores) {
      const pb = splitCore(b);
      if (!pb) continue;
      // 英字接頭辞が同じで数値部が違う＝別モデル（例: m550 vs m650, g304 vs g703）
      if (pa.p === pb.p && pa.n !== pb.n) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// 第6フェーズ ④ まとめ出品（多variant）検知
// 「16GB/32GB/…/1TB を1ページで選ぶ」「サイズ/色をお選びください」等、
// 表示価格と対象variantが一意に結び付かない出品を識別する。
// 該当すれば表示価格が信用できない＝自動仕入れ禁止（VARIANT_PRICE_UNVERIFIED）。
// 一般化した検知（特定商品名に依存しない）。誤検知で recall を過度に落とさないよう
// 「複数の容量値」または「選択を促す文言＋複数バリエーション語」を条件にする。
// ─────────────────────────────────────────────────────────────
const VARIANT_SELECT_WORDS = /(お選び|選択|選べる|バリエーション|種類から|タイプから|カラーを?選|サイズを?選|容量を?選|全\d+種|\d+種類|より選択)/;
export function detectVariantListing(text) {
  const s = norm(text);
  const caps = extractCapacities(text);
  // 容量が3種類以上列挙されている＝容量選択のまとめ出品
  if (caps.length >= 3) return true;
  // 選択を促す文言があり、かつ容量が2種類以上 or サイズ複数
  if (VARIANT_SELECT_WORDS.test(s) && caps.length >= 2) return true;
  // 「16GB/32GB/64GB」のようなスラッシュ区切りの容量列挙
  if (/\d+\s*(gb|tb)\s*[\/／・]\s*\d+\s*(gb|tb)\s*[\/／・]\s*\d+\s*(gb|tb)/.test(s)) return true;
  return false;
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
    edition: extractEdition(text),
    productType: extractProductType(text), // ③ 商品種別
    modelCores: extractModelCores(text),   // ② 数字違い型番コア
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
// packCount は明示が無ければ null（不明）として扱い、1 とは決めつけない。
export function detectConflicts(sup, amz) {
  const conflicts = [];
  const ambiguities = []; // HARD CONFLICT ではないが自動対象にしてはいけない曖昧さ

  // 型番
  const mrel = modelRelation(sup.models, amz.models);
  if (mrel === "conflict") conflicts.push("model");

  // ② 型番コアの「数字だけ違う」別モデル（M550↔M650 等）。
  //   既存の modelRelation で拾えない短い型番差を補完する。
  if (!conflicts.includes("model") &&
      modelCoreConflict(sup.modelCores || [], amz.modelCores || [])) {
    conflicts.push("model");
  }

  // ③ 商品種別（両側で高信頼に取れて食い違う＝別カテゴリ商品）。
  //   片側で取れない場合は推測しない（conflict にしない）。
  if (sup.productType && amz.productType && sup.productType.size && amz.productType.size &&
      setsDisjoint([...sup.productType], [...amz.productType])) {
    conflicts.push("productType");
  }

  // 容量
  if (sup.capacities.length && amz.capacities.length) {
    if (setsDisjoint(sup.capacities, amz.capacities)) conflicts.push("capacity");
  }

  // 有線/無線
  if (sup.connectivity && amz.connectivity && sup.connectivity !== amz.connectivity) {
    conflicts.push("connectivity");
  }

  // セット数：
  //   両方が明示 → 数が違えば CONFLICT（例: 1個 vs 2個セット）
  //   片方だけ明示で、その数が2以上 → 単品/セットの取り違え疑い＝曖昧（自動対象外）
  //   両方 unknown、または既知側が1 → 問題なし
  const sp = sup.packCount;
  const ap = amz.packCount;
  if (sp != null && ap != null) {
    if (sp !== ap) conflicts.push("packCount");
  } else if (sp != null || ap != null) {
    const known = sp != null ? sp : ap;
    if (known >= 2) ambiguities.push("packCount");
  }

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

  // エディション（両方が版を明示し、共通が1つも無い＝別商品）
  if (sup.edition && amz.edition && sup.edition.length && amz.edition.length &&
      setsDisjoint(sup.edition, amz.edition)) {
    conflicts.push("edition");
  }

  return { conflicts, ambiguities, modelRelation: mrel };
}

function normJan(j) {
  return String(j || "").replace(/\D/g, "");
}

// 仕入れ元のJANが、Amazon候補側の識別子一覧（Keepaの eanList / upcList 等）に
// 実際に含まれているかを確認する。含まれていれば true（本当のJAN一致）。
// ここが true のときだけ JAN_VERIFIED を名乗ってよい（検索でヒットしただけでは不可）。
export function janMatchesCode(supplierJan, codes) {
  const s = normJan(supplierJan);
  if (!s) return false;
  if (!Array.isArray(codes) || codes.length === 0) return false;
  for (const c of codes) {
    if (normJan(c) === s) return true;
  }
  return false;
}

// JAN照合の3値判定（P1-3）。「識別子が取れなかった」と「識別子は取れたが別物」を区別する。
//   "verified" … 候補側の識別子一覧に仕入れJANが含まれる（本当のJAN一致）
//   "conflict" … 識別子は取得できたが仕入れJANが含まれない＝別商品の強い証拠（reject推奨）
//   "unknown"  … 識別子が空/未取得、または仕入れJANが無い（断定不可・自動対象外）
export function janVerdict(supplierJan, codes) {
  const s = normJan(supplierJan);
  if (!s) return "unknown";
  if (!Array.isArray(codes) || codes.length === 0) return "unknown";
  for (const c of codes) {
    if (normJan(c) === s) return "verified";
  }
  return "conflict";
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

  // 型番候補（信頼度つき）。明示された型番/品番欄=high、タイトル由来=medium/low。
  // MODEL_VERIFIED（自動対象）は high、または「medium かつ数量まで一致」に限定する。
  const supCands = mergeCandidates([
    ...(input.supplierModel ? extractModelCandidates(input.supplierModel, "high") : []),
    ...extractModelCandidates(supplierName, null),
  ]);
  const amzCands = mergeCandidates([
    ...(input.amazonModel ? extractModelCandidates(input.amazonModel, "high") : []),
    ...extractModelCandidates(amazonTitle, null),
  ]);

  // HARD CONFLICT があれば即 reject
  const { conflicts, ambiguities } = detectConflicts(sup, amz);
  if (conflicts.length) {
    return mk("CONFLICT", "conflict", 0, conflicts, "HARD CONFLICT: " + conflicts.join(","));
  }

  // ④ まとめ出品（多variant）は表示価格が対象と一意に結び付かない＝自動対象外。
  //   型番が一致していても、価格の裏付けが取れないので自動仕入れに載せない。
  const variantTrap = detectVariantListing(supplierName);

  // 2–3. 型番一致（信頼度・数量で MODEL_VERIFIED / MODEL_UNVERIFIED を分ける）
  const mr = classifyModelRelation(supCands, amzCands);
  if (mr.relation === "exact") {
    if (variantTrap) {
      return mk("VARIANT_PRICE_UNVERIFIED", "model", 55, [],
        "まとめ出品で表示価格が対象variantと一意に結び付かない（自動対象外）");
    }
    // 型番は一致するがセット数が不明（単品/セットの取り違え疑い）は自動対象にしない。
    if (ambiguities.length) {
      return mk("MODEL_UNVERIFIED", "model", 55, [], "型番一致だが数量不明（要手動確認）");
    }
    const qtyBothKnownEqual =
      sup.packCount != null && amz.packCount != null && sup.packCount === amz.packCount;
    if (mr.confidence === "high") {
      // 明示された型番/品番欄同士の完全一致＝高信頼。数量不明でも自動対象にしてよい。
      return mk("MODEL_VERIFIED", "model", 90, [], "型番一致（高信頼・明示品番）");
    }
    if (mr.confidence === "medium" && qtyBothKnownEqual) {
      // タイトル由来だが型番らしい形＋数量まで一致＝十分に安全。
      return mk("MODEL_VERIFIED", "model", 85, [], "型番一致（数量も一致）");
    }
    // medium かつ数量不明 / low 由来 → 自動対象にせず手動確認へ。
    return mk("MODEL_UNVERIFIED", "model", 55, [], "型番一致だが確度不足（タイトル由来・要手動確認）");
  }

  // 4. 属性一致（弱い一致・自動対象外）：ブランド一致＋固有語1つ以上一致（かつ矛盾なし）
  let sharedBrand = false;
  for (const b of sup.brands) if (amz.brands.has(b)) sharedBrand = true;
  let sharedDistinct = 0;
  for (const t of sup.distinct) if (amz.distinct.has(t)) sharedDistinct++;
  if (sharedBrand && sharedDistinct >= 1) {
    return mk("ATTRIBUTE_REVIEW", "attribute", 70, [], "ブランド＋固有語一致（要確認）");
  }
  // 固有語が2つ以上一致してもブランド不明なら属性一致（弱い）とみなす
  if (sharedDistinct >= 2) {
    return mk("ATTRIBUTE_REVIEW", "attribute", 65, [], "固有語2つ以上一致（要確認）");
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

// ─────────────────────────────────────────────────────────────
// JAN一致と「どのASINへ出すか」の分離（第4フェーズKeepa実測の発見に対応）
//
// ★実測で判明した事実：同一JANが複数ASINに存在し得る（重複・新旧パッケージ）。
//   例）JAN 4988617060852 で code 検索 → 意図とは別ASIN(B01JHVXJFU)が返ったが
//       そのASINにも同じJANが含まれ、照合自体は verified になった。
//   つまり「JAN一致＝商品同一性は強い」が「JAN一致＝出品すべきASINが一意」ではない。
//
// そこで2つの確からしさを分離する：
//   productIdentityVerified … 仕入れJANが候補側の識別子(eanList/upcList)に含まれる
//   asinSelectionVerified   … 返ってきたASINが「その商品」だと属性でも裏付けられる
//
// 判定：
//   識別子不一致(conflict)               → JAN_CONFLICT（reject・自動対象外）
//   識別子未取得(unknown)                → JAN_LOOKUP_UNVERIFIED（自動対象外）
//   JAN一致だが属性が矛盾(HARD CONFLICT) → JAN_CONFLICT（別ASINを掴んだ疑い・reject）
//   JAN一致だがタイトルが全く無関係       → JAN_VERIFIED_ASIN_REVIEW（自動対象外・要確認）
//   JAN一致＋タイトルが同一性を裏付け     → JAN_VERIFIED（自動対象）
// ─────────────────────────────────────────────────────────────
export function classifyJanMatch(input) {
  const supplierJan = normJan(input.supplierJan);
  const candidateCodes = input.candidateCodes || [];
  const verdict = janVerdict(supplierJan, candidateCodes);
  // ① JANの出所・信頼度（high/medium/low）。純粋関数の後方互換のため未指定は "high"。
  //   本番の呼び出し元（amazon.js）は既定を "low" にして、明示的に高信頼のJANだけを自動対象にする。
  const janConfidence = input.janConfidence || "high";

  if (verdict === "conflict") {
    return mkJan("JAN_CONFLICT", false, false,
      "候補側の識別子は取得できたが仕入れJANと不一致（別商品）");
  }
  if (verdict === "unknown") {
    return mkJan("JAN_LOOKUP_UNVERIFIED", false, false,
      "候補側の識別子が未取得＝JANの実照合ができない（自動対象外）");
  }

  // verified：商品同一性は確認できた。次に「どのASINか」を属性で再検証する（② SECOND GATE）。
  // 同一JAN複数ASINで別ASINを掴んでいないか、型番/種別/容量/色などで裏取りする。
  const cls = classifyMatch({
    supplierName: input.supplierName || "",
    supplierJan: null, // JAN一致は確定済み。ここでは属性のみで再検証する。
    supplierModel: input.supplierModel || null,
    amazonTitle: input.candidateTitle || "",
    amazonJan: null,
    amazonModel: input.candidateModel || null,
  });

  if (cls.status === "CONFLICT") {
    // JANは一致するのに型番末尾・商品種別・容量・色などが食い違う＝別ASINを掴んだ強い証拠。
    return mkJan("JAN_CONFLICT", true, false,
      "JAN一致だが属性が矛盾（同一JANで別ASINを掴んだ疑い・reject）: " + (cls.conflicts || []).join(","));
  }
  // ④ まとめ出品で表示価格が一意に決まらない → 自動対象外。
  if (cls.status === "VARIANT_PRICE_UNVERIFIED") {
    return mkJan("VARIANT_PRICE_UNVERIFIED", true, false,
      "JAN一致だがまとめ出品で表示価格の裏付けが取れない（自動対象外）");
  }
  if (cls.status === "NO_MATCH") {
    // JANは一致するがタイトルが仕入れ元名と全く関連しない＝ASIN選択の裏付け不足。
    return mkJan("JAN_VERIFIED_ASIN_REVIEW", true, false,
      "JAN一致だがタイトルが無関係＝ASIN選択の裏付け不足（要手動確認）");
  }
  // ① 低/中信頼のJAN（本文regex・最初の13桁・関連商品由来など）は JAN_VERIFIED の
  //   根拠にしない＝自動対象外。HIGH（構造化データ/明示JANコード欄/公式）だけを自動確定に使う。
  if (janConfidence !== "high") {
    return mkJan("JAN_SOURCE_UNVERIFIED", false, false,
      `JANの出所が低信頼（${janConfidence}）＝自動対象にしない（要手動確認）`);
  }
  // タイトルが型番/属性/名前で同一性を裏付け → ASIN選択も妥当とみなす。
  return mkJan("JAN_VERIFIED", true, true, "JAN一致＋タイトル整合");
}

function mkJan(status, productIdentityVerified, asinSelectionVerified, reason) {
  return {
    status,
    productIdentityVerified,
    asinSelectionVerified,
    autoEligible: AUTO_ELIGIBLE_STATUSES.has(status),
    reason,
  };
}

// ── ありえない高利益＝誤マッチ検知（Precision最優先の最終ゲート）──────────────
// 安い汎用品を高いブランド品/別エディションと取り違えると、売価が仕入値の何倍にもなる。
// JANで同一性が確証できていない照合（名前/型番のみ）で売価が仕入値の上限倍率を超えたら、
//   ・name（名前のみ）  → reject（候補から除外＝そもそも出さない）
//   ・model（型番一致）  → downgrade（結果一覧には残すが自動通知/自動仕入れ対象から外す）
// にする。JAN一致は同一性の裏付けが強いので比率では弾かない（正規の高額商品を守る）。
// ※閾値は「同一商品でここまで価格差が出るのは異常」という経験則。定数として明示し、
//   テストで固定する（黙ってマジックナンバーをコードに埋めない）。
export const SUSPICIOUS_RATIO = { name: 3, model: 8 };

export function priceRatioSanity({ buyPrice, salePrice, verified }) {
  const buy = Number(buyPrice) || 0;
  const sale = Number(salePrice) || 0;
  if (buy <= 0 || sale <= 0) return { ok: true, ratio: null, action: "keep" };
  const ratio = sale / buy;
  if (verified === "jan") return { ok: true, ratio, action: "keep" };
  const cap = verified === "model" ? SUSPICIOUS_RATIO.model : SUSPICIOUS_RATIO.name;
  if (ratio > cap) {
    return { ok: false, ratio, action: verified === "model" ? "downgrade" : "reject" };
  }
  return { ok: true, ratio, action: "keep" };
}
