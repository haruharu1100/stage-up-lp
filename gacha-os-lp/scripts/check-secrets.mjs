/**
 * 鍵が、git に入る場所へ書かれていないかを、機械で調べる。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、この検査が要るのか（2026-08-26）
 * ═══════════════════════════════════════════════
 *
 *   二段階認証の鍵を、提出資料の中に書いてしまいました。
 *   Preview 用ではありましたが、いちど人の目に触れた鍵は、
 *   もう「その人しか知らないもの」ではありません。
 *   二段階認証は「その人しか知らない」ことだけが根拠なので、
 *   触れた時点で、意味を失います。
 *
 *   このとき効いた歯止めは、ひとつもありませんでした。
 *   気づいたのは人間で、しかも公開したあとでした。
 *
 *   ★「気をつける」は、対策ではありません。
 *     気をつけるのは人で、人は必ず忘れます。
 *     忘れても止まるように、機械に見張らせます。
 *
 * ═══════════════════════════════════════════════
 * ★何を見るのか
 * ═══════════════════════════════════════════════
 *
 *   git に入る予定のファイルだけを見ます。
 *   （.gitignore で外してあるものは、git に入らないので見ません）
 *
 *   1) 認証アプリの鍵のかたち　… 大文字と2〜7だけが32文字ならんだもの
 *   2) QRコードの文字列　　　　… otpauth:// で始まるもの
 *   3) 鍵を環境変数へ書いた跡　… MFA_SECRET=◯◯◯ のように中身つきのもの
 *   4) データベースの合言葉　　… DATABASE_AUTH_TOKEN=◯◯◯ のように中身つきのもの
 *
 * ═══════════════════════════════════════════════
 * ★見つけたときに、この道具がしないこと
 * ═══════════════════════════════════════════════
 *
 *   見つけた鍵を、画面に出しません。
 *   出してしまうと、この検査そのものが、鍵を広める道具になります。
 *   出すのは「どのファイルの、何行目に、どの種類のものがあるか」までです。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ══════════════════════════════════════════════
   探すもの
   ══════════════════════════════════════════════ */
/*
  ★「鍵のかたちをしているが、鍵ではないもの」を、先に除いておく。

    除かずに全部止めると、みんなが検査を切ります。
    切られた検査は、無いのと同じです。
    だから「なぜ鍵でないと言い切れるか」を1つずつ書いて、そのぶんだけ除きます。
*/
const KAGI_DE_NAI = [
  /* base32 の文字表そのもの。32文字だが、誰でも知っている決まりの並び */
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  /* RFC の例に出てくる、公開された試験用の値。これで守っている本物は無い */
  "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
];

const SAGASU = [
  {
    name: "認証アプリの鍵（TOTP secret）",
    /* 大文字と2〜7だけが32文字。前後が英数字なら別物なので外す */
    re: /(?<![A-Z2-7])[A-Z2-7]{32}(?![A-Z2-7])/g,
    honmono: (hit) => !KAGI_DE_NAI.includes(hit),
    naoshikata:
      "報告や資料に鍵を書かないこと。鍵は .secrets/ にだけ置きます。\n" +
      "      書いてしまったら、scripts/rotate-mfa-preview.mjs で作り直してください。",
  },
  {
    name: "QRコードの文字列（otpauth）",
    re: /otpauth:\/\/[^\s"'`)]+/g,
    /*
      ★組み立てているだけの行は、止めない。
        `otpauth://totp/${label}?${q}` には、鍵は入っていません。
        鍵が入るのは、中身が埋まったあとの文字列だけです。
    */
    honmono: (hit) => !hit.includes("${") && /secret=[A-Z2-7]{16,}/.test(hit),
    naoshikata:
      "QRコードの文字列にも鍵が入っています。資料に貼らないこと。",
  },
  {
    name: "鍵を書いた環境変数（MFA_SECRET）",
    re: /MFA_SECRET\s*[=:]\s*["']?[A-Z2-7]{16,}/g,
    naoshikata: "鍵は .env.local か .secrets/ に置き、資料には書かないこと。",
  },
  {
    name: "データベースの合言葉（DATABASE_AUTH_TOKEN）",
    re: /DATABASE_AUTH_TOKEN\s*[=:]\s*["']?[A-Za-z0-9._\-]{20,}/g,
    naoshikata: "合言葉は .env.local にだけ置くこと。",
  },
];

/* ══════════════════════════════════════════════
   ★わざと書いてある「例」は、見逃してよい

     この検査の説明そのものや、検査の試験の中には、
     わざと鍵のかたちをした文字列を書きます。
     そこまで止めると、検査を書けなくなります。

     見逃すのは、その行に次の印がある場合だけです。
   ══════════════════════════════════════════════ */
const MINOGASU = /検査用のダミー|not-a-real-secret|SECRET_SCAN_OK/;

/* 中身を見ないもの（絵や動画は、文字として読んでも意味がない） */
const MINAI =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|mp4|mov|webm|woff2?|ttf|otf|eot|pdf|zip|gz)$/i;

/* ══════════════════════════════════════════════
   git に入る予定のファイルを、集める
   ══════════════════════════════════════════════ */
/*
  ★git が使えない場所でも、必ず動くこと。（2026-08-26）

    最初は git だけに頼って書きました。
    そうしたら、公開環境（Vercel）には git が置かれておらず、
    そこでこの検査が動かなくなりました。

    このとき、いちばんやってはいけないのは
    「git が無いから、素通りさせる」ことです。
    素通りさせると、公開のときだけ見張りが居ない状態になります。
    しかも画面には何も出ないので、誰も気づきません。

    だから、git が使えないときは、自分でフォルダを歩いて全部読みます。
    どちらのやり方で調べたかは、最後に必ず画面へ出します。
*/

/* 歩かないフォルダ（機械が作ったもの・鍵を置く場所そのもの） */
const ARUKANAI_FOLDER = new Set([
  "node_modules",
  ".git",
  ".next",
  ".next-prod",
  ".next-verify",
  "_next-verify-local",
  ".vercel",
  "out",
  "build",
  "coverage",
  ".data",
  "logs",
  "tmp",
  ".tmp",
  /* ★鍵の置き場そのもの。ここは「鍵があって正しい」場所なので、読まない */
  ".secrets",
]);

/* 読まないファイル（鍵を入れてよい場所・機械が作った記録） */
const YOMANAI_FILE = /^\.env|\.(pem|key|p12|pfx|log|db|tsbuildinfo)$/i;

function gitDeAtsumeru() {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "."],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  return out.toString("utf8").split("\0").filter(Boolean);
}

function jibunDeAruku(dir = ROOT, atsumeta = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (ARUKANAI_FOLDER.has(e.name)) continue;
      jibunDeAruku(join(dir, e.name), atsumeta);
    } else if (e.isFile()) {
      if (YOMANAI_FILE.test(e.name)) continue;
      atsumeta.push(relative(ROOT, join(dir, e.name)));
    }
  }
  return atsumeta;
}

/** どちらのやり方で集めたか（最後に画面へ出すため） */
let YARIKATA = "git に入る予定のファイル";

function tsuikaSareruFiles() {
  let list;
  try {
    list = gitDeAtsumeru();
  } catch {
    /* ★ここで素通りさせないこと。自分で歩いて、必ず調べる */
    YARIKATA = "フォルダを直接たどって全部（git が無い場所のため）";
    list = jibunDeAruku();
  }
  return list.filter((p) => !MINAI.test(p));
}

/* ══════════════════════════════════════════════
   調べる
   ══════════════════════════════════════════════ */
const mitsuketa = [];
let mita = 0;

for (const rel of tsuikaSareruFiles()) {
  const abs = join(ROOT, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size > 4 * 1024 * 1024) continue;

  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  mita++;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (MINOGASU.test(line)) continue;
    for (const s of SAGASU) {
      s.re.lastIndex = 0;
      const atatta = line.match(s.re) ?? [];
      /* honmono が無い決まりは、当たったら全部そのまま鍵とみなす */
      const honmono = atatta.filter((h) => (s.honmono ? s.honmono(h) : true));
      if (honmono.length > 0) {
        mitsuketa.push({ rel, gyou: i + 1, name: s.name, naoshikata: s.naoshikata });
      }
    }
  }
}

/* ══════════════════════════════════════════════
   結果
   ══════════════════════════════════════════════ */
if (mitsuketa.length === 0) {
  console.log(
    `  ✓ 鍵の書き残しはありません（${mita}ファイルを確認／調べ方：${YARIKATA}）`,
  );
  process.exit(0);
}

/*
  ★止めたときこそ、「どうやって調べたか」を出すこと。
    合格のときだけ出していると、止まった人が
    「何が調べられていないのか」を確かめられません。
*/
console.error(`
═══════════════════════════════════════════════
  ★止めました：人に見られる場所に、鍵が書かれています
═══════════════════════════════════════════════

  調べ方： ${YARIKATA}（${mita}ファイルを確認）
`);
for (const m of mitsuketa) {
  console.error(`  ${m.rel}:${m.gyou}`);
  console.error(`      種類　： ${m.name}`);
  console.error(`      直し方： ${m.naoshikata}\n`);
}
console.error(`  ★見つけた中身は、わざと表示していません。
　　表示すると、この検査そのものが鍵を広める道具になります。

  ★どうしても「例」として書きたい行には、
　　同じ行に「検査用のダミー」と書いてください。
`);
process.exit(1);
