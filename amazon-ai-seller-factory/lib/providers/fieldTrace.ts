/**
 * 1商品の1項目を「①元レスポンス → ②正規化後 → ③画面表示値」の3段で追跡する道具。
 *
 * ===================================================================
 * ★なぜ作るか（2026-08-25 ユーザー指示・確定）
 * ===================================================================
 *   「1商品取得時は、APIから返った元レスポンス → 正規化後 → 画面表示値を
 *     3段で並べて比較する」
 *   「UNKNOWN / NULL / NOT_AVAILABLE / 特殊値 / 0 / 実数 を
 *     完全に別状態として扱う」
 *   「価格だけでなく、送料・在庫・通貨・画像・URL・ASIN/商品IDも
 *     同じ1件について追跡する」
 *   「値を変換した場合は、元値・変換ルール・変換後を残す」
 *   「取得できなかった項目があれば、商品全体を『正常取得』と表示しない」
 *
 * ★2段（生値⇔解釈後）では足りない理由
 *   解釈までは正しくても、画面へ渡す途中で落ちる・丸まる・別項目と入れ替わる
 *   ことがある。①と③だけ見ても、どこで壊れたのかが分からない。
 *   3段そろって初めて「読み違い」と「受け渡しミス」を切り分けられる。
 *
 * ★「取れなかった」を1つの言葉にまとめない理由
 *   `-1`（相手が「不明」の意味で返した）と
 *   `null`（項目はあるが空）と
 *   項目そのものが無い、は **原因も対処も全く違う**。
 *   ひとまとめに「UNKNOWN」と書くと、次に何を直せばよいか誰も分からない。
 *   ここが Keepa で実際に事故った場所なので、状態を分けて数える。
 * ------------------------------------------------------------------- */

/**
 * 項目1つの状態。★これらは互いに別物として扱う（まとめない）。
 *
 *   REAL / ZERO          … 値が取れた（ZERO は「0という事実」であって不明ではない）
 *   SENTINEL             … 相手が「不明」の意味で入れた特殊値
 *   NOT_AVAILABLE        … 相手が「無い」と文字で明記した
 *   NULL / MISSING       … 空だった／項目そのものが無かった
 *   UNREADABLE           … 値はあるが、こちらが解釈できなかった
 */
export type FieldState =
  | 'REAL'
  | 'ZERO'
  | 'SENTINEL'
  | 'NOT_AVAILABLE'
  | 'NULL'
  | 'MISSING'
  | 'UNREADABLE';

export const FIELD_STATE_LABEL: Record<FieldState, string> = {
  REAL: '実数／実値（正常に取れた）',
  ZERO: '0（本当に0が返ってきた。「不明」ではない）',
  SENTINEL: '特殊値（-1 / -2 / 9999999 など「不明」を表す値）',
  NOT_AVAILABLE: 'NOT_AVAILABLE（"N/A" "-" "null" など、無いと明記されていた）',
  NULL: 'NULL（項目はあったが中身が空だった）',
  MISSING: 'MISSING（項目そのものが応答に無かった）',
  UNREADABLE: 'UNKNOWN（値はあるが、こちらが解釈できなかった）',
};

/**
 * NULL と MISSING を分ける理由：
 *   NULL   → 相手が「この商品には値が無い」と言っている（商品側の話）
 *   MISSING→ こちらが見に行く項目名を間違えている可能性（仕様の読み違い）
 *   直す場所が違うので、同じ言葉にしない。
 */

/** 「不明」を表すためによく使われる特殊値（ValueGuard と同じ並び） */
const SENTINEL_NUMBERS = new Set([-1, -2, -99, -999, 9999999, 99999999, 999999999]);

/** 「無い」と文字で書いてある表現。ここに入るものは 0 でも空でもなく NOT_AVAILABLE */
const NOT_AVAILABLE_TEXT = new Set([
  '', 'null', 'undefined', 'n/a', 'n.a.', 'na', '-', '--', 'none', 'nil',
  'not available', 'notavailable', 'unknown', '不明', 'なし',
]);

export interface FieldTrace {
  /** 日本語の項目名（画面に出す名前） */
  label: string;
  /** 探しに行った候補キー。全部外れたら「項目名の読み違い」を疑う材料になる */
  keys: string[];
  /** 実際に値を採った項目名 */
  rawField: string | null;
  /** ① 元レスポンス。★JSON表記のまま。丸め・換算・大文字化を一切しない */
  raw: string | null;
  /** 状態（上の7種） */
  state: FieldState;
  /** 変換ルール。無変換なら null */
  transform: string | null;
  /** ② 正規化後 */
  normalized: string | null;
  /** ③ 画面表示値 */
  displayed: string;
  /** 「取れた」と言ってよいか（REAL / ZERO かつ正規化に成功） */
  ok: boolean;
}

/** 前後の引用符だけ外す（JSON表記かどうかの情報を残したいので、これ以外は触らない） */
function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** 候補キーの中から、値が入っているものを優先して1つ選ぶ */
function findKey(
  item: unknown,
  keys: string[],
): { field: string | null; present: boolean; value: unknown } {
  if (!item || typeof item !== 'object') return { field: null, present: false, value: undefined };
  const obj = item as Record<string, unknown>;
  // 1周目：中身が入っているキー
  for (const k of keys) {
    if (k in obj && obj[k] !== null && obj[k] !== undefined) {
      return { field: k, present: true, value: obj[k] };
    }
  }
  // 2周目：キーはあるが空（NULL と MISSING を分けるために必要）
  for (const k of keys) {
    if (k in obj) return { field: k, present: true, value: obj[k] };
  }
  return { field: null, present: false, value: undefined };
}

/** 文字列・数値のどちらで来ても、数として読めるなら数にする（判定用。保存はしない） */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 生値と正規化結果から、7状態のどれかを決める */
export function classifyField(present: boolean, value: unknown, normalized: unknown): FieldState {
  if (!present) return 'MISSING';
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string' && NOT_AVAILABLE_TEXT.has(value.trim().toLowerCase())) {
    return 'NOT_AVAILABLE';
  }
  const n = asNumber(value);
  if (n !== null && SENTINEL_NUMBERS.has(n)) return 'SENTINEL';
  if (n === 0) return 'ZERO';
  if (normalized === null || normalized === undefined) return 'UNREADABLE';
  return 'REAL';
}

/**
 * 値を変換したなら、どのルールで変えたのかを言葉にする。
 * ★「変換した」だけでは監査にならない。何をしたのかまで残す。
 *   どのルールにも当てはまらない変換は ★付きで出す（そこが一番危ない）。
 */
export function describeTransform(raw: string | null, normalized: unknown): string | null {
  if (raw === null || normalized === null || normalized === undefined) return null;
  const rawStr = unquote(raw);
  const normStr = String(normalized);
  if (rawStr === normStr) return null;

  const rules: string[] = [];
  const wasQuoted = raw.startsWith('"') && raw.endsWith('"');
  if (wasQuoted && typeof normalized === 'number') rules.push('文字列→数値');
  if (rawStr.includes(',') && !normStr.includes(',')) rules.push('桁区切りのカンマを除去');
  if (rawStr !== rawStr.trim() && rawStr.trim() === normStr) rules.push('前後の空白を除去');
  if (rawStr.toUpperCase() === normStr && rawStr.toUpperCase() !== rawStr) rules.push('小文字→大文字');
  if (rawStr.startsWith('//') && normStr === `https:${rawStr}`) {
    rules.push('省略されたスキームに https: を補完');
  }
  if (typeof normalized === 'number' && Number.isInteger(normalized) && rawStr.includes('.')) {
    rules.push('小数を四捨五入して整数化');
  }
  if (rawStr.length > normStr.length && rawStr.startsWith(normStr)) rules.push('長さ上限で切り詰め');
  if (!rules.length) rules.push('★どのルールにも当てはまらない変換（最優先で確認する）');
  return rules.join(' ＋ ');
}

/**
 * 1項目を3段で追跡する。
 *
 * @param normalized ValueGuard を通したあとの値（取れなければ null）
 * @param displayed  実際に画面／DBへ出す値。省略時は normalized をそのまま使う
 */
export function traceField(opts: {
  label: string;
  item: unknown;
  keys: string[];
  normalized: unknown;
  displayed?: unknown;
}): FieldTrace {
  const { label, item, keys, normalized } = opts;
  const found = findKey(item, keys);
  const raw = found.present && found.value !== undefined ? JSON.stringify(found.value ?? null) : null;
  const state = classifyField(found.present, found.value, normalized);
  const displayedValue = 'displayed' in opts ? opts.displayed : normalized;

  return {
    label,
    keys,
    rawField: found.field,
    raw,
    state,
    transform: describeTransform(raw, normalized),
    normalized: normalized === null || normalized === undefined ? null : String(normalized),
    displayed:
      displayedValue === null || displayedValue === undefined
        ? '取れませんでした＝UNKNOWN'
        : String(displayedValue),
    ok: (state === 'REAL' || state === 'ZERO') && normalized !== null && normalized !== undefined,
  };
}

/** 3段を人が読める形に並べる */
export function renderFieldTrace(traces: FieldTrace[]): string[] {
  const out: string[] = [];
  for (const t of traces) {
    out.push(`    ${t.label}`);
    out.push(
      `      ① 元レスポンス   ${(t.rawField ?? `（候補 ${t.keys.join(' / ')} のどれも無し）`).padEnd(26)}` +
        ` = ${t.raw ?? '（値なし）'}`,
    );
    out.push(`         状態          ${FIELD_STATE_LABEL[t.state]}`);
    out.push(`      ② 正規化後       ${t.normalized ?? '（正規化できず＝UNKNOWN）'}`);
    out.push(`         変換ルール    ${t.transform ?? '（無変換。生値のまま）'}`);
    out.push(`      ③ 画面表示値     ${t.displayed}`);
  }
  return out;
}

/**
 * 3段の中で「人が止まって見るべき不整合」を洗い出す。
 * ★ここが1件でもあるうちは5件テストへ進まない（ユーザー指示・確定）。
 */
export function traceProblems(traces: FieldTrace[]): string[] {
  const out: string[] = [];
  for (const t of traces) {
    if (!t.ok) {
      out.push(`${t.label}：${FIELD_STATE_LABEL[t.state]} → 推測で埋めず UNKNOWN のままにした`);
    }
    if (t.transform?.startsWith('★')) {
      out.push(`${t.label}：${t.raw} → ${t.normalized} の変換理由を説明できない（${t.transform}）`);
    }
    // ②と③がずれる＝解釈は合っていたのに、画面へ渡す途中で壊れている
    if (t.normalized !== null && t.displayed !== t.normalized) {
      out.push(`${t.label}：正規化後「${t.normalized}」と画面表示値「${t.displayed}」が一致しない`);
    }
  }
  return out;
}

/** 追跡した項目が全部そろったか。1つでも欠ければ「正常取得」と表示してはいけない */
export function isFullyCaptured(traces: FieldTrace[]): boolean {
  return traces.length > 0 && traces.every((t) => t.ok);
}

/** 状態ごとの件数。5件・20件で「欠損率・特殊値率」を出すときにも使う */
export function countStates(traces: FieldTrace[]): Record<FieldState, number> {
  const base: Record<FieldState, number> = {
    REAL: 0, ZERO: 0, SENTINEL: 0, NOT_AVAILABLE: 0, NULL: 0, MISSING: 0, UNREADABLE: 0,
  };
  for (const t of traces) base[t.state]++;
  return base;
}
