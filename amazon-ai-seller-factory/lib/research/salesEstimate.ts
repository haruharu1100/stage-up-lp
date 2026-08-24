import type { AmazonCandidate, SalesEstimate } from '../types';

/**
 * ESTIMATED_MONTHLY_SALES ＝ 推定月間販売数。
 *
 * ★言い方のルール（誇大表示の防止）
 *   ・Keepaの「monthlySold（月間販売数）」が取れた時だけ、実測に近い数字として扱う。
 *   ・それ以外は必ず「推定月販」と書く。「月販10個確定」とは絶対に書かない。
 *   ・情報が無いときは 0 ではなく「不明」として扱い、条件通過にしない。
 */

/** ランキング（BSR）→ おおよその月間販売数。カテゴリごとに規模が違う */
function bsrToMonthly(bsr: number, category: string | null | undefined): number {
  const c = category || '';
  // カテゴリ規模の係数（大きいほど市場が大きく、同じ順位でもよく売れる）
  let scale = 9000;
  if (/家電|パソコン|カメラ|ドラッグ|ビューティー|ホーム|キッチン|日用品/i.test(c)) scale = 14000;
  else if (/食品|飲料|グルメ/i.test(c)) scale = 11000;
  else if (/ペット|スポーツ|おもちゃ|ホビー|文房具/i.test(c)) scale = 7000;
  else if (/産業|DIY|車|バイク/i.test(c)) scale = 5000;

  if (bsr <= 0) return 0;
  // 経験則: 販売数 ≒ scale / (順位^0.75)。順位が良いほど急に伸びる曲線
  const est = scale / Math.pow(bsr, 0.75);
  return Math.max(0, Math.round(est));
}

export function estimateMonthlySales(cand: AmazonCandidate): SalesEstimate {
  const m = cand.market;

  // 1) Keepa の月間販売数（Amazonが商品ページに出している「過去1ヶ月で◯点購入」由来）
  if (m.monthlySalesEst != null && m.monthlySalesEst > 0 && (m.source === 'keepa' || m.source === 'csv')) {
    return {
      units: Math.round(m.monthlySalesEst),
      basis: m.source === 'csv' ? 'csv' : 'keepa_monthly_sold',
      confidence: 'high',
      note:
        m.source === 'csv'
          ? '取り込んだCSVに書かれていた月間販売数です'
          : 'Amazonが商品ページに表示している「過去1ヶ月の購入数」（Keepa経由）です',
    };
  }

  // 2) サンプル市場など、明示的に数字がある場合は「推定」として扱う
  if (m.monthlySalesEst != null && m.monthlySalesEst > 0) {
    return {
      units: Math.round(m.monthlySalesEst),
      basis: 'bsr_estimate',
      confidence: 'low',
      note: 'サンプルデータ上の想定値です（実測ではありません）',
    };
  }

  // 3) ランキングからの推定
  if (m.bsr != null && m.bsr > 0) {
    const units = bsrToMonthly(m.bsr, m.bsrCategory || cand.product.category);
    // レビュー数が極端に少ない＝新しい商品で、順位が一時的な可能性がある
    const shaky = (m.reviewCount ?? 0) < 5;
    return {
      units,
      basis: 'bsr_estimate',
      confidence: shaky ? 'low' : 'medium',
      note: `ランキング${m.bsr.toLocaleString()}位からの推定です（実測ではありません）${shaky ? '／レビューが少なく振れやすい' : ''}`,
    };
  }

  return {
    units: 0,
    basis: 'unknown',
    confidence: 'low',
    note: '販売数を推定できる情報（ランキング・購入数）がありません',
  };
}

/** 画面表示用の言い回し。ここで必ず「推定」と付ける */
export function salesLabel(s: SalesEstimate): string {
  if (s.basis === 'unknown') return '販売数不明';
  if (s.basis === 'keepa_monthly_sold') return `月${s.units.toLocaleString()}個（Amazon表示の購入数）`;
  if (s.basis === 'csv') return `月${s.units.toLocaleString()}個（取込データ）`;
  return `推定月販 約${s.units.toLocaleString()}個`;
}
