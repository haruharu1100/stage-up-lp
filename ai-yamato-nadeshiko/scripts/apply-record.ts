/**
 * 申請を実験として記録し、「何を変えた → 何が起きた」を表で出す。
 *
 * ★このスクリプトが守っていること
 *   - 申請は1社ずつ。前の結果が出るまで2社目へ進めない。一括申請は拒否する
 *   - 13項目チェックが NOT_READY なら記録しない
 *   - 結果は PASS / REJECT / MORE_INFORMATION_REQUIRED / NO_RESPONSE の4分類
 *     NO_RESPONSE を REJECT と混ぜない
 *   - 修正して出し直すときは版を上げて新しい行を積む（既存行は上書きしない）
 *   - 拒否理由が取れなかったら「取れなかった」と記録する。推測は書かない
 *
 * 実行:
 *   npm run apply:record -- --affiliate=Surfshark --version=v1 --account=data/account.json
 *   npm run apply:record -- --id=1 --result=PASS
 *   npm run apply:record -- --id=1 --result=REJECT --reason="相手の原文をそのまま"
 *   npm run apply:record -- --id=1 --result=REJECT --reason-unavailable
 *   npm run apply:record -- --id=1 --result=MORE_INFORMATION_REQUIRED --followup="求められた項目"
 *   npm run apply:record -- --id=1 --result=NO_RESPONSE
 *   npm run apply:record -- --learn
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runPreCheck,
  loadAccountSnapshot,
  buildApplicationText,
  checkApplicationOrder,
  recordApplication,
  recordOutcome,
  analyzeApprovalLearning,
  nextProfileVersion,
  loadApplications,
  isReasonUnavailable,
  RESULT_CLASSES,
  MIN_APPLICATIONS_FOR_VERDICT,
  type AccountSnapshot,
  type ApplicationResult,
  type LearningReport,
} from "../lib/applications.js";
import { appendEntry } from "../lib/obsidian.js";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const argAll = (name: string): string[] =>
  argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const flag = (name: string): boolean => argv.includes(`--${name}`);

// 全角混じりを等幅で並べる
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}
function trunc(s: string, n: number): string {
  if (width(s) <= n) return s;
  let out = "";
  for (const ch of s) {
    if (width(out) + width(ch) > n - 1) break;
    out += ch;
  }
  return `${out}…`;
}
const pad = (s: string, n: number) => {
  const t = trunc(s, n - 1);
  return t + " ".repeat(Math.max(0, n - width(t)));
};
const line = (n = 100) => "─".repeat(n);

/**
 * 申請文のような長い項目は「先頭34字 → 先頭34字」では何を変えたか分からない。
 * 行単位で足した行・消した行を出す（学習の軸はここなので潰さない）
 */
function describeChange(before: string, after: string): string[] {
  if (before.length <= 60 && after.length <= 60 && !before.includes("\n") && !after.includes("\n")) {
    return [`${before} → ${after}`];
  }
  const b = before.split("\n").map((l) => l.trim()).filter(Boolean);
  const a = after.split("\n").map((l) => l.trim()).filter(Boolean);
  const added = a.filter((l) => !b.includes(l));
  const removed = b.filter((l) => !a.includes(l));
  const out: string[] = [`${before.length}字 → ${after.length}字`];
  for (const l of removed.slice(0, 3)) out.push(`− 消した行: ${trunc(l, 76)}`);
  for (const l of added.slice(0, 3)) out.push(`＋ 足した行: ${trunc(l, 76)}`);
  if (removed.length > 3) out.push(`− 他 ${removed.length - 3}行を削除`);
  if (added.length > 3) out.push(`＋ 他 ${added.length - 3}行を追加`);
  if (added.length === 0 && removed.length === 0) out.push("（行の並びだけが変わった）");
  return out;
}

const RESULT_JA: Record<ApplicationResult, string> = {
  PENDING: "審査待ち",
  PASS: "承認",
  REJECT: "拒否",
  MORE_INFORMATION_REQUIRED: "追加情報要求",
  NO_RESPONSE: "無反応",
};

// ---------------------------------------------------------------- 学習表
function printLearning(r: LearningReport): void {
  console.log("");
  console.log(line());
  console.log("【学習】何を変えた → 何が起きた");
  console.log("");

  if (r.rows.length === 0) {
    console.log("  申請がまだ1件も無い。");
  } else {
    console.log(
      `  ${pad("ID", 4)}${pad("申請日", 12)}${pad("ASP", 20)}${pad("版", 6)}${pad("結果", 14)}${pad("理由 / 追加情報", 40)}`,
    );
    console.log(`  ${line(96)}`);
    for (const a of r.rows) {
      const note =
        a.result === "REJECT"
          ? isReasonUnavailable(a.rejection_reason)
            ? "★理由を取得できなかった"
            : (a.rejection_reason ?? "（未記録）")
          : a.result === "MORE_INFORMATION_REQUIRED"
            ? (a.followup ?? "（未記録）")
            : a.result === "PASS"
              ? `承認日 ${a.approved_at ?? "未記録"}`
              : a.result === "NO_RESPONSE"
                ? "無反応（REJECTとは別物）"
                : "";
      console.log(
        `  ${pad(`#${a.id}`, 4)}${pad(a.application_date, 12)}${pad(a.affiliate_name, 20)}` +
          `${pad(a.profile_version, 6)}${pad(RESULT_JA[a.result], 14)}${pad(note, 40)}`,
      );
    }

    console.log("");
    console.log("  ■ 版ごとの変更点と、その次に起きたこと");
    if (r.transitions.length === 0) {
      console.log("    申請が1件だけなので、比べる相手がいない。");
    }
    for (const t of r.transitions) {
      console.log("");
      console.log(
        `    #${t.from.id}(${t.from.profile_version} ${t.from.affiliate_name} → ${RESULT_JA[t.from.result]})` +
          ` → #${t.to.id}(${t.to.profile_version} ${t.to.affiliate_name} → ${RESULT_JA[t.to.result]})`,
      );
      if (t.changed.length === 0) {
        console.log("      変えた項目: なし（同じ条件で別プログラムへ申請）");
      } else {
        console.log(`      変えた項目: ${t.changed.length}件 ／ ${t.note}`);
        for (const c of t.changed) {
          const lines = describeChange(c.before, c.after);
          console.log(`        - ${c.label}: ${lines[0] ?? ""}`);
          for (const l of lines.slice(1)) console.log(`            ${l}`);
        }
      }
      if (t.contextDrift.length) {
        console.log(
          `      同時に動いた数値(交絡): ${t.contextDrift.map((c) => `${c.label} ${c.before}→${c.after}`).join(" / ")}`,
        );
      }
      console.log(`      → 結果は ${RESULT_JA[t.to.result]}${t.attributable ? "" : "（原因を特定できない）"}`);
    }
  }

  console.log("");
  console.log("  ■ 集計");
  console.log(
    `    ${RESULT_CLASSES.map((c) => `${RESULT_JA[c]} ${r.totals[c]}件`).join(" / ")} / 審査待ち ${r.totals.PENDING}件`,
  );
  console.log(
    `    承認率: ${r.approvalRate === null ? "算出不可" : `${(r.approvalRate * 100).toFixed(0)}%`}` +
      `（分母は承認+拒否の${r.judged}件。無反応と審査待ちは「審査されたか」すら分からないので分母に入れない）`,
  );

  const rejected = r.rows.filter((a) => a.result === "REJECT");
  if (rejected.length) {
    console.log("");
    console.log("  ■ 拒否理由（相手の原文。要約も推測もしない）");
    for (const a of rejected) {
      console.log(`    #${a.id} ${a.affiliate_name}: ${a.rejection_reason ?? "（未記録）"}`);
    }
  }

  if (r.requestedItems.length) {
    console.log("");
    console.log("  ■ 追加情報として求められた項目（★次の申請で先回りして書く）");
    for (const q of r.requestedItems) console.log(`    - ${q}`);
  }

  if (r.warnings.length) {
    console.log("");
    console.log("  ■ 警告");
    for (const w of r.warnings) console.log(`    ★ ${w}`);
  }

  console.log("");
  console.log(`  判定: ${r.decision}`);
  console.log(`    ${r.reason}`);
  if (r.rows.length < MIN_APPLICATIONS_FOR_VERDICT) {
    console.log(`    ※ 申請${MIN_APPLICATIONS_FOR_VERDICT}件未満で「この書き方が正解」とは書かない`);
  }
  console.log("    ※ 1社の承認可否で事業全体のGO/STOPは判断しない（MASTER_RULES 4-2）");
  console.log("");
}

// ---------------------------------------------------------------- 結果の記録
const idArg = arg("id");
if (idArg) {
  const id = Number(idArg);
  const resultArg = (arg("result") ?? "").toUpperCase();
  if (!(RESULT_CLASSES as readonly string[]).includes(resultArg)) {
    console.error(
      `--result は ${RESULT_CLASSES.join(" / ")} のどれか（受け取った値: ${arg("result") ?? "なし"}）。` +
        "★NO_RESPONSE を REJECT と混ぜない。原因が違う（届いていない／保留中／黙殺）",
    );
    process.exit(1);
  }
  try {
    const row = await recordOutcome({
      id,
      result: resultArg as (typeof RESULT_CLASSES)[number],
      rejectionReason: arg("reason"),
      reasonUnavailable: flag("reason-unavailable"),
      followup: arg("followup"),
      approvedAt: arg("approved-at"),
    });
    console.log("");
    console.log(`申請#${row.id} ${row.affiliate_name}（${row.profile_version}）の結果を記録した。`);
    console.log(`  結果: ${RESULT_JA[row.result]}`);
    if (row.rejection_reason) {
      console.log(
        `  拒否理由: ${row.rejection_reason}${isReasonUnavailable(row.rejection_reason) ? "  ← 推測は書いていない" : ""}`,
      );
    }
    if (row.followup) console.log(`  やり取り: ${row.followup}`);
    if (row.approved_at) console.log(`  承認日: ${row.approved_at}`);
    if (row.result === "REJECT") {
      console.log("");
      console.log("  次: 理由をVaultへ保存 → 直すのは1箇所だけ → 版を上げて新しい行を積む → 2社目へ");
    }
    if (row.result === "MORE_INFORMATION_REQUIRED") {
      console.log("");
      console.log("  次: 求められた項目は審査の実際の関心事。次の申請文で先回りして書く");
    }

    // 結果はVaultにも残す。DBだけに置くと、人が読み返せる場所に理由が残らない
    const logPath = appendEntry("applications", {
      kind: "FACT",
      title: `${row.affiliate_name}（${row.profile_version}）→ ${RESULT_JA[row.result]}`,
      sourceUrl: `${row.affiliate_name} からの回答（申請#${row.id}）`,
      body: [
        `- 申請日: ${row.application_date}`,
        `- 結果: ${RESULT_JA[row.result]}（\`${row.result}\`）`,
        row.rejection_reason
          ? `- 理由: ${row.rejection_reason}${isReasonUnavailable(row.rejection_reason) ? "（推測は書いていない）" : ""}`
          : null,
        row.followup ? `- やり取り: ${row.followup}` : null,
        row.approved_at ? `- 承認日: ${row.approved_at}` : null,
        "",
        row.result === "REJECT"
          ? "次にやること: **直すのは1箇所だけ。** 複数変えると何が効いたか分からなくなる。版を上げて新しい行を積む。"
          : row.result === "NO_RESPONSE"
            ? "★これは REJECT ではない。届いていない／保留中／黙殺のどれかで、原因が違う。"
            : "",
      ]
        .filter((l) => l !== null && l !== "")
        .join("\n"),
    });
    console.log(`  Obsidianへ追記: ${logPath}`);
  } catch (e) {
    console.error(`\n記録しない: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  printLearning(await analyzeApprovalLearning());
  process.exit(0);
}

// ---------------------------------------------------------------- 学習表だけ
if (flag("learn") || argv.length === 0) {
  printLearning(await analyzeApprovalLearning());
  if (argv.length === 0) {
    console.log("使い方:");
    console.log("  申請を記録  : npm run apply:record -- --affiliate=<ASP名> --version=v1 --account=data/account.json");
    console.log("  結果を記録  : npm run apply:record -- --id=<ID> --result=PASS|REJECT|MORE_INFORMATION_REQUIRED|NO_RESPONSE");
    console.log("  学習表だけ  : npm run apply:record -- --learn");
    console.log("");
  }
  process.exit(0);
}

// ---------------------------------------------------------------- 申請の記録
const names = argAll("affiliate").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
if (names.length === 0) {
  console.error("--affiliate=<ASP名> が要る");
  process.exit(1);
}
const applicationDate = arg("date") ?? new Date().toISOString().slice(0, 10);

const gate = await checkApplicationOrder(names, applicationDate);
if (!gate.allowed) {
  console.log("");
  console.log(line());
  console.log(`申請を止めた（${gate.code}）`);
  console.log("");
  console.log(`  ${gate.message}`);
  console.log("");
  printLearning(await analyzeApprovalLearning());
  process.exit(1);
}

const affiliate = names[0] ?? "";
const accountPath = resolve(process.cwd(), arg("account") ?? "data/account.json");
let snapshot: AccountSnapshot = {};
if (existsSync(accountPath)) snapshot = loadAccountSnapshot(accountPath);

const preCheck = await runPreCheck(snapshot);
if (!preCheck.ready) {
  console.log("");
  console.log(`申請を記録しない: 13項目チェックが ${preCheck.verdict}`);
  for (const b of preCheck.blocking) console.log(`  ✕ ${b.no}. ${b.label} — ${b.detail}`);
  console.log("");
  console.log("  詳細: npm run apply:check -- --affiliate=" + affiliate);
  console.log("");
  process.exit(1);
}

const existing = await loadApplications();
const version = arg("version") ?? nextProfileVersion(existing);
const textFile = arg("text-file");
const applicationText = textFile
  ? readFileSync(resolve(process.cwd(), textFile), "utf8")
  : buildApplicationText(snapshot);

try {
  const { id } = await recordApplication({
    affiliateName: affiliate,
    profileVersion: version,
    applicationDate,
    snapshot,
    applicationText,
    preCheck,
  });
  console.log("");
  console.log(`申請#${id} ${affiliate}（${version} / ${applicationDate}）を記録した。結果は PENDING。`);
  console.log(`  13項目チェック${preCheck.items.length}件を application_checks へ紐付けて保存した（上書きなし）。`);
  console.log("");
  console.log("  ★結果が出るまで2社目へ進まない。結果が出たら:");
  console.log(`     npm run apply:record -- --id=${id} --result=PASS`);
  console.log(`     npm run apply:record -- --id=${id} --result=REJECT --reason="相手の原文"`);
  console.log(`     npm run apply:record -- --id=${id} --result=REJECT --reason-unavailable`);
  console.log(`     npm run apply:record -- --id=${id} --result=MORE_INFORMATION_REQUIRED --followup="求められた項目"`);
  console.log(`     npm run apply:record -- --id=${id} --result=NO_RESPONSE`);
} catch (e) {
  console.error(`\n記録しない: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

printLearning(await analyzeApprovalLearning());
