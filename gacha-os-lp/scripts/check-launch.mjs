/**
 * 公開前チェック（ビルド時に自動で走ります）。
 *
 * 目的：
 *   「問い合わせが誰にも届かない状態のまま公開してしまう」事故を、
 *   技術的に不可能にすること。
 *
 * 動き：
 *   ・本番環境（VERCEL_ENV=production）でのビルド
 *       → 必須項目が欠けていたらビルドを失敗させる（＝デプロイされない）
 *   ・それ以外（手元での確認ビルド）
 *       → 警告を出すだけで、ビルドは通す
 *
 * 判定の中身は lib/readiness.ts に集約してあります。
 * このファイルは、そこを読んで結果を表示するだけです。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * lib/readiness.ts は TypeScript なので、そのままでは読み込めない。
 * ビルド前に走る軽いチェックにトランスパイラを持ち込みたくないため、
 * 「必須かつ自動判定できる段階（CONNECTED）」だけをここに写している。
 *
 * ★ lib/readiness.ts を変更したら、ここも合わせて直すこと。
 *   ずれていないかは、下の整合チェックが自動で検出する。
 *
 * ★ここで見られるのは CONNECTED まで。
 *   E2E VERIFIED（人が実際に通したか）は機械には判定できない。
 *   だから「ビルドが通った＝公開してよい」ではない。最後は /launch で確認する。
 */

/** 開発・プレビュー用のURL（本番URLとして使ってはいけない） */
const DEV_URL_HINTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  ".vercel.app",
  "staging.",
  "preview.",
  "ngrok",
];

const isProductionUrl = (v) => {
  if (!v || String(v).trim() === "") return false;
  const u = String(v).trim().toLowerCase();
  if (!u.startsWith("https://")) return false;
  return !DEV_URL_HINTS.some((h) => u.includes(h));
};

const REQUIRED_ENV = [
  {
    key: "contact",
    envs: ["CONTACT_WEBHOOK_URL"],
    code: "CONTACT_DESTINATION_MISSING",
    label: "① 問い合わせの通知先",
    fix: "問い合わせを受け取る先（スプレッドシート／CRM／通知先）のURLを設定してください。これが空だと、お客様が送信しても誰にも届きません。",
  },
  {
    key: "ga4",
    envs: ["NEXT_PUBLIC_GA4_ID"],
    code: "GA4_NOT_CONNECTED",
    label: "② GA4（アクセス解析）",
    fix: "GA4 の測定ID（G- から始まる）を設定してください。未設定だと、どこで離脱しているかが一切分からないまま公開することになります。",
  },
  {
    key: "clarity",
    envs: ["NEXT_PUBLIC_CLARITY_ID"],
    code: "CLARITY_NOT_CONNECTED",
    label: "③ Microsoft Clarity（録画・ヒートマップ）",
    fix: "Clarity のプロジェクトIDを設定してください。",
  },
  {
    key: "domain",
    envs: ["NEXT_PUBLIC_SITE_URL"],
    code: "SITE_URL_MISSING",
    label: "④ 本番ドメイン",
    fix: "公開する独自ドメイン（例 https://example.com）を設定してください。localhost / preview / staging / vercel.app のURLは本番URLとして使えません。",
    /** 設定されているだけでは足りず、本番URLの形かどうかまで見る */
    check: (env) => isProductionUrl(env.NEXT_PUBLIC_SITE_URL),
  },
  {
    key: "legal_privacy",
    envs: ["NEXT_PUBLIC_OPERATOR_NAME", "NEXT_PUBLIC_OPERATOR_CONTACT"],
    code: "OPERATOR_INFO_MISSING",
    label: "個人情報の取り扱い（事業者情報）",
    fix: "事業者名と、個人情報に関する問い合わせ窓口（メールアドレス）を設定してください。お名前・メールをお預かりする以上、誰が預かるのかの明示が必要です。",
  },
];

/** lib/readiness.ts と、このファイルの定義がずれていないか確認する */
function verifyInSync() {
  try {
    const src = readFileSync(join(root, "lib", "readiness.ts"), "utf8");
    const missing = REQUIRED_ENV.filter((r) => !src.includes(r.code));
    if (missing.length > 0) {
      console.log(
        C.yellow(
          `  ! lib/readiness.ts と check-launch.mjs の定義がずれています: ${missing
            .map((m) => m.code)
            .join(", ")}`
        )
      );
    }
  } catch {
    /* 読めなくてもチェック自体は続ける */
  }
}

/* ────────────────────────────────
   使ってはいけない表現のチェック
   ────────────────────────────────
   証明できない優位性の主張（景品表示法の優良誤認）と、
   絶対保証の言い切りを、画面に出るファイルから機械的に見つける。
   人の目視だけだと、書いた本人には見えなくなるため。 */
const BANNED_PHRASES = [
  { word: "業界唯一", why: "客観的に証明できない優位性の主張" },
  { word: "唯一のシステム", why: "客観的に証明できない優位性の主張" },
  { word: "日本初", why: "客観的に証明できない優位性の主張" },
  { word: "業界初", why: "客観的に証明できない優位性の主張" },
  { word: "世界初", why: "客観的に証明できない優位性の主張" },
  { word: "ナンバーワン", why: "根拠のない順位表示" },
  { word: "必ず儲か", why: "利益の保証は不可" },
  { word: "絶対に儲か", why: "利益の保証は不可" },
  { word: "100%安全", why: "絶対保証の言い切り" },
  { word: "絶対に安全", why: "絶対保証の言い切り" },
  { word: "落ちません", why: "サーバーの絶対保証は不可" },
  { word: "赤字を予知", why: "予知ではなく事前シミュレーション" },
  { word: "赤字を防げます", why: "結果の保証は不可" },
];

/** 画面に出るコードだけを対象にする（社内ドキュメントは対象外） */
const COPY_DIRS = ["app", "components", "content", "config"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * コメントを取り除いてから見る。
 *
 * ★なぜ必要か（2026-08-22）
 *
 *   このリポジトリでは、危ない書き方をコメントで戒めています。
 *     「★『必ず儲かる』『絶対』のような断定は書かないこと（景品表示法）」
 *
 *   ところが、以前はコメントも中身も区別せず1行ずつ見ていたため、
 *   この「書かないこと」という注意書き自体が違反として検出され、
 *   公開が止まりました。
 *
 *   これを放っておくと、直し方は2つしかありません。
 *     ① 注意書きのほうを消す
 *     ② チェックのほうを消す
 *   どちらも、この仕組みを弱くします。だから、
 *   「画面に出ない文字は見ない」と決めます。
 *
 *   コメントは画面に出ません。出るのは中身だけです。
 */
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    let kept = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          i = line.length;
        } else {
          inBlock = false;
          i = end + 2;
        }
        continue;
      }
      if (line.startsWith("/*", i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      /*
        「//」は行コメント。
        ただし「https://」のような場所で切らないよう、直前が「:」なら無視する。
      */
      if (line.startsWith("//", i) && line[i - 1] !== ":") break;
      kept += line[i];
      i += 1;
    }
    out.push(kept);
  }
  return out;
}

function checkPhrases() {
  const hits = [];
  for (const d of COPY_DIRS) {
    for (const file of walk(join(root, d))) {
      /* コメントを外してから見る。行番号を保つため、行数は変えない */
      const lines = stripComments(readFileSync(file, "utf8"));
      lines.forEach((line, i) => {
        for (const b of BANNED_PHRASES) {
          if (line.includes(b.word)) {
            hits.push({ file: relative(root, file), line: i + 1, ...b });
          }
        }
      });
    }
  }
  return hits;
}

const isProduction = process.env.VERCEL_ENV === "production";
const env = process.env;
const has = (v) => Boolean(v && String(v).trim() !== "");

console.log("");
console.log(C.bold("  ── 公開前チェック ──────────────────────────"));
verifyInSync();

const failures = [];

for (const r of REQUIRED_ENV) {
  const ok = r.check ? r.check(env) : r.envs.every((e) => has(env[e]));
  if (ok) {
    console.log(`  ${C.green("✓")} ${r.label}  ${C.dim("CONNECTED")}`);
  } else {
    failures.push(r);
    const mark = isProduction ? C.red("✗") : C.yellow("!");
    console.log(`  ${mark} ${r.label}  ${C.dim(`[${r.code}]`)}`);
  }
}

/* 推奨項目（欠けていても止めない） */
const RECOMMENDED = [
  { env: "NEXT_PUBLIC_GSC_VERIFICATION", label: "Search Console" },
  { env: "MAIL_SYNC_URL", label: "ステップメール連携（任意）" },
];

for (const r of RECOMMENDED) {
  if (has(env[r.env])) {
    console.log(`  ${C.green("✓")} ${r.label}`);
  } else {
    console.log(`  ${C.dim("－")} ${C.dim(`${r.label}（未設定・任意）`)}`);
  }
}

/* 使ってはいけない表現 */
const phraseHits = checkPhrases();
if (phraseHits.length === 0) {
  console.log(`  ${C.green("✓")} 使ってはいけない表現なし`);
} else {
  console.log(`  ${C.red("✗")} 使ってはいけない表現 ${phraseHits.length}件`);
  for (const h of phraseHits) {
    console.log(
      C.red(`      ${h.file}:${h.line}  「${h.word}」`) + C.dim(` … ${h.why}`)
    );
  }
  failures.push({
    code: "BANNED_PHRASE",
    label: "使ってはいけない表現",
    fix: "証明できない優位性の主張や、絶対保証の言い切りを、事実ベースの表現に書き換えてください。",
    envs: ["（環境変数ではなく、本文の修正が必要です）"],
  });
}

console.log(C.bold("  ────────────────────────────────────────────"));

if (failures.length === 0) {
  console.log(C.green("  CONNECTED まではそろっています。"));
  console.log(
    C.dim(
      "  ただし、これで公開してよいとは限りません。実際に届いたか・実際に計測されたか\n" +
        "  （E2E VERIFIED）は機械には判定できません。最後は /launch で確認してください。"
    )
  );
  console.log("");
  process.exit(0);
}

if (!isProduction) {
  console.log(
    C.yellow(
      `  警告：${failures.length}件が未設定です（本番ビルドではありません）。`
    )
  );
  console.log(
    C.dim("  本番として公開する際には、この状態ではビルドが失敗します。")
  );
  console.log("");
  process.exit(0);
}

/* ── 本番：ここで止める ── */
console.log("");
console.log(C.red(C.bold("  本番公開を中止しました。")));
console.log("");
for (const f of failures) {
  console.log(C.red(`  ${f.code}`));
  console.log(`    ${f.label} が未設定です。`);
  console.log(C.dim(`    ${f.fix}`));
  console.log(C.dim(`    環境変数: ${f.envs.join(" / ")}`));
  console.log("");
}
console.log(
  C.dim("  設定後にもう一度デプロイしてください。詳しくは /launch で確認できます。")
);
console.log("");
process.exit(1);
