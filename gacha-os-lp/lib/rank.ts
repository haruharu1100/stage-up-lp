/**
 * 賞のランク（S / A / B / C / ラストワン）の見た目を、ここ1か所で決めます。
 *
 * なぜ1か所にまとめるのか
 *  ・以前は S / A / B / C を「小さい四角に1文字」で描いていたため、
 *    どれが上位でどれが参加賞なのかが、初めて見る人には伝わりませんでした。
 *  ・しかも管理画面側（OperatingDay）とお客様画面側（CustomerSide）で
 *    別々に色を書いていたので、同じ S 賞なのに色が違う、という状態でした。
 *
 * 決めていること
 *  ・tier … 日本語だけだと「格」が伝わらないので、英字の格付けを併記します。
 *  ・face / ink / edge … 色と質感。派手にしすぎないこと。
 *      S        … 金の縁を持たせた濃紺。いちばん上だと一目で分かる。
 *      A        … 濃い青。上位だが S ほどではない。
 *      B        … 淡い青。標準。
 *      C        … 白と銀。いちばん軽い。数がいちばん多い。
 *      LAST ONE … 金。最後の1口に必ず当たる、別枠の賞。
 *
 * ★色を足すときの決まり
 *   「S より目立つ色」を作らないこと。序列が壊れます。
 */

export type RankKey = "S" | "A" | "B" | "C" | "L";

export type RankStyle = {
  key: RankKey;
  /** 画面に出す短い名前（S賞 / ラストワン賞） */
  label: string;
  /** バッジの中に出す文字。ラストワン賞だけ LAST */
  mark: string;
  /** 格付け。英字なので、どの幅でも途中で割れません */
  tier: string;
  /** バッジの背景 */
  face: string;
  /** バッジの文字色 */
  ink: string;
  /** バッジの縁 */
  edge: string;
  /** 一覧行に薄く敷く色 */
  row: string;
};

export const RANKS: readonly RankStyle[] = [
  {
    key: "S",
    label: "S賞",
    mark: "S",
    tier: "PREMIUM",
    face: "bg-gradient-to-br from-blue-deep to-slate",
    ink: "text-white",
    edge: "ring-1 ring-inset ring-gold/60",
    row: "bg-blue-pale/50",
  },
  {
    key: "A",
    label: "A賞",
    mark: "A",
    tier: "HIGH",
    face: "bg-gradient-to-br from-blue to-blue-ink",
    ink: "text-white",
    edge: "ring-1 ring-inset ring-white/25",
    row: "bg-blue-pale/30",
  },
  {
    key: "B",
    label: "B賞",
    mark: "B",
    tier: "STANDARD",
    face: "bg-gradient-to-br from-blue-pale to-white",
    ink: "text-blue-ink",
    edge: "ring-1 ring-inset ring-blue-ink/15",
    row: "bg-white",
  },
  {
    key: "C",
    label: "C賞",
    mark: "C",
    tier: "ENTRY",
    face: "bg-gradient-to-br from-white to-mist",
    ink: "text-slate2",
    edge: "ring-1 ring-inset ring-edge",
    row: "bg-white",
  },
  {
    key: "L",
    label: "ラストワン賞",
    mark: "LAST",
    tier: "SPECIAL",
    face: "bg-gradient-to-br from-gold-soft to-gold",
    ink: "text-slate",
    edge: "ring-1 ring-inset ring-slate/15",
    row: "bg-gold-soft/25",
  },
];

const BY_KEY = new Map(RANKS.map((r) => [r.key, r]));

export function rank(key: RankKey): RankStyle {
  const r = BY_KEY.get(key);
  if (!r) throw new Error(`unknown rank: ${key}`);
  return r;
}
