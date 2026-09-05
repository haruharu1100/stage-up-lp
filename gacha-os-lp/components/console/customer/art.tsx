/**
 * お客様側の絵と、商品の写真。
 *
 * ═══════════════════════════════════════════════════════
 * ★2026-09-05：本物の売り場から「描いた絵」を外しました
 * ═══════════════════════════════════════════════════════
 *
 *   それまで、ガチャの絵は題名の文字から機械が描いていました。
 *   題名に「カード」とあればカードの形、「時計」とあれば時計の形です。
 *
 *   よくできた仕組みでした。権利の心配が無く、画像ファイルも要らず、
 *   新しいガチャが増えた瞬間から、ちゃんと絵が付きました。
 *
 *   ★ですが、お客様がお金を払って引くのは「実物」です。
 *
 *   題名から描いた絵は、実物ではありません。似せた形にすぎません。
 *   それを商品の顔として並べて売れば、優良誤認になりかねません。
 *   「カードだと思って引いたのに、絵とは違うものが届いた」は、
 *   こちらに悪気が無くても、お客様にはそう見えます。
 *
 *   だから、本物の売り場に出すのは、お店が撮った写真だけにします。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルには、2種類のものが入っています
 * ═══════════════════════════════════════════════════════
 *
 *   【本物の売り場に使うもの】
 *     ShopPhoto / PrizePhoto / PrizeThumb
 *     お店が登録した写真を出します。
 *     写真が無いときは、それらしい絵を描かず「画像未登録」と書きます。
 *
 *   【営業用の見本（/client-demo）だけに使うもの】
 *     SampleCoverArt / SampleProductArt / SampleProductThumb
 *     名前が Sample で始まるものは、すべて「描いた絵」です。
 *
 *   ★Sample で始まるものを、本物の売り場へ持ち込まないこと。
 *     持ち込むと、この日に外したものが、そのまま戻ります。
 *     戻ったことは、画面を見ても分かりません。絵はきれいに出るからです。
 *     だから、人の目ではなく機械で止めます
 *     （scripts/check-real-art.mjs）。
 *
 * ═══════════════════════════════════════════════════════
 * ★描いた絵を、なぜ消さずに残すのか
 * ═══════════════════════════════════════════════════════
 *
 *   営業用の見本には、まだ必要だからです。
 *   見本は、これからお店を始める方にお見せするものです。
 *   そこに実在の商品写真を貼れば「その商品が当たる」と読めてしまい、
 *   それこそ景表法の話になります。
 *
 *   見本は架空の店なので、架空の絵で正しいのです。
 *   本物の店は、実物の写真で正しい。用途が違うだけです。
 */

"use client";

import type React from "react";
import { useId, useState } from "react";

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
   ★本物の売り場に出すもの（お店が登録した写真）
   ══════════════════════════════════════════════ */

/**
 * 写真が無いときに出す板。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで「それらしい絵」を描かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   空欄はかっこ悪いので、つい何かを描きたくなります。
 *   ですが、描いた瞬間に、それは実物ではない絵になります。
 *   お客様は「これが当たる」と読みます。優良誤認です。
 *
 *   だから、ここは何も描きません。
 *   「画像未登録」と、事実だけを書きます。
 *   かっこ悪いのは、お店が写真を入れれば直ります。
 *   嘘は、入れても直りません。
 */
function NoPhoto({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center bg-slate-100 text-center text-[0.7rem] font-medium text-slate-500 ${className}`}
    >
      画像未登録
    </span>
  );
}

/**
 * 写真を1枚出す。土台。
 *
 * ★読み込みに失敗したときも「画像未登録」に戻すこと。
 *   壊れた画像のアイコンが出ると、お店の不備なのか
 *   通信の不調なのか、お客様には区別が付きません。
 *   どちらにせよ「今はお見せできる写真がない」が事実です。
 */
function Photo({
  imageId,
  alt,
  className = "",
}: {
  imageId: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!imageId || failed) return <NoPhoto className={className} />;

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/api/images/${imageId}`}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * ガチャの表紙の写真。
 *
 * ★alt を空にしないこと。
 *   目で見られない方には、この文字だけが商品の説明になります。
 */
export function ShopPhoto({
  imageId,
  alt,
  className = "",
}: {
  imageId: string | null | undefined;
  alt: string;
  className?: string;
}) {
  return <Photo imageId={imageId} alt={alt} className={className} />;
}

/**
 * 賞品の写真。
 *
 * ★等級の色は、写真の外側の枠にだけ使うこと。
 *   写真の上に色を重ねると、実物の色が変わって見えます。
 *   「届いたものが写真と色が違う」は、一番言われたくない苦情です。
 */
export function PrizePhoto({
  imageId,
  grade,
  alt,
  className = "",
}: {
  imageId: string | null | undefined;
  grade: string;
  alt: string;
  className?: string;
}) {
  const a = gradeArt(grade);
  return (
    <span
      className={`relative block overflow-hidden ${className}`}
      style={{ border: `1px solid ${a.line}` }}
    >
      <Photo imageId={imageId} alt={alt} className="h-full w-full object-cover" />
    </span>
  );
}

/** 一覧の行に置く、小さな写真。 */
export function PrizeThumb({
  imageId,
  grade,
  alt,
  className = "",
}: {
  imageId: string | null | undefined;
  grade: string;
  alt: string;
  className?: string;
}) {
  return (
    <PrizePhoto
      imageId={imageId}
      grade={grade}
      alt={alt}
      className={`rounded-xl ${className}`}
    />
  );
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
export function SampleCoverArt({
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
export function SampleProductArt({
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
export function SampleProductThumb({
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
      <SampleProductArt grade={grade} kind={kind} className="h-full w-full" />
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
