import { all, nowIso, run } from './db/client';
import { ITEM_COST_FIELDS, VENUE_RATE_FIELDS } from './feestatus';

/**
 * 公式に確認が取れた手数料の台帳（Phase 3.6・メルカリ §2）。
 *
 * 【この表はAIが作ってはいけない】
 * ここに1行足すということは「人間が公式ページ・契約書を開いて、その目で数字を読んだ」という意味。
 * AIが記憶や推測で書き足すと、確認していない数字が VERIFIED の顔をして利益計算に入る。
 * それは Fail Closed の逆で、いちばんやってはいけない事故。
 *
 * 追加するときの条件（すべて満たすこと）:
 *   1. 出典URLが公式のものである（ヘルプ・料金ページ・契約書）
 *   2. そのページを実際に開いて、書いてある数字と一致している
 *   3. 確認した日付を入れる
 *   4. 確認した項目名だけを `verifiedFields` に書く。**確認していない項目は書かない**
 *
 * 【送料を一律で確定しない】
 * ユーザー指示：「送料等は商品・発送方法で異なるため、一律固定値として勝手に確定しないでください」。
 * 送料・梱包費・返品損失は商品ごとに変わるので `verifiedFields` に入れない。
 * 入っていない項目は、画面と判定で「推定値のまま」と表示され、信頼度は満点にならない。
 */

export type VerifiedFee = {
  venueCode: string;
  side: 'BUY' | 'SELL';
  categoryKey: string;
  /** 実際に確認できた金額・料率だけを書く。ここに無い項目は既存の推定値を残す。 */
  values: Record<string, number>;
  /** 確認できた項目名。`values` のキーと一致させる。 */
  verifiedFields: string[];
  sourceUrl: string;
  sourceName: string;
  /** 確認した日（YYYY-MM-DD）。 */
  verifiedAt: string;
  verifiedBy: string;
  note: string;
};

export const VERIFIED_FEES: VerifiedFee[] = [
  {
    venueCode: 'MERCARI',
    side: 'SELL',
    categoryKey: '*',
    values: {
      // 販売手数料は販売価格の10%。カテゴリによる差は無い。
      fee_rate: 0.1,

      // 1取引ごとの固定手数料は無い。
      // 【ここが Phase 3.7 の修正点】
      // 以前はここに振込手数料200円を入れていた。「1件ずつ振り込む最悪の場合で見ておけば安全」
      // という理屈だったが、これは間違いだった。
      //   ・振込手数料は「振込申請1回ごと」の費用で、商品1件ごとの費用ではない
      //   ・1回の申請で100件分まとめれば、1商品あたり2円
      //   ・200円で計算すると100倍の費用を見込むことになり、
      //     本当は利益が出る商品を「利益不足」として捨ててしまう
      // 見送るべきものを見送るのが Fail Closed。見送らなくていいものを捨てるのは計算間違い。
      fixed_fee: 0,

      // 売上金の振込手数料は一律200円。**振込申請1回ごと**。
      // 商品ごとの費用ではないので、専用の列に置き、1商品の利益計算には入れない。
      payout_fee_fixed: 200,
    },
    verifiedFields: ['fee_rate', 'fixed_fee', 'payout_fee_fixed'],
    sourceUrl: 'https://help.jp.mercari.com/guide/articles/65/',
    sourceName: 'メルカリ公式ヘルプ「メルカリの手数料」',
    verifiedAt: '2026-08-20',
    verifiedBy: 'human:2026-08-20 公式ヘルプページを閲覧',
    note:
      '販売手数料は販売価格の10%（1円未満は切り捨て。例：999円の商品なら99円）。'
      + '売上金の振込手数料は一律200円だが、これは振込申請1回ごとの費用であり、商品1件ごとの費用ではない。'
      + 'そのため payout_fee_fixed に分けて持ち、1商品の利益計算には入れない。'
      + '1取引ごとの固定手数料は無いので fixed_fee は0円。'
      + '送料は商品の大きさ・重さ・発送方法で変わるため、ここでは確定していない（推定値のまま）。',
  },
  {
    venueCode: 'MERCARI',
    side: 'BUY',
    categoryKey: '*',
    values: {
      // 購入時にメルカリへ払う「購入手数料」という項目は無い。
      // ただし**支払方法によって**手数料がかかる（コンビニ・ATM・キャリア決済など）。
      // それは金額で変わるので、この行ではなく venue_method_fee_rules 表で持つ。
      // ここで payment_fee_rate を0と確定してしまうと、
      // コンビニ払いの手数料が永久に計算へ入らなくなる。だから確認済みにしない。
      fee_rate: 0,
      fixed_fee: 0,
    },
    verifiedFields: ['fee_rate', 'fixed_fee'],
    sourceUrl: 'https://help.jp.mercari.com/guide/articles/65/',
    sourceName: 'メルカリ公式ヘルプ「メルカリの手数料」',
    verifiedAt: '2026-08-20',
    verifiedBy: 'human:2026-08-20 公式ヘルプページを閲覧',
    note:
      '購入者がメルカリへ払う「購入手数料」は無い。'
      + 'ただし支払方法（コンビニ・ATM・キャリア決済など）には金額に応じた手数料がかかるため、'
      + 'それは支払方法ごとの表（venue_method_fee_rules）で別に持つ。'
      + 'この行の決済手数料率は「確認済み」にしていない。',
  },
];

export type ApplyVerifiedResult = {
  applied: number;
  skipped: { venueCode: string; side: string; reason: string }[];
  /** 確認できた項目と、推定値のまま残した項目。画面と記録に出す。 */
  detail: {
    venueCode: string; side: string;
    verified: string[];
    stillEstimated: string[];
  }[];
};

/**
 * 台帳の内容をDBへ反映する。何度実行しても同じ結果になる（冪等）。
 *
 * 【上書きするのは確認できた項目だけ】
 * 台帳に書いていない項目（送料など）には触らない。
 * 「確認したので実額に更新」と「確認していないので推定値のまま」を1回の処理で混ぜない。
 */
export async function applyVerifiedFees(): Promise<ApplyVerifiedResult> {
  const out: ApplyVerifiedResult = { applied: 0, skipped: [], detail: [] };
  const now = nowIso();

  for (const v of VERIFIED_FEES) {
    // 台帳の書き方そのものを検算する。値はあるのに「確認した」と書いていない、
    // あるいはその逆を、静かに通さない。
    const keys = Object.keys(v.values).sort();
    const declared = [...v.verifiedFields].sort();
    if (keys.join(',') !== declared.join(',')) {
      out.skipped.push({
        venueCode: v.venueCode, side: v.side,
        reason: `台帳の書き方が合わない。金額を入れた項目（${keys.join('・')}）と確認済みと書いた項目（${declared.join('・')}）が一致しない`,
      });
      continue;
    }
    const unknownField = declared.find(
      (k) => !(VENUE_RATE_FIELDS as readonly string[]).includes(k)
          && !(ITEM_COST_FIELDS as readonly string[]).includes(k),
    );
    if (unknownField) {
      out.skipped.push({ venueCode: v.venueCode, side: v.side, reason: `知らない項目名：${unknownField}` });
      continue;
    }

    const rows = await all(
      `SELECT * FROM venue_fee_profiles
        WHERE venue_code = ? AND side = ? AND category_key = ?
        ORDER BY effective_from DESC LIMIT 1`,
      [v.venueCode, v.side, v.categoryKey],
    );
    const row = rows[0];
    if (!row) {
      out.skipped.push({ venueCode: v.venueCode, side: v.side, reason: '手数料の行がまだ無い' });
      continue;
    }

    const sets = declared.map((k) => `${k} = ?`).join(', ');
    const args = declared.map((k) => v.values[k]);
    await run(
      `UPDATE venue_fee_profiles
          SET ${sets},
              is_estimated = 0,
              source_type = 'OFFICIAL_PAGE',
              source_url = ?,
              source_name = ?,
              verified_at = ?,
              manually_verified_by = ?,
              verified_fields = ?,
              source_note = ?,
              updated_at = ?
        WHERE id = ?`,
      [
        ...args, v.sourceUrl, v.sourceName, v.verifiedAt, v.verifiedBy,
        JSON.stringify(declared), v.note, now, row.id,
      ],
    );

    // 台帳に無いのに金額が入っている実費＝確認していない推定値。正直に数え上げる。
    const stillEstimated = (ITEM_COST_FIELDS as readonly string[])
      .filter((k) => !declared.includes(k) && Number(row[k] ?? 0) !== 0);

    out.applied++;
    out.detail.push({
      venueCode: v.venueCode, side: v.side,
      verified: declared, stillEstimated,
    });
  }
  return out;
}
