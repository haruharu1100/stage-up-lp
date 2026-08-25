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
