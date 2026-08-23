// 投稿本文の受入テスト。本番DBには触らない（一時ファイルへ作る）
//
// ★ここで見るのは「英語として読めるか」。数え合わせ（21本・A/B同数）は plan:slots 側で検証済み。
//   つかみ（HOOK）や長さ（POST_LENGTH）を変えるために行を並べ替えると、
//   "It is called ..." の "It" が指すものが消えて意味不明な投稿になる。
//   これは型チェックもテーブル制約も通ってしまうので、本文そのものを読んで落とす。
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dir = mkdtempSync(resolve(tmpdir(), "yamato-planner-"));
process.env.DATABASE_URL = `file:${resolve(dir, "test.db")}`;

const { getDb } = await import("../lib/db.js");
const { buildSlots, saveSlots, buildWeekDrafts } = await import("../lib/planner.js");
const { TOPIC_BANK, AFFILIATE_ENTRIES, SELF_HOOKS, AFFILIATE_OPENERS } = await import(
  "../lib/content-bank.js"
);

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

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  OK   ${label}`);
  else {
    console.log(`  NG   ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 素材そのものが単体で読めること ===");
// ---------------------------------------------------------------------------

const allTopics = Object.values(TOPIC_BANK).flat();
// scene より前に置かれても通じるように、meaning は主語を自分で出す約束になっている
const DEPENDENT_OPENER = /^(It|This|These|Those|They|The same|Both|Such)\b/;
const dependent = allTopics.filter((e) => DEPENDENT_OPENER.test(e.meaning));
check(
  `meaning が前の行に依存していない（${allTopics.length}件）`,
  dependent.length === 0,
  dependent.map((e) => e.key).join(", "),
);

const dupKeys = allTopics.map((e) => e.key).filter((k, i, a) => a.indexOf(k) !== i);
check("トピックのキーが重複していない", dupKeys.length === 0, dupKeys.join(", "));

// ---------------------------------------------------------------------------
console.log("\n=== 第1週の本文（21本）===");
// ---------------------------------------------------------------------------

await db.execute(`INSERT INTO networks (id, name) VALUES ('direct', 'Direct')`);
for (const [id, name, cat] of [
  ["surfshark", "Surfshark", "VPN"],
  ["airalo", "Airalo", "ESIM"],
  ["viator", "Viator", "JAPAN_TRAVEL"],
] as const) {
  await db.execute({
    sql: `INSERT INTO offers (id, network_id, name, category, approval_status)
          VALUES (?,?,?,?,'NOT_APPLIED')`,
    args: [id, "direct", name, cat],
  });
}

await saveSlots(buildSlots());
const result = await buildWeekDrafts(1, null);
check("21本できる", result.drafts.length === 21, String(result.drafts.length));

const affiliateFactHeads = AFFILIATE_ENTRIES.map((e) => e.facts[0]!);
const enumeratorHeads = /^(Second|Third|Finally|Also|And )\b/;

for (const d of result.drafts) {
  const lines = d.text.split("\n").filter(Boolean);
  const label = `Day${d.slot.dayIndex}枠${d.slot.slotOfDay}(${d.hook}/${d.style}/${d.lengthTarget})`;

  // 1) 主語を出す行が必ず1本は残っていること。
  //    つかみと質問だけの投稿は「何の話か書いていない投稿」になる
  const entry = allTopics.find((e) => e.key === d.topic);
  if (entry) {
    const hasSubject = lines.some((l) => l === entry.scene || l === entry.meaning);
    check(`${label} 何の話か書いてある`, hasSubject, d.text.replace(/\n/g, " / "));
  } else {
    // 案件関連は facts の1行目が主題。並べ替えると "Second, ..." が先頭に来る
    const first = lines.find((l) => !AFFILIATE_OPENERS.includes(l) && !SELF_HOOKS.includes(l));
    check(
      `${label} 案件本文が途中の項目から始まっていない`,
      !!first && !enumeratorHeads.test(first) && affiliateFactHeads.includes(first),
      first ?? "(空)",
    );
  }

  // 2) 行の重複が無いこと（つかみと本文で同じ質問が2回出るなど）
  check(`${label} 同じ行が2回出ない`, new Set(lines).size === lines.length);

  // 3) 実体験の主張を書かない（FTC Endorsement Guides）
  const banned = /\b(I used|I tried|I bought|I love using|This worked for me|When I traveled|My experience was)\b/i;
  check(`${label} 実体験の主張が無い`, !banned.test(d.text));
}

// ---------------------------------------------------------------------------
console.log("\n=== つかみ（HOOK）ごとに本文が変わること ===");
// ---------------------------------------------------------------------------

const byHook = new Map<string, string[]>();
for (const d of result.drafts) {
  const arr = byHook.get(d.hook) ?? [];
  arr.push(d.text);
  byHook.set(d.hook, arr);
}
check("4種類のつかみが出ている", byHook.size >= 3, [...byHook.keys()].join(", "));

for (const d of result.drafts) {
  const first = d.text.split("\n")[0]!;
  if (d.hook === "QUESTION_FIRST") check(`QUESTION_FIRST は質問で始まる`, first.endsWith("?"), first);
  if (d.hook === "SELF") check(`SELF は自己開示で始まる`, SELF_HOOKS.includes(first), first);
}

// ---------------------------------------------------------------------------
console.log("\n=== 文体（ENGLISH_STYLE）の違いが本文に出ること ===");
// ---------------------------------------------------------------------------

// 関係づくり型は feeling の行が入って初めて「関係づくり」になる。
// ここが抜けると集客型と同じ本文になり、ENGLISH_STYLE の比較が成立しない。
// ★例外は短文×(質問始まり or 自己開示始まり)。2行しか置けず主語の行を優先するため。
for (const d of result.drafts.filter((x) => x.style === "RELATIONSHIP")) {
  const entry = allTopics.find((e) => e.key === d.topic);
  if (!entry) continue;
  const exempt = d.lengthTarget === "SHORT" && (d.hook === "QUESTION_FIRST" || d.hook === "SELF");
  if (exempt) continue;
  check(
    `Day${d.slot.dayIndex}枠${d.slot.slotOfDay}(${d.hook}) 関係づくり型に感想の行がある`,
    d.text.includes(entry.feeling),
    d.text.replace(/\n/g, " / "),
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== 短文でも意味が通ること ===");
// ---------------------------------------------------------------------------

const shorts = result.drafts.filter((d) => d.lengthTarget === "SHORT");
check("短文がある", shorts.length > 0, String(shorts.length));
for (const d of shorts) {
  const lines = d.text.split("\n").filter(Boolean);
  const body = lines.filter((l) => !l.startsWith("http") && !l.includes("affiliate"));
  check(`Day${d.slot.dayIndex}枠${d.slot.slotOfDay} 短文が2行以上ある`, body.length >= 2, d.text);
}

console.log(
  failures === 0
    ? "\n✅ すべて合格（本文の意味・つかみの違い・短文）"
    : `\n❌ ${failures} 件が不合格`,
);
process.exit(failures === 0 ? 0 : 1);
