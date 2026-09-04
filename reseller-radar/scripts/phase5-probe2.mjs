// 詳細ページからのJAN取得可否 + 駿河屋到達性を確認（Keepaは呼ばない）
import * as cheerio from "cheerio";
import { extractItems } from "../lib/crawler.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function extractJan(text, html) {
  const hay = `${text || ""} ${html || ""}`;
  const m = hay.match(/\b(4[59]\d{11})\b/) || hay.match(/\b(\d{13})\b/);
  return m ? m[1] : null;
}

async function fetchJan(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return { status: res.status, jan: null };
  const html = await res.text();
  const $ = cheerio.load(html);
  const jan = extractJan($("body").text(), html);
  return { status: res.status, jan };
}

// 1) 駿河屋 raw
for (const kw of ["ポケモンカード", "Nintendo Switch ソフト"]) {
  const url = `https://www.suruga-ya.jp/search?search_word=${encodeURIComponent(kw)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const html = await res.text();
    console.log(`[駿河屋 raw] "${kw}" HTTP ${res.status} bytes=${html.length} janInPage=${extractJan("", html) || "-"}`);
  } catch (e) { console.log(`[駿河屋] 失敗 ${e.message}`); }
}

// 2) Yahoo/楽天/ヨドバシの商品詳細からJANが取れるか
const sites = [
  { name: "Yahoo", url: `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent("エプソン インク IC4CL62")}`,
    supplier: { selector_item: "li.LoopList__item, .SearchResult_SearchResult__item", selector_name: ".elProductTitle, .SearchResultItemTitle", selector_price: ".elPriceNumber, .SearchResultItemPrice", selector_link: "a", selector_image: "img" } },
  { name: "ヨドバシ", url: `https://www.yodobashi.com/?word=${encodeURIComponent("エプソン インク IC4CL62")}`,
    supplier: { selector_item: ".js_productBox, .pListBlock li", selector_name: ".pName, .js_productName", selector_price: ".productPrice, .js_price", selector_link: "a", selector_image: "img" } },
];
for (const s of sites) {
  try {
    const items = (await extractItems(s.url, s.supplier)).filter((i) => i.name && i.price && i.link);
    console.log(`\n[${s.name}] items=${items.length}`);
    for (const it of items.slice(0, 3)) {
      let jan = "-";
      try { const r = await fetchJan(it.link); jan = `${r.status}/${r.jan || "-"}`; } catch (e) { jan = "err"; }
      console.log(`   ${(it.name || "").slice(0, 36)} | ${it.link.slice(0, 50)} | detailJAN=${jan}`);
    }
  } catch (e) { console.log(`[${s.name}] 失敗 ${e.message}`); }
}
