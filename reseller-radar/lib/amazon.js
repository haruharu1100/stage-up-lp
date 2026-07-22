import { getSetting } from "./db.js";

// Keepa（domain=5 = Amazon.co.jp）でJANから商品を照合する
export async function lookupByJan(jan) {
  const key = (getSetting("keepa_key") || "").trim();
  if (!key) {
    throw new Error("Keepa APIキーが未設定です。設定画面でキーを登録してください。");
  }

  const url = `https://api.keepa.com/product?key=${encodeURIComponent(
    key
  )}&domain=5&code=${encodeURIComponent(jan)}&stats=30&history=0`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Keepa APIエラー（HTTP ${res.status}）が発生しました。`);
  }
  const data = await res.json();

  const product = data && data.products && data.products[0];
  if (!product) return null;

  const stats = product.stats || {};
  const current = stats.current || [];

  // 価格: Amazon本体(0) を優先、なければ新品最安(1)
  let price = null;
  if (current[0] != null && current[0] > 0) price = current[0];
  else if (current[1] != null && current[1] > 0) price = current[1];
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

  return { asin, price, monthlySales, imageUrl, productUrl };
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
