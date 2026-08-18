import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

let _db = null;

function resolveUrl() {
  const url = process.env.DATABASE_URL || 'file:./data/resto.db';
  if (url.startsWith('file:')) {
    const rel = url.slice('file:'.length);
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return { url: 'file:' + abs };
  }
  return { url };
}

export function getDb() {
  if (_db) return _db;
  _db = createClient({
    ...resolveUrl(),
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return _db;
}

/**
 * すでに動いているお店のDBに、あとから足した項目を追いつかせる。
 * 新機能を出すたびに店のデータを作り直す（＝過去の売上が消える）ことがないようにする。
 * 「もうある」という反応だけは、正常として読み飛ばす。
 */
const MIGRATIONS = [
  `ALTER TABLE coupons ADD COLUMN starts_on TEXT DEFAULT ''`,
  `ALTER TABLE coupons ADD COLUMN ends_on TEXT DEFAULT ''`,
  `ALTER TABLE coupons ADD COLUMN max_uses INTEGER DEFAULT 0`,
  `ALTER TABLE stores ADD COLUMN otoshi_name TEXT DEFAULT 'お通し'`,
  `ALTER TABLE stores ADD COLUMN otoshi_price INTEGER DEFAULT 0`,
  `ALTER TABLE stores ADD COLUMN seat_charge INTEGER DEFAULT 0`,
  `ALTER TABLE stores ADD COLUMN service_rate INTEGER DEFAULT 0`,
  `ALTER TABLE stores ADD COLUMN invoice_no TEXT DEFAULT ''`,
  `ALTER TABLE checks ADD COLUMN service_charge INTEGER DEFAULT 0`,
  `ALTER TABLE checks ADD COLUMN tax_amount INTEGER DEFAULT 0`,
  `ALTER TABLE checks ADD COLUMN tax_json TEXT DEFAULT ''`,
  `ALTER TABLE checks ADD COLUMN partial INTEGER DEFAULT 0`,
  `ALTER TABLE menu_items ADD COLUMN tax_rate INTEGER DEFAULT 0`,
  // 税率は注文したときの値を写し取る（あとで店がメニューの税率を直しても、過去のレシートは変わらない）
  `ALTER TABLE order_items ADD COLUMN tax_rate INTEGER DEFAULT 0`,
  `ALTER TABLE checks ADD COLUMN seat_charge INTEGER DEFAULT 0`,
  `ALTER TABLE checks ADD COLUMN invoice_no TEXT DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS day_closes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL,
     store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL,
     sales INTEGER NOT NULL,
     checks INTEGER NOT NULL,
     guests INTEGER NOT NULL,
     discount INTEGER DEFAULT 0,
     voided_count INTEGER DEFAULT 0,
     voided_total INTEGER DEFAULT 0,
     payments_json TEXT DEFAULT '',
     cash_expected INTEGER DEFAULT 0,
     cash_counted INTEGER DEFAULT 0,
     cash_diff INTEGER DEFAULT 0,
     note TEXT DEFAULT '',
     staff_id INTEGER,
     staff_name TEXT DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_day_close ON day_closes(tenant_id, store_id, business_date)`,
  // レシートに刷る店の連絡先
  `ALTER TABLE stores ADD COLUMN tel TEXT DEFAULT ''`,
  `ALTER TABLE stores ADD COLUMN address TEXT DEFAULT ''`,
  // 会計時にお預り金額を記録できるように（レシートのお釣り表示用）
  `ALTER TABLE checks ADD COLUMN received INTEGER DEFAULT 0`,
  // ── プリンター連携（Star CloudPRNT方式）
  // プリンターの側から一定間隔でこのサーバーに「印刷するものある？」と聞きに来る。
  // 店のネットワークに穴を開けず、パソコンも常駐ソフトも要らない。
  `CREATE TABLE IF NOT EXISTS printers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL,
     store_id INTEGER NOT NULL,
     public_id TEXT NOT NULL,
     name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'receipt',
     token TEXT NOT NULL,
     width INTEGER NOT NULL DEFAULT 80,
     encoding TEXT NOT NULL DEFAULT 'utf8',
     stations TEXT DEFAULT '',
     copies INTEGER DEFAULT 1,
     drawer INTEGER DEFAULT 0,
     buzzer INTEGER DEFAULT 0,
     active INTEGER DEFAULT 1,
     last_seen_at TEXT DEFAULT '',
     last_status TEXT DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_printer_token ON printers(token)`,
  `CREATE TABLE IF NOT EXISTS print_jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL,
     store_id INTEGER NOT NULL,
     printer_id INTEGER NOT NULL,
     kind TEXT NOT NULL DEFAULT 'receipt',
     title TEXT DEFAULT '',
     body TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'queued',
     tries INTEGER DEFAULT 0,
     error TEXT DEFAULT '',
     created_at TEXT NOT NULL,
     printed_at TEXT DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS ix_print_jobs_queue ON print_jobs(printer_id, status, id)`,
  // 古い形で printers を作ってしまった場合の追いつき（すでにあれば読み飛ばされる）
  `ALTER TABLE printers ADD COLUMN drawer INTEGER DEFAULT 0`,
  `ALTER TABLE printers ADD COLUMN buzzer INTEGER DEFAULT 0`,

  // ── 店舗学習基盤 ─────────────────────────────────────────────
  // 天気は住所ではなく緯度・経度で引く。地図で直した場合は geo_source=manual。
  `ALTER TABLE stores ADD COLUMN postal_code TEXT DEFAULT ''`,
  `ALTER TABLE stores ADD COLUMN prefecture TEXT DEFAULT ''`,
  `ALTER TABLE stores ADD COLUMN city TEXT DEFAULT ''`,
  `ALTER TABLE stores ADD COLUMN building TEXT DEFAULT ''`,
  `ALTER TABLE stores ADD COLUMN lat REAL`,
  `ALTER TABLE stores ADD COLUMN lng REAL`,
  `ALTER TABLE stores ADD COLUMN timezone TEXT DEFAULT 'Asia/Tokyo'`,
  `ALTER TABLE stores ADD COLUMN geo_source TEXT DEFAULT ''`,
  `ALTER TABLE stores ADD COLUMN geo_updated_at TEXT DEFAULT ''`,
  // 提供時間を測るための時刻。updated_at は他の更新でも動くので専用に持つ。
  `ALTER TABLE order_items ADD COLUMN served_at TEXT DEFAULT ''`,

  // 第1層：生データ
  `CREATE TABLE IF NOT EXISTS weather_forecast (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, slot TEXT NOT NULL,
     provider TEXT DEFAULT 'open-meteo',
     weather_code INTEGER, weather_text TEXT DEFAULT '',
     temp_max REAL, temp_min REAL, temp_avg REAL,
     precip_mm REAL, precip_prob INTEGER,
     humidity INTEGER, wind_speed REAL,
     fetched_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wfc ON weather_forecast(tenant_id, store_id, business_date, slot)`,
  `CREATE TABLE IF NOT EXISTS weather_actual (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL,
     provider TEXT DEFAULT 'open-meteo',
     weather_code INTEGER, weather_text TEXT DEFAULT '',
     temp_max REAL, temp_min REAL, temp_avg REAL,
     precip_mm REAL, humidity INTEGER, wind_speed REAL,
     confirmed INTEGER DEFAULT 0,
     fetched_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wac ON weather_actual(tenant_id, store_id, business_date)`,
  `CREATE TABLE IF NOT EXISTS calendar_days (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, dow INTEGER NOT NULL,
     holiday_name TEXT DEFAULT '', is_holiday INTEGER DEFAULT 0, is_eve INTEGER DEFAULT 0,
     streak_days INTEGER DEFAULT 1,
     is_month_start INTEGER DEFAULT 0, is_month_end INTEGER DEFAULT 0,
     payday_near INTEGER DEFAULT 99, season TEXT DEFAULT '', special TEXT DEFAULT ''
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_caldays ON calendar_days(tenant_id, store_id, business_date)`,
  `CREATE TABLE IF NOT EXISTS day_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, end_date TEXT DEFAULT '',
     kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT DEFAULT '',
     impact TEXT DEFAULT 'unknown', staff_name TEXT DEFAULT '', created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_day_events ON day_events(tenant_id, store_id, business_date)`,
  `CREATE TABLE IF NOT EXISTS campaigns (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     name TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT DEFAULT '',
     starts_on TEXT NOT NULL, ends_on TEXT DEFAULT '', cost INTEGER DEFAULT 0,
     staff_name TEXT DEFAULT '', created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_campaigns ON campaigns(tenant_id, store_id, starts_on)`,
  `CREATE TABLE IF NOT EXISTS import_batches (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     public_id TEXT NOT NULL, filename TEXT DEFAULT '', kind TEXT NOT NULL DEFAULT 'daily',
     rows_ok INTEGER DEFAULT 0, rows_ng INTEGER DEFAULT 0,
     date_from TEXT DEFAULT '', date_to TEXT DEFAULT '',
     mapping_json TEXT DEFAULT '', note TEXT DEFAULT '',
     staff_name TEXT DEFAULT '', created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_import_batches ON import_batches(tenant_id, store_id, created_at)`,

  // 第1.5層：確定集計（生データを足しただけ／作り直せる）
  `CREATE TABLE IF NOT EXISTS daily_facts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'live', import_batch_id INTEGER,
     sales INTEGER DEFAULT 0, checks_count INTEGER DEFAULT 0, guests INTEGER DEFAULT 0,
     orders_count INTEGER DEFAULT 0, items_qty INTEGER DEFAULT 0,
     discount INTEGER DEFAULT 0, seat_charge INTEGER DEFAULT 0, service_charge INTEGER DEFAULT 0,
     void_count INTEGER DEFAULT 0, void_total INTEGER DEFAULT 0,
     cost_total INTEGER DEFAULT 0, gross_profit INTEGER DEFAULT 0, ai_sales INTEGER DEFAULT 0,
     avg_spend INTEGER DEFAULT 0, avg_check INTEGER DEFAULT 0,
     turnover REAL DEFAULT 0, seats INTEGER DEFAULT 0, avg_serve_min REAL DEFAULT 0,
     labor_cost INTEGER DEFAULT 0, staff_count INTEGER DEFAULT 0, waste_amount INTEGER DEFAULT 0,
     closed INTEGER DEFAULT 0, computed_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_facts ON daily_facts(tenant_id, store_id, business_date)`,
  `CREATE TABLE IF NOT EXISTS daily_hour_facts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, hour INTEGER NOT NULL,
     sales INTEGER DEFAULT 0, qty INTEGER DEFAULT 0, orders_count INTEGER DEFAULT 0
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_dhf ON daily_hour_facts(tenant_id, store_id, business_date, hour)`,
  `CREATE TABLE IF NOT EXISTS daily_item_facts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, item_id INTEGER, name TEXT NOT NULL,
     category_id INTEGER, category_name TEXT DEFAULT '', station TEXT DEFAULT '',
     qty INTEGER DEFAULT 0, sales INTEGER DEFAULT 0, cost INTEGER DEFAULT 0,
     profit INTEGER DEFAULT 0, peak_hour INTEGER
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_dif ON daily_item_facts(tenant_id, store_id, business_date, name)`,
  `CREATE INDEX IF NOT EXISTS ix_dif_item ON daily_item_facts(tenant_id, store_id, name, business_date)`,

  // 第2層：AIの見解（推測。事実の表とは必ず分ける）
  `CREATE TABLE IF NOT EXISTS forecasts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     target_date TEXT NOT NULL, metric TEXT NOT NULL,
     value REAL NOT NULL, low REAL, high REAL,
     confidence TEXT DEFAULT 'low', confidence_pct INTEGER DEFAULT 0,
     basis_json TEXT DEFAULT '', engine TEXT DEFAULT 'rule', created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_forecasts ON forecasts(tenant_id, store_id, target_date, metric)`,
  `CREATE TABLE IF NOT EXISTS forecast_results (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     target_date TEXT NOT NULL, metric TEXT NOT NULL,
     predicted REAL NOT NULL, actual REAL NOT NULL, error_pct REAL NOT NULL,
     cause_json TEXT DEFAULT '', created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_fresults ON forecast_results(tenant_id, store_id, target_date, metric)`,
  `CREATE TABLE IF NOT EXISTS ai_insights (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     kind TEXT NOT NULL, headline TEXT NOT NULL, body TEXT DEFAULT '',
     confidence TEXT DEFAULT 'low', sample_days INTEGER DEFAULT 0,
     span_from TEXT DEFAULT '', span_to TEXT DEFAULT '',
     engine TEXT DEFAULT 'rule', active INTEGER DEFAULT 1, created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_ai_insights ON ai_insights(tenant_id, store_id, kind, active)`,
  `CREATE TABLE IF NOT EXISTS ai_answers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     question TEXT NOT NULL, answer TEXT DEFAULT '', basis_json TEXT DEFAULT '',
     engine TEXT DEFAULT 'rule', staff_name TEXT DEFAULT '', created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_ai_answers ON ai_answers(tenant_id, store_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS daily_reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, kind TEXT NOT NULL,
     title TEXT DEFAULT '', body TEXT DEFAULT '', data_json TEXT DEFAULT '',
     delivered INTEGER DEFAULT 0, delivery TEXT DEFAULT '',
     delivery_error TEXT DEFAULT '', delivered_at TEXT DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_reports ON daily_reports(tenant_id, store_id, business_date, kind)`,

  // ---- 仕込みと発注 ----
  `CREATE TABLE IF NOT EXISTS ingredients (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'g', category TEXT DEFAULT '',
     unit_cost REAL DEFAULT 0, pack_name TEXT DEFAULT '', pack_qty REAL DEFAULT 0,
     supplier TEXT DEFAULT '', lead_days INTEGER DEFAULT 1, min_stock REAL DEFAULT 0,
     shelf_days INTEGER DEFAULT 0, note TEXT DEFAULT '', active INTEGER DEFAULT 1,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ingredients ON ingredients(tenant_id, store_id, name)`,
  `CREATE TABLE IF NOT EXISTS recipe_lines (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     item_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL,
     qty REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_recipe_lines ON recipe_lines(tenant_id, store_id, item_id, ingredient_id)`,
  `CREATE INDEX IF NOT EXISTS ix_recipe_ing ON recipe_lines(tenant_id, store_id, ingredient_id)`,
  `CREATE TABLE IF NOT EXISTS stock_moves (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, ingredient_id INTEGER NOT NULL,
     kind TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, amount INTEGER DEFAULT 0,
     reason TEXT DEFAULT '', staff_id INTEGER, staff_name TEXT DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_stock_moves ON stock_moves(tenant_id, store_id, ingredient_id, business_date)`,
  `CREATE INDEX IF NOT EXISTS ix_stock_moves_date ON stock_moves(tenant_id, store_id, business_date, kind)`,
  `CREATE TABLE IF NOT EXISTS order_plans (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, target_from TEXT NOT NULL, target_to TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft', basis_json TEXT DEFAULT '', note TEXT DEFAULT '',
     created_by TEXT DEFAULT '', decided_by TEXT DEFAULT '', decided_at TEXT DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_order_plans ON order_plans(tenant_id, store_id, business_date, status)`,
  `CREATE TABLE IF NOT EXISTS order_plan_lines (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     plan_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL,
     name TEXT NOT NULL, unit TEXT DEFAULT '', supplier TEXT DEFAULT '',
     need_qty REAL DEFAULT 0, stock_qty REAL DEFAULT 0, suggest_qty REAL DEFAULT 0,
     approved_qty REAL, pack_qty REAL DEFAULT 0, packs REAL DEFAULT 0,
     unit_cost REAL DEFAULT 0, amount INTEGER DEFAULT 0,
     urgency TEXT DEFAULT 'normal', reason TEXT DEFAULT '', created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_order_plan_lines ON order_plan_lines(tenant_id, store_id, plan_id)`,
  `CREATE TABLE IF NOT EXISTS stockouts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
     business_date TEXT NOT NULL, item_id INTEGER, name TEXT NOT NULL,
     usual_qty REAL DEFAULT 0, actual_qty REAL DEFAULT 0, miss_qty REAL DEFAULT 0,
     price INTEGER DEFAULT 0, est_loss INTEGER DEFAULT 0, sample_days INTEGER DEFAULT 0,
     detected TEXT DEFAULT 'auto', created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_stockouts ON stockouts(tenant_id, store_id, business_date, name)`,
];

// 「もう追いついているか」を1回で見分けるための問い合わせ。
// ★項目を足したら、必ずこの1行も最後に足したものへ合わせて更新すること。
const SCHEMA_PROBE = 'SELECT id FROM stockouts LIMIT 1';

async function migrate(db) {
  for (const sql of MIGRATIONS) {
    try {
      await db.execute(sql);
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message || ''))) throw e;
    }
  }
}

let _initDone = false;
export async function initDb() {
  if (_initDone) return;
  const db = getDb();

  // 出来上がっているDBに毎回スキーマを流し直すと、そのぶん表示が遅くなる。
  // 「いちばん最後に足した項目」を1回だけ見て、あれば何もしない。
  try {
    await db.execute(SCHEMA_PROBE);
    _initDone = true;
    return;
  } catch {
    // ここに来るのは「まだ何も無い（初回）」か「古い形のまま」のどちらか
  }

  let built = false;
  try {
    await db.execute('SELECT 1 FROM tenants LIMIT 1');
    built = true;
  } catch {
    // テーブルがまだ無い＝初回。下でまとめて作る。
  }
  if (built) {
    await migrate(db); // 古い形だった → 足りない項目だけ追加する
    _initDone = true;
    return;
  }

  const schemaPath = path.join(process.cwd(), 'lib', 'schema.sql');
  const raw = fs.readFileSync(schemaPath, 'utf8');
  const statements = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await db.batch(statements, 'write');
  _initDone = true;
}

export async function all(sql, args = []) {
  await initDb();
  const r = await getDb().execute({ sql, args });
  return r.rows;
}

export async function one(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBusy = (e) => String(e?.code || e?.message || '').includes('SQLITE_BUSY');

/**
 * 書き込みがぶつかったとき（同時に複数卓が注文・会計するとき）に、
 * 少し待って自動で入れ直す。ここで諦めると注文や記録が消える。
 */
export async function withBusyRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isBusy(e) || attempt >= 5) throw e;
      await sleep(60 * (attempt + 1));
    }
  }
}

export async function run(sql, args = []) {
  await initDb();
  return withBusyRetry(() => getDb().execute({ sql, args }));
}

// 書き込みは1件ずつ順番に流す。ピーク時に複数卓が同時注文しても取りこぼさないため。
let _writeQueue = Promise.resolve();

async function runTx(fn) {
  const tx = await getDb().transaction('write');
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }
}

/**
 * 複数の書き込みを「全部成功か、全部無かったことにするか」で実行する。
 * 注文登録・会計確定など、途中で失敗すると帳簿が壊れる処理で必ず使う。
 * 同時に書き込みが来ても順番待ちにし、それでもぶつかったら少し待って自動で入れ直す。
 */
export async function withTx(fn) {
  await initDb();
  const task = _writeQueue.then(() => withBusyRetry(() => runTx(fn)));
  // 失敗しても後続の書き込みが止まらないようにする
  _writeQueue = task.then(() => {}, () => {});
  return task;
}

export function nowIso() {
  return new Date().toISOString();
}

// 店舗のローカル日付 (深夜営業を考慮し、5時までは前日扱い)
export function businessDate(d = new Date()) {
  const x = new Date(d.getTime() + 9 * 3600 * 1000); // JST
  if (x.getUTCHours() < 5) x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

export function businessRange(dateStr) {
  // 対象営業日の 05:00 JST 〜 翌 05:00 JST を UTC ISO で返す
  const start = new Date(`${dateStr}T05:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return [start.toISOString(), end.toISOString()];
}
