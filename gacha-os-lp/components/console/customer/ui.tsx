/**
 * お客様側の、共通の部品。
 *
 * ═══════════════════════════════════════════════════════
 * ★管理画面の部品を、そのまま持ってこないこと
 * ═══════════════════════════════════════════════════════
 *
 *   管理画面は、明るい紙の上に細かい表を敷き詰める作りです。
 *   一日じゅう同じ画面を見る人には、それが正解です。
 *
 *   お客様側は違います。
 *   ほとんどの方は、スマホで、片手で、数十秒だけ見ます。
 *   だから、
 *     ・1画面に、大きく1つのこと
 *     ・押せるものは、指の幅（44px以上）で作る
 *     ・状態は、色だけでなく必ず文字でも書く
 *   の3つを、この部品側で強制します。
 *
 *   画面ごとに好きな大きさで書けるようにすると、
 *   必ずどこかに「指では押せない小さなボタン」が生まれます。
 *   生まれたことに、作った本人は最後まで気づけません。
 *
 * ═══════════════════════════════════════════════════════
 * ★暗い面での「読めない」を作らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   暗い背景に、彩度の高い細い文字を置くと、
 *   作っている画面では読めても、明るい屋外では消えます。
 *   注意・警告の文字は、必ず淡い側（明るい文字色）に寄せます。
 */

"use client";

import type { Prize } from "@/lib/console/state";
import { PRIZE_STATUS_LABEL } from "@/lib/console/state";
import { ProductThumb, ProductArt, artKindOf } from "./art";
import { SHOP_ACCENT, SHOP_EDGE, SHOP_GOLD, SHOP_SURFACE } from "./Storefront";

/* ══════════════════════════════════════════════
   色（暗い面）
   ══════════════════════════════════════════════ */

/**
 * 注意の度合い。
 *
 * ★「危険＝赤」だけで済ませないこと。
 *   赤が見分けにくい方が、男性の20人に1人います。
 *   だから、色と一緒に必ず言葉を出す作りにしてあります。
 */
export const TONE = {
  ok: { fg: "#7EE2B8", bg: "rgba(52,211,153,0.10)", line: "rgba(52,211,153,0.34)" },
  warn: { fg: "#F2D07A", bg: "rgba(234,179,8,0.10)", line: "rgba(234,179,8,0.34)" },
  danger: { fg: "#FFA4A4", bg: "rgba(239,68,68,0.10)", line: "rgba(239,68,68,0.34)" },
  info: { fg: "#A9C6FF", bg: "rgba(91,140,255,0.10)", line: "rgba(91,140,255,0.34)" },
  quiet: { fg: "rgba(255,255,255,0.62)", bg: "rgba(255,255,255,0.05)", line: SHOP_EDGE },
} as const;

export type ToneKey = keyof typeof TONE;

/* ══════════════════════════════════════════════
   骨組み
   ══════════════════════════════════════════════ */

/**
 * もどる。
 *
 * ★行き先を、必ず書くこと。
 *   「←」だけの矢印は、どこへ戻るのかが分かりません。
 *   分からないと、押すのをやめて、代わりにブラウザの戻るを押します。
 *   ブラウザの戻るは、この画面の中では想定していない動きをします。
 */
export function Back({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nb -ml-1 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[0.84rem] font-bold text-white/65 transition hover:text-white"
    >
      <span aria-hidden>‹</span> {label}
    </button>
  );
}

export function H({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[1.2rem] font-bold leading-snug tracking-tight text-white">
        {children}
      </h2>
      {sub && <p className="mt-1.5 text-[0.8rem] leading-[1.9] text-white/55">{sub}</p>}
    </div>
  );
}

/** 暗い面の「カード」。中身の余白まで、ここで決めきる */
export function Panel({
  children,
  className = "",
  pad = true,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div
      className={[pad ? "rounded-2xl px-4 py-4" : "rounded-2xl", className].join(" ")}
      style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
    >
      {children}
    </div>
  );
}

/** 注意書き。★色だけで伝えない。文章そのものに理由を書く */
export function Note({
  tone = "info",
  children,
}: {
  tone?: ToneKey;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <p
      className="rounded-xl px-4 py-3 text-[0.79rem] leading-[1.9]"
      style={{ background: t.bg, border: `1px solid ${t.line}`, color: t.fg }}
    >
      {children}
    </p>
  );
}

/** 何も無いときの表示。★空白のまま出さないこと */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-2xl px-4 py-8 text-center text-[0.85rem] leading-[1.9] text-white/50"
      style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
    >
      {children}
    </p>
  );
}

/* ══════════════════════════════════════════════
   ボタン
   ══════════════════════════════════════════════ */

/**
 * 大きなボタン。
 *
 * ★高さを詰めないこと。
 *   指で押すものです。詰めると、隣を押します。
 *   お金が動く画面での押し間違いは、そのまま事故になります。
 *
 * ★押せない理由を、必ず note に書くこと。
 *   灰色のまま反応しないボタンは、壊れているのと見分けがつきません。
 */
export function BigBtn({
  children,
  onClick,
  tone = "primary",
  note,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "second" | "quiet" | "danger";
  note?: string;
  disabled?: boolean;
}) {
  const style: React.CSSProperties =
    tone === "primary"
      ? { background: SHOP_ACCENT, color: "#06101F" }
      : tone === "second"
        ? { background: "transparent", color: "#BFD4FF", border: `2px solid ${SHOP_ACCENT}` }
        : tone === "danger"
          ? { background: "rgba(239,68,68,0.12)", color: "#FFA4A4", border: "2px solid rgba(239,68,68,0.45)" }
          : { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.75)", border: `1px solid ${SHOP_EDGE}` };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={style}
      className="w-full rounded-2xl px-5 py-4 text-[0.98rem] font-bold transition active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      {note && <span className="mt-1 block text-[0.74rem] font-medium opacity-85">{note}</span>}
    </button>
  );
}

/* ══════════════════════════════════════════════
   獲得商品まわり
   ══════════════════════════════════════════════ */

/**
 * 獲得商品の絵。
 *
 * ★「S」の1文字だけを四角に入れたものを、商品の絵と呼ばないこと。
 *   お客様が受け取ったのは文字ではありません。
 *   何が当たったのかが一目で分かる絵にします（art.tsx）。
 *
 * ★絵は、当たったガチャの種類から決めること。
 *   カードのガチャならカード、時計のガチャなら時計です。
 *   全部同じ箱の絵にすると、一覧が見分けられなくなります。
 */
export function PrizeArt({
  p,
  size = "lg",
}: {
  p: Pick<Prize, "grade" | "gachaTitle">;
  size?: "lg" | "sm";
}) {
  const kind = artKindOf(p.gachaTitle);
  return size === "lg" ? (
    <ProductArt grade={p.grade} kind={kind} className="h-28 w-28 shrink-0" />
  ) : (
    <ProductThumb grade={p.grade} kind={kind} className="h-16 w-16 shrink-0" />
  );
}

const STATUS_TONE: Record<Prize["status"], ToneKey> = {
  UNCHOSEN: "warn",
  SHIP_REQUESTED: "info",
  EXCHANGED: "quiet",
};

export function StatusChip({ status }: { status: Prize["status"] }) {
  const t = TONE[STATUS_TONE[status]];
  return (
    <span
      className="nb inline-block rounded-full px-2.5 py-1 text-[0.71rem] font-bold"
      style={{ background: t.bg, border: `1px solid ${t.line}`, color: t.fg }}
    >
      {PRIZE_STATUS_LABEL[status]}
    </span>
  );
}

/* ══════════════════════════════════════════════
   小物
   ══════════════════════════════════════════════ */

/** 項目名と値の1行 */
export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-white/50">{k}</dt>
      <dd className="num text-right font-bold text-white/90">{v}</dd>
    </div>
  );
}

/** 入力欄。★ラベルを placeholder で代用しないこと（入力すると消えます） */
export function Fld({
  label,
  value,
  onChange,
  hint,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  inputMode?: "text" | "numeric" | "tel";
}) {
  return (
    <label className="block">
      <span className="block text-[0.78rem] font-bold text-white/60">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl px-3 py-3.5 text-[0.95rem] text-white outline-none transition"
        style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${SHOP_EDGE}` }}
        onFocus={(e) => (e.currentTarget.style.borderColor = SHOP_ACCENT)}
        onBlur={(e) => (e.currentTarget.style.borderColor = SHOP_EDGE)}
      />
      {hint && <span className="mt-1 block text-[0.72rem] leading-[1.75] text-white/40">{hint}</span>}
    </label>
  );
}

/** 押せる大きな行（数字つき） */
export function TapRow({
  label,
  note,
  value,
  unit,
  onClick,
  tone,
}: {
  label: string;
  note: string;
  value: number;
  unit: string;
  onClick: () => void;
  tone?: ToneKey;
}) {
  const t = tone ? TONE[tone] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-4 text-left transition active:scale-[0.995]"
      style={{
        background: t ? t.bg : SHOP_SURFACE,
        border: `1px solid ${t ? t.line : SHOP_EDGE}`,
      }}
    >
      <span className="min-w-0">
        <span className="block text-[0.88rem] font-bold" style={{ color: t ? t.fg : "#FFFFFF" }}>
          {label}
        </span>
        <span className="mt-1 block text-[0.74rem] leading-[1.8] text-white/50">{note}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-1">
        <span className="num text-[1.5rem] font-bold leading-none text-white">
          {value.toLocaleString()}
        </span>
        <span className="text-[0.73rem] font-bold text-white/50">{unit}</span>
        <span className="ml-1 text-[1.05rem]" style={{ color: SHOP_ACCENT }} aria-hidden>
          ›
        </span>
      </span>
    </button>
  );
}

export { SHOP_ACCENT, SHOP_EDGE, SHOP_GOLD, SHOP_SURFACE };
