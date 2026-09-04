// 第5フェーズ 到達性プローブ（Keepaは呼ばない・HTMLの実取得のみ）
// 目的：どの仕入れ先が今この環境から実際に商品抽出できるかを確認する。
import { extractItems } from "../lib/crawler.js";

const KW = process.argv[2] || "SanDisk";

const sites = [
  { name: "駿河屋", url: `https://www.suruga-ya.jp/search?search_word=${encodeURIComponent(KW)}`,
    supplier: { selector_item: ".item, .product_box", selector_name: ".product-name, .title, .item_name", selector_price: ".item_price", selector_link: "a", selector_image: "img" } },
  { name: "Yahoo!ショッピング", url: `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(KW)}`,
    supplier: { selector_item: "li.LoopList__item, .SearchResult_SearchResult__item", selector_name: ".elProductTitle, .SearchResultItemTitle", selector_price: ".elPriceNumber, .SearchResultItemPrice", selector_link: "a", selector_image: "img" } },
  { name: "楽天市場", url: `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(KW)}/`,
    supplier: { selector_item: ".searchresultitem, .dui-card", selector_name: ".title, .content.title", selector_price: ".important, .price--OX_YW", selector_link: "a", selector_image: "img" } },
  { name: "ヨドバシ.com", url: `https://www.yodobashi.com/?word=${encodeURIComponent(KW)}`,
    supplier: { selector_item: ".js_productBox, .pListBlock li", selector_name: ".pName, .js_productName", selector_price: ".productPrice, .js_price", selector_link: "a", selector_image: "img" } },
  { name: "ビックカメラ.com", url: `https://www.biccamera.com/bc/category/?q=${encodeURIComponent(KW)}`,
    supplier: { selector_item: "li.prod_box, .cssopacity", selector_name: ".bcs_title, .prod_ttl", selector_price: ".bcs_price, .price", selector_link: "a", selector_image: "img" } },
  { name: "あみあみ", url: `https://www.amiami.jp/top/search/list?s_keywords=${encodeURIComponent(KW)}`,
    supplier: { selector_item: ".newly-added-items__item, .product_box", selector_name: ".newly-added-items__name, .product_name", selector_price: ".newly-added-items__price, .product_price", selector_link: "a", selector_image: "img" } },
];

for (const s of sites) {
  try {
    const items = await extractItems(s.url, s.supplier);
    const withPrice = items.filter((i) => i.name && i.price);
    const withJan = withPrice.filter((i) => i.jan);
    console.log(`[${s.name}] 取得=${items.length} 価格あり=${withPrice.length} JANあり=${withJan.length}`);
    for (const it of withPrice.slice(0, 2)) {
      console.log(`   ・${(it.name || "").slice(0, 40)} | ¥${it.price} | jan=${it.jan || "-"}`);
    }
  } catch (e) {
    console.log(`[${s.name}] 失敗: ${(e.message || String(e)).slice(0, 80)}`);
  }
}
