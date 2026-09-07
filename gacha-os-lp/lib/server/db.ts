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

/**
 * DBへの問い合わせを、絶対に使い回させないための取り決め。
 *
 * ═══════════════════════════════════════════════════════
 * ★これを外すと、画面が「昨日の中身」を出し続けます
 * ═══════════════════════════════════════════════════════
 *
 *   遠くのDB（Turso / libSQL）へは、HTTP で問い合わせます。
 *   そして Next.js は、HTTP の問い合わせを、
 *   何も言わなければ「同じものなら前の答えを使い回す」形で
 *   覚えてしまいます（fetch のキャッシュ）。
 *
 *   何が起きるか。実際に起きたことを、そのまま書きます（2026-08-26）。
 *
 *       ① お客様が、お届け先の画面を開く
 *          → 「本人確認は、まだです」を読む（この答えが覚えられる）
 *       ② その場でパスワードを入れ直す
 *          → DBには「確認しました」と、ちゃんと書かれる
 *       ③ もう一度、住所を変えようとする
 *          → サーバーは①の覚えを読み、「まだです」と断る
 *
 *   ずっと断られます。1分待っても直りません。
 *   DBには正しく書かれているのに、です。
 *
 *   ★これは、その1画面の話では終わりません。
 *     同じことが、次のどれにも起こります。
 *
 *         ・保有ポイントが、使った後も減らないまま見える
 *         ・発送済みにしたのに、お客様の画面は「準備中」のまま
 *         ・権限を外した担当者が、外す前の権限のまま通る
 *         ・締め出したはずのアカウントが、まだ入れる
 *
 *     いちばん危ないのは、下の2つです。
 *     「権限を外したのに、外れていない」は、事故ではなく事件になります。
 *
 *   ★ですので、DBの問い合わせだけは、必ず毎回、本物を読みます。
 *     速さのためにここを緩めないこと。
 *     緩めた瞬間、画面はどこかで嘘をつき始めます。
 *     しかも、嘘をついていることが誰にも分かりません。
 *
 *   ★手元（file: の保存先）では、この不具合は起きません。
 *     HTTP を使わないからです。
 *     つまり、手元の検査では絶対に見つかりません。
 *     見つかったのは、実際に公開先へ出して、押してみたときでした。
 *     この一件を、「公開先で実際に押して確かめる」をやめない理由にしてください。
 */
const yomikaeshinaiFetch = (input: unknown, init?: Record<string, unknown>) =>
  fetch(input as RequestInfo, {
    ...(init as RequestInit),
    cache: "no-store",
  });

export function db(): Client {
  if (!client) {
    client = createClient({
      url: databaseUrl(),
      authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
      fetch: yomikaeshinaiFetch,
    });
  }
  return client;
}

/**
 * 使い終わった接続の置き場（★試験のときだけ）。
 *
 * ここに入れておくと、掃除係（GC）が「もう誰も使っていない」と
 * 判断しなくなるので、後片付けが動きません。
 */
const keptForTests: Client[] = [];

/**
 * 試験のあとで接続を捨てる。
 *
 * ═══════════════════════════════════════════════
 * ★試験のときは、閉じません
 * ═══════════════════════════════════════════════
 *
 *   DBの部品（@libsql/client の機械語で書かれた部分）は、
 *   閉じたあとの後片付けに不具合があります。
 *   閉じると、少し遅れて、すでに無いものを触りに行って落ちます（SIGSEGV）。
 *
 *   実機の記録で、落ちている場所は確認済みです。
 *
 *       napi の Finalize → index.node（DBの部品）
 *
 *   これは試験の中身とは関係のない場所です。
 *   けれども赤くなるので、20回に4回ほど「全部okなのに失敗」が出ていました。
 *   ★赤いのに直す場所が無い試験は、いちばん危険です。
 *     人はやがて赤を無視するようになり、そうなった試験は何も守りません。
 *
 *   そこで、試験のときは閉じないことにしました。
 *   閉じなければ、後片付けも動きません。
 *
 * ═══════════════════════════════════════════════
 * ★ここが安全な理由
 * ═══════════════════════════════════════════════
 *
 *   ・試験は、使い捨ての一時ファイルにしかつないでいません
 *     （tests/helpers/testDb.ts が接続先を固定しています）。
 *   ・1つの試験ファイルで開く数はたかが知れています。
 *     プロセスが終われば、OSがまとめて片付けます。
 *   ・そのぶん「自分から終われない」プロセスになりますが、
 *     合否を言い終えたあとの話なので、
 *     scripts/run-tests.mjs 側で終わらせます。
 *
 *   ★本番（DATABASE_ENV が test 以外）では、これまでどおり閉じます。
 *     本番で閉じないと、接続が増え続けます。
 */
export async function resetDbForTests(): Promise<void> {
  const c = client;
  client = null;
  migrated = false;
  if (!c) return;

  if ((process.env.DATABASE_ENV ?? "").trim() === "test") {
    /* ★閉じない。掴んだまま置いておきます。 */
    keptForTests.push(c);
    return;
  }

  c.close();
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

/* ── 006：ポイント変更の「申請」と「承認」を、保存する場所を作る ──

   ★これまで、二人承認は画面の中だけの話でした。
     画面を閉じれば消えます。つまり、
     「誰が申請して、誰が承認したか」が残っていませんでした。

     ポイントは、お金と同じものです。
     お金が動いたのに、動かした人が残らない仕組みは、
     不正を止められないだけでなく、
     疑われた担当者の身も守れません。

   ★申請と承認を、必ず別の行として残すこと。
     1行に「承認済み」とだけ書く作りにすると、
     申請者と承認者が同じ人だったかどうかが、あとから分かりません。 */
const M006: string[] = [
  `CREATE TABLE IF NOT EXISTS point_adjustments (
     id            TEXT PRIMARY KEY,
     tenant_id     TEXT NOT NULL,
     /* 対象のお客様 */
     user_id       TEXT NOT NULL,
     /* 増やす（＋）か、減らす（−）か。0は受け付けない */
     delta         INTEGER NOT NULL,
     /* なぜ動かすのか。空を受け付けないこと */
     reason        TEXT NOT NULL,
     /* PENDING / APPROVED / REJECTED */
     status        TEXT NOT NULL DEFAULT 'PENDING',
     requested_by  TEXT NOT NULL,
     requested_at  TEXT NOT NULL,
     decided_by    TEXT,
     decided_at    TEXT,
     decided_note  TEXT,
     /* 承認して、実際に台帳へ足した行。1件の申請につき、多くて1つ */
     ledger_id     TEXT
   )`,

  /* ★同じ申請から、二度お金を出せないようにする。
       「承認」を2回押されても、2行目は入りません。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_point_adj_ledger
     ON point_adjustments (ledger_id)
     WHERE ledger_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS ix_point_adj_status
     ON point_adjustments (tenant_id, status, requested_at)`,
];

/* ── 007：仮パスワードと、パスワードの作り直し ──

   ★仮パスワードを、ふつうのパスワードと同じ扱いにしないこと。

     仮パスワードは、たいてい人の手を通って渡されます。
     チャットに貼られ、口で伝えられ、付箋に書かれます。
     つまり「渡した先から漏れていく前提」のものです。

     だから、次の2つを、覚えておく必要があります。

         ① いつまで使えるか（temp_password_expires_at）
         ② もう使われたか　（temp_password_used_at）

     ②が大事です。期限内でも、一度使われたなら、
     二度目はもう本人ではない可能性があります。
     半年前のチャット履歴から拾われた仮パスワードが、
     まだ通る仕組みにしないこと。

   ★mfa_required を、mfa_enabled と別に持つ理由。

     「管理者は全員、二段階認証を必須にする」を、
     ある日いっせいに効かせると、その日から全員が入れなくなります。
     認証アプリの登録は、その場ですぐ終わる作業ではありません。

     だから「この人からは必須」を1人ずつ立てられるようにします。
     新しく仮パスワードを発行した人は、その時点で必須になります。

   ★パスワードの作り直し（reset）は、表だけ先に作ります。
     合言葉そのものは保存しません（token_hash だけ）。
     保存すると、この表を見た人が、誰にでも成りすませます。 */
const M007: string[] = [
  `ALTER TABLE app_users ADD COLUMN password_changed_at TEXT`,
  `ALTER TABLE app_users ADD COLUMN temp_password_expires_at TEXT`,
  `ALTER TABLE app_users ADD COLUMN temp_password_used_at TEXT`,
  `ALTER TABLE app_users ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE customers ADD COLUMN password_changed_at TEXT`,

  `CREATE TABLE IF NOT EXISTS password_resets (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT NOT NULL,
     subject_kind TEXT NOT NULL,
     subject_id   TEXT NOT NULL,
     /* ★合言葉そのものは入れない。照合できる形だけを入れる */
     token_hash   TEXT NOT NULL UNIQUE,
     expires_at   TEXT NOT NULL,
     used_at      TEXT,
     created_at   TEXT NOT NULL,
     created_ip   TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS ix_password_resets_subject
     ON password_resets (tenant_id, subject_kind, subject_id, created_at)`,
];

/* ── 008：注文（Order）と発送（Shipment）を、別の実体に分ける ──

   ═══════════════════════════════════════════════════════
   ★なぜ分けるのか
   ═══════════════════════════════════════════════════════

     これまで orders は「1行＝1景品＝1発送」でした。
     画面もひとつで足りていました。ただ、この形は、
     現場でいちばん普通に起きることを、そもそも表現できません。

       ・3点まとめて依頼が来たが、2点だけ先に送りたい
       ・残り1点は取り寄せで、来週になる
       ・送り状を出したあとで、1点だけ破損が見つかって送り直す

     1行に全部を持たせていると、この「2点だけ」が書けません。
     書けないので、運用は必ず画面の外へ逃げます。
     Excelとチャットで管理が始まり、システムは実態を知らなくなります。

   ★注文と発送は、変わるタイミングが違います。

       注文（Order）   … 誰が・いつ・何を・いくらで買ったか。
                         確定したら、もう動きません。
       発送（Shipment）… 何を・どこへ・どう送るか。
                         1つの注文から、何度でも立ちます。

     動かないものと、何度も動くものを、同じ行に置かないこと。

   ═══════════════════════════════════════════════════════
   ★二重発送を、DBの側で止める
   ═══════════════════════════════════════════════════════

     「同じ商品を2回送らない」を、画面のボタンで守ってはいけません。
     ボタンは、二重クリック・再読み込み・2枚のタブ・直接の通信で、
     いくらでもすり抜けます。

     そこで shipment_items に
         UNIQUE (tenant_id, order_item_id) WHERE released_at IS NULL
     を置きます。生きている割り当ては、1つの明細につき、必ず1つだけ。
     2つ目を入れようとした瞬間、DBが断ります。

   ★キャンセルで「行を消す」を選ばなかった理由。

     消せば確かに、また送れるようになります。
     ただ、消した瞬間に「一度この発送に入っていた」という事実も消えます。
     あとで「なぜこの商品が2回梱包されたのか」を調べるとき、
     いちばん見たい行が、もう無いことになります。

     だから消さずに released_at（外した時刻）を入れます。
     履歴は残り、鍵だけが空きます。

   ═══════════════════════════════════════════════════════
   ★古い orders / shipments は、消さずに横へ置きます
   ═══════════════════════════════════════════════════════

     消すと、検証用のDBに入っている行が、確認する前に無くなります。
     名前を変えて残せば、後から中身を見比べられます。 */
const M008: string[] = [
  `ALTER TABLE orders RENAME TO orders_v1`,
  `ALTER TABLE shipments RENAME TO shipments_v1`,

  /* ── 注文（何を買ったか。確定したら動かない） ───────── */
  `CREATE TABLE IF NOT EXISTS orders (
     id             TEXT PRIMARY KEY,
     tenant_id      TEXT NOT NULL,
     user_id        TEXT NOT NULL,
     /* 人が口に出して言える番号。IDは長すぎて電話で読めません */
     order_number   TEXT NOT NULL,
     ordered_at     TEXT NOT NULL,
     /* PRIZE_SHIPPING（当たった景品の発送）/ PURCHASE（買い物） */
     order_type     TEXT NOT NULL,
     subtotal       INTEGER NOT NULL DEFAULT 0,
     discount       INTEGER NOT NULL DEFAULT 0,
     point_used     INTEGER NOT NULL DEFAULT 0,
     total          INTEGER NOT NULL DEFAULT 0,
     /* UNPAID / PAID / POINT_ONLY / REFUNDED */
     payment_status TEXT NOT NULL,
     /* PENDING / PAID / PARTIALLY_FULFILLED / FULFILLED / CANCELLED */
     order_status   TEXT NOT NULL,
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL,
     UNIQUE (tenant_id, order_number)
   )`,

  /* ── 注文の明細 ─────────────────────────────
     ★item_name_snapshot を必ず持たせること。
       商品マスターの名前を後から直したとき、
       去年の注文書の品名まで一緒に変わってはいけません。
       注文は「そのとき何を頼んだか」の記録です。 */
  `CREATE TABLE IF NOT EXISTS order_items (
     id                 TEXT PRIMARY KEY,
     tenant_id          TEXT NOT NULL,
     order_id           TEXT NOT NULL,
     /* どちらか一方。景品なら prize_id、商品なら product_id */
     prize_id           TEXT,
     product_id         TEXT,
     item_name_snapshot TEXT NOT NULL,
     quantity           INTEGER NOT NULL,
     unit_value         INTEGER NOT NULL,
     /* いま発送に割り当てられている数（キャンセルされたぶんは戻る） */
     assigned_quantity  INTEGER NOT NULL DEFAULT 0,
     /* 実際に発送が確定した数 */
     shipped_quantity   INTEGER NOT NULL DEFAULT 0,
     /* UNSHIPPED / PARTIALLY_SHIPPED / SHIPPED / CANCELLED */
     status             TEXT NOT NULL DEFAULT 'UNSHIPPED',
     created_at         TEXT NOT NULL,
     updated_at         TEXT NOT NULL
   )`,

  /* ★同じ景品を、2つの注文へ入れられないようにする。
       「発送依頼」を2回押されても、2件目は入りません。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_order_items_prize
     ON order_items (tenant_id, prize_id)
     WHERE prize_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS ix_order_items_order
     ON order_items (tenant_id, order_id)`,

  /* ── 発送（どこへ・どう送るか。何度でも立つ） ───────── */
  `CREATE TABLE IF NOT EXISTS shipments (
     id                        TEXT PRIMARY KEY,
     tenant_id                 TEXT NOT NULL,
     order_id                  TEXT NOT NULL,
     user_id                   TEXT NOT NULL,
     shipment_number           TEXT NOT NULL,
     /* ★会員情報の住所を参照しないこと。
          参照にすると、お客様が引っ越した瞬間、
          すでに箱に貼った送り状と、画面の宛先が食い違います。
          ここには、作った時点の宛先を「写して」持ちます。 */
     shipping_address_snapshot TEXT NOT NULL,
     carrier                   TEXT,
     tracking_number           TEXT,
     /* REQUESTED / PREPARING / READY / SHIPPED / IN_TRANSIT / DELIVERED / CANCELLED */
     shipment_status           TEXT NOT NULL,
     requested_at              TEXT NOT NULL,
     packed_at                 TEXT,
     shipped_at                TEXT,
     delivered_at              TEXT,
     cancelled_at              TEXT,
     note                      TEXT,
     created_at                TEXT NOT NULL,
     updated_at                TEXT NOT NULL,
     UNIQUE (tenant_id, shipment_number)
   )`,

  /* ★同じ追跡番号を、2つの発送へ登録できないようにする。
       配送業者が違えば同じ番号があり得るので、業者ごとに1つとします。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_tracking
     ON shipments (tenant_id, carrier, tracking_number)
     WHERE tracking_number IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS ix_shipments_order
     ON shipments (tenant_id, order_id)`,
  `CREATE INDEX IF NOT EXISTS ix_shipments_status
     ON shipments (tenant_id, shipment_status, requested_at)`,

  /* ── 発送の中身（どの明細を、この箱に入れたか） ──────── */
  `CREATE TABLE IF NOT EXISTS shipment_items (
     id            TEXT PRIMARY KEY,
     tenant_id     TEXT NOT NULL,
     shipment_id   TEXT NOT NULL,
     order_id      TEXT NOT NULL,
     order_item_id TEXT NOT NULL,
     quantity      INTEGER NOT NULL,
     name_snapshot TEXT NOT NULL,
     created_at    TEXT NOT NULL,
     /* 発送をやめたときに入る。行は消さない（上の説明のとおり） */
     released_at   TEXT
   )`,

  /* ★これが二重発送を止める本体です。ここを外さないこと。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_items_live
     ON shipment_items (tenant_id, order_item_id)
     WHERE released_at IS NULL`,

  `CREATE INDEX IF NOT EXISTS ix_shipment_items_shipment
     ON shipment_items (tenant_id, shipment_id)`,

  `CREATE INDEX IF NOT EXISTS ix_orders_status_v2
     ON orders (tenant_id, order_status, ordered_at)`,

  /* 番号の採番用。会社ごと・種類ごとに1から数える */
  `CREATE TABLE IF NOT EXISTS number_series (
     tenant_id TEXT NOT NULL,
     kind      TEXT NOT NULL,
     next_no   INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, kind)
   )`,
];

/* ── 009：お知らせと、依頼した時点の宛先 ──
 *
 * ★なぜ「通知」を表にするのか。
 *   メールは、届いたかどうかを、こちらから確かめられません。
 *   迷惑メールに入れば、お客様は永久に気づきません。
 *   そのとき「送りました」と言えるのは、送った記録がある場合だけです。
 *   だから、まず自分の中に残します。
 *   外の会社（メール・SMS）へつなぐのは、そのあとです。
 *
 * ★なぜ「注文に宛先の写し」を足すのか。
 *   いまは、運営が箱を作るときに会員情報の住所を写しています。
 *   すると、お客様が発送を依頼した後・箱ができる前に住所を変えると、
 *   お客様が確認した宛先と、実際に送る宛先が、静かに食い違います。
 *   お客様は「この住所でお願いします」と押しています。
 *   その押した内容を、注文の側にも残します。
 */
const M009: string[] = [
  /* お知らせ。1件ずつ、誰に・何を・どの経路で出したか */
  `CREATE TABLE IF NOT EXISTS notifications (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT NOT NULL,
     user_id      TEXT NOT NULL,
     kind         TEXT NOT NULL,      /* SHIPMENT_SHIPPED / SHIPMENT_DELIVERED など */
     channel      TEXT NOT NULL,      /* INAPP / EMAIL / SMS */
     provider     TEXT NOT NULL,      /* MOCK … 本物の配信会社につないだら、その名前 */
     provider_ref TEXT,               /* 配信会社が返した番号（Mockは自前の番号） */
     status       TEXT NOT NULL,      /* QUEUED / SENT / FAILED */
     title        TEXT NOT NULL,
     body         TEXT NOT NULL,
     ref_kind     TEXT,               /* SHIPMENT / ORDER / PRIZE */
     ref_id       TEXT,
     created_at   TEXT NOT NULL,
     sent_at      TEXT,
     read_at      TEXT,
     /* ★同じ出来事で2通目を作らないための鍵。
          運営が「発送済み」を押し直すたびにお知らせが増えると、
          お客様には同じ文面が何度も届きます。 */
     dedupe_key   TEXT NOT NULL
   )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe
     ON notifications (tenant_id, dedupe_key)`,

  `CREATE INDEX IF NOT EXISTS ix_notifications_user
     ON notifications (tenant_id, user_id, created_at)`,

  /* 依頼した時点の宛先。以後この注文は会員情報の住所を見ない */
  `ALTER TABLE orders ADD COLUMN shipping_address_snapshot TEXT`,

  /* お届け先を最後に変えた時刻。
     ★これが無いと「住所を変えた直後の発送依頼」を見分けられません。
       乗っ取りは、住所を書き換えてすぐ高いものを送らせます。 */
  `ALTER TABLE customers ADD COLUMN address_changed_at TEXT`,

  `CREATE INDEX IF NOT EXISTS ix_support_tickets_user
     ON support_tickets (tenant_id, user_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS ix_point_ledger_user
     ON point_ledger (tenant_id, user_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS ix_prizes_user
     ON prizes (tenant_id, user_id, won_at)`,
];

/* ── 010：問い合わせの状態を、運営が使える5つに正す ──
 *
 * ★これまで status には 'OPEN' しか入っていませんでした。
 *   「まだ誰も見ていない」も「AIが答えた」も「人が見なければいけない」も、
 *   全部おなじ 'OPEN' でした。これでは運営の方は、
 *   一覧を上から全部開いて中身を読むまで、何をすべきか分かりません。
 *
 * ★これから使う5つ。
 *     NEW          … 届いたばかり。まだ誰も触っていない
 *     AI_REPLIED   … AIが一次回答した。人の確認は要らないと判断された
 *     HUMAN_REVIEW … AIが「これは人が見るべき」と判断した
 *     IN_PROGRESS  … 人が対応中
 *     RESOLVED     … 終わった
 *
 * ★いま入っている 'OPEN' は、消さずに読み替えること。
 *   needs_human が立っていたものは HUMAN_REVIEW、
 *   それ以外は NEW にします。
 *   「分からないから全部 NEW」にすると、
 *   人が見るべきものが、その他大勢に紛れて消えます。
 */
const M010: string[] = [
  `UPDATE support_tickets
      SET status = 'HUMAN_REVIEW'
    WHERE status = 'OPEN' AND needs_human = 1`,

  `UPDATE support_tickets
      SET status = 'NEW'
    WHERE status = 'OPEN'`,

  /* 誰が担当しているか。★空のままにできること。
     「必ず誰かに割り当てる」形にすると、
     割り当て先を決めるまで受け付けられなくなります */
  `ALTER TABLE support_tickets ADD COLUMN assignee_id TEXT`,
  `ALTER TABLE support_tickets ADD COLUMN assignee_name TEXT`,

  /* 分類。AIが付けた見立ても、ここに入る */
  `ALTER TABLE support_tickets ADD COLUMN category TEXT`,

  /* 最後に動いた時刻。一覧の並び替えに使う */
  `ALTER TABLE support_tickets ADD COLUMN updated_at TEXT`,

  `UPDATE support_tickets SET updated_at = created_at WHERE updated_at IS NULL`,

  `CREATE INDEX IF NOT EXISTS ix_support_tickets_status
     ON support_tickets (tenant_id, status, updated_at)`,
];

/**
 * ═══════════════════════════════════════════════════════
 * 011 ガチャの「いつ公開したか」と「検証の結果」を、DBに残す
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、ガチャ管理の画面に出ていた
 *   「公開日時」と「検証：SAFE」は、画面の中の見本でした。
 *   ページを読み込み直すと消えました。
 *
 *   ★公開した時刻は、あとから絶対に必要になります。
 *     「いつから売っていたのか」は、返金・問い合わせ・
 *     税の計算で、必ず聞かれます。
 *     そのとき「画面には出ていたが、どこにも残っていない」では、
 *     答えようがありません。
 *
 *   ★検証の結果も同じです。
 *     公開前の検証は「危ない構成を、公開の前で止める」ためのものです。
 *     結果が残っていなければ、
 *     「検証を通したから公開した」ことを、あとから示せません。
 *     示せない検証は、やっていないのと同じ扱いになります。
 *
 * ★すでにあるガチャの公開日時を、created_at で埋めないこと。
 *
 *   作った日と公開した日は、違います。
 *   埋めた瞬間に、それは「記録」ではなく「作り話」になります。
 *   分からないものは空のままにして、
 *   画面には「不明（この機能より前に公開されました）」と出します。
 *   空欄は、間違った日付より、ずっと安全です。
 */
const M011: string[] = [
  /* いつ公開したか。★分からないものは空のまま */
  `ALTER TABLE gachas ADD COLUMN published_at TEXT`,

  /* いつ止めたか・なぜ止めたか。
     ★理由を必ず持てるようにすること。
       「PAUSED」とだけ残っていても、
       自分で止めたのか、危なくて止まったのかが分かりません */
  `ALTER TABLE gachas ADD COLUMN paused_at TEXT`,
  `ALTER TABLE gachas ADD COLUMN pause_reason TEXT`,

  /* 公開前検証の結果。
     verdict は SAFE / CAUTION / DANGER。空なら「まだ検証していない」 */
  `ALTER TABLE gachas ADD COLUMN backtest_verdict TEXT`,
  `ALTER TABLE gachas ADD COLUMN backtest_stress TEXT`,
  `ALTER TABLE gachas ADD COLUMN backtest_at TEXT`,

  /* あとから同じ結果を出し直すために要るもの。
     ★これが無いと、検証結果はただの感想になります。
       同じ道具・同じ種で回せば同じ答えが出る、が検証の前提です */
  `ALTER TABLE gachas ADD COLUMN backtest_engine TEXT`,
  `ALTER TABLE gachas ADD COLUMN backtest_seed INTEGER`,

  /* 検証したときの構成そのもの（JSON）。
     ★構成を変えたのに古い判定が残る、を見つけるために保存します */
  `ALTER TABLE gachas ADD COLUMN backtest_spec TEXT`,

  /* 一覧は「新しい順」に出すので、並べ替えを速くしておく */
  `CREATE INDEX IF NOT EXISTS ix_gachas_tenant_status
     ON gachas (tenant_id, status, created_at)`,
];

/* ── 012：ポイント調整に「そのときの残高」を持たせる ──

   ★申請書に、そのときの残高を書き写しておく理由。

     ポイントの申請は、出したその日に承認されるとは限りません。
     出した人は「いま 120,000pt ある人から 100,000pt 引く」つもりでした。
     ところが承認されるまでの間に、その方がガチャを引いて
     残高が 20,000pt になっていることがあります。

     このとき、申請時の残高を残していないと、
     承認する人は「何を見て承認したのか」を説明できません。
     残しておけば、承認画面で

         申請したとき 120,000pt ／ いま 20,000pt

     と並べて出せます。並べて出せば、人が気づけます。

   ★balance_before を「正しい残高」として使い回さないこと。

     反映するときの計算は、必ずそのときの残高を読み直して行います。
     書き写した古い残高で上書きすると、
     承認を待っている間に動いたポイントが、まるごと消えます。
     balance_before は、あくまで「承認する人に見せるための記録」です。

   ★idempotency_key を持つ理由。

     承認ボタンと同じで、申請ボタンも二度押されます。
     押した人に悪気はありません。通信が遅いだけです。
     鍵が同じなら、2件目の申請は作らず、1件目をそのまま返します。

   ★status に APPLIED を足す理由。

     二人承認が要らない金額は、その場で反映されます。
     これを APPROVED と書くと、
     「誰かが承認した」ように読めてしまいます。
     承認していないものを承認済みと書かないこと。 */
const M012: string[] = [
  /* 申請を出したときの残高。★あとで書き換えないこと */
  `ALTER TABLE point_adjustments ADD COLUMN balance_before INTEGER`,
  /* 反映を決めたときに読み直した残高。申請時とずれていたら、それが分かる */
  `ALTER TABLE point_adjustments ADD COLUMN balance_at_decision INTEGER`,
  /* 実際に反映したあとの残高 */
  `ALTER TABLE point_adjustments ADD COLUMN balance_after INTEGER`,
  /* いつ台帳へ足したか。PENDING のあいだは空 */
  `ALTER TABLE point_adjustments ADD COLUMN applied_at TEXT`,
  /* 二人承認が必要だったか。★あとから基準を変えても、当時の判断が残る */
  `ALTER TABLE point_adjustments ADD COLUMN needs_approval INTEGER NOT NULL DEFAULT 1`,
  /* 二度押し対策の鍵 */
  `ALTER TABLE point_adjustments ADD COLUMN idempotency_key TEXT`,

  `CREATE UNIQUE INDEX IF NOT EXISTS ux_point_adj_idem
     ON point_adjustments (tenant_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL`,

  /* 会員ごとの申請履歴を、詳細画面で新しい順に出すため */
  `CREATE INDEX IF NOT EXISTS ix_point_adj_user
     ON point_adjustments (tenant_id, user_id, requested_at)`,
];

/**
 * ═══════════════════════════════════════════════════════
 * 013 問い合わせを「1往復」から「やり取り」にする
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、問い合わせの返事は support_tickets の
 *   answer という1つの欄に入っていました。
 *   つまり、返事は**1回しか持てません**。
 *
 *   実際の問い合わせは、こう進みます。
 *
 *       お客様「届きません」
 *         AI 「発送済みです。番号はこちらです」
 *       お客様「その番号だと出てきません」
 *         人 「確認します。少しお待ちください」
 *         人 「再発送しました」
 *
 *   1つの欄では、この2件目以降が入りません。
 *   入れようとすると、前の返事を上書きすることになります。
 *   上書きすると、
 *
 *       「そんな案内はされていない」と言われたときに、
 *        されていないことを示す記録も、
 *        したことを示す記録も、どちらも残っていない
 *
 *   状態になります。これは、あとから絶対に取り返せません。
 *
 * ★誰が言ったのかを、必ず持たせること。
 *   お客様・AI・担当者の3種類です。
 *   ここを混ぜると「AIが勝手に答えた」のか
 *   「人が読んで送った」のかが分からなくなります。
 *   苦情が来たとき、いちばん先に問われるのがここです。
 *
 * ★消さずに、直した跡を残すこと（edited_*）。
 *   送ったあとの文面を、黙って書き換えられる作りにしないこと。
 *   書き換えられるなら、記録は証拠になりません。
 *
 * ★いまある本文と返事は、捨てずに1件目・2件目として移すこと。
 *   「新しい仕組みにしたので、前のやり取りは見られません」は、
 *   お客様には通じません。
 */
const M013: string[] = [
  `CREATE TABLE IF NOT EXISTS ticket_messages (
     id          TEXT PRIMARY KEY,
     tenant_id   TEXT NOT NULL,
     ticket_id   TEXT NOT NULL,
     /* その問い合わせの中での並び。1から数える。
        ★時刻で並べないこと。同じ秒に2件入ると順序が定まりません */
     seq         INTEGER NOT NULL,
     /* CUSTOMER / AI / STAFF。★この3つ以外を入れないこと */
     author_kind TEXT NOT NULL,
     author_id   TEXT,
     author_name TEXT NOT NULL,
     body        TEXT NOT NULL,
     /* AIが何を見て書いたか（JSON）。
        ★内部の番号はお客様には見せない。運営が確かめるためのもの */
     sources     TEXT,
     created_at  TEXT NOT NULL,
     /* 送ったあとに直した跡。直していなければ空 */
     edited_at   TEXT,
     edited_by   TEXT,
     original_body TEXT
   )`,

  /* ★同じ並び番号を2件入れられないようにすること。
       2人が同時に返信しても、片方が必ず取り直しになります。
       ここが無いと、同時返信で順序が入れ替わります */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_messages_seq
     ON ticket_messages (tenant_id, ticket_id, seq)`,

  `CREATE INDEX IF NOT EXISTS ix_ticket_messages_ticket
     ON ticket_messages (tenant_id, ticket_id, seq)`,

  /* いまある問い合わせの本文を、1件目のお客様の発言として移す */
  `INSERT INTO ticket_messages
     (id, tenant_id, ticket_id, seq, author_kind, author_id, author_name,
      body, created_at)
   SELECT 'tmsg_mig1_' || t.id, t.tenant_id, t.id, 1, 'CUSTOMER',
          t.user_id,
          COALESCE((SELECT c.name FROM customers c
                     WHERE c.tenant_id = t.tenant_id AND c.id = t.user_id),
                   'お客様'),
          t.body, t.created_at
     FROM support_tickets t
    WHERE NOT EXISTS (SELECT 1 FROM ticket_messages m
                       WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id
                         AND m.seq = 1)`,

  /* すでに返事があるものを、2件目として移す。
     ★誰が書いたか分からないものを「AI」にしないこと。
       answered_by が空なら、分からないまま「担当者」とだけ書きます */
  `INSERT INTO ticket_messages
     (id, tenant_id, ticket_id, seq, author_kind, author_id, author_name,
      body, created_at)
   SELECT 'tmsg_mig2_' || t.id, t.tenant_id, t.id, 2, 'STAFF',
          t.answered_by,
          COALESCE(t.answered_by, '担当者'),
          t.answer, COALESCE(t.answered_at, t.updated_at, t.created_at)
     FROM support_tickets t
    WHERE t.answer IS NOT NULL AND TRIM(t.answer) <> ''
      AND NOT EXISTS (SELECT 1 FROM ticket_messages m
                       WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id
                         AND m.seq = 2)`,

  /* AIが人へ回したときの理由。★理由なしで回させないための置き場 */
  `ALTER TABLE support_tickets ADD COLUMN escalate_reason TEXT`,

  /* いつAIが一次回答したか。★answered_at と分けること。
     混ぜると「人が答えた時刻」が上書きされます */
  `ALTER TABLE support_tickets ADD COLUMN ai_replied_at TEXT`,

  /* 一覧の並び替え用。updated_at が空のものを埋める */
  `UPDATE support_tickets SET updated_at = created_at WHERE updated_at IS NULL`,
];

/**
 * 「見るだけ」のセッションを、DBの側で区別できるようにする。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、役職だけで済ませないのか
 * ═══════════════════════════════════════════════════════
 *
 *   見学の方に「閲覧のみ（VIEWER）」を渡せば、
 *   確かに何も壊せません。ですが、見えるものも減ります。
 *   不正対策・セキュリティ・監査ログ・設定は開けません。
 *   つまり「うちの管理画面はここまでできます」を、
 *   いちばん見せたい相手に見せられなくなります。
 *
 *   ★見えることと、動かせることは、別の話です。
 *     ここを役職1本でやろうとすると、必ずどちらかを諦めます。
 *
 *   だから、セッションそのものに印を付けます。
 *   印の付いたセッションは、役職が何であっても、
 *   状態が変わる依頼を1つも通しません（lib/server/context.ts）。
 *
 * ★既定は 0（ふつうのセッション）にすること。
 *   既定を1にすると、移行した瞬間に全員が何もできなくなります。
 */
const M014: string[] = [
  `ALTER TABLE sessions ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0`,
];

/**
 * お客様が、ご自分で会員登録できるようにする。
 *
 * ═══════════════════════════════════════════════════════
 * ★これまで、お客様を作れるのは開発者だけでした
 * ═══════════════════════════════════════════════════════
 *
 *   顧客側にも管理側にも、会員を作る画面が1つもありませんでした。
 *   種まき（seed.ts）と試験用の道具からしか作れません。
 *   つまり、お店を開いても、お客様が1人も増えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★メールアドレスの重複を、DBの側で止めること
 * ═══════════════════════════════════════════════════════
 *
 *   「登録の入口で、同じメールが無いか調べてから入れる」だけでは、
 *   同時に2通送られたときに、2件とも「無い」と答えてしまいます。
 *   調べてから入れるまでの間に、もう1件が入るからです。
 *
 *   ですから、DBに index を張って、DBに断らせます。
 *   大文字小文字は同じものとして扱います（Taro@ と taro@ は同じ人）。
 *
 *   ★NULL は重複と見なされません（SQLiteの決まり）。
 *     メールを持たない古い会員（種まきで作った方）が
 *     何人いても、この index は張れます。
 *
 * ═══════════════════════════════════════════════════════
 * ★合言葉（確認用のリンク）は、そのまま保存しないこと
 * ═══════════════════════════════════════════════════════
 *
 *   password_resets と同じ形にします。
 *   DBを覗かれても、そこから確認リンクを組み立てられません。
 */
const M015: string[] = [
  /* メール確認が済んだ時刻。null のうちは「まだ確認していない」 */
  `ALTER TABLE customers ADD COLUMN email_verified_at TEXT`,

  /* ★同意した時刻を、必ず残すこと。
       「同意しました」の1文字（1/0）だけでは、
       規約を改定した日より前の同意なのか後なのかが分かりません。 */
  `ALTER TABLE customers ADD COLUMN terms_agreed_at TEXT`,
  `ALTER TABLE customers ADD COLUMN privacy_agreed_at TEXT`,

  /* ご自分で登録された方か、お店が作った方か */
  `ALTER TABLE customers ADD COLUMN signup_source TEXT`,
  `ALTER TABLE customers ADD COLUMN signup_ip TEXT`,

  /* ★同じ会社の中で、同じメールアドレスは1人だけ。
       会社が違えば同じメールでかまいません（別のお店の会員です）。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_tenant_email
     ON customers (tenant_id, lower(email))
   WHERE email IS NOT NULL`,

  /* メール確認の合言葉。中身は入れず、照合できる形だけを入れる */
  `CREATE TABLE IF NOT EXISTS email_verifications (
     id          TEXT PRIMARY KEY,
     tenant_id   TEXT NOT NULL,
     customer_id TEXT NOT NULL,
     /* 送った先。あとで変えられても、送った時点の宛先が残る */
     email       TEXT NOT NULL,
     token_hash  TEXT NOT NULL UNIQUE,
     expires_at  TEXT NOT NULL,
     used_at     TEXT,
     created_at  TEXT NOT NULL,
     created_ip  TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS ix_email_verifications_customer
     ON email_verifications (tenant_id, customer_id, created_at)`,

  /*
   * ★いま登録されている方を、全員「確認済み」にしておくこと。
   *
   *   ここを空のままにすると、移行した瞬間に、
   *   既存の会員が全員「メール未確認」になり、
   *   引くことも交換することもできなくなります。
   *
   *   メール確認は、これから登録される方のための関門です。
   *   すでにお店が作った方は、お店が確認済みと見なします。
   */
  `UPDATE customers
      SET email_verified_at = created_at,
          signup_source     = 'ADMIN'
    WHERE email_verified_at IS NULL`,
];

/**
 * ═══════════════════════════════════════════════════════
 * M016 商品の写真を、お店が自分でアップロードできるようにする
 * ═══════════════════════════════════════════════════════
 *
 * ★なぜ入れ替えるのか
 *
 *   これまで、ガチャの絵は「題名の文字」から機械が描いていました。
 *   「カード」と書いてあればカードの形、「時計」と書いてあれば時計の形。
 *
 *   ですが、お客様がお金を払って引くのは「実物」です。
 *   実物と違う絵をお見せするのは、優良誤認になりかねません。
 *   だから、お店が撮った実物の写真だけを出すように変えます。
 *
 * ★なぜ、写真を「DBの中」に入れるのか
 *
 *   置き場所（S3 など）を借りていないためです。
 *   借りていない置き場所を前提に書くと、本番で必ず落ちます。
 *   まずは確実に動く形（DBの中）にします。
 *   あとで外の置き場所に移せるよう、参照は image_id ひとつだけにします。
 *
 * ★写真の在り処を、なぜ2か所だけにするのか
 *
 *   gachas.cover_image_id … ガチャの表紙
 *   gacha_stock.image_id  … 賞（当たる中身）ごとの写真
 *
 *   当選結果も、マイページの獲得商品も、この gacha_stock を見ます。
 *   写真を prizes（当たった記録）へ写し取らないこと。
 *   写し取ると、あとで差し替えたときに古い写真が残り、
 *   「一覧では新しい写真／履歴では古い写真」とズレます。
 */
const M016: string[] = [
  /* 写真そのもの。data に中身（バイト列）が入る。
     ★sha256 は「同じ写真を二重に持たない」ためではなく、
       差し替えたときに本当に別物かを確かめるために持ちます。 */
  `CREATE TABLE IF NOT EXISTS images (
     id          TEXT PRIMARY KEY,
     tenant_id   TEXT NOT NULL,
     /* "GACHA_COVER" か "PRIZE" */
     kind        TEXT NOT NULL,
     /* image/jpeg image/png image/webp のどれか。中身を見て決めたもの */
     mime        TEXT NOT NULL,
     bytes       INTEGER NOT NULL,
     sha256      TEXT NOT NULL,
     data        BLOB NOT NULL,
     created_at  TEXT NOT NULL,
     created_by  TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS ix_images_tenant
     ON images (tenant_id, created_at)`,

  /* ガチャの表紙 */
  `ALTER TABLE gachas ADD COLUMN cover_image_id TEXT`,

  /* 賞ごとの写真 */
  `ALTER TABLE gacha_stock ADD COLUMN image_id TEXT`,
];

/**
 * ═══════════════════════════════════════════════════════
 * M017 ポイントを、お客様が自分で買えるようにする
 * ═══════════════════════════════════════════════════════
 *
 * ★いちばん大事なこと
 *
 *   「決済が成功しました」という画面を見たことを理由に、
 *   ポイントを足さないでください。
 *
 *   あの画面は、お客様のブラウザが表示しているだけです。
 *   URL を覚えて何度も開けば、その回数だけ足りてしまいます。
 *   足すのは、決済会社のサーバーから届く「確定通知」だけです。
 *
 * ★なぜ、注文に金額とポイントを写し取るのか
 *
 *   point_products（商品の設定）は、お店がいつでも変えられます。
 *   もし注文が商品を参照するだけだったら、
 *
 *       1,000円で 1,000pt の商品を、お客様が買う
 *         ↓
 *       お店が「1,000円で 500pt」に変更する
 *         ↓
 *       確定通知が届く
 *         ↓
 *       500pt しか付かない
 *
 *   となります。お客様は 1,000pt のつもりで払っています。
 *   だから、注文を作った瞬間の金額とポイントを
 *   point_orders の中へ写して固定します。
 *   あとから商品を変えても、この注文は動きません。
 *
 * ★二重に足さないための備えを、4つ重ねる
 *
 *   ① point_orders.status が 'PENDING' のときだけ 'PAID' へ動かす
 *      （条件付きの更新。2回目は0行しか動かないので、そこで止まる）
 *   ② payment_events に決済会社のイベント番号を一意で入れる
 *      （同じ通知が100回来ても、2回目は主キーで弾かれる）
 *   ③ point_ledger の ref に注文番号を入れ、注文ごとに一意にする
 *   ④ 「注文1つにつき加算1回」をテストで毎回確かめる
 *
 *   1つでも十分に見えますが、1つだと、その1つを外した日に静かに壊れます。
 */
const M017: string[] = [
  /* お店が売る「ポイント商品」。
     ★金額をコードに書かないこと。ここが唯一の正本です。 */
  `CREATE TABLE IF NOT EXISTS point_products (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT NOT NULL,
     name         TEXT NOT NULL,
     /* お客様が払う金額（円）。1円未満は扱いません */
     price_yen    INTEGER NOT NULL,
     /* 払った分として付くポイント */
     points       INTEGER NOT NULL,
     /* おまけ。0 でかまいません */
     bonus_points INTEGER NOT NULL DEFAULT 0,
     /* "ACTIVE" か "DISABLED"。消さずに止めること。
        消すと、過去の注文が何を買ったのか分からなくなります */
     status       TEXT NOT NULL DEFAULT 'ACTIVE',
     /* 画面に並べる順。小さいほど上 */
     sort_order   INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT NOT NULL,
     updated_at   TEXT NOT NULL,
     created_by   TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS ix_point_products_tenant
     ON point_products (tenant_id, status, sort_order)`,

  /* 注文。
     ★price_yen / points / bonus_points は
       「注文したその瞬間の商品の中身を写したもの」です。
       商品の設定を後から変えても、ここは絶対に書き換えないこと。 */
  `CREATE TABLE IF NOT EXISTS point_orders (
     id            TEXT PRIMARY KEY,
     tenant_id     TEXT NOT NULL,
     user_id       TEXT NOT NULL,
     product_id    TEXT NOT NULL,
     /* ↓ ここから3つが写し取り（snapshot） */
     product_name  TEXT NOT NULL,
     price_yen     INTEGER NOT NULL,
     points        INTEGER NOT NULL,
     bonus_points  INTEGER NOT NULL,
     /* "PENDING" → "PAID" / "CANCELED" */
     status        TEXT NOT NULL DEFAULT 'PENDING',
     /* "mock" / "stripe" / "gmo" */
     provider      TEXT NOT NULL,
     /* 決済会社側の番号。無い場合もある */
     provider_ref  TEXT,
     /* 実際に支払われた額。確定通知で分かる。照合に使う */
     paid_yen      INTEGER,
     /* 加算した台帳の行。PAID になったときだけ入る */
     ledger_id     TEXT,
     /* 買ったあと、どこへ戻すか。
        ★外のURLを入れさせないこと。入れるのは自サイトの中の道だけ */
     return_to     TEXT,
     created_at    TEXT NOT NULL,
     paid_at       TEXT,
     canceled_at   TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS ix_point_orders_user
     ON point_orders (tenant_id, user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_point_orders_status
     ON point_orders (tenant_id, status, created_at)`,

  /* 決済会社から届いた通知の控え。
     ★同じ通知が何度来ても、ここの主キーで2回目以降が弾かれます。
       弾かれたことも「受け取った」と記録します（黙って捨てないこと）。 */
  `CREATE TABLE IF NOT EXISTS payment_events (
     tenant_id   TEXT NOT NULL,
     provider    TEXT NOT NULL,
     /* 決済会社が付けた、その通知1回ぶんの番号 */
     event_id    TEXT NOT NULL,
     order_id    TEXT,
     /* "APPLIED"（この通知で加算した）
        "DUPLICATE"（すでに済んでいた）
        "MISMATCH"（金額が合わない。加算していない）
        "REJECTED"（受け付けられない） */
     result      TEXT NOT NULL,
     amount_yen  INTEGER,
     note        TEXT,
     created_at  TEXT NOT NULL,
     PRIMARY KEY (tenant_id, provider, event_id)
   )`,

  `CREATE INDEX IF NOT EXISTS ix_payment_events_order
     ON payment_events (tenant_id, order_id, created_at)`,

  /* ★注文1つにつき、加算の台帳行は1つだけ。
       ③の備え。ここが最後の砦です。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_purchase_ref
     ON point_ledger (tenant_id, ref)
     WHERE kind = 'PURCHASE'`,
];

/**
 * ═══════════════════════════════════════════════════════
 * M018 公開したあとで写真を直せるようにする／お金の取消に備える
 * ═══════════════════════════════════════════════════════
 *
 * ★①当選した瞬間の写真を、当たった記録へ写し取る
 *
 *   M016 では、わざと写し取りませんでした。理由はこうでした。
 *
 *     「写真を差し替えるのは、たいてい写ってはいけないものが
 *       写っていたと気づいたときだ。焼き付けると、お店がいくら
 *       差し替えても過去の履歴には古い写真が残り続けてしまう」
 *
 *   これは今でも正しい心配です。ですが、比べたときに
 *   もう一方の危険のほうが大きいと判断しました。
 *
 *     お客様が「S賞のカード」を当てた。
 *       ↓
 *     お店が S賞の写真を、別のカードの写真に差し替えた。
 *       ↓
 *     お客様の獲得商品の履歴も、勝手に別のカードに変わる。
 *
 *   これでは「私が当てたのはこれではない」と言われたときに、
 *   こちらには何も残っていません。お店の側も証明できません。
 *   お金を受け取っている以上、当選の記録は動いてはいけません。
 *
 *   ★では、写ってはいけないものが写っていたときはどうするか。
 *     「差し替え」とは別に、「完全に削除する」を用意します。
 *     完全削除は、過去の履歴からも消えます。そのかわり
 *     ★誰が・いつ・なぜ消したかが監査に残ります。
 *     静かに消えるのと、記録を残して消すのは、別のことです。
 *
 *   ★prizes.image_id が空の古い行があること。
 *     この移行より前に当たった記録には、写し取りがありません。
 *     読むときは「あれば snapshot、無ければ在庫表」の順で見ます。
 *     空を「写真なし」と決めつけないこと。
 *
 * ★②差し替えの履歴を残す
 *
 *   お客様がお金を払う判断の材料は、写真です。
 *   「どの写真が、いつからいつまで商品の顔だったか」が
 *   残っていないと、あとから何も確かめられません。
 *
 * ★③ポイントの有効期限は、お店が決める
 *
 *   ★こちらで初期値を決めないこと。
 *     有効期限の付け方は、資金決済法の前払式支払手段の
 *     扱いに直結します。「6か月以内なら届出が要らない」等の
 *     判断をこちらでしてはいけません。専門家の確認事項です。
 *     ですので既定は "UNSET"（まだ決めていない）にします。
 *     未設定のあいだは、期限で消える処理は一切走りません。
 *
 * ★④決済会社からの強制取消（チャージバック）に備える
 *
 *   お客様都合の任意返金は受け付けません。
 *   ですが、カード会社が「この支払いは無効」と決めることは、
 *   こちらの意思と関係なく起きます。そのときに
 *   ★過去の台帳を書き換えて帳尻を合わせないこと。
 *     書き換えた台帳は、もう証拠になりません。
 *     必ず「新しい逆仕訳の行」を足す形にします。
 *
 *   引けなかったぶん（すでに使われていたポイント）は
 *   0にせず、UNRECOVERED として残します。
 *   ★取りはぐれを「無かったこと」にしないこと。
 */
const M018: string[] = [
  /* ①当選した瞬間の写真。空なら在庫表から引く（古い行のため） */
  `ALTER TABLE prizes ADD COLUMN image_id TEXT`,

  /* ②差し替えの履歴。
     slot は "COVER"（表紙）か、賞の記号（"S" "A" など）。 */
  `CREATE TABLE IF NOT EXISTS image_replacements (
     id             TEXT PRIMARY KEY,
     tenant_id      TEXT NOT NULL,
     gacha_id       TEXT NOT NULL,
     slot           TEXT NOT NULL,
     old_image_id   TEXT,
     new_image_id   TEXT,
     /* "REPLACE"（差し替え）／"REMOVE"（写真を外した）
        ／"PURGE"（古い写真を履歴からも完全に消した） */
     kind           TEXT NOT NULL DEFAULT 'REPLACE',
     reason         TEXT,
     replaced_at    TEXT NOT NULL,
     replaced_by    TEXT,
     replaced_name  TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS ix_image_replacements_gacha
     ON image_replacements (tenant_id, gacha_id, replaced_at)`,

  /* ③ポイントの決まりごと（お店ごとに1行）。
     ★expiry_mode の既定を "NONE" にしないこと。
       「期限なし」も立派な決定です。決めていないことと違います。 */
  `CREATE TABLE IF NOT EXISTS tenant_point_policy (
     tenant_id    TEXT PRIMARY KEY,
     /* "UNSET"（まだ決めていない）／"NONE"（期限なし）
        ／"DAYS"（購入から○日）／"MONTHS"（購入から○か月） */
     expiry_mode  TEXT NOT NULL DEFAULT 'UNSET',
     expiry_value INTEGER,
     /* 決めた人が「専門家に確認した」と記録した日。
        ★こちらで自動的に入れないこと */
     confirmed_at TEXT,
     updated_at   TEXT NOT NULL,
     updated_by   TEXT
   )`,

  /* ④強制取消の記録。
     ★points_reversed と unrecovered_points を必ず分けて持つこと。
       合計だけを持つと、いくら取りはぐれたのかが消えます。 */
  `CREATE TABLE IF NOT EXISTS payment_reversals (
     id                 TEXT PRIMARY KEY,
     tenant_id          TEXT NOT NULL,
     order_id           TEXT NOT NULL,
     user_id            TEXT NOT NULL,
     provider           TEXT NOT NULL,
     /* 決済会社が付けた、その通知1回ぶんの番号 */
     event_id           TEXT NOT NULL,
     /* "CHARGEBACK"（カード会社による取消）
        ／"FORCED_REFUND"（決済会社側の強制返金） */
     reason             TEXT NOT NULL,
     /* 取り消された金額（円） */
     amount_yen         INTEGER NOT NULL,
     /* 本来引くべきだったポイント（付与した全部） */
     points_to_reverse  INTEGER NOT NULL,
     /* 実際に引けたポイント（残高が足りたぶん） */
     points_reversed    INTEGER NOT NULL,
     /* 引けなかったポイント。★0で埋めないこと */
     unrecovered_points INTEGER NOT NULL DEFAULT 0,
     /* 引けなかったぶんの相当額（円）。回収不能額 */
     unrecovered_amount INTEGER NOT NULL DEFAULT 0,
     /* 逆仕訳として足した台帳の行 */
     ledger_id          TEXT,
     created_at         TEXT NOT NULL
   )`,

  /* ★同じ取消通知が2回来ても、2回引かないこと。
       ここが最後の砦です。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_reversal_event
     ON payment_reversals (tenant_id, provider, event_id)`,

  `CREATE INDEX IF NOT EXISTS ix_reversal_user
     ON payment_reversals (tenant_id, user_id, created_at)`,

  /* 会員を「要確認」にする印。
     ★勝手に利用停止にしないこと。
       カード会社の取消は、本人の落ち度とは限りません
       （カードの盗難、家族の利用、決済会社側の誤り）。
       止めるかどうかは、人が中身を見て決めます。 */
  `ALTER TABLE customers ADD COLUMN review_flag TEXT`,
  `ALTER TABLE customers ADD COLUMN review_note TEXT`,
  `ALTER TABLE customers ADD COLUMN review_at TEXT`,
];

/**
 * M019 — お店ごとの「看板」と「法定ページ」、そしてガチャの棚（カテゴリ）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この段が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   いまのシステムは「こちらが毎回設定してあげる受託システム」です。
 *   会社名も、特商法の表記も、規約も、コードの中にありません。
 *   ですから、2社目に売った瞬間に、こちらの手が必要になります。
 *
 *   ★ここで絶対にやってはいけないのは、
 *     「AI GACHA OS 運営会社の情報」を既定値として埋めることです。
 *
 *     埋めると、導入店舗が設定を忘れたまま公開できてしまいます。
 *     そのとき、そのお店の特商法ページには、
 *     ★お店ではなく、こちらの会社名と住所が出ます。
 *     お客様は、こちらへ返品を求めてきます。
 *
 *   ですので、この段の列は **すべて NULL 可・既定値なし** です。
 *   埋まっていないものは「未設定」と表示し、
 *   埋まっていなければ公開させない（第7の関門）という形にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★カテゴリを「表」にした理由（コードに名前を書かない）
 * ═══════════════════════════════════════════════════════
 *
 *   「ポケモン／ワンピース／スニーカー／ブランド／その他」を
 *   コードの配列で持つと、6つ目を足すのに、こちらの作業が要ります。
 *   それでは、また受託システムに戻ります。
 *
 *   ★1つのガチャに複数のカテゴリを付けられる形（連結表）にしました。
 *
 *     理由は、あとから戻せないからです。
 *     「1ガチャ＝1カテゴリ」で作ってしまうと、
 *     「ポケモン」かつ「高額」に置きたくなった日に、段を足す話になります。
 *     逆に、複数を持てる形で作っておけば、
 *     お店が1つしか付けなければ、それは1カテゴリの運用そのものです。
 *
 *     つまり **複数可のほうが、狭い運用も含んでいます。**
 *     画面の側は当面「1つ選ぶ」で作っても構いません。
 */
const M019: string[] = [
  /* ①お店の看板と、法定ページの中身。お店ごとに1行。
       ★どの列にも DEFAULT を付けないこと。
         「空欄」と「決めた結果の空欄」を、見分けられなくなります。 */
  `CREATE TABLE IF NOT EXISTS tenant_settings (
     tenant_id          TEXT PRIMARY KEY,

     /* ── 看板（見た目） ── */
     shop_name          TEXT,
     logo_image_id      TEXT,
     brand_color        TEXT,

     /* ── 運営法人（特商法の「販売業者」欄でもある） ── */
     legal_name         TEXT,
     legal_kana         TEXT,
     representative     TEXT,
     postal_code        TEXT,
     address            TEXT,
     phone              TEXT,
     contact_email      TEXT,
     contact_hours      TEXT,
     contact_note       TEXT,
     /* 古物商許可番号。中古品を扱わないお店もあるので、必須にしない */
     antique_license    TEXT,

     /* ── 特定商取引法に基づく表記（項目ごとに持つ） ──
        ★1つの大きな文章欄にしないこと。
          文章1つにすると、どの項目が抜けているかを機械で数えられません。
          数えられないものは、公開前に止められません。 */
     price_note         TEXT,
     extra_fee_note     TEXT,
     payment_method     TEXT,
     payment_timing     TEXT,
     delivery_time      TEXT,
     returns_note       TEXT,

     /* ── 長い文章のページ ── */
     terms_text         TEXT,
     privacy_text       TEXT,

     updated_at         TEXT,
     updated_by         TEXT
   )`,

  /* ②よくある質問。行で持ちます（お店が自由に足せるように） */
  `CREATE TABLE IF NOT EXISTS tenant_faqs (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     question   TEXT NOT NULL,
     answer     TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS ix_tenant_faqs
     ON tenant_faqs (tenant_id, sort_order)`,

  /* ③ガチャの棚（カテゴリ）。名前はお店が決めます */
  `CREATE TABLE IF NOT EXISTS gacha_categories (
     id         TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     name       TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,

  /* ★同じ名前の棚を2つ作れないようにする。
       「ポケモン」と「ポケモン」が並ぶと、お客様は
       どちらを見ればよいのか分かりません。 */
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_gacha_category_name
     ON gacha_categories (tenant_id, name)`,

  `CREATE INDEX IF NOT EXISTS ix_gacha_categories
     ON gacha_categories (tenant_id, sort_order)`,

  /* ④ガチャと棚のつなぎ。1つのガチャが複数の棚に入れます */
  `CREATE TABLE IF NOT EXISTS gacha_category_links (
     tenant_id   TEXT NOT NULL,
     gacha_id    TEXT NOT NULL,
     category_id TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     PRIMARY KEY (gacha_id, category_id)
   )`,

  `CREATE INDEX IF NOT EXISTS ix_gacha_category_by_cat
     ON gacha_category_links (tenant_id, category_id)`,
];

/**
 * M020 — 「どのお店のサイトか」を、住所（ドメイン）で決める。あわせて賞の呼び名。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、会社コードを打たせるのをやめるのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、お客様は会員登録とログインのときに
 *   「会社コード」を打っていました。
 *
 *   ふつうのオンラインガチャのお店で、そんなものを聞かれることはありません。
 *   聞かれた時点で、お客様は「何これ」と思って、そこで帰ります。
 *
 *   そもそも、お客様はもう答えを持って来ています。
 *   「shop-a.example.com を開いた」という事実そのものが答えです。
 *   聞く必要がないものを聞いていました。
 *
 * ═══════════════════════════════════════════════════════
 * ★どのお店かを、ブラウザ側に決めさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   会社コードを本文で受け取る形は、
 *   「どの会社の入口を使うか」をブラウザ側が指定できる形です。
 *
 *   この表は、その決定をサーバー側へ取り上げるためにあります。
 *   ★登録されていない住所は、はっきり断ります。
 *     「決まらなかったので1社目」は絶対にやりません。
 *     よそのお店のページとして開いてしまいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★賞の呼び名を、コードから追い出す
 * ═══════════════════════════════════════════════════════
 *
 *   これまで賞の名前は「S賞・A賞・B賞・C賞・D賞」で固定でした。
 *   お店によっては「特賞」「1等」「PSA10賞」「BOX賞」と呼びます。
 *   呼び名を変えるのに、こちらの作業が要る状態でした。
 *
 *   ★ただし、中の仕組みは今までどおり S/A/B/C/D のままにします。
 *     呼び名を鍵にすると、「特賞」に変えた日に、
 *     抽選・残数・当選履歴・記録のつながりが全部切れます。
 *     ここで持つのは「見せる文字」だけです。
 */
const M020: string[] = [
  /* ①お店のサイトの住所。1つの住所は、1つのお店にしか結びつきません。
       ★host を主キーにすること。
         同じ住所を2社に割り当てられる形にすると、
         どちらのお店として開くかが運任せになります。 */
  `CREATE TABLE IF NOT EXISTS tenant_domains (
     host       TEXT PRIMARY KEY,
     tenant_id  TEXT NOT NULL,
     note       TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS ix_tenant_domains_tenant
     ON tenant_domains (tenant_id)`,

  /* ②賞の呼び名。中の記号（grade）はそのまま、見せる文字だけを持ちます。
       ★grade を書き換える形にしないこと。
         gacha_stock の主キーの一部なので、書き換えると
         在庫・当選履歴とのつながりが切れます。 */
  `CREATE TABLE IF NOT EXISTS tenant_grade_labels (
     tenant_id  TEXT NOT NULL,
     grade      TEXT NOT NULL,
     label      TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT,
     PRIMARY KEY (tenant_id, grade)
   )`,
];

const MIGRATIONS: Migration[] = [
  { name: "001_initial", sql: M001 },
  { name: "002_tenant_tables", sql: M002 },
  { name: "003_auth", sql: M003 },
  { name: "004_support_shipping", sql: M004 },
  { name: "005_mfa_replay", sql: M005 },
  { name: "006_point_adjustments", sql: M006 },
  { name: "007_password_change", sql: M007 },
  { name: "008_order_shipment_split", sql: M008 },
  { name: "009_notifications_mypage", sql: M009 },
  { name: "010_ticket_status", sql: M010 },
  { name: "011_gacha_publish_backtest", sql: M011 },
  { name: "012_point_adjust_balances", sql: M012 },
  { name: "013_ticket_messages", sql: M013 },
  { name: "014_read_only_session", sql: M014 },
  { name: "015_customer_signup", sql: M015 },
  { name: "016_product_images", sql: M016 },
  { name: "017_point_purchase", sql: M017 },
  { name: "018_image_replace_reversal", sql: M018 },
  { name: "019_tenant_settings_categories", sql: M019 },
  { name: "020_tenant_domains_grade_labels", sql: M020 },
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
 * この保存先は「手元のファイル」か。
 *
 * ★遠くのDB（Turso / libSQL）とは、取引のやり方を変えます。
 *   理由はすぐ下の withWriteTx に書いてあります。
 */
function fileNoHozonsaki(): boolean {
  return databaseUrl().startsWith("file:");
}

/**
 * 手元のファイル用の「取引の入れ物」。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、こんな回りくどいことをしているのか（2026-09-07）
 * ═══════════════════════════════════════════════════════
 *
 *   DBの部品には、いま直せない不具合があります。
 *
 *     client.transaction() で取引を作ると、
 *     機械語で書かれた本体（index.node）の中に、
 *     返しそこねた借り物が少しずつ残ります。
 *     それがある程度たまると、掃除係（GC）が片付けに行った瞬間、
 *     プロセスごと落ちます（SIGSEGV）。
 *
 *   ★思いつきではありません。手元で数えました。
 *
 *     ・transaction() を 2000 回 …… 落ちる
 *     ・transaction() を 3000 回 …… 落ちる
 *     ・BEGIN IMMEDIATE を自分で打つやり方で 10000 回 …… 落ちない
 *     ・取引を使わない普通の問い合わせ 10000 回 …… 落ちない
 *
 *     tx.close() を足しても、足さなくても、同じように落ちました。
 *     つまり、こちらの使い方の問題ではありません。
 *     （macOS の異常終了の記録にも、落ちた場所がそのまま残っています。
 *       napi の Finalize → index.node）
 *
 *   ★これは「試験がたまに赤くなる」だけの話ではありません。
 *
 *     落ちているのは、終わりぎわの後片付けではなく、
 *     ふだんの処理の合間（掃除係が動くとき）です。
 *     つまり、お客様が引いている最中に、
 *     お店のサーバーが丸ごと落ちうる、ということです。
 *
 *   そこで、手元のファイルにつないでいるときは、
 *   取引を自分で開け閉めします（BEGIN IMMEDIATE … COMMIT）。
 *   守りたいことは何も変わりません。
 *
 *     ・BEGIN IMMEDIATE なので、最初から書き込みの順番を取ります
 *     ・失敗したら ROLLBACK で、途中まで書いたものは残しません
 *     ・書き込みは、もともと下の順番待ちの列で1つずつにしています
 *       （同じ接続で2つの取引が重なることはありません）
 *
 * ═══════════════════════════════════════════════════════
 * ★遠くのDB（Turso）では、絶対にこのやり方をしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   遠くのDBへは HTTP で1回ずつ問い合わせます。
 *   1回ごとに別の話として扱われるので、
 *   「BEGIN」と「COMMIT」を別々に送っても、
 *   その間の書き込みが同じ取引にまとまる保証がありません。
 *
 *   まとまらないまま途中で落ちると、
 *   ポイントだけ引かれて景品が付かない人が出ます。
 *   ★ですから、遠くのDBのときは、これまでどおり
 *     client.transaction() を使います。
 */
function fileTxAdapter(c: Client): Transaction {
  const yobenai = (na: string) => () => {
    /* ★取引の開け閉めは withWriteTx の仕事です。
         中の処理から呼ばれたら、黙って見逃さずに止めます。 */
    throw new Error(
      `取引の ${na} は、withWriteTx の中の処理からは呼べません。` +
        "（開け閉めは withWriteTx が行います）",
    );
  };
  return {
    execute: ((...a: unknown[]) =>
      (c.execute as (...x: unknown[]) => unknown)(...a)) as Transaction["execute"],
    batch: ((...a: unknown[]) =>
      (c.batch as (...x: unknown[]) => unknown)(...a)) as Transaction["batch"],
    executeMultiple: (sql: string) => c.executeMultiple(sql),
    commit: yobenai("commit"),
    rollback: yobenai("rollback"),
    close: () => undefined,
    closed: false,
  } as Transaction;
}

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
    /* ── 手元のファイルのとき：自分で BEGIN IMMEDIATE を打つ ──
         理由は fileTxAdapter の説明に書いてあります。
         ★「同じことなんだから片方に寄せよう」と、
           遠くのDBまでこちらに寄せないこと。壊れます。 */
    if (fileNoHozonsaki()) {
      const c = db();
      await c.execute("BEGIN IMMEDIATE");
      try {
        const out = await fn(fileTxAdapter(c));
        await c.execute("COMMIT");
        return out;
      } catch (e) {
        try {
          await c.execute("ROLLBACK");
        } catch {
          /* すでに終わっている場合は何もしない */
        }
        throw e;
      }
    }

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
    } finally {
      /*
       * ═══════════════════════════════════════════════════════
       * ★取引は、必ずここで手放すこと（2026-09-07）
       * ═══════════════════════════════════════════════════════
       *
       *   DBの部品は、機械語で書かれた本体（index.node）を
       *   JavaScript から借りて使っています。
       *   借りたものを返さないと、あとで掃除係（GC）が
       *   勝手に返しに行きます。
       *
       *   その「勝手に返す」処理が、実機で異常終了しました。
       *   macOS の記録に、落ちた場所がそのまま残っています。
       *
       *       napi の Finalize → index.node
       *
       *   1000件を同時に流した直後に、必ず落ちます。
       *   ★中身は全部通っているのに、まとめだけが出ずに消えます。
       *     いちばん見つけにくい壊れ方です。
       *
       *   commit / rollback が済んでいれば、ここは空振りします。
       *   空振りしても害はありません。
       *   ★「commit したから要らない」と外さないこと。
       *     commit そのものが失敗した回に、借りたままになります。
       *     混み合っているときほど、そうなります。
       */
      try {
        tx.close();
      } catch {
        /* すでに手放していれば、それでよい */
      }
    }
  });

  /* 次の人が待てるように、成功しても失敗しても列は進める */
  queue = run.then(
    () => undefined,
    () => undefined,
  );

  return run as Promise<T>;
}
