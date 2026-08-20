import { all, run, nowIso } from './db/client';
import { MATCH_VERDICTS, MATCH_VERDICT_JA, isMatchVerdict, type MatchVerdict } from './listing';

/**
 * 同一商品判定の答え合わせ（Phase 3.8・ユーザー指示11／12）。
 *
 * 【なぜ人が確認するのか】
 * このシステムは型番やJANを手がかりに「メルカリのこの出品」と「他市場のこの商品」を
 * 同じ商品だと判定している。判定は文字列の照合なので、**必ず間違える場面がある**。
 *   ・色違い／サイズ違い（同じ型番で S と L がある）
 *   ・年式違い（2022年モデルと2024年モデルで型番の末尾だけ違う）
 *   ・国内版と海外版（型番が同じで付属品と保証が違う）
 *   ・セット品と単品（型番は本体のもの、実物は本体＋周辺機器）
 * 機械がこれを自力で見抜くのは難しい。だから人が見て答えを付ける。
 *
 * 【見逃しより取り違えの方が危険】
 * ユーザー指示：「利益商品を見逃すより、違う商品を同じ商品として扱う方が危険です。」
 *
 *   見逃し（利益が出る商品をRouteにできなかった）
 *     → 損失は「儲け損ね」だけ。財布からお金は出ない。あとから拾い直せる。
 *   取り違え（違う商品を同じ商品として計算した）
 *     → 8万円の相場だと思って5万円で仕入れたら、実物は相場2万円の別モデルだった、が起きる。
 *       実際に3万円を失い、しかも在庫として手元に残る。
 *
 * 非対称なので、扱いも非対称にする。`INCORRECT_MATCH`（＝FALSE MATCH）は
 * 「1件でもあったら重大」として数え、100件へ進む条件に入れる。
 * 見逃しは重大にしない（数えるだけ）。
 *
 * 【「たぶん合っている」を合格にしない】
 * 判断が付かないものは `UNCERTAIN` に置く。`CORRECT_MATCH` に寄せない。
 * 迷ったものを合格側に寄せると、いちばん危ない商品だけが合格して残る
 * （はっきり正しいものは迷わないので、迷ったもの＝紛らわしいもの＝危ないもの）。
 *
 * 【機械の判定を人の答えで上書きしない】
 * `tracked_listings.identity_key`（機械の判定）はそのまま残し、人の答えは
 * 別テーブル `identity_match_reviews` に置く。上書きすると
 * 「機械が何回間違えたか」が数えられなくなり、精度を測れなくなる。
 *
 * 【ここでも外部サイトには触れない】
 * このファイルがするのは、人が画面で押した答えを保存して数えることだけ。
 */

/*
 * 選択肢の言葉そのものは `lib/listing.ts`（外部依存ゼロ）に置いてある。
 * 確認するのは人なので画面から読む必要があり、このファイルはDB層を抱えているため
 * 画面から読むとビルドが落ちる（CLAUDE.md ルール37）。
 */
export { MATCH_VERDICTS, MATCH_VERDICT_JA };
export type { MatchVerdict };

const isVerdict = isMatchVerdict;

/** 人が確認すべき組み合わせ（この出品と、この市場の同じ型番の商品）。 */
export type MatchCandidate = {
  listingKey: string;
  productName: string | null;
  identityKey: string;
  venueCode: string;
  /** 比べる相手の市場 */
  matchedVenueCode: string;
  matchedVenueJa: string;
  /** 相手側の相場（円）。無ければ null。 */
  matchedPrice: number | null;
  /** 相手側に登録されている商品名。取り違えはここを見れば大半が分かる。 */
  matchedName: string | null;
  /** すでに人が答えを付けているか */
  verdict: MatchVerdict | null;
  note: string | null;
  reviewedAt: string | null;
};

export type MatchReviewSummary = {
  /** 確認すべき組み合わせの総数 */
  candidates: number;
  reviewed: number;
  unreviewed: number;
  correct: number;
  /** ＝ FALSE MATCH。重大。 */
  incorrect: number;
  uncertain: number;
  /** 確認できた組み合わせのうち、機械の判定が正しかった割合。分母0なら null。 */
  precision: number | null;
  /** 確認済みの割合。分母0なら null。 */
  reviewRate: number | null;
  /** 取り違えた具体例。何が原因だったかを人が書いたメモ付き。 */
  falseMatches: { listingKey: string; productName: string | null; matchedVenueCode: string; note: string | null }[];
  rows: MatchCandidate[];
  verdictJa: string;
  /** 100件へ進んでよいか（この観点だけの判定）。 */
  severeIssue: boolean;
};

/**
 * 人が確認すべき組み合わせを作る。
 * 「他の市場に同じ identity_key の相場がある」出品だけが対象。
 * 相手がいない出品は、そもそも取り違えようがないので確認する意味がない。
 */
export async function matchCandidates(): Promise<MatchCandidate[]> {
  const listings = await all(
    `SELECT listing_key, product_name, identity_key, venue_code
       FROM tracked_listings
      WHERE real_market_data = 1 AND identifiable = 1
        AND identity_key IS NOT NULL AND identity_key <> ''`,
  );
  if (listings.length === 0) return [];

  const priced = await all(
    `SELECT mp.identity_key AS k, mp.venue_code AS v, mp.price AS price,
            v.name AS venue_ja, p.name AS matched_name
       FROM venue_market_prices mp
       LEFT JOIN venues v ON v.code = mp.venue_code
       LEFT JOIN products p ON p.identity_key = mp.identity_key`,
  );
  const byKey = new Map<string, typeof priced>();
  for (const p of priced) {
    const k = String(p.k);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }

  const reviews = await all('SELECT * FROM identity_match_reviews');
  const reviewOf = new Map<string, Record<string, unknown>>();
  for (const r of reviews) {
    reviewOf.set(`${String(r.listing_key)}::${String(r.matched_venue_code)}`, r);
  }

  const out: MatchCandidate[] = [];
  for (const l of listings) {
    const key = String(l.listing_key);
    const idKey = String(l.identity_key);
    const mine = String(l.venue_code);
    const others = (byKey.get(idKey) ?? []).filter((p) => String(p.v) !== mine);

    // 同じ市場に複数の相場行があっても、確認するのは「市場ごとに1回」でよい。
    const seen = new Set<string>();
    for (const p of others) {
      const v = String(p.v);
      if (seen.has(v)) continue;
      seen.add(v);
      const rv = reviewOf.get(`${key}::${v}`);
      const verdictRaw = rv ? String(rv.verdict) : '';
      out.push({
        listingKey: key,
        productName: l.product_name === null ? null : String(l.product_name),
        identityKey: idKey,
        venueCode: mine,
        matchedVenueCode: v,
        matchedVenueJa: p.venue_ja === null || p.venue_ja === undefined ? v : String(p.venue_ja),
        matchedPrice: p.price === null || p.price === undefined ? null : Number(p.price),
        matchedName: p.matched_name === null || p.matched_name === undefined ? null : String(p.matched_name),
        verdict: isVerdict(verdictRaw) ? verdictRaw : null,
        note: rv && rv.note !== null && rv.note !== undefined ? String(rv.note) : null,
        reviewedAt: rv ? String(rv.reviewed_at) : null,
      });
    }
  }
  return out.sort((a, b) => {
    // 未確認を上に出す。確認する人がすぐ手を付けられるように。
    if ((a.verdict === null) !== (b.verdict === null)) return a.verdict === null ? -1 : 1;
    return a.listingKey.localeCompare(b.listingKey);
  });
}

/**
 * 人の答えを保存する。
 * 同じ組み合わせを2回押しても行が増えないよう UNIQUE(listing_key, matched_venue_code) で守る。
 * 答えの付け直しは許す（見直して直すのは正しい行為）。ただし機械側の判定は触らない。
 */
export async function recordMatchReview(
  listingKey: string,
  matchedVenueCode: string,
  verdict: string,
  note?: string,
  reviewer?: string,
): Promise<void> {
  if (!listingKey || !matchedVenueCode) throw new Error('確認する出品と市場を指定してください');
  if (!isVerdict(verdict)) throw new Error(`確認結果「${verdict}」は登録されていません`);

  const rows = await all(
    `SELECT identity_key FROM tracked_listings WHERE listing_key = ? LIMIT 1`,
    [listingKey],
  );
  if (rows.length === 0) throw new Error('その出品は登録されていません');
  const idKey = rows[0].identity_key === null ? null : String(rows[0].identity_key);

  await run(
    `INSERT INTO identity_match_reviews
       (listing_key, identity_key, matched_venue_code, verdict, reviewer, note, reviewed_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(listing_key, matched_venue_code) DO UPDATE SET
       verdict = excluded.verdict,
       note = excluded.note,
       reviewer = excluded.reviewer,
       reviewed_at = excluded.reviewed_at`,
    [listingKey, idKey, matchedVenueCode, verdict, reviewer ?? '人手', note ?? null, nowIso()],
  );
}

export async function matchReviewSummary(): Promise<MatchReviewSummary> {
  const rows = await matchCandidates();
  const candidates = rows.length;
  const reviewed = rows.filter((r) => r.verdict !== null).length;
  const correct = rows.filter((r) => r.verdict === 'CORRECT_MATCH').length;
  const incorrect = rows.filter((r) => r.verdict === 'INCORRECT_MATCH').length;
  const uncertain = rows.filter((r) => r.verdict === 'UNCERTAIN').length;

  const falseMatches = rows
    .filter((r) => r.verdict === 'INCORRECT_MATCH')
    .map((r) => ({
      listingKey: r.listingKey, productName: r.productName,
      matchedVenueCode: r.matchedVenueCode, note: r.note,
    }));

  const verdictJa = candidates === 0
    ? '他市場と比べられる出品がまだ無いため、同一商品判定の確認はできません。'
    : reviewed === 0
      ? `確認すべき組み合わせが ${candidates}件あります。まだ1件も答え合わせをしていません。`
      : incorrect > 0
        ? `**取り違えが ${incorrect}件見つかりました。** 違う商品を同じ商品として計算していたということなので、`
          + '原因を確かめるまで100件へ進みません（見逃しより危険な種類の間違いです）。'
        : uncertain > 0
          ? `${reviewed}/${candidates}件を確認し、取り違えは0件でした。ただし判断が付かないものが ${uncertain}件あります。`
            + 'これは合格にも不合格にもしません。'
          : `${reviewed}/${candidates}件を確認し、すべて同じ商品で合っていました。`;

  return {
    candidates, reviewed, unreviewed: candidates - reviewed,
    correct, incorrect, uncertain,
    precision: reviewed > 0 ? correct / reviewed : null,
    reviewRate: candidates > 0 ? reviewed / candidates : null,
    falseMatches, rows, verdictJa,
    severeIssue: incorrect > 0,
  };
}
