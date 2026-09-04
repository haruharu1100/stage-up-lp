import * as cheerio from "cheerio";
import { get, all, run, getSetting } from "./db.js";
import { lookupProduct, judge, fetchImageByAsin } from "./amazon.js";
import { sendNotificationEmail } from "./notify.js";
import { normalizePlan, dealLimit } from "./plans.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// テキスト/HTMLからJANを抽出（45|49始まり13桁を最優先、なければ8桁）
function extractJan(text, html) {
  const hay = `${text || ""} ${html || ""}`;
  const jan13 = hay.match(/\b(4[59]\d{11})\b/);
  if (jan13) return jan13[1];
  const anyJan13 = hay.match(/\b(\d{13})\b/);
  if (anyJan13) return anyJan13[1];
  const jan8 = hay.match(/\b(\d{8})\b/);
  if (jan8) return jan8[1];
  return null;
}

// 価格文字列から「実際の値段」を賢く取り出す。
// ¥／￥／円 の付いた金額を最優先する。
// requireCurrency=true のときは通貨記号（¥/￥/円）が付いた金額だけを採用する。
//   → 商品名やまとめ文から拾う「自動検出モード」で、
//     「300粒入」「100日分」「39種」などの“数量の数字”を値段と誤認しないため。
// requireCurrency=false（目印セレクタで価格欄を直接指定している場合）は、
//   型番（DK-R12101 等）の数字だけ避けて、素の数字も値段として拾う。
// 数字が無ければ null（＝仕入れ対象外として除外）。
function pickPrice(text, requireCurrency = false) {
  if (!text) return null;
  const s = String(text).replace(/,/g, "");
  // ¥1980 / ￥1980（半角¥ U+00A5 / 全角￥ U+FFE5）
  const yen = s.match(/[¥￥]\s?(\d{3,7})/);
  if (yen) return parseInt(yen[1], 10);
  // 1980円
  const en = s.match(/(\d{3,7})\s?円/);
  if (en) return parseInt(en[1], 10);
  // 通貨記号が必須のモードでは、ここで諦める（誤検出を防ぐ）。
  if (requireCurrency) return null;
  // 通貨記号が無いときは、型番に紛れた数字を避けて独立した数字を拾う。
  // 直前が「英字・数字・ハイフン」でない3〜7桁だけを候補にする。
  const any = s.match(/(?:^|[^0-9A-Za-z-])(\d{3,7})(?![0-9])/);
  return any ? parseInt(any[1], 10) : null;
}

// 商品カードのテキストに「在庫切れ・売り切れ・販売終了」などの表示があるかを判定する。
// 仕入れ先ページで買えない（在庫切れ）商品を巡回結果に出さないための目印。
// 「予約」「再入荷」は“買える場合”もあり誤除外の元なので、あえて含めない。
const SOLD_OUT_RE =
  /在庫切れ|在庫なし|在庫が?無|売り切れ|売切れ|品切れ|完売|入荷未定|入荷待ち|販売終了|販売を終了|取扱終了|取り扱い終了|取扱いを終了|ご注文(いただけません|できません)|sold\s*out/i;
function isSoldOut(text) {
  if (!text) return false;
  return SOLD_OUT_RE.test(String(text));
}

// 仕入れ品を「新品として出してよいか」を判定する（中古は一切出さない方針）。
// 中古はAmazonの新品価格と差が大きく、実際には売れない“偽の利益”になるため、除外する。
//  - 商品名に「新品・未使用」があれば新品としてOK
//  - 「中古・ジャンク・美品」等のサインがあれば除外
//  - フリマ/オークション（ヤフオク・ラクマ・メルカリ等）は、
//    「新品・未使用」と明記された商品だけOK（無記載は中古の可能性が高いので除外）
//  - それ以外（通常の新品販売サイト）は新品としてOK
function isNewPurchasable(name, supplierName) {
  const s = String(name || "");
  const sup = String(supplierName || "");
  const saysNew = /新品|未使用/.test(s);
  const saysUsed = /中古|ジャンク|used|ユーズド|美品|良品|訳あり品|傷あり|ジャンク品/i.test(s);
  const fleaOrAuction = /ヤフオク|ラクマ|メルカリ|オークション|フリマ/.test(sup);

  if (saysUsed && !saysNew) return false; // 中古サイン → 除外
  if (saysNew) return true; // 新品・未使用の明記 → OK
  if (fleaOrAuction) return false; // フリマ/オークションで新品明記なし → 除外
  return true; // 通常の新品販売サイト → OK
}

function absUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base || undefined).toString();
  } catch {
    return "";
  }
}

// 商品ごとの個別リンクが取れなかったとき、トップページに飛ばすと使えないので、
// その商品名で「仕入れ先サイト内を検索」するURLを組み立てて、確実に商品へ辿れるようにする。
// 主要な仕入れ先は各社の検索URL形式に合わせ、未知のサイトは元URL（一覧ページ）へ。
function supplierSearchUrl(name, base, fallback) {
  const q = String(name || "").trim();
  if (!q) return fallback || base || "";
  const e = encodeURIComponent(q);
  let host = "";
  try {
    host = new URL(base || fallback || "").hostname.replace(/^www\./, "");
  } catch {
    return fallback || base || "";
  }
  if (host.includes("auctions.yahoo.co.jp"))
    return `https://auctions.yahoo.co.jp/search/search?p=${e}`;
  if (host.includes("yodobashi.com")) return `https://www.yodobashi.com/?word=${e}`;
  if (host.includes("biccamera.com"))
    return `https://www.biccamera.com/bc/category/?q=${e}`;
  if (host.includes("rakuten.co.jp"))
    return `https://search.rakuten.co.jp/search/mall/${e}/`;
  if (host.includes("yahoo.co.jp")) return `https://shopping.yahoo.co.jp/search?p=${e}`;
  if (host.includes("suruga-ya.jp"))
    return `https://www.suruga-ya.jp/search?search_word=${e}`;
  if (host.includes("amiami.jp"))
    return `https://www.amiami.jp/search/list/?s_keywords=${e}`;
  if (host.includes("7net.omni7.jp"))
    return `https://7net.omni7.jp/search/?keyword=${e}`;
  if (host.includes("netmall.hardoff.co.jp"))
    return `https://netmall.hardoff.co.jp/search/?keyword=${e}`;
  if (host.includes("edion.com"))
    return `https://www.edion.com/item_list.html?keyword=${e}`;
  if (host.includes("ksdenki.com"))
    return `https://www.ksdenki.com/shop/goods/search.aspx?search=x&keyword=${e}`;
  if (host.includes("fril.jp")) return `https://fril.jp/s?query=${e}`;
  // メルカリは「販売中」かつ「商品の状態＝新品・未使用(item_condition_id=1)」に限定して検索
  if (host.includes("mercari.com"))
    return `https://jp.mercari.com/search?keyword=${e}&status=on_sale&item_condition_id=1`;
  return fallback || base || "";
}

// 中継サービス(プロキシ)の設定があれば、それ経由の取得URLを組み立てる。
// SCRAPER_API_KEY が設定されていれば ScraperAPI 経由（住宅用IP＋日本地域＋
// 必要に応じてJS描画）でアクセスし、大手通販サイトのブロックを回避する。
// 未設定なら従来どおりサーバーから直接アクセスする。
// このドメインはJavaScriptで商品を描画するため、必ずJS描画付きで取得する。
// （通常サイトに描画を付けると中継サービスの消費が10〜25倍になるので、
//  本当に必要なサイトだけに限定する）
// Yahoo!ショッピングはページ内に商品データがJSONで埋め込まれているため、
// JS描画を使わずJSONを直接読む方が速く・安く・確実（下記 extractYahoo を使用）。
// メルカリはJavaScriptで商品を描画し、無料中継では空の枠しか返らないため、
// JS描画つきの有料中継が必須。ここに列挙したサイトだけJS描画を使う。
const RENDER_REQUIRED_HOSTS = ["jp.mercari.com", "mercari.com"];
// 有料中継(ScraperAPI)を使うサイト。ここに載っていないサイトは無料中継(Jina)を使い、
// 有料枠を消費しない（費用節約のため、本当に必要なサイトだけ有料中継に回す）。
const PROXY_REQUIRED_HOSTS = ["jp.mercari.com", "mercari.com"];

function hostMatches(url, list) {
  try {
    const host = new URL(url).hostname;
    return list.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

function needsRender(url) {
  if ((process.env.SCRAPER_RENDER || "").trim() === "1") return true;
  return hostMatches(url, RENDER_REQUIRED_HOSTS);
}

function needsProxy(url) {
  return hostMatches(url, PROXY_REQUIRED_HOSTS);
}

function buildFetchTarget(url) {
  const key = (process.env.SCRAPER_API_KEY || "").trim();
  if (!key) return { target: url, viaProxy: false };
  const params = new URLSearchParams({
    api_key: key,
    url,
    country_code: (process.env.SCRAPER_COUNTRY || "jp").trim(),
  });
  // JSで描画されるサイト（Yahoo等）向け。必要なサイトだけ自動でJS描画する。
  if (needsRender(url)) {
    params.set("render", "true");
  }
  return { target: `https://api.scraperapi.com/?${params.toString()}`, viaProxy: true };
}

// 鍵不要の無料中継サービス（Jina Reader）経由でページHTMLを取得する。
// 大手通販サイト（ヨドバシ・楽天など）はサーバーからの直接アクセスを403で
// ブロックするため、r.jina.ai を挟むことで住宅用に近いIP経由で取得できる。
// X-Return-Format: html を付けると、整形前の生HTMLがそのまま返るので、
// 既存のセレクタ抽出・自動検出がそのまま使える。
// JINA_API_KEY を設定すると混雑時の上限が緩和される（未設定でも無料で動く）。
async function fetchViaReader(url) {
  const key = (process.env.JINA_API_KEY || "").trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch("https://r.jina.ai/" + url, {
      headers: {
        "X-Return-Format": "html",
        "Accept-Language": "ja,en;q=0.8",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(
        `中継サービス(Reader)がページを取得できませんでした（HTTP ${res.status}）。`
      );
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 仕入れ先ページを取得する。
//  - 有料の中継サービス（SCRAPER_API_KEY）があれば従来どおりそれを使う。
//  - 無ければ「鍵不要の無料中継(Jina Reader)」を優先し、失敗時に直接アクセスも試す。
//    大手サイトの403（自動アクセス拒否）を無料で回避するため。
async function fetchHtml(url) {
  const hasKey = (process.env.SCRAPER_API_KEY || "").trim();
  // メルカリ等、無料中継では読めずJS描画が必須のサイトだけ有料中継を使う（費用節約）。
  if (hasKey && needsProxy(url)) {
    return fetchViaTarget(url);
  }
  try {
    return await fetchViaReader(url);
  } catch (_) {
    // 無料中継がダメなときの保険として直接アクセス（鍵があれば有料中継）も試す。
    return fetchViaTarget(url);
  }
}

// タイムアウト付きで再試行し、
// 接続そのものに失敗した場合は「fetch failed」ではなく分かりやすい日本語を返す。
async function fetchViaTarget(url) {
  const { target, viaProxy } = buildFetchTarget(url);
  const headers = {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    "Cache-Control": "no-cache",
  };
  // プロキシ（特にJS描画）は時間がかかるためタイムアウトを長めに取る
  const timeoutMs = viaProxy ? 70000 : 20000;
  // JS描画は中継サービス側で一時的に500等を返すことがあるので、
  // プロキシ経由のときは再試行回数を増やして取りこぼしを防ぐ。
  const maxAttempts = viaProxy ? 4 : 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 一時的なエラー（混雑429・サーバー側500系）は再試行する。
        // 特にJS描画は成功と失敗が交互に起きやすい。
        const transient = res.status === 429 || res.status >= 500;
        if (transient && attempt < maxAttempts - 1) {
          await sleep(1500);
          continue;
        }
        throw new Error(
          `仕入れ先ページの取得に失敗しました（HTTP ${res.status}）。URLが正しいか、サイトがアクセスを制限していないかご確認ください。`
        );
      }
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      // 恒久的なHTTPエラー（上で再試行しても直らなかったもの）は即中断
      if (e && e.message && e.message.includes("HTTP")) throw e;
      await sleep(800);
    }
  }

  if (viaProxy) {
    throw new Error(
      "中継サービス経由でも仕入れ先ページに接続できませんでした。URLが正しいか、中継サービスの残量・設定をご確認ください。"
    );
  }
  throw new Error(
    "仕入れ先ページに接続できませんでした。サイト側がサーバーからのアクセスを拒否している可能性があります（楽天・Yahoo・あみあみ等の一部サイトは自動巡回をブロックします）。設定画面で中継サービスを有効にすると回避できます。"
  );
}

// セレクタ指定モードで商品を抜き出す
function extractBySelector($, url, supplier) {
  const items = [];
  $(supplier.selector_item).each((_, el) => {
    const $el = $(el);
    // 在庫切れ・売り切れ表示のある商品は、買えないので除外する。
    if (isSoldOut($el.text())) return;
    const name = supplier.selector_name
      ? $el.find(supplier.selector_name).first().text().trim()
      : $el.text().trim().slice(0, 80);
    const priceText = supplier.selector_price
      ? $el.find(supplier.selector_price).first().text()
      : $el.text();
    const price = pickPrice(priceText);

    const linkSel = supplier.selector_link || "a";
    const href = $el.find(linkSel).first().attr("href") || "";
    const imgSel = supplier.selector_image || "img";
    const imgSrc =
      $el.find(imgSel).first().attr("src") ||
      $el.find(imgSel).first().attr("data-src") ||
      "";

    const janText = supplier.selector_jan
      ? $el.find(supplier.selector_jan).first().text()
      : $el.text();
    const jan = extractJan(janText, $.html($el));

    if (!name || !price) return;
    items.push({
      name: name.slice(0, 120),
      price,
      jan,
      link: absUrl(href, supplier.base_url || url),
      image: absUrl(imgSrc, supplier.base_url || url),
    });
  });
  return items;
}

// 汎用自動検出モード（サイト共通で価格＋商品名を拾う）
function extractGeneric($, url) {
  const items = [];
  const seen = new Set();
  const containers = $(
    "li, article, .item, .product, div[class*='item' i], div[class*='product' i], tr"
  );
  containers.each((_, el) => {
    const $el = $(el);
    const fullText = $el.text().trim();
    if (!fullText || fullText.length > 1200) return;

    // 在庫切れ・売り切れ表示のある商品は、買えないので巡回結果に出さない。
    if (isSoldOut(fullText)) return;

    // 自動検出は商品名・説明文ごとまとめて読むため、数量（300粒・100日分等）を
    // 値段と誤認しないよう、通貨記号（¥/円）付きの金額だけを価格として採用する。
    const price = pickPrice(fullText, true);
    if (!price) return;

    let name = "";
    const nameEl = $el.find("h1, h2, h3, h4, a, .title, .name").first();
    if (nameEl && nameEl.length) name = nameEl.text().trim();
    if (!name) name = fullText;
    name = name.replace(/\s+/g, " ").slice(0, 80);
    if (!name) return;

    const key = `${name}__${price}`;
    if (seen.has(key)) return;
    seen.add(key);

    const href = $el.find("a").first().attr("href") || "";
    const imgSrc =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src") ||
      "";
    const jan = extractJan(fullText, $.html($el));

    items.push({
      name,
      price,
      jan,
      link: absUrl(href, url),
      image: absUrl(imgSrc, url),
    });
  });
  return items;
}

// Yahoo!ショッピングは検索結果の商品データをページ内のJSON
// (__NEXT_DATA__) に丸ごと持っている。JS描画（不安定・高コスト）を使わず、
// このJSONを読むことで確実に商品一覧を取り出す。
function extractYahoo($, url) {
  const raw = $("#__NEXT_DATA__").first().html();
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = [];
  const seen = new Set();
  const visit = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      o.forEach(visit);
      return;
    }
    const name = o.name;
    const price = o.price;
    const link = o.url;
    if (
      typeof name === "string" &&
      name &&
      typeof price === "number" &&
      price > 0 &&
      typeof link === "string" &&
      link.startsWith("http")
    ) {
      const dedup = o.itemId || link;
      if (!seen.has(dedup)) {
        seen.add(dedup);
        const image =
          typeof o.image === "string"
            ? o.image
            : o.image && typeof o.image.raw === "string"
            ? o.image.raw
            : "";
        items.push({
          name: String(name).slice(0, 120),
          price: Math.round(price),
          jan: extractJan(name, ""),
          link: absUrl(link, url),
          image: absUrl(image, url),
        });
      }
    }
    for (const k of Object.keys(o)) visit(o[k]);
  };
  visit(data);
  return items;
}

// 楽天市場（search.rakuten.co.jp）は商品カードのクラス名が頻繁に変わり、
// 目印(セレクタ)がすぐ古くなる。そこで「商品ページ(item.rakuten.co.jp)への
// リンク」を起点に、そのリンク文言を商品名、近くの金額を価格として拾う。
// クラス名に依存しないため、サイト改装に強い。
function extractRakuten($, url) {
  const items = [];
  const seen = new Set();
  // 楽天は「500円OFFクーポン」「ポイント10倍」「200ポイント還元」など、
  // 商品価格ではない金額がカード内に並ぶ。これらを先に取り除いてから、
  // 残ったテキストの最初の妥当な金額を“本当の商品価格”として拾う。
  const pick = (t) => {
    if (!t) return null;
    let s = String(t).replace(/,/g, "");
    s = s
      .replace(/\d+\s*円?\s*OFF/gi, " ")
      .replace(/\d+\s*円?\s*引き?クーポン/g, " ")
      .replace(/\d+\s*円\s*クーポン/g, " ")
      .replace(/クーポン/g, " ")
      .replace(/\d+\s*(ポイント|pt)\b/gi, " ")
      .replace(/ポイント\s*\d+/g, " ")
      .replace(/P\s?\d+/g, " ")
      .replace(/送料\s*\d+/g, " ")
      .replace(/\d+\s*倍/g, " ")
      .replace(/\d+(\.\d+)?\s*[%％]/g, " ");
    const ms = [...s.matchAll(/[¥￥]\s?(\d{3,6})|(\d{3,6})\s?円/g)]
      .map((m) => parseInt(m[1] || m[2], 10))
      .filter((n) => n >= 200);
    return ms.length ? ms[0] : null;
  };
  $('a[href*="item.rakuten.co.jp"]').each((_, a) => {
    const $a = $(a);
    const name = $a.text().trim().replace(/\s+/g, " ");
    if (!name || name.length < 8) return;
    // 「もっと見る」「お気に入りに登録」などの画面パーツ文言を商品名として拾わない。
    if (/もっと見る|お気に入り|レビュー|ランキングを見る|絞り込み/.test(name)) return;
    const href = $a.attr("href") || "";
    if (seen.has(href)) return;

    // リンクの親を少したどり、テキスト量が多すぎない範囲で最初の金額を価格にする。
    let price = null;
    let $p = $a;
    for (let i = 0; i < 6 && $p.length; i++) {
      const txt = $p.text();
      if (txt.length < 700) {
        const p = pick(txt);
        if (p) {
          price = p;
          break;
        }
      }
      $p = $p.parent();
    }
    if (!price) return;
    // 在庫切れ・売り切れ表示のある商品は、買えないので除外する。
    if (isSoldOut($p.text())) return;
    seen.add(href);

    const imgSrc =
      $a.find("img").first().attr("src") ||
      $a.find("img").first().attr("data-src") ||
      $p.find("img").first().attr("src") ||
      "";
    items.push({
      name: name.slice(0, 120),
      price,
      jan: extractJan(name, ""),
      link: absUrl(href, url),
      image: absUrl(imgSrc, url),
    });
  });
  return items;
}

// メルカリ専用の抽出。検索URLで item_condition_id=1（新品・未使用）に限定しているため、
// 取れた商品は「新品・未使用」として扱う（forceNew=true）。
// 商品名は thumbnail-item-name、円価格は aria-label「◯◯の画像 1,800円 US$…」から拾う。
function extractMercari($, url) {
  const items = [];
  const seen = new Set();
  $('li[data-testid="item-cell"]').each((_, li) => {
    const $li = $(li);
    const $a = $li.find('a[href^="/item/"]').first();
    const href = $a.attr("href") || "";
    if (!href || seen.has(href)) return;
    const $thumb = $li.find('[aria-label*="の画像"]').first();
    const aria = $thumb.attr("aria-label") || "";
    let name = $li.find('[data-testid="thumbnail-item-name"]').first().text().trim();
    if (!name) {
      const m = aria.match(/^(.*?)の画像/);
      if (m) name = m[1].trim();
    }
    if (!name || name.length < 4) return;
    // 円価格を aria-label から取得（US$表記ではなく円を使う）。
    let price = null;
    const pm = aria.match(/([0-9,]+)\s*円/);
    if (pm) price = parseInt(pm[1].replace(/,/g, ""), 10);
    if (!price || price < 100) return;
    // 売り切れ（SOLD）表示は除外（status=on_sale でほぼ入らないが念のため）。
    if (isSoldOut($li.text())) return;
    seen.add(href);
    const imgSrc =
      $li.find("img").first().attr("src") ||
      $li.find("img").first().attr("data-src") ||
      "";
    items.push({
      name: name.slice(0, 120),
      price,
      jan: extractJan(name, ""),
      link: absUrl(href, url),
      image: imgSrc,
      forceNew: true,
    });
  });
  return items;
}

export async function extractItems(url, supplier) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Yahoo!ショッピングは埋め込みJSONを優先的に読む（最も確実）。
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (host === "shopping.yahoo.co.jp" || host.endsWith(".shopping.yahoo.co.jp")) {
    const yahoo = extractYahoo($, url);
    if (yahoo.length > 0) return yahoo;
  }
  // 楽天市場は専用抽出（商品リンク起点）を優先する。
  if (host === "search.rakuten.co.jp" || host.endsWith(".rakuten.co.jp")) {
    const rk = extractRakuten($, url);
    if (rk.length > 0) return rk;
  }
  // メルカリは専用抽出（新品・未使用に限定して読む）。
  if (host === "jp.mercari.com" || host.endsWith(".mercari.com")) {
    const mc = extractMercari($, url);
    if (mc.length > 0) return mc;
  }

  let items = [];
  if (supplier && supplier.selector_item) {
    items = extractBySelector($, url, supplier);
  }
  // 目印(セレクタ)で1件も取れなかった場合は、自動検出に自動で切り替える。
  // サイトの作りが変わっても商品が取れるようにするための保険。
  if (items.length === 0) {
    items = extractGeneric($, url);
  }
  return items;
}

export async function runTask(taskId) {
  const task = await get(
    `SELECT t.*, s.name AS supplier_name, s.base_url,
            s.selector_item, s.selector_name, s.selector_price,
            s.selector_jan, s.selector_link, s.selector_image
     FROM tasks t LEFT JOIN suppliers s ON s.id = t.supplier_id
     WHERE t.id = ?`,
    [taskId]
  );

  if (!task) {
    return { extracted: 0, matched: 0, notified: 0, errors: ["タスクが見つかりません。"] };
  }

  const supplier = {
    name: task.supplier_name,
    base_url: task.base_url,
    selector_item: task.selector_item,
    selector_name: task.selector_name,
    selector_price: task.selector_price,
    selector_jan: task.selector_jan,
    selector_link: task.selector_link,
    selector_image: task.selector_image,
  };

  const errors = [];
  let extracted = [];
  try {
    extracted = await extractItems(task.url, supplier);
  } catch (e) {
    errors.push(e.message || String(e));
    return { extracted: 0, matched: 0, notified: 0, errors };
  }

  // 仕入れ先ページにバーコードが無くても、商品名でAmazon検索して照合する。
  // トークン消費を抑えるため、1回の巡回で照合する上限を設ける。
  // ※ Vercelは1回の処理が60秒で強制終了されるため、上限を控えめにし、
  //   さらに下の「経過時間の見張り」で時間切れ前に安全に打ち切る。
  const MAX_LOOKUPS = 24;
  const candidates = extracted.filter((it) => it.name && it.price).slice(0, MAX_LOOKUPS);
  let matched = 0;
  let notified = 0;
  const newItems = [];

  // 【テストプレイ中】プランに関係なく常に「プロ（無制限）」で巡回する。
  // 見つかった利益商品はすべて表示し、途中で打ち切らない。
  // （課金運用を始めるときは normalizePlan(await getSetting("plan")) に戻す）
  const plan = normalizePlan("pro");
  const maxDeals = dealLimit(plan);
  let dealCount = 0;
  // 同じ商品（同一ASIN）が仕入れ先ページに複数回出てくることがあるため、
  // 巡回結果に同じ商品を重複表示しないよう、一度出したASINは記録しておく。
  const seenAsin = new Set();

  const NOTIF_SQL = `INSERT OR IGNORE INTO notifications
      (task_id, supplier_name, product_name, amazon_title, condition, jan, asin, buy_price, amazon_price,
       fees, profit, profit_rate, monthly_sales, source_url, product_url, image_url, match_type,
       match_status, attribute_conflicts, avg_price_90, price_risk_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // 巡回結果（利益条件を満たさない商品も含む、Amazonと照合できた全商品）を保存する。
  // いつでも見返して商品ページURLから買えるように、この一覧を残す。
  // amazon_title＝照合した相手の商品名。誤マッチの後追い検証（バックテスト）に必須。
  const FINDING_SQL = `INSERT INTO findings
      (task_id, supplier_name, product_name, amazon_title, condition, jan, asin, buy_price, amazon_price,
       fees, profit, profit_rate, monthly_sales, source_url, product_url, image_url, match_type,
       match_status, attribute_conflicts, avg_price_90, price_risk_score, is_deal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // row（オブジェクト）を上記SQLの「?」の順番どおりの配列に並べ替える。
  const rowArgs = (r) => [
    r.task_id,
    r.supplier_name,
    r.product_name,
    r.amazon_title || null,
    r.condition || "新品",
    r.jan,
    r.asin,
    r.buy_price,
    r.amazon_price,
    r.fees,
    r.profit,
    r.profit_rate,
    r.monthly_sales,
    r.source_url,
    r.product_url,
    r.image_url,
    r.match_type || null,
    r.match_status || null,
    r.attribute_conflicts || null,
    r.avg_price_90 != null ? r.avg_price_90 : null,
    r.price_risk_score != null ? r.price_risk_score : null,
  ];

  // 最新の巡回結果だけを見せるため、このタスクの前回結果は消してから入れ直す。
  await run("DELETE FROM findings WHERE task_id = ?", [task.id]);

  // Vercelは60秒で処理を強制終了する。その手前（約48秒）で自動的に照合を打ち切り、
  // それまでに見つかった利益商品はきちんと保存・表示する（504で全部失う事故を防ぐ）。
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 38000;
  let timedOut = false;

  for (const it of candidates) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }
    let info;
    try {
      info = await lookupProduct(it); // JANがあればJAN優先、無ければ商品名で検索
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes("APIキー")) {
        errors.push(msg);
        break; // キー未設定は即中断
      }
      // Keepaの利用量オーバー（429）は、続けても無駄なので即中断。
      // 同じエラーを何十行も出さず、分かりやすい説明を1つだけ残す。
      if (msg.includes("429")) {
        errors.push(
          "Amazon照合サービス（Keepa）の短時間の利用上限に達しました。しばらく時間をおいてから再度お試しください（無料プランは1分あたりの照合数に上限があります）。"
        );
        break;
      }
      errors.push(msg);
      await sleep(1100);
      continue;
    }

    await sleep(700); // トークン節約（時間内に多く照合できるよう短縮）

    if (!info) continue;

    // 新品だけを出す方針。中古（または新品と確認できない商品）は除外する。
    if (!it.forceNew && !isNewPurchasable(it.name, task.supplier_name)) continue;
    // ★利益判定はAmazon本体価格ではなく「保守的販売想定価格」を使う（第4フェーズ実測で統一）。
    //   ＝Marketplace New価格と30日平均の低い方。無ければ自動仕入れ対象外としてスキップ。
    const salePrice = info.conservativeSalePrice;
    if (!salePrice) continue;
    const condLabel = "新品";
    matched++;

    const verdict = await judge(task, it.price, salePrice, info.monthlySales, {
      referralRate: info.keepaReferralRate,
      fbaFee: info.keepaFbaFee,
    });

    // 商品ごとの個別リンクが取れていればそれを使う。
    // 取れていない（＝トップページや一覧URLしか無い）場合は、
    // その商品名で仕入れ先サイト内を検索するURLに切り替えて、確実に商品へ辿れるようにする。
    const hasProductLink =
      it.link && it.link !== task.url && it.link !== supplier.base_url;
    const sourceUrl = hasProductLink
      ? it.link
      : supplierSearchUrl(it.name, supplier.base_url, task.url);

    const row = {
      task_id: task.id,
      supplier_name: task.supplier_name || "",
      product_name: it.name,
      amazon_title: info.title || null,
      condition: condLabel,
      jan: it.jan,
      asin: info.asin,
      buy_price: it.price,
      amazon_price: salePrice,
      fees: verdict.fees,
      profit: verdict.profit,
      profit_rate: verdict.rate,
      monthly_sales: info.monthlySales,
      source_url: sourceUrl,
      product_url: info.productUrl,
      image_url: info.imageUrl || it.image || "",
      match_type: info.matchedBy || null,
      match_status: info.matchStatus || null,
      attribute_conflicts:
        info.matchConflicts && info.matchConflicts.length
          ? info.matchConflicts.join(",")
          : null,
      avg_price_90: info.avg90 != null ? info.avg90 : null,
      price_risk_score: info.priceRiskScore != null ? info.priceRiskScore : null,
    };

    // 利益が出る商品だけを巡回結果として記録する（マイナスの商品は表示しない）。
    if (!verdict.ok) continue;
    // 月間販売数が0（＝ここ最近売れていない）商品は、仕入れても売れ残るので出さない。
    if (!info.monthlySales || info.monthlySales < 1) continue;
    // 同じ商品（ASIN）が複数出てきても、巡回結果には1回だけ表示する。
    if (info.asin && seenAsin.has(info.asin)) continue;
    if (info.asin) seenAsin.add(info.asin);

    // 画像を必ず出すため、確実なAmazon画像を最優先で用意する。
    let imageUrl = info.imageUrl || "";
    if (!imageUrl && info.asin) {
      try {
        const img = await fetchImageByAsin(info.asin);
        if (img) imageUrl = img;
      } catch (_) {}
    }
    if (!imageUrl) imageUrl = it.image || "";
    if (!imageUrl && info.asin) {
      imageUrl = `https://images-na.ssl-images-amazon.com/images/P/${info.asin}.09._SCLZZZZZZZ_.jpg`;
    }
    row.image_url = imageUrl;

    await run(FINDING_SQL, [...rowArgs(row), 1]);

    // 通知（メール＝“買っていい”という積極的なお知らせ）は、
    // JAN／型番で確認できた「確実な一致」だけに限定する。
    // 名前だけの一致は別商品を掴む恐れがあるため、結果一覧には残す（赤い注意付き）が、
    // 自動でメール通知はしない＝誤って仕入れて赤字になる事故を防ぐ。
    const reliable = row.match_type === "jan" || row.match_type === "model";
    if (reliable) {
      const result = await run(NOTIF_SQL, rowArgs(row));
      if (result.changes > 0) {
        notified++;
        newItems.push(row);
      }
    }

    // プランの上限（利益商品の件数）に達したら、その巡回を終了する。
    dealCount++;
    if (dealCount >= maxDeals) break;
  }

  if (timedOut) {
    errors.push(
      "時間制限（60秒）に達したため、途中まで照合して終了しました。ここまでに見つかった利益商品は保存済みです。商品数が多いページは、もう一度「今すぐ巡回」を押すか、より絞り込んだ検索ページのURLをご利用ください。"
    );
  }

  await run("UPDATE tasks SET last_run = datetime('now') WHERE id = ?", [task.id]);

  if (newItems.length > 0) {
    try {
      await sendNotificationEmail(task.name, newItems);
    } catch (e) {
      errors.push("メール送信に失敗: " + (e.message || String(e)));
    }
  }

  return { extracted: extracted.length, matched, notified, errors };
}

// ===== バッチ（分割）巡回 =====
// Vercelは1回の処理が60秒で強制終了される。そこで巡回を「開始」と「続き」に分け、
// フロントから「続き」を繰り返し呼ぶことで、60秒制限を超えずにページ全体を最後まで探す。
// （＝実質的に件数の縛りなし）

const JOB_NOTIF_SQL = `INSERT OR IGNORE INTO notifications
    (task_id, supplier_name, product_name, amazon_title, condition, jan, asin, buy_price, amazon_price,
     fees, profit, profit_rate, monthly_sales, source_url, product_url, image_url, match_type,
     match_status, attribute_conflicts, avg_price_90, price_risk_score)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const JOB_FINDING_SQL = `INSERT INTO findings
    (task_id, supplier_name, product_name, amazon_title, condition, jan, asin, buy_price, amazon_price,
     fees, profit, profit_rate, monthly_sales, source_url, product_url, image_url, match_type,
     match_status, attribute_conflicts, avg_price_90, price_risk_score, is_deal)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const jobRowArgs = (r) => [
  r.task_id,
  r.supplier_name,
  r.product_name,
  r.amazon_title || "",
  r.condition || "新品",
  r.jan,
  r.asin,
  r.buy_price,
  r.amazon_price,
  r.fees,
  r.profit,
  r.profit_rate,
  r.monthly_sales,
  r.source_url,
  r.product_url,
  r.image_url,
  r.match_type || null,
  r.match_status || null,
  r.attribute_conflicts || null,
  r.avg_price_90 != null ? r.avg_price_90 : null,
  r.price_risk_score != null ? r.price_risk_score : null,
];

async function loadTaskWithSupplier(taskId) {
  return get(
    `SELECT t.*, s.name AS supplier_name, s.base_url,
            s.selector_item, s.selector_name, s.selector_price,
            s.selector_jan, s.selector_link, s.selector_image
     FROM tasks t LEFT JOIN suppliers s ON s.id = t.supplier_id
     WHERE t.id = ?`,
    [taskId]
  );
}

// 巡回を開始する：ページを取得して商品を抽出し、進捗ジョブを作る。前回結果は消す。
export async function startCrawlJob(taskId) {
  const task = await loadTaskWithSupplier(taskId);
  if (!task) return { error: "タスクが見つかりません。" };

  const supplier = {
    name: task.supplier_name,
    base_url: task.base_url,
    selector_item: task.selector_item,
    selector_name: task.selector_name,
    selector_price: task.selector_price,
    selector_jan: task.selector_jan,
    selector_link: task.selector_link,
    selector_image: task.selector_image,
  };

  let extracted = [];
  try {
    extracted = await extractItems(task.url, supplier);
  } catch (e) {
    return { error: e.message || String(e) };
  }

  // 分割して照合するので、上限は大きめ（ページ全体を探せるように）。
  const MAX_LOOKUPS = 120;
  const candidates = extracted
    .filter((it) => it.name && it.price)
    .slice(0, MAX_LOOKUPS);

  // 前回の結果と古いジョブを片付ける。
  await run("DELETE FROM findings WHERE task_id = ?", [task.id]);
  await run("DELETE FROM crawl_jobs WHERE task_id = ?", [task.id]);

  const info = await run(
    `INSERT INTO crawl_jobs
      (task_id, items_json, cursor, extracted, matched, notified, errors_json, status)
     VALUES (?, ?, 0, ?, 0, 0, '[]', 'running')`,
    [task.id, JSON.stringify(candidates), extracted.length]
  );

  return {
    jobId: info.lastId,
    total: candidates.length,
    extracted: extracted.length,
  };
}

// 巡回の続きを進める：時間内（約45秒）だけ照合し、途中で必ず返す。
// フロントは done になるまでこれを繰り返し呼ぶ。
export async function stepCrawlJob(jobId) {
  const job = await get("SELECT * FROM crawl_jobs WHERE id = ?", [jobId]);
  if (!job) return { error: "巡回ジョブが見つかりません。もう一度巡回してください。" };

  const total0 = (() => {
    try {
      return JSON.parse(job.items_json || "[]").length;
    } catch {
      return 0;
    }
  })();

  if (job.status === "done") {
    return {
      done: true,
      cursor: job.cursor,
      total: total0,
      matched: job.matched,
      notified: job.notified,
      extracted: job.extracted,
      errors: safeParse(job.errors_json),
      newDeals: [],
    };
  }

  const task = await loadTaskWithSupplier(job.task_id);
  if (!task) return { error: "タスクが見つかりません。" };

  const candidates = safeParse(job.items_json);
  let cursor = job.cursor || 0;
  let matched = job.matched || 0;
  let notified = job.notified || 0;
  const errors = safeParse(job.errors_json);

  // 重複ASINの除外は、これまでに保存済みの結果から復元する。
  const existing = await all(
    "SELECT asin FROM findings WHERE task_id = ?",
    [job.task_id]
  );
  const seenAsin = new Set(existing.map((r) => r.asin).filter(Boolean));

  const startedAt = Date.now();
  const BATCH_BUDGET_MS = 45000;
  const newDeals = [];
  let stopReason = null;
  let timeouts = 0;

  while (cursor < candidates.length) {
    if (Date.now() - startedAt > BATCH_BUDGET_MS) break;
    const it = candidates[cursor];
    cursor++;

    let infoP;
    try {
      infoP = await lookupProduct(it);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes("APIキー")) {
        errors.push(msg);
        stopReason = "key";
        break;
      }
      if (msg.includes("429")) {
        errors.push(
          "Amazon照合サービス（Keepa）の短時間の利用上限に達しました。しばらく時間をおいてから再度お試しください。"
        );
        stopReason = "429";
        break;
      }
      if (msg.includes("タイムアウト")) {
        // Keepaのトークン不足時は応答が遅くなり、タイムアウトが連発する。
        // 数回続いたら、これ以上調べても無駄なので中断してユーザーに分かりやすく伝える。
        timeouts++;
        if (timeouts >= 4) {
          errors.push(
            "Amazon照合サービス（Keepa）の応答が遅く、今調べられる回数（トークン）が不足しているようです。10〜30分ほど時間をおくか、ジャンルで絞って件数を減らしてから再度お試しください。"
          );
          stopReason = "timeout";
          break;
        }
        continue;
      }
      errors.push(msg);
      continue;
    }

    await sleep(700);
    if (!infoP) continue;

    // 新品だけを出す方針。中古（または新品と確認できない商品）は除外する。
    if (!it.forceNew && !isNewPurchasable(it.name, task.supplier_name)) continue;
    // ★利益判定は「保守的販売想定価格」で比較する（Marketplace Newと30日平均の低い方）。
    //   Amazon本体価格は主価格にしない。保守価格が無ければ自動仕入れ対象外としてスキップ。
    const salePrice = infoP.conservativeSalePrice;
    if (!salePrice) continue;
    const condLabel = "新品";
    matched++;

    const verdict = await judge(task, it.price, salePrice, infoP.monthlySales, {
      referralRate: infoP.keepaReferralRate,
      fbaFee: infoP.keepaFbaFee,
    });
    const hasProductLink =
      it.link && it.link !== task.url && it.link !== task.base_url;
    const sourceUrl = hasProductLink
      ? it.link
      : supplierSearchUrl(it.name, task.base_url, task.url);

    const row = {
      task_id: task.id,
      supplier_name: task.supplier_name || "",
      product_name: it.name,
      amazon_title: infoP.title || "",
      condition: condLabel,
      jan: it.jan,
      asin: infoP.asin,
      buy_price: it.price,
      amazon_price: salePrice,
      fees: verdict.fees,
      profit: verdict.profit,
      profit_rate: verdict.rate,
      monthly_sales: infoP.monthlySales,
      source_url: sourceUrl,
      product_url: infoP.productUrl,
      image_url: infoP.imageUrl || it.image || "",
      match_type: infoP.matchedBy || null,
      match_status: infoP.matchStatus || null,
      attribute_conflicts:
        infoP.matchConflicts && infoP.matchConflicts.length
          ? infoP.matchConflicts.join(",")
          : null,
      avg_price_90: infoP.avg90 != null ? infoP.avg90 : null,
      price_risk_score: infoP.priceRiskScore != null ? infoP.priceRiskScore : null,
    };

    if (!verdict.ok) continue;
    // 月間販売数が0（＝ここ最近売れていない）商品は、仕入れても売れ残るので出さない。
    if (!infoP.monthlySales || infoP.monthlySales < 1) continue;
    if (infoP.asin && seenAsin.has(infoP.asin)) continue;
    if (infoP.asin) seenAsin.add(infoP.asin);

    // 画像を必ず出すため、確実なAmazon画像を最優先で用意する。
    // 仕入れ先の画像は「準備中」等のダミーが混じるので、Amazon画像を先に使う。
    //   ① Keepaが返した画像 → ② ASINからAmazon画像を取り直し
    //   → ③ 仕入れ先の画像 → ④ 予備のAmazon画像URL
    let imageUrl = infoP.imageUrl || "";
    if (!imageUrl && infoP.asin) {
      try {
        const img = await fetchImageByAsin(infoP.asin);
        if (img) imageUrl = img;
      } catch (_) {
        // タイムアウト等は無視して、下のフォールバックに任せる
      }
    }
    if (!imageUrl) imageUrl = it.image || "";
    if (!imageUrl && infoP.asin) {
      imageUrl = `https://images-na.ssl-images-amazon.com/images/P/${infoP.asin}.09._SCLZZZZZZZ_.jpg`;
    }
    row.image_url = imageUrl;

    await run(JOB_FINDING_SQL, [...jobRowArgs(row), 1]);
    // 通知（メール）は JAN／型番で確認できた確実な一致だけに限定する。
    // 名前だけの一致は結果一覧に残す（赤い注意付き）が、自動メールはしない。
    const reliable = row.match_type === "jan" || row.match_type === "model";
    if (reliable) {
      const result = await run(JOB_NOTIF_SQL, jobRowArgs(row));
      if (result.changes > 0) {
        notified++;
        newDeals.push(row);
      }
    }
  }

  // キー未設定・利用上限・タイムアウト連発のときは、これ以上進めても無駄なので終了扱いにする。
  const done =
    cursor >= candidates.length ||
    stopReason === "key" ||
    stopReason === "429" ||
    stopReason === "timeout";

  // 同じ内容のエラーが何度も並ぶと画面が見づらいので、重複を除いて1行にまとめる。
  const uniqueErrors = [...new Set(errors)];

  await run(
    "UPDATE crawl_jobs SET cursor = ?, matched = ?, notified = ?, errors_json = ?, status = ? WHERE id = ?",
    [cursor, matched, notified, JSON.stringify(uniqueErrors), done ? "done" : "running", jobId]
  );

  if (done) {
    await run("UPDATE tasks SET last_run = datetime('now') WHERE id = ?", [job.task_id]);
    // 完了時に、見つかった利益商品をまとめてメール通知（設定があれば）。
    try {
      const deals = await all(
        "SELECT * FROM findings WHERE task_id = ? AND is_deal = 1 ORDER BY profit DESC",
        [job.task_id]
      );
      if (deals.length > 0) await sendNotificationEmail(task.name, deals);
    } catch (e) {
      uniqueErrors.push("メール送信に失敗: " + (e.message || String(e)));
    }
  }

  return {
    done,
    cursor,
    total: candidates.length,
    matched,
    notified,
    extracted: job.extracted,
    errors: uniqueErrors,
    newDeals,
  };
}

function safeParse(s) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}

export async function runAllTasks(options = {}) {
  // skipPaid: true のとき、有料読み取り（ScraperAPI）が必要なメルカリ等の
  // タスクを巡回対象から除外する。自動の毎時巡回で無料枠を温存するため。
  const { skipPaid = false } = options;
  const tasks = await all("SELECT id, name, url FROM tasks WHERE enabled = 1");
  const summary = [];
  for (const t of tasks) {
    if (skipPaid && needsProxy(t.url)) {
      summary.push({ taskId: t.id, name: t.name, skipped: true, reason: "paid-source" });
      continue;
    }
    const r = await runTask(t.id);
    summary.push({ taskId: t.id, name: t.name, ...r });
  }
  return summary;
}
