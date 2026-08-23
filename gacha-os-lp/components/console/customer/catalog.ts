/**
 * お客様の棚（どのガチャを、どの並びで見せるか）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ画面の中に書かないのか
 * ═══════════════════════════════════════════════════════
 *
 *   「新着」「人気」「残りわずか」の中身を画面の中で決めると、
 *   ホームと一覧と検索で、同じ言葉が別の意味になります。
 *   ホームの「人気」に出ているのに、一覧の「人気」には無い、が起きます。
 *   お客様から見れば、それは単に壊れている画面です。
 *
 * ★数字の出どころを、1か所にしておくこと。
 *   残り口数・売れた割合・当たりの本数は、
 *   運営の画面と同じ元データから出します。
 *   お客様側だけ別の計算にすると、
 *   「お客様には残り3口と出ているのに、管理画面では0口」が起きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★お客様に出してよい数字・いけない数字
 * ═══════════════════════════════════════════════════════
 *
 *   出してよい … 価格・残り口数・全口数・賞の構成（何が何本）
 *   出さない   … 設計還元率・実還元率・粗利・仕入れ値・市場価格との差
 *
 *   還元率を出すと、還元率が高くなった時期を狙って引かれます。
 *   それは運営が損をするというより、
 *   後から引いた方が必ず損をする、という不公平が生まれるからです。
 */

import type { ConsoleGacha } from "@/lib/console/state";
import { LAST_ONE_GRADE, poolOf } from "@/lib/console/draw";
import { artKindOf, type ArtKind } from "./art";

/* ══════════════════════════════════════════════
   賞の一覧
   ══════════════════════════════════════════════ */

export type Tier = {
  grade: string;
  name: string;
  /** 景品の価値（円） */
  value: number;
  /** 箱に入っている本数 */
  count: number;
  /** まだ箱に残っている本数 */
  left: number;
  /** 現物のお届けになるか（ポイントでお返しする等級は false） */
  physical: boolean;
};

const PHYSICAL = ["S", "A", "B"];

/**
 * このガチャの賞の一覧（S・A・B・C・D）。
 *
 * ★残り本数まで出すこと。
 *   「S賞1本」とだけ書いてあると、
 *   もう出たあとなのか、まだ入っているのかが分かりません。
 *   引くかどうかを決められる情報になっていません。
 */
export function tiersOf(g: ConsoleGacha): Tier[] {
  const drawn = g.drawn ?? {};
  return poolOf(g.title, g.price, g.total, g.designedRtp).map((p) => ({
    grade: p.grade,
    name: p.name,
    value: p.value,
    count: p.count,
    left: Math.max(0, p.count - (drawn[p.grade] ?? 0)),
    physical: PHYSICAL.includes(p.grade),
  }));
}

/**
 * ラストワン賞（最後の1口を引いた方に取り置いてある賞）。
 *
 * ★「おまけ」と書かないこと。
 *   箱の中身は1本も増えていません。A賞のうち1本を、
 *   最後の1口のために取り置いているだけです。
 *   増えると書くと、還元率の説明と食い違います。
 */
export function lastOneOf(g: ConsoleGacha): Tier | null {
  const t = tiersOf(g).find((x) => x.grade === LAST_ONE_GRADE);
  if (!t || t.left <= 0) return null;
  return t;
}

/* ══════════════════════════════════════════════
   1つのガチャの見え方
   ══════════════════════════════════════════════ */

export type Card = {
  g: ConsoleGacha;
  kind: ArtKind;
  /** 売れた割合（%） */
  soldPct: number;
  /** 残り口数 */
  left: number;
  /** 目玉の賞（いちばん価値の高い、まだ残っている賞） */
  top: Tier | null;
  /** S賞がまだ残っているか */
  sLeft: number;
  /** 残りわずかか */
  ending: boolean;
  /** 新しく出たものか */
  fresh: boolean;
};

/** 「残りわずか」と言ってよい線 */
export const ENDING_PCT = 20;

export function cardOf(g: ConsoleGacha): Card {
  const tiers = tiersOf(g);
  const remaining = tiers.filter((t) => t.left > 0);
  const top =
    remaining.length > 0
      ? remaining.reduce((a, b) => (b.value > a.value ? b : a))
      : null;
  const soldPct =
    g.total > 0 ? Math.round(((g.total - g.left) / g.total) * 100) : 0;

  return {
    g,
    kind: artKindOf(g.title),
    soldPct,
    left: g.left,
    top,
    sLeft: tiers.find((t) => t.grade === "S")?.left ?? 0,
    ending: g.total > 0 && (g.left / g.total) * 100 <= ENDING_PCT,
    fresh: freshness(g) <= 3,
  };
}

/**
 * 公開してから何日たったか。
 *
 * ★「今日」を実時間で取らないこと。
 *   デモの中の今日は 2026-08-22 に固定してあります。
 *   実時間で計算すると、明日開いたときに
 *   「3日前に公開」だったものが「4日前」になり、
 *   スクリーンショットと画面が食い違います。
 */
const TODAY = "2026-08-22";

function freshness(g: ConsoleGacha): number {
  if (!g.publishedAt) return 999;
  const a = Date.parse(`${g.publishedAt}T00:00:00Z`);
  const b = Date.parse(`${TODAY}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 999;
  return Math.round((b - a) / 86_400_000);
}

/* ══════════════════════════════════════════════
   棚の分け方
   ══════════════════════════════════════════════ */

export type ShelfKey = "all" | "new" | "hot" | "ending" | "cheap" | "big";

export const SHELVES: {
  key: ShelfKey;
  label: string;
  /** その棚が何なのかの説明。書けない棚は作らない */
  note: string;
}[] = [
  { key: "all", label: "すべて", note: "いま販売中のガチャです。" },
  { key: "new", label: "新着", note: "この3日以内に公開したガチャです。" },
  { key: "hot", label: "人気", note: "いちばん売れている順に並べています。" },
  { key: "ending", label: "残りわずか", note: `残りが全体の${ENDING_PCT}%以下になったガチャです。` },
  { key: "cheap", label: "お手頃", note: "1回1,000pt以下で引けるガチャです。" },
  { key: "big", label: "高額賞あり", note: "1万円相当以上の賞が、まだ箱に残っているガチャです。" },
];

/**
 * 販売中のガチャだけを、棚ごとに並べる。
 *
 * ★下書き・審査中・停止中を混ぜないこと。
 *   押せるのに引けない商品が棚に並びます。
 *   「在庫がありません」と後から言うのがいちばん嫌われます。
 */
export function shelf(gachas: ConsoleGacha[], key: ShelfKey): Card[] {
  const live = gachas.filter((g) => g.status === "PUBLISHED" && g.left > 0);
  const cards = live.map(cardOf);

  if (key === "new") return cards.filter((c) => c.fresh);
  if (key === "hot") return [...cards].sort((a, b) => b.soldPct - a.soldPct);
  if (key === "ending")
    return [...cards].filter((c) => c.ending).sort((a, b) => a.left - b.left);
  if (key === "cheap")
    return [...cards].filter((c) => c.g.price <= 1000).sort((a, b) => a.g.price - b.g.price);
  if (key === "big")
    return [...cards]
      .filter((c) => (c.top?.value ?? 0) >= 10_000)
      .sort((a, b) => (b.top?.value ?? 0) - (a.top?.value ?? 0));

  return cards;
}

/**
 * ホームのいちばん上に出す、おすすめ。
 *
 * ★「おすすめ」の理由を、必ず一緒に返すこと。
 *   理由の無いおすすめは、ただの広告枠です。
 *   なぜこれが上に出ているのかを、お客様に読めるようにします。
 */
export function featured(gachas: ConsoleGacha[]): { card: Card; why: string }[] {
  const live = shelf(gachas, "all");
  const out: { card: Card; why: string }[] = [];

  const ending = live.filter((c) => c.ending).sort((a, b) => a.left - b.left)[0];
  if (ending) out.push({ card: ending, why: `残り${ending.left}口。まもなく終了します` });

  const fresh = live.filter((c) => c.fresh)[0];
  if (fresh && !out.some((x) => x.card.g.id === fresh.g.id))
    out.push({ card: fresh, why: "公開したばかりの新着です" });

  const big = [...live].sort((a, b) => (b.top?.value ?? 0) - (a.top?.value ?? 0))[0];
  if (big && !out.some((x) => x.card.g.id === big.g.id))
    out.push({
      card: big,
      why: big.top
        ? `${big.top.grade}賞（${big.top.value.toLocaleString()}円相当）が残っています`
        : "上位賞が残っています",
    });

  for (const c of live) {
    if (out.length >= 3) break;
    if (!out.some((x) => x.card.g.id === c.g.id))
      out.push({ card: c, why: "いま販売中です" });
  }

  return out.slice(0, 3);
}

/* ══════════════════════════════════════════════
   まとめ引き
   ══════════════════════════════════════════════ */

/**
 * 1回に引ける回数。
 *
 * ★残り口数と残高を超えて押させないこと。
 *   押してから「引けません」と返す作りにすると、
 *   10連のつもりで押したのに3回だけ引かれた、が起きます。
 *   何回引けるのかを、押す前に画面で決めます。
 */
export const BULK_OPTIONS = [1, 10, 100];

export function maxDraws(price: number, balance: number, left: number): number {
  if (price <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(balance / price), left));
}
