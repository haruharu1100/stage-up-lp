import { getSetting, getKeepaCache, setKeepaCache } from "./db.js";
import { classifyMatch, classifyJanMatch, priceRatioSanity } from "./match.mjs";
import { analyzePrice, computeConservativeSalePrice } from "./price-risk.mjs";
import { calculateProfit, keepaFeesFrom } from "./profit.mjs";

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

  // ★Keepa価格種別（第4フェーズ実測＋公式で確定）:
  //   current[0]=Amazon本体, current[1]=Marketplace New, current[2]=中古最安, current[18]=New Buy Box。
  // 利益計算の主価格は Marketplace New（current[1]）。Amazon本体は主価格に使わない。
  const marketNewPrice = pos(current[1]); // Marketplace New＝利益計算の主価格
  const amazonPrice = pos(current[0]); // Amazon本体（利益の主価格にはしない・競争リスク要素）
  const amazonOfferPresent = amazonPrice != null; // 本体在庫の有無（価格競争リスク）
  const priceUsed = pos(current[2]);

  // 従来互換の priceNew は Marketplace New に統一（Amazon本体へフォールバックさせない）。
  const priceNew = marketNewPrice;
  // 表示用 price（新品→中古→本体）。record自体は残すが利益判定は下の保守価格で行う。
  const price = marketNewPrice != null ? marketNewPrice : (priceUsed != null ? priceUsed : amazonPrice);
  if (price == null) return null;

  // ★注意：salesRankDrops30 は「30日間でランキングが下がった回数」であり、
  //   実売個数そのものではない（需要の“目安”指標）。UI/通知でも実販売数と断定しない。
  const salesRankDrops30 =
    stats.salesRankDrops30 != null ? stats.salesRankDrops30 : 0;
  // 既存判定ロジックとの後方互換のため monthlySales という名前も維持（中身は上記の目安値）。
  const monthlySales = salesRankDrops30;

  // Keepa候補側の識別子一覧（本当のJAN一致を検証するために使う）。
  // eanList=EAN/JAN、upcList=UPC。Keepaのレスポンスに含まれない場合は空配列。
  const eanList = Array.isArray(product.eanList) ? product.eanList.map(String) : [];
  const upcList = Array.isArray(product.upcList) ? product.upcList.map(String) : [];

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

  // ★Keepaが返す手数料の推定値（カテゴリ別の販売手数料率／FBA配送代行手数料）。
  //   これで「一律10%・450円」から「商品ごとの推定」へ精度を上げる。
  //   ただしKeepaの推定＝確定ではないので、利益判定側では必ず estimated 扱いにする。
  const kfees = keepaFeesFrom(product);

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

  const avg30New = priceMetrics ? priceMetrics.avg30New : null;
  const avg90New = priceMetrics ? priceMetrics.avg90New : null;
  // 保守的販売想定価格＝利益計算の一次基準（Marketplace New と 30日平均の低い方）。
  // Marketplace New が欠損なら null＝自動仕入れ対象外（Amazon本体だけで利益判定しない）。
  const conservativeSalePrice = priceMetrics
    ? priceMetrics.conservativeSalePrice
    : computeConservativeSalePrice(marketNewPrice, avg30New);

  return {
    asin,
    price,
    priceNew, // = Marketplace New（current[1]）
    priceUsed,
    // ★利益計算はこの保守価格を使う（欠損なら自動仕入れ対象外）
    conservativeSalePrice,
    marketNewPrice, // Marketplace New価格（current[1]）
    amazonPrice, // Amazon本体価格（current[0]）＝競争リスク要素・主価格にしない
    amazonOfferPresent, // Amazon本体の出品有無
    monthlySales,
    salesRank,
    imageUrl,
    productUrl,
    title: product.title || "",
    // 相場指標（円建て・欠損はnull）と値崩れリスク（0-100・高いほど危険）
    avg30: avg30New,
    avg90: avg90New,
    avg30New,
    avg90New,
    newOfferCount: priceMetrics ? priceMetrics.newOfferCount : null,
    amazonPresent: priceMetrics ? priceMetrics.amazonPresent : null,
    priceRiskScore: priceRisk ? priceRisk.score : null,
    priceRiskLevel: priceRisk ? priceRisk.level : null,
    priceRiskUsable: priceRisk ? priceRisk.usable : null,
    // JAN実照合用の識別子（本当にJANが一致したか検証するため）
    eanList,
    upcList,
    // ★Keepa由来の手数料推定（円/率）。欠損は null（＝設定の一律値にフォールバック）。
    keepaReferralRate: kfees.referralRate, // 例 0.104（＝10.4%）
    keepaReferralPercentage: kfees.referralPercentage, // 例 10.4
    keepaFbaFee: kfees.fbaFee, // FBA配送代行手数料の推定（円）
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
    if (byJan) {
      // ★JAN検索でヒットしただけでは「一致」と断定しない（P1-3で3値化）。さらに
      //   第4フェーズ実測の発見「同一JANが複数ASINに存在し得る」に対応し、
      //   JAN一致（商品同一性）と ASIN選択の妥当性を分離して判定する（classifyJanMatch）：
      //     JAN_VERIFIED            … JAN一致＋タイトルも整合 → 自動対象
      //     JAN_VERIFIED_ASIN_REVIEW… JAN一致だがASIN選択の裏付け不足 → 自動対象外（要確認）
      //     JAN_CONFLICT            … 識別子不一致 or JAN一致でも属性矛盾 → reject
      //     JAN_LOOKUP_UNVERIFIED   … 識別子未取得＝実照合不能 → 自動対象外
      const codes = [...(byJan.eanList || []), ...(byJan.upcList || [])];
      const jm = classifyJanMatch({
        supplierName: item.name,
        supplierJan: item.jan,
        supplierModel: item.model || null,
        candidateTitle: byJan.title,
        candidateCodes: codes,
        candidateModel: null, // Keepa側の明示品番は未取得（SP-API未接続のため）
        // ① JANの出所・信頼度。crawler が付与した janConfidence を優先し、
        //   未指定なら安全側の "low"（regex/本文由来は自動対象にしない）を既定にする。
        janConfidence: item.janConfidence || "low",
      });
      if (jm.status === "JAN_CONFLICT") {
        return null; // 別商品/別ASINを掴んでいる強い証拠。候補から外す。
      }
      return {
        ...byJan,
        matchedBy: jm.autoEligible ? "jan" : "name", // 自動対象外は通知ゲートに乗せない
        matchStatus: jm.status,
        productIdentityVerified: jm.productIdentityVerified,
        asinSelectionVerified: jm.asinSelectionVerified,
        matchScore: jm.status === "JAN_VERIFIED" ? 100 : jm.status === "JAN_VERIFIED_ASIN_REVIEW" ? 70 : 50,
        matchConflicts: [],
      };
    }
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
    //   MODEL_UNVERIFIED / ATTRIBUTE_REVIEW / NAME_UNVERIFIED → "name"（保存のみ・自動通知しない）
    let matchedBy = cls.status === "MODEL_VERIFIED" ? "model" : "name";

    // ★誤マッチ対策（最終ゲート）：JANで同一性が取れていない照合で「ありえない高利益」は
    //   安い汎用品を高いブランド品/別エディションと取り違えた疑いが濃い。
    //   利益判定と同じ「保守的販売想定価格」で比率を見る（priceNewより厳しめで安全）。
    //     name  … reject（そもそも出さない）  model … downgrade（自動通知/自動仕入れ対象から外す）
    const buy = Number(item && item.price) || 0;
    const amz =
      byName.conservativeSalePrice != null
        ? byName.conservativeSalePrice
        : byName.priceNew != null
        ? byName.priceNew
        : byName.price;
    const sanity = priceRatioSanity({ buyPrice: buy, salePrice: amz, verified: matchedBy });
    if (!sanity.ok && sanity.action === "reject") {
      return null;
    }
    let matchStatus = cls.status;
    const conflicts = [...(cls.conflicts || [])];
    if (!sanity.ok && sanity.action === "downgrade") {
      matchedBy = "name"; // 型番一致でも異常な高利益は自動対象から降格＝要手動確認
      matchStatus = "PRICE_ANOMALY_REVIEW";
      conflicts.push("priceRatio");
    }
    return {
      ...byName,
      matchedBy,
      matchStatus,
      matchScore: cls.score,
      matchConflicts: conflicts,
    };
  }
  return null;
}

// 設定値（推定の元）を1か所で読む。利益計算そのものは lib/profit.mjs に委譲する。
async function feeSettings() {
  return {
    referralRate: parseFloat((await getSetting("referral_rate")) || "10") / 100,
    fbaFee: parseInt((await getSetting("fba_fee")) || "450", 10),
    selfShipFee: parseInt((await getSetting("self_ship_fee")) || "300", 10),
    includeFees: ((await getSetting("include_fees")) || "1") === "1",
  };
}

// 販売価格・配送方法から「手数料(=仕入値を除く経費)」の推定額だけを返す。
// 内部で calculateProfit を使い、計算式を正本に一本化する。
export async function estimateFees(amazonPrice, shipMethod) {
  const s = await feeSettings();
  const input = buildProfitInput({
    salePrice: amazonPrice,
    buyPrice: 0,
    shipMethod,
    settings: s,
  });
  return calculateProfit(input).fees;
}

// 設定値と1件分の値から calculateProfit への入力を組み立てる（共通化）。
//  keepaFees: { referralRate, fbaFee } … Keepa由来の手数料推定。あればこれを
//  「推定値」として優先し、無ければ設定の一律値へフォールバックする。
function buildProfitInput({ salePrice, buyPrice, shipMethod, settings, keepaFees }) {
  const isFBA = shipMethod === "FBA";
  if (!settings.includeFees) {
    // 手数料を含めない設定のときは、経費0で純粋に「売価−仕入値」を見る。
    return {
      salePrice,
      buyPrice,
      referralFee: 0,
      referralConfirmed: true,
      shipMethod,
      fbaFee: 0,
      fbaConfirmed: true,
      supplierShipping: 0,
      inboundShipping: 0,
      outboundShipping: 0,
      otherCost: 0,
    };
  }
  const kf = keepaFees || {};
  // 販売手数料率：Keepaのカテゴリ別率があればそれを優先（無ければ設定の一律値）。
  //   いずれも referralConfirmed は付けない＝推定(ESTIMATED)のまま（偽の精度を出さない）。
  const referralRate = kf.referralRate != null ? kf.referralRate : settings.referralRate;
  // FBA配送代行手数料：KeepaのpickAndPackFee推定があれば優先（無ければ設定の一律値）。
  const fbaFeeVal = kf.fbaFee != null ? kf.fbaFee : settings.fbaFee;
  return {
    salePrice,
    buyPrice,
    // 率は設定/Keepa由来＝SP-API未確定なので推定（referralConfirmed は付けない）。
    referralRate,
    shipMethod,
    // FBA配送代行手数料は設定/Keepa由来＝サイズ/重量が確定でないので推定。
    fbaFee: isFBA ? { value: fbaFeeVal, estimated: true } : undefined,
    // 自己発送のお客様配送料は設定値を使用（確定扱い＝ユーザーが入れた実費）。
    outboundShipping: isFBA ? undefined : settings.selfShipFee,
    // 仕入送料・納品送料・ポイントはまだ取得経路が無い＝UNKNOWN（0で握りつぶさない）。
    supplierShipping: undefined,
    inboundShipping: isFBA ? undefined : 0,
    otherCost: 0,
  };
}

// 巡回・判定で使う総合ジャッジ。既存の戻り値 {ok, profit, rate, fees} は互換維持し、
// 利益の確からしさ(profitClass 等)を追加で返す。計算は calculateProfit に一本化。
export async function judge(task, buyPrice, amazonPrice, monthlySales, keepaFees) {
  const s = await feeSettings();
  const input = buildProfitInput({
    salePrice: amazonPrice,
    buyPrice,
    shipMethod: task.ship_method,
    settings: s,
    keepaFees, // Keepa由来の手数料推定（あれば優先・無ければ設定値）
  });
  const p = calculateProfit(input);

  const profit = p.grossProfit;
  const rate = p.profitRate; // %（小数第1位）
  const fees = p.fees;

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

  return {
    ok,
    profit,
    rate,
    fees,
    // ↓ Phase7で追加（表示・監査用。既存の消費側は無視して差し支えない）
    profitClass: p.class,
    profitEstimated: p.estimated,
    roi: p.roi,
    breakevenSalePrice: p.breakevenSalePrice,
    feeStatus: p.feeStatus,
    riskLevel: p.riskLevel,
    autoBuyEligible: p.autoBuyEligible,
  };
}
