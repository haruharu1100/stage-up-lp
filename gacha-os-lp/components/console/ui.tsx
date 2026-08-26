/**
 * 契約者向け管理画面の、共通部品。
 *
 * ═══════════════════════════════════════════════
 * ★見た目の方針
 * ═══════════════════════════════════════════════
 *
 *   白 / 薄いグレー / 薄いブルー / 濃紺 の4色だけで作ります。
 *   派手な色は「危ないとき」だけに取っておきます。
 *   毎日8時間見る画面なので、常に何かが光っている状態にしないこと。
 *
 *   3D・アニメーションは使いません。
 *   販売LPは「すごさ」を伝える場所ですが、ここは「仕事をする場所」です。
 *   動きは、押したものが反応する分だけで足ります。
 *
 * ★文字は 16px を下回らないこと。
 *   管理画面は情報量が多いので小さくしたくなりますが、
 *   毎日見る人の目が持ちません。詰めたいときは、項目を減らします。
 *
 * ★ここに「見た目だけの部品」を増やさないこと。
 *   状態は lib/console/state.ts に集めています。
 *   このファイルは、その状態を並べるための器だけを持ちます。
 */

"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import type { RiskLevel } from "@/lib/console/fraud";
import { LEVEL_STYLE } from "@/lib/console/fraud";

/* ══════════════════════════════════════════════
   枠
   ══════════════════════════════════════════════ */

export function Card({
  title,
  note,
  right,
  children,
  className = "",
}: {
  title?: string;
  note?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-edge bg-paper shadow-lift ${className}`}
    >
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[1.0625rem] font-bold tracking-tight text-slate">
                {title}
              </h2>
            )}
            {note && <p className="mt-1 text-note text-slate3">{note}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

/**
 * 「この画面で、いま何をするのか」を書く帯。
 *
 * ★全部の画面に必ず置くこと。
 *   初めて触る人は、項目名だけでは何をすればよいか分かりません。
 *   「REAL RTP」と書いてあっても、何を見て、どうなったら何をするのかは伝わりません。
 *
 * ★ただし、開いたままにしないこと。
 *   ここは17個の画面すべての先頭にあります。
 *   3行の説明を出しっぱなしにすると、どの画面でも
 *   いちばん良い場所（画面のいちばん上）を説明文が占めます。
 *   説明が要るのは最初の数日だけで、そのあとは毎日邪魔になります。
 *   だから、たたんだ1行に変え、押したときだけ開くようにしています。
 *
 * ★消して代わりにしないこと。
 *   「詰まったときに読む場所」が無いと、初めての人は手が止まります。
 *   たたむのと、無くすのは違います。
 *
 * ★summary の中に見出し（h1〜h6）を入れないこと。
 *   どの画面に着いたかを機械で確かめる仕掛けが、
 *   main の中の最初の見出しを画面名として読んでいます。
 */
export function WhatIsThis({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-blue-pale bg-blue-pale/50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-note font-bold text-blue-ink marker:content-none">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="nb">この画面ですること</span>
      </summary>
      <p className="border-t border-blue-pale px-5 py-4 text-note leading-[1.9] text-slate2">
        {children}
      </p>
    </details>
  );
}

/* ══════════════════════════════════════════════
   数字
   ══════════════════════════════════════════════ */

export function Stat({
  label,
  value,
  unit,
  tone = "normal",
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "normal" | "ok" | "warn" | "danger";
  sub?: string;
}) {
  const ink =
    tone === "danger" ? "text-danger-ink"
    : tone === "warn" ? "text-warn-ink"
    : tone === "ok" ? "text-ok-ink"
    : "text-slate";
  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      <p className="text-note font-medium text-slate3">{label}</p>
      <p className={`mt-1 flex items-baseline gap-1 ${ink}`}>
        <span className="num text-[1.75rem] font-bold tracking-tight tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {unit && <span className="text-note font-medium">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-note text-slate3">{sub}</p>}
    </div>
  );
}

/* ══════════════════════════════════════════════
   印
   ══════════════════════════════════════════════ */

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "blue";
}) {
  const style = {
    neutral: "border-edge bg-mist text-slate2",
    ok: "border-ok/30 bg-ok/10 text-ok-ink",
    warn: "border-warn/35 bg-warn/12 text-warn-ink",
    danger: "border-danger/30 bg-danger/10 text-danger-ink",
    blue: "border-blue-ink/20 bg-blue-pale text-blue-ink",
  }[tone];
  return (
    <span
      className={`nb inline-flex items-center rounded-full border px-3 py-1 text-note font-bold ${style}`}
    >
      {children}
    </span>
  );
}

/** 危険度の印。色と日本語の両方で出す（色だけに頼らない） */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const s = LEVEL_STYLE[level];
  return (
    <span
      className={`nb inline-flex items-center gap-2 rounded-full border px-3 py-1 text-note font-bold ${s.face} ${s.ink} ${s.edge}`}
    >
      <span className="num">{s.label}</span>
      <span className="opacity-70">{s.action}</span>
    </span>
  );
}

/* ══════════════════════════════════════════════
   ボタン
   ══════════════════════════════════════════════ */

export function Btn({
  children,
  onClick,
  kind = "normal",
  disabled,
  title,
  full,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "normal" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
  full?: boolean;
  type?: "button" | "submit";
}) {
  const style = {
    primary:
      "border-transparent bg-blue-ink text-white shadow-blue-lift hover:bg-blue-deep",
    normal: "border-edge bg-paper text-slate hover:bg-paper2",
    danger: "border-danger/30 bg-danger/10 text-danger-ink hover:bg-danger/16",
    ghost: "border-transparent bg-transparent text-slate2 hover:bg-mist",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`nb inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-note font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${style} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════
   入力
   ══════════════════════════════════════════════ */

export function Field({
  label,
  note,
  children,
  required,
}: {
  label: string;
  note?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-note font-bold text-slate2">
        {label}
        {required && <Badge tone="danger">必須</Badge>}
      </span>
      {note && <span className="mt-1 block text-note text-slate3">{note}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-silver bg-paper px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

/* ══════════════════════════════════════════════
   表
   ══════════════════════════════════════════════ */

/**
 * 表。
 *
 * ★スマホでは、表を横スクロールさせないこと。
 *   指で横に動かす表は、まず読まれません。
 *   狭いときは Row を積み重ねる形（下の Rows）に切り替えます。
 */
export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="hidden md:block">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-edge">
            {head.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-3 text-note font-bold text-slate3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`border-b border-edge2 px-3 py-3 align-top text-note text-slate2 ${className}`}>
      {children}
    </td>
  );
}

/**
 * 押せる行。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、1件1枚のカードをやめて、行にするのか
 * ═══════════════════════════════════════════════
 *
 *   1件を1枚のカードにすると、1件あたり150pxくらい使います。
 *   50件たまると7500px。画面7つ分を指で送ることになります。
 *   件数が多い仕事ほど「まず全体を見て、必要な1件を選ぶ」形が要ります。
 *
 *   だから、一覧は行で詰めて、詳しい中身と操作は
 *   右から出す板（Drawer）に寄せます。
 *   一覧が短くなるほど、探す時間が減ります。
 *
 * ★行そのものを押せるようにすること。
 *   行の右端に「詳細」ボタンを置く形は、
 *   目的の行を見つけたあと、もう一度その行の右端まで
 *   目とマウスを動かす必要があります。1件なら些細ですが、
 *   50件やると効いてきます。
 *
 * ★キーボードでも押せること。
 *   マウスが使えない場面（手が塞がる・故障）で、
 *   一覧が丸ごと使えなくなるのを避けます。
 */
export function Tr({
  children,
  onOpen,
  active = false,
  tone,
}: {
  children: ReactNode;
  onOpen?: () => void;
  active?: boolean;
  tone?: "warn" | "danger";
}) {
  const bg =
    active ? "bg-blue-pale"
    : tone === "danger" ? "bg-danger/6"
    : tone === "warn" ? "bg-warn/6"
    : "";

  if (!onOpen) return <tr className={bg}>{children}</tr>;

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`cursor-pointer outline-none transition-colors hover:bg-mist focus-visible:bg-blue-pale focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-ink ${bg}`}
    >
      {children}
    </tr>
  );
}

/**
 * 右から出す板。一覧を離れずに、1件の中身を見て、操作まで終える。
 *
 * ═══════════════════════════════════════════════
 * ★別ページに飛ばさない理由
 * ═══════════════════════════════════════════════
 *
 *   発送も問い合わせも「次の1件、その次の1件」と続く仕事です。
 *   1件ごとに別ページへ行くと、戻るたびに一覧が先頭に戻り、
 *   どこまで見たか分からなくなります。
 *   一覧を残したまま中身を出せば、続きから再開できます。
 *
 * ★Esc で閉じられること。
 *   閉じ方が「×を押す」しか無い画面は、毎日使うと必ず嫌われます。
 *
 * ★背景を押しても閉じること。ただし、閉じる以外は起こさないこと。
 *   誤って背景の行を押して、別の件を開いてしまうと、
 *   「さっき見ていた件がどれか分からない」が起きます。
 */
export function Drawer({
  open,
  title,
  note,
  onClose,
  foot,
  children,
}: {
  open: boolean;
  title: string;
  note?: string;
  onClose: () => void;
  foot?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-navy/35"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-[30rem] flex-col border-l border-edge bg-paper shadow-float"
      >
        <header className="flex flex-none items-start justify-between gap-3 border-b border-edge2 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[1.0625rem] font-bold tracking-tight text-slate">
              {title}
            </h2>
            {note && <p className="mt-1 text-note text-slate3">{note}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nb shrink-0 rounded-lg border border-edge bg-paper2 px-3 py-1.5 text-note font-bold text-slate2 transition-colors hover:bg-mist"
          >
            閉じる
          </button>
        </header>

        {/* ★高さを数字で見積もらないこと。
              上下の帯を flex-none にして、真ん中に残りを配ります。 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {children}
        </div>

        {foot && (
          <footer className="flex flex-none flex-wrap gap-2 border-t border-edge2 bg-paper2 px-5 py-4">
            {foot}
          </footer>
        )}
      </aside>
    </div>
  );
}

/** スマホ用。1件を1枚のカードで積む */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="space-y-3 md:hidden">{children}</div>;
}

export function RowCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      {children}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="text-note text-slate3">{k}</span>
      <span className="text-note font-medium text-slate2">{v}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════
   注意書き
   ══════════════════════════════════════════════ */

/**
 * デモであることの断り書き。
 *
 * ★消さないこと。
 *   本物の決済・メール送信・SMS送信・配送業者・本番データベースには
 *   一切つながっていません。それを書かずに本物らしく見せるのは、
 *   お客様に嘘をつくのと同じです。
 */
export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
      <span className="mr-2 font-bold">デモ</span>
      {children}
    </p>
  );
}

/**
 * 「この画面の数字は、まだどこにもつながっていません」を、
 * いちばん上で、いちばん先に言うための印。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、下ではなく上に置くのか（2026-08-26、公開先の総点検）
 * ═══════════════════════════════════════════════════════
 *
 *   断り書きは、これまで画面のいちばん下に置いていました。
 *   文章は正しく、嘘も書いていません。
 *
 *   ですが、人は上から読みます。
 *   そして、数字を見た時点で判断を終えます。
 *
 *       上：「この7日間の売上 949,500円」
 *       …（グラフ、表、内訳）…
 *       下：「ここに出ている数字は、すべて架空です」
 *
 *   下まで読む人は、上の数字を疑った人だけです。
 *   疑わなかった人は、架空の売上を本物として持ち帰ります。
 *   商談の場なら、その場で「すごいですね」と言われて終わります。
 *
 *   ★断り書きは、数字より先に出すこと。
 *     後から出す断り書きは、断り書きではなく言い訳です。
 *
 * ★つながったら、この印を消すこと。
 *   消し忘れると、今度は本物の数字が「架空です」と言われます。
 *   それは、もっと悪いです。
 */
export function NotConnected({
  what,
  children,
}: {
  /** 何がつながっていないのか（例：「相場の取り込み」） */
  what: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-warn/50 bg-warn/10 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-warn-ink px-2 py-1 text-[11px] font-bold tracking-wide text-white">
          未接続（見本のデータ）
        </span>
        <span className="text-note font-bold text-warn-ink">{what}</span>
      </div>
      <p className="mt-2 text-note leading-[1.9] text-warn-ink">
        この画面に出ている数字は、
        <strong className="font-bold">すべて架空の見本</strong>
        です。実際の売上・在庫・相場ではありません。
        {children ? <> {children}</> : null}
      </p>
    </div>
  );
}

/** まだ作っていない機能を、作ってあるように見せないための印 */
export function Planned({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-silver bg-paper2 px-4 py-4">
      <Badge>今後対応予定</Badge>
      <p className="mt-2 text-note leading-[1.85] text-slate3">{children}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════
   3つの状態（空 / 読み込み中 / 失敗）
   ══════════════════════════════════════════════ */

/**
 * 何も無いときの表示。
 *
 * ═══════════════════════════════════════════════
 * ★「0件」とだけ出すことを禁止します
 * ═══════════════════════════════════════════════
 *
 *   画面に「0件」とだけ出ていると、見た人はこう思います。
 *
 *       ・まだ届いていないのか
 *       ・絞り込みが効きすぎているのか
 *       ・そもそも壊れているのか
 *
 *   この3つは、やることが全部ちがいます。
 *   なのに画面は、どれなのかを教えてくれません。
 *   結局その人は、人を呼びます。「これ、合ってます？」
 *
 *   だから、空のときは必ず2つ書きます。
 *
 *       why  … なぜ空なのか（正常なのか、異常なのか）
 *       next … 次に何をすればいいのか
 *
 *   ★why は省略できません。型で必須にしてあります。
 *     「あとで書く」は、永久に書かれません。
 *     書く場所が無ければ、書かない言い訳ができてしまいます。
 */
export function Empty({
  why,
  next,
}: {
  why: string;
  next?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-silver bg-paper2 px-5 py-8 text-center">
      <p className="text-note font-bold leading-[1.85] text-slate">{why}</p>
      {next && (
        <div className="mt-3 text-note leading-[1.85] text-slate3">{next}</div>
      )}
    </div>
  );
}

/**
 * 読み込み中の表示。
 *
 * ★真っ白にしないこと。
 *   真っ白は「壊れた」と見分けがつきません。
 *   これから何が出るのか、形だけ先に見せます。
 *
 * ★くるくる回すだけにしないこと。
 *   回転は「動いている」ことしか伝えません。
 *   出てくる形が先に見えていれば、
 *   目は届く前から置き場所を覚えられます。
 */
export function Skeleton({
  rows = 3,
  label = "読み込んでいます",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {/* 目が見えない方には、形ではなく言葉で伝える */}
      <span className="sr-only">{label}</span>

      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-xl border border-edge2 bg-paper2 px-4 py-4"
          aria-hidden="true"
        >
          <div className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-silver" />
          <div className="h-4 flex-1 animate-pulse rounded bg-silver" />
          <div className="hidden h-4 w-24 animate-pulse rounded bg-silver sm:block" />
        </div>
      ))}
    </div>
  );
}

/**
 * 失敗したときの表示。
 *
 * ═══════════════════════════════════════════════
 * ★「エラーが発生しました」だけで終わらせないこと
 * ═══════════════════════════════════════════════
 *
 *   その1行は、受け取った人に何もできることを残しません。
 *   必要なのは、次の3つです。
 *
 *       ・何をしようとして失敗したのか（what）
 *       ・もう一度試せるのか（onRetry）
 *       ・直らないとき、誰に何を伝えればいいのか（code）
 *
 *   ★code（識別子）を必ず出すこと。
 *     電話口で「エラーが出ました」と言われても、調べようがありません。
 *     短い記号が1つあれば、記録から一発で引けます。
 */
export function ErrorBox({
  what,
  code,
  onRetry,
}: {
  what: string;
  code?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-danger/30 bg-danger/10 px-5 py-5"
      role="alert"
    >
      <p className="text-note font-bold leading-[1.85] text-danger-ink">{what}</p>

      <p className="mt-2 text-note leading-[1.85] text-slate3">
        通信が途切れたか、こちら側で処理に失敗しました。
        お客様側の画面や、保存されているデータは変わっていません。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {onRetry && (
          <Btn onClick={onRetry} kind="primary">
            もう一度ためす
          </Btn>
        )}
        {code && (
          <span className="text-note text-slate3">
            直らないときは、この記号をお伝えください：
            <code className="ml-1 rounded bg-paper2 px-2 py-1 font-mono text-slate">
              {code}
            </code>
          </span>
        )}
      </div>
    </div>
  );
}
