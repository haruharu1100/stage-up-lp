/**
 * Preview の担当者に、認証アプリ（2段階認証）を登録する。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ要るのか
 * ═══════════════════════════════════════════════
 *
 *   「権限を変える」「利用を止める」は、押す直前に
 *   認証アプリの6桁を入れ直さないと実行できません。
 *
 *   ところが Preview の担当者は、認証アプリを登録していませんでした。
 *   そのため、どんな数字を入れても先へ進めず、
 *   ご本人が最後まで押して試すことができませんでした。
 *
 *   この道具は、その登録だけを行います。
 *
 * ═══════════════════════════════════════════════
 * ★本番では、絶対に使わないこと
 * ═══════════════════════════════════════════════
 *
 *   合言葉のもと（secret）を画面に出します。
 *   本番の担当者の secret を人の目に触れさせてはいけません。
 *   本番では、ご本人が画面のQRコードを読み取って登録します。
 *
 *   そのため、この道具は Preview 用のデータベースしか触りません。
 *   相手が本番だと分かったら、何もせずに止まります。
 *
 *   使い方：
 *     node --env-file=.env.local scripts/enroll-mfa-preview.mjs [メール]
 */

import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";

const MAIL = process.argv[2] || "boss@demo.example";

const URL_ = process.env.DATABASE_URL;
const TOKEN = process.env.DATABASE_AUTH_TOKEN;

if (!URL_) {
  console.error(
    "DATABASE_URL がありません。\n" +
      "  npx vercel env pull .env.local --environment=preview --yes\n" +
      "を先に実行してください。",
  );
  process.exit(1);
}

/* ══════════════════════════════════════════════
   ★安全装置：本番のデータベースなら、何もしない
   ══════════════════════════════════════════════ */
if (/prod|production|honban/i.test(URL_)) {
  console.error(
    `つなぎ先が本番に見えます： ${URL_}\n` +
      "この道具は Preview 専用です。何もせずに止まります。",
  );
  process.exit(1);
}

const require_ = createRequire(import.meta.url);
const { createClient } = require_("@libsql/client");
const db = createClient({ url: URL_, authToken: TOKEN });

/* ══════════════════════════════════════════════
   合言葉のもとを作る（lib/server/mfa.ts と同じ作り方）
   ══════════════════════════════════════════════ */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** その30秒に出るはずの6桁（確かめ算に使います） */
function codeFor(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", key).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

/* ══════════════════════════════════════════════
   登録する
   ══════════════════════════════════════════════ */
const found = await db.execute({
  sql: `SELECT id, name, role, status, tenant_id, mfa_enabled
          FROM app_users WHERE email = ? LIMIT 1`,
  args: [MAIL],
});
const hito = found.rows[0];
if (!hito) {
  console.error(`その担当者が見つかりません： ${MAIL}`);
  process.exit(1);
}

const secret = base32Encode(randomBytes(20));

await db.execute({
  sql: `UPDATE app_users
           SET mfa_secret = ?, mfa_enabled = 1, mfa_last_counter = NULL
         WHERE id = ?`,
  args: [secret, hito.id],
});

const uri =
  `otpauth://totp/${encodeURIComponent(`AI GACHA OS:${MAIL}`)}` +
  `?secret=${secret}&issuer=${encodeURIComponent("AI GACHA OS")}` +
  `&algorithm=SHA1&digits=6&period=30`;

const ima = codeFor(secret, Math.floor(Date.now() / 1000 / 30));

console.log(`
═══════════════════════════════════════════════
  認証アプリの登録が終わりました
═══════════════════════════════════════════════

  お名前　： ${hito.name}（${hito.role}）
  メール　： ${MAIL}

───────────────────────────────────────────────
  お手元の認証アプリに、これを登録してください
───────────────────────────────────────────────

  ★手で入力する場合の「設定キー」

      ${secret}

  ★アカウント名は、何でも構いません（例：AI GACHA OS）
  ★「時間ベース」を選んでください

───────────────────────────────────────────────
  いま、この瞬間に出るはずの6桁（確かめ算）
───────────────────────────────────────────────

      ${ima}

  ★30秒ごとに変わります。合っていれば、登録は成功です。

───────────────────────────────────────────────
  ★この設定キーは、Preview 専用です。
  　本番では使いません。人にお見せにならないでください。
───────────────────────────────────────────────

  QRコード用の文字列（必要な方だけ）：
  ${uri}
`);
