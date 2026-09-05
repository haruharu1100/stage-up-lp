/**
 * 公開前チェック（外部サービスの送り口）。
 *
 * ═══════════════════════════════════════════════════════
 * ★このチェックが止めたい、たった1つの事故
 * ═══════════════════════════════════════════════════════
 *
 *   「確認用（Mock）のまま、本番を開けてしまう」
 *
 *   確認用のままだと、こうなります。
 *
 *     ・会員登録の確認メールが、1通も届かない
 *     ・パスワード再設定のメールも、1通も届かない
 *     ・画面には「送信しました」と出る
 *     ・エラーは1つも出ない。誰も気づかない
 *     ・お客様は、自分では二度と登録できない
 *
 *   届かなかった人は、苦情も言いません。黙って離れます。
 *   ですので、人の注意力ではなく、ビルドで止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★止めるのは本番だけ
 * ═══════════════════════════════════════════════════════
 *
 *   手元での確認ビルドまで止めると、
 *   「とりあえず何か入れて黙らせる」が始まります。
 *   そうなった時点で、本当に止めたい1件も止められなくなります。
 *
 *     本番（VERCEL_ENV=production / DATABASE_ENV=production）
 *       → 足りなければビルドを失敗させる（＝デプロイされない）
 *     それ以外
 *       → 今どちらを使っているかを表示するだけ
 *
 * ═══════════════════════════════════════════════════════
 * ★判定を2か所に書いていることについて
 * ═══════════════════════════════════════════════════════
 *
 *   本体の判定は lib/server/mail/index.ts の mailReadiness です。
 *   ここ（ビルド前チェック）は TypeScript を読めないので、
 *   同じ判定を写しています。
 *
 *   写しがずれると、片方だけ直したときにすり抜けます。
 *   ですので、下の「ずれ検出」で、本体側に必要な文言が
 *   残っているかを毎回確かめます。消えていたら止めます。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const env = process.env;
const t = (v) => String(v ?? "").trim();

/** 本番かどうか。どちらか一方でも production なら本番とみなす */
const isProduction =
  t(env.DATABASE_ENV).toLowerCase() === "production" ||
  t(env.VERCEL_ENV).toLowerCase() === "production";

/* ══════════════════════════════════════════════
   ① メール
   ══════════════════════════════════════════════ */

const MAIL_FORMATS = ["resend", "sendgrid", "generic"];

function checkMail() {
  const want = (t(env.MAIL_PROVIDER) || "mock").toLowerCase();

  if (want !== "http") {
    return {
      name: "メール送信",
      using: `確認用（Mock）${want === "mock" ? "" : `／指定値 "${want}" は未対応`}`,
      ok: !isProduction,
      code: "MAIL_PROVIDER_IS_MOCK_IN_PRODUCTION",
      detail:
        "本番なのに、メールの送り口が確認用のままです。このままだと、会員登録の確認メールもパスワード再設定のメールも1通も届きません。",
      fix: 'MAIL_PROVIDER=http と、MAIL_API_URL / MAIL_API_KEY / MAIL_FROM / MAIL_API_FORMAT を設定してください。',
    };
  }

  const missing = [];
  if (t(env.MAIL_API_URL) === "") missing.push("MAIL_API_URL");
  if (t(env.MAIL_API_KEY) === "") missing.push("MAIL_API_KEY");
  if (t(env.MAIL_FROM) === "") missing.push("MAIL_FROM");
  if (t(env.MAIL_API_FORMAT) === "") missing.push("MAIL_API_FORMAT");

  const invalid = [];
  if (
    t(env.MAIL_API_URL) !== "" &&
    !t(env.MAIL_API_URL).toLowerCase().startsWith("https://")
  ) {
    invalid.push("MAIL_API_URL は https で始まる必要があります");
  }
  if (t(env.MAIL_FROM) !== "" && !t(env.MAIL_FROM).includes("@")) {
    invalid.push("MAIL_FROM がメールアドレスの形になっていません");
  }
  if (
    t(env.MAIL_API_FORMAT) !== "" &&
    !MAIL_FORMATS.includes(t(env.MAIL_API_FORMAT).toLowerCase())
  ) {
    invalid.push(`MAIL_API_FORMAT は ${MAIL_FORMATS.join(" / ")} のどれかです`);
  }

  const bad = [...missing, ...invalid];
  return {
    name: "メール送信",
    using: `本物（HTTP:${t(env.MAIL_API_FORMAT).toLowerCase() || "unset"}）`,
    ok: bad.length === 0 || !isProduction,
    code: missing.length > 0 ? "MAIL_CONFIG_MISSING" : "MAIL_CONFIG_INVALID",
    detail:
      bad.length === 0
        ? ""
        : `メールの送り口の設定が足りません：${bad.join(" / ")}`,
    fix: "配信会社の設定を入れてから、まず自分宛てに1通だけ送って、実際に届くことを確かめてください。",
    /* 本番でなくても、設定の不備は表示だけはする */
    warnOnly: bad.length > 0 && !isProduction,
  };
}

/* ══════════════════════════════════════════════
   ② 決済
   ══════════════════════════════════════════════ */

/**
 * ★このチェックが止めたい事故
 *
 *   「練習用の決済（Mock）のまま、本番を開けてしまう」
 *
 *   そうなると、本番の画面に「支払ったことにする」ボタンが出ます。
 *   押した人は、1円も払わずにポイントを手に入れ、
 *   そのポイントで実在するカードが当たります。
 *   エラーは1つも出ません。気づくのは決算のときです。
 *
 * ★本番の保存先まで見ている理由
 *
 *   鍵だけそろっていても、台帳が検証用の保存先だと、
 *   お金だけ受け取って購入履歴が消える事故になります。
 *   ですので、鍵・確定通知の鍵・本番の保存先を、3つとも見ます。
 */
function checkPayment() {
  const want = (t(env.PAYMENT_PROVIDER) || "mock").toLowerCase();
  const known = ["mock", "stripe", "gmo"];

  if (!known.includes(want)) {
    return {
      name: "決済",
      using: `不明な指定 "${want}"`,
      ok: false,
      code: "PAYMENT_PROVIDER_UNKNOWN",
      detail: `PAYMENT_PROVIDER の値が正しくありません（mock / stripe / gmo）。`,
      fix: "打ち間違いを直してください。",
      /* ★打ち間違いは本番でなくても止める。気づく唯一の機会です */
      hardFail: true,
    };
  }

  if (want === "mock") {
    return {
      name: "決済",
      using: "練習用（Mock）",
      ok: !isProduction,
      code: "PAYMENT_PROVIDER_IS_MOCK_IN_PRODUCTION",
      detail:
        "本番なのに、決済が練習用のままです。このままだと、本番の画面に「支払ったことにする」ボタンが出て、1円も払わずにポイントを増やせます。",
      fix: "決済会社と契約し、PAYMENT_PROVIDER と鍵（APIの鍵・確定通知の鍵）を設定してください。",
    };
  }

  const missing = [];
  if (want === "stripe") {
    if (t(env.STRIPE_SECRET_KEY) === "") missing.push("STRIPE_SECRET_KEY");
    if (t(env.STRIPE_WEBHOOK_SECRET) === "")
      missing.push("STRIPE_WEBHOOK_SECRET");
    if (isProduction && t(env.STRIPE_SECRET_KEY).startsWith("sk_test")) {
      missing.push("STRIPE_SECRET_KEY（本番なのにテスト用の鍵 sk_test です）");
    }
  } else {
    if (t(env.GMO_SHOP_ID) === "") missing.push("GMO_SHOP_ID");
    if (t(env.GMO_SHOP_PASSWORD) === "") missing.push("GMO_SHOP_PASSWORD");
    if (t(env.GMO_WEBHOOK_SECRET) === "") missing.push("GMO_WEBHOOK_SECRET");
  }

  /* 本番の保存先につながっているか（本番のときだけ見る） */
  if (isProduction) {
    if (t(env.DATABASE_ENV).toLowerCase() !== "production")
      missing.push("DATABASE_ENV=production");
    if (t(env.ALLOW_PRODUCTION_DB) !== "yes-i-am-sure")
      missing.push("ALLOW_PRODUCTION_DB=yes-i-am-sure");
    const url = t(env.DATABASE_URL).toLowerCase();
    if (url === "") missing.push("DATABASE_URL");
    else if (
      !url.startsWith("libsql://") &&
      !url.startsWith("https://") &&
      !url.startsWith("wss://")
    ) {
      missing.push("DATABASE_URL（外部の保存先。手元のファイルは不可）");
    }
  }

  return {
    name: "決済",
    using: `本物（${want}）`,
    ok: missing.length === 0,
    code: "PAYMENT_NOT_READY",
    detail:
      missing.length === 0
        ? ""
        : `決済の設定が足りません：${missing.join(" / ")}`,
    fix: "鍵と確定通知の鍵、そして本番の保存先を設定してください。どれか1つでも欠けていると、お金の受け取りか記録のどちらかが壊れます。",
    /* ★本物を選んでいるのに設定が足りないのは、本番でなくても止める */
    hardFail: missing.length > 0,
  };
}

/* ══════════════════════════════════════════════
   ③ ずれ検出（本体の判定が消えていないか）
   ══════════════════════════════════════════════ */

/**
 * ★ここを消さないこと。
 *   本体（lib/server/mail/index.ts）から「本番で Mock を止める」判定が
 *   消えても、このチェックだけは通ってしまいます。
 *   そうなると、ビルドは通るのに送信時は素通り、という
 *   いちばん分かりにくい壊れ方になります。
 */
const MUST_CONTAIN = [
  {
    file: "lib/server/mail/index.ts",
    needles: [
      "MAIL_PROVIDER_IS_MOCK_IN_PRODUCTION",
      "MailNotConfiguredError",
      "isProductionEnv",
    ],
  },
  {
    file: "lib/server/mail/mock.ts",
    needles: ['via: "LOG"'],
  },
  {
    file: "lib/server/payments/types.ts",
    needles: [
      "PAYMENT_PROVIDER_IS_MOCK_IN_PRODUCTION",
      "PAYMENT_PRODUCTION_DB_NOT_CONNECTED",
      "PaymentNotConfiguredError",
    ],
  },
  {
    file: "lib/server/payments/index.ts",
    needles: [
      "MOCK_IN_PRODUCTION",
      "PaymentNotConfiguredError",
      "productionDbState",
      "ALLOW_PRODUCTION_DB",
    ],
  },
  {
    /* ★取り次ぎが元へ戻ると、判定が2か所になり、ずれ始めます */
    file: "lib/server/pointPurchase.ts",
    needles: ["resolvePaymentProvider"],
  },
];

function checkDrift() {
  const problems = [];
  for (const { file, needles } of MUST_CONTAIN) {
    let src = "";
    try {
      src = readFileSync(join(root, file), "utf8");
    } catch {
      problems.push(`${file} が見つかりません。`);
      continue;
    }
    for (const n of needles) {
      if (!src.includes(n)) {
        problems.push(`${file} から「${n}」が消えています。`);
      }
    }
  }
  return problems;
}

/* ══════════════════════════════════════════════
   表示
   ══════════════════════════════════════════════ */

console.log("");
console.log(C.bold("外部サービスの送り口チェック"));
console.log(
  C.dim(
    `  いまの扱い： ${isProduction ? "本番（足りなければビルドを止めます）" : "本番ではない（表示のみ）"}`,
  ),
);
console.log("");

const results = [checkMail(), checkPayment()];
let failed = false;

for (const r of results) {
  if (r.ok && !r.warnOnly) {
    console.log(`  ${C.green("✓")} ${r.name}： ${r.using}`);
    continue;
  }
  /* ★hardFail は、本番でなくても止める。
       「本物を選んでいるのに設定が無い」「名前を打ち間違えた」は、
       手元で気づける唯一の機会だからです。 */
  if (r.hardFail) {
    failed = true;
    console.log(`  ${C.red("✗")} ${r.name}： ${r.using}`);
    console.log(C.red(`      ${r.code}`));
    console.log(`      ${r.detail}`);
    console.log(C.dim(`      → ${r.fix}`));
    continue;
  }
  if (r.warnOnly || (!r.ok && !isProduction)) {
    console.log(`  ${C.yellow("!")} ${r.name}： ${r.using}`);
    if (r.detail) console.log(C.dim(`      ${r.detail}`));
    continue;
  }
  failed = true;
  console.log(`  ${C.red("✗")} ${r.name}： ${r.using}`);
  console.log(C.red(`      ${r.code}`));
  console.log(`      ${r.detail}`);
  console.log(C.dim(`      → ${r.fix}`));
}

const drift = checkDrift();
if (drift.length > 0) {
  failed = true;
  console.log("");
  console.log(`  ${C.red("✗")} 本体の安全装置が変わっています`);
  for (const d of drift) console.log(C.red(`      ${d}`));
  console.log(
    C.dim(
      "      → 「本番で確認用のまま送らせない」判定が本体から消えています。戻してください。",
    ),
  );
}

console.log("");

if (failed) {
  console.log(
    C.red(
      "  公開を中止しました。ここで止めないと、「送信しました」と出るのに1通も届かない、\n" +
        "  または「支払ったことにする」だけでポイントが増える状態のまま公開されます。",
    ),
  );
  console.log("");
  process.exit(1);
}

if (!isProduction) {
  console.log(
    C.dim(
      "  ※ 本番ではないので、確認用（Mock）のままでも進めます。外へは1通も出ません。",
    ),
  );
  console.log("");
}
