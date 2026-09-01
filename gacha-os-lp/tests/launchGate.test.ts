/**
 * 公開ブロッカーの線引きを、機械で固定する。
 *
 * ═══════════════════════════════════════════════════════
 * ★このテストが守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   公開前チェックには、性質のちがう2種類が混ざります。
 *
 *     ① 空のまま公開すると、訪問した人に不利益が出るもの
 *     ② 空のまま公開しても、困るのはこちらだけのもの
 *
 *   ①は止めます。②は止めません。
 *
 *   ①の代表が「問い合わせの通知先」です。
 *   空のまま公開すると、送信ボタンを押した人は
 *   「送れた」と思ったまま放置されます。
 *   その人にとっては、無視した会社です。
 *   あとから直しても、その人は戻ってきません。
 *
 *   ②の代表が GA4 です。
 *   空でも訪問者の画面は何も変わりません。
 *   あとからIDを入れれば、その日から計測が始まります。
 *   失うのは「入れるまでの期間の数字」だけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜテストで固定するのか
 * ═══════════════════════════════════════════════════════
 *
 *   この線引きは、両方向に壊れます。
 *
 *   ・緩む方向：「公開を急ぎたい」という理由で、
 *     問い合わせ通知先まで blocksLaunch:false にされる。
 *     壊れても画面は普通に動くので、誰も気づきません。
 *     気づくのは、問い合わせが1件も来ないまま数か月経った日です。
 *
 *   ・締まる方向：GA4 が再び公開ブロッカーに戻される。
 *     すると公開したい人は、架空のIDを入れて黙らせます。
 *     その瞬間から、この仕組みは本当に止めたい1つ目も
 *     止められなくなります。
 *
 *   どちらも、人の注意力では防げません。だから機械で止めます。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildChecklist, hardFailures, nonBlockingTodos } from "../lib/readiness";

const ROOT = join(__dirname, "..");

/** 本番として公開できる最低限（計測は入れない） */
const SAFE_MINIMUM = {
  CONTACT_WEBHOOK_URL: "https://example.com/hook",
  NEXT_PUBLIC_SITE_URL: "https://os.kikusora.com",
  NEXT_PUBLIC_OPERATOR_NAME: "テスト事業者",
  NEXT_PUBLIC_OPERATOR_CONTACT: "privacy@example.test",
};

/**
 * ★process.env はいじりません。
 *   buildChecklist は環境変数を引数で受け取る作りなので、
 *   その場で作った入れ物を渡すだけで済みます。
 *   本物の環境変数を書き換えないので、
 *   テストを並べて動かしても、互いに干渉しません。
 */
function envOf(over: Record<string, string | undefined>): NodeJS.ProcessEnv {
  /* 公開しようとしている場面を再現したいので、本番として判定させます */
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const [k, v] of Object.entries(over)) if (v !== undefined) env[k] = v;
  return env;
}

const stoppers = (over: Record<string, string | undefined>) =>
  hardFailures(buildChecklist(envOf(over))).map((i) => i.key);

/* ================= 止めないもの ================= */

test("計測（GA4・Clarity）が空でも、公開は止めない", () => {
  const keys = stoppers(SAFE_MINIMUM);
  assert.equal(
    keys.includes("ga4"),
    false,
    "GA4未設定で公開が止まっています。止めると、架空のIDを入れて黙らせる人が出ます",
  );
  assert.equal(keys.includes("clarity"), false, "Clarity未設定で公開が止まっています");
});

/**
 * ★環境変数で決まる項目のうち、止まってよいのは「空のとき」だけです。
 *   必要な値がそろっていれば、環境変数由来の停止は1つも残りません。
 */
test("必須3項目がそろえば、環境変数が理由で止まるものは無くなる", () => {
  const keys = stoppers(SAFE_MINIMUM);
  for (const k of ["contact", "domain", "legal_privacy", "ga4", "clarity"])
    assert.equal(
      keys.includes(k),
      false,
      `${k} が、値はそろっているのに公開を止めています`,
    );
});

/**
 * ═══════════════════════════════════════════════════════
 * ★ここは「機械では埋められない停止」を、あえて残す場所です。
 * ═══════════════════════════════════════════════════════
 *
 *   利用規約と特商法表記は、環境変数を入れれば消えるものではありません。
 *   ページ自体がまだ無いので、常に止まります。
 *
 *   これは今回の分離で増えたものではなく、前からこうなっています。
 *
 *   ★なぜ、じゃまだからと外さないのか。
 *
 *     いまのLPは、ご相談を受け取るだけです。
 *     サイト上で申し込みも決済もしません。
 *     その形である限り、特商法の「通信販売の広告」には当たらない、
 *     というのが今の整理です。
 *
 *     しかし、LPに「申し込む」「購入する」を足した日に、
 *     この整理は静かに崩れます。
 *     足す人は、機能を足したつもりでいて、
 *     表示義務が増えたことには気づきません。
 *
 *     だから、消さずに残しておきます。
 *     残っていれば、その日に目に入ります。
 *
 *   ★このテストは「まだ作っていない」という事実を固定しているだけです。
 *     作ったら、このテストは落ちます。落ちたら、期待値を書き換えてください。
 *     それは正しい落ち方です。
 */
test("機械では埋められない停止（利用規約・特商法）は、勝手に消えていない", () => {
  const keys = stoppers(SAFE_MINIMUM);
  assert.deepEqual(
    keys.sort(),
    ["legal_terms", "legal_tokushoho"],
    "環境変数がそろった状態で残る停止が、想定と違います。" +
      "増えていれば新しい停止が入ったということ、" +
      "減っていれば利用規約・特商法の停止が外されたということです",
  );
});

/**
 * ★「止めない」と「やらなくてよい」は、別のことです。
 *   一覧から消えると、そのまま忘れます。
 */
test("止めないだけで、やることの一覧からは消えない", () => {
  const todo = nonBlockingTodos(buildChecklist(envOf(SAFE_MINIMUM))).map(
    (i) => i.key,
  );
  assert.ok(todo.includes("ga4"), "GA4がやることの一覧から消えています");
  assert.ok(todo.includes("clarity"), "Clarityがやることの一覧から消えています");
});

/* ================= 必ず止めるもの ================= */

test("★問い合わせの通知先が空なら、必ず公開を止める", () => {
  const keys = stoppers({ ...SAFE_MINIMUM, CONTACT_WEBHOOK_URL: undefined });
  assert.ok(
    keys.includes("contact"),
    "問い合わせの通知先が空なのに公開できてしまいます。" +
      "この状態で公開すると、送信した人は「送れた」と思ったまま放置されます",
  );
});

test("★事業者名・個人情報の窓口が空なら、必ず公開を止める", () => {
  for (const k of ["NEXT_PUBLIC_OPERATOR_NAME", "NEXT_PUBLIC_OPERATOR_CONTACT"]) {
    const keys = stoppers({ ...SAFE_MINIMUM, [k]: undefined });
    assert.ok(
      keys.includes("legal_privacy"),
      `${k} が空なのに公開できてしまいます。氏名とメールを預かる以上、誰が預かるのかの明示が要ります`,
    );
  }
});

test("★本番ドメインが空なら、必ず公開を止める", () => {
  const keys = stoppers({ ...SAFE_MINIMUM, NEXT_PUBLIC_SITE_URL: undefined });
  assert.ok(keys.includes("domain"), "本番ドメインが空なのに公開できてしまいます");
});

/**
 * ★ここがいちばん外しやすいところです。
 *   「とりあえず動いているURL」を入れると、値は埋まります。
 *   埋まった時点でチェックは黙りますが、
 *   営業メールに載るURLも、検索エンジンに伝えるURLも、
 *   共有カードのURLも、全部その仮のURLになります。
 */
test("★お試し公開のURLを本番ドメインとして使わせない", () => {
  for (const ng of [
    "https://gacha-os-lp.vercel.app",
    "https://preview.kikusora.com",
    "https://staging.kikusora.com",
    "http://localhost:3210",
    "http://127.0.0.1:3210",
  ]) {
    const keys = stoppers({ ...SAFE_MINIMUM, NEXT_PUBLIC_SITE_URL: ng });
    assert.ok(
      keys.includes("domain"),
      `${ng} が本番ドメインとして通ってしまいます`,
    );
  }
});

test("正式ドメイン os.kikusora.com は本番URLとして通る", () => {
  assert.equal(
    stoppers({ ...SAFE_MINIMUM, NEXT_PUBLIC_SITE_URL: "https://os.kikusora.com" })
      .includes("domain"),
    false,
  );
});

/* ================= 定義のずれ ================= */

/**
 * ★lib/readiness.ts と scripts/check-launch.mjs は別ファイルです。
 *   ビルド前チェックに TypeScript を持ち込まないため、
 *   check-launch.mjs 側に定義を写しています。
 *   写しである以上、片方だけ直されます。
 */
test("公開を止める項目が、判定とビルド前チェックで食い違っていない", () => {
  const mjs = readFileSync(join(ROOT, "scripts", "check-launch.mjs"), "utf8");

  /* 止めるものは REQUIRED_ENV 側に、止めないものは MEASUREMENT_ENV 側にあること */
  const required = mjs.slice(
    mjs.indexOf("const REQUIRED_ENV"),
    mjs.indexOf("const MEASUREMENT_ENV"),
  );
  const measurement = mjs.slice(mjs.indexOf("const MEASUREMENT_ENV"));

  for (const code of [
    "CONTACT_DESTINATION_MISSING",
    "SITE_URL_MISSING",
    "OPERATOR_INFO_MISSING",
  ])
    assert.ok(
      required.includes(code),
      `${code} が REQUIRED_ENV から外れています（＝ビルドが止まらなくなります）`,
    );

  for (const code of ["GA4_NOT_CONNECTED", "CLARITY_NOT_CONNECTED"]) {
    assert.ok(
      measurement.includes(code),
      `${code} が MEASUREMENT_ENV にありません`,
    );
    assert.equal(
      required.includes(code),
      false,
      `${code} が REQUIRED_ENV に戻されています（＝計測未設定で公開が止まります）`,
    );
  }
});

/**
 * ★動画の目印。
 *   営業メールは <LP>/?…#video を指しています。
 *   LP側の id を変えると、押しても動画まで飛ばず先頭に着くだけになります。
 *   エラーが出ないので、誰も気づきません。
 */
test("★動画の目印 id=\"video\" を消さない（営業メールのリンク先）", () => {
  const src = readFileSync(
    join(ROOT, "components", "sections", "ProductVideo.tsx"),
    "utf8",
  );
  assert.match(
    src,
    /id=["']video["']/,
    '動画セクションの id="video" が消えています。' +
      "営業メールの動画リンクは #video を指しているため、" +
      "押しても動画まで飛ばず、ページの先頭に着くだけになります",
  );
});
