import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// 本番サーバーでは環境変数 DATA_DIR に永続ディスクのパスを指定できる
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

let db;

function initDb() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  seedSettings();
  seedSuppliers();

  return db;
}

function seedSettings() {
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
  };
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(defaults)) insert.run(k, v);
  });
  tx();
}

function seedSuppliers() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM suppliers").get().c;
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
      selector_name: ".title, .item_name",
      selector_price: ".price, .item_price",
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

  const insert = db.prepare(`
    INSERT INTO suppliers
      (name, base_url, selector_item, selector_name, selector_price,
       selector_jan, selector_link, selector_image, is_preset, enabled)
    VALUES
      (@name, @base_url, @selector_item, @selector_name, @selector_price,
       @selector_jan, @selector_link, @selector_image, 1, 1)
  `);
  const tx = db.transaction(() => {
    for (const p of presets) insert.run(p);
  });
  tx();
}

export function getDb() {
  return initDb();
}

export function getSetting(key) {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value == null ? "" : String(value));
}

export function getAllSettings() {
  const rows = getDb().prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
