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

/**
 * 上の5つとは別に、初回だけもう1つ必須にしているもの（Phase 3.8）。
 *
 * ユーザー指示：「最低でも TOTAL_INPUT_SECONDS は必須です。」
 *
 * 【なぜ商品の情報ではないものを必須にするのか】
 * この10件は商品データを集めるために入れるのではなく、
 * **どこを自動化すべきかを決めるために**入れる。
 * 秒数が無いと、その目的が達成できない。「あとでまとめて書く」は必ず忘れるし、
 * 思い出しながら書いた秒数は実測ではない。だから入力の場で必須にする。
 *
 * 追跡（2回目以降）では必須にしない。追跡は数秒で終わる作業で、そこは論点ではない。
 */
export const REQUIRED_FIRST_MEASURE = ['entry_seconds'];

// ============================================================
// 送料の精度（Phase 3.7）
// ============================================================

/**
 * 送料は「だいたい◯円」で済ませると、そこが利益の一番大きな誤差になる。
 * ユーザー指示：荷物のサイズ・発送方法・送料の負担者・見込み送料・実際の送料 を持たせる。
 *
 * 【全部必須にしない】
 * 見ただけでは分からない項目（実際の送料など）を必須にすると、人は適当に埋める。
 * 分からないものは空欄のまま受け取り、「分からない」として集計する。
 */
export const PACKAGE_SIZES = [
  { code: 'NEKOPOS', ja: 'ネコポス／ゆうパケット（薄い小物）' },
  { code: 'COMPACT', ja: '宅急便コンパクト／ゆうパケットプラス' },
  { code: 'SIZE_60', ja: '60サイズ' },
  { code: 'SIZE_80', ja: '80サイズ' },
  { code: 'SIZE_100', ja: '100サイズ' },
  { code: 'SIZE_120_PLUS', ja: '120サイズ以上（大きい荷物）' },
  { code: 'UNKNOWN', ja: '不明' },
] as const;
export type PackageSizeCode = (typeof PACKAGE_SIZES)[number]['code'];

export const SHIPPING_METHODS = [
  { code: 'RAKURAKU', ja: 'らくらくメルカリ便' },
  { code: 'YUYU', ja: 'ゆうゆうメルカリ便' },
  { code: 'YAMATO', ja: 'ヤマト運輸（通常）' },
  { code: 'JAPAN_POST', ja: '日本郵便（通常）' },
  { code: 'SAGAWA', ja: '佐川急便' },
  { code: 'OTHER', ja: 'その他' },
  { code: 'UNKNOWN', ja: '不明' },
] as const;
export type ShippingMethodCode = (typeof SHIPPING_METHODS)[number]['code'];

/** 誰が送料を持つか。ここを取り違えると利益がまるごとずれる。 */
export const SHIPPING_PAYERS = [
  { code: 'SELLER', ja: '出品者が負担（送料込み）' },
  { code: 'BUYER', ja: '購入者が負担（着払い）' },
  { code: 'UNKNOWN', ja: '不明' },
] as const;
export type ShippingPayerCode = (typeof SHIPPING_PAYERS)[number]['code'];

function fromList(
  list: readonly { code: string; ja: string }[],
  raw: string | null | undefined,
): string | null {
  const c = canon(String(raw ?? ''));
  if (c === '') return null;
  for (const x of list) if (canon(x.code) === c) return x.code;
  for (const x of list) if (canon(x.ja) === c) return x.code;
  for (const x of list) if (c.includes(canon(x.code)) && x.code !== 'UNKNOWN' && x.code !== 'OTHER') return x.code;
  return null;
}

/** 読み取れなければ null。「たぶん60サイズ」に寄せない（CLAUDE.md ルール17と同じ考え方）。 */
export function parsePackageSize(raw: string | null | undefined): PackageSizeCode | null {
  const c = canon(String(raw ?? ''));
  if (c === '') return null;
  // 数字だけ書かれた場合（「60」「80」）も受け止める。
  const bySize: Record<string, PackageSizeCode> = {
    '60': 'SIZE_60', '80': 'SIZE_80', '100': 'SIZE_100',
    '120': 'SIZE_120_PLUS', '140': 'SIZE_120_PLUS', '160': 'SIZE_120_PLUS',
  };
  const m = c.match(/^(\d{2,3})(サイズ)?$/);
  if (m && bySize[m[1]]) return bySize[m[1]];
  if (['ネコポス', 'ゆうパケット'].some((w) => c.includes(canon(w)))) return 'NEKOPOS';
  if (['宅急便コンパクト', 'コンパクト', 'ゆうパケットプラス'].some((w) => c.includes(canon(w)))) return 'COMPACT';
  return fromList(PACKAGE_SIZES, raw) as PackageSizeCode | null;
}

export function parseShippingMethod(raw: string | null | undefined): ShippingMethodCode | null {
  const c = canon(String(raw ?? ''));
  if (c === '') return null;
  if (['らくらく', 'らくらくメルカリ便', 'rakuraku'].some((w) => c.includes(canon(w)))) return 'RAKURAKU';
  if (['ゆうゆう', 'ゆうゆうメルカリ便', 'yuyu'].some((w) => c.includes(canon(w)))) return 'YUYU';
  if (['ヤマト', 'クロネコ', '宅急便'].some((w) => c.includes(canon(w)))) return 'YAMATO';
  if (['日本郵便', 'ゆうパック', 'ゆうメール', '郵便'].some((w) => c.includes(canon(w)))) return 'JAPAN_POST';
  if (['佐川'].some((w) => c.includes(canon(w)))) return 'SAGAWA';
  return fromList(SHIPPING_METHODS, raw) as ShippingMethodCode | null;
}

export function parseShippingPayer(raw: string | null | undefined): ShippingPayerCode | null {
  const c = canon(String(raw ?? ''));
  if (c === '') return null;
  if (['送料込み', '送料込', '出品者負担', 'seller', 'included'].some((w) => c.includes(canon(w)))) return 'SELLER';
  if (['着払い', '着払', '購入者負担', 'buyer'].some((w) => c.includes(canon(w)))) return 'BUYER';
  return fromList(SHIPPING_PAYERS, raw) as ShippingPayerCode | null;
}

export function packageSizeJa(code: string | null | undefined): string {
  if (!code) return '不明';
  return PACKAGE_SIZES.find((x) => x.code === code)?.ja ?? code;
}
export function shippingMethodJa(code: string | null | undefined): string {
  if (!code) return '不明';
  return SHIPPING_METHODS.find((x) => x.code === code)?.ja ?? code;
}
export function shippingPayerJa(code: string | null | undefined): string {
  if (!code) return '不明';
  return SHIPPING_PAYERS.find((x) => x.code === code)?.ja ?? code;
}


// ============================================================
// 人間の作業時間（§19 §20）
// ============================================================

/**
 * 工程（Phase 3.8 でユーザー指示の6つに合わせ直した）。
 *
 * 【なぜ名前を変えたか】
 * 元は「商品を探す／同じ商品かを確かめる／数字を書き写す／取り込む／結果を確かめる」の5つだった。
 * ユーザー指示は「商品発見・商品情報確認・CSV入力・型番確認・状態確認・その他」の6つ。
 *
 * ここで大事なのは、**型番確認と状態確認を別々に測ること**。
 * この2つは自動化の難易度がまるで違う。
 *   型番確認 … 商品名から型番を引き当てる。カタログ照合で自動化できる余地がある。
 *   状態確認 … 写真と説明文を人が見て決める。今の技術では自動化しにくい。
 * ひとまとめに測ると「同定に時間がかかる」としか分からず、**どちらを自動化すべきかが決められない**。
 *
 * 【自動化のしやすさを一緒に持たせる】
 * いちばん時間を食っている工程が、いちばん自動化しやすい工程とは限らない。
 * 「時間 × 自動化しやすさ」で順番を決めたいので、ここに難易度を書いておく。
 * これは見込みであって実測ではないので、`automatableNote` に理由を書いて根拠を残す。
 */
export const WORK_STEPS = [
  {
    code: 'FIND', ja: '商品発見',
    automatable: 'HARD',
    automatableNote: '公式APIか正式なデータ提供が無いと自動化できない（無断の自動巡回はしない）',
  },
  {
    code: 'INSPECT', ja: '商品情報確認',
    automatable: 'HARD',
    automatableNote: '同上。画面を見る作業なので、正規の取得手段が無い限り人がやるしかない',
  },
  {
    code: 'MODEL_CHECK', ja: '型番確認',
    automatable: 'EASY',
    automatableNote: '商品名からの型番の引き当ては、カタログ照合で自動化できる余地が大きい',
  },
  {
    code: 'CONDITION_CHECK', ja: '状態確認',
    automatable: 'MEDIUM',
    automatableNote: '出品者の言葉を共通6段階へ直す部分は自動化できる。写真の判断は人が要る',
  },
  {
    code: 'ENTRY', ja: 'CSV入力',
    automatable: 'EASY',
    automatableNote: '入力欄の作り方（貼り付け・前回値の引き継ぎ）で減らせる。外部サイトに触らずに改善できる',
  },
  {
    code: 'OTHER', ja: 'その他',
    automatable: 'UNKNOWN',
    automatableNote: '中身が分からないので判断できない。備考に書かれた内容を読むこと',
  },
] as const;

export type WorkStepCode = (typeof WORK_STEPS)[number]['code'];

/** 自動化のしやすさ。数字が大きいほど手を付けやすい。 */
export const AUTOMATABLE_WEIGHT: Record<string, number> = {
  EASY: 1.0, MEDIUM: 0.6, HARD: 0.25, UNKNOWN: 0.3,
};
export const AUTOMATABLE_JA: Record<string, string> = {
  EASY: '自動化しやすい',
  MEDIUM: '一部だけ自動化できる',
  HARD: '正規の取得手段が無いと難しい',
  UNKNOWN: '判断できない',
};

/**
 * 旧コードの受け皿。Phase 3.7 までに記録された作業時間を読めなくしないために残す。
 * **新規では使わない。** 対応が曖昧なもの（IMPORT・VERIFY）は OTHER に寄せる。
 * ここで無理に MODEL_CHECK などへ割り当てると、測っていない工程の秒数を捏造することになる。
 */
const WORK_STEP_ALIASES: Record<string, WorkStepCode> = {
  IDENTIFY: 'MODEL_CHECK',
  RECORD: 'ENTRY',
  IMPORT: 'OTHER',
  VERIFY: 'OTHER',
};

/** 書かれた工程コードを今の6つへ寄せる。読み取れなければ null（推測で OTHER にしない）。 */
export function normalizeWorkStep(code: string | null | undefined): WorkStepCode | null {
  const raw = String(code ?? '').trim().toUpperCase().replace(/[\s-]/g, '_');
  if (raw === '') return null;
  if (WORK_STEPS.some((s) => s.code === raw)) return raw as WorkStepCode;
  return WORK_STEP_ALIASES[raw] ?? null;
}

export function workStepJa(code: string): string {
  const s = WORK_STEPS.find((x) => x.code === code);
  if (s) return s.ja;
  const n = normalizeWorkStep(code);
  return n ? `${WORK_STEPS.find((x) => x.code === n)!.ja}（旧：${code}）` : code;
}

export function workStepAutomatable(code: string): { level: string; ja: string; note: string } {
  const n = normalizeWorkStep(code);
  const s = WORK_STEPS.find((x) => x.code === n);
  if (!s) return { level: 'UNKNOWN', ja: AUTOMATABLE_JA.UNKNOWN, note: '未知の工程' };
  return { level: s.automatable, ja: AUTOMATABLE_JA[s.automatable], note: s.automatableNote };
}

/**
 * 観測CSVの、工程ごとの秒数の列。
 * 全部書かせると計測そのものが面倒になって続かないので、**空欄でよい**。
 * 必須は合計（`entry_seconds` ＝ TOTAL_INPUT_SECONDS）だけ。
 */
export const WORK_STEP_SECONDS_FIELDS: { field: string; step: WorkStepCode }[] = [
  { field: 'sec_find', step: 'FIND' },
  { field: 'sec_inspect', step: 'INSPECT' },
  { field: 'sec_model', step: 'MODEL_CHECK' },
  { field: 'sec_condition', step: 'CONDITION_CHECK' },
  { field: 'sec_entry', step: 'ENTRY' },
  { field: 'sec_other', step: 'OTHER' },
];

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
export const OBSERVATION_CSV_TEMPLATE = `確認日時,市場,商品名,ブランド,カテゴリ,型番,JAN,SKU,サイズ,色,状態,出品価格,送料込み,出品者,商品URL,販売状況,成約価格,成約日,荷物サイズ,発送方法,送料負担,見込み送料,実際の送料,備考,入力秒数,発見秒数,情報確認秒数,型番確認秒数,状態確認秒数,記入秒数,その他秒数
2026-08-20 21:30,MERCARI,ナイキ エアジョーダン1 ハイ OG,NIKE,スニーカー,DZ5485-612,,,27.5,シカゴ,未使用に近い,105000,送料込み,個人,https://jp.mercari.com/item/mSAMPLE0000001,出品中,,,80サイズ,らくらくメルカリ便,出品者が負担（送料込み）,850,,記入例（サンプル）,145,40,25,35,20,25,0
2026-08-20 21:34,MERCARI,ポケモンカード リザードンex SAR,,トレカ,,,,,,目立った傷や汚れなし,38000,送料込み,個人,https://jp.mercari.com/item/mSAMPLE0000002,出品中,,,ネコポス,らくらくメルカリ便,出品者が負担（送料込み）,210,,記入例（サンプル）型番が無いので同定は画像頼み,160,35,30,50,25,20,0
2026-08-27 21:10,MERCARI,,,,,,,,,,,,,https://jp.mercari.com/item/mSAMPLE0000001,売り切れ,,,,,,,,記入例（サンプル）7日後の確認。売れた値段は表示されず不明,20,,,,,,`;

/**
 * 同一商品判定の答え合わせに使う言葉（Phase 3.8・ユーザー指示11／12）。
 *
 * 【なぜここ（外部依存ゼロのファイル）に置くか】
 * 確認するのは人なので、画面（`'use client'`）から読む必要がある。
 * 集計側の `lib/matchreview.ts` はデータベース層を抱えているため、
 * 画面から読むとビルドが落ちる（CLAUDE.md ルール37）。
 * 状態ランクを `lib/conditions.ts` に分けてあるのと同じ理由。
 *
 * 【「たぶん合っている」を作らない】
 * 選択肢は3つだけにしてある。「たぶん合っている」を足すと、
 * 迷ったものが全部そこへ入り、結局それが合格として扱われる。
 * 迷ったものは `UNCERTAIN`（判断が付かない）に置き、合格にも不合格にもしない。
 */
export const MATCH_VERDICTS = [
  {
    code: 'CORRECT_MATCH',
    ja: '同じ商品で合っている',
    note: '型番・色・サイズ・年式・付属品まで見て、同じ商品だと言い切れる場合だけ選ぶ。',
    severe: false,
  },
  {
    code: 'INCORRECT_MATCH',
    ja: '違う商品だった（重大）',
    note: '別モデル・色違い・サイズ違い・海外版・セット品など、実際には別の商品だった場合。'
      + 'このまま仕入れると実際にお金を失う種類の間違いなので、重大として数える。',
    severe: true,
  },
  {
    code: 'UNCERTAIN',
    ja: '判断が付かない',
    note: '写真や説明では決められない場合。合っている側に寄せない。',
    severe: false,
  },
] as const;

export type MatchVerdict = (typeof MATCH_VERDICTS)[number]['code'];

export const MATCH_VERDICT_JA: Record<string, string> = {
  CORRECT_MATCH: '同じ商品で合っている',
  INCORRECT_MATCH: '違う商品だった（重大）',
  UNCERTAIN: '判断が付かない',
};

export function isMatchVerdict(v: string): v is MatchVerdict {
  return MATCH_VERDICTS.some((m) => m.code === v);
}
