/**
 * 「進んでよい順番」の判断を、恒久ルールとして事業Vaultへ残す。
 *
 * ★なぜ残すか
 *   順番ゲートは、放っておくと必ず緩められる。
 *   「今回だけ先に顔を作っておこう」「テストのために一時的に外そう」で1回外れると、
 *   次の人はそれを正常な状態だと思って戻さない。
 *   なぜその順番なのかを残しておかないと、判断ごと消える。
 *
 * 実行: npx tsx scripts/record-phase-gate.ts
 * 追記のみ。既存の記述は書き換えない（lib/obsidian.ts が検査して止める）。
 */
import { appendLearning } from "../lib/obsidian.js";
import { CHARACTER_IDENTITY, REQUIRED_SCREENINGS } from "../lib/identity.js";
import { loadScreening, remainingRequired } from "../lib/screening.js";
import { orderedSteps } from "../lib/phases.js";

const screening = loadScreening();
const byGate = (g: string) => REQUIRED_SCREENINGS.filter((r) => r.gate === g);
const remain = remainingRequired(screening);
const steps = orderedSteps();

const files: string[] = [];

// --- 1. 順番を機械で強制するという判断 --------------------------------------
files.push(
  appendLearning({
    kind: "DECISION",
    title: "名前→顔→投稿の順番を機械で強制する（順番を飛ばせなくする）",
    body: [
      "## 判断",
      "",
      "「今どこまで進んでよいか」を `lib/phases.ts` の1か所で判定し、",
      "順番を飛ばそうとしたスクリプトはその場で停止させる。",
      "",
      "## 理由",
      "",
      "後戻りのコストが工程ごとに桁違いに違う。",
      "",
      "- 名前を変える → 顔・投稿・アカウント名・LP・アフィリ申請まで全部やり直し",
      "- 顔を変える　 → 投稿画像が全部やり直し",
      "- 投稿を変える → その週のぶんだけやり直し",
      "",
      "だから必ず上流から確定させる。逆順や同時進行をやると、",
      "上流が動いた瞬間に下流の成果物が全部ゴミになる。",
      "人の意志だけで守ろうとすると、締切が近い日に必ず破られる。",
      "",
      "## 決めた順番（8段階）",
      "",
      ...steps.map((s) => `${s.step}. ${s.humanOnly ? "[人]" : "[機械]"} ${s.label}`),
      "",
      "## 止めないもの",
      "",
      "下書き・テストコード・ドキュメント・調査は、どの段階でも書いてよい。",
      "これらは後戻りのコストが無い。ここまで止めると人が待つだけの時間が増える。",
      "",
      "## 実装で気をつけたこと",
      "",
      "- 条件をスクリプト側に書き足さない。書き足すと片方だけ緩い抜け道ができる。",
      "  `scripts/generate-faces.ts` と `scripts/plan-week.ts` は `requireAllowed()` を呼ぶだけ。",
      "- `requireAllowed()` を try/catch で握りつぶさない。止まることが仕事。",
      "- 顔一致の実測処理が「ある」かどうかは、人の申告ではなく",
      "  回帰テスト（同一人物=PASS / 別人物=FAIL）が通ったかで決める。",
      "- `plan:week` は `--dry-run` も止める。捨てると決まっている文章を読む時間が無駄になる。",
      "",
      "## 実装場所",
      "",
      "- `ai-yamato-nadeshiko/lib/phases.ts`（順番の判定・唯一の正）",
      "- `ai-yamato-nadeshiko/scripts/gate.ts`（`npm run gate` で今の状態を見る）",
      "- `ai-yamato-nadeshiko/scripts/test-phases.ts`（順番が守られているかの回帰テスト）",
    ].join("\n"),
  }),
);

// --- 2. 台帳を用途で3つのゲートに分けた判断 ---------------------------------
files.push(
  appendLearning({
    kind: "DECISION",
    title: "商標・同名調査を用途別3ゲートに分ける（名前確定を止めるのはNAME_LOCKだけ）",
    body: [
      "## 判断",
      "",
      "調査台帳の項目を、それが何を決める材料なのかで3つに分ける。",
      "全項目がそろうまで全部を止める、という運用はしない。",
      "",
      `### NAME_LOCK … その名前を「使ってよいか」（${byGate("NAME_LOCK").length}件）`,
      "",
      ...byGate("NAME_LOCK").map((r) => `- ${r.registry}`),
      "",
      `### ACCOUNT … その名前で「世に出られるか」（${byGate("ACCOUNT").length}件）`,
      "",
      ...byGate("ACCOUNT").map((r) => `- ${r.registry}`),
      "",
      `### EXPANSION … その地域・商材へ「広げてよいか」（${byGate("EXPANSION").length}件）`,
      "",
      ...byGate("EXPANSION").map((r) => `- ${r.registry}`),
      "",
      "## 理由",
      "",
      "「SNSのIDが空いているか」は、その名前が法的・検索的に正しいかとは無関係。",
      "混ぜて全部を必須にすると、名前としては何の問題も無いのに確定できず、",
      "先へ進めないまま時間だけが過ぎる。",
      "逆に全部を任意にすると、IDが取れない名前のまま顔まで作ってしまう。",
      "",
      "## ACCOUNT を顔生成の手前に置いた理由",
      "",
      "IDが1つも取れないと分かった時、取れる名前へ変える判断があり得る。",
      "その時点で基準顔を作り終えていると、顔ごと捨てになる。",
      "顔は後戻りのコストが一番高いので、先に「その名前で世に出られるか」を確かめる。",
      "",
      "つまり：",
      "",
      "- 名前の確定（LOCK_IDENTITY）… NAME_LOCK だけ見る",
      "- 顔の生成（GENERATE_FACE_CANDIDATES）… NAME_LOCK ＋ ACCOUNT を見る",
      "",
      "## ゲートは台帳から読まない",
      "",
      "どの項目がどのゲートかは、必ずコード側（`REQUIRED_SCREENINGS`）から引く。",
      "台帳CSVに gate 列を作ると、人が NAME_LOCK を ACCOUNT に書き換えるだけで",
      "商標の衝突を素通りさせられてしまう。",
      "コードの定義に無いIDは、一番厳しい NAME_LOCK 扱いにする（安全側に倒す）。",
      "",
      "## 根拠が無い「問題なし」を残さない",
      "",
      "CLEAR でも確認日か出典URLが空なら UNKNOWN へ戻す。",
      "後から誰も検証できない「問題なし」は、調べていないのと同じ。",
      "読めない値（`clear ` や `OK` など）も UNKNOWN として扱う。",
    ].join("\n"),
  }),
);

// --- 3. 今の状態（事実） -----------------------------------------------------
files.push(
  appendLearning({
    kind: "FACT",
    title: "2026-08-23 時点の名前・顔・調査の状態",
    sourceUrl: "https://www.j-platpat.inpit.go.jp/",
    body: [
      "## 状態",
      "",
      `- キャラクター名: ${CHARACTER_IDENTITY.full_name}（${CHARACTER_IDENTITY.full_name_ja}）`,
      `- 名前 identity_status: ${CHARACTER_IDENTITY.identity_status}`,
      `- 基準顔 reference_face_status: ${CHARACTER_IDENTITY.reference_face_status}`,
      "",
      "## 名前を確定した根拠（NAME_LOCK ゲート4項目すべて CLEAR）",
      "",
      "- 日本 J-PlatPat：「粟野鈴穂」「Suzuho Awano」のフルネーム一致なし",
      "- 米国 USPTO：SUZUHO AWANO / AWANO / SUZUHO いずれも該当なし",
      "- 英語Web検索：完全一致の実在人物・ブランド・AIインフルエンサーなし",
      "- 日本語Web検索：完全一致の実在人物なし",
      "",
      "仮名だった「Hana」は、同名の著名グループとAIインフルエンサーが複数あるため破棄した。",
      "",
      "## まだ残っている調査",
      "",
      ...(remain.length === 0
        ? ["- なし"]
        : remain.map(
            (r) =>
              `- ${r.registry}（${r.gate}）${r.humanOnly ? " ★機械では確認できない。人が目視で埋める" : ""}`,
          )),
      "",
      "## 未確認を「問題なし」にしない",
      "",
      "機械検索で確認できなかった項目は UNKNOWN のまま保存している。",
      "確認日か出典URLが空の CLEAR も UNKNOWN へ戻している。",
    ].join("\n"),
  }),
);

console.log("事業Vaultへ追記しました（追記のみ・既存は書き換えていません）:");
for (const f of [...new Set(files)]) console.log(`  ${f}`);
console.log("");
console.log("  記録した内容: 順番ゲートの理由 / 3ゲート分割の理由 / 今の状態と名前確定の根拠");
