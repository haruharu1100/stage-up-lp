/**
 * お客様に見える画面に、「デモ」「テスト」の文言が残っていないかを見張る。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この見張りが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-06 まで、本物の売り場でガチャを引いた結果の画面に、
 *
 *       「これはデモです。DEMO DATA（架空のデータ）で動いています。
 *         実際の決済・発送・メール送信は行いません。」
 *
 *   と、必ず出ていました。
 *
 *   営業用の見本だけのつもりで書いた1文でした。
 *   ですが、その部品は本物の売り場からも読まれていました。
 *   つまり、本当にお金を払って引いたお客様にも出ていました。
 *
 *   ★お客様から見ると「自分が払った分は無かったことになる」と読めます。
 *     その場で問い合わせになり、説明できないまま返金の話になります。
 *
 *   自動試験は全部通っていました。見た目もきれいでした。
 *   それでも、この1文だけが商売を壊します。
 *
 * ═══════════════════════════════════════════════════════
 * ★どこを見ているか（ここが肝心です）
 * ═══════════════════════════════════════════════════════
 *
 *   ★「見るファイルの一覧」を手で書かないこと。
 *
 *     今回の漏れは、まさにそれで起きました。
 *     見張りの一覧に Storefront.tsx が入っていなかったのです。
 *     売り場（LiveShop.tsx）は入っていました。
 *     ですが、売り場が読んでいる結果画面は、別のファイルにありました。
 *
 *     ですので、この見張りは
 *
 *         お客様が開けるURL から出発して、
 *         そこから読まれているファイルを、全部たどります。
 *
 *     新しい部品を足しても、お客様の画面から読まれていれば、
 *     自動で見張りの中に入ります。足し忘れが起きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★どうしても出したいときは
 * ═══════════════════════════════════════════════════════
 *
 *   決済が練習用のときの「実際の請求は発生しません」のように、
 *   出すのが正しい場合もあります。
 *
 *   そのときは、その行の前に理由を書いてください。
 *
 *       // 表示OK: 決済が練習用のときだけ出す（本番の鍵があれば出ない）
 *
 *   ★「うるさいから」で付けないこと。
 *     ここに書いた理由が、そのままお店への説明になります。
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* ══════════════════════════════════════════════
   ① お客様が開けるURL（出発点）
   ══════════════════════════════════════════════ */

/**
 * ★ここには「お客様が開ける入口」だけを書きます。
 *   部品の名前は書きません。部品は、ここから機械がたどります。
 *
 * ★/client-demo と /demo と /sales-demo は、入れません。
 *   あちらは営業用の見本です。「デモです」と出るのが正しい画面です。
 */
const IRIGUCHI_DIR = [
  "app/mypage", // マイページ・売り場・ポイント購入
  "app/store", // 会社情報・特商法・規約・プライバシー・FAQ
  "app/login",
  "app/signup",
  "app/verify-email",
  "app/change-password",
  "app/mfa-setup",
];

/* ══════════════════════════════════════════════
   ② 出してはいけない言葉
   ══════════════════════════════════════════════ */

/**
 * 日本語の言葉。
 *
 * ★これらは、部品の名前や変数には、まず使われません。
 *   ですので、どこに出てきても報せます。
 */
const NIHONGO = [
  "デモ",
  "でも用", // 「デモ用」のひらがな書き
  "サンプル",
  "見本",
  "架空",
  "ダミー",
  "モック",
  "テスト",
  "試験用",
  "練習用",
  "開発用",
];

/**
 * ★どちらの意味にも取れる言葉。
 *
 *   「確認用」は、次の2つの意味で使われます。
 *
 *       ① これはデモです、という意味      … 出してはいけない
 *       ② お確かめいただくため、という意味 … 出して当たり前
 *
 *   ②の例
 *       「確認用に入れた新しいパスワードが、一致していません」
 *       「確認用のリンクが正しくありません」（メールアドレスの確認）
 *
 *   また、仕組みの側では「確認用の送り口（Mock）」のように、
 *   機能そのものの名前として使われます。これも出す相手は担当者です。
 *
 * ★そこで、これらは「画面を描くファイル（.tsx）」でだけ報せます。
 *   2026-09-06 の事故は、画面を描くファイルで起きました。
 *   仕組みの側（lib/server/…）は、お客様の画面ではありません。
 *
 * ★上の NIHONGO（デモ・架空・見本 など）は、この扱いにしないこと。
 *   あちらは、どこに出てきても言い訳のきかない言葉です。
 */
const AIMAI = ["確認用", "動作確認", "仮の", "プレビュー"];

/**
 * 英語の言葉。
 *
 * ★こちらは、部品の名前にもよく使われます（testId など）。
 *   そこで「文章の中に出てきたときだけ」報せます。
 *   文章かどうかは、引用符の中に
 *   空白か日本語が入っているかで見分けます。
 */
const EIGO = ["demo", "sample", "dummy", "test data"];

/** 英語のうち、どちらの意味にも取れるもの（画面を描くファイルでだけ報せる） */
const EIGO_AIMAI = ["mock", "preview", "dev only"];

/** 理由を書いて、わざと出しているという印 */
const YURUSU = "表示OK:";

/* ══════════════════════════════════════════════
   ②-2 まるごと見なくてよいファイル
   ══════════════════════════════════════════════ */

/**
 * 「見本の店」そのものを作っているファイル。
 *
 * ★ここに足すのは、次の両方を確かめてからにすること。
 *
 *   ① 本物のお客様の画面には、1文字も出ないこと
 *   ② なぜ出ないのかを、下の「なぜ」に書けること
 *
 * ★画面を描くファイル（.tsx）は、ここに足さないこと。
 *   2026-09-06 の事故は、まさに画面を描くファイルでした。
 *   見本のつもりの1文が、本物の売り場にも出ていました。
 *   画面を描くファイルは、必ず1行ずつ理由を書いてください。
 */
const MARUGOTO = [
  {
    file: "lib/console/state.ts",
    naze:
      "見本の店（/client-demo）の中身そのもの。画面を描かない、ただの入れ物と手順です。" +
      "本物のお客様の画面は lib/console/live*.ts と /api/customer/* から作ります。",
  },
  {
    file: "lib/console/market.ts",
    naze:
      "見本の店で出す、相場の作り話データ。本物の相場は別のところから来ます。",
  },
];

const MARUGOTO_SET = new Map(MARUGOTO.map((m) => [m.file, m.naze]));

/* ══════════════════════════════════════════════
   ③ お客様の画面から読まれているファイルを、全部たどる
   ══════════════════════════════════════════════ */

function subete(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const na of readdirSync(dir)) {
    const p = join(dir, na);
    if (statSync(p).isDirectory()) subete(p, out);
    else if (/\.(tsx|ts)$/.test(na)) out.push(p);
  }
  return out;
}

/** import 先を、実際のファイルの場所に直す */
function sagasu(from, spec) {
  /* 外の部品（react / next など）は、たどりません */
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;

  const base = spec.startsWith("@/")
    ? join(ROOT, spec.slice(2))
    : resolve(dirname(from), spec);

  for (const suf of [".tsx", ".ts", "/index.tsx", "/index.ts", ""]) {
    const p = base + suf;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

const mita = new Set();
const machi = [];

/** どのファイルから読まれて、ここへ来たのか（言い分けのため） */
const oya = new Map();

for (const d of IRIGUCHI_DIR) machi.push(...subete(join(ROOT, d)));

while (machi.length > 0) {
  const p = machi.pop();
  if (mita.has(p)) continue;
  mita.add(p);

  const src = readFileSync(p, "utf8");
  for (const m of src.matchAll(IMPORT)) {
    const saki = sagasu(p, m[1]);
    if (saki !== null && !mita.has(saki)) {
      if (!oya.has(saki)) oya.set(saki, p);
      machi.push(saki);
    }
  }
}

/** 入口から、そのファイルまでの道すじ */
function michi(p) {
  const ato = [];
  let ima = p;
  for (let i = 0; i < 12 && ima !== undefined; i++) {
    ato.unshift(relative(ROOT, ima));
    ima = oya.get(ima);
  }
  return ato.join("\n        → ");
}

/* ══════════════════════════════════════════════
   ④ 中を見る
   ══════════════════════════════════════════════ */

/**
 * 説明書き（コメント）を消す。
 *
 * ★これを先にやること。
 *   「★ここにデモの断り書きを出さないこと」という注意書きを
 *   本文と一緒に読むと、注意書きそのものを違反と数えてしまいます。
 *
 * ★ただし「表示OK:」の印は残します。あとで拾うためです。
 */
function setsumeiWoKesu(src) {
  const gyou = src.split("\n");
  let naka = false; /* /* … *​/ の中か */

  return gyou.map((g) => {
    let out = "";
    let i = 0;
    while (i < g.length) {
      if (naka) {
        const e = g.indexOf("*/", i);
        if (e === -1) return out;
        naka = false;
        i = e + 2;
        continue;
      }
      if (g.startsWith("/*", i)) {
        naka = true;
        i += 2;
        continue;
      }
      if (g.startsWith("//", i)) return out;
      out += g[i];
      i += 1;
    }
    return out;
  });
}

/** 引用符の中身を取り出す（文章かどうかを見るため） */
const MOJIRETSU = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

const mitsuketa = [];
const yurushita = [];

/** まるごと見なくてよいと決めたファイルの、実際に見つかった数 */
const marugotoKazu = new Map();

for (const p of [...mita].sort()) {
  const rel = relative(ROOT, p);

  /* まるごと見なくてよいと、上で決めてあるファイル */
  if (MARUGOTO_SET.has(rel)) {
    marugotoKazu.set(rel, true);
    continue;
  }

  /* 画面を描くファイルか（.tsx）。
     どちらの意味にも取れる言葉は、こちらでだけ報せます */
  const gamen = rel.endsWith(".tsx");

  const nama = readFileSync(p, "utf8").split("\n");
  const honbun = setsumeiWoKesu(readFileSync(p, "utf8"));

  for (let i = 0; i < honbun.length; i++) {
    const gyou = honbun[i];
    if (gyou.trim() === "") continue;

    const atari = [];

    /* 日本語：どこに出てきても報せる */
    for (const w of NIHONGO) {
      if (gyou.includes(w)) atari.push(w);
    }

    /* どちらの意味にも取れる言葉：画面を描くファイルでだけ報せる */
    if (gamen) {
      for (const w of AIMAI) {
        if (gyou.includes(w)) atari.push(w);
      }
    }

    /* 英語：文章の中に出てきたときだけ報せる */
    for (const m of gyou.matchAll(MOJIRETSU)) {
      const naka = m[1] ?? m[2] ?? m[3] ?? "";
      const bunshou = / /.test(naka) || /[ぁ-んァ-ヶ一-龠]/.test(naka);
      if (!bunshou) continue;
      for (const w of EIGO) {
        if (naka.toLowerCase().includes(w)) atari.push(w);
      }
      if (gamen) {
        for (const w of EIGO_AIMAI) {
          if (naka.toLowerCase().includes(w)) atari.push(w);
        }
      }
    }

    if (atari.length === 0) continue;

    /* わざと出しているか（同じ行か、すぐ上の6行以内に理由があるか）
       ★6行にしている訳
         画面の部品は
             {出してよい条件 && (
               <p className="…">
                 …本文…
         のように、条件と本文のあいだに数行はさまります。
         理由は条件のところに書くのが正しいので、そこまで届く幅にしています。
       ★これ以上は広げないこと。
         関係のない別の行まで、いっしょに黙らせてしまいます。 */
    const mawari = nama.slice(Math.max(0, i - 6), i + 1).join("\n");
    const riyuu = mawari.includes(YURUSU);

    const ichi = `${rel}:${i + 1}`;
    const naiyou = nama[i].trim().slice(0, 110);

    if (riyuu) {
      const r = (mawari.split(YURUSU)[1] ?? "").split("\n")[0].trim();
      yurushita.push(`${ichi}  「${[...new Set(atari)].join("・")}」  理由：${r}`);
    } else {
      mitsuketa.push(
        `${ichi}  「${[...new Set(atari)].join("・")}」\n      ${naiyou}` +
          `\n      たどった道すじ：\n        ${michi(p)}`,
      );
    }
  }
}

/* ══════════════════════════════════════════════
   ⑤ 結果
   ══════════════════════════════════════════════ */

/* ★もう読まれていないファイルを、見なくてよい一覧に残さないこと。
     残しておくと「見張っているつもり」の抜け道が増えていきます。 */
const furui = MARUGOTO.filter((m) => !marugotoKazu.has(m.file));
if (furui.length > 0) {
  console.error(
    "\n★止めました：「まるごと見なくてよい」に書いてあるのに、" +
      "お客様の画面からもう読まれていないファイルがあります。\n" +
      "  scripts/check-customer-words.mjs の MARUGOTO から消してください。\n",
  );
  for (const f of furui) console.error(`  ${f.file}`);
  console.error("");
  process.exit(1);
}

if (mitsuketa.length > 0) {
  console.error(
    "\n★止めました：お客様に見える画面に、デモ・テストの文言が残っています。\n" +
      "  お金を払って引いたお客様に「これはデモです」と出ると、\n" +
      "  自分が払った分は無かったことになる、と読まれます。\n" +
      "  出すのが正しい場合は、その行の上に理由を書いてください。\n" +
      `      // ${YURUSU} （なぜ出してよいのか）\n`,
  );
  for (const m of mitsuketa) console.error(`  ${m}`);
  console.error(
    `\n  見たファイル：${mita.size} 本（お客様が開けるURLから、読まれている順にたどりました）\n`,
  );
  process.exit(1);
}

console.log(
  `お客様の画面の文言：デモ・テストの言い残しはありません（${mita.size} ファイル）。`,
);
if (yurushita.length > 0) {
  console.log("  わざと出しているもの：");
  for (const y of yurushita) console.log(`    ${y}`);
}
if (MARUGOTO.length > 0) {
  console.log("  まるごと見ていないファイル（見本の店そのもの）：");
  for (const m of MARUGOTO) console.log(`    ${m.file}\n      理由：${m.naze}`);
}
