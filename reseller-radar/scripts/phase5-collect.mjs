// =====================================================================
// 第5フェーズ ライブ候補収集（実データのみ・合成禁止）
// ---------------------------------------------------------------------
//  ・システム自身が実際に取得した「仕入れ先商品＋Keepa候補」だけを使う。
//  ・本番と同じ extractItems() で実サイトからライブ抽出。
//  ・各商品を本番と同じ経路（JANあり→classifyJanMatch / 無し→classifyMatch）で判定。
//  ・購入/出品/SP-API/メール/課金なし。Keepa通信は上限で制御（無制限取得禁止）。
//  ・生の候補（rejectされる別商品も含む）を全件保存し、後で人間監査できるようにする。
// =====================================================================
import { writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { extractItems } from "../lib/crawler.js";
import { lookupByJan, searchByName } from "../lib/amazon.js";
import {
  classifyMatch,
  classifyJanMatch,
  extractAttributes,
  detectConflicts,
  extractModelCandidates,
} from "../lib/match.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

// ---- 上限（無制限取得の禁止）----
const MAX_CASES = 170;         // 収集する候補の上限
const MAX_KEEPA = 190;         // Keepa lookup 回数の上限
const MAX_DETAIL_FETCH = 120;  // 詳細ページからのJAN取得の上限（HTTPのみ・Keepaではない）
let keepaCalls = 0;
let detailFetches = 0;

function jan13(text, html) {
  const hay = `${text || ""} ${html || ""}`;
  const m = hay.match(/\b(4[59]\d{11})\b/) || hay.match(/\b(\d{13})\b/);
  return m ? m[1] : null;
}

// Yahoo商品詳細からJANを拾う（実サイトのHTML）。
async function fetchDetailJan(url) {
  if (!url || detailFetches >= MAX_DETAIL_FETCH) return null;
  detailFetches++;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    return jan13($("body").text(), html);
  } catch {
    return null;
  }
}

// ---- 仕入れ先（実際にライブ取得できたサイトのみ）----
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

// ---- ジャンル別キーワード（性質の異なる商品を混ぜる）----
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
];

// 1キーワードあたりの取得上限（サイト別）
const CAP = { yahoo: 9, rakuten: 4, yodobashi: 3 };

function num(v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : null; }

const cases = [];
let cid = 0;
const seen = new Set(); // 重複（同一 site+title）除去

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

      // JAN：一覧に無ければ Yahoo のみ詳細ページから取得（実サイトのHTML）。
      let supplierJan = it.jan || null;
      let janSource = it.jan ? "listing" : null;
      if (!supplierJan && site === "yahoo" && it.link) {
        const dj = await fetchDetailJan(it.link);
        if (dj) { supplierJan = dj; janSource = "detail"; }
      }

      const supModelCand = extractModelCandidates(it.name, null);
      const supplier_model = supModelCand.length ? supModelCand[0].value : null;

      // ---- 本番と同じ経路で1回だけKeepa照合（JANあり→JAN経路 / 無し→名前経路）----
      let cand = null; // parseProduct出力
      let path = null;
      let decision = null; // {status, autoEligible, productIdentityVerified, asinSelectionVerified, conflicts, ambiguities, reason}
      try {
        if (supplierJan) {
          path = "jan";
          keepaCalls++;
          cand = await lookupByJan(supplierJan);
          if (cand) {
            const codes = [...(cand.eanList || []), ...(cand.upcList || [])];
            const jm = classifyJanMatch({
              supplierName: it.name, supplierJan, supplierModel: supplier_model,
              candidateTitle: cand.title, candidateCodes: codes,
            });
            decision = {
              status: jm.status, autoEligible: jm.autoEligible,
              productIdentityVerified: jm.productIdentityVerified,
              asinSelectionVerified: jm.asinSelectionVerified,
              conflicts: [], ambiguities: [], reason: jm.reason,
            };
          }
        } else {
          path = "name";
          keepaCalls++;
          cand = await searchByName(it.name);
          if (cand) {
            const cls = classifyMatch({ supplierName: it.name, supplierJan: null, amazonTitle: cand.title, amazonJan: null });
            const sup = extractAttributes(it.name);
            const amz = extractAttributes(cand.title || "");
            const dc = detectConflicts(sup, amz);
            decision = {
              status: cls.status, autoEligible: cls.autoEligible,
              productIdentityVerified: false, asinSelectionVerified: false,
              conflicts: cls.conflicts || [], ambiguities: dc.ambiguities || [], reason: cls.reason,
            };
          }
        }
      } catch (e) {
        console.log(`[keepa] 失敗 ${(e.message || e).toString().slice(0, 60)}`);
      }

      cid++;
      cases.push({
        case_id: `C${String(cid).padStart(3, "0")}`,
        genre, keyword: kw, site,
        supplier_url: it.link || null,
        supplier_title: it.name,
        supplier_price: it.price,
        supplier_jan: supplierJan,
        supplier_jan_source: janSource,
        supplier_model,
        path,
        // Amazon候補（Keepa実レスポンス由来）
        asin: cand ? cand.asin : null,
        amazon_title: cand ? cand.title : null,
        eanList: cand ? cand.eanList : null,
        upcList: cand ? cand.upcList : null,
        marketNewPrice: cand ? num(cand.marketNewPrice) : null,
        amazonPrice: cand ? num(cand.amazonPrice) : null,
        avg30New: cand ? num(cand.avg30New) : null,
        avg90New: cand ? num(cand.avg90New) : null,
        conservativeSalePrice: cand ? num(cand.conservativeSalePrice) : null,
        salesActivity30: cand ? cand.monthlySales : null,
        // 判定（本番ロジックの実出力）
        actual_status: decision ? decision.status : (cand ? "UNCLASSIFIED" : "NO_CANDIDATE"),
        actual_autoEligible: decision ? decision.autoEligible : false,
        actual_conflicts: decision ? decision.conflicts : [],
        actual_ambiguities: decision ? decision.ambiguities : [],
        productIdentityVerified: decision ? decision.productIdentityVerified : false,
        asinSelectionVerified: decision ? decision.asinSelectionVerified : false,
        match_reason: decision ? decision.reason : null,
      });
      if (cases.length % 10 === 0) console.log(`... 収集 ${cases.length}件 / Keepa ${keepaCalls}回 / 詳細取得 ${detailFetches}回`);
    }
  }
}

const out = {
  provenance: "実サイト(Yahoo!ショッピング/楽天/ヨドバシ)からのライブ抽出＋Keepa実レスポンス。合成データなし。",
  collected_at: new Date().toISOString(),
  totals: { cases: cases.length, keepaCalls, detailFetches, max_cases: MAX_CASES, max_keepa: MAX_KEEPA },
  cases,
};
writeFileSync("/Users/yokotaakiraju/Documents/reseller-radar-phase5-cases.json", JSON.stringify(out, null, 2), "utf8");
console.log(`\n=== 収集完了 ===`);
console.log(`件数=${cases.length} / Keepa=${keepaCalls} / 詳細HTTP=${detailFetches}`);
const bySite = {}; const byPath = {}; const withJan = cases.filter((c) => c.supplier_jan).length;
for (const c of cases) { bySite[c.site] = (bySite[c.site] || 0) + 1; byPath[c.path] = (byPath[c.path] || 0) + 1; }
console.log("サイト別:", JSON.stringify(bySite), " 経路別:", JSON.stringify(byPath), " JANあり:", withJan);
console.log("候補あり:", cases.filter((c) => c.asin).length, " AUTO_ELIGIBLE:", cases.filter((c) => c.actual_autoEligible).length);
console.log("保存: /Users/yokotaakiraju/Documents/reseller-radar-phase5-cases.json");
