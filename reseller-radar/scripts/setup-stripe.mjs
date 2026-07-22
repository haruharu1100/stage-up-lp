// 仕入れセンサー — Stripe 月額プラン自動セットアップ
// 使い方: STRIPE_SECRET_KEY=sk_xxx node scripts/setup-stripe.mjs
// スタンダード(月980円)とプロ(月2,980円)の商品・価格・決済リンクを作成し、
// LPボタンに貼る決済リンクURLを出力します。（JPYは端数なし通貨なので unit_amount=金額）

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("STRIPE_SECRET_KEY が未設定です。例: STRIPE_SECRET_KEY=sk_live_xxx node scripts/setup-stripe.mjs");
  process.exit(1);
}

async function stripe(path, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe APIエラー(${path}): ${data.error ? data.error.message : res.status}`);
  }
  return data;
}

async function createPlan(name, amount) {
  const product = await stripe("products", { name });
  const price = await stripe("prices", {
    product: product.id,
    unit_amount: String(amount),
    currency: "jpy",
    "recurring[interval]": "month",
  });
  const link = await stripe("payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
  });
  return { name, amount, productId: product.id, priceId: price.id, url: link.url };
}

try {
  const std = await createPlan("仕入れセンサー スタンダードプラン", 980);
  const pro = await createPlan("仕入れセンサー プロプラン", 2980);

  console.log("\n=== 作成完了 ===");
  for (const p of [std, pro]) {
    console.log(`\n■ ${p.name}（月${p.amount.toLocaleString()}円）`);
    console.log(`  決済リンク: ${p.url}`);
    console.log(`  price_id : ${p.priceId}`);
  }
  console.log("\nこの2本の決済リンクURLをLPのボタンに接続します。");
} catch (e) {
  console.error("失敗:", e.message || String(e));
  process.exit(1);
}
