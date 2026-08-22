/**
 * お客様が実際にガチャを引く画面（CUSTOMER PLAY DEMO）の中身と、抽選の計算。
 *
 * ★なぜ画面から分けているのか
 *   抽選は「見た目」ではなく「計算」です。ここを画面の中に書くと、
 *   デザインを直すたびに確率が変わっていないかを目で確かめることになります。
 *   計算だけをここに置き、tests/ から機械で確かめられるようにしています。
 *
 * ★このファイルの決まり
 *   1) 結果は必ず先に決まる。演出は決まった結果を再生するだけ。
 *      演出の途中で結果が変わる作りにしないこと。実物のガチャでもそうしています。
 *   2) 乱数は種（seed）から作る。同じ種なら必ず同じ結果になるので、
 *      テストで「10連が10件返るか」「残口数が10減るか」を確かめられます。
 *   3) 残っていない賞は絶対に出さない。口数が0になったら引けない。
 *   4) ラストワン賞は、最後の1口を引いた人に必ず出す。抽選しない。
 *   5) ここに出てくる商品名は、すべて架空のデモ用です。
 *      実在の商品名・ブランド名・画像は使いません（権利の問題と、
 *      「いま売っている」と誤解されるのを避けるため）。
 */

import type { RankKey } from "./rank";

/* ══════════════════════════════════════════════
   型
   ══════════════════════════════════════════════ */

export type Prize = {
  id: string;
  rank: RankKey;
  /** 架空のデモ用商品名 */
  name: string;
  /** 参考価値（ポイント換算）。ポイント還元を選んだときに戻る量 */
  pt: number;
  /** 残り本数 */
  left: number;
  /** 最初の本数 */
  total: number;
};

export type Gacha = {
  id: string;
  title: string;
  /** 1回の料金（ポイント） */
  price: number;
  /** 総口数 */
  total: number;
  /** 残り口数 */
  left: number;
  /** サムネイルの絵柄。components/customer/GachaArt.tsx が描き分ける */
  art: ArtKey;
  /** 一覧に出す小さな札（NEW / 人気 / 残りわずか） */
  badges: BadgeKey[];
  /** 注目賞。お客様が最初に見る一行 */
  headline: string;
  /** 最低保証。「はずれても必ずこれ以上」を明示する */
  guarantee: string;
  prizes: Prize[];
};

export type ArtKey = "card" | "sneaker" | "watch";
export type BadgeKey = "new" | "hot" | "few";

export type DrawResult = {
  /** 何回目か（1始まり）。10連の結果一覧で使う */
  n: number;
  prizeId: string;
  rank: RankKey;
  name: string;
  pt: number;
  /** ラストワン賞（抽選ではなく確定で出たもの） */
  lastOne: boolean;
};

/** マイページに並ぶ、獲得済みの商品 */
export type Owned = {
  /** 同じ賞を複数当てても別行になるよう、引いた回数で一意にする */
  key: string;
  rank: RankKey;
  name: string;
  pt: number;
  /**
   * どのガチャから出たか（絵を出すため）。
   * ★これを省かないこと。
   *   マイページを「賞のアルファベットだけ」で並べていたとき、
   *   実際の売り場に見えませんでした。お客様は自分が当てた「モノ」を見ます。
   */
  art: ArtKey;
  /**
   * 獲得日時。
   * ★実際の日付を計算して入れないこと。
   *   サーバーで作った文字とブラウザで作った文字がずれて、
   *   画面がちらつく原因になります。デモなので固定の文字で持ちます。
   */
  at: string;
  status: "held" | "requested" | "preparing";
};

/* ══════════════════════════════════════════════
   デモ用のガチャ（すべて架空）
   ══════════════════════════════════════════════ */

/**
 * ★商品名について
 *   実在のカード名・スニーカー名・時計名は書かないこと。
 *   「販売中の商品だ」と誤解される可能性があり、権利の問題も出ます。
 *   ジャンルが伝わる架空の名前だけを使います。
 *
 * ★数字について（ここを崩さないこと）
 *   このデモは、画面の横に「実還元率」を出しています。
 *   つまり数字が適当だと、その場でバレます。
 *   次の2つを必ず守ってください。
 *
 *   ① 残っている景品の本数の合計 ＝ 残り口数
 *      1口引けば景品が1つ出るので、これがずれていたら計算が合いません。
 *      （最初これがずれていて、実還元率が412%と表示されました。
 *        「還元率を管理するシステム」の販売ページでこれは致命的です）
 *
 *   ② 実還元率が 90〜105% に収まること
 *      オンラインガチャの実際の水準です。ここから外れた数字を出すと、
 *      「この会社は相場を知らない」と読まれます。
 *
 *   両方とも tests/customerDemo.test.ts が毎回機械で確かめます。
 *
 * 行の書き方： [格, 商品名, 参考価値, 最初の本数, 残り本数]
 */
function prizes(rows: [RankKey, string, number, number, number][]): Prize[] {
  return rows.map(([rank, name, pt, total, left], i) => ({
    id: `${rank}${i}`,
    rank,
    name,
    pt,
    left,
    total,
  }));
}

export const CATALOG: Gacha[] = [
  /*
    ① プレミアムカード ── 「まだ序盤」の見え方
       1000口のうち266口が売れた状態。上位賞はほぼ残っている。
       残数ベースの実還元率 98.8%。
  */
  {
    id: "premium-card",
    title: "プレミアムカードガチャ",
    price: 500,
    total: 1000,
    left: 734,
    art: "card",
    badges: ["hot", "new"],
    headline: "S賞：最上位レアカード（デモ）",
    guarantee: "はずれなし。必ず1枚以上のカードが当たります",
    prizes: prizes([
      ["S", "最上位レアカード（デモ）", 120000, 1, 1],
      ["A", "上位レアカード（デモ）", 24000, 2, 1],
      ["B", "レアカード（デモ）", 4200, 15, 5],
      ["C", "スタンダードカード（デモ）", 220, 981, 726],
      ["L", "ラストワン特典カード（デモ）", 38000, 1, 1],
    ]),
  },
  /*
    ② スニーカー ── 「終盤」の見え方
       500口のうち332口が売れ、S賞はすでに出ている（だから残りわずか）。
       上位賞が抜けたぶん、残数ベースの実還元率は 93.9% まで下がります。
       ★これは不具合ではなく、実際に起きることです。
         「残りが減るほど当たりにくくなる」を隠さないために、わざとこの状態を置いています。
  */
  {
    id: "sneaker",
    title: "スニーカーガチャ",
    price: 1000,
    total: 500,
    left: 168,
    art: "sneaker",
    badges: ["few"],
    headline: "A賞：人気モデルスニーカー（デモ）",
    guarantee: "はずれなし。必ず1点以上の商品が当たります",
    prizes: prizes([
      ["S", "限定モデルスニーカー（デモ）", 120000, 1, 0],
      ["A", "人気モデルスニーカー（デモ）", 30000, 2, 1],
      ["B", "定番スニーカー（デモ）", 8000, 10, 3],
      ["C", "オリジナルソックス（デモ）", 360, 486, 163],
      ["L", "ラストワン特典スニーカー（デモ）", 45000, 1, 1],
    ]),
  },
  /*
    ③ 腕時計 ── 「出たばかり」の見え方
       200口のうち9口だけ売れた状態。実還元率 98.1%。
  */
  {
    id: "watch",
    title: "腕時計ガチャ",
    price: 3000,
    total: 200,
    left: 191,
    art: "watch",
    badges: ["new"],
    headline: "S賞：高級腕時計（デモ）",
    guarantee: "はずれなし。必ず1点以上の商品が当たります",
    prizes: prizes([
      ["S", "高級腕時計（デモ）", 150000, 1, 1],
      ["A", "上位モデル腕時計（デモ）", 45000, 2, 2],
      ["B", "スタンダード腕時計（デモ）", 12000, 6, 6],
      ["C", "オリジナルウォッチケース（デモ）", 1050, 190, 181],
      ["L", "ラストワン特典腕時計（デモ）", 60000, 1, 1],
    ]),
  },
];

export const BADGE_LABEL: Record<BadgeKey, string> = {
  new: "NEW",
  hot: "人気",
  few: "残りわずか",
};

/* ══════════════════════════════════════════════
   乱数（種から作る）
   ══════════════════════════════════════════════ */

/**
 * mulberry32。短くて質が十分な擬似乱数。
 * ★Math.random() を直接使わないこと。
 *   同じ操作で同じ結果にならないと、テストで確かめられません。
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ══════════════════════════════════════════════
   抽選
   ══════════════════════════════════════════════ */

/** ラストワン賞は抽選に混ぜない。最後の1口のときだけ確定で出す */
const isLast = (p: Prize) => p.rank === "L";

/**
 * 1回引く。
 * 残っている本数をそのまま重みにするので、
 * 残数が減れば当たりにくくなる（実物と同じ考え方）。
 */
export function drawOnce(g: Gacha, rng: () => number, n: number): DrawResult {
  if (g.left <= 0) throw new Error("残り口数がありません");

  /* 最後の1口。ラストワン賞があるなら、抽選せずに必ずそれを出す */
  if (g.left === 1) {
    const l = g.prizes.find((p) => isLast(p) && p.left > 0);
    if (l) {
      return { n, prizeId: l.id, rank: l.rank, name: l.name, pt: l.pt, lastOne: true };
    }
  }

  const pool = g.prizes.filter((p) => !isLast(p) && p.left > 0);
  if (pool.length === 0) throw new Error("残っている賞がありません");

  const sum = pool.reduce((a, p) => a + p.left, 0);
  let x = rng() * sum;
  for (const p of pool) {
    x -= p.left;
    if (x <= 0) {
      return { n, prizeId: p.id, rank: p.rank, name: p.name, pt: p.pt, lastOne: false };
    }
  }
  const p = pool[pool.length - 1];
  return { n, prizeId: p.id, rank: p.rank, name: p.name, pt: p.pt, lastOne: false };
}

/**
 * まとめて引く（10連など）。
 * 1回ごとに残数を減らしてから次を引くので、
 * 「残り1本のS賞が10連で2回出る」ようなことは起きません。
 */
export function drawMany(
  g: Gacha,
  count: number,
  rng: () => number,
): { results: DrawResult[]; next: Gacha } {
  let cur = g;
  const results: DrawResult[] = [];
  const times = Math.min(count, g.left);
  for (let i = 0; i < times; i++) {
    const r = drawOnce(cur, rng, i + 1);
    results.push(r);
    cur = applyDraw(cur, r);
  }
  return { results, next: cur };
}

/** 引いた結果を残数に反映する。元のデータは書き換えない */
export function applyDraw(g: Gacha, r: DrawResult): Gacha {
  return {
    ...g,
    left: g.left - 1,
    prizes: g.prizes.map((p) =>
      p.id === r.prizeId ? { ...p, left: Math.max(0, p.left - 1) } : p,
    ),
  };
}

/** 序列。数が小さいほど格が上。10連で「いちばん良かった賞」を選ぶのに使う */
const ORDER: Record<RankKey, number> = { L: 0, S: 1, A: 2, B: 3, C: 4 };

/** いちばん良かった結果。同じ格なら先に引いた方 */
export function bestOf(results: DrawResult[]): DrawResult | null {
  if (results.length === 0) return null;
  return results.reduce((best, r) =>
    ORDER[r.rank] < ORDER[best.rank] ? r : best,
  );
}

/* ══════════════════════════════════════════════
   運営側に見える数字（お客様の操作と必ず一致させる）
   ══════════════════════════════════════════════ */

export type OperatorView = {
  left: number;
  sold: number;
  /** 売上（ポイント） */
  revenue: number;
  /** 残数ベースの実還元率（%） */
  realRtp: number;
  /** 未発送の件数 */
  unshipped: number;
};

/**
 * 残数ベースの実還元率 ＝ 残っている景品の合計価値 ÷（残り口数 × 1回の料金）。
 * ★RtpMonitor と同じ考え方。ここで別の式を書かないこと。
 *   同じ商品なのにセクションごとに違う数字が出ると、それだけで信用を失います。
 */
export function realRtp(g: Gacha): number {
  if (g.left <= 0) return 0;
  const value = g.prizes.reduce((a, p) => a + p.pt * p.left, 0);
  return (value / (g.left * g.price)) * 100;
}

export function operatorView(
  g: Gacha,
  base: Gacha,
  unshipped: number,
): OperatorView {
  const sold = base.left - g.left;
  return {
    left: g.left,
    sold,
    revenue: sold * g.price,
    realRtp: realRtp(g),
    unshipped,
  };
}

/** 表示用。1,000 のように3桁で区切る */
export const pt = (n: number) => `${n.toLocaleString("ja-JP")} pt`;

/* ══════════════════════════════════════════════
   問い合わせチケット（AI → 人 → お客様 の一周）

   ★ここを画面の中だけで持たないこと。
     「AIが人へ渡しました」で終わる画面は、いくらでも書けます。
     渡したあと、人が読んで、書いて、お客様に届いて、
     運営側の「要確認」が減る。そこまでが1つの仕事です。

     だから、件数の増減と状態の変化は、この場所（ただの計算）に置いて
     テストで検算できるようにしています。画面はこれを表示するだけです。

   ★状態は2つだけにしています。
       open     … 人がまだ返していない（＝運営画面の「要確認」に残る）
       answered … 人が返した（＝「対応済み」へ移り、お客様の画面に返信が出る）
     途中の状態を増やすと、デモを見る人が数え方を追えなくなります。
   ══════════════════════════════════════════════ */

export type TicketStatus = "open" | "answered";

export type Ticket = {
  /** 受付番号。お客様の画面と運営画面の両方に、同じものを出す */
  id: string;
  /** お客様が書いた内容 */
  q: string;
  /** AIの判定結果（人へ渡した理由の見出し） */
  verdict: string;
  /** なぜAIが答えなかったのか */
  reason: string;
  /** 返信欄にあらかじめ入れておく文面。人が直してから送る */
  draft: string;
  /** 実際に送った文面。まだ送っていなければ空 */
  reply: string;
  status: TicketStatus;
};

/**
 * 受付番号は CS-0001 のように、連番で作ります。
 * ★乱数にしないこと。デモ中に採番がばらつくと、
 *   お客様側の画面と運営画面で同じ番号を指しているのかが分からなくなります。
 */
export function ticketId(seq: number): string {
  return `CS-${String(seq).padStart(4, "0")}`;
}

export function makeTicket(
  seq: number,
  q: string,
  reason: string,
  draft: string,
): Ticket {
  return {
    id: ticketId(seq),
    q,
    verdict: "HUMAN REVIEW REQUIRED",
    reason,
    draft,
    reply: "",
    status: "open",
  };
}

/**
 * 運営者が返信する。
 * ★空文字では送れません。
 *   空のまま送れてしまうと、「要確認」だけが減って、
 *   お客様には何も届いていない、という嘘の画面になります。
 */
export function replyTicket(
  list: Ticket[],
  id: string,
  reply: string,
): Ticket[] {
  const body = reply.trim();
  if (!body) return list;
  return list.map((t) =>
    t.id === id && t.status === "open"
      ? { ...t, reply: body, status: "answered" as const }
      : t,
  );
}

/** 運営画面に出す2つの数字。合計は必ず受け付けた件数と一致します */
export function ticketCounts(list: Ticket[]): {
  open: number;
  answered: number;
  total: number;
} {
  const open = list.filter((t) => t.status === "open").length;
  const answered = list.filter((t) => t.status === "answered").length;
  return { open, answered, total: list.length };
}
