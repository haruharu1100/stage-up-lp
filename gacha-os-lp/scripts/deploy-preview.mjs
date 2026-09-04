/**
 * 確認用のサイト（Preview）を公開する。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ専用の手順が要るのか
 * ═══════════════════════════════════════════════
 *
 *   このフォルダで直接
 *
 *       npx vercel deploy --archive=tgz
 *
 *   を実行すると、公開が終わりません。
 *   2026-08-22 と 2026-08-24 の2回、どちらも途中で止まりました。
 *   2回目は50分待って、1バイトも進みませんでした。
 *
 *   原因は2つです。
 *
 *   ① 手元にある確認用のファイルまで送ろうとする
 *      作業フォルダには、確認用のスクリーンショット・録画・
 *      手元で作ったビルドが 400MB 以上あります。
 *      .vercelignore に書いても、「.next」で始まる名前のフォルダは
 *      外れませんでした（Vercelが自分の作業場所として特別扱いするため）。
 *
 *   ② 作業フォルダが外付けドライブにある
 *      送る前に、全部を1つの箱にまとめる作業が入ります。
 *      外付けドライブでこれをやると、極端に遅くなります。
 *      画面には「0.0B」と出たまま何十分も動きません。
 *      壊れたのか待てばいいのか、見ただけでは分かりません。
 *
 * ═══════════════════════════════════════════════
 * ★この手順がやっていること
 * ═══════════════════════════════════════════════
 *
 *   gitに登録済みのファイルだけを、本体ドライブの作業場所へ書き出して、
 *   そこから公開します。
 *
 *   ・確認用のファイルは、そもそもgitに入っていないので付いてきません。
 *   ・本体ドライブなので、まとめる作業が速く終わります。
 *   ・送る量は 292MB → 54.6MB になり、数分で終わります。
 *
 *   ★「gitに入っていないファイルは公開されない」ことに注意。
 *     直したばかりの内容を公開したいときは、先にcommitしてください。
 *     未commitのまま実行すると、前の内容が公開されます。
 *     この手順は、未commitの変更があれば止まって知らせます。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *     npm run deploy:preview   … 確認用（本番のURLは変わりません）
 *     npm run deploy:prod      … 本番（os.morika.work が新しくなります）
 *
 *   最後に、公開されたURLが出ます。
 *
 * ═══════════════════════════════════════════════
 * ★本番（--prod）について
 * ═══════════════════════════════════════════════
 *
 *   本番は os.morika.work / gacha-os.gorogorogacha.com として
 *   お客様・広告の出稿先に見えている場所です。
 *   ここへ出すと、その瞬間から誰でも新しい内容を見ます。
 *
 *   ★本番へ出す前に、必ず npm run verify を通すこと。
 *     verify は「型・テスト・公開前チェック・ビルド」をまとめて確かめます。
 *     これを飛ばすと、壊れたものが広告の着地先に出ます。
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 本番へ出すのかどうか。
 *
 * ★既定は「本番ではない」こと。
 *   うっかり実行しても、本番のURLは変わらない側に倒しておきます。
 */
const HONBAN = process.argv.includes("--prod");

/** gitから見たときの、このフォルダの名前（リポジトリの入れ子の中にある） */
const SUBDIR = "gacha-os-lp";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...opts });

/**
 * リポジトリのいちばん上のフォルダ。
 *
 * ★書き出しは、必ずここから実行すること。
 *
 *   git は「HEAD:名前」の"名前"を、いま居るフォルダから数えます。
 *   このフォルダ（gacha-os-lp）の中で
 *
 *       git archive HEAD:gacha-os-lp
 *
 *   と打つと、gacha-os-lp の中の gacha-os-lp を探しにいきます。
 *   そんなものは無いので、中身ゼロの箱ができます。
 *   しかも git は、これを失敗として扱いません（2026-08-24 実測）。
 *
 *   その結果、空っぽのまま公開まで進み、Vercel 側で
 *   「app フォルダが見つからない」と言われて失敗しました。
 *   何も入っていない箱を送っていた、と分かるまで時間がかかりました。
 */
const GIT_TOP = run("git", ["rev-parse", "--show-toplevel"], { cwd: ROOT }).trim();

/* ── ① 未commitの変更が無いか確かめる ──
   ここを飛ばすと、直した内容が公開されないまま
   「公開しました」と言うことになります。 */
const dirty = run("git", ["status", "--porcelain", "--", ROOT], { cwd: ROOT }).trim();
if (dirty) {
  console.error("\n✗ まだcommitしていない変更があります。");
  console.error("  この手順は、gitに入っている内容だけを公開します。");
  console.error("  このまま進めると、直した内容は公開されません。\n");
  for (const line of dirty.split("\n").slice(0, 20)) console.error(`  ${line}`);
  console.error("\n  先にcommitしてから、もう一度実行してください。\n");
  process.exit(1);
}

/* ── ② 本体ドライブへ、gitの中身だけを書き出す ── */
const WORK = join(tmpdir(), "gacha-os-lp-deploy");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

console.log(`\n  公開用の写しを作っています： ${WORK}`);
run("bash", [
  "-c",
  /* set -o pipefail ＝ 前half（git）が失敗したら、全体を失敗にする。
     これが無いと、tar が「空っぽを受け取って正常終了」したことになり、
     git の失敗が握りつぶされます。 */
  `set -o pipefail; git archive HEAD:${SUBDIR} | tar -x -C ${JSON.stringify(WORK)}`,
], { cwd: GIT_TOP });

/* ── ②-2 中身が入っているか、送る前に確かめる ──
   ★この確認を消さないこと。
     空っぽのまま送ると、Vercel 側のビルドで初めて失敗が分かります。
     そこまで数分かかるうえ、出るのは
     「app フォルダが見つからない」という、原因から遠い言葉です。
     ここで止めれば、理由がその場で分かります。 */
if (!existsSync(join(WORK, "app")) || !existsSync(join(WORK, "package.json"))) {
  console.error("\n✗ 公開用の写しが空でした。中身を書き出せていません。");
  console.error(`  写しの場所： ${WORK}`);
  console.error(`  リポジトリの上： ${GIT_TOP}`);
  console.error(`  取り出そうとした場所： HEAD:${SUBDIR}\n`);
  process.exit(1);
}

/* 公開先の情報。gitには入れていないので、手で持っていく */
const LINK = join(ROOT, ".vercel");
if (!existsSync(LINK)) {
  console.error("\n✗ .vercel が見つかりません。公開先が分かりません。");
  console.error("  一度 npx vercel link を実行してから、もう一度お試しください。\n");
  process.exit(1);
}
cpSync(LINK, join(WORK, ".vercel"), { recursive: true });

/* ── ③ 公開する ── */
console.log(
  HONBAN
    ? "  ★本番へ公開しています（os.morika.work が新しくなります）。数分かかります。\n"
    : "  確認用として公開しています。数分かかります。\n",
);
run("npx", ["vercel", "deploy", "--archive=tgz", "--yes", ...(HONBAN ? ["--prod"] : [])], {
  cwd: WORK,
  stdio: "inherit",
});

console.log("\n  ★公開しただけでは、直ったことになりません。");
console.log("    出てきたURLに向けて、次の2つを走らせてください。\n");
console.log("      npm run check:ux -- <URL>");
console.log("      npm run check:flash -- <URL>\n");
