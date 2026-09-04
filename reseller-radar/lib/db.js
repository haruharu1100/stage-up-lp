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
  } else if (process.env.VERCEL) {
    // Vercel上でTursoの設定がまだのときの“暫定”運用。
    // /tmp は書き込みできるが一時的（消えることがある）なので、
    // 本番では必ず TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を設定すること。
    client = createClient({ url: "file:/tmp/app.db" });
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

    -- 通知の重複防止：JANが空(名前/型番照合)の商品でも、同じ商品(ASIN)が
    -- 何度も溜まらないようASINで一意にする。INSERT OR IGNOREがこれで効く。
    CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_task_asin_buy
      ON notifications(task_id, asin, buy_price);

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

    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id),
      items_json TEXT,
      cursor INTEGER DEFAULT 0,
      extracted INTEGER DEFAULT 0,
      matched INTEGER DEFAULT 0,
      notified INTEGER DEFAULT 0,
      errors_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'running',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS keepa_cache (
      cache_key TEXT PRIMARY KEY,
      result_json TEXT,
      found_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 既存DBに後から列を足す（新規DBは上のCREATEに無いので個別に追加）。
  // 「そのAmazon商品の正式名」を保存し、結果画面で仕入れ元名と並べて表示するため。
  await addColumnIfMissing("findings", "amazon_title", "TEXT");
  await addColumnIfMissing("notifications", "amazon_title", "TEXT");
  // 仕入れ品のコンディション（新品/中古）。中古は中古価格と比較したことを示す。
  await addColumnIfMissing("findings", "condition", "TEXT");
  await addColumnIfMissing("notifications", "condition", "TEXT");
  // どうやってAmazon商品と一致させたか（jan=確実 / model=型番でほぼ確実 / name=名前だけ要確認）。
  // 名前だけの一致は“似た別商品”を掴む危険があるため、画面で強く注意表示する。
  await addColumnIfMissing("findings", "match_type", "TEXT");
  await addColumnIfMissing("notifications", "match_type", "TEXT");
  // 新・照合エンジン（match.mjs）の判定結果。既存列は壊さず追加のみ。
  //   match_status=JAN_VERIFIED/JAN_LOOKUP_UNVERIFIED/MODEL_VERIFIED/MODEL_UNVERIFIED/
  //                ATTRIBUTE_REVIEW/NAME_UNVERIFIED/CONFLICT/NO_MATCH
  //   attribute_conflicts=矛盾属性のカンマ区切り（例 "capacity,packCount"）
  await addColumnIfMissing("findings", "match_status", "TEXT");
  await addColumnIfMissing("notifications", "match_status", "TEXT");
  await addColumnIfMissing("findings", "attribute_conflicts", "TEXT");
  await addColumnIfMissing("notifications", "attribute_conflicts", "TEXT");
  // Keepa 90日相場・値崩れリスク（取得不可はNULL＝でっち上げない）
  await addColumnIfMissing("findings", "avg_price_90", "INTEGER");
  await addColumnIfMissing("notifications", "avg_price_90", "INTEGER");
  await addColumnIfMissing("findings", "price_risk_score", "INTEGER");
  await addColumnIfMissing("notifications", "price_risk_score", "INTEGER");

  await seedSettings();
  await seedSuppliers();
  await renameSuppliers();
  await ensureExtraSuppliers();
  await removeRetiredSuppliers();
}

// すでに存在する列を足そうとするとエラーになるので、無いときだけ追加する。
async function addColumnIfMissing(table, column, type) {
  const c = rawClient();
  try {
    const info = await c.execute(`PRAGMA table_info(${table})`);
    const has = info.rows.some((r) => {
      const o = toObj(r, info.columns);
      return o.name === column;
    });
    if (!has) {
      await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (_) {
    // 追加できない場合は無視
  }
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
    plan: "pro", // テストプレイ中は常にプロ（無制限）
  };
  const stmts = Object.entries(defaults).map(([key, value]) => ({
    sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    args: [key, value],
  }));
  await c.batch(stmts, "write");
}

// 汎用（自動検出）で読める、あとから足した仕入れ先。
// セレクタは空＝自動検出モード。実ページで商品が取れることを確認済み。
const EXTRA_SUPPLIERS = [
  {
    name: "セブンネットショッピング",
    base_url: "https://7net.omni7.jp/",
  },
  {
    name: "エディオン",
    base_url: "https://www.edion.com/",
  },
  {
    name: "ケーズデンキ",
    base_url: "https://www.ksdenki.com/",
  },
  {
    name: "ヤフオク！（新品・未使用のみ）",
    base_url: "https://auctions.yahoo.co.jp/",
  },
  {
    name: "ラクマ（新品・未使用のみ）",
    base_url: "https://fril.jp/",
  },
  {
    name: "メルカリ（新品・未使用のみ）",
    base_url: "https://jp.mercari.com/",
  },
];

// 使わなくなった仕入れ先（商品が取れない・中古専門など）。既存DBからも消す。
const RETIRED_SUPPLIER_NAMES = [
  "au PAY マーケット",
  "ハードオフ ネットモール（中古）", // 中古専門のため、新品のみ方針で除外
];

// 表示名を変更する仕入れ先（旧名 → 新名）。既存DBのタスクを残したままリネームする。
const SUPPLIER_RENAMES = [
  ["ヤフオク！（オークション・中古）", "ヤフオク！（新品・未使用のみ）"],
  ["ラクマ（フリマ・中古）", "ラクマ（新品・未使用のみ）"],
];

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

// あとから足した仕入れ先を、既存DB（すでに初期データ入り）にも同じ名前が
// 無ければ追加する。seedSuppliers は空DBのときしか動かないため、
// これで本番の既存DBにも新しい仕入れ先が反映される。
async function ensureExtraSuppliers() {
  const c = rawClient();
  for (const s of EXTRA_SUPPLIERS) {
    const exists = await c.execute({
      sql: "SELECT 1 FROM suppliers WHERE name = ? LIMIT 1",
      args: [s.name],
    });
    if (exists.rows.length) continue;
    await c.execute({
      sql: `INSERT INTO suppliers
        (name, base_url, selector_item, selector_name, selector_price,
         selector_jan, selector_link, selector_image, is_preset, enabled)
       VALUES (?, ?, '', '', '', '', '', '', 1, 1)`,
      args: [s.name, s.base_url],
    });
  }
}

// 仕入れ先の表示名を、旧名から新名にリネームする（タスクはそのまま残す）。
// 新名がすでに存在する場合は、重複を避けて旧名の方を消す。
async function renameSuppliers() {
  const c = rawClient();
  for (const [oldName, newName] of SUPPLIER_RENAMES) {
    const oldRs = await c.execute({
      sql: "SELECT id FROM suppliers WHERE name = ?",
      args: [oldName],
    });
    if (!oldRs.rows.length) continue;
    const newRs = await c.execute({
      sql: "SELECT id FROM suppliers WHERE name = ?",
      args: [newName],
    });
    if (newRs.rows.length) {
      // 新名が既にあるなら旧名は削除（重複防止）。
      await c.execute({ sql: "DELETE FROM suppliers WHERE name = ?", args: [oldName] });
    } else {
      await c.execute({
        sql: "UPDATE suppliers SET name = ? WHERE name = ?",
        args: [newName, oldName],
      });
    }
  }
}

// 使わなくなった仕入れ先を、既存DBから削除する。
// その仕入れ先で作られたタスクと、その結果（巡回結果・通知・ジョブ）もまとめて片付ける。
async function removeRetiredSuppliers() {
  const c = rawClient();
  for (const name of RETIRED_SUPPLIER_NAMES) {
    const rs = await c.execute({
      sql: "SELECT id FROM suppliers WHERE name = ?",
      args: [name],
    });
    if (!rs.rows.length) continue;
    const supId = rs.rows[0][0];
    const tasksRs = await c.execute({
      sql: "SELECT id FROM tasks WHERE supplier_id = ?",
      args: [supId],
    });
    for (const row of tasksRs.rows) {
      const tid = row[0];
      await c.execute({ sql: "DELETE FROM findings WHERE task_id = ?", args: [tid] });
      await c.execute({ sql: "DELETE FROM notifications WHERE task_id = ?", args: [tid] });
      await c.execute({ sql: "DELETE FROM crawl_jobs WHERE task_id = ?", args: [tid] });
      await c.execute({ sql: "DELETE FROM tasks WHERE id = ?", args: [tid] });
    }
    await c.execute({ sql: "DELETE FROM suppliers WHERE id = ?", args: [supId] });
  }
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

// ---- Keepa照合キャッシュ（トークン節約用） ----
// 同じJAN・商品名・ASINの照合結果を一定時間ためておき、
// 何度も巡回しても Keepa を再び呼ばずに済むようにする。
// 「見つからなかった」結果もためておく（無駄な再照合を防ぐため）。
const KEEPA_CACHE_TTL_HOURS = 6;

export async function getKeepaCache(cacheKey) {
  const row = await get(
    "SELECT result_json, found_at FROM keepa_cache WHERE cache_key = ?",
    [cacheKey]
  );
  if (!row) return undefined; // 未キャッシュ
  // 期限切れ判定
  const foundAt = new Date((row.found_at || "").replace(" ", "T") + "Z");
  const ageMs = Date.now() - foundAt.getTime();
  if (isFinite(ageMs) && ageMs > KEEPA_CACHE_TTL_HOURS * 3600 * 1000) {
    return undefined; // 古いので使わない
  }
  try {
    return JSON.parse(row.result_json); // null（見つからず）も有効な値として返る
  } catch (_) {
    return undefined;
  }
}

export async function setKeepaCache(cacheKey, value) {
  await run(
    `INSERT INTO keepa_cache (cache_key, result_json, found_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(cache_key) DO UPDATE SET
       result_json = excluded.result_json,
       found_at = excluded.found_at`,
    [cacheKey, JSON.stringify(value == null ? null : value)]
  );
}
