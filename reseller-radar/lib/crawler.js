import * as cheerio from "cheerio";
import { getDb } from "./db.js";
import { lookupProduct, judge } from "./amazon.js";
import { sendNotificationEmail } from "./notify.js";

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
// ¥／￥／円 の付いた金額を最優先し、無ければ最初の3〜7桁を採用。
// 「品切れ」など数字が無ければ null（＝仕入れ対象外として除外）。
function pickPrice(text) {
  if (!text) return null;
  const s = String(text).replace(/,/g, "");
  // ¥1980 / ￥1980（半角¥ U+00A5 / 全角￥ U+FFE5）
  const yen = s.match(/[¥￥]\s?(\d{3,7})/);
  if (yen) return parseInt(yen[1], 10);
  // 1980円
  const en = s.match(/(\d{3,7})\s?円/);
  if (en) return parseInt(en[1], 10);
  // それ以外は最初の3〜7桁
  const any = s.match(/(\d{3,7})/);
  return any ? parseInt(any[1], 10) : null;
}

function absUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base || undefined).toString();
  } catch {
    return "";
  }
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
const RENDER_REQUIRED_HOSTS = [];

function needsRender(url) {
  if ((process.env.SCRAPER_RENDER || "").trim() === "1") return true;
  try {
    const host = new URL(url).hostname;
    return RENDER_REQUIRED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
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

// 仕入れ先ページを取得する。タイムアウト付きで再試行し、
// 接続そのものに失敗した場合は「fetch failed」ではなく分かりやすい日本語を返す。
async function fetchHtml(url) {
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

    const price = pickPrice(fullText);
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
  const db = getDb();
  const task = db
    .prepare(
      `SELECT t.*, s.name AS supplier_name, s.base_url,
              s.selector_item, s.selector_name, s.selector_price,
              s.selector_jan, s.selector_link, s.selector_image
       FROM tasks t LEFT JOIN suppliers s ON s.id = t.supplier_id
       WHERE t.id = ?`
    )
    .get(taskId);

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
  const MAX_LOOKUPS = 40;
  const candidates = extracted.filter((it) => it.name && it.price).slice(0, MAX_LOOKUPS);
  let matched = 0;
  let notified = 0;
  const newItems = [];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO notifications
      (task_id, supplier_name, product_name, jan, asin, buy_price, amazon_price,
       fees, profit, profit_rate, monthly_sales, source_url, product_url, image_url)
    VALUES
      (@task_id, @supplier_name, @product_name, @jan, @asin, @buy_price, @amazon_price,
       @fees, @profit, @profit_rate, @monthly_sales, @source_url, @product_url, @image_url)
  `);

  for (const it of candidates) {
    let info;
    try {
      info = await lookupProduct(it); // JANがあればJAN優先、無ければ商品名で検索
    } catch (e) {
      const msg = e.message || String(e);
      errors.push(msg);
      if (msg.includes("APIキー")) break; // キー未設定は即中断
      await sleep(1100);
      continue;
    }

    await sleep(1100); // トークン節約

    if (!info || !info.price) continue;
    matched++;

    const verdict = judge(task, it.price, info.price, info.monthlySales);
    if (!verdict.ok) continue;

    const row = {
      task_id: task.id,
      supplier_name: task.supplier_name || "",
      product_name: it.name,
      jan: it.jan,
      asin: info.asin,
      buy_price: it.price,
      amazon_price: info.price,
      fees: verdict.fees,
      profit: verdict.profit,
      profit_rate: verdict.rate,
      monthly_sales: info.monthlySales,
      source_url: it.link || task.url,
      product_url: info.productUrl,
      image_url: info.imageUrl || it.image || "",
    };
    const result = insert.run(row);
    if (result.changes > 0) {
      notified++;
      newItems.push(row);
    }
  }

  db.prepare("UPDATE tasks SET last_run = datetime('now') WHERE id = ?").run(task.id);

  if (newItems.length > 0) {
    try {
      await sendNotificationEmail(task.name, newItems);
    } catch (e) {
      errors.push("メール送信に失敗: " + (e.message || String(e)));
    }
  }

  return { extracted: extracted.length, matched, notified, errors };
}

export async function runAllTasks() {
  const db = getDb();
  const tasks = db.prepare("SELECT id, name FROM tasks WHERE enabled = 1").all();
  const summary = [];
  for (const t of tasks) {
    const r = await runTask(t.id);
    summary.push({ taskId: t.id, name: t.name, ...r });
  }
  return summary;
}
