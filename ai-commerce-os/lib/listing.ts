/**
 * 画面（ブラウザ側）からも読める、出品追跡の「言葉と決まりごと」だけを集めたファイル。
 *
 * 【なぜ lib/observation.ts から分けたか】
 * observation.ts はデータベースを触るので `node:crypto` / `node:path` を抱えている。
 * それをブラウザ側の部品から読み込むとビルドが通らない（lib/conditions.ts と同じ理由）。
 * 状態の名前・日本語訳・追跡予定・工程名は画面でも使うので、ここだけ切り出してある。
 *
 * **このファイルには外部依存を一切書かないこと。** 書いた瞬間に画面が壊れる。
 */
// ============================================================
// 出品の状態（§8）
// ============================================================

/**
 * ユーザー指示そのままの5状態。増やすときは「観測できるか」で判断する。
 * 観測できないもの（例：SOLD_PROBABLY）は作らない。推測を状態にしない。
 */
export const LISTING_STATES = [
  'ACTIVE', 'CONFIRMED_SOLD', 'REMOVED_UNKNOWN', 'PRICE_CHANGED', 'UNKNOWN',
] as const;
export type ListingState = (typeof LISTING_STATES)[number];

export const LISTING_STATE_JA: Record<ListingState, string> = {
  ACTIVE: 'まだ出品中',
  CONFIRMED_SOLD: '売り切れを実際に確認した',
  REMOVED_UNKNOWN: 'ページが見当たらない（売れたかどうかは不明）',
  PRICE_CHANGED: '出品中だが価格が変わった',
  UNKNOWN: '確認できていない',
};

/** 状態をどう決めたか。人が見たのか、こちらが計算したのかを必ず残す。 */
export type StateSource = 'HUMAN_INPUT' | 'DERIVED_PRICE_DIFF' | 'MISSING_INPUT';

export const STATE_SOURCE_JA: Record<StateSource, string> = {
  HUMAN_INPUT: '人が画面を見て記録した',
  DERIVED_PRICE_DIFF: '前回の観測と価格が違うので「価格が変わった」と判定した',
  MISSING_INPUT: '記入が無いので「確認できていない」とした',
};

/**
 * 人が書いた言葉 → 状態。
 *
 * 【ここが一番事故りやすい】
 * 「消えた」「ない」「404」を売れた扱いにしてはいけない。
 * 表を見れば分かるように、消えた系はすべて REMOVED_UNKNOWN へ落としてある。
 */
const STATE_WORDS: { words: string[]; state: ListingState }[] = [
  {
    state: 'CONFIRMED_SOLD',
    // 「売り切れ」という表示を実際に画面で見た場合だけ。
    words: ['sold', 'soldout', 'sold_out', 'confirmedsold', '売り切れ', '売切れ', '売切', '完売', 'sold済', '購入済'],
  },
  {
    state: 'REMOVED_UNKNOWN',
    // 消えた・見つからない系。売れたかどうかは分からない。
    words: ['removed', 'deleted', 'gone', 'notfound', '404', 'removedunknown',
      '削除', '消えた', '見つからない', '無くなった', 'なくなった', 'ページなし', '非公開', '取り下げ'],
  },
  {
    state: 'ACTIVE',
    words: ['active', 'onsale', 'listed', 'available', '出品中', '販売中', '掲載中', 'あり', '継続'],
  },
  {
    state: 'PRICE_CHANGED',
    words: ['pricechanged', '価格変更', '値下げ', '値上げ', '価格が変わった'],
  },
  {
    state: 'UNKNOWN',
    words: ['unknown', '不明', '未確認', 'わからない'],
  },
];

/**
 * 表記ゆれを潰すための小さな整形。
 * `lib/normalize.ts` の `cleanText` を使いたいところだが、あちらは `node:crypto` を抱えていて
 * ブラウザ側にバンドルできない。ここは外部依存ゼロを守るため、必要な分だけ書き写してある。
 */
export function canon(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_\-　]/g, '');
}

/** URL用の最小限の整形（全角空白を潰して前後を落とすだけ）。 */
function cleanText(s: string | undefined | null): string {
  if (!s) return '';
  return String(s).replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 書かれた状態を読み取る。読み取れなければ null（＝推測しない）。
 * 「消えた＝売れた」への転落を防ぐため、判定順は 売り切れ → 消えた → 出品中 の固定順にしない。
 * 完全一致→部分一致の順で、最初に当たったものを返す。
 */
export function parseListingState(raw: string | null | undefined): ListingState | null {
  const c = canon(String(raw ?? ''));
  if (c === '') return null;
  for (const g of STATE_WORDS) if (g.words.some((w) => canon(w) === c)) return g.state;
  for (const g of STATE_WORDS) if (g.words.some((w) => c.includes(canon(w)))) return g.state;
  return null;
}

// ============================================================
// 追跡の予定（§6）
// ============================================================

/**
 * ユーザー指示の追跡タイミング：初回 → 24時間後 → 3日後 → 7日後 → 14日後 → 30日後。
 * 「だいたい1週間後」ではなく時間で持つ。あとで「7日目の答え合わせ」を機械が選べるようにするため。
 */
export const TRACK_CHECKPOINTS = [
  { code: 'INITIAL', hours: 0, ja: '初回' },
  { code: 'H24', hours: 24, ja: '24時間後' },
  { code: 'D3', hours: 72, ja: '3日後' },
  { code: 'D7', hours: 168, ja: '7日後' },
  { code: 'D14', hours: 336, ja: '14日後' },
  { code: 'D30', hours: 720, ja: '30日後' },
] as const;

export type CheckpointCode = (typeof TRACK_CHECKPOINTS)[number]['code'] | 'EXTRA';

/** 許容幅。7日目ちょうどに見られるわけがないので、前後で受け止める。 */
const CHECKPOINT_TOLERANCE_HOURS: Record<string, number> = {
  INITIAL: 6, H24: 12, D3: 24, D7: 36, D14: 60, D30: 96,
};

/**
 * 初回からの経過時間を、いちばん近い予定に割り当てる。
 * どの予定にも当てはまらなければ `EXTRA`（予定外の観測）。捨てずに残す。
 */
export function checkpointFor(elapsedHours: number): CheckpointCode {
  let best: CheckpointCode = 'EXTRA';
  let bestGap = Infinity;
  for (const c of TRACK_CHECKPOINTS) {
    const gap = Math.abs(elapsedHours - c.hours);
    if (gap <= (CHECKPOINT_TOLERANCE_HOURS[c.code] ?? 24) && gap < bestGap) {
      best = c.code;
      bestGap = gap;
    }
  }
  return best;
}

export function checkpointJa(code: string): string {
  const f = TRACK_CHECKPOINTS.find((c) => c.code === code);
  return f ? f.ja : '予定外の観測';
}

// ============================================================
// URLの正規化
// ============================================================

/**
 * 同じ出品を同じものとして数えるための鍵。
 * 広告用のパラメータ（?afid=... など）が付くだけで別物になると、追跡が途切れる。
 */
export function listingKeyOf(url: string): string | null {
  const raw = cleanText(url);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * §4「最初の必須は 商品名 / 価格 / 状態 / URL / 確認日時 程度に」への答え。
 *
 * 初回（そのURLが未登録）のときだけ 商品名・価格・状態 を必須にし、
 * 2回目以降は URL・確認日時・状態 だけで受け付ける。
 * 追跡のたびに商品名を書き写させるのは、ただの苦行で、間違いも増える。
 */
export const REQUIRED_FIRST = ['product_url', 'observed_at', 'product_name', 'listing_price', 'condition'];
export const REQUIRED_FOLLOWUP = ['product_url', 'observed_at', 'sold_status'];


// ============================================================
// 人間の作業時間（§19 §20）
// ============================================================

/**
 * 工程。ここを細かくしすぎると計測そのものが面倒になって続かないので5つに絞る。
 */
export const WORK_STEPS = [
  { code: 'FIND', ja: '商品を探す' },
  { code: 'IDENTIFY', ja: '同じ商品かを確かめる' },
  { code: 'RECORD', ja: '数字を書き写す' },
  { code: 'IMPORT', ja: '取り込む' },
  { code: 'VERIFY', ja: '結果を見て確かめる' },
] as const;

export type WorkStepCode = (typeof WORK_STEPS)[number]['code'];

export function workStepJa(code: string): string {
  return WORK_STEPS.find((s) => s.code === code)?.ja ?? code;
}

/**
 * 記入見本。
 *
 * ユーザー指示：「分からない項目は空欄で構いません。推測禁止です。」
 * だから見本もわざと空欄だらけにしてある。全部埋まった見本を出すと「埋めなければ」と思わせてしまう。
 *
 * 【備考をすべて「記入例（サンプル）」にしてある理由】
 * この見本は画面の入力欄に最初から入っている。
 * うっかりそのまま取り込んでも、実市場データ100件の中に架空の3件が紛れ込まないようにするため、
 * わざとサンプルの印を付けてある（lib/realdata.ts の SAMPLE_MARKERS で弾かれる）。
 * 実際に記録するときは、この3行を消して自分が見た内容を書く。
 */
export const OBSERVATION_CSV_TEMPLATE = `確認日時,市場,商品名,ブランド,カテゴリ,型番,JAN,SKU,サイズ,色,状態,出品価格,送料込み,出品者,商品URL,販売状況,成約価格,成約日,備考,入力秒数
2026-08-20 21:30,MERCARI,ナイキ エアジョーダン1 ハイ OG,NIKE,スニーカー,DZ5485-612,,,27.5,シカゴ,未使用に近い,105000,送料込み,個人,https://jp.mercari.com/item/mSAMPLE0000001,出品中,,,記入例（サンプル）,45
2026-08-20 21:34,MERCARI,ポケモンカード リザードンex SAR,,トレカ,,,,,,目立った傷や汚れなし,38000,送料込み,個人,https://jp.mercari.com/item/mSAMPLE0000002,出品中,,,記入例（サンプル）型番が無いので同定は画像頼み,60
2026-08-27 21:10,MERCARI,,,,,,,,,,,,,https://jp.mercari.com/item/mSAMPLE0000001,売り切れ,,,記入例（サンプル）7日後の確認。売れた値段は表示されず不明,20`;
