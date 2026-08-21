/**
 * LP CONTENT EDITOR の土台。
 *
 * ★これは何のためにあるか
 *   サイトの文章と改行を、コードを触らずに直せるようにするための仕組みです。
 *   直せるのは「文章・改行・その項目を出すか出さないか」だけ。
 *   金額の計算・還元率の計算・バックテスト・セキュリティ・APIには一切触れません。
 *   （触らせないために、編集できる項目をこのファイルの一覧で固定しています）
 *
 * ★PC用とスマホ用で改行を別々に持てる
 *   日本語は、画面幅によって「意味の切れ目」が変わります。
 *   PCで気持ちよく2行になる文章が、スマホでは4行に割れて読みにくくなる。
 *   そこで pc / sp の2つを持ち、狭い画面では sp を出します。
 *   sp が空なら pc をそのまま使います（ふだんは pc だけ書けば十分）。
 *
 * ★改行はそのまま反映する
 *   編集画面で押した Enter が、そのまま画面の改行になります。
 *   「改行そのものがデザイン」なので、ブラウザ任せにしません。
 *
 * ★なぜ JSON を直接 import しているのか
 *   この値は「お客様に見える画面」で使うので、サーバー側でもブラウザ側でも
 *   同じ値でなければいけません（食い違うと React が警告を出します）。
 *   ファイル読み込み（fs）はブラウザで動かないため、
 *   ビルドに含まれる JSON を読む形にしています。
 *   保存すると JSON が書き換わり、次の公開（ビルド）で反映されます。
 */

import store from "@/content/lp-content.json";

/* ────────────────────────────────────────────────
   型
   ──────────────────────────────────────────────── */

/** その文章が画面のどんな役割か。編集画面の並び順と説明に使う */
export type LpKind =
  | "heading" // 見出し
  | "sub" // サブ見出し
  | "body" // 本文
  | "cta" // ボタンの文字
  | "faq-q" // FAQ の質問
  | "faq-a" // FAQ の回答
  | "note"; // 注記

export const KIND_LABEL: Record<LpKind, string> = {
  heading: "見出し",
  sub: "サブ見出し",
  body: "本文",
  cta: "ボタンの文字",
  "faq-q": "FAQ の質問",
  "faq-a": "FAQ の回答",
  note: "注記",
};

export type LpField = {
  /** 保存用の名前。★一度決めたら変えないこと（変えると編集内容が迷子になります） */
  id: string;
  /** 編集画面でのまとまり。ページの上から順に並べます */
  group: string;
  /** 何の文章かが、初めて見た人にも分かる名前 */
  label: string;
  kind: LpKind;
  /** コード側にある元の文章。編集していないときはこれが出ます */
  fallback: string;
  /** 表示するかしないかを切り替えられる項目か */
  canHide?: boolean;
  /** 編集画面での注意書き */
  hint?: string;
};

/** 1項目ぶんの編集内容 */
export type LpValue = {
  /** PC用（広い画面）。空ならコード側の元の文章 */
  pc?: string;
  /** スマホ用（640px未満）。空なら pc と同じ */
  sp?: string;
  /** true なら画面に出さない */
  hidden?: boolean;
};

export type LpAction = "draft" | "publish" | "revert";

export type LpHistoryEntry = {
  /** いつ（ISO文字列） */
  at: string;
  /** 誰が（編集画面で入力した名前） */
  by: string;
  /** 何をしたか */
  action: LpAction;
  /** 変えた項目の id */
  changed: string[];
  /** そのときの中身まるごと。ここから元に戻します */
  snapshot: Record<string, LpValue>;
};

export type LpStore = {
  draft: Record<string, LpValue>;
  published: Record<string, LpValue>;
  history: LpHistoryEntry[];
};

/* ────────────────────────────────────────────────
   編集できる項目の一覧
   ★ここに無いものは編集できません。
     計算・価格ロジック・セキュリティ・API・バックテストを
     文章の編集から触れないようにするための壁です。
   ──────────────────────────────────────────────── */

export const LP_FIELDS: readonly LpField[] = [
  /* ── ファーストビュー ── */
  {
    id: "hero.headline",
    group: "ファーストビュー",
    label: "いちばん大きな見出し",
    kind: "heading",
    fallback: "",
    hint: "改行の位置がそのまま出ます。スマホ用は意味の切れ目で短く割ってください。",
  },
  {
    id: "hero.sub",
    group: "ファーストビュー",
    label: "見出しの下の説明",
    kind: "sub",
    fallback: "",
  },
  {
    id: "hero.badge",
    group: "ファーストビュー",
    label: "見出しの上の小さなラベル",
    kind: "note",
    fallback: "",
    canHide: true,
    hint: "誰に向けたサイトかを一言で。長くすると折り返して形が崩れます。",
  },

  /* ── スマホ下部の固定バー ── */
  {
    id: "mobilecta.primary",
    group: "スマホ下部のボタン",
    label: "主ボタンの文字",
    kind: "cta",
    fallback: "",
    hint: "短くしてください。長いと2行に折れてバーが高くなり、本文が隠れます。",
  },
  {
    id: "mobilecta.secondary",
    group: "スマホ下部のボタン",
    label: "副ボタンの文字",
    kind: "cta",
    fallback: "",
  },
  {
    id: "mobilecta.pricing",
    group: "スマホ下部のボタン",
    label: "料金リンクの文字",
    kind: "cta",
    fallback: "料金を見る",
    canHide: true,
  },

  /* ── 最後の相談セクション ── */
  {
    id: "contact.heading",
    group: "相談セクション",
    label: "見出し",
    kind: "heading",
    fallback: "",
  },
  {
    id: "contact.lead",
    group: "相談セクション",
    label: "見出しの下の説明",
    kind: "body",
    fallback: "",
  },
  {
    id: "contact.submit",
    group: "相談セクション",
    label: "送信ボタンの文字",
    kind: "cta",
    fallback: "",
  },
  {
    id: "contact.note",
    group: "相談セクション",
    label: "送信ボタンの下の注記",
    kind: "note",
    fallback: "",
    canHide: true,
  },

  /* ── FAQ ── */
  ...Array.from({ length: 11 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return [
      {
        id: `faq.${i}.q`,
        group: "よくいただく質問",
        label: `Q${n} 質問`,
        kind: "faq-q" as const,
        fallback: "",
        canHide: true,
        hint: "非表示にすると、この質問と回答の両方が消えます。",
      },
      {
        id: `faq.${i}.a`,
        group: "よくいただく質問",
        label: `A${n} 回答`,
        kind: "faq-a" as const,
        fallback: "",
      },
    ];
  }).flat(),
];

const FIELD_BY_ID = new Map(LP_FIELDS.map((f) => [f.id, f]));

export function lpField(id: string): LpField | undefined {
  return FIELD_BY_ID.get(id);
}

/** 編集画面の並び順（ページの上から） */
export const LP_GROUPS: readonly string[] = Array.from(
  new Set(LP_FIELDS.map((f) => f.group)),
);

/* ────────────────────────────────────────────────
   いま公開されている中身
   ──────────────────────────────────────────────── */

export const publishedContent = (store as LpStore).published ?? {};

/**
 * 画面に出す文章を決める。
 *
 * @param id       LP_FIELDS の id
 * @param fallback コード側の元の文章
 */
export function lpText(
  id: string,
  fallback: string,
  values: Record<string, LpValue> = publishedContent,
): { pc: string; sp: string; hidden: boolean } {
  const v = values[id];
  const pc = v?.pc?.trim() ? v.pc : fallback;
  const sp = v?.sp?.trim() ? v.sp : pc;
  return { pc, sp, hidden: v?.hidden === true };
}

/**
 * 検索エンジンや読み上げに渡す用の、改行を取り除いた1行の文章。
 * ★構造化データ（JSON-LD）には必ずこちらを使うこと。
 *   改行や見えない記号がそのまま入ると、検索結果の表示が壊れます。
 */
export function lpPlain(
  id: string,
  fallback: string,
  values: Record<string, LpValue> = publishedContent,
): string {
  const { pc } = lpText(id, fallback, values);
  return pc.replace(/\s*\n\s*/g, " ").trim();
}

/** 2つの中身を比べて、変わった項目の id を返す */
export function lpDiff(
  a: Record<string, LpValue>,
  b: Record<string, LpValue>,
): string[] {
  const ids = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  const out: string[] = [];
  for (const id of ids) {
    if (JSON.stringify(a[id] ?? {}) !== JSON.stringify(b[id] ?? {})) out.push(id);
  }
  return out.sort();
}

/**
 * 保存してよい形だけを通す。
 * ★編集画面から来たものをそのまま信じないこと。
 *   一覧に無い id、長すぎる文章、余計な項目は、ここで落とします。
 */
export const LP_MAX_LEN = 1200;

export function sanitizeValues(input: unknown): Record<string, LpValue> {
  const out: Record<string, LpValue> = {};
  if (!input || typeof input !== "object") return out;
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!FIELD_BY_ID.has(id)) continue;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const v: LpValue = {};
    for (const k of ["pc", "sp"] as const) {
      const s = r[k];
      if (typeof s !== "string") continue;
      // 改行はそのまま残す。改行コードだけ揃える
      const t = s.replace(/\r\n?/g, "\n").slice(0, LP_MAX_LEN);
      if (t.trim()) v[k] = t;
    }
    if (r.hidden === true) {
      const f = FIELD_BY_ID.get(id);
      if (f?.canHide) v.hidden = true;
    }
    if (Object.keys(v).length > 0) out[id] = v;
  }
  return out;
}
