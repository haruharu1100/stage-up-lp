/**
 * 保存先（PERSISTENCE LAYER）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ作ったのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、ポイントも抽選結果も景品の残数も、ブラウザの中だけにありました。
 *   画面を読み込み直すと全部消えます。契約者へ渡す製品としては成立しません。
 *
 *   お金が動くものは、必ず運営側に保存します。
 *   お客様の端末にあるものは、書き換えられる前提で扱います。
 *
 * ═══════════════════════════════════════════════════════
 * ★接続先の決め方
 * ═══════════════════════════════════════════════════════
 *
 *   DATABASE_URL が設定されていれば、そこへつなぎます（Turso / libSQL）。
 *   設定が無ければ、手元のファイルへ書きます。
 *
 *     本番      libsql://xxxx.turso.io  （+ DATABASE_AUTH_TOKEN）
 *     Preview   隔離した検証用のDB      （本番とは必ず別のURLにすること）
 *     開発・試験 file:.data/gacha-os.db  （リポジトリには入らない）
 *
 *   ★本番URLと検証用URLを同じにしないこと。
 *     検証で 1000 回の同時抽選を流したとき、本番のポイントが動きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みは必ず1つずつ（withWriteTx）
 * ═══════════════════════════════════════════════════════
 *
 *   抽選は「ポイントを引く・景品を決める・残数を減らす・記録を残す」を
 *   まとめて1回で終わらせる必要があります。途中で止まると、
 *   ポイントだけ減って何も当たっていない人が生まれます。
 *
 *   そこで書き込みは BEGIN IMMEDIATE（最初から書き込みの順番を取る方式）で行い、
 *   さらに同じプロセス内では順番待ちの列に並ばせます。
 *   libSQL のファイル接続は、1本の接続で同時に2つの取引を開けないためです。
 *
 *   ただし、順番待ちの列は「同じプロセスの中」でしか効きません。
 *   サーバーが複数台になれば、列は台数ぶんに分かれます。
 *   だから守りをそこに置かず、
 *
 *     ・残数の減算は「残りが1以上のときだけ減らす」条件付き更新
 *     ・ポイントの減算は「残高が足りているときだけ減らす」条件付き更新
 *     ・二重実行の鍵は UNIQUE 制約
 *
 *   の3つで守ります。これらはDB自身が保証するので、台数が増えても効きます。
 */

import { createClient, type Client, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";

/** このコードの版。監査ログに残して「どの版が処理したか」を後から追えるようにする */
export const SERVER_VERSION = "gacha-os-server/1.0.0";

let client: Client | null = null;
let migrated = false;

/**
 * この保存先が「どういう立場のものか」。
 *
 * ★本番だけは、うっかりでつながらないようにしてあります。
 *   検証で1000回の同時抽選を流すと、本番のポイントが本当に動きます。
 *   動いてから気づいても、戻せません。
 */
export type DbEnv = "development" | "test" | "preview" | "production";

export function dbEnv(): DbEnv {
  const raw = (process.env.DATABASE_ENV ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "preview" || raw === "test") return raw;
  if (raw === "development" || raw === "") {
    return process.env.NODE_ENV === "test" ? "test" : "development";
  }
  throw new Error(
    `DATABASE_ENV の値が正しくありません: "${raw}"\n` +
      "  development / test / preview / production のどれかにしてください。",
  );
}

/** 保存先のURLを決める */
export function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  const env = dbEnv();

  /* ★本番へは、はっきり許可したときだけつなぐ。
       PHASE 1 の間は、本番データに触れてはいけません。 */
  if (env === "production" && process.env.ALLOW_PRODUCTION_DB !== "yes-i-am-sure") {
    throw new Error(
      "本番の保存先につなごうとしています。\n" +
        "  いまは検証用（preview）だけを使う段階です。\n" +
        "  本当に本番へつなぐときだけ ALLOW_PRODUCTION_DB=yes-i-am-sure を付けてください。",
    );
  }

  if (fromEnv) return fromEnv;

  /* ★公開先（Vercel）で保存先が指定されていないときは、必ず止めること。
       ここで手元ファイルへ逃がすと、次のような壊れ方をします。

         ・サーバーが増えるたびに、別々の保存先ができる
         ・しばらく使われないと、中身ごと消える
         ・「昨日のポイントが無い」が、原因不明のまま起きる

       黙って動くほうが、止まるより危険です。 */
  if (process.env.VERCEL) {
    throw new Error(
      "保存先（DATABASE_URL）が設定されていません。\n" +
        "  公開先では、一時ファイルを正本にできません（消えます）。\n" +
        "  検証用の隔離DBのURLを DATABASE_URL に設定してください。",
    );
  }

  /* 手元で動かすときだけ、ファイルを使う */
  const dir = path.join(process.cwd(), ".data");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* すでにある場合は何もしない */
  }
  return `file:${path.join(dir, "gacha-os.db")}`;
}

export function db(): Client {
  if (!client) {
    client = createClient({
      url: databaseUrl(),
      authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
    });
  }
  return client;
}

/** 試験のあとで接続を捨てる（試験ごとに別のファイルを使うため） */
export function resetDbForTests(): void {
  client?.close();
  client = null;
  migrated = false;
}

/* ══════════════════════════════════════════════
   表の定義
   ══════════════════════════════════════════════

   ★どの表にも tenant_id を持たせること。

     いま画面は1社ぶんしか作っていませんが、
     後から tenant_id を足すのは、実際にはほぼ作り直しになります。
     どの問い合わせにも「どの会社の話か」を足して回ることになり、
     1か所でも足し忘れると、他社のデータが混ざって見えます。

     混ざったことに気づくのは、たいてい混ざったあとです。
     だから最初から全部の表に入れておきます。 */

/* ══════════════════════════════════════════════
   ★変更は必ず「積み重ね」で行うこと
   ══════════════════════════════════════════════

     表の形を変えたくなったら、下の一覧に新しい段を足します。
     すでにある段は、二度と書き換えないこと。

     書き換えると、こうなります。
     手元のDBは作り直すので新しい形になりますが、
     検証用や本番のDBはすでに古い形で動いています。
     そこには新しい段が届かないので、
     「手元では動くのに、公開したら落ちる」が起きます。

     直したくなったら、直す段を新しく足してください。
     どの段まで済んだかは schema_migrations に記録されるので、
     同じ段が二度実行されることはありません。

   ★人がDBを直接いじらないこと。
     いじると、この記録と実物がずれます。
     ずれたことは、次の段が失敗するまで誰も気づきません。 */

type Migration = { name: string; sql: string[] };

/* ── 001：最初の形 ─────────────────────────────
   ★この段は完成しています。もう触らないこと。 */
const M001: string[] = [
  `CREATE TABLE IF NOT EXISTS tenants (
     id          TEXT PRIMARY KEY,
     code        TEXT NOT NULL UNIQUE,
     name        TEXT NOT NULL,
     status      TEXT NOT NULL DEFAULT 'ACTIVE',
     created_at  TEXT NOT NULL
   )`,

  /* 運営側の担当者 */
  `CREATE TABLE IF NOT EXISTS app_users (
     id                   TEXT PRIMARY KEY,
     tenant_id            TEXT NOT NULL,
     display_id           TEXT NOT NULL,
     email                TEXT NOT NULL,
     name                 TEXT NOT NULL,
     role                 TEXT NOT NULL,
     password_hash        TEXT,
     password_salt        TEXT,
     must_change_password INTEGER NOT NULL DEFAULT 1,
     mfa_secret           TEXT,
     status               TEXT NOT NULL DEFAULT 'ACTIVE',
     created_at           TEXT NOT NULL,
     UNIQUE (tenant_id, email)
   )`,

  /* お客様 */
  `CREATE TABLE IF NOT EXISTS customers (
     id            TEXT PRIMARY KEY,
     tenant_id     TEXT NOT NULL,
     display_id    TEXT NOT NULL,
     email         TEXT,
     name          TEXT NOT NULL,
     password_hash TEXT,
     password_salt TEXT,
     points        INTEGER NOT NULL DEFAULT 0,
     spent         INTEGER NOT NULL DEFAULT 0,
     status        TEXT NOT NULL DEFAULT 'ACTIVE',
     address       TEXT,
     created_at    TEXT NOT NULL,
     UNIQUE (tenant_id, display_id)
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT NOT NULL,
     subject_kind TEXT NOT NULL,
     subject_id   TEXT NOT NULL,
     token_hash   TEXT NOT NULL UNIQUE,
     step_up_at   TEXT,
     expires_at   TEXT NOT NULL,
     created_at   TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS gachas (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT NOT NULL,
     title        TEXT NOT NULL,
     price        INTEGER NOT NULL,
     total        INTEGER NOT NULL,
     left_count   INTEGER NOT NULL,
     designed_rtp REAL NOT NULL,
     status       TEXT NOT NULL,
     revenue      INTEGER NOT NULL DEFAULT 0,
     paid_value   INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT NOT NULL
   )`,

  /* 等級ごとの在庫。「箱の中に何本残っているか」の唯一の正解 */
  `CREATE TABLE IF NOT EXISTS gacha_stock (
     tenant_id TEXT NOT NULL,
     gacha_id  TEXT NOT NULL,
     grade     TEXT NOT NULL,
     name      TEXT NOT NULL,
     value     INTEGER NOT NULL,
     total     INTEGER NOT NULL,
     drawn     INTEGER NOT NULL DEFAULT 0,
     reserved  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, gacha_id, grade)
   )`,

  /* 抽選の記録。1回引くごとに必ず1行 */
  `CREATE TABLE IF NOT EXISTS draws (
     id               TEXT PRIMARY KEY,
     tenant_id        TEXT NOT NULL,
     idempotency_key  TEXT NOT NULL,
     request_id       TEXT NOT NULL,
     user_id          TEXT NOT NULL,
     gacha_id         TEXT NOT NULL,
     play_count       INTEGER NOT NULL,
     price            INTEGER NOT NULL,
     point_before     INTEGER NOT NULL,
     point_spent      INTEGER NOT NULL,
     point_returned   INTEGER NOT NULL,
     point_after      INTEGER NOT NULL,
     prize_id         TEXT,
     prize_rank       TEXT NOT NULL,
     prize_name       TEXT NOT NULL,
     prize_value      INTEGER NOT NULL,
     last_one         INTEGER NOT NULL DEFAULT 0,
     remaining_before INTEGER NOT NULL,
     remaining_after  INTEGER NOT NULL,
     rng_source       TEXT NOT NULL,
     rng_nonce        TEXT NOT NULL,
     server_version   TEXT NOT NULL,
     created_at       TEXT NOT NULL,
     UNIQUE (tenant_id, idempotency_key)
   )`,

  /* 当たった現物。発送かポイント交換かは、お客様が後から選ぶ */
  `CREATE TABLE IF NOT EXISTS prizes (
     id          TEXT PRIMARY KEY,
     tenant_id   TEXT NOT NULL,
     user_id     TEXT NOT NULL,
     gacha_id    TEXT NOT NULL,
     draw_id     TEXT NOT NULL,
     grade       TEXT NOT NULL,
     name        TEXT NOT NULL,
     value       INTEGER NOT NULL,
     exchange_pt INTEGER NOT NULL,
     status      TEXT NOT NULL DEFAULT 'UNCHOSEN',
     won_at      TEXT NOT NULL
   )`,

  /* ポイント台帳。残高はここの合計と必ず一致すること */
  `CREATE TABLE IF NOT EXISTS point_ledger (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     user_id    TEXT NOT NULL,
     kind       TEXT NOT NULL,
     delta      INTEGER NOT NULL,
     memo       TEXT NOT NULL,
     ref        TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS orders (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     user_id    TEXT NOT NULL,
     prize_id   TEXT NOT NULL,
     status     TEXT NOT NULL,
     address    TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS shipments (
     id          TEXT PRIMARY KEY,
     tenant_id   TEXT NOT NULL,
     order_id    TEXT NOT NULL,
     carrier     TEXT,
     tracking_no TEXT,
     status      TEXT NOT NULL,
     shipped_at  TEXT,
     created_at  TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS support_tickets (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     user_id    TEXT NOT NULL,
     subject    TEXT NOT NULL,
     body       TEXT NOT NULL,
     status     TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,

  /* 監査ログ。1件ずつ前の1件のハッシュを混ぜて鎖にする */
  `CREATE TABLE IF NOT EXISTS audit_events (
     id              TEXT PRIMARY KEY,
     tenant_id       TEXT NOT NULL,
     seq             INTEGER NOT NULL,
     at              TEXT NOT NULL,
     actor_kind      TEXT NOT NULL,
     actor_id        TEXT NOT NULL,
     actor_name      TEXT NOT NULL,
     actor_role      TEXT NOT NULL,
     action          TEXT NOT NULL,
     target          TEXT NOT NULL,
     summary         TEXT NOT NULL,
     before_text     TEXT,
     after_text      TEXT,
     reason          TEXT,
     data            TEXT,
     request_id      TEXT,
     idempotency_key TEXT,
     server_version  TEXT NOT NULL,
     prev_hash       TEXT NOT NULL,
     hash            TEXT NOT NULL,
     UNIQUE (tenant_id, seq)
   )`,

  /* 二重実行を止めるための鍵置き場。
     ★同じ鍵で2回目が来たら、前回の答えをそのまま返す。引き直さない。 */
  `CREATE TABLE IF NOT EXISTS idempotency (
     tenant_id   TEXT NOT NULL,
     scope       TEXT NOT NULL,
     key         TEXT NOT NULL,
     subject_id  TEXT NOT NULL,
     status      TEXT NOT NULL,
     response    TEXT,
     created_at  TEXT NOT NULL,
     PRIMARY KEY (tenant_id, scope, key)
   )`,

  `CREATE INDEX IF NOT EXISTS ix_draws_gacha  ON draws (tenant_id, gacha_id)`,
  `CREATE INDEX IF NOT EXISTS ix_draws_user   ON draws (tenant_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ledger_user  ON point_ledger (tenant_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS ix_prizes_user  ON prizes (tenant_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS ix_audit_seq    ON audit_events (tenant_id, seq)`,
];

/* ── 002：会社ごとの分離を完成させる ────────────
   役割・設定・相場・商品・不正の記録を足します。
   どれも「どの会社の話か」から始まる形にします。 */
const M002: string[] = [
  /* 役割と、できることの範囲。
     ★権限を人に直接書かないこと。
       「この人は発送できる」と書いて回ると、
       担当が変わるたびに全員ぶん直すことになり、必ず消し忘れます。
       役割に権限をつけ、人には役割だけを持たせます。 */
  `CREATE TABLE IF NOT EXISTS roles (
     tenant_id   TEXT NOT NULL,
     code        TEXT NOT NULL,
     name        TEXT NOT NULL,
     permissions TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     PRIMARY KEY (tenant_id, code)
   )`,

  /* 設定。
     ★好きな名前で書き込める作りにしないこと。
       画面から送られてきた名前をそのまま鍵にすると、
       いつか role や points という名前で書き込まれます。
       受け付ける鍵は lib/server/settings.ts の一覧だけにします。 */
  `CREATE TABLE IF NOT EXISTS settings (
     tenant_id  TEXT NOT NULL,
     key        TEXT NOT NULL,
     value      TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT NOT NULL,
     PRIMARY KEY (tenant_id, key)
   )`,

  /* 相場。いつ調べた値かを必ず持たせる。
     ★checked_at を省かないこと。
       古い相場で還元率を計算すると、
       「安全なはず」の数字のまま赤字のガチャが公開されます。 */
  `CREATE TABLE IF NOT EXISTS market_prices (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     sku        TEXT NOT NULL,
     name       TEXT NOT NULL,
     price      INTEGER NOT NULL,
     source     TEXT NOT NULL,
     checked_at TEXT NOT NULL,
     created_at TEXT NOT NULL,
     UNIQUE (tenant_id, sku)
   )`,

  /* 景品として使う商品 */
  `CREATE TABLE IF NOT EXISTS products (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     sku        TEXT NOT NULL,
     name       TEXT NOT NULL,
     value      INTEGER NOT NULL,
     stock      INTEGER NOT NULL DEFAULT 0,
     status     TEXT NOT NULL DEFAULT 'ACTIVE',
     created_at TEXT NOT NULL,
     UNIQUE (tenant_id, sku)
   )`,

  /* 不正の疑い */
  `CREATE TABLE IF NOT EXISTS fraud_flags (
     id          TEXT PRIMARY KEY,
     tenant_id   TEXT NOT NULL,
     user_id     TEXT NOT NULL,
     kind        TEXT NOT NULL,
     severity    TEXT NOT NULL,
     status      TEXT NOT NULL DEFAULT 'OPEN',
     detail      TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     reviewed_at TEXT,
     reviewed_by TEXT
   )`,

  /* ログインの試行。
     ★失敗も残すこと。成功だけ残す記録は、
       総当たりで攻められている最中でも、きれいなままです。 */
  `CREATE TABLE IF NOT EXISTS login_attempts (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT NOT NULL,
     subject_kind TEXT NOT NULL,
     identifier   TEXT NOT NULL,
     ok           INTEGER NOT NULL,
     reason       TEXT,
     ip           TEXT,
     user_agent   TEXT,
     created_at   TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS ix_login_attempts
     ON login_attempts (tenant_id, identifier, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_fraud_open
     ON fraud_flags (tenant_id, status, severity)`,
  `CREATE INDEX IF NOT EXISTS ix_orders_status
     ON orders (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS ix_tickets_status
     ON support_tickets (tenant_id, status)`,
];

/* ── 003：ログインとセッションを本番の形にする ──
   合言葉のほかに、画面から送り返してもらう合図（CSRF）を持たせます。
   合言葉だけだと、別のサイトに置かれたボタンを踏んだだけで
   お客様の名前のまま操作が成立してしまいます。 */
const M003: string[] = [
  `ALTER TABLE sessions ADD COLUMN csrf_hash TEXT`,
  `ALTER TABLE sessions ADD COLUMN absolute_expires_at TEXT`,
  `ALTER TABLE sessions ADD COLUMN rotated_at TEXT`,
  `ALTER TABLE sessions ADD COLUMN last_seen_at TEXT`,
  `ALTER TABLE sessions ADD COLUMN user_agent TEXT`,
  `ALTER TABLE customers ADD COLUMN last_login_at TEXT`,
  `ALTER TABLE customers ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE customers ADD COLUMN locked_until TEXT`,
  `ALTER TABLE app_users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE app_users ADD COLUMN last_login_at TEXT`,
  `ALTER TABLE app_users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE app_users ADD COLUMN locked_until TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_email
     ON customers (tenant_id, email)`,
];

/* ── 004：問い合わせと発送を、画面が使える形にする ── */
const M004: string[] = [
  `ALTER TABLE support_tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL'`,
  `ALTER TABLE support_tickets ADD COLUMN needs_human INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE support_tickets ADD COLUMN ai_draft TEXT`,
  `ALTER TABLE support_tickets ADD COLUMN answer TEXT`,
  `ALTER TABLE support_tickets ADD COLUMN answered_at TEXT`,
  `ALTER TABLE support_tickets ADD COLUMN answered_by TEXT`,
  `ALTER TABLE orders ADD COLUMN requested_at TEXT`,
  `ALTER TABLE shipments ADD COLUMN note TEXT`,
];

/* ── 005：二段階認証の使い回しを止める ──
   ★最後に通した30秒の番号を保存すること。
     保存しないと、肩越しに見られた6桁が、その30秒の間なら
     何度でも使えてしまいます。 */
const M005: string[] = [
  `ALTER TABLE app_users ADD COLUMN mfa_last_counter INTEGER`,
  `ALTER TABLE app_users ADD COLUMN mfa_enrolled_at TEXT`,
  `ALTER TABLE customers ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`,
];

const MIGRATIONS: Migration[] = [
  { name: "001_initial", sql: M001 },
  { name: "002_tenant_tables", sql: M002 },
  { name: "003_auth", sql: M003 },
  { name: "004_support_shipping", sql: M004 },
  { name: "005_mfa_replay", sql: M005 },
];

/** どの段まで済んだかを覚えておく表 */
const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
   name       TEXT PRIMARY KEY,
   applied_at TEXT NOT NULL
 )`;

/**
 * 足りていない段だけを、順番に適用する。
 *
 * 何度呼んでも安全です。済んでいる段は飛ばします。
 */
export async function migrate(): Promise<void> {
  if (migrated) return;
  const c = db();
  await c.execute("PRAGMA foreign_keys = ON");
  await c.execute(LEDGER);

  const done = new Set(
    (await c.execute("SELECT name FROM schema_migrations")).rows.map((r) =>
      String((r as Record<string, unknown>).name),
    ),
  );

  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    for (const sql of m.sql) {
      try {
        await c.execute(sql);
      } catch (e) {
        /* ★「同じ列がすでにある」だけは、済んだものとして進めること。
             001 の時代に手元で作られたDBには、
             あとから足した列がすでに入っていることがあります。
             ここで止めると、その人は作り直すしかなくなります。
             それ以外の失敗は、そのまま投げて止めます。 */
        const msg = String((e as Error)?.message ?? e);
        if (/duplicate column name/i.test(msg)) continue;
        throw new Error(`移行 ${m.name} が失敗しました: ${msg}\n  SQL: ${sql}`);
      }
    }
    await c.execute({
      sql: `INSERT INTO schema_migrations (name, applied_at) VALUES (?,?)`,
      args: [m.name, new Date().toISOString()],
    });
  }

  migrated = true;
}

/** いま適用済みの段の名前（確認用） */
export async function appliedMigrations(): Promise<string[]> {
  await migrate();
  const res = await db().execute(
    "SELECT name FROM schema_migrations ORDER BY name ASC",
  );
  return res.rows.map((r) => String((r as Record<string, unknown>).name));
}

/** 一覧に書いてある段の名前（確認用） */
export function knownMigrations(): string[] {
  return MIGRATIONS.map((m) => m.name);
}

/* ══════════════════════════════════════════════
   書き込みの順番待ち
   ══════════════════════════════════════════════ */

let queue: Promise<unknown> = Promise.resolve();

/**
 * 書き込みを1件ずつ、取引としてまとめて実行する。
 *
 * 途中で例外が出たら全部やめる（ロールバック）。
 * 「ポイントだけ減って景品が付かない」を、構造として起こせなくする。
 */
export async function withWriteTx<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  await migrate();

  const run = queue.then(async () => {
    const tx = await db().transaction("write");
    try {
      const out = await fn(tx);
      await tx.commit();
      return out;
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        /* すでに閉じている場合は何もしない */
      }
      throw e;
    }
  });

  /* 次の人が待てるように、成功しても失敗しても列は進める */
  queue = run.then(
    () => undefined,
    () => undefined,
  );

  return run as Promise<T>;
}
