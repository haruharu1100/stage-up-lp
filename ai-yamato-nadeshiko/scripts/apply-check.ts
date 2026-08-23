/**
 * 申請前チェック13項目を機械で走らせる。
 *
 * ★13項目が1つでも欠けたら NOT_READY を返し、申請文を一切出力しない。
 *   「とりあえず出してみる」を物理的にできなくするのがこのスクリプトの役目。
 *
 * 実行:
 *   npm run apply:check -- --affiliate=Surfshark
 *   npm run apply:check -- --affiliate=Surfshark --account=data/account.json
 *   npm run apply:check -- --template     （アカウント実態ファイルのひな形を出す）
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runPreCheck,
  persistPreCheck,
  buildApplicationText,
  loadAccountSnapshot,
  accountAgeDays,
  MIN_POST_COUNT,
  MIN_ACCOUNT_AGE_DAYS,
  type AccountSnapshot,
  type PreCheckItem,
} from "../lib/applications.js";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const line = (n = 92) => "─".repeat(n);
const MARK: Record<string, string> = { PASS: "⭕", FAIL: "✕", UNKNOWN: "？" };

const TEMPLATE: AccountSnapshot = {
  handle: "@example_handle",
  profileImageUrl: "",
  headerImageUrl: "",
  bio: "",
  createdAt: "2026-08-22",
  followers: 0,
  impressions: 0,
  websiteAvailable: false,
  domain: "",
  aiDisclosure: "",
  trafficDescription: "",
  audienceDescription: "",
  posts: [{ text: "", hasAffiliateLink: false, postedAt: "2026-08-22" }],
  declarations: {
    noPurchasedFollowers: { value: false, declaredBy: "", declaredAt: "" },
  },
};

if (flag("template")) {
  const out = arg("account") ?? "data/account.json";
  const path = resolve(process.cwd(), out);
  if (existsSync(path)) {
    console.log(`既に存在するので上書きしない: ${path}`);
  } else {
    writeFileSync(path, `${JSON.stringify(TEMPLATE, null, 2)}\n`, "utf8");
    console.log(`ひな形を書き出した: ${path}`);
    console.log("Xの実際の値で埋めてから npm run apply:check -- --affiliate=<ASP名> を実行する。");
    console.log("★埋められない項目は空のままにする。空欄は「判定不能」として扱われ、勝手にPASSにはならない。");
  }
  process.exit(0);
}

const affiliate = arg("affiliate") ?? "（未指定）";
const accountPath = resolve(process.cwd(), arg("account") ?? "data/account.json");

let snapshot: AccountSnapshot;
if (existsSync(accountPath)) {
  snapshot = loadAccountSnapshot(accountPath);
} else {
  // ファイルが無いときに空オブジェクトで走らせるのは正しい。全項目が「判定不能」になり NOT_READY になる
  snapshot = {};
}

const report = await runPreCheck(snapshot);
await persistPreCheck(report.items, null);

console.log("");
console.log("AI YAMATO NADESHIKO ／ アフィリエイト申請前チェック（13項目）");
console.log(`申請先: ${affiliate}`);
console.log(
  `アカウント実態: ${existsSync(accountPath) ? accountPath : `${accountPath} が無い（全項目が判定不能になる）`}`,
);
console.log(`投稿の出所: ${report.postsSource}`);
console.log(line());
console.log("");

for (const it of report.items) {
  console.log(`${MARK[it.result] ?? "?"} ${String(it.no).padStart(2)}. ${it.label}`);
  console.log(`      ${it.detail}`);
}

console.log("");
console.log(line());
console.log(`判定: ${report.verdict}`);
console.log(`  ${report.reason}`);

if (!report.ready) {
  console.log("");
  console.log("【申請できない理由】");
  for (const b of report.blocking) {
    console.log(`  ${MARK[b.result] ?? "?"} ${b.no}. ${b.label}`);
    console.log(`     ${b.detail}`);
  }
  console.log("");
  console.log("【ここを埋める】");
  const todo: string[] = [];
  const has = (code: string) => report.blocking.some((b: PreCheckItem) => b.code === code);
  if (has("PROFILE_IMAGE") || has("HEADER_IMAGE") || has("BIO_COMPLETE"))
    todo.push("プロフィール画像・ヘッダー・Bioを実際に設定し、その値をアカウント実態ファイルへ書く");
  if (has("AI_DISCLOSURE_IN_BIO"))
    todo.push("Bioに AI-generated を入れる（AI開示は隠さない。これがブランドの前提）");
  if (has("JAPAN_THEME_CLEAR"))
    todo.push("Bioと直近投稿の半分以上を日本テーマにする");
  if (has("POST_HISTORY"))
    todo.push(
      `通常投稿を${MIN_POST_COUNT}件以上・${MIN_ACCOUNT_AGE_DAYS}日以上かけて積む` +
        `（現在 運用${accountAgeDays(snapshot.createdAt) ?? "不明"}日）。` +
        "申請直前に作ったアカウントに見えると形式を満たしても落ちる",
    );
  if (has("NOT_AFFILIATE_SPAM"))
    todo.push("アフィリリンク付き投稿を全体の1/3以下まで下げる（リンクは文脈のある投稿にだけ置く）");
  if (has("NO_ADULT_CONTENT") || has("NO_GAMBLING_CONTENT") || has("NO_FAKE_TESTIMONIAL"))
    todo.push("該当する投稿本文を直す（判定停止＝法令台帳が古い場合は laws を再確認する）");
  if (has("NO_PURCHASED_FOLLOWERS"))
    todo.push(
      "declarations.noPurchasedFollowers に人間の宣言（value/declaredBy/declaredAt）を書く。" +
        "これは機械で検証できない項目なので、宣言が無い限りPASSにしない",
    );
  if (has("NO_AUTO_FOLLOW_LIKE") || has("NO_INDISCRIMINATE_REPLY"))
    todo.push("検出された自動Follow/Like・リプライ関連の実装を確認する");
  for (const t of todo) console.log(`  - ${t}`);

  console.log("");
  console.log("★申請文は出力しない。13項目を全部満たすまで申請しない（申請学習.md 4章）。");
  console.log("");
  process.exit(1);
}

console.log("");
console.log(line());
console.log("【申請文】そのままフォームへ貼る。この文面も application_text として保存し、版を上げて改善する");
console.log("");
console.log(buildApplicationText(snapshot));
console.log("");
console.log(line());
console.log("次にやること:");
console.log(
  `  npm run apply:record -- --affiliate=${affiliate} --version=v1 --account=${arg("account") ?? "data/account.json"}`,
);
console.log("  ★1社ずつ。同日に複数ASPへ一括申請しない（結果が出るまで2社目へ進まない）。");
console.log("");
