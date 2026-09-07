/**
 * 本番の保存先に、試験用のデータが混ざっていないかを、読むだけで確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★いつ使うか
 * ═══════════════════════════════════════════════════════
 *
 *   ・本番DBを作った直後（必ず1回）
 *   ・最初のお店を登録した直後
 *   ・そのあとは、月に1回でよい
 *
 *   「検証のつもりが本番だった」は、最初の1週間にいちばん起きます。
 *   起きたことに気づかないまま営業を始めるのが、いちばん困ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面に、お客様の氏名・住所・メールを出しません
 * ═══════════════════════════════════════════════════════
 *
 *   出るのは「件数」と、見つかったときの「お店コード」だけです。
 *   報告文に貼っても、個人情報が漏れないようにしてあります。
 *
 *   ★ここを「調べやすいから」と、名前を出す形に変えないこと。
 *     出した瞬間、その画面は報告文に残り、報告文は消えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★見つかっても、この道具は何も直しません
 * ═══════════════════════════════════════════════════════
 *
 *   消す判断は、人がします。
 *   自動で消す形にすると、いつか本物のお客様を消します。
 *
 * ─────────────────────────────────────────────
 * 使い方（本番を読むので、合図が2つ要ります）
 *
 *   DATABASE_ENV=production \
 *   DATABASE_URL="libsql://gacha-os-prod-xxxx.turso.io" \
 *   DATABASE_AUTH_TOKEN="..." \
 *   PRODUCTION_READ_ALLOW=yes-i-am-only-reading \
 *   node scripts/check-production-clean.mjs
 * ─────────────────────────────────────────────
 */

import { createClient } from "@libsql/client";

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const t = (v) => String(v ?? "").trim();

/* ★DATABASE_ENV を見ています（保存先の見張りが探す文字）。
     この道具は本番を読むのが役目なので、止まるのではなく
     「2つ目の合図」を求める形にしてあります。 */
const URL_ = t(process.env.DATABASE_URL);
const NAFUDA = t(process.env.DATABASE_ENV || process.env.VERCEL_ENV).toLowerCase();
const honbanRashii = NAFUDA === "production" || /prod/i.test(URL_);

if (honbanRashii && t(process.env.PRODUCTION_READ_ALLOW) !== "yes-i-am-only-reading") {
  console.error(
    [
      "",
      C.red("  本番の保存先を読もうとしています。"),
      "",
      "  この道具は読むだけですが、読むだけでも本番です。",
      "  本当に確かめるときだけ、次を付けて実行してください。",
      "    PRODUCTION_READ_ALLOW=yes-i-am-only-reading",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (URL_ === "") {
  console.error(C.red("\n  DATABASE_URL が設定されていません。\n"));
  process.exit(1);
}

const client = createClient({
  url: URL_,
  authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
});

console.log("");
console.log(C.bold("  本番に、試験用のデータが混ざっていないかを確かめます"));
console.log(`    つなぎ先 : ${URL_.replace(/(authToken|token)=[^&]*/gi, "$1=***")}`);
console.log(`    名札     : ${NAFUDA === "" ? "（無し）" : NAFUDA}`);
console.log("");

let mitsuketa = 0;
const midashi = [];

/**
 * 1件確かめる。
 *
 * @param {string} no    番号
 * @param {string} title 何を見たか（日本語）
 * @param {string} sql   件数を数えるSQL（1列目が件数）
 * @param {string} tsuika 見つかったときに、追加で出してよい情報のSQL（任意）
 */
async function miru(no, title, sql, tsuika = "") {
  let n = 0;
  let detail = "";
  try {
    const r = await client.execute(sql);
    n = Number(r.rows[0]?.n ?? 0);
    if (n > 0 && tsuika !== "") {
      const r2 = await client.execute(tsuika);
      detail = r2.rows.map((x) => String(x.v)).slice(0, 8).join(" / ");
    }
  } catch (e) {
    /* ★表が無いだけなら 0 件と同じ意味ですが、
         それ以外の失敗を 0 件と混ぜないこと。 */
    const msg = String(e?.message ?? e);
    if (/no such table/i.test(msg)) {
      console.log(`  ${C.dim("――")}  ${String(no).padEnd(6)} ${title}${C.dim("（この表はまだありません）")}`);
      return;
    }
    console.log(`  ${C.red("？？")}  ${String(no).padEnd(6)} ${title}`);
    console.log(C.dim(`          確かめられませんでした：${msg.slice(0, 160)}`));
    mitsuketa += 1;
    midashi.push(`${no} ${title}（確かめられず）`);
    return;
  }

  if (n === 0) {
    console.log(`  ${C.green("ok")}  ${String(no).padEnd(6)} ${title}`);
  } else {
    console.log(`  ${C.red("見つ")}  ${String(no).padEnd(6)} ${title}　${C.red(`${n} 件`)}`);
    if (detail) console.log(C.dim(`          ${detail}`));
    mitsuketa += 1;
    midashi.push(`${no} ${title}：${n} 件`);
  }
}

try {
  /* ① お店コードが、試験用の名前で始まっていないか */
  await miru(
    "P-01",
    "試験用に見えるお店コードが無い（demo / test / sample / e2e / ux / preview）",
    `SELECT count(*) AS n FROM tenants
      WHERE lower(code) LIKE 'demo%' OR lower(code) LIKE 'test%'
         OR lower(code) LIKE 'sample%' OR lower(code) LIKE 'e2e%'
         OR lower(code) LIKE 'ux%' OR lower(code) LIKE 'preview%'`,
    `SELECT code AS v FROM tenants
      WHERE lower(code) LIKE 'demo%' OR lower(code) LIKE 'test%'
         OR lower(code) LIKE 'sample%' OR lower(code) LIKE 'e2e%'
         OR lower(code) LIKE 'ux%' OR lower(code) LIKE 'preview%'
      ORDER BY code`,
  );

  /* ② 誰も持てないメール（.example / .invalid / example.com）が無いか
       ★試験では必ずこのドメインを使う決まりなので、
         本番にあるということは、試験のデータがそのまま入っています。 */
  for (const [no, hyou, hito] of [
    ["P-02", "customers", "会員"],
    ["P-03", "app_users", "担当者"],
  ]) {
    await miru(
      no,
      `${hito}に、試験専用のメール（.example / .invalid / example.com）が無い`,
      `SELECT count(*) AS n FROM ${hyou}
        WHERE lower(email) LIKE '%.example' OR lower(email) LIKE '%.invalid'
           OR lower(email) LIKE '%@example.com' OR lower(email) LIKE '%@example.%'`,
    );
  }

  /* ③ お店の住所（ドメイン）に、手元や仮の住所が残っていないか */
  await miru(
    "P-04",
    "お店の住所に、手元用・仮の住所が残っていない（localhost / 127.0.0.1 / *.vercel.app）",
    `SELECT count(*) AS n FROM tenant_domains
      WHERE lower(host) LIKE 'localhost%' OR lower(host) LIKE '127.0.0.1%'
         OR lower(host) LIKE '%.vercel.app'`,
    `SELECT host AS v FROM tenant_domains
      WHERE lower(host) LIKE 'localhost%' OR lower(host) LIKE '127.0.0.1%'
         OR lower(host) LIKE '%.vercel.app'
      ORDER BY host`,
  );

  /* ④ 「試験用」で始まる名前が残っていないか
       ★seed の makeTenantLaunchReady が入れる値は、必ずこれで始まります。 */
  await miru(
    "P-05",
    "お店の名前に「試験用」が残っていない",
    `SELECT count(*) AS n FROM tenants WHERE name LIKE '試験用%'`,
    `SELECT code AS v FROM tenants WHERE name LIKE '試験用%' ORDER BY code`,
  );
  await miru(
    "P-06",
    "ガチャの名前に「試験用」「テスト」が残っていない",
    `SELECT count(*) AS n FROM gachas WHERE title LIKE '試験用%' OR title LIKE '%テスト%'`,
  );

  /* ⑤ 法定表示に、こちらの文例が入っていないか
       ★店舗の特商法・規約は、店舗自身が書くまで空欄のままが正しい状態です。
         こちらの文例が入っていたら、それは事故です。 */
  /* ★列の名前は、必ず実物（sqlite_master）に合わせること。
       ここを思い込みで書くと「確かめられませんでした」で素通りします。
       実際に company_name / legal_seller と書き間違えました。2026-09-07
       正しくは shop_name / legal_name / representative です。 */
  await miru(
    "P-07",
    "店舗設定に「試験用」で始まる値が入っていない",
    `SELECT count(*) AS n FROM tenant_settings
      WHERE shop_name      LIKE '試験用%'
         OR legal_name     LIKE '試験用%'
         OR representative LIKE '試験用%'
         OR terms_text     LIKE '試験用%'
         OR privacy_text   LIKE '試験用%'`,
  );

  /* ⑥ ポイント台帳に、試験の付与が残っていないか
       ★ここが混ざっていると、売上と還元率が永久に合わなくなります。 */
  await miru(
    "P-08",
    "ポイント台帳に、試験の付与が残っていない",
    `SELECT count(*) AS n FROM point_ledger
      WHERE memo LIKE '%試験%' OR memo LIKE '%テスト%' OR memo LIKE '%E2E%'`,
  );

  /* ⑦ 保有ポイントと台帳の合計が、会員ごとに合っているか
       ★これは混入の話ではなく、そもそも壊れていないかの確認です。
         控えを取る前に、必ず一度は見ておく値です。 */
  await miru(
    "P-09",
    "全会員で、保有ポイント＝台帳の合計になっている",
    `SELECT count(*) AS n FROM customers c
      WHERE c.points <> COALESCE((SELECT SUM(l.delta) FROM point_ledger l
                                   WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id), 0)`,
  );

  /* ⑧ お店が1つも無い／多すぎる、をそれとなく出す（判断は人がします） */
  const ten = await client.execute(`SELECT count(*) AS n FROM tenants`);
  const kai = await client.execute(`SELECT count(*) AS n FROM customers`);
  console.log("");
  console.log(C.dim(`  （参考）お店 ${Number(ten.rows[0].n)} 店 ／ 会員 ${Number(kai.rows[0].n)} 人`));
} catch (e) {
  console.error("");
  console.error(C.red(`  確かめられませんでした：${String(e?.message ?? e).slice(0, 300)}`));
  console.error("");
  process.exit(1);
} finally {
  try {
    client.close();
  } catch {
    /* 閉じられなくても、結果には影響しません */
  }
}

console.log("");
console.log("═".repeat(64));
if (mitsuketa === 0) {
  console.log(C.green("  PRODUCTION_CLEAN = YES"));
  console.log("  試験用のデータは見つかりませんでした。");
} else {
  console.log(C.red("  PRODUCTION_CLEAN = NO"));
  console.log("");
  for (const m of midashi) console.log(`    ・${m}`);
  console.log("");
  console.log("  ★この道具は、何も直しません。消す判断は人がしてください。");
  console.log("    自動で消す形にすると、いつか本物のお客様を消します。");
}
console.log("═".repeat(64));
console.log("");

process.exit(mitsuketa === 0 ? 0 : 1);
