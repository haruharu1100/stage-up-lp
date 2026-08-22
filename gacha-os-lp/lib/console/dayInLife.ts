/**
 * 「1日、運営してみる」の進行表。
 *
 * ═══════════════════════════════════════════════
 * ★これは、スライドショーではありません
 * ═══════════════════════════════════════════════
 *
 *   機能を1つずつ説明しても、この仕事は伝わりません。
 *   知りたいのは「機能があるか」ではなく、
 *   「朝から夕方まで、これで店が回るのか」だからです。
 *
 *   だから、順番に手を動かしていただきます。
 *   朝ダッシュボードを開く → AIに今日やることを聞く →
 *   値上がりを見る → 怪しい登録を判定する → ガチャを作る →
 *   検証する → 公開する → お客様として引く → 発送を依頼する →
 *   質問する → 運営として発送する → 夕方に売上を見る。
 *
 * ═══════════════════════════════════════════════
 * ★「次へ」ボタンで進める作りにしないこと
 * ═══════════════════════════════════════════════
 *
 *   押すだけで進む案内は、動画と同じです。
 *   本当に動いたのかが分からないので、
 *   見た人は「デモ用に作り込んだ画面だろう」と思います。
 *   そう思われた時点で、見せた意味がありません。
 *
 *   ここでは、実際にデータが動いたかどうかだけを見ます。
 *   ガチャを作らなければ、作る手順は終わりません。
 *   お客様として引かなければ、引く手順は終わりません。
 *
 *   ★例外は、見るだけの手順（ダッシュボード・AI・相場・売上）です。
 *     見ることが仕事なので、その画面を開いたら終わりにします。
 *     それ以外を「開いたら終わり」にしないこと。
 *
 * ═══════════════════════════════════════════════
 * ★判定を、画面の中に書かないこと
 * ═══════════════════════════════════════════════
 *
 *   ここに集めておけば、テストから同じものを呼べます。
 *   画面の中に書くと、機械で確かめられなくなります。
 *   確かめられない案内は、いつのまにか嘘になります。
 */

import { ORDER_TODO, type ConsoleState } from "./state";
import type { MenuKey } from "@/components/console/menu";

/**
 * もう運営の手を離れた発送。
 *
 * ★「SHIPPED の数」で数えないこと。
 *   発送済みはそのあと配送中・配達完了へ進みます。
 *   SHIPPED だけを数えると、進んだぶんだけ数が減り、
 *   発送したのに手順が終わらない、という見え方になります。
 */
const shippedCount = (s: ConsoleState) =>
  s.orders.filter((o) => !ORDER_TODO.includes(o.status)).length;

/** どちら側の画面で行う手順か */
export type DaySide = "admin" | "customer";

/**
 * 始めた時点の数。
 *
 * ★「0件から1件になったか」で見ないこと。
 *   デモの見本データには、最初から発送も問い合わせも入っています。
 *   0件を前提にすると、始めた瞬間に全部終わったことになります。
 */
export type DayBase = {
  gachas: number;
  /**
   * 引いた回数。
   *
   * ★「獲得商品が増えたか」で、引いた手順を終わらせないこと。
   *   引いてもポイントでお返しする等級があります。はずれもあります。
   *   商品が増えたかで見ると、はずれた方は
   *   ちゃんと引いたのに手順が終わらず、案内が止まります。
   */
  draws: number;
  prizes: number;
  shipRequested: number;
  tickets: number;
  shipped: number;
  handledSignups: number;
};

export function daySnapshot(s: ConsoleState): DayBase {
  return {
    gachas: s.gachas.length,
    draws: s.draws.length,
    prizes: s.prizes.length,
    shipRequested: s.prizes.filter((p) => p.status === "SHIP_REQUESTED").length,
    tickets: s.tickets.length,
    shipped: shippedCount(s),
    handledSignups: s.signups.filter((x) => x.handled).length,
  };
}

/** この1日で新しく作ったガチャ（まだ作っていなければ null） */
function newGacha(s: ConsoleState, b: DayBase) {
  return s.gachas.length > b.gachas ? s.gachas[s.gachas.length - 1] : null;
}

export type DayStep = {
  id: string;
  /** 何時ごろの仕事か。時計を出すと、1日の形が見えます */
  time: string;
  title: string;
  /** 何をするか */
  lead: string;
  /** なぜこの順番なのか。ここが本題です */
  why: string;
  side: DaySide;
  /** 運営側なら、どの画面へ行くか */
  page?: MenuKey;
  /** 押す場所の案内 */
  hint: string;
  /**
   * 見るだけで終わる手順か。
   * true なら、その画面を開いた時点で終わりにします。
   */
  visitOnly?: boolean;
  /** 実際にデータが動いたか */
  done: (s: ConsoleState, b: DayBase) => boolean;
};

export const DAY_STEPS: DayStep[] = [
  {
    id: "morning",
    time: "9:00",
    title: "朝いちばん、ダッシュボードを開く",
    lead: "昨日の売上、止まっている発送、返していない問い合わせ、警告。この4つを最初に見ます。",
    why: "毎朝どこを開くかが決まっていないと、その日に何を見落としたのか、あとから分かりません。",
    side: "admin",
    page: "dashboard",
    hint: "上の4つの数字を見てください。",
    visitOnly: true,
    done: () => false,
  },
  {
    id: "operator",
    time: "9:05",
    title: "AIオペレーターに「今日やること」を聞く",
    lead: "数字を自分で読み解く前に、急ぐ順に並べたものを出します。",
    why: "画面が19枚あっても、朝いちばんに開くべき1枚は毎日変わります。そこを人が探す時間を無くします。",
    side: "admin",
    page: "operator",
    hint: "並んでいる項目の「なぜ急ぐか」まで読んでください。",
    visitOnly: true,
    done: () => false,
  },
  {
    id: "market",
    time: "9:15",
    title: "値上がりした景品の警告を見る",
    lead: "仕入れ値が上がると、売れば売るほど赤字になるガチャが出ます。",
    why: "赤字は、売上が落ちたときではなく、売れているときに静かに起きます。気づくのが遅れるのはこの型です。",
    side: "admin",
    page: "market",
    hint: "上がっている景品と、その影響を受けるガチャを見てください。",
    visitOnly: true,
    done: () => false,
  },
  {
    id: "fraud",
    time: "9:30",
    title: "怪しい登録を判定する",
    lead: "1件だけ、判定して閉じてください。通す・追加確認・保留・止める、のどれかです。",
    why: "判定の理由まで残します。あとで「なぜ止めたのか」を説明できないと、止めたこと自体が問題になります。",
    side: "admin",
    page: "fraud",
    hint: "どれか1件のボタンを押してください。",
    done: (s, b) => s.signups.filter((x) => x.handled).length > b.handledSignups,
  },
  {
    id: "create",
    time: "10:00",
    title: "新しいガチャを作る",
    lead: "作りたい内容を日本語で伝えると、料金・口数・賞の構成の案が出ます。そのまま下書きに登録します。",
    why: "この工程が、いちばん時間を取られています。表計算で組んで、確率を手で計算して、間違えます。",
    side: "admin",
    page: "builder",
    hint: "案を出して「下書きに登録」まで進めてください。",
    done: (s, b) => s.gachas.length > b.gachas,
  },
  {
    id: "backtest",
    time: "10:20",
    title: "公開前バックテストを実行する",
    lead: "作ったガチャを、公開する前に何万回も回して、赤字になる条件を先に探します。",
    why: "この関門は外せません。検証していないガチャは、公開ボタンを押しても止まります。",
    side: "admin",
    page: "backtest",
    hint: "いま作ったガチャを選んで、検証を実行してください。",
    done: (s, b) => newGacha(s, b)?.backtest != null,
  },
  {
    id: "publish",
    time: "10:40",
    title: "公開する",
    lead: "検証結果が問題なければ公開します。この瞬間から、お客様の画面に出ます。",
    why: "検証と公開を分けています。分けていないと「とりあえず出す」が起きます。",
    side: "admin",
    page: "gacha",
    hint: "いま作ったガチャの「公開する」を押してください。",
    done: (s, b) => newGacha(s, b)?.status === "PUBLISHED",
  },
  {
    id: "draw",
    time: "11:00",
    title: "お客様として、引いてみる",
    lead: "上の切り替えで「ユーザー側」へ。ログインして、いま公開したガチャを引きます。",
    why: "ここが、このシステムの要です。運営側で公開した内容が、そのままお客様の画面に出ています。作り込んだ別画面ではありません。",
    side: "customer",
    hint: "「デモユーザーとして開始」→ ガチャを1回引く。",
    /* ★引いたことを、引いた回数で見ること。
       当たったかどうかは、この手順の合否ではありません */
    done: (s, b) => s.draws.length > b.draws,
  },
  {
    id: "ship-request",
    time: "11:10",
    title: "お客様として、発送を依頼する",
    lead: "当たった商品を「発送してもらう」か「ポイントに換える」か選びます。ここでは発送を選びます。",
    why: "選んだ瞬間、運営側の発送依頼一覧に入ります。転記の作業はありません。",
    side: "customer",
    hint: "獲得商品から1点選んで、発送を依頼してください。",
    done: (s, b) =>
      s.prizes.filter((p) => p.status === "SHIP_REQUESTED").length > b.shipRequested,
  },
  {
    id: "ask",
    time: "11:20",
    title: "お客様として、質問する",
    lead: "「発送はいつになりますか」などを送ってみてください。AIがその場で答えます。",
    why: "答えられない内容は、AIが答えを作らずに運営へ回します。作り話で返す方が、はるかに危険です。",
    side: "customer",
    hint: "問い合わせから1件送ってください。",
    done: (s, b) => s.tickets.length > b.tickets,
  },
  {
    id: "ship",
    time: "13:00",
    title: "運営に戻って、発送処理をする",
    lead: "お昼すぎ、届いている依頼をまとめて処理します。伝票と追跡番号ができます。",
    why: "追跡番号は、そのままお客様の画面に出ます。お客様へ連絡する作業が、別に発生しません。",
    side: "admin",
    page: "shipping",
    hint: "依頼が来ている商品の「発送済みにする」を押してください。",
    done: (s, b) => shippedCount(s) > b.shipped,
  },
  {
    id: "close",
    time: "17:00",
    title: "夕方、今日の数字を確認する",
    lead: "売上、還元率、発送の残り。ここまでの操作が、全部この画面に入っています。",
    why: "朝の数字と夕方の数字が、同じ1つのデータから出ています。日報を別に作る必要がありません。",
    side: "admin",
    page: "analytics",
    hint: "今日動かしたぶんが反映されているか、見てください。",
    visitOnly: true,
    done: () => false,
  },
];

/**
 * いま何番目の手順にいるか。
 *
 * ★終わった手順を数えるのではなく、
 *   「終わっていない、いちばん上の手順」を返すこと。
 *   途中を飛ばして先に進んだ場合、数えるやり方だと
 *   終わった手順にまた戻されます。
 */
export function currentStep(
  s: ConsoleState,
  base: DayBase,
  seen: ReadonlySet<string>,
): number {
  const i = DAY_STEPS.findIndex((st) => !isDone(st, s, base, seen));
  return i === -1 ? DAY_STEPS.length : i;
}

export function isDone(
  st: DayStep,
  s: ConsoleState,
  base: DayBase,
  seen: ReadonlySet<string>,
): boolean {
  if (st.visitOnly) return seen.has(st.id);
  return st.done(s, base);
}

export function doneCount(
  s: ConsoleState,
  base: DayBase,
  seen: ReadonlySet<string>,
): number {
  return DAY_STEPS.filter((st) => isDone(st, s, base, seen)).length;
}
