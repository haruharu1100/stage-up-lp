/**
 * AliExpress のAPI応答から数値・文字列を「安全に」受け取るための関門。
 * ===================================================================
 * なぜ必要か（ユーザー指示・2026-08-20）
 *   「Keepaで今回発生したのと同じ問題をAliExpressでも想定してください。
 *     -1 / null / 空文字 / 特殊コード / 存在しない価格 / 0円 / 異常な通貨 / 異常MOQ
 *     などを計算へ流さない。」
 *
 * Keepaで実際に起きたこと（再発させない）
 *   ・`-1`＝不明／`-2`＝カートが立っていない、を負の数で表すのに `=== -1` しか見ておらず、
 *     **「-2円」が販売価格として利益計算に流れ込んでいた**。
 *   ・寸法・重量を `p.packageWeight || null` で受けており、
 *     **`-1` は truthy なので素通り**し、マイナスの重量がFBA手数料の計算に入っていた。
 *
 * ★ここでの鉄則
 *   1. **0以下は原則すべて UNKNOWN**（null）。「0円の商品」は存在しないものとして扱う。
 *   2. **`||` で受けない。** `-1 || null` は `-1` を通してしまう。必ずこの関数を通す。
 *   3. 通貨・MOQ・重量には**現実的な上限**を置き、桁が違う値を弾く。
 *   4. 弾いた事実は捨てずに数え、`npm run aliexpress:audit` で見えるようにする。
 */

/** 弾いた理由の種類。監査で内訳を出すために使う */
export type ValueRejectReason =
  | 'NULL_OR_MISSING'
  | 'EMPTY_STRING'
  | 'NOT_A_NUMBER'
  | 'NEGATIVE'
  | 'ZERO'
  | 'SENTINEL'
  | 'OUT_OF_RANGE'
  | 'UNKNOWN_CURRENCY';

export const VALUE_REJECT_LABEL: Record<ValueRejectReason, string> = {
  NULL_OR_MISSING: '項目そのものが返ってこなかった',
  EMPTY_STRING: '空っぽの文字列だった',
  NOT_A_NUMBER: '数字として読めない値だった',
  NEGATIVE: 'マイナスの値だった（不明を表す特殊値の可能性）',
  ZERO: '0だった（0円・在庫0個は「不明」と区別して扱う）',
  SENTINEL: '「不明」を表す特殊な値だった（-1 / -2 / 9999999 など）',
  OUT_OF_RANGE: '現実的にありえない大きさだった',
  UNKNOWN_CURRENCY: '知らない通貨だった',
};

/** 「不明」を表すためによく使われる特殊値 */
const SENTINELS = new Set([-1, -2, -99, -999, 9999999, 99999999, 999999999]);

/** 弾いた件数を数えるための入れ物。監査スクリプトが読む */
export interface ValueGuardTally {
  field: string;
  accepted: number;
  rejected: number;
  byReason: Partial<Record<ValueRejectReason, number>>;
  samples: string[];
}

export class ValueGuard {
  private tallies = new Map<string, ValueGuardTally>();

  /**
   * 弾いた値を「そのまま」何件まで控えておくか。
   *
   * ★なぜ設定できるようにするか
   *   20件テストで20件とも弾かれた場合、5件しか控えていないと
   *   「残り15件がどんな値だったのか」を誰も確認できない。
   *   件数が少ない検証のときは全部控えたいので、呼ぶ側から決められるようにする。
   *   （本番の大量処理では既定の5件のまま。ログが無限に膨らまないようにするため）
   */
  constructor(private readonly maxSamples: number = 5) {}

  private tally(field: string): ValueGuardTally {
    let t = this.tallies.get(field);
    if (!t) {
      t = { field, accepted: 0, rejected: 0, byReason: {}, samples: [] };
      this.tallies.set(field, t);
    }
    return t;
  }

  private accept(field: string): void {
    this.tally(field).accepted++;
  }

  private reject(field: string, reason: ValueRejectReason, raw: unknown): null {
    const t = this.tally(field);
    t.rejected++;
    t.byReason[reason] = (t.byReason[reason] ?? 0) + 1;
    // ★控えるのは「APIが返したそのままの値」。丸めも換算もしない。
    //   弾いた理由だけ残して値を捨てると、仕様の読み違いを後から検証できない。
    if (t.samples.length < this.maxSamples) t.samples.push(JSON.stringify(raw ?? null));
    return null;
  }

  report(): ValueGuardTally[] {
    return [...this.tallies.values()].sort((a, b) => b.rejected - a.rejected);
  }

  /**
   * 数値を安全に受け取る。
   * ★`0` は既定で拒否する（0円の仕入値・0gの重量を計算に入れない）。
   *   在庫のように「本当に0がありうる」ものだけ allowZero を立てる。
   */
  num(
    field: string,
    raw: unknown,
    opts: { min?: number; max?: number; allowZero?: boolean } = {},
  ): number | null {
    const { min = 0, max = Number.MAX_SAFE_INTEGER, allowZero = false } = opts;

    if (raw === null || raw === undefined) return this.reject(field, 'NULL_OR_MISSING', raw);
    if (typeof raw === 'string' && raw.trim() === '') return this.reject(field, 'EMPTY_STRING', raw);

    /**
     * ★数値でも文字列でもないものは、ここで「読めなかった」として弾く。
     *
     *   これを入れる前は、入れ子（例：`{ "amount": "12.34" }`）が渡ると
     *   String() で "[object Object]" になり、数字を抜き出すと空になり、
     *   最終的に **「0だった」** として記録されていた。
     *
     *   理由の書き間違いは、監査する人を間違った場所へ誘導する：
     *     「0円だった」→ 商品側を見に行く（実際には商品は正常）
     *     「読めない形だった」→ 項目の構造を見に行く（こちらが正しい）
     *   弾いた事実だけでなく **弾いた理由も正確でなければ**、ログを残す意味が薄れる。
     */
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      return this.reject(field, 'NOT_A_NUMBER', raw);
    }

    // "12.34" や "1,234" のような文字列も受ける（カンマは桁区切りとして除去）
    const cleaned = typeof raw === 'number' ? null : String(raw).replace(/,/g, '').replace(/[^\d.\-]/g, '');
    // 数字が1文字も残らなかった＝「0」ではなく「読めなかった」
    if (cleaned !== null && cleaned.trim() === '') return this.reject(field, 'NOT_A_NUMBER', raw);
    const n = typeof raw === 'number' ? raw : Number(cleaned);

    if (!Number.isFinite(n)) return this.reject(field, 'NOT_A_NUMBER', raw);
    if (SENTINELS.has(n)) return this.reject(field, 'SENTINEL', raw);
    if (n < 0) return this.reject(field, 'NEGATIVE', raw);
    if (n === 0 && !allowZero) return this.reject(field, 'ZERO', raw);
    if (n < min || n > max) return this.reject(field, 'OUT_OF_RANGE', raw);

    this.accept(field);
    return n;
  }

  /** 文字列を安全に受け取る。空文字・"null"・"undefined" は不明として扱う */
  text(field: string, raw: unknown, maxLen = 500): string | null {
    if (raw === null || raw === undefined) return this.reject(field, 'NULL_OR_MISSING', raw);
    const s = String(raw).trim();
    if (!s) return this.reject(field, 'EMPTY_STRING', raw);
    if (s === 'null' || s === 'undefined' || s === 'N/A' || s === '-') {
      return this.reject(field, 'SENTINEL', raw);
    }
    this.accept(field);
    return s.slice(0, maxLen);
  }

  /**
   * 商品価格。
   * ★上限を置く理由：桁を取り違えた値（例：セント単位のまま）が
   *   そのまま利益計算に入ると、赤字商品を黒字と判定してしまうため。
   */
  price(field: string, raw: unknown): number | null {
    return this.num(field, raw, { min: 0.01, max: 10_000_000 });
  }

  /** 通貨コード。知らない通貨は換算できないので不明にする */
  currency(field: string, raw: unknown): string | null {
    const s = this.text(field, raw, 8);
    if (!s) return null;
    const up = s.toUpperCase();
    if (!/^[A-Z]{3}$/.test(up)) return this.reject(field, 'UNKNOWN_CURRENCY', raw);
    return up;
  }

  /**
   * MOQ（最低注文数）。
   * ★1未満はありえない。10万個を超えるMOQも現実的でないので弾く。
   */
  moq(field: string, raw: unknown): number | null {
    const n = this.num(field, raw, { min: 1, max: 100_000 });
    if (n === null) return null;
    return Math.round(n);
  }

  /** 在庫。★ここだけは 0 を本物の値として認める（0個＝売り切れ、は事実） */
  stock(field: string, raw: unknown): number | null {
    const n = this.num(field, raw, { min: 0, max: 100_000_000, allowZero: true });
    if (n === null) return null;
    return Math.round(n);
  }

  /** 重量(g)。1g未満・500kg超は弾く（FBA手数料の計算が狂うため） */
  weightG(field: string, raw: unknown): number | null {
    return this.num(field, raw, { min: 1, max: 500_000 });
  }

  /**
   * 画像URL。http(s) でなければ使わない。
   * ★`//img.alicdn.com/...` のようなスキーム省略形は https を補う（これは推測ではなく仕様上の省略）。
   */
  imageUrl(field: string, raw: unknown): string | null {
    const s = this.text(field, raw, 1000);
    if (!s) return null;
    const url = s.startsWith('//') ? `https:${s}` : s;
    if (!/^https?:\/\//i.test(url)) return this.reject(field, 'SENTINEL', raw);
    return url;
  }

  /**
   * ★購入ページURL（PURCHASE_URL）。
   *   ユーザー指示：「人間がクリックして実際に購入ページへ行けるURLを必須にしてください」
   *   「根拠なくURLを作らない。URL確認できない商品はAランク禁止。」
   *
   *   そのため **APIが返したURLだけを受け取る。** 商品IDから組み立てることはしない。
   *   受け取るのは aliexpress.com ドメインのものだけ（別サイトへ飛ばさないため）。
   */
  purchaseUrl(field: string, raw: unknown): string | null {
    const s = this.text(field, raw, 1000);
    if (!s) return null;
    const url = s.startsWith('//') ? `https:${s}` : s;
    if (!/^https?:\/\//i.test(url)) return this.reject(field, 'SENTINEL', raw);
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return this.reject(field, 'NOT_A_NUMBER', raw);
    }
    if (!/(^|\.)aliexpress\.(com|ru|us)$/.test(host)) {
      return this.reject(field, 'OUT_OF_RANGE', raw);
    }
    return url;
  }
}

/* ===================================================================
 * ★RAW値（APIの生値）を、加工せずそのまま取り出すための道具
 * ===================================================================
 * ユーザー指示（2026-08-24・確定）：
 *   「AliExpress初回LIVE商品取得時に、APIが返した価格・通貨の生値と、
 *     システム解釈後の値を必ず並べて表示してください。
 *     RAW値は加工・丸め・換算禁止です。」
 *
 * ★なぜ上の ValueGuard と分けるのか
 *   ValueGuard は「安全に使える形へ直す」道具なので、必ず値を変える。
 *     ・"12.34"（文字列）→ 12.34（数値）
 *     ・"usd" → "USD"
 *     ・"1,234" → 1234
 *   直したあとの値しか残っていないと、Keepaで実際に起きたような
 *   「そもそも読む項目名を間違えていた」「-2 を価格として読んでいた」を
 *   後から誰も検証できない。
 *   だからここでは **一切直さない**。JSON表記のまま文字にして残すだけ。
 * ------------------------------------------------------------------- */

/** RAW値を1つ取り出した結果 */
export interface RawPick {
  /** 実際に値が入っていた項目名。どれにも入っていなければ null */
  field: string | null;
  /**
   * ★生値。JSON.stringify した文字列そのまま。
   *   文字列なら引用符ごと（"12.34"）、数値なら数値のまま（12.34）残る。
   *   引用符の有無で「文字列で来たのか数値で来たのか」が判る。
   */
  raw: string | null;
}

/**
 * 候補の項目名を上から順に見て、最初に値が入っていたものを **加工せず** 返す。
 *
 * ★探す順番は、システム側が解釈に使う順番と必ず同じにすること。
 *   順番がずれると「RAWと解釈後が別の項目を指している」ことになり、
 *   並べて見せる意味が無くなる。
 */
export function pickRaw(item: unknown, keys: string[]): RawPick {
  if (!item || typeof item !== 'object') return { field: null, raw: null };
  const obj = item as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined) continue; // `??` と同じ扱い
    return { field: k, raw: JSON.stringify(v) };
  }
  return { field: null, raw: null };
}

/**
 * 応答に含まれていた「価格・通貨らしき項目」を、選ばなかったものも含めて全部そのまま集める。
 *
 * ★なぜ選ばなかった項目まで残すのか
 *   Keepa の事故は「値の読み違い」だけでなく「拾う項目そのものを間違えていた」ことが原因だった。
 *   採用した1つだけを残すと、その間違いは監査で絶対に見つからない。
 *   例：本当は税込の targetSalePrice を使うべき場面で originalPrice を拾っていた、など。
 */
export function collectRawFields(
  item: unknown,
  match: RegExp = /price|currency|amount|cost|discount|fee/i,
): { field: string; raw: string }[] {
  if (!item || typeof item !== 'object') return [];
  const obj = item as Record<string, unknown>;
  const out: { field: string; raw: string }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!match.test(k)) continue;
    if (v !== null && typeof v === 'object') continue; // 入れ子は request の原文側に残るので割愛
    out.push({ field: k, raw: JSON.stringify(v ?? null) });
  }
  return out.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * RAW値と解釈後の値で「文字としての中身が変わったか」を言う。
 *
 * ★これは合否判定ではない。人が監査するときに目を止める場所を示すだけ。
 *
 * ★引用符の有無（文字列で来たか数値で来たか）だけの違いは、変化と見なさない。
 *   "12.34" → 12.34 は、ただ型が変わっただけで数字は1つも動いていない。
 *   これを毎回警告にすると、正常な商品でも必ず警告が出ることになり、
 *   本当に見るべき次のような変化が埋もれてしまう。
 *     ・"1,234.50" → 1234.5  （カンマの解釈が入っている）
 *     ・"usd" → "USD"        （大文字化している）
 *     ・-2 → UNKNOWN         （システムが弾いた＝Keepaで起きた事故と同型）
 *   型が変わったこと自体は、表示側で引用符ごと見えるので隠れない。
 */
export function rawDiffers(raw: string | null, interpreted: unknown): boolean {
  if (raw === null) return interpreted !== null && interpreted !== undefined;
  if (interpreted === null || interpreted === undefined) return true;
  const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
  return unquote(raw) !== unquote(JSON.stringify(interpreted));
}

/**
 * ★購入ページURLを受け取る（集計なしの単体版）。
 *   ユーザー指示：「根拠なくURLを作らない。URL確認できない商品はAランク禁止。」
 *
 *   ここを通らないURLは **null**（＝UNKNOWN）。
 *   商品IDから `https://www.aliexpress.com/item/<id>.html` のように**組み立てない**。
 *   組み立てたURLは「たぶん合っている」だけで、実際に開けるかを誰も確認していないため。
 */
export function acceptPurchaseUrl(raw: unknown): string | null {
  return acceptUrlOnHosts(raw, /(^|\.)aliexpress\.(com|ru|us)$/);
}

/**
 * ★仕入先ごとの「購入ページURL」を受け取る共通の関門。
 *   ユーザー指示：「根拠なくURLを作らない。URL確認できない商品はAランク禁止。」
 *
 *   ここも **APIが返したURLだけ** を受け取る。商品IDから組み立てることはしない。
 *   さらに、その仕入先のドメインでなければ捨てる。
 *   （別サイトや `javascript:` のような細工されたURLをボタンに載せないため）
 */
export function acceptUrlOnHosts(raw: unknown, allowedHost: RegExp): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === 'null' || s === 'undefined' || s === '-') return null;
  const url = s.startsWith('//') ? `https:${s}` : s;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!allowedHost.test(host)) return null;
  } catch {
    return null;
  }
  return url;
}

/** Alibaba.com（ICBU）の商品ページだけを認める */
export const ALIBABA_HOSTS = /(^|\.)alibaba\.com$/;
/** Yahoo!ショッピングの商品ページだけを認める（市場調査用・仕入先ではない） */
export const YAHOO_SHOPPING_HOSTS = /(^|\.)(yahoo\.co\.jp|shopping\.yahoo\.co\.jp|paypaymall\.yahoo\.co\.jp)$/;

/**
 * ★「何件中、何件が異常な価格だったのか」だけを取り出して言う。
 * ===================================================================
 * 5件・20件テストで見たいのは、1件ずつの良し悪しではなく **偏り**。
 *   「20件中3件だけ価格が特殊値だった」
 * のような形が早く分かれば、本番へ広げる前に仕様の読み違いへ気付ける。
 *
 * ★全体の取得率に混ぜない。
 *   「20件中17件は取れました（85%）」だけ見せると、
 *   残り3件が -1 や 0円 だったという肝心の事実が薄まって消える。
 *
 * ★取れなかった件数を「0件」と言い換えない。理由の内訳をそのまま出す。
 */
export function describePriceAnomalies(
  tallies: ValueGuardTally[],
  field = 'salePrice',
): string[] {
  const t = tallies.find((x) => x.field === field);
  if (!t) return [`  価格：まだ1件も検査していません（「異常0件」ではありません）`];
  const total = t.accepted + t.rejected;
  if (!total) return [`  価格：まだ1件も検査していません（「異常0件」ではありません）`];
  if (!t.rejected) return [`  価格：${total}件すべて正常に受け取れました（弾いた値は0件）`];

  const out: string[] = [];
  out.push(`  ★価格：${total}件中 ${t.rejected}件を弾きました（受け取れたのは ${t.accepted}件）`);
  for (const [reason, n] of Object.entries(t.byReason)) {
    out.push(`      ${VALUE_REJECT_LABEL[reason as ValueRejectReason]}：${n}件`);
  }
  // ★弾いた値を「そのまま」出す。ここが読み違いを見つける唯一の手がかり。
  out.push(`      弾いた値そのもの（無加工）：${t.samples.join(' , ')}`);
  if (t.rejected === total) {
    out.push('      ★全件を弾いています。値がおかしいのではなく、こちらの読み方が違う可能性が高い');
  }
  return out;
}

/**
 * 「全件が同じ理由で弾かれた」項目を洗い出す。
 *
 * ★なぜ止める材料になるのか（2026-08-25 ユーザー指示・確定）
 *   「『全件同じ特殊値』の場合は商品データ異常ではなく、
 *     API仕様の読み違い候補として止める」
 *
 *   1件だけ -1 なら、その商品の在庫が本当に不明なだけ、はありうる。
 *   だが20件が20件とも -1 なら、商品側の問題ではありえない。
 *   ほぼ確実に **こちらが見に行く項目名か単位を間違えている**。
 *   ここで止めずに先へ進むと、間違った読み方のまま件数だけ増える。
 *
 * @returns 止めるべき項目の一覧（空なら止める理由なし）
 */
export function findAllSameRejections(
  tallies: ValueGuardTally[],
): { field: string; reason: ValueRejectReason; count: number; samples: string[] }[] {
  const out: { field: string; reason: ValueRejectReason; count: number; samples: string[] }[] = [];
  for (const t of tallies) {
    // 1件でも取れていれば「全件同じ」ではない
    if (t.accepted !== 0 || t.rejected < 2) continue;
    const reasons = Object.keys(t.byReason) as ValueRejectReason[];
    if (reasons.length !== 1) continue;
    out.push({ field: t.field, reason: reasons[0], count: t.rejected, samples: t.samples });
  }
  return out;
}

/**
 * 監査結果を日本語のレポートにする（`npm run aliexpress:audit` が使う）。
 */
export function describeGuardReport(tallies: ValueGuardTally[]): string[] {
  const lines: string[] = [];
  for (const t of tallies) {
    const total = t.accepted + t.rejected;
    if (!total) continue;
    const pct = total ? Math.round((t.accepted / total) * 100) : 0;
    lines.push(`  ${t.field.padEnd(20)} 取得${t.accepted}件／弾いた${t.rejected}件（取得率${pct}%）`);
    for (const [reason, n] of Object.entries(t.byReason)) {
      lines.push(`      ${VALUE_REJECT_LABEL[reason as ValueRejectReason]}：${n}件`);
    }
    if (t.samples.length) lines.push(`      弾いた値の例：${t.samples.join(' , ')}`);
  }
  return lines;
}
