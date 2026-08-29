import { getSetting, getKeepaCache, setKeepaCache } from "./db.js";
import { classifyMatch } from "./match.mjs";
import { analyzePrice } from "./price-risk.mjs";

async function getKey() {
  // 設定画面のキーを優先。無ければ環境変数(KEEPA_KEY)を使う。
  // 環境変数は再起動しても消えないので、無料プランでも入力し直し不要。
  const key = ((await getSetting("keepa_key")) || process.env.KEEPA_KEY || "").trim();
  if (!key) {
    throw new Error("Keepa APIキーが未設定です。設定画面でキーを登録してください。");
  }
  return key;
}

async function keepaFetch(url) {
  // Keepaはトークン不足時に応答を保留（長時間待機）することがある。
  // 1件で固まって全体が60秒で強制終了されるのを防ぐため、10秒で打ち切る。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") {
      throw new Error("Keepa照合がタイムアウトしました（10秒）。");
    }
    throw e;
  }
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(`Keepa APIエラー（HTTP ${res.status}）が発生しました。`);
  }
  return res.json();
}

// Keepaのproductオブジェクトから、価格・販売数・画像などを取り出す
function parseProduct(product) {
  if (!product) return null;

  const stats = product.stats || {};
  const current = stats.current || [];
  // Amazon.co.jp（domain=5）では、Keepaは価格を「円」でそのまま返す。
  const pos = (v) => (v != null && v > 0 ? Math.round(v) : null);

  // Keepaの価格種別: 0=Amazon本体, 1=新品最安, 2=中古最安。
  // 新品価格＝Amazon本体があればそれ、無ければ新品最安。
  // 中古価格＝中古最安(2)。仕入れ品のコンディションに合わせて使い分ける。
  const priceNew = pos(current[0]) != null ? pos(current[0]) : pos(current[1]);
  const priceUsed = pos(current[2]);

  // 従来互換の price（新品優先、無ければ中古）。個別のコンディション判定は呼び出し側で行う。
  const price = priceNew != null ? priceNew : priceUsed;
  if (price == null) return null;

  const monthlySales =
    stats.salesRankDrops30 != null ? stats.salesRankDrops30 : 0;

  // Keepaのstats.current[3]はAmazonの売れ筋ランキング（SALESランク）。
  // -1（不明）や0は「順位なし」としてnullにする。判定ルールで「ランキング◯位以内」を扱うために公開する。
  const salesRank = current[3] != null && current[3] > 0 ? current[3] : null;

  const asin = product.asin || null;

  let imageUrl = null;
  if (product.imagesCSV) {
    const file = String(product.imagesCSV).split(",")[0];
    if (file) {
      imageUrl = `https://images-na.ssl-images-amazon.com/images/I/${file}`;
    }
  }

  const productUrl = asin ? `https://www.amazon.co.jp/dp/${asin}` : null;

  // 90日相場・値崩れ判定（取得できる範囲で。欠損は null のまま＝でっち上げない）
  let priceRisk = null;
  let priceMetrics = null;
  try {
    const analyzed = analyzePrice(product);
    priceMetrics = analyzed.metrics;
    priceRisk = analyzed.risk;
  } catch {
    priceRisk = null;
  }

  return {
    asin,
    price,
    priceNew,
    priceUsed,
    monthlySales,
    salesRank,
    imageUrl,
    productUrl,
    title: product.title || "",
    // 相場指標（円建て・欠損はnull）と値崩れリスク（0-100・高いほど危険）
    avg30: priceMetrics ? priceMetrics.avg30New : null,
    avg90: priceMetrics ? priceMetrics.avg90New : null,
    newOfferCount: priceMetrics ? priceMetrics.newOfferCount : null,
    amazonPresent: priceMetrics ? priceMetrics.amazonPresent : null,
    priceRiskScore: priceRisk ? priceRisk.score : null,
    priceRiskLevel: priceRisk ? priceRisk.level : null,
    priceRiskUsable: priceRisk ? priceRisk.usable : null,
  };
}

// Keepa（domain=5 = Amazon.co.jp）でJAN（バーコード）から商品を照合する
export async function lookupByJan(jan) {
  const cacheKey = `jan:${jan}`;
  const cached = await getKeepaCache(cacheKey);
  if (cached !== undefined) return cached; // 前回の照合結果を再利用（null=見つからずも含む）

  const key = await getKey();
  const url = `https://api.keepa.com/product?key=${encodeURIComponent(
    key
  )}&domain=5&code=${encodeURIComponent(jan)}&stats=30&history=0`;
  const data = await keepaFetch(url);
  const product = data && data.products && data.products[0];
  const parsed = parseProduct(product);
  await setKeepaCache(cacheKey, parsed);
  return parsed;
}

// 文字列から容量（GB/TB/MBやSDカードの512等）を拾い、GB換算の集合で返す。
// 例: "512GB microSDXC" → {512}, "1TB SSD" → {1000}
function extractCapacities(s) {
  const set = new Set();
  const str = String(s || "");
  const re = /(\d+(?:\.\d+)?)\s*(TB|GB|MB)\b/gi;
  let m;
  while ((m = re.exec(str)) !== null) {
    const n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) continue;
    const unit = m[2].toUpperCase();
    let gb;
    if (unit === "TB") gb = n * 1000;
    else if (unit === "MB") gb = n / 1000;
    else gb = n;
    set.add(Math.round(gb));
  }
  return set;
}

// 仕入れ元の商品名とAmazon側タイトルで、容量が食い違っていないか検査する。
// 食い違い（別容量・セット違い）なら true を返す。
function capacityConflict(supplierName, amazonTitle) {
  const a = extractCapacities(supplierName); // 仕入れ元
  const b = extractCapacities(amazonTitle); // Amazon
  // Amazon側に容量表記が無ければ判定しない（Amazonのタイトルは容量を省くことが多いため）。
  if (b.size === 0) return false;
  // Amazonは容量を明記しているのに、仕入れ元に容量が全く無い場合は要注意。
  // 例: 楽天「SD変換アダプタ（単品）」↔ Amazon「microSD 2GB + アダプタのセット」。
  // 中身（付属カードの有無・容量）が違う別商品・セット違いの疑いが強いので弾く。
  if (a.size === 0) return true;
  // 両方に容量表記あり → 共通する容量が一つも無ければ不一致。
  // TB↔GBの丸め差(1TB=1000 or 1024)を吸収して比較する。
  for (const x of a) {
    for (const y of b) {
      const hi = Math.max(x, y);
      const lo = Math.min(x, y);
      if (hi - lo <= Math.max(24, hi * 0.03)) return false; // 近ければ一致とみなす
    }
  }
  return true;
}

// 照合の信頼性チェックで無視する“売り文句・一般語”。
// これらが一致してもマッチ根拠にはしない（別商品でも共通しやすいため）。
const MATCH_STOPWORDS = new Set([
  "送料無料", "送料", "無料", "特売", "爆買", "母の日", "父の日", "ポイント",
  "クーポン", "セール", "最安", "限定", "新品", "中古", "未使用", "正規品",
  "保証", "対応", "当日", "発送", "あす楽", "翌日", "店内", "ランキング",
  "人気", "おすすめ", "激安", "得価", "在庫", "即納", "国内", "海外", "純正",
  "公式", "割引", "値下げ", "税込", "税抜", "本体", "予約", "時間", "連続",
  "獲得", "日本", "販売", "高品質", "プレゼント", "ギフト", "最新", "大容量",
  "for", "the", "and", "with", "new", "set", "pro", "max", "plus", "mini",
  // ↓ カテゴリの一般語。これらが共通してもマッチ根拠にしない
  //   （同じカテゴリの“別商品”でも共通しやすく、誤マッチの原因になるため）。
  "switch", "スイッチ", "nintendo", "ニンテンドー", "コントローラー", "controller",
  "プロコン", "ゲーム", "game", "ジャイロ", "センサー", "連射", "ワイヤレス",
  "wireless", "有線", "無線", "usb", "ケーブル", "cable", "充電", "アダプター",
  "adapter", "バッテリー", "battery", "スマホ", "スマートフォン", "タブレット",
  "イヤホン", "ヘッドホン", "スピーカー", "マウス", "キーボード", "モニター",
  "ライト", "led", "カメラ", "ケース", "カバー", "スタンド", "ホルダー", "pc",
  // ↓ ジャンル名そのもの（同じジャンルの全商品で共通するため根拠にしない）。
  //   これらを根拠にすると「同ジャンルの別商品」を誤って掴む主因になる。
  "microsd", "microsdカード", "sdカード", "sdxc", "sdhc", "sdメモリーカード",
  "メモリーカード", "メモリカード", "メモリ", "カード", "usbメモリ",
  "ssd", "hdd", "ポータブル", "外付け", "内蔵", "ドライブ",
  "プリンター", "プリンタ", "インク", "インクカートリッジ", "トナー",
  "ドライヤー", "ヘアドライヤー", "モバイルバッテリー", "充電器", "急速充電",
  "フィギュア", "ぬいぐるみ", "アダプタ", "変換", "高速",
]);

// 商品名を「意味のある単語」の集合に分解する（英数字・カタカナ・漢字のまとまり）。
function significantTokens(s) {
  const str = String(s || "").toLowerCase();
  const tokens = new Set();
  // 英数字（純粋な数字だけは除く。型番のような英数字混在は残す）
  for (const m of str.matchAll(/[a-z0-9]+/g)) {
    const t = m[0];
    if (/^\d+$/.test(t)) continue;
    if (t.length >= 2) tokens.add(t);
  }
  // カタカナ2文字以上、漢字2文字以上
  for (const m of str.matchAll(/[ァ-ヶー]{2,}/g)) tokens.add(m[0]);
  for (const m of str.matchAll(/[一-龠]{2,}/g)) tokens.add(m[0]);
  for (const w of MATCH_STOPWORDS) tokens.delete(w);
  return tokens;
}

// 仕入れ元の商品名から「型番らしい英数字混在コード」を取り出す（例: SPF-040, SDSQUNR128G）。
function modelCodes(s) {
  const out = new Set();
  const str = String(s || "").toLowerCase().replace(/[-_.\s]/g, "");
  for (const m of str.matchAll(/[a-z0-9]+/g)) {
    const t = m[0];
    if (t.length >= 5 && /[a-z]/.test(t) && /\d/.test(t)) out.add(t);
  }
  return out;
}

// 主要ブランドの表記ゆれをまとめる（英語表記／カタカナ／漢字を同じ1つの概念として扱う）。
// 「ブランド名だけ一致」を「2単語一致」と誤って数えないようにするため。
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
];
const BRAND_TOKEN = new Map();
for (const g of BRAND_GROUPS) for (const t of g) BRAND_TOKEN.set(t, g[0]);

// 容量・数値スペックだけの一致は「その商品ならでは」の根拠にしない（別商品でも一致しがち）。
function isSpecToken(t) {
  return /^\d+(gb|tb|mb|g|t|w|v|a|mah|mm|cm|inch|型|枚|本|個|色)$/.test(t);
}

// 仕入れ元名とAmazonタイトルが「同じ商品と言える程度に一致しているか」を判定する。
// 名前だけの照合は“似た別商品”を拾いやすい。特に「ブランド名だけ一致」で通すと、
// 同じメーカーの別モデルを掴んでしまう（例: SanDisk Ultra ↔ SanDisk SDCZ530）。
// そこで「モデル名・型番・製品ライン名」など“その商品ならでは”の語の一致を必須にする。
// 一致の“強さ”を返す。
//   "model"  … 型番が一致（ほぼ確実に同一商品）
//   "double" … 商品固有語が2つ以上一致（信頼度：高）
//   "brand1" … ブランド＋固有語1つが一致（信頼度：中）
//   null     … 不十分（別商品の疑い）
function nameMatchLevel(supplierName, amazonTitle) {
  const title = String(amazonTitle || "");
  if (!title) return null; // Amazon側の名前が取れないものは信用しない

  // 型番が両方に含まれていれば「確実に一致」とみなす（最優先）。
  const codes = modelCodes(supplierName);
  const titleFlat = title.toLowerCase().replace(/[-_.\s]/g, "");
  for (const c of codes) {
    if (titleFlat.includes(c)) return "model";
  }

  const a = significantTokens(supplierName);
  const b = significantTokens(amazonTitle);

  // 共通する単語を「ブランド」「容量などのスペック」「その他（＝商品固有）」に仕分ける。
  const sharedBrands = new Set();
  let sharedDistinct = 0; // ブランドでもスペックでもない“固有語”の共通数
  for (const t of a) {
    if (!b.has(t)) continue;
    if (BRAND_TOKEN.has(t)) {
      sharedBrands.add(BRAND_TOKEN.get(t));
    } else if (isSpecToken(t)) {
      // 容量等は根拠にしない
    } else {
      sharedDistinct++;
    }
  }

  // 固有語が2つ以上一致 → 同一商品とみなす（信頼度：高）。
  if (sharedDistinct >= 2) return "double";
  // ブランドが一致し、かつ固有語も1つ以上一致 → 同一商品の可能性（信頼度：中）。
  if (sharedBrands.size >= 1 && sharedDistinct >= 1) return "brand1";
  // それ以外（ブランドだけ／容量だけ／共通がほぼ無い）は信用しない。
  return null;
}

function nameMatchConfident(supplierName, amazonTitle) {
  return nameMatchLevel(supplierName, amazonTitle) !== null;
}

// 仕入れ先ページの商品名から不要語を取り除き、検索精度を上げる
function cleanName(name) {
  return String(name || "")
    .replace(/[【\[(（].*?[】\])）]/g, " ") // 括弧内（状態・付属など）を除去
    .replace(/(中古|新品|美品|未使用|品切れ|送料無料|税込|限定|予約)/g, " ")
    .replace(/[!！?？★☆♪]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// バーコードが無い商品を、商品名でAmazon検索して照合する
export async function searchByName(name) {
  const term = cleanName(name);
  if (!term || term.length < 3) return null;

  const cacheKey = `name:${term.toLowerCase()}`;
  const cached = await getKeepaCache(cacheKey);
  if (cached !== undefined) return cached; // 前回の照合結果を再利用（null=見つからずも含む）

  const key = await getKey();
  const url = `https://api.keepa.com/search?key=${encodeURIComponent(
    key
  )}&domain=5&type=product&term=${encodeURIComponent(term)}&stats=30`;
  const data = await keepaFetch(url);

  // 検索はproducts配列、またはasinListで返る場合がある。
  const product = data && data.products && data.products[0];
  let asin = product && product.asin;
  if (!asin && data && Array.isArray(data.asinList) && data.asinList[0]) {
    asin = data.asinList[0];
  }

  // まず検索結果からそのまま価格・販売数を取り出す。
  // ここで価格が取れれば、2回目のKeepa呼び出し(/product)を省いてトークンを節約する。
  // （Keepaのトークン不足→応答保留→タイムアウト多発、を減らすのが狙い）
  let parsed = product ? parseProduct(product) : null;

  // 価格が取れなかったときだけ /product で取り直す（このときは画像も取得できる）。
  if ((!parsed || !parsed.price) && asin) {
    const purl = `https://api.keepa.com/product?key=${encodeURIComponent(
      key
    )}&domain=5&asin=${encodeURIComponent(asin)}&stats=30&history=0`;
    const pdata = await keepaFetch(purl);
    const full = pdata && pdata.products && pdata.products[0];
    if (full) parsed = parseProduct(full);
  }
  await setKeepaCache(cacheKey, parsed);
  return parsed;
}

// ASINからAmazonの商品画像URLだけを取り直す。
// 「利益商品として確定した数件だけ」に使うので、トークン消費は小さい。
// stats/historyは要らないので付けず、負荷を最小にする。
export async function fetchImageByAsin(asin) {
  if (!asin) return null;
  const cacheKey = `img:${asin}`;
  const cached = await getKeepaCache(cacheKey);
  if (cached !== undefined) return cached;

  const key = await getKey();
  const url = `https://api.keepa.com/product?key=${encodeURIComponent(
    key
  )}&domain=5&asin=${encodeURIComponent(asin)}&stats=0&history=0`;
  const data = await keepaFetch(url);
  const p = data && data.products && data.products[0];
  let img = null;
  if (p && p.imagesCSV) {
    const file = String(p.imagesCSV).split(",")[0];
    if (file) img = `https://images-na.ssl-images-amazon.com/images/I/${file}`;
  }
  await setKeepaCache(cacheKey, img);
  return img;
}

// 商品情報を取得する共通入口（JANがあればJAN優先、無ければ商品名で検索）
export async function lookupProduct(item) {
  if (item && item.jan) {
    const byJan = await lookupByJan(item.jan);
    if (byJan)
      return {
        ...byJan,
        matchedBy: "jan",
        matchStatus: "JAN_VERIFIED",
        matchScore: 100,
        matchConflicts: [],
      };
  }
  const byName = await searchByName(item && item.name);
  if (byName) {
    // ★新・照合エンジン（match.mjs）で同一性を判定する。
    //   HARD CONFLICT（型番末尾・有線/無線・容量・セット数・世代・サイズ・
    //   対応機種・色）が1つでもあれば、タイトルが似ていても即 reject。
    const cls = classifyMatch({
      supplierName: item && item.name,
      supplierJan: (item && item.jan) || null,
      amazonTitle: byName.title,
      amazonJan: null, // Keepa側JANは未取得（SP-API未接続のため）
    });
    if (cls.status === "CONFLICT" || cls.status === "NO_MATCH") {
      return null;
    }

    // 旧・容量チェックも保険として併用（二重の安全網）。
    if (capacityConflict(item && item.name, byName.title)) {
      return null;
    }

    // matchedBy は通知ゲート（jan/model のみ通知）に使う従来値へマップする。
    //   MODEL_VERIFIED → "model"（自動対象）
    //   ATTRIBUTE_VERIFIED / NAME_UNVERIFIED → "name"（保存はするが自動通知しない）
    const matchedBy = cls.status === "MODEL_VERIFIED" ? "model" : "name";

    // ★誤マッチ対策：型番未確認（名前だけ）で Amazon価格が仕入れ値の3倍超は、
    //   安い汎用品を高いブランド品と取り違えた疑いが濃い。“ありえない高利益”は出さない。
    if (matchedBy === "name") {
      const buy = Number(item && item.price) || 0;
      const amz = byName.priceNew != null ? byName.priceNew : byName.price;
      if (buy > 0 && amz != null && amz > buy * 3) {
        return null;
      }
    }
    return {
      ...byName,
      matchedBy,
      matchStatus: cls.status,
      matchScore: cls.score,
      matchConflicts: cls.conflicts,
    };
  }
  return null;
}

export async function estimateFees(amazonPrice, shipMethod) {
  const referralRate = parseFloat((await getSetting("referral_rate")) || "10") / 100;
  const fbaFee = parseInt((await getSetting("fba_fee")) || "450", 10);
  const selfShipFee = parseInt((await getSetting("self_ship_fee")) || "300", 10);

  const referral = Math.round(amazonPrice * referralRate);
  const shipFee = shipMethod === "FBA" ? fbaFee : selfShipFee;
  return referral + shipFee;
}

export async function judge(task, buyPrice, amazonPrice, monthlySales) {
  const includeFees = ((await getSetting("include_fees")) || "1") === "1";
  const fees = includeFees ? await estimateFees(amazonPrice, task.ship_method) : 0;

  const profit = amazonPrice - fees - buyPrice;
  const rate = amazonPrice > 0 ? (profit / amazonPrice) * 100 : 0;
  const rateRounded = Math.round(rate * 10) / 10;

  const rateOk = rate >= task.rate_min && rate <= task.rate_max;
  const amountOk = profit >= task.amount_min;

  let condOk;
  switch (task.cond_pattern) {
    case "RATE":
      condOk = rateOk;
      break;
    case "AMOUNT":
      condOk = amountOk;
      break;
    case "AND":
      condOk = rateOk && amountOk;
      break;
    case "OR":
      condOk = rateOk || amountOk;
      break;
    default:
      condOk = rateOk;
  }

  const salesOk = monthlySales >= (task.monthly_sales_min || 0);
  const ok = condOk && salesOk && profit > 0;

  return { ok, profit, rate: rateRounded, fees };
}
