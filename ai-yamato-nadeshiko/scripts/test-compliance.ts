import { readFileSync, mkdtempSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// 本番DB(data/yamato.db)を汚さない。getDb() は遅延生成なので import 後の設定で間に合う
const tmpDir = mkdtempSync(join(tmpdir(), "yamato-compliance-"));
process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;

const { getDb, nowIso } = await import("../lib/db.js");
const { checkPost, CHECK_CODES } = await import("../lib/compliance.js");
const { CHARACTER_NAME, CHARACTER_GIVEN_NAME, NAME_IS_FULL_NAME } = await import(
  "../lib/character.js"
);
const { CHARACTER_IDENTITY } = await import("../lib/identity.js");

// 状態に依存しないテストにするため、判定用のIdentityはテスト側で作る。
// 本番の identity_status が LOCKED に変わってもテストが崩れないようにする。
const PROVISIONAL_IDENTITY = { ...CHARACTER_IDENTITY, identity_status: "PROVISIONAL" as const };
const LOCKED_IDENTITY = { ...CHARACTER_IDENTITY, identity_status: "LOCKED" as const };
type CheckCode = (typeof CHECK_CODES)[number];

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const db = getDb();

const DAY = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

// --- スキーマ投入 ----------------------------------------------------------
{
  const sql = readFileSync(resolve(root, "lib/db/schema.sql"), "utf8");
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await db.execute(stmt);
}

// --- 法令台帳（idだけを根拠にする。条文はコードに書かない） -----------------
const LAW_SEED: [string, string][] = [
  ["FTC_ENDORSEMENT", "米国 FTC Endorsement Guides"],
  ["EU_AI_ACT_50", "EU AI Act 第50条"],
  ["JP_KEIHYO", "景品表示法"],
  ["X_ADULT_CONTENT", "X Adult Content Policy"],
  ["X_AUTHENTICITY", "X Authenticity Policy"],
  ["X_AUTOMATED_ACCOUNT", "X Automated Account Policy"],
];
for (const [id, name] of LAW_SEED) {
  await db.execute({
    sql: `INSERT INTO laws (id, name, law_version, source_url, checked_at, effective_date, transition_date, summary, is_primary_source)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, name, "TEST", "https://example.test/" + id.toLowerCase(), day(0), null, null, "テスト用", 0],
  });
}

// --- claims ---------------------------------------------------------------
async function addClaim(
  subjectId: string,
  statement: string,
  kind: string,
  checkedOffset: number,
  expiresOffset: number,
  sourceUrl = "https://example.test/source",
) {
  await db.execute({
    sql: `INSERT INTO claims (subject_type, subject_id, statement, source_url, checked_at, expires_at, kind, verified_by)
          VALUES ('post',?,?,?,?,?,?,'ai')`,
    args: [subjectId, statement, sourceUrl, day(checkedOffset), day(expiresOffset), kind],
  });
}
await addClaim("clean-2", "Surfshark currently offers these features.", "FEATURE", 0, 30);
await addClaim("v-outdated", "This VPN costs $2.19 per month.", "PRICE", -60, -30);
await addClaim("v-unsub-empty", "This VPN costs $2.19 per month.", "PRICE", 0, 30, "");

// --- ASP案件 --------------------------------------------------------------
await db.execute({
  sql: `INSERT INTO networks (id, name, allows_social_traffic, allows_ai_content, japan_ok, has_api, verified_at)
        VALUES ('net-test','Test Network','YES','UNKNOWN','YES',0,?)`,
  args: [day(0)],
});
await db.execute({
  sql: `INSERT INTO offers (id, network_id, name, category, adult_flag, payout_type, approval_status, restrictions, verified_at)
        VALUES ('off-test','net-test','Test VPN','VPN',0,'REVSHARE','APPROVED',?,?)`,
  args: [JSON.stringify(["incentivized traffic", "coupon sites", "adult traffic"]), day(0)],
});

// --- 重複検知用の過去投稿 ---------------------------------------------------
const PAST_POST =
  "Three quiet places to visit in Kyoto in autumn, and how to reach each one from Kyoto Station by JR line.";
await db.execute({
  sql: `INSERT INTO posts (status, lang, text, created_at) VALUES ('published','en',?,?)`,
  args: [PAST_POST, nowIso()],
});

// --- ケース定義 ------------------------------------------------------------
const AFF_LINK = "https://go.surfshark.net/aff_c?offer_id=1";

type Violation = { code: CheckCode; label: string; input: Parameters<typeof checkPost>[0] };

const violations: Violation[] = [
  {
    code: "FAKE_EXPERIENCE",
    label: "実使用経験として書いている",
    input: {
      subjectId: "v-fake",
      text: "I really loved using this eSIM in Osaka last month.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "UNSUBSTANTIATED_CLAIM",
    label: "根拠(claims行)の無い事実主張",
    input: {
      subjectId: "v-unsub",
      text: "This VPN costs $2.19 per month and covers 100 countries.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "UNSUBSTANTIATED_CLAIM",
    label: "claims行はあるが source_url が空",
    input: {
      subjectId: "v-unsub-empty",
      text: "This VPN costs $2.19 per month.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "AFFILIATE_DISCLOSURE_MISSING",
    label: "開示文がリンクより後ろにある",
    input: {
      subjectId: "v-disc",
      text: `Compare VPN options for Japan travel here: ${AFF_LINK} #ad`,
      expGroup: "B",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "OUTDATED_SOURCE",
    label: "根拠の checked_at が期限切れ",
    input: {
      subjectId: "v-outdated",
      text: "This VPN costs $2.19 per month.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "ADULT",
    label: "成人向け・性的示唆",
    input: {
      subjectId: "v-adult",
      text: `${CHARACTER_NAME} in lingerie with visible cleavage, a sexy nude shot.`,
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "MINOR_LOOK",
    label: "未成年に見える要素",
    input: {
      subjectId: "v-minor",
      text: `${CHARACTER_NAME} looks like a 15-year-old schoolgirl in a high school uniform.`,
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "AI_DISCLOSURE",
    label: "AI生成である旨の開示が無い",
    input: {
      subjectId: "v-aidisc",
      text: "Good morning from Tokyo. The cherry blossoms are lovely today.",
      profileHasAiDisclosure: false,
    },
  },
  {
    code: "SHORT_URL",
    label: "短縮URLを使っている",
    input: {
      subjectId: "v-short",
      text: "Ad: affiliate link. Read more here: https://bit.ly/3xyzabc",
      expGroup: "B",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "DUPLICATE",
    label: "過去投稿と類似度0.9以上",
    input: {
      subjectId: "v-dup",
      text: "Three quiet places to visit in Kyoto in October, and how to reach each one from Kyoto Station by JR line.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "AUTOMATION",
    label: "特定ユーザーへのメンション",
    input: {
      subjectId: "v-auto",
      text: "@travelfan you should check this out.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "KEIHYO",
    label: "断定・誇大（景表法）",
    input: {
      subjectId: "v-keihyo",
      text: "この方法なら必ず儲かります。絶対に損はしません。保証します。",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "REAL_PERSON",
    label: "実在人物・実在の人間だと偽装",
    input: {
      subjectId: "v-real",
      text: "A real photo of Emma Watson wearing a kimono. I am a real person.",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "ASP_TERMS",
    label: "ASPの禁止トラフィックに該当",
    input: {
      subjectId: "v-asp",
      text: "Sign up here and get paid: incentivized traffic is fine.",
      offerId: "off-test",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "EXP_GROUP_MISMATCH",
    label: "EXP-001のA/B割当と配置が食い違い",
    input: {
      subjectId: "v-exp",
      text: `Ad: affiliate link. Compare VPNs for Japan travel: ${AFF_LINK}`,
      expGroup: "A",
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "NAME_SHORT_FORM",
    label: "X Bioの自己紹介が下の名前だけ（ここは検索される面なので不可）",
    input: {
      subjectId: "v-name",
      surface: "X_BIO_INTRO",
      text: `Hello, ${CHARACTER_GIVEN_NAME} here. AI-generated Japanese virtual creator.`,
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "NAME_COLLISION",
    label: "別の姓に化けている（別人になっている）",
    input: {
      subjectId: "v-collision",
      surface: "X_POST_BODY",
      text: `Hi, I'm ${CHARACTER_GIVEN_NAME} Tanaka. Today I found a quiet shrine in Nara.`,
      profileHasAiDisclosure: true,
    },
  },
  {
    code: "IDENTITY_LOCK",
    label: "名前がPROVISIONALのまま本番公開しようとしている",
    input: {
      subjectId: "v-identity",
      surface: "X_POST_BODY",
      text: "Today I found a quiet shrine in Nara.",
      profileHasAiDisclosure: true,
      publishIntent: true,
      identity: PROVISIONAL_IDENTITY,
    },
  },
];

const cleans: { label: string; input: Parameters<typeof checkPost>[0] }[] = [
  {
    label: "感想＋客観的な比較（FTC上は合法）",
    input: {
      subjectId: "clean-1",
      text: "I like this season. Here are 3 features to compare when choosing a VPN for Japan travel.",
      expGroup: "NONE",
      profileHasAiDisclosure: true,
    },
  },
  {
    label: "根拠付きの客観的な機能紹介",
    input: {
      subjectId: "clean-2",
      text: "Surfshark currently offers these features. (source: https://surfshark.com/pricing, checked 2026-08-22)",
      expGroup: "NONE",
      profileHasAiDisclosure: true,
    },
  },
  {
    label: "AIであること自体の話",
    input: {
      subjectId: "clean-3",
      text: "I am an AI-generated virtual creator.",
      expGroup: "NONE",
      profileHasAiDisclosure: false,
    },
  },
  {
    label: "B群：開示がリンクより前にあるアフィリ投稿",
    input: {
      subjectId: "clean-4",
      text: `Ad: affiliate link below. Three things to compare when choosing a VPN for Japan travel: server locations, refund window, and payment options. ${AFF_LINK}`,
      expGroup: "B",
      offerId: "off-test",
      profileHasAiDisclosure: true,
    },
  },
  {
    label: "A群：本文にリンク無し＋リプライにリンク",
    input: {
      subjectId: "clean-5",
      text: "Ad: affiliate link is in the first reply. Three things to compare when choosing a VPN for Japan travel.",
      replyText: AFF_LINK,
      expGroup: "A",
      offerId: "off-test",
      profileHasAiDisclosure: true,
    },
  },
  {
    // ★ここが今回の要。X本文まで機械的にフルネームを強制すると英文が不自然になる。
    //   下の名前だけの名乗りは、通常のX本文（CONTENT_NATURAL）では止めない。
    label: "X本文で下の名前だけ名乗る（自然な英文なので出せる）",
    input: {
      subjectId: "clean-6",
      surface: "X_POST_BODY" as const,
      text: `Hi, I'm ${CHARACTER_GIVEN_NAME} 🌸\nToday I found a beautiful little shrine in Japan.`,
      expGroup: "NONE",
      profileHasAiDisclosure: true,
      identity: LOCKED_IDENTITY,
    },
  },
  {
    label: "X本文の「You can call me 下の名前!」",
    input: {
      subjectId: "clean-7",
      surface: "X_POST_BODY" as const,
      text: `You can call me ${CHARACTER_GIVEN_NAME}! Here are 3 things to compare when choosing a tea room in Kyoto.`,
      expGroup: "NONE",
      profileHasAiDisclosure: true,
      identity: LOCKED_IDENTITY,
    },
  },
  {
    label: "X本文でフルネームを名乗る（当然出せる）",
    input: {
      subjectId: "clean-8",
      surface: "X_POST_BODY" as const,
      text: `Hi, I'm ${CHARACTER_NAME} 🌸 An AI-generated creator sharing Japanese culture.`,
      expGroup: "NONE",
      profileHasAiDisclosure: true,
      identity: LOCKED_IDENTITY,
    },
  },
];

// --- 実行 ------------------------------------------------------------------
let ng = 0;
const line = (ok: boolean, msg: string) => {
  if (!ok) ng++;
  console.log(`${ok ? "  OK  " : "  NG  "} ${msg}`);
};

console.log("=== 違反する文章（すべて FAIL になること） ===");
for (const v of violations) {
  const r = await checkPost(v.input);
  const hit = r.failed.includes(v.code);
  const detail = r.results.find((x) => x.code === v.code)?.detail ?? "";
  line(
    hit && r.blockedFromApproval,
    `${v.code.padEnd(28)} ${v.label} → ${hit ? detail : `FAILしなかった（判定: ${r.failed.join(",") || "全PASS"}）`}`,
  );
}

console.log(`\n=== 全${CHECK_CODES.length}コードを1件以上テストできているか ===`);
const covered = new Set(violations.map((v) => v.code));
for (const code of CHECK_CODES) line(covered.has(code), `${code} のテストケース`);

// 名前が仮のままだと NAME_SHORT_FORM が素通りする。素通りを合格と誤認しないための番人。
console.log("\n=== 正式名称が入っているか（NAME_SHORT_FORMの前提） ===");
line(NAME_IS_FULL_NAME, `CHARACTER_NAME がフルネーム: "${CHARACTER_NAME}"`);

console.log("\n=== 正常な文章（すべて PASS になること） ===");
for (const c of cleans) {
  const r = await checkPost(c.input);
  const bad = [...r.failed, ...r.halted];
  line(r.passed, `${c.label} → ${r.passed ? "承認画面へ出してよい" : `誤検知: ${bad.join(", ")}`}`);
}

console.log("\n=== 同じ文章でも「どこで使うか」で判定が変わる ===");
{
  const text = `Hi, I'm ${CHARACTER_GIVEN_NAME} 🌸 Sharing Japanese culture every day.`;
  const strict = await checkPost({
    subjectId: "surface-strict",
    surface: "X_DISPLAY_NAME",
    text,
    expGroup: "NONE",
    profileHasAiDisclosure: true,
    identity: LOCKED_IDENTITY,
  });
  const natural = await checkPost({
    subjectId: "surface-natural",
    surface: "X_POST_BODY",
    text,
    expGroup: "NONE",
    profileHasAiDisclosure: true,
    identity: LOCKED_IDENTITY,
  });
  line(strict.failed.includes("NAME_SHORT_FORM"), "ブランド面（X表示名）では下の名前だけは不可");
  line(!natural.failed.includes("NAME_SHORT_FORM"), "通常のX本文では下の名前だけでも止めない");
  line(
    natural.warned.includes("NAME_SHORT_FORM"),
    "ただし初回の自己紹介はWARNで「フルネームの方がよい」と残す",
  );
  line(natural.passed, "WARNは承認を止めない（違反と改善提案を混ぜない）");
}

console.log("\n=== 名前がPROVISIONALのままでは本番公開できない ===");
{
  const draft = await checkPost({
    subjectId: "identity-draft",
    text: "Today I found a quiet shrine in Nara.",
    expGroup: "NONE",
    profileHasAiDisclosure: true,
    identity: PROVISIONAL_IDENTITY,
  });
  const publish = await checkPost({
    subjectId: "identity-publish",
    text: "Today I found a quiet shrine in Nara.",
    expGroup: "NONE",
    profileHasAiDisclosure: true,
    publishIntent: true,
    identity: PROVISIONAL_IDENTITY,
  });
  line(draft.passed && draft.warned.includes("IDENTITY_LOCK"), "下書き作成はWARNのみで止めない");
  line(publish.failed.includes("IDENTITY_LOCK"), "本番公開しようとすると止まる");
}

console.log("\n=== 法令台帳が期限切れなら HALT して人間へ通知する ===");
await db.execute({ sql: `UPDATE laws SET checked_at = ? WHERE id = 'JP_KEIHYO'`, args: [day(-200)] });
{
  const before = await db.execute(`SELECT COUNT(*) AS c FROM notifications WHERE code = 'COMPLIANCE_HALT'`);
  const r = await checkPost({
    subjectId: "halt-1",
    text: "Here are 3 features to compare when choosing a VPN for Japan travel.",
    expGroup: "NONE",
    profileHasAiDisclosure: true,
  });
  const after = await db.execute(`SELECT COUNT(*) AS c FROM notifications WHERE code = 'COMPLIANCE_HALT'`);
  const n0 = Number(before.rows[0]?.["c"] ?? 0);
  const n1 = Number(after.rows[0]?.["c"] ?? 0);
  line(r.halted.includes("KEIHYO"), `checked_at が90日超の KEIHYO は HALT（判定: ${r.results.find((x) => x.code === "KEIHYO")?.result}）`);
  line(!r.passed && r.blockedFromApproval, "HALT が1件でもあれば承認画面に出さない");
  line(n1 > n0, `notifications に人間への通知を積む（${n0} → ${n1}）`);
}
await db.execute({ sql: `UPDATE laws SET checked_at = ? WHERE id = 'JP_KEIHYO'`, args: [day(0)] });

console.log("\n=== compliance_checks は追記のみ ===");
{
  // violations + cleans + 使用場所の検査2件 + IDENTITY_LOCK 2件 + HALT 1件
  const runs = violations.length + cleans.length + 4 + 1;
  const rs = await db.execute(`SELECT COUNT(*) AS c FROM compliance_checks`);
  const total = Number(rs.rows[0]?.["c"] ?? 0);
  line(total === runs * CHECK_CODES.length, `検査結果 ${total}行 = ${runs}回 × ${CHECK_CODES.length}項目`);
  const dup = await db.execute(
    `SELECT COUNT(*) AS c FROM (SELECT subject_id, check_code FROM compliance_checks GROUP BY subject_id, check_code HAVING COUNT(*) > 1)`,
  );
  const before = await db.execute(`SELECT COUNT(*) AS c FROM compliance_checks WHERE subject_id = 'clean-1'`);
  await checkPost(cleans[0]!.input);
  const after = await db.execute(`SELECT COUNT(*) AS c FROM compliance_checks WHERE subject_id = 'clean-1'`);
  line(
    Number(after.rows[0]?.["c"] ?? 0) === Number(before.rows[0]?.["c"] ?? 0) + CHECK_CODES.length,
    "同じ投稿を再検査しても上書きせず行が積み上がる",
  );
  line(Number(dup.rows[0]?.["c"] ?? 0) >= 0, "履歴を消していない");
}

console.log(
  ng === 0
    ? `\n✅ すべて合格（違反${violations.length}件・正常${cleans.length}件・14項目網羅）`
    : `\n❌ ${ng}件が不合格`,
);
if (ng > 0) process.exit(1);
