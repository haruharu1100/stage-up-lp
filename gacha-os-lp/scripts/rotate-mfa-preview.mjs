/**
 * Preview の担当者の「認証アプリの鍵」を、作り直す（ローテーション）。
 *
 * ═══════════════════════════════════════════════
 * ★この道具が生まれた理由（2026-08-26）
 * ═══════════════════════════════════════════════
 *
 *   前の道具（enroll-mfa-preview.mjs）は、鍵そのものを画面に出していました。
 *   そのため、鍵が報告文の中に書き写され、人の目に触れました。
 *
 *   Preview であっても、いちど人の目に触れた鍵は、
 *   もう「その人しか知らないもの」ではありません。
 *   二段階認証は「その人しか知らない」ことだけが根拠なので、
 *   触れた時点で、意味を失います。
 *
 *   ★だから、この道具は鍵を画面に出しません。
 *     鍵は、この場所にしか書きません。
 *
 *         .secrets/mfa-preview.txt
 *
 *     この場所は .gitignore に入れてあり、git へは決して入りません。
 *     お手元でファイルを開いて、認証アプリに登録してください。
 *     登録が終わったら、そのファイルは消してかまいません。
 *
 *   ★報告に書いてよいのは、ここまでです。
 *
 *         TOTP enrolled: YES
 *
 *     鍵そのもの、鍵の一部、QRコードの文字列は、
 *     どれも報告・チャット・課題管理・スクリーンショットに出さないこと。
 *
 * ═══════════════════════════════════════════════
 * ★本番では、絶対に使わないこと
 * ═══════════════════════════════════════════════
 *
 *   本番では、ご本人が画面のQRコードを読み取って登録します。
 *   人が鍵をファイルで受け渡す時点で、それは本番のやり方ではありません。
 *
 *   そのため、つなぎ先が本番に見えたら、何もせずに止まります。
 *
 *   使い方（★tsx で動かすこと。理由は「監査ログ」の項に書いてあります）：
 *     npx tsx --env-file=.env.local scripts/rotate-mfa-preview.mjs [メール] ["理由"]
 */

import { createRequire } from "node:module";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const MAIL = process.argv[2] || "boss@demo.example";
const RIYUU =
  process.argv[3] ||
  "鍵が報告文に書き写され、人の目に触れたため。前の鍵は、もう信用できない。";

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
    "つなぎ先が本番に見えます。この道具は Preview 専用です。\n" +
      "何もせずに止まります。",
  );
  process.exit(1);
}

const require_ = createRequire(import.meta.url);
const { createClient } = require_("@libsql/client");
const db = createClient({ url: URL_, authToken: TOKEN });

/* ══════════════════════════════════════════════
   監査ログ

   ★鎖（ハッシュチェーン）の作り方を、ここに書き写さないこと。
     書き写すと、いつか片方だけが直されて、
     「画面では正しいのに、サーバーでは改ざん扱い」という壊れ方をします。
     本物（lib/server/audit.ts）を、そのまま呼びます。
     この道具を tsx で動かすのは、そのためです。
   ══════════════════════════════════════════════ */
const { appendAuditTx } = await import(`${ROOT}/lib/server/audit.ts`);

/* ══════════════════════════════════════════════
   鍵の作り方（lib/server/mfa.ts と同じ）
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

/** その30秒に出るはずの6桁（確かめ算だけに使う） */
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

/**
 * 鍵の「指紋」。
 *
 * ★鍵そのものではなく、これを記録に残します。
 *   ここから鍵は戻せませんが、「前と同じ鍵か・違う鍵か」だけは確かめられます。
 *   監査ログに残したいのは、まさにそれだけです。
 */
function shimon(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

/* ══════════════════════════════════════════════
   ここから本番の処理
   ══════════════════════════════════════════════ */
const found = await db.execute({
  sql: `SELECT id, name, role, status, tenant_id, mfa_enabled, mfa_secret
          FROM app_users WHERE email = ? LIMIT 1`,
  args: [MAIL],
});
const hito = found.rows[0];
if (!hito) {
  console.error(`その担当者が見つかりません： ${MAIL}`);
  process.exit(1);
}

const mae = hito.mfa_secret ? String(hito.mfa_secret) : null;
const maeShimon = mae ? shimon(mae) : null;

const atarashii = base32Encode(randomBytes(20));
const atarashiiShimon = shimon(atarashii);

if (mae && mae === atarashii) {
  console.error("新しい鍵が前と同じになりました。ありえません。中止します。");
  process.exit(1);
}

const at = new Date().toISOString();

/* ══════════════════════════════════════════════
   ★1回の取引（トランザクション）で、まとめて行う
     鍵の入れ替えだけ成功して記録が残らない、を起こさないため
   ══════════════════════════════════════════════ */
const tx = await db.transaction("write");
let seq = 0;
try {
  /*
    ① 前の鍵を捨てて、新しい鍵にする。
       mfa_last_counter を空にするのは、前の鍵で使った番号を
       新しい鍵へ持ち越さないためです。
  */
  await tx.execute({
    sql: `UPDATE app_users
             SET mfa_secret = ?, mfa_enabled = 1, mfa_last_counter = NULL
           WHERE id = ?`,
    args: [atarashii, hito.id],
  });

  /* ② 監査ログへ1件足す。★鍵そのものは入れない。指紋だけ。 */
  const res = await appendAuditTx(tx, {
    tenantId: String(hito.tenant_id),
    at,
    actorKind: "SYSTEM",
    actorId: "system",
    actorName: "鍵の入れ替え（運用）",
    actorRole: "SYSTEM",
    action: "MFA_ROTATED",
    target: `${hito.name}（${MAIL}）`,
    summary: "二段階認証の鍵を作り直し、前の鍵を無効にしました",
    before: maeShimon ? `前の鍵の指紋 ${maeShimon}` : "前の鍵なし",
    after: `新しい鍵の指紋 ${atarashiiShimon}`,
    reason: RIYUU,
    data: {
      newFingerprint: atarashiiShimon,
      oldFingerprint: maeShimon,
      tool: "scripts/rotate-mfa-preview.mjs",
    },
  });
  seq = res.seq;

  await tx.commit();
} catch (e) {
  await tx.rollback();
  throw e;
}

/* ══════════════════════════════════════════════
   ③ 開いたままの画面（セッション）が、どうなるか
   ══════════════════════════════════════════════

   ★鍵を替えても、ログインそのものは切りません。
     作業中の担当者を、その場で落とさないためです。

   ★ただし「押す直前の6桁の入れ直し（step-up）」は、必ず取り消します。
     取り消さないと、前の鍵で通した確認が10分間そのまま生き続け、
     鍵を替えた意味が、その10分だけ消えます。
   ══════════════════════════════════════════════ */
const nokori = await db.execute({
  sql: `SELECT COUNT(*) AS n FROM sessions
          WHERE tenant_id = ? AND subject_id = ?`,
  args: [hito.tenant_id, hito.id],
});
const stepUpKesu = await db.execute({
  sql: `UPDATE sessions SET step_up_at = NULL
          WHERE tenant_id = ? AND subject_id = ? AND step_up_at IS NOT NULL`,
  args: [hito.tenant_id, hito.id],
});

/* ══════════════════════════════════════════════
   ④ 鍵は、ここにだけ書く（git に入らない場所）
   ══════════════════════════════════════════════ */
const dir = join(ROOT, ".secrets");
mkdirSync(dir, { recursive: true });
const file = join(dir, "mfa-preview.txt");

const uri =
  `otpauth://totp/${encodeURIComponent(`AI GACHA OS:${MAIL}`)}` +
  `?secret=${atarashii}&issuer=${encodeURIComponent("AI GACHA OS")}` +
  `&algorithm=SHA1&digits=6&period=30`;

writeFileSync(
  file,
  `AI GACHA OS  認証アプリの登録（Preview 専用）

発行日時： ${at}
お名前　： ${hito.name}（${hito.role}）
メール　： ${MAIL}

───────────────────────────────
手で入力する場合の「設定キー」
───────────────────────────────

    ${atarashii}

「時間ベース」を選んでください。アカウント名は何でも構いません。

───────────────────────────────
QRコード用の文字列（読み取りで登録する方だけ）
───────────────────────────────

${uri}

───────────────────────────────
★このファイルの扱い
───────────────────────────────

・このファイルは git に入りません（.gitignore 済み）。
・認証アプリへの登録が終わったら、削除してください。
・中身をチャット・報告・課題管理・スクリーンショットに写さないでください。
・写してしまった場合は、この道具をもう一度動かして、作り直してください。
`,
  "utf8",
);
chmodSync(file, 0o600);

const ima = codeFor(atarashii, Math.floor(Date.now() / 1000 / 30));

console.log(`
═══════════════════════════════════════════════
  鍵を作り直しました（TOTP rotated）
═══════════════════════════════════════════════

  お名前　　　： ${hito.name}（${hito.role}）
  メール　　　： ${MAIL}
  前の鍵　　　： ${maeShimon ? `指紋 ${maeShimon} → 無効にしました` : "登録なし"}
  新しい鍵　　： 指紋 ${atarashiiShimon}
  監査ログ　　： ${seq}番目に MFA_ROTATED として記録

───────────────────────────────────────────────
  開いたままの画面（セッション）への影響
───────────────────────────────────────────────

  ログインの数　　　　： ${Number(nokori.rows[0]?.n ?? 0)}件（切っていません）
  6桁の確認の取り消し： ${stepUpKesu.rowsAffected ?? 0}件

  ★ログインは切りません（作業中に落とさないため）。
  ★6桁の確認だけ取り消します（前の鍵で通した確認を残さないため）。

───────────────────────────────────────────────
  ★鍵は、画面には出しません
───────────────────────────────────────────────

  お手元のこのファイルを開いて、認証アプリに登録してください。

      .secrets/mfa-preview.txt

  登録が終わったら、そのファイルは削除してください。

  ★確かめ算（この30秒だけ有効な6桁）： ${ima}
  　認証アプリに出た数字と同じなら、登録は成功です。

  ★報告に書いてよいのは、ここまでです：  TOTP enrolled: YES
`);
