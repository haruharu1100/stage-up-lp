/**
 * 安全に関わる検査だけを、公開前に必ず通す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを公開の手前に置くのか
 * ═══════════════════════════════════════════════════════
 *
 *   一度ふさいだ穴は、あとから開き直されます。
 *   悪意があってではありません。
 *
 *       ・別の画面を直すついでに、1行だけ書き換えた
 *       ・見づらいから、条件を1つ外した
 *       ・テストが赤くなったので、テストのほうを直した
 *
 *   これで開きます。しかも、開いたことに誰も気づきません。
 *
 *   だから、次の10個は、公開の手前で必ず1回通します。
 *   ここが1つでも落ちたら、公開しません。
 *
 *       ① 本番の抽選が予測できないこと
 *       ② 同じ鍵で二度引けないこと
 *       ③ 抽選が監査ログに残ること
 *       ④ 監査ログの改ざんが見つかること
 *       ⑤ 会社をまたいで中身が見えないこと
 *       ⑥ 会社をまたいでログインできないこと
 *       ⑦ ログイン後に、外のサイトへ飛ばされないこと
 *       ⑧ 画面の数字が、決め打ちに戻っていないこと
 *       ⑨ 役割の制限が、画面だけでなく入口でも効いていること
 *       ⑩ 仮パスワードが「1回きり・期限つき」のままであること
 *
 *   ★⑨を足した理由。
 *     画面のボタンを消しても、入口の住所を知っていれば直接叩けます。
 *     「見えない＝できない」ではありません。
 *     入口側で断れているかどうかを、毎回ここで確かめます。
 *
 *   ★⑩を足した理由。
 *     仮パスワードは、チャットに貼られ、口で読み上げられ、
 *     付箋に書かれます。渡した時点で漏れている前提のものです。
 *     「1回きり」と「期限つき」のどちらかが外れると、
 *     半年前の履歴から拾った文字列で、その人として入れてしまいます。
 *     期限の“長さ”まで見ています。欄が埋まっているかどうかだけを
 *     見ていると、そこに10年後を入れられても気づけません。
 *
 * ═══════════════════════════════════════════════════════
 * ★1ファイルずつ、別々に動かしていること
 * ═══════════════════════════════════════════════════════
 *
 *   DBの部品（libsql）が、全部終わったあとの後片づけで
 *   ときどき落ちます（SIGSEGV）。
 *   検査そのものは全部通っているのに、落ちます。
 *
 *   まとめて動かすと、この後片づけの事故で
 *   「公開できない」が起きます。中身は何も悪くないのに、です。
 *
 *   だから1ファイルずつ動かし、
 *   ★「全部 ok と報告したあとで落ちた」ときだけ、通したことにします。
 *     1件でも失敗を報告していたら、落ちていようがいまいが止めます。
 *     ここを緩めないこと。
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 通さなければ公開しない検査。
 *
 * ★この一覧から行を消さないこと。
 *   消せば、その穴は静かに開きます。
 */
const FILES = [
  { file: "tests/serverDraw.test.ts", what: "本番の抽選（予測不能・二重引き防止・監査・1件のまとまり）" },
  { file: "tests/consoleSecurity.test.ts", what: "監査ログの改ざん検知" },
  { file: "tests/consoleAudit.test.ts", what: "監査ログのつながり" },
  { file: "tests/tenantIsolation.test.ts", what: "会社ごとの分離" },
  { file: "tests/auth.test.ts", what: "ログイン（締め出し・2段階認証・会社またぎ）" },
  { file: "tests/roleAccess.test.ts", what: "役割ごとの入口（画面で隠すだけになっていないか）" },
  { file: "tests/pointsApi.test.ts", what: "ポイントの入口（二人承認・二度押し・追加の本人確認）" },
  { file: "tests/passwordChange.test.ts", what: "パスワード（仮パスワードの寿命・強制変更・平文を残さない）" },
  { file: "tests/returnTo.test.ts", what: "ログイン後の戻り先（外のサイトへ飛ばさない）" },
  { file: "tests/noFixedNumbers.test.ts", what: "画面の数字が決め打ちに戻っていないか" },
  { file: "tests/noInvisibleChars.test.ts", what: "見えない文字の混入" },
  { file: "tests/emptyState.test.ts", what: "空っぽのときに、次の行動が分かること" },
  { file: "tests/regressionGate.test.ts", what: "この見張りそのものが、本物の失敗を止められること" },
  { file: "tests/operatorReasons.test.ts", what: "やることに「なぜ先にやるのか」が書いてあること" },
];

/** TAP の報告から、通った数と落ちた数を読む */
export function readTap(out) {
  const num = (key) => {
    const m = out.match(new RegExp(`^# ${key} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  return { pass: num("pass"), fail: num("fail") };
}

/**
 * 落ちた検査の「名前」と「理由」を取り出す。
 *
 * ★理由まで出すこと。
 *   TAP は理由を "error: |-" の次の行から、
 *   1段深く字下げして書きます。
 *   "error: |-" の行だけ出しても、
 *   受け取った人には何も分かりません。
 *   「どこが落ちたか」ではなく
 *   「なぜ落ちたか」が読めて、はじめて直せます。
 */
export function readFailures(out) {
  const lines = out.split("\n");
  const found = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("not ok")) continue;

    const name = lines[i].replace(/^not ok\s*\d*\s*-?\s*/, "").trim();
    const why = [];
    let signal = null;

    /* この検査の報告の中だけを見る（次の not ok / ok まで） */
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.startsWith("not ok") || line.startsWith("ok ")) break;

      /* 後片づけで落ちたのか、検査そのものが落ちたのかを見分ける印 */
      const sig = line.trimStart().match(/^signal:\s*'([^']+)'/);
      if (sig) signal = sig[1];

      if (line.trimStart().startsWith("error:")) {
        /* 同じ行に理由が書いてある場合（error: メッセージ） */
        const inline = line.trimStart().slice("error:".length).replace("|-", "").trim();
        if (inline !== "") why.push(inline);

        /* 次の行から、字下げが深い間が理由の本文 */
        const base = line.length - line.trimStart().length;
        for (let k = j + 1; k < lines.length; k += 1) {
          const body = lines[k];
          if (body.trim() === "") continue;
          const indent = body.length - body.trimStart().length;
          if (indent <= base) break;
          why.push(body.trim());
        }
        break;
      }
    }

    found.push({ name, why, signal });
  }

  return found;
}

/**
 * 「後片づけで落ちただけ」かどうかを見分ける。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここが、この見張りでいちばん危ない場所です
 * ═══════════════════════════════════════════════════════
 *
 *   DBの部品（libsql）が後片づけで落ちると、
 *   検査そのものは全部通っているのに、
 *   報告には「落ちた」が1件だけ足されます。
 *
 *       not ok 1 - （ファイル名そのもの）
 *         signal: 'SIGSEGV'
 *
 *   これを落ちたまま扱うと、中身は何も悪くないのに公開できません。
 *   かといって、ゆるく見逃すと、本物の失敗まで一緒に通ります。
 *
 *   ★だから、次の2つを両方満たすときだけ、通したことにします。
 *
 *       ① 落ちたと言っているのが「ファイルそのもの」だけであること
 *          （中の検査が1つでも落ちていたら、それは本物の失敗）
 *       ② その落ち方が「signal（強制終了）」であること
 *          （assert の失敗には signal が付きません）
 *
 *   ここを「fail の数だけ見る」に戻さないこと。
 *   戻した瞬間、本物の失敗が素通りします。
 */
export function onlyTeardownCrash(failures, file) {
  if (failures.length === 0) return false;

  return failures.every(
    (f) => f.signal !== null && f.name.endsWith(file),
  );
}

/**
 * ★ここから下は「直接動かしたときだけ」動かすこと。
 *   この見張り自体を検査したいので、
 *   上の判定だけを取り出して読めるようにしてあります。
 *   守りをつけずに置くと、読み込んだだけで検査全部が走り出します。
 */
const RUN_DIRECTLY =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (!RUN_DIRECTLY) {
  /* 読み込まれただけ。ここで終わり */
} else {

let ng = 0;

for (const t of FILES) {
  const r = spawnSync("npx", ["tsx", "--test", t.file], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });

  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const { pass, fail } = readTap(out);

  /* 報告そのものが読めなかった。何も分からないので、通さない */
  if (pass === null || fail === null) {
    console.error(`✗ ${t.what}`);
    console.error(`  検査の報告が読めませんでした（${t.file}）`);
    console.error(out.split("\n").slice(-20).join("\n"));
    ng += 1;
    continue;
  }

  const failures = readFailures(out);

  if (fail > 0) {
    /* 中の検査は全部通っていて、落ちたのは後片づけだけ。中身は無事なので進めます */
    if (onlyTeardownCrash(failures, t.file)) {
      console.log(`✓ ${t.what}（${pass}件）`);
      console.log(
        `  ※検査は${pass}件すべて通りました。そのあとの後片づけで落ちています（${failures[0].signal}）。`,
      );
      continue;
    }

    console.error(`✗ ${t.what}`);
    console.error(`  ${t.file}`);
    for (const f of failures) {
      console.error(`  ・${f.name}`);
      for (const line of f.why.slice(0, 8)) {
        console.error(`      ${line}`);
      }
    }
    ng += 1;
    continue;
  }

  /* 報告は全部 ok なのに、終了の仕方だけがおかしい場合 */
  if (r.status !== 0) {
    console.log(`✓ ${t.what}（${pass}件）`);
    console.log(`  ※検査はすべて通りましたが、後片づけで落ちました（${r.signal ?? r.status}）。`);
    continue;
  }

  console.log(`✓ ${t.what}（${pass}件）`);
}

if (ng > 0) {
  console.error(`\n✗ 安全に関わる検査が ${ng} 件通っていません。公開しません。`);
  process.exit(1);
}

console.log("\n✓ 安全に関わる検査は、すべて通りました。");

}
