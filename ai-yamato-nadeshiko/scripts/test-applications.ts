// 申請学習の受入テスト。本番DBには触らない（一時ファイルへ作る）
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AccountSnapshot } from "../lib/applications.js";

const dir = mkdtempSync(resolve(tmpdir(), "yamato-apply-"));
process.env.DATABASE_URL = `file:${resolve(dir, "test.db")}`;

const { getDb } = await import("../lib/db.js");
const db = getDb();
const schema = readFileSync(resolve(import.meta.dirname, "../lib/db/schema.sql"), "utf8");
for (const stmt of schema
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)) {
  await db.execute(stmt);
}
// 法令台帳が空だとコンプラ判定が全部 HALT する。実運用と同じ状態にしてから測る
await import("./seed-laws.js");

const {
  runPreCheck,
  buildApplicationText,
  checkApplicationOrder,
  recordApplication,
  recordOutcome,
  analyzeApprovalLearning,
  nextProfileVersion,
  loadApplications,
  REASON_UNAVAILABLE,
  MIN_APPLICATIONS_FOR_VERDICT,
} = await import("../lib/applications.js");

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  OK   ${label}`);
  else {
    console.log(`  NG   ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const JAPAN_POSTS = [
  "Morning light at a small shrine in Kyoto. The air is cold and very quiet.",
  "In Japan, many old houses have a wooden corridor called engawa.",
  "Japanese tea rooms are small on purpose. It makes people sit closer.",
  "Kanazawa in the rain. The stone streets change color.",
  "A japanese garden is designed to look different from every angle.",
  "In Nara the deer bow to people. Nobody taught them, they learned it.",
  "Japanese summer festivals start in the evening, when the heat softens.",
  "This is a komon pattern. In Japan it looks plain from far away.",
  "Old ryokan in Japan still use paper screens for the windows.",
  "Kyoto alleys are narrow because the tax was once based on street width.",
  "Japanese breakfast is rice, fish and soup. Not sweet at all.",
  "Winter in Hokkaido, Japan. The snow is dry and light.",
];

const READY_SNAPSHOT: AccountSnapshot = {
  handle: "@test_hana",
  profileImageUrl: "https://example.com/profile.png",
  headerImageUrl: "https://example.com/header.png",
  bio: "AI-generated Japanese virtual creator. Sharing Japanese culture in imperfect English.",
  createdAt: daysAgo(30),
  followers: 120,
  impressions: 30000,
  posts: JAPAN_POSTS.map((text) => ({ text, hasAffiliateLink: false })),
  websiteAvailable: true,
  domain: "example.com",
  aiDisclosure: "Bio and every post disclose that this is an AI-generated character.",
  trafficDescription: "Organic X posts about Japanese culture. No paid ads.",
  audienceDescription: "English speakers outside Japan interested in Japanese culture.",
  declarations: {
    noPurchasedFollowers: {
      value: true,
      declaredBy: "運営者",
      declaredAt: daysAgo(0),
    },
  },
};

console.log(`\n=== 材料が無いときは PASS にしない（判定不能を通さない） ===`);
const empty = await runPreCheck({});
check(`何も無いアカウントは NOT_READY`, empty.verdict === "NOT_READY");
check(
  `未指定の項目を FAIL ではなく判定不能として扱う`,
  empty.items.some((i) => i.code === "PROFILE_IMAGE" && i.result === "UNKNOWN"),
);
check(
  `判定不能でも申請はできない`,
  empty.blocking.length > 0 && !empty.ready,
  `blocking=${empty.blocking.length}`,
);

console.log(`\n=== 13項目を全部満たせば READY になる ===`);
const ready = await runPreCheck(READY_SNAPSHOT);
if (!ready.ready) {
  for (const b of ready.blocking) console.log(`       未達: ${b.no}.${b.code} — ${b.detail}`);
}
check(`13項目すべてPASSで READY`, ready.verdict === "READY", ready.reason);
check(`項目数は13`, ready.items.length === 13, `${ready.items.length}項目`);

console.log(`\n=== 実運用の下限（投稿10件・7日）を形式条文より優先する ===`);
const thin = await runPreCheck({
  ...READY_SNAPSHOT,
  createdAt: daysAgo(1),
  posts: [{ text: JAPAN_POSTS[0]!, hasAffiliateLink: false }],
});
check(
  `投稿1件・運用1日は落とす`,
  thin.items.find((i) => i.code === "POST_HISTORY")?.result === "FAIL",
);

console.log(`\n=== アフィリリンクだらけのアカウントは落とす ===`);
const spammy = await runPreCheck({
  ...READY_SNAPSHOT,
  posts: JAPAN_POSTS.map((text) => ({ text, hasAffiliateLink: true })),
});
check(
  `リンク付きが全体の1/3を超えたら落とす`,
  spammy.items.find((i) => i.code === "NOT_AFFILIATE_SPAM")?.result === "FAIL",
);

console.log(`\n=== 申請は1社ずつ。一括申請は拒否する ===`);
const blanket = await checkApplicationOrder(["Surfshark", "Airalo"], daysAgo(0));
check(`同時に2社を指定したら止める`, !blanket.allowed && blanket.code === "BLANKET_APPLICATION");

const firstGate = await checkApplicationOrder(["Surfshark"], daysAgo(0));
check(`1社目は通る`, firstGate.allowed, firstGate.message);

console.log(`\n=== NOT_READY のまま申請を記録しない ===`);
let threw = false;
try {
  await recordApplication({
    affiliateName: "Surfshark",
    profileVersion: "v1",
    applicationDate: daysAgo(0),
    snapshot: {},
    applicationText: "x",
    preCheck: empty,
  });
} catch {
  threw = true;
}
check(`13項目未達なら記録を拒否する`, threw);

console.log(`\n=== 申請を記録し、結果が出るまで2社目へ進めない ===`);
const text = buildApplicationText(READY_SNAPSHOT);
check(`申請文にAI開示が入る`, /AI-generated/i.test(text));
check(`申請文に有料広告を使わないと書く`, /organic/i.test(text), text.slice(0, 80));

const first = await recordApplication({
  affiliateName: "Surfshark",
  profileVersion: "v1",
  applicationDate: daysAgo(10),
  snapshot: READY_SNAPSHOT,
  applicationText: text,
  preCheck: ready,
});
check(`申請#1を記録した`, first.id > 0);
check(`最初は審査待ち`, first.row.result === "PENDING");

const blocked = await checkApplicationOrder(["Airalo"], daysAgo(0));
check(`審査待ちがある間は2社目を止める`, !blocked.allowed && blocked.code === "PENDING_EXISTS");

console.log(`\n=== 4分類。NO_RESPONSE を REJECT と混ぜない ===`);
const rejected = await recordOutcome({
  id: first.id,
  result: "REJECT",
  rejectionReason: "Traffic volume is currently too low.",
});
check(`拒否を記録した`, rejected.result === "REJECT");
check(`理由を相手の原文で残す`, rejected.rejection_reason === "Traffic volume is currently too low.");

const afterReject = await checkApplicationOrder(["Airalo"], daysAgo(0));
check(`理由が記録済みなら2社目へ進める`, afterReject.allowed, afterReject.message);

const rows1 = await loadApplications();
check(`次の版は v2`, nextProfileVersion(rows1) === "v2", nextProfileVersion(rows1));

const second = await recordApplication({
  affiliateName: "Airalo",
  profileVersion: "v2",
  applicationDate: daysAgo(5),
  snapshot: READY_SNAPSHOT,
  applicationText: text,
  preCheck: ready,
});
const noResponse = await recordOutcome({ id: second.id, result: "NO_RESPONSE" });
check(`無反応は REJECT ではない`, noResponse.result === "NO_RESPONSE");

const third = await recordApplication({
  affiliateName: "Viator",
  profileVersion: "v3",
  applicationDate: daysAgo(1),
  snapshot: READY_SNAPSHOT,
  applicationText: text,
  preCheck: ready,
});
await recordOutcome({
  id: third.id,
  result: "REJECT",
  reasonUnavailable: true,
});
const rows2 = await loadApplications();
check(
  `理由が取れなかったことを「取れなかった」と記録する（推測を書かない）`,
  rows2.find((r) => r.id === third.id)?.rejection_reason === REASON_UNAVAILABLE,
);

console.log(`\n=== 既存の行を上書きしない ===`);
check(`申請は3行のまま積まれている`, rows2.length === 3, `${rows2.length}行`);
check(`1社目の版が残っている`, rows2.find((r) => r.id === first.id)?.profile_version === "v1");

console.log(`\n=== 少ないサンプルで「これが正解」と書かない ===`);
const learn = await analyzeApprovalLearning();
check(
  `承認0件・拒否2件・無反応1件で結論を出さない`,
  learn.decision === "CONTINUE",
  learn.decision,
);
check(`最低サンプル数は${MIN_APPLICATIONS_FOR_VERDICT}件`, MIN_APPLICATIONS_FOR_VERDICT === 3);

console.log("");
if (failures === 0) {
  console.log(`✅ すべて合格（13項目チェック・申請順・4分類・上書き禁止・結論の抑制）`);
} else {
  console.log(`❌ ${failures}件が不合格`);
  process.exit(1);
}
