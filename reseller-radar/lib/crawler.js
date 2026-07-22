import * as cheerio from "cheerio";
import { getDb } from "./db.js";
import { lookupByJan, judge } from "./amazon.js";
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

// 価格文字列を数値へ（カンマ除去、3〜7桁）
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/(\d{3,7})/);
  return m ? parseInt(m[1], 10) : null;
}

function absUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base || undefined).toString();
  } catch {
    return "";
  }
}

export async function extractItems(url, supplier) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ja" },
  });
  if (!res.ok) {
    throw new Error(`仕入れ先ページの取得に失敗しました（HTTP ${res.status}）。`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];

  if (supplier && supplier.selector_item) {
    // セレクタ指定モード
    $(supplier.selector_item).each((_, el) => {
      const $el = $(el);
      const name = supplier.selector_name
        ? $el.find(supplier.selector_name).first().text().trim()
        : $el.text().trim().slice(0, 80);
      const priceText = supplier.selector_price
        ? $el.find(supplier.selector_price).first().text()
        : $el.text();
      const price = parsePrice(priceText);

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
  } else {
    // 汎用自動検出モード
    const seen = new Set();
    const containers = $(
      "li, article, .item, .product, div[class*='item'], div[class*='product'], tr"
    );
    containers.each((_, el) => {
      const $el = $(el);
      const fullText = $el.text().trim();
      if (!fullText || fullText.length > 1200) return;

      const price = parsePrice(matchPrice(fullText));
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
  }

  return items;
}

// ¥1,234 / 1,234円 形式を1件抽出
function matchPrice(text) {
  const yen = text.match(/¥\s?([\d,]{3,})/);
  if (yen) return yen[1];
  const en = text.match(/([\d,]{3,})\s?円/);
  if (en) return en[1];
  return null;
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

  const withJan = extracted.filter((it) => it.jan);
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

  for (const it of withJan) {
    let info;
    try {
      info = await lookupByJan(it.jan);
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
