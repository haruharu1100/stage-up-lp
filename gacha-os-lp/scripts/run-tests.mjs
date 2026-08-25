/**
 * 試験を、1ファイルにつき1プロセスで走らせる。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、わざわざ分けるのか
 * ═══════════════════════════════════════════════
 *
 *   もとは、こう1行で走らせていました。
 *
 *       tsx --test tests/*.test.ts
 *
 *   これだと、20回に2回くらい、こういう出方をしました。
 *
 *       ・中の試験は、445本ぜんぶ「ok」
 *       ・なのに、まとめの1行だけ「失敗（SIGSEGV）」
 *
 *   原因は、試験の中身ではありません。
 *   DBの部品（機械語で書かれた部分）の後片付けの不具合です。
 *   使い終わったあと、掃除係が後始末を呼びに行ったところで、
 *   すでに無いものを触って落ちます。
 *
 *   実機の記録で、落ちている場所は確認済みです。
 *
 *       napi の Finalize → index.node（DBの部品）
 *
 *   ★この壊れ方が、いちばん厄介です。
 *     赤くなるのに、直すところが無い。
 *     何度か見ると、人は赤を無視するようになります。
 *     そうなった試験は、もう何も守りません。
 *
 *   同じ理由で、もう1つの壊れ方もあります。
 *
 *       ・全部「ok」なのに、そのまま終わらない（何分待っても戻らない）
 *
 *   落ち方が違うだけで、原因は同じ「後片付け」です。
 *
 * ═══════════════════════════════════════════════
 * ★どう直したか
 * ═══════════════════════════════════════════════
 *
 *   2つとも、起きる場所は同じでした。
 *   「全部の合否を言い終えたあと」です。
 *
 *   試験の結果は、最後にこういう行で締めくくられます。
 *
 *       # tests 25
 *       # pass  25
 *       # fail  0
 *
 *   この3行が出た時点で、合否はもう全部わかっています。
 *   ですので、この3行を見届けたら、後片付けの結果は見ません。
 *
 *     ① 1ファイルにつき1プロセスで走らせる
 *     ② 締めくくりの3行が出るまで、ちゃんと待つ
 *     ③ 3行がそろっていれば、そのあとプロセスがどう終わっても
 *        （落ちても、終わらなくても）、合否はその3行で決める
 *
 *   ★「--test」を付けないのが要点です。
 *
 *     付けると、Node は試験ファイルをさらに別のプロセスで走らせ、
 *     その孫プロセスの終わり方を「1本の試験の合否」として数えます。
 *     すると、後片付けで落ちただけなのに
 *
 *         not ok 1 - tests/serverDraw.test.ts   signal: 'SIGSEGV'
 *
 *     という、中身の無い「不合格」が1本増えます（実測）。
 *     こちらから直接走らせれば、落ちるのは自分の子プロセスなので、
 *     締めくくりを先に受け取ってから判断できます。
 *
 * ═══════════════════════════════════════════════
 * ★ごまかしていないこと
 * ═══════════════════════════════════════════════
 *
 *   ★締めくくりの3行が出るより前に、こちらから終わらせることは
 *     絶対にありません。ここを崩すと、走らなかった試験が
 *     「無かったこと」になります。
 *
 *   ・3行が1つでも出なければ、それは失敗として扱います。
 *   ・「# tests」と「# pass ＋ # fail」が合わなければ、失敗にします。
 *     （途中で切れた結果を、通ったことにしないための歯止め）
 *   ・「# cancelled」が0でなければ、失敗にします。
 *   ・1本でも落ちたら、ここは 1 で終わります。
 *   ・落ちた回の中身は、そのまま画面に出します。
 *
 *   ★走らせ直しについて（隠さずに書きます）
 *
 *     ときどき、全部の合否を言い終える「前」に落ちる回があります
 *     （実測で、1ファイルあたり10回に1回ほど）。
 *     このときだけ、そのファイルを**最初から**走らせ直します（最大2回）。
 *     画面には「※合否が出ず ◯回走らせ直しました」と必ず出します。
 *
 *     ★走らせ直すのは「合否が取れなかったとき」だけです。
 *       「落ちた試験があったとき」は走らせ直しません。
 *       そこを緩めた瞬間、たまたま通るまで回す仕組みになります。
 *
 *   つまり「後片付けで落ちたのを見逃す」ことはしますが、
 *   「走らなかった試験を通ったことにする」ことはしません。
 *   本数が1本でも合わなければ止まります。
 *
 *   ★試したが、採用しなかったもの
 *
 *     ・--test-force-exit を足す
 *         → 445本のはずが 417本しか走らないまま「成功」と出ました。
 *           28本が黙って消えます。いちばんやってはいけない直し方です。
 *           締めくくりを待たずに断ち切ると、こうなります。
 *
 *     ・接続を閉じずに持ち続ける（これ単体では不採用）
 *         → 落ちる代わりに、終わらなくなりました。
 *           ★ただし、こちらで終わらせる仕組みと組にすると効きます。
 *             いまは、この組み合わせを採用しています
 *             （lib/server/db.ts の resetDbForTests は、
 *               DATABASE_ENV=test のときだけ閉じません）。
 *             20回連続で走らせて、落ちる回・終わらない回は0でした。
 *
 *     ・試験側で process.exit して終わりを早める
 *         → 締めくくりの3行ごと消えました。
 *           何本走ったのか分からない結果になるので、外しました。
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TESTS = join(ROOT, "tests");

const files = readdirSync(TESTS)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

if (files.length === 0) {
  console.error("\n✗ 試験のファイルが1つも見つかりませんでした。\n");
  process.exit(1);
}

/* 同時に走らせる数。増やしすぎると、遅い機械で取り合いになります */
const LANES = Math.max(2, Math.min(files.length, cpus().length));

/* 1ファイルに、これ以上かけない時間。
   ここに達したら、締めくくりが出ていなくても失敗にします。
   （黙って何時間も止まったままになるのを防ぐため） */
const HARD_LIMIT_MS = 5 * 60 * 1000;

/* 締めくくりの3行が出たあと、自分から終わるのを待つ時間。
   ここを過ぎても終わらないものだけ、こちらで終わらせます。 */
const GRACE_MS = 1500;

/** 1ファイルを走らせる */
function runOne(file) {
  return new Promise((resolve) => {
    /* ★「--test」を付けないこと。
         付けると孫プロセスが増え、その終わり方が
         「1本の不合格」として数に混ざります（上の説明のとおり）。 */
    const child = spawn(
      "npx",
      ["tsx", join("tests", file)],
      { cwd: ROOT, env: process.env },
    );

    let out = "";
    let done = false;
    let graceTimer = null;
    let note = "";

    /** 締めくくりの行を読む。まだ出ていなければ null */
    const num = (name) => {
      const m = out.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
      return m ? Number(m[1]) : null;
    };

    /** 締めくくりがそろっているか */
    const summaryReady = () =>
      num("tests") !== null &&
      num("pass") !== null &&
      num("fail") !== null &&
      num("cancelled") !== null;

    const hardTimer = setTimeout(() => {
      if (done) return;
      note += "（時間内に合否の締めくくりが出ませんでした）\n";
      child.kill("SIGKILL");
    }, HARD_LIMIT_MS);

    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);

      const tests = num("tests");
      const pass = num("pass");
      const fail = num("fail");
      const cancelled = num("cancelled");

      /* ★締めくくりが出ていなければ、通ったことにはしません。
           途中で切れた結果を「成功」と読み替えないための歯止めです。 */
      const hasSummary =
        tests !== null && pass !== null && fail !== null && cancelled !== null;

      let ok;
      if (!hasSummary) {
        ok = false;
        note += "（合否の締めくくり（# tests / # pass / # fail）が出ていません）\n";
      } else if (tests !== pass + fail) {
        /* ★本数が合わなければ失敗。走らなかった試験を見逃さないため。 */
        ok = false;
        note += `（本数が合いません： # tests ${tests} ／ # pass ${pass} ＋ # fail ${fail}）\n`;
      } else if (cancelled > 0) {
        ok = false;
        note += `（途中で打ち切られた試験が ${cancelled} 本あります）\n`;
      } else {
        /* ★ここが要点。
             合否は「# pass / # fail」で全部そろっています。
             このあとプロセスがどう終わったか（落ちた・終われない）は、
             DBの部品の後片付けの話で、試験の合否ではありません。
             ★ただし、上の本数の確認を通ったときだけです。 */
        ok = fail === 0;
        if (ok && (signal || code !== 0)) {
          note += `（合否が出そろったあと、後片付けで異常終了しました：${signal ?? `code ${code}`}。合否には影響しません）\n`;
        }
      }

      resolve({
        file,
        out: out + (note ? `\n${note}` : ""),
        /* 締めくくりが出そろったあとの異常終了は、
           一覧に「異常終了」と出しません（合否は確定済みのため） */
        signal: ok ? null : signal,
        ok,
        /* 「合否そのものが取れなかった」のか、
           「合否は取れたが、落ちた試験があった」のかを分けます。
           前者だけ、走らせ直します。 */
        noSummary: !hasSummary,
        pass: pass ?? 0,
        fail: fail ?? 0,
      });
    };

    const onChunk = (d) => {
      out += d;
      /* ★締めくくりが出るより前に、こちらから終わらせることは絶対にしません。 */
      if (graceTimer || !summaryReady()) return;
      graceTimer = setTimeout(() => {
        note += "（合否が出そろったあと、自分から終われなかったので終了させました。合否には影響しません）\n";
        child.kill("SIGKILL");
      }, GRACE_MS);
    };

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);

    child.on("close", (code, signal) => finish(code, signal));
    child.on("error", (e) => {
      note += `（試験を起動できませんでした：${e.message}）\n`;
      finish(1, null);
    });
  });
}

/* 合否そのものが取れなかったときに、走らせ直す回数。
   ★「落ちた試験があった」ときには、走らせ直しません。
     そこを直すと、たまたま通るまで回す仕組みになります。 */
const RETRY_ON_NO_SUMMARY = 2;

const results = [];
let next = 0;

async function lane() {
  while (next < files.length) {
    const file = files[next++];

    let r = await runOne(file);
    let retried = 0;
    /* 後片付けの異常終了で、合否を言い終える前に消えることがあります。
       そのときだけ、最初から走らせ直します（途中から、ではありません）。 */
    while (r.noSummary && retried < RETRY_ON_NO_SUMMARY) {
      retried += 1;
      r = await runOne(file);
    }

    results.push(r);
    console.log(
      `  ${r.ok ? "✓" : "✗"} ${file}  （${r.pass}本）` +
        (retried ? `  ※合否が出ず ${retried} 回走らせ直しました` : "") +
        (r.signal ? `  異常終了: ${r.signal}` : ""),
    );
  }
}

console.log(`\n  試験ファイル ${files.length} 件を、${LANES} 本ずつ並べて走らせます。\n`);
const t0 = Date.now();

await Promise.all(Array.from({ length: LANES }, lane));

const pass = results.reduce((a, r) => a + r.pass, 0);
const fail = results.reduce((a, r) => a + r.fail, 0);
const broken = results.filter((r) => !r.ok);

console.log(`\n  合計 ${pass} 本 ok ／ ${fail} 本 だめ`);
console.log(`  かかった時間： ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);

if (broken.length > 0) {
  console.error(`\n✗ ${broken.length} 件のファイルが通っていません。\n`);
  for (const r of broken) {
    console.error(`── ${r.file} ${"─".repeat(Math.max(0, 50 - r.file.length))}`);
    console.error(r.out.trimEnd());
    console.error("");
  }
  process.exit(1);
}

console.log("\n✓ すべて通りました。\n");
