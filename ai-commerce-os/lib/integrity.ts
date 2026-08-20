import { all } from './db/client';
import { SAMPLE_MARKERS } from './realdata';

/**
 * 集めたデータが壊れていないかを機械で点検する（Phase 3.8・ユーザー指示15）。
 *
 * 【なぜ「動いたから大丈夫」で先に進まないのか】
 * 10件を入力して画面が普通に表示されたら、つい「問題なし」と思ってしまう。
 * だが実際に危ないのは、**画面には何も出ないまま静かに混ざる間違い**の方で、
 *   ・同じ商品を2回登録していて、件数が水増しされている
 *   ・記入見本やテスト用の行が実績データに混ざっている
 *   ・売り切れを確認していないのに成約価格が入っている
 * といったものは、エラーにならないので気づけない。
 * そのまま100件へ進むと、90件分の間違ったデータの上で判断することになる。
 *
 * だから「進んでよいか」を人の感覚ではなく、ここの点検結果で決める。
 *
 * 【重大と、気になる点を分ける】
 * すべてを「エラー」にすると、動かせなくなるか、逆に全部無視するようになる。
 *   重大（severe）    ＝ これがあるうちは100件へ進まない。データの意味が変わってしまう種類。
 *   気になる点（warn）＝ 進んでよいが、覚えておく。
 *
 * 【ここでは何も直さない】
 * 見つけたものを黙って削除・修正しない。人に見せて、人が直す。
 * 自動で消すと「何件が壊れていたか」が分からなくなり、原因にたどり着けない。
 */

export type IntegrityIssue = {
  code: string;
  ja: string;
  severe: boolean;
  count: number;
  /** どの行が該当したか（多いときは先頭だけ） */
  samples: string[];
  detailJa: string;
};

export type IntegrityReport = {
  checked: number;
  issues: IntegrityIssue[];
  severeCount: number;
  warnCount: number;
  /** 重複登録の件数（ゲート条件で単独で見る） */
  duplicateCount: number;
  /** データ汚染の件数（ゲート条件で単独で見る） */
  contaminationCount: number;
  verdictJa: string;
};

/**
 * URLの見た目の違いを取り除く。
 * 同じ商品ページでも、末尾のスラッシュや `?utm_source=...` が付くだけで別のURLに見える。
 * `listing_key` はUNIQUEなので同じ文字列は2回入らないが、
 * **少し違う文字列**は2行として入ってしまう。そこを見つけるための正規化。
 */
export function canonicalUrl(url: string): string {
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  u = u.split('#')[0];
  u = u.split('?')[0];
  u = u.replace(/\/+$/, '');
  return u;
}

export async function integrityReport(): Promise<IntegrityReport> {
  const listings = await all(`SELECT * FROM tracked_listings WHERE real_market_data = 1`);
  const issues: IntegrityIssue[] = [];

  const add = (
    code: string, ja: string, severe: boolean,
    hits: { key: string }[], detailJa: string,
  ) => {
    if (hits.length === 0) return;
    issues.push({
      code, ja, severe, count: hits.length,
      samples: hits.slice(0, 5).map((h) => h.key),
      detailJa,
    });
  };

  // ---------------------------------------------------------- ① 重複登録
  const seen = new Map<string, string[]>();
  for (const l of listings) {
    const c = canonicalUrl(String(l.product_url ?? ''));
    if (c === '') continue;
    if (!seen.has(c)) seen.set(c, []);
    seen.get(c)!.push(String(l.listing_key));
  }
  const dupUrl = [...seen.entries()].filter(([, v]) => v.length > 1);
  const duplicateCount = dupUrl.reduce((a, [, v]) => a + (v.length - 1), 0);
  add(
    'DUPLICATE_LISTING', '同じ商品ページを2回登録している', true,
    dupUrl.map(([c]) => ({ key: c })),
    'URLの末尾やクエリ（?以降）だけが違うと、同じ出品が2件として数えられます。'
    + '件数が水増しされ、1件あたりの作業時間も実際より短く見えます。',
  );

  // ---------------------------------------------------------- ② データ汚染
  const contaminated = listings.filter((l) => {
    const hay = `${String(l.product_name ?? '')} ${String(l.product_url ?? '')} ${String(l.notes ?? '')}`.toUpperCase();
    return SAMPLE_MARKERS.some((m) => hay.includes(m.toUpperCase()));
  });
  const contaminationCount = contaminated.length;
  add(
    'SAMPLE_DATA_MIXED', '記入見本やテスト用の行が実績データに混ざっている', true,
    contaminated.map((l) => ({ key: String(l.listing_key) })),
    '実績として数える行（real_market_data=1）に、見本・テストの印が付いたものが入っています。'
    + '実力より良い数字にも悪い数字にもなり得るため、どちらにしても判断材料になりません。',
  );

  // ---------------------------------------------------------- ③ 売れてもいないのに成約価格
  const soldWithoutProof = listings.filter(
    (l) => Number(l.sold_price_known) === 1 && String(l.latest_state) !== 'CONFIRMED_SOLD',
  );
  add(
    'SOLD_PRICE_WITHOUT_SOLD_STATE', '売り切れを確認していないのに成約価格が入っている', true,
    soldWithoutProof.map((l) => ({ key: String(l.listing_key) })),
    '「ページが消えた＝売れた」にしない決まりです（CLAUDE.md ルール30／31）。'
    + '成約価格は、売り切れ表示を画面で実際に見たときだけ入ります。',
  );

  // ---------------------------------------------------------- ④ 価格が0円以下
  const badPrice = listings.filter((l) => {
    const p = l.first_listing_price;
    return p !== null && p !== undefined && Number(p) <= 0;
  });
  add(
    'NON_POSITIVE_PRICE', '出品価格が0円以下になっている', true,
    badPrice.map((l) => ({ key: String(l.listing_key) })),
    '桁の入力ミスか、単位の取り違えの可能性が高いです。異常な価格は、そのまま最優良Routeとして上位に出てしまいます。',
  );

  // ---------------------------------------------------------- ⑤ 観測が登録より前
  const badTime = await all(`
    SELECT o.listing_key AS k
      FROM listing_observations o
      JOIN tracked_listings t ON t.listing_key = o.listing_key
     WHERE o.real_market_data = 1 AND o.observed_at < t.first_observed_at`);
  add(
    'OBSERVED_BEFORE_FIRST', '観測日時が最初の登録より前になっている', true,
    badTime.map((r) => ({ key: String(r.k) })),
    '日付の入力ミスです。時系列が逆になると、値下げや売り切れの前後関係が読めなくなります。',
  );

  // ---------------------------------------------------------- ⑥ 作業時間が記録されていない
  const noSeconds = await all(`
    SELECT t.listing_key AS k FROM tracked_listings t
     WHERE t.real_market_data = 1
       AND NOT EXISTS (
         SELECT 1 FROM listing_observations o
          WHERE o.listing_key = t.listing_key
            AND o.entry_seconds IS NOT NULL AND o.entry_seconds > 0)`);
  add(
    'ENTRY_SECONDS_MISSING', '入力にかかった秒数が記録されていない', false,
    noSeconds.map((r) => ({ key: String(r.k) })),
    'どの工程を自動化すべきかは、実測した秒数でしか決められません（感覚で決めると外れます）。',
  );

  // ---------------------------------------------------------- ⑦ 送料が不明のまま
  const noShipping = listings.filter((l) => {
    const size = String(l.package_size ?? '');
    const method = String(l.shipping_method ?? '');
    const est = l.estimated_shipping_cost;
    return (est === null || est === undefined)
      && (size === '' || size === 'UNKNOWN')
      && (method === '' || method === 'UNKNOWN');
  });
  add(
    'SHIPPING_UNKNOWN_ROWS', '送料の手がかりが1つも無い', false,
    noShipping.map((l) => ({ key: String(l.listing_key) })),
    '送料不明を0円として計算しない決まりのため、この行は利益計算まで進みません。'
    + '荷物サイズか発送方法のどちらかが分かれば計算できます。',
  );

  // ---------------------------------------------------------- ⑧ 状態が読めていない
  const noCondition = listings.filter((l) => {
    const c = String(l.condition_rank ?? '');
    return c === '' || c === 'UNKNOWN' || c === 'MANUAL_REVIEW';
  });
  add(
    'CONDITION_UNRESOLVED', '商品の状態が共通6段階に落とせていない', false,
    noCondition.map((l) => ({ key: String(l.listing_key) })),
    '状態が決まらないと相場を比べられません。推測でマッピングしない決まりなので、空欄のままにしてあります。',
  );

  const severeCount = issues.filter((i) => i.severe).reduce((a, i) => a + i.count, 0);
  const warnCount = issues.filter((i) => !i.severe).reduce((a, i) => a + i.count, 0);

  const verdictJa = listings.length === 0
    ? '実市場の出品がまだ1件も無いため、点検できません。'
    : severeCount === 0
      ? `${listings.length}件を点検し、データの意味が変わるような問題は見つかりませんでした。`
        + (warnCount > 0 ? `（気になる点が${warnCount}件あります）` : '')
      : `${listings.length}件を点検し、重大な問題が${severeCount}件見つかりました。`
        + 'これを直すまで100件へ進みません（同じ間違いが90件分増えるだけになります）。';

  return {
    checked: listings.length,
    issues, severeCount, warnCount,
    duplicateCount, contaminationCount, verdictJa,
  };
}
