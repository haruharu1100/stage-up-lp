import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

// 本番（Vercel）は Turso のクラウドDBに接続する。
//   TURSO_DATABASE_URL … 例: libsql://xxxx.turso.io
//   TURSO_AUTH_TOKEN   … Turso の認証トークン
// この2つが無い場合（手元での開発）は、ローカルのファイルDBに保存する。
let client;
let readyPromise;

function rawClient() {
  if (client) return client;
  const url = (process.env.TURSO_DATABASE_URL || "").trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim();
  if (url) {
    client = createClient({ url, authToken: authToken || undefined });
  } else {
    // 開発用: ローカルのSQLiteファイル
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    client = createClient({ url: `file:${path.join(DATA_DIR, "app.db")}` });
  }
  return client;
}

// 表の作成と初期データ投入を一度だけ行う。
function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  const c = rawClient();
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT,
      selector_item TEXT,
      selector_name TEXT,
      selector_price TEXT,
      selector_jan TEXT,
      selector_link TEXT,
      selector_image TEXT,
      is_preset INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id),
      url TEXT NOT NULL,
      ship_method TEXT DEFAULT 'FBA',
      cond_pattern TEXT DEFAULT 'RATE',
      rate_min REAL DEFAULT 20,
      rate_max REAL DEFAULT 100,
      amount_min INTEGER DEFAULT 2000,
      monthly_sales_min INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id),
      supplier_name TEXT,
      product_name TEXT,
      jan TEXT,
      asin TEXT,
      buy_price INTEGER,
      amazon_price INTEGER,
      fees INTEGER,
      profit INTEGER,
      profit_rate REAL,
      monthly_sales INTEGER,
      source_url TEXT,
      product_url TEXT,
      image_url TEXT,
      found_at TEXT DEFAULT (datetime('now')),
      hidden INTEGER DEFAULT 0,
      UNIQUE(task_id, jan, buy_price)
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id),
      supplier_name TEXT,
      product_name TEXT,
      jan TEXT,
      asin TEXT,
      buy_price INTEGER,
      amazon_price INTEGER,
      fees INTEGER,
      profit INTEGER,
      profit_rate REAL,
      monthly_sales INTEGER,
      source_url TEXT,
      product_url TEXT,
      image_url TEXT,
      is_deal INTEGER DEFAULT 0,
      found_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await seedSettings();
  await seedSuppliers();
}

async function seedSettings() {
  const c = rawClient();
  const defaults = {
    keepa_key: "",
    notify_email: "",
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    include_fees: "1",
    referral_rate: "10",
    fba_fee: "450",
    self_ship_fee: "300",
    cron_hour: "8",
    plan: "free",
  };
  const stmts = Object.entries(defaults).map(([key, value]) => ({
    sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    args: [key, value],
  }));
  await c.batch(stmts, "write");
}

async function seedSuppliers() {
  const c = rawClient();
  const countRs = await c.execute("SELECT COUNT(*) AS cnt FROM suppliers");
  const count = Number(countRs.rows[0].cnt || 0);
  if (count > 0) return;

  const presets = [
    {
      name: "ヨドバシ.com",
      base_url: "https://www.yodobashi.com/",
      selector_item: ".js_productBox, .pListBlock li",
      selector_name: ".pName, .js_productName",
      selector_price: ".productPrice, .js_price",
      selector_jan: "",
      selector_link: "a",
      selector_image: "img",
    },
    {
      name: "ビックカメラ.com",
      base_url: "https://www.biccamera.com/",
      selector_item: "li.prod_box, .cssopacity",
      selector_name: ".bcs_title, .prod_ttl",
      selector_price: ".bcs_price, .price",
      selector_jan: "",
      selector_link: "a",
      selector_image: "img",
    },
    {
      name: "楽天市場（検索・セール）",
      base_url: "https://search.rakuten.co.jp/",
      selector_item: ".searchresultitem, .dui-card",
      selector_name: ".title, .content.title",
      selector_price: ".important, .price--OX_YW",
      selector_jan: "",
      selector_link: "a",
      selector_image: "img",
    },
    {
      name: "Yahoo!ショッピング",
      base_url: "https://shopping.yahoo.co.jp/",
      selector_item: "li.LoopList__item, .SearchResult_SearchResult__item",
      selector_name: ".elProductTitle, .SearchResultItemTitle",
      selector_price: ".elPriceNumber, .SearchResultItemPrice",
      selector_jan: "",
      selector_link: "a",
      selector_image: "img",
    },
    {
      name: "駿河屋",
      base_url: "https://www.suruga-ya.jp/",
      selector_item: ".item, .product_box",
      selector_name: ".product-name, .title, .item_name",
      selector_price: ".item_price",
      selector_jan: "",
      selector_link: "a",
      selector_image: "img",
    },
    {
      name: "あみあみ",
      base_url: "https://www.amiami.jp/",
      selector_item: ".newly-added-items__item, .product_box",
      selector_name: ".newly-added-items__name, .product_name",
      selector_price: ".newly-added-items__price, .product_price",
      selector_jan: "",
      selector_link: "a",
      selector_image: "img",
    },
    {
      name: "汎用（自動検出）",
      base_url: "",
      selector_item: "",
      selector_name: "",
      selector_price: "",
      selector_jan: "",
      selector_link: "",
      selector_image: "",
    },
  ];

  const stmts = presets.map((p) => ({
    sql: `INSERT INTO suppliers
      (name, base_url, selector_item, selector_name, selector_price,
       selector_jan, selector_link, selector_image, is_preset, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    args: [
      p.name,
      p.base_url,
      p.selector_item,
      p.selector_name,
      p.selector_price,
      p.selector_jan,
      p.selector_link,
      p.selector_image,
    ],
  }));
  await c.batch(stmts, "write");
}

// 1行を「列名→値」の素直なオブジェクトに変換する（JSON応答・プロパティ参照用）。
function toObj(row, columns) {
  const o = {};
  for (let i = 0; i < columns.length; i++) o[columns[i]] = row[i];
  return o;
}

// ---- 共通クエリ関数（すべて非同期） ----

// 変更系（INSERT / UPDATE / DELETE）。lastId と changes を返す。
export async function run(sql, args = []) {
  await ready();
  const rs = await rawClient().execute({ sql, args });
  return {
    lastId: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null,
    changes: rs.rowsAffected || 0,
  };
}

// 1行取得。無ければ null。
export async function get(sql, args = []) {
  await ready();
  const rs = await rawClient().execute({ sql, args });
  return rs.rows.length ? toObj(rs.rows[0], rs.columns) : null;
}

// 複数行取得。
export async function all(sql, args = []) {
  await ready();
  const rs = await rawClient().execute({ sql, args });
  return rs.rows.map((r) => toObj(r, rs.columns));
}

// 複数の変更系をまとめて実行（トランザクション）。
export async function batch(stmts) {
  await ready();
  return rawClient().batch(stmts, "write");
}

// ---- 設定の読み書き ----

export async function getSetting(key) {
  const row = await get("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  await run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value == null ? "" : String(value)]
  );
}

export async function getAllSettings() {
  const rows = await all("SELECT key, value FROM settings");
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
