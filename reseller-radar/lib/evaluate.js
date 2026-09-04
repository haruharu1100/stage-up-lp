import { extractItems } from "./crawler.js";
import { lookupProduct } from "./amazon.js";
import { getSetting } from "./db.js";
import { sendNotificationEmail } from "./notify.js";
import { calculateProfit } from "./profit.mjs";

// 全角数字・記号を半角に直し、カンマを除く。ルール文の数値抽出を安定させるため。
function normalize(text) {
  return String(text || "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[％]/g, "%")
    .replace(/[，、]/g, "")
    .replace(/,/g, "")
    .toLowerCase();
}

// 「3万」「1.5万」「2千」などの日本語単位を数値へ。
function jpNumber(numStr, unit) {
  const n = parseFloat(numStr);
  if (!isFinite(n)) return null;
  if (unit === "万") return Math.round(n * 10000);
  if (unit === "千") return Math.round(n * 1000);
  return Math.round(n);
}

// 外部から渡された「自然言語の判定ルール」を、数値のしきい値に落とす。
// 実装方法は自由（ここでは正規表現で解釈）。解釈できた条件だけを返し、
// 何も解釈できなければ「利益が出る商品（profit>0）」を既定条件とする。
export function parseRule(ruleText) {
  const s = normalize(ruleText);
  const cond = {};

  // 仕入価格 <= Amazon価格 * 0.60 / アマゾン価格の60%以下 / アマゾンの6割 など。
  // → 仕入値が「Amazon価格 × ratio」以下であること。
  let m =
    s.match(/amazon[^0-9]*?[*×x]\s*(0?\.\d+)/) ||
    s.match(/アマゾン[^0-9]*?[*×x]\s*(0?\.\d+)/);
  if (m) cond.costRatioMax = parseFloat(m[1]);
  if (cond.costRatioMax == null) {
    m =
      s.match(/(?:amazon|アマゾン)[^0-9]{0,8}(\d{1,3})\s*%\s*(?:以下|以内|まで)?/) ||
      null;
    if (m) cond.costRatioMax = parseInt(m[1], 10) / 100;
  }
  if (cond.costRatioMax == null) {
    m = s.match(/(?:amazon|アマゾン)[^0-9]{0,8}(\d)\s*割/);
    if (m) cond.costRatioMax = parseInt(m[1], 10) / 10;
  }

  // 利益率 30%以上 / 利益率>=0.3 など → 割合(fraction)で保持。
  m = s.match(/利益率[^0-9]{0,6}(\d{1,3})\s*%\s*(?:以上|超|≧|>=)?/);
  if (m) cond.profitRateMin = parseInt(m[1], 10) / 100;
  else {
    m = s.match(/利益率[^0-9]{0,6}(0?\.\d+)/);
    if (m) cond.profitRateMin = parseFloat(m[1]);
  }

  // 利益額 500円以上 / 利益が500以上 など（％は上で処理済みなので円/以上で判定）。
  m = s.match(/利益(?:額)?[^0-9%]{0,6}(\d{2,7})\s*円?\s*(?:以上|超|≧|>=)/);
  if (m) cond.profitAmountMin = parseInt(m[1], 10);

  // ランキング 30000位以内 / ランキング3万以下 / 売れ筋 3万位まで など。
  m = s.match(/(?:ランキング|順位|売れ筋|ランク)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(万|千)?\s*位?\s*(?:以内|以下|まで|≦|<=)/);
  if (m) cond.rankMax = jpNumber(m[1], m[2]);

  // 月間販売数 3個以上 / 月3件以上売れて など。
  m = s.match(/月[^0-9]{0,8}(\d+)\s*(?:個|件|回|本)?\s*(?:以上|≧|>=)/);
  if (m) cond.monthlySalesMin = parseInt(m[1], 10);

  return cond;
}

// 1商品の指標が、解釈した条件をすべて満たすか。
// 利益が出ること（profit>0）は常に必須（「売れて利益が出た仕入れ」を勝ちとする方針のため）。
export function passesRule(cond, metrics) {
  const { cost_jpy, amazon_price_jpy, profit_jpy, profit_rate, rank } = metrics;
  if (!(profit_jpy > 0)) return false;
  if (cond.costRatioMax != null) {
    if (!(amazon_price_jpy > 0 && cost_jpy <= amazon_price_jpy * cond.costRatioMax))
      return false;
  }
  if (cond.profitRateMin != null && !(profit_rate >= cond.profitRateMin)) return false;
  if (cond.profitAmountMin != null && !(profit_jpy >= cond.profitAmountMin)) return false;
  if (cond.rankMax != null) {
    if (rank == null || !(rank <= cond.rankMax)) return false;
  }
  if (cond.monthlySalesMin != null && !(metrics.monthly_sales >= cond.monthlySalesMin))
    return false;
  return true;
}

async function feeSettings() {
  const referralRate = parseFloat((await getSetting("referral_rate")) || "10") / 100;
  const fbaFee = parseInt((await getSetting("fba_fee")) || "450", 10);
  const selfShipFee = parseInt((await getSetting("self_ship_fee")) || "300", 10);
  return { referralRate, fbaFee, selfShipFee };
}

// 外部（n8n）から渡された1つの判定ルールで、対象URL群を巡回・照合し、結果を返す。
// このリポジトリの責務は「渡されたルールで判定して結果を返す」だけ。
// pattern_id は結果と通知に必ず含める（どのルールが利益を生んだかを学習するための最重要要件）。
export async function evaluateWithRule({
  pattern_id,
  rule,
  targets,
  ship_method = "self",
  notify = false,
}) {
  const cond = parseRule(rule);
  const { referralRate, fbaFee, selfShipFee } = await feeSettings();
  const shippingJpy = ship_method === "FBA" ? fbaFee : selfShipFee;

  const results = [];
  const errors = [];
  const seenAsin = new Set();

  // Vercelの60秒制限の手前で安全に打ち切る。照合回数の上限も設ける。
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 45000;
  const MAX_LOOKUPS = 30;
  let lookups = 0;

  const urls = Array.isArray(targets) ? targets : [];
  for (const url of urls) {
    if (Date.now() - startedAt > TIME_BUDGET_MS || lookups >= MAX_LOOKUPS) break;

    let items = [];
    try {
      items = await extractItems(url, {});
    } catch (e) {
      errors.push(`${url}: ${e.message || String(e)}`);
      continue;
    }

    for (const it of items) {
      if (Date.now() - startedAt > TIME_BUDGET_MS || lookups >= MAX_LOOKUPS) break;
      if (!it.name || !it.price) continue;

      lookups++;
      let info;
      try {
        info = await lookupProduct(it);
      } catch (e) {
        const msg = e.message || String(e);
        errors.push(msg);
        // キー未設定・利用上限は続けても無駄なので打ち切る。
        if (msg.includes("APIキー") || msg.includes("429")) break;
        continue;
      }
      if (!info) continue;

      // ★利益判定は「保守的販売想定価格」を使う（Marketplace Newと30日平均の低い方）。
      //   Amazon本体価格は主価格にしない。保守価格が無ければ対象外としてスキップ。
      const amazonPrice = info.conservativeSalePrice;
      if (!amazonPrice) continue;
      if (info.asin && seenAsin.has(info.asin)) continue;
      if (info.asin) seenAsin.add(info.asin);

      // ★利益計算は正本 calculateProfit() に一本化（画面/巡回/CSVと同じ式）。
      //   Keepa由来のカテゴリ別手数料/FBA配送代行手数料があれば推定として優先し、
      //   無ければ設定の一律値へフォールバックする（いずれも estimated 扱い）。
      const evalReferralRate =
        info.keepaReferralRate != null ? info.keepaReferralRate : referralRate;
      const evalFbaFee = info.keepaFbaFee != null ? info.keepaFbaFee : fbaFee;
      const p = calculateProfit({
        salePrice: amazonPrice,
        buyPrice: it.price,
        referralRate: evalReferralRate,
        shipMethod: ship_method === "FBA" ? "FBA" : "self",
        fbaFee: ship_method === "FBA" ? { value: evalFbaFee, estimated: true } : undefined,
        outboundShipping: ship_method === "FBA" ? undefined : selfShipFee,
        supplierShipping: undefined,
        inboundShipping: ship_method === "FBA" ? undefined : 0,
        otherCost: 0,
      });
      const feeJpy = p.costItems.referralFee.amount;
      const profitJpy = p.grossProfit;
      const profitRate = amazonPrice > 0 ? Math.round((profitJpy / amazonPrice) * 10000) / 10000 : 0;

      const hasProductLink = it.link && it.link !== url;
      const metrics = {
        pattern_id,
        url: hasProductLink ? it.link : url,
        title: info.title || it.name,
        cost_jpy: it.price,
        amazon_price_jpy: amazonPrice,
        fee_jpy: feeJpy,
        shipping_jpy: shippingJpy,
        profit_jpy: profitJpy,
        profit_rate: profitRate,
        // Phase7追加：利益の確からしさ（監査・表示用）
        profit_class: p.class,
        profit_estimated: p.estimated,
        roi: p.roi,
        breakeven_jpy: p.breakevenSalePrice,
        rank: info.salesRank != null ? info.salesRank : null,
        monthly_sales: info.monthlySales || 0,
        match_type: info.matchedBy || null,
      };
      metrics.hit = passesRule(cond, metrics);
      results.push(metrics);
    }
  }

  const hits = results.filter((r) => r.hit);

  // 通知はメール（既存の仕組み）を流用。件名・本文に pattern_id を必ず入れる。
  // 既定は送らない（notify:true のときだけ送る）。
  let notified = false;
  if (notify && hits.length > 0) {
    try {
      const items = hits.map((r) => ({
        product_name: r.title,
        buy_price: r.cost_jpy,
        amazon_price: r.amazon_price_jpy,
        profit: r.profit_jpy,
        profit_rate: Math.round(r.profit_rate * 1000) / 10, // 表示用に%へ
        monthly_sales: r.monthly_sales,
        product_url: r.url,
      }));
      await sendNotificationEmail(`[${pattern_id}] AI仕入れ判定`, items);
      notified = true;
    } catch (e) {
      errors.push("メール送信に失敗: " + (e.message || String(e)));
    }
  }

  return {
    pattern_id,
    rule_parsed: cond,
    results,
    hit_count: hits.length,
    evaluated: results.length,
    notified,
    errors: [...new Set(errors)],
  };
}
