import { getSetting } from "./db.js";

function getKey() {
  const key = (getSetting("keepa_key") || "").trim();
  if (!key) {
    throw new Error("Keepa APIキーが未設定です。設定画面でキーを登録してください。");
  }
  return key;
}

async function keepaFetch(url) {
  const res = await fetch(url);
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

  // 価格: Amazon本体(0) を優先、なければ新品最安(1)、次に中古最安(2)
  let price = null;
  if (current[0] != null && current[0] > 0) price = current[0];
  else if (current[1] != null && current[1] > 0) price = current[1];
  else if (current[2] != null && current[2] > 0) price = current[2];
  if (price == null) return null;
  price = Math.round(price / 100); // Keepaは円×100（銭）で返す

  const monthlySales =
    stats.salesRankDrops30 != null ? stats.salesRankDrops30 : 0;

  const asin = product.asin || null;

  let imageUrl = null;
  if (product.imagesCSV) {
    const file = String(product.imagesCSV).split(",")[0];
    if (file) {
      imageUrl = `https://images-na.ssl-images-amazon.com/images/I/${file}`;
    }
  }

  const productUrl = asin ? `https://www.amazon.co.jp/dp/${asin}` : null;

  return { asin, price, monthlySales, imageUrl, productUrl, title: product.title || "" };
}

// Keepa（domain=5 = Amazon.co.jp）でJAN（バーコード）から商品を照合する
export async function lookupByJan(jan) {
  const key = getKey();
  const url = `https://api.keepa.com/product?key=${encodeURIComponent(
    key
  )}&domain=5&code=${encodeURIComponent(jan)}&stats=30&history=0`;
  const data = await keepaFetch(url);
  const product = data && data.products && data.products[0];
  return parseProduct(product);
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
  const key = getKey();
  const term = cleanName(name);
  if (!term || term.length < 3) return null;

  const url = `https://api.keepa.com/search?key=${encodeURIComponent(
    key
  )}&domain=5&type=product&term=${encodeURIComponent(term)}&stats=30`;
  const data = await keepaFetch(url);

  // 検索はproducts配列、またはasinListで返る場合がある
  let product = data && data.products && data.products[0];
  if (!product && data && Array.isArray(data.asinList) && data.asinList[0]) {
    const asin = data.asinList[0];
    const purl = `https://api.keepa.com/product?key=${encodeURIComponent(
      key
    )}&domain=5&asin=${encodeURIComponent(asin)}&stats=30&history=0`;
    const pdata = await keepaFetch(purl);
    product = pdata && pdata.products && pdata.products[0];
  }
  return parseProduct(product);
}

// 商品情報を取得する共通入口（JANがあればJAN優先、無ければ商品名で検索）
export async function lookupProduct(item) {
  if (item && item.jan) {
    const byJan = await lookupByJan(item.jan);
    if (byJan) return { ...byJan, matchedBy: "jan" };
  }
  const byName = await searchByName(item && item.name);
  if (byName) return { ...byName, matchedBy: "name" };
  return null;
}

export function estimateFees(amazonPrice, shipMethod) {
  const referralRate = parseFloat(getSetting("referral_rate") || "10") / 100;
  const fbaFee = parseInt(getSetting("fba_fee") || "450", 10);
  const selfShipFee = parseInt(getSetting("self_ship_fee") || "300", 10);

  const referral = Math.round(amazonPrice * referralRate);
  const shipFee = shipMethod === "FBA" ? fbaFee : selfShipFee;
  return referral + shipFee;
}

export function judge(task, buyPrice, amazonPrice, monthlySales) {
  const includeFees = (getSetting("include_fees") || "1") === "1";
  const fees = includeFees ? estimateFees(amazonPrice, task.ship_method) : 0;

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
