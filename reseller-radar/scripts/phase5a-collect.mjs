// =====================================================================
// 第5フェーズA 本番忠実ライブ・バックテスト（実データ100件以上・合成禁止）
// ---------------------------------------------------------------------
//  ・本番と「完全に同じ」経路で測定する：
//      extractItems()（本番のスクレイパ）→ lookupProduct(it)（本番の照合）
//  ・JANは本番が一覧から取得したもの（it.jan）だけを使う。
//    ★測定のためのJAN補完（詳細ページから最初の13桁を拾う等）は一切しない。
//    本番でJANが取れない商品は supplier_jan=null のまま。
//  ・購入/出品/SP-API/メール/課金なし。Keepa通信は上限で制御。
//  ・ADVERSARIAL #1（112件）とは別データセット。混ぜない。
// =====================================================================
import { writeFileSync } from "node:fs";
import { extractItems } from "../lib/crawler.js";
import { lookupProduct } from "../lib/amazon.js";
import { AUTO_ELIGIBLE_STATUSES, extractModelCandidates } from "../lib/match.mjs";

// ---- 上限（無制限取得の禁止）----
const MAX_CASES = 150;
const MAX_KEEPA = 185;
let keepaCalls = 0;

function num(v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : null; }

// 本番の matchStatus から人が読める理由へ（記録用。ロジックは変更しない）。
const STATUS_REASON = {
  JAN_VERIFIED: "一覧JAN一致＋タイトル整合（自動対象）",
  JAN_VERIFIED_ASIN_REVIEW: "一覧JAN一致だがASIN選択の裏付け不足（自動対象外）",
  JAN_LOOKUP_UNVERIFIED: "識別子未取得で実照合不能（自動対象外）",
  MODEL_VERIFIED: "型番一致（自動対象）",
  MODEL_UNVERIFIED: "型番の裏付け不足（自動対象外）",
  ATTRIBUTE_REVIEW: "属性に曖昧さあり（自動対象外）",
  NAME_UNVERIFIED: "名前一致のみで未確認（自動対象外）",
};

// ---- 仕入れ先（本番と同じセレクタ）----
const SUP = {
  yahoo: { selector_item: "li.LoopList__item, .SearchResult_SearchResult__item", selector_name: ".elProductTitle, .SearchResultItemTitle", selector_price: ".elPriceNumber, .SearchResultItemPrice", selector_link: "a", selector_image: "img" },
  rakuten: { selector_item: ".searchresultitem, .dui-card", selector_name: ".title, .content.title", selector_price: ".important, .price--OX_YW", selector_link: "a", selector_image: "img" },
  yodobashi: { selector_item: ".js_productBox, .pListBlock li", selector_name: ".pName, .js_productName", selector_price: ".productPrice, .js_price", selector_link: "a", selector_image: "img" },
};
const urlOf = {
  yahoo: (kw) => `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(kw)}`,
  rakuten: (kw) => `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw)}/`,
  yodobashi: (kw) => `https://www.yodobashi.com/?word=${encodeURIComponent(kw)}`,
};

const KEYWORDS = [
  { genre: "SDカード", kw: "SanDisk microSD 128GB" },
  { genre: "SSD", kw: "SanDisk ポータブルSSD 1TB" },
  { genre: "純正/互換インク", kw: "エプソン インク IC4CL62" },
  { genre: "純正/互換インク", kw: "キヤノン インク BC-345 BC-346" },
  { genre: "ゲーム周辺機器", kw: "Nintendo Switch コントローラー" },
  { genre: "充電器", kw: "Anker モバイルバッテリー" },
  { genre: "PC周辺機器", kw: "ロジクール ワイヤレスマウス" },
  { genre: "日用/電池", kw: "パナソニック エネループ 単3" },
  { genre: "おもちゃ", kw: "レゴ クラシック" },
  { genre: "オーディオ", kw: "ソニー ワイヤレスヘッドホン WH" },
  { genre: "オーディオ", kw: "ソニー イヤホン WF-1000XM5" },
  { genre: "記録メディア", kw: "バッファロー USBメモリ 64GB" },
  { genre: "PC周辺機器", kw: "エレコム USBハブ Type-C" },
  { genre: "生活家電", kw: "象印 電気ケトル" },
];

const CAP = { yahoo: 9, rakuten: 5, yodobashi: 4 };

const cases = [];
let cid = 0;
const seen = new Set();

outer:
for (const { genre, kw } of KEYWORDS) {
  for (const site of ["yahoo", "rakuten", "yodobashi"]) {
    if (cases.length >= MAX_CASES || keepaCalls >= MAX_KEEPA) break outer;
    let items = [];
    try {
      items = await extractItems(urlOf[site](kw), SUP[site]);
    } catch (e) {
      console.log(`[${site}] "${kw}" 抽出失敗: ${(e.message || e).toString().slice(0, 60)}`);
      continue;
    }
    const usable = items.filter((it) => it.name && it.price).slice(0, CAP[site]);
    for (const it of usable) {
      if (cases.length >= MAX_CASES || keepaCalls >= MAX_KEEPA) break outer;
      const dedupe = `${site}::${(it.name || "").slice(0, 40)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      // ★本番と同じ：JANは一覧由来(it.jan)のみ。詳細ページからの補完はしない。
      const supplierJan = it.jan || null;

      // 分析用の supplier_model（記録のみ。lookupProduct へは本番同様 it をそのまま渡す）。
      const supCand = extractModelCandidates(it.name, null);
      const supplier_model = supCand.length ? supCand[0].value : null;

      let info = null;
      try {
        keepaCalls++;
        info = await lookupProduct(it); // ← 本番の照合エントリそのもの
      } catch (e) {
        console.log(`[keepa] 失敗 ${(e.message || e).toString().slice(0, 60)}`);
      }

      const status = info ? info.matchStatus : "NO_CANDIDATE";
      const autoEligible = info ? AUTO_ELIGIBLE_STATUSES.has(status) : false;

      cid++;
      cases.push({
        case_id: `A${String(cid).padStart(3, "0")}`,
        genre, keyword: kw, site,
        supplier_url: it.link || null,
        supplier_title: it.name,
        supplier_price: it.price,
        supplier_jan: supplierJan,            // 本番が一覧から取れたJANだけ（多くはnull）
        supplier_jan_source: supplierJan ? "listing" : null,
        supplier_model,
        asin: info ? info.asin : null,
        amazon_title: info ? info.title : null,
        eanList: info ? info.eanList || null : null,
        upcList: info ? info.upcList || null : null,
        marketNewPrice: info ? num(info.marketNewPrice) : null,
        amazonPrice: info ? num(info.amazonPrice) : null,
        avg30New: info ? num(info.avg30New) : null,
        avg90New: info ? num(info.avg90New) : null,
        conservativeSalePrice: info ? num(info.conservativeSalePrice) : null,
        salesActivity30: info ? info.monthlySales ?? null : null,
        actual_status: status,
        actual_autoEligible: autoEligible,
        actual_reason: info ? (STATUS_REASON[status] || status) : "候補なし（本番pipelineがnullを返却）",
        productIdentityVerified: info ? !!info.productIdentityVerified : false,
        asinSelectionVerified: info ? !!info.asinSelectionVerified : false,
      });
      if (cases.length % 10 === 0) console.log(`... 収集 ${cases.length}件 / Keepa ${keepaCalls}回`);
    }
  }
}

const out = {
  dataset: "phase5a-production-faithful",
  provenance: "実サイト(Yahoo!ショッピング/楽天/ヨドバシ)からのライブ抽出＋本番lookupProduct()＋Keepa実レスポンス。JANは一覧由来のみ（詳細ページ補完なし）。合成データなし。",
  collected_at: new Date().toISOString(),
  totals: { cases: cases.length, keepaCalls, max_cases: MAX_CASES, max_keepa: MAX_KEEPA },
  cases,
};
writeFileSync("/Users/yokotaakiraju/Documents/reseller-radar-phase5a-cases.json", JSON.stringify(out, null, 2), "utf8");

console.log(`\n=== 収集完了（Phase5A 本番忠実）===`);
console.log(`件数=${cases.length} / Keepa=${keepaCalls}`);
const bySite = {}; const withJan = cases.filter((c) => c.supplier_jan).length;
for (const c of cases) bySite[c.site] = (bySite[c.site] || 0) + 1;
console.log("サイト別:", JSON.stringify(bySite), " 一覧JANあり:", withJan);
console.log("候補あり:", cases.filter((c) => c.asin).length, " AUTO_ELIGIBLE:", cases.filter((c) => c.actual_autoEligible).length);
console.log("保存: /Users/yokotaakiraju/Documents/reseller-radar-phase5a-cases.json");
