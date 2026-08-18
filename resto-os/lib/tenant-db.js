import crypto from 'node:crypto';
import { all, one, run, getDb, initDb, withBusyRetry } from './db.js';

/**
 * テナント分離の唯一の入口。
 *
 * ここを通らないとDBに触れない構造にすることで、
 * 「WHERE tenant_id を書き忘れて他店舗のデータが見えた」という事故を仕組みで防ぐ。
 *
 * 生SQLを書く場合は必ず SCOPE(別名) を入れる。入っていないクエリは実行時に例外になる。
 *   ctx.query('SELECT * FROM order_items oi WHERE SCOPE(oi) AND oi.status = ?', ['received'])
 *     → SELECT * FROM order_items oi WHERE oi.tenant_id = 3 AND oi.store_id = 5 AND oi.status = ?
 *
 * tenant_id / store_id はログイン情報から来る整数なので、数値に強制変換したうえで
 * SQLへ直接埋め込む（プレースホルダの順序ズレを起こさないため。文字列は一切埋め込まない）。
 */

const SCOPE_RE = /SCOPE\((\w*)\)/g;

export function newPublicId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('base64url')}`;
}

export function newToken() {
  return crypto.randomBytes(10).toString('hex');
}

function expandScope(sql, tenantId, storeId) {
  if (!SCOPE_RE.test(sql)) {
    SCOPE_RE.lastIndex = 0;
    throw new Error(`SCOPE() の無いクエリは実行できません: ${sql.slice(0, 80)}`);
  }
  SCOPE_RE.lastIndex = 0;
  const t = Number(tenantId);
  const s = Number(storeId);
  if (!Number.isInteger(t) || !Number.isInteger(s) || t <= 0 || s <= 0) {
    throw new Error('テナント情報が不正です');
  }
  return sql.replace(SCOPE_RE, (_m, alias) => {
    const p = alias ? `${alias}.` : '';
    return `${p}tenant_id = ${t} AND ${p}store_id = ${s}`;
  });
}

// ★新しい表を作ったら必ずここに足す。足し忘れると insert() が弾くので、
//   「店舗IDの付いていない行がまぎれ込む」事故そのものが起きない。
const SCOPED_TABLES = new Set([
  'categories', 'menu_items', 'menu_item_translations', 'tables', 'orders', 'order_items',
  'calls', 'checks', 'coupons', 'menu_views', 'audit_logs', 'settings', 'staff',
  'printers', 'print_jobs',
  // 店舗学習基盤：第1層（生データ）
  'weather_forecast', 'weather_actual', 'calendar_days', 'day_events', 'campaigns', 'import_batches',
  // 第1.5層（確定集計）
  'daily_facts', 'daily_hour_facts', 'daily_item_facts',
  // 第2層（AIの見解）
  'forecasts', 'forecast_results', 'ai_insights', 'ai_answers',
  // 朝・閉店後のレポート
  'daily_reports',
]);

export function createCtx({ tenantId, storeId, role, staffId = null, staffName = '', plan = 'standard', tenant = null, store = null, exec = null }) {
  const scoped = (sql) => expandScope(sql, tenantId, storeId);
  const exe = async (sql, args) => {
    // トランザクション中は外側でまとめてやり直すので、ここではリトライしない
    if (exec) return exec.execute({ sql, args });
    await initDb();
    return withBusyRetry(() => getDb().execute({ sql, args }));
  };

  const ctx = {
    tenantId: Number(tenantId),
    storeId: Number(storeId),
    role,
    staffId,
    staffName,
    plan,
    tenant,
    store,

    async query(sql, args = []) {
      const r = await exe(scoped(sql), args);
      return r.rows;
    },
    async first(sql, args = []) {
      const rows = await ctx.query(sql, args);
      return rows[0] || null;
    },
    async run(sql, args = []) {
      return exe(scoped(sql), args);
    },
    /** INSERT。tenant_id / store_id は自動で付く（呼び出し側が書く必要はない） */
    async insert(table, data) {
      if (!SCOPED_TABLES.has(table)) throw new Error(`未登録のテーブルです: ${table}`);
      const row = { ...data, tenant_id: ctx.tenantId, store_id: ctx.storeId };
      const cols = Object.keys(row);
      const r = await exe(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map((c) => row[c])
      );
      return Number(r.lastInsertRowid);
    },
    /** 同じテナント設定のまま、トランザクション内で使えるctxを作る */
    bind(tx) {
      return createCtx({ tenantId, storeId, role, staffId, staffName, plan, tenant, store, exec: tx });
    },
  };
  return ctx;
}

/**
 * テナントをまたぐ唯一の正当な検索。
 * QRトークンは全テナントで一意なので、これで店舗を特定する。
 * （この関数以外で SCOPE 無しの検索を書かないこと）
 */
export async function resolveTableToken(token) {
  if (!token || typeof token !== 'string' || token.length < 8) return null;
  const table = await one('SELECT * FROM tables WHERE token = ?', [token]);
  return withStore(table);
}

/**
 * 印刷したQR用。卓の「ずっと変わらない番号」から、今その卓で有効な入場トークンを引く。
 * 会計のたびに入場トークンは入れ替わるが（前のお客様が後から注文できないように）、
 * テーブルに貼ったQRそのものは貼りっぱなしで使い続けられる。
 */
export async function resolveTableCode(code) {
  if (!code || typeof code !== 'string' || code.length < 6) return null;
  const table = await one('SELECT * FROM tables WHERE public_id = ?', [code]);
  return withStore(table);
}

async function withStore(table) {
  if (!table) return null;
  const store = await one('SELECT * FROM stores WHERE id = ?', [Number(table.store_id)]);
  const tenant = await one('SELECT * FROM tenants WHERE id = ?', [Number(table.tenant_id)]);
  if (!store || !tenant || store.status !== 'active') return null;
  return { table, store, tenant };
}

export { all, one, run };
