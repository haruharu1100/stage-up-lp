/**
 * お客様側の「絵」を、コードで描く。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ写真を貼らず、わざわざ描いているのか
 * ═══════════════════════════════════════════════════════
 *
 *   ①よその画像を借りると、権利の話が必ず後から来ます。
 *     デモの画面は、そのままスクリーンショットで出回ります。
 *     出回ったあとで「その写真は使えません」となっても、もう戻せません。
 *
 *   ②実在の商品写真を貼ると、その商品が当たると読めてしまいます。
 *     架空のデモに実在のブランドを持ち込むと、それだけで景表法の話になります。
 *
 *   ③商品ごとに画像ファイルを用意する運用は、必ず破綻します。
 *     ガチャは毎週増えます。画像が間に合わない週は、
 *     「文字だけのカード」が棚に並びます。それは売り場ではありません。
 *
 *   だからここでは、ガチャIDと等級から、その場で絵を組み立てます。
 *   画像ファイルは1枚も要らず、どんな解像度でも滲まず、
 *   新しいガチャが増えた瞬間から、ちゃんと絵が付きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★守ること
 * ═══════════════════════════════════════════════════════
 *
 *   ・同じIDなら、いつ何度描いても同じ絵になること。
 *     開くたびに絵が変わる棚は、お客様から見て別の商品に見えます。
 *
 *   ・絵文字を使わないこと。端末ごとに絵が違い、
 *     こちらが見ている画面と、お客様が見ている画面が別物になります。
 *
 *   ・実在のブランドの形を写さないこと。
 *     ここにあるのは「靴」「時計」「札」といった一般的な形だけです。
 */

"use client";

import type React from "react";
import { useId } from "react";

/* ══════════════════════════════════════════════
   何の絵を描くか
   ══════════════════════════════════════════════ */

/**
 * 絵の種類。
 *
 * ★増やすときは、必ず「一般的な形」にすること。
 *   特定の製品を思わせる形にすると、その時点で他社の意匠の話になります。
 */
export type ArtKind = "card" | "sneaker" | "watch" | "ring" | "box";

export const ART_KIND_LABEL: Record<ArtKind, string> = {
  card: "カード",
  sneaker: "スニーカー",
  watch: "腕時計",
  ring: "アクセサリー",
  box: "その他",
};

/**
 * ガチャの名前から、絵の種類を決める。
 *
 * ★決められなければ box にすること。
 *   分からないものを無理にカードだと言い張ると、
 *   時計のガチャにカードの絵が付きます。
 *   「その他」の箱の絵なら、少なくとも嘘にはなりません。
 */
export function artKindOf(title: string): ArtKind {
  const t = title.toLowerCase();
  if (/カード|card|トレカ|パック/.test(t)) return "card";
  if (/スニーカー|sneaker|シューズ|靴/.test(t)) return "sneaker";
  if (/時計|watch|ウォッチ/.test(t)) return "watch";
  if (/アクセサリー|リング|指輪|ネックレス|ジュエリー/.test(t)) return "ring";
  return "box";
}

/* ══════════════════════════════════════════════
   等級ごとの色
   ══════════════════════════════════════════════ */

export type GradeKey = "S" | "A" | "B" | "C" | "D" | "-";

/**
 * 等級の見え方。
 *
 * ★S賞だけを派手にして、他を灰色にしないこと。
 *   D賞しか当たらなかった方の画面が「はずれの画面」になります。
 *   実際には D賞にもポイントが付きます。
 *   どの等級にも、それぞれの色をちゃんと用意します。
 */
export const GRADE_ART: Record<
  GradeKey,
  {
    label: string;
    /** 帯や枠に使う色 */
    line: string;
    /** 背景のグラデーション（濃いほう / 薄いほう） */
    from: string;
    to: string;
    /** その背景の上に乗せる文字の色 */
    ink: string;
    /** 一覧の小さなラベルに使う、暗い背景向けの文字色 */
    chip: string;
  }
> = {
  S: { label: "S賞", line: "#E7C25C", from: "#FFF0BE", to: "#B8860F", ink: "#3B2A02", chip: "#F4D77E" },
  A: { label: "A賞", line: "#B9A4F2", from: "#E7DEFF", to: "#5B45AE", ink: "#241848", chip: "#CBBCF8" },
  B: { label: "B賞", line: "#8FBDF2", from: "#DCEBFF", to: "#2A5FAE", ink: "#0E2650", chip: "#A9CDF7" },
  C: { label: "C賞", line: "#7ED2BC", from: "#D8F4EC", to: "#22806C", ink: "#06322A", chip: "#96DFCB" },
  D: { label: "D賞", line: "#C2C9D4", from: "#EDF0F5", to: "#6E7887", ink: "#1E242E", chip: "#D3D9E2" },
  "-": { label: "参加ポイント", line: "#9AA3B2", from: "#E4E8EE", to: "#59616E", ink: "#1A1F27", chip: "#C0C7D2" },
};

/** 「S」「A」…以外の文字が来ても落ちないようにする */
export function gradeArt(grade: string) {
  return GRADE_ART[(grade as GradeKey) in GRADE_ART ? (grade as GradeKey) : "-"];
}

/* ══════════════════════════════════════════════
   同じIDなら、同じ絵になるための数
   ══════════════════════════════════════════════ */

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * ガチャの表紙に使う色の組み合わせ。
 *
 * ★白背景に薄い色、にしないこと。
 *   スマホの棚では、絵が背景に溶けると、
 *   何が並んでいるのか一目で分かりません。濃い色を土台にします。
 */
const COVERS: { from: string; to: string; glow: string }[] = [
  { from: "#1B2E63", to: "#0B1428", glow: "#5B8CFF" },
  { from: "#3A1F5C", to: "#140B28", glow: "#B07BFF" },
  { from: "#0F3C46", to: "#06181E", glow: "#4FD6C4" },
  { from: "#4A2318", to: "#1A0A06", glow: "#FF9A5B" },
  { from: "#123A2B", to: "#061810", glow: "#5FD98E" },
  { from: "#3F1B33", to: "#170716", glow: "#FF7BB0" },
];

export function coverTone(id: string) {
  return COVERS[hashOf(id) % COVERS.length];
}

/* ══════════════════════════════════════════════
   形（シルエット）
   ══════════════════════════════════════════════

   すべて viewBox="0 0 200 150" の中に描いています。
   色は currentColor にしてあるので、置く側が決められます。 */

function Silhouette({ kind }: { kind: ArtKind }) {
  if (kind === "card") {
    return (
      <g fill="currentColor">
        <rect x="74" y="24" width="52" height="102" rx="7" />
        <rect x="80" y="30" width="40" height="90" rx="4" fill="#000" opacity="0.18" />
        <path d="M100 48l6.2 12.6 13.8 2-10 9.8 2.4 13.8L100 79.6 87.6 86.2 90 72.4l-10-9.8 13.8-2z" fill="#fff" opacity="0.55" />
        <rect x="86" y="98" width="28" height="4" rx="2" fill="#fff" opacity="0.4" />
        <rect x="92" y="106" width="16" height="4" rx="2" fill="#fff" opacity="0.28" />
      </g>
    );
  }

  if (kind === "sneaker") {
    return (
      <g fill="currentColor">
        <path d="M26 108c4-20 24-24 38-28 14-4 24-18 42-18 14 0 22 8 26 20 4 12 20 14 28 20 8 6 8 14 0 16H36c-8 0-12-2-10-10z" />
        <path d="M26 112h134c8 0 10 4 8 8H32c-6 0-8-4-6-8z" opacity="0.55" />
        <path d="M74 82l16 22M88 74l16 22M102 66l16 22" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.4" fill="none" />
      </g>
    );
  }

  if (kind === "watch") {
    return (
      <g fill="currentColor">
        <rect x="86" y="16" width="28" height="34" rx="8" />
        <rect x="86" y="100" width="28" height="34" rx="8" />
        <circle cx="100" cy="75" r="32" />
        <circle cx="100" cy="75" r="24" fill="#000" opacity="0.2" />
        <path d="M100 58v18l12 7" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.65" />
      </g>
    );
  }

  if (kind === "ring") {
    return (
      <g fill="currentColor">
        <circle cx="100" cy="94" r="30" />
        <circle cx="100" cy="94" r="19" fill="#000" opacity="0.28" />
        <path d="M100 24l20 22-20 22-20-22z" />
        <path d="M100 24l20 22h-40z" fill="#fff" opacity="0.35" />
      </g>
    );
  }

  return (
    <g fill="currentColor">
      <rect x="58" y="52" width="84" height="70" rx="6" />
      <rect x="52" y="38" width="96" height="18" rx="5" />
      <rect x="93" y="38" width="14" height="84" fill="#fff" opacity="0.35" />
      <path d="M100 38c-8-14-26-12-26-2 0 6 12 6 26 2zM100 38c8-14 26-12 26-2 0 6-12 6-26 2z" fill="#fff" opacity="0.5" />
    </g>
  );
}

/* ══════════════════════════════════════════════
   ガチャの表紙
   ══════════════════════════════════════════════ */

/**
 * ガチャ1つ分の表紙。
 *
 * ★文字は入れないこと。
 *   絵の中に題名を焼き込むと、題名を変えたときに絵が嘘になります。
 *   題名は、絵の外にHTMLとして置きます。読み上げにも乗ります。
 */
export function CoverArt({
  id,
  kind,
  className = "",
}: {
  id: string;
  kind: ArtKind;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const tone = coverTone(id);
  const h = hashOf(id);
  const tilt = (h % 24) - 12;
  const cx = 40 + (h % 120);
  const cy = 20 + ((h >> 5) % 110);

  return (
    <svg
      viewBox="0 0 200 150"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`c${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone.from} />
          <stop offset="1" stopColor={tone.to} />
        </linearGradient>
        <radialGradient id={`g${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={tone.glow} stopOpacity="0.55" />
          <stop offset="1" stopColor={tone.glow} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="200" height="150" fill={`url(#c${uid})`} />
      <circle cx={cx} cy={cy} r="78" fill={`url(#g${uid})`} />

      {/* 光の筋。角度をIDで変えて、棚に同じ絵が並ばないようにする */}
      <g opacity="0.09" transform={`rotate(${tilt} 100 75)`}>
        <rect x="-40" y="-20" width="26" height="200" fill="#fff" />
        <rect x="10" y="-20" width="12" height="200" fill="#fff" />
        <rect x="150" y="-20" width="30" height="200" fill="#fff" />
      </g>

      <g opacity="0.16" stroke={tone.glow} fill="none" strokeWidth="1.5">
        <circle cx={cx} cy={cy} r="46" />
        <circle cx={cx} cy={cy} r="64" />
      </g>

      <g style={{ color: "#FFFFFF" }} opacity="0.92">
        <Silhouette kind={kind} />
      </g>
    </svg>
  );
}

/* ══════════════════════════════════════════════
   賞品そのものの絵
   ══════════════════════════════════════════════ */

/**
 * 等級つきの商品の絵。
 *
 * ★等級の文字を、絵の主役にしないこと。
 *   以前ここは「S」という文字が入った四角でした。
 *   それは商品ではなく、記号です。
 *   お客様が見たいのは「何が当たるのか」であって、
 *   アルファベットではありません。
 */
export function ProductArt({
  grade,
  kind,
  className = "",
}: {
  grade: string;
  kind: ArtKind;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const a = gradeArt(grade);

  return (
    <svg
      viewBox="0 0 200 150"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`p${uid}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={a.from} />
          <stop offset="1" stopColor={a.to} />
        </linearGradient>
      </defs>

      <rect width="200" height="150" fill={`url(#p${uid})`} />
      <g opacity="0.12">
        <path d="M-30 150L60-20h34L4 150z" fill="#fff" />
        <path d="M110 150L200-20h20v40l-70 130z" fill="#fff" />
      </g>

      <g style={{ color: a.ink }} opacity="0.85">
        <Silhouette kind={kind} />
      </g>
    </svg>
  );
}

/**
 * 一覧の行に置く、小さな四角の絵。
 *
 * 大きい絵と同じ形を使います。等級の色だけで見分けられるようにして、
 * 小さくても「これはさっき見たS賞だ」と分かるようにしています。
 */
export function ProductThumb({
  grade,
  kind,
  className = "",
}: {
  grade: string;
  kind: ArtKind;
  className?: string;
}) {
  const a = gradeArt(grade);
  return (
    <span
      className={`relative block overflow-hidden rounded-xl ${className}`}
      style={{ border: `1px solid ${a.line}` }}
    >
      <ProductArt grade={grade} kind={kind} className="h-full w-full" />
    </span>
  );
}

/**
 * 等級の札。
 *
 * ★色だけで等級を伝えないこと。
 *   色が見分けにくい方には、色は情報になりません。
 *   だから必ず文字（S賞・A賞…）を一緒に出します。
 */
export function GradeChip({
  grade,
  onDark = false,
  children,
}: {
  grade: string;
  /** 濃い背景の上に置くか */
  onDark?: boolean;
  children?: React.ReactNode;
}) {
  const a = gradeArt(grade);
  return (
    <span
      className="nb inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.72rem] font-bold"
      style={
        onDark
          ? { color: a.chip, border: `1px solid ${a.line}66`, background: "rgba(255,255,255,0.06)" }
          : { color: a.ink, background: a.from, border: `1px solid ${a.line}` }
      }
    >
      {children ?? a.label}
    </span>
  );
}
