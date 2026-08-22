/**
 * 抽選（ガチャを1回引く）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、画面ではなくここに書いてあるのか
 * ═══════════════════════════════════════════════════════
 *
 *   当選結果を、お客様の端末で決めさせないためです。
 *
 *   画面の中で乱数を回して「S賞が出ました」と表示する作りにすると、
 *   その乱数はお客様の手元にあります。手元にあるものは書き換えられます。
 *   「引く前に結果が分かる」「引き直せる」「当たりにできる」が成立します。
 *
 *   だから、抽選は必ず運営側（このデモでは reducer）で行い、
 *   画面は「決まった結果を見せるだけ」にします。
 *   演出は結果を再生しているだけで、演出の中で結果は決まりません。
 *
 * ═══════════════════════════════════════════════════════
 * ★残り1個の景品が、2人に当たらないようにすること
 * ═══════════════════════════════════════════════════════
 *
 *   ここでは「箱から札を1枚引いて、戻さない」方式にしています。
 *   引いた札は箱から消えるので、S賞が1本しか入っていないなら
 *   2人目には構造的に出ません。
 *
 *   確率を毎回計算し直す方式（毎回1%で当たる）にすると、
 *   運が悪ければ在庫3本のS賞が5人に当たります。
 *   在庫が無いのに当選だけ出るのは、いちばん謝りに行きにくい事故です。
 *
 * ═══════════════════════════════════════════════════════
 * ★同じ種（seed）なら、同じ結果になること
 * ═══════════════════════════════════════════════════════
 *
 *   後から「本当にこの結果だったのか」を確かめられるようにするためです。
 *   引いた回数と種を記録しておけば、同じ並びを作り直せます。
 *
 *   ★本番の乱数は、これではありません。
 *     本番では暗号学的に安全な乱数（CSPRNG）を使います。
 *     ここで使っている簡易な乱数は、
 *     「同じ種なら同じ結果になる」ことを見ていただくためのものです。
 *     速いけれど、次に何が出るかを外から推測できる種類の乱数なので、
 *     本物のお金が動く抽選には使いません。
 */

import { buildSpec } from "./spec";

/** 景品の等級。D より下は「はずれ（参加ポイント）」 */
export type Grade = "S" | "A" | "B" | "C" | "D" | "-";

export type DrawOutcome = {
  grade: Grade;
  /** 人に見せる名前 */
  name: string;
  /** 景品の価値（円）。はずれは 0 */
  value: number;
  /** 現物のお届けが要るか。S・A・B は要る。C・D はポイントでお返しする */
  needsShipping: boolean;
  /** ポイントでお返しする分（円ではなく pt） */
  points: number;
};

/**
 * 抽選の記録（DRAW LOG）。
 *
 * ★「誰が・いつ・どのガチャを・いくらで引いて・何が出て・
 *    残りがいくつになったか」を、1件で追えるようにしておくこと。
 *   後から問い合わせが来たとき、この1行が無いと何も答えられません。
 */
export type DrawRecord = {
  /** 抽選ID */
  id: string;
  /** 二重実行を防ぐための鍵。同じ鍵の抽選は1回しか成立しない */
  idempotencyKey: string;
  at: string;
  userId: string;
  userName: string;
  gachaId: string;
  gachaTitle: string;
  /** 1回の料金（pt） */
  price: number;
  /** 引く前の残高（pt） */
  balanceBefore: number;
  /** 引いた後の残高（pt） */
  balanceAfter: number;
  grade: Grade;
  prizeName: string;
  prizeValue: number;
  /** 引く前の残り口数 */
  leftBefore: number;
  /** 引いた後の残り口数 */
  leftAfter: number;
  /** 乱数の種。同じ種なら同じ結果になる */
  seed: number;
  /** 何回目の抽選か（種と合わせて結果を再現するために要る） */
  nth: number;
};

/* ══════════════════════════════════════════════
   乱数
   ══════════════════════════════════════════════ */

/**
 * 種から乱数を作る（mulberry32）。
 *
 * ★本番ではこれを使いません。上の注意書きを参照。
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列から、種にする数字を作る */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ══════════════════════════════════════════════
   箱の中身
   ══════════════════════════════════════════════ */

const SHIPPED: Grade[] = ["S", "A", "B"];

/**
 * このガチャの箱に、どの等級が何本入っているか。
 *
 * 等級ごとの本数と価値は、ガチャを作ったときの設計から出します
 * （lib/console/spec.ts）。画面ごとに別々の数字を書くと、
 * 「バックテストの前提」と「実際に出る中身」がずれます。
 */
export function poolOf(
  title: string,
  price: number,
  total: number,
  designedRtp: number,
): { grade: Grade; name: string; value: number; count: number }[] {
  const spec = buildSpec(title, price, total, 1, designedRtp || 95);
  return spec.prizes.map((p) => ({
    grade: p.grade as Grade,
    name: p.name,
    value: p.value,
    count: p.count,
  }));
}

/**
 * 1回引く。
 *
 * drawn には、等級ごとに「もう何本出たか」を渡します。
 * 箱から札を1枚抜く方式なので、出尽くした等級は二度と出ません。
 *
 * @param nth  何回目の抽選か（1から）
 */
export function drawOnce(
  args: {
    title: string;
    price: number;
    total: number;
    left: number;
    designedRtp: number;
  },
  drawn: Record<string, number>,
  seed: number,
  nth: number,
): DrawOutcome {
  const pool = poolOf(args.title, args.price, args.total, args.designedRtp);

  /* 箱に残っている札を数える。
     景品が入っていない札（はずれ）も、ちゃんと1枚として数えます。
     ここを数え忘れると、残りが少なくなるほど当選率が跳ね上がります */
  const remainPrize = pool.map((p) => ({
    ...p,
    remain: Math.max(0, p.count - (drawn[p.grade] ?? 0)),
  }));
  const prizeLeft = remainPrize.reduce((a, p) => a + p.remain, 0);
  const blankLeft = Math.max(0, args.left - prizeLeft);

  const r = rng(seed + nth * 2654435761)();
  let pick = r * Math.max(1, args.left);

  for (const p of remainPrize) {
    if (pick < p.remain) {
      const needsShipping = SHIPPED.includes(p.grade);
      return {
        grade: p.grade,
        name: p.name,
        value: p.value,
        needsShipping,
        /* 現物をお届けしない等級は、その分をポイントでお返しします */
        points: needsShipping ? 0 : p.value,
      };
    }
    pick -= p.remain;
  }

  /* ここに来たら、はずれの札を引いたということ */
  void blankLeft;
  return {
    grade: "-",
    name: "参加ポイント",
    value: 0,
    needsShipping: false,
    points: Math.round(args.price * 0.1),
  };
}
