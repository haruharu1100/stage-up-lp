import fs from 'node:fs';
import path from 'node:path';
import type { ReviewItem } from '../types';
import { config, str, PROJECT_ROOT } from '../env';
import { parseCsv, numOr } from '../csv';

/**
 * ReviewProvider — レビュー本文の取得口。
 * ★Amazonのレビューを無許可でスクレイピングしない。取得元は以下だけ:
 *   1. 自分でアップロードしたCSV（data/reviews/<ASIN>.csv）
 *   2. 許諾済みの外部API（鍵が入り次第 Adapter を追加）
 *   3. 取得できない場合は「サンプル」で配線確認のみ（分析結果は confidence=low）
 */
export interface ReviewProvider {
  readonly name: string;
  readonly isReal: boolean;
  fetchReviews(asin: string | null, limit: number): Promise<ReviewItem[]>;
}

const REVIEW_DIR = path.join(PROJECT_ROOT, 'data', 'reviews');

class CsvReviewProvider implements ReviewProvider {
  readonly name = 'csv';
  readonly isReal = true;
  async fetchReviews(asin: string | null, limit: number): Promise<ReviewItem[]> {
    if (!asin) return [];
    const file = path.join(REVIEW_DIR, `${asin}.csv`);
    if (!fs.existsSync(file)) return [];
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    return rows
      .map((r) => ({
        rating: numOr(r.rating ?? r['評価']),
        title: r.title ?? r['タイトル'] ?? null,
        body: r.body ?? r['本文'] ?? r['レビュー'] ?? '',
        postedOn: r.date ?? r['日付'] ?? null,
        verified: /^(1|true|yes|はい)$/i.test(r.verified ?? ''),
        source: 'csv',
      }))
      .filter((r) => r.body.trim() !== '')
      .slice(0, limit);
  }
}

/** 配線確認用のサンプルレビュー。実在の購入者の声ではない */
const SAMPLE_TEMPLATES: { rating: number; body: string }[] = [
  { rating: 5, body: '想像していたよりしっかりしていて満足です。リピートしています。毎日使うものなので箱買いできるのが助かります。' },
  { rating: 5, body: '手軽さが一番の理由で買いました。忙しい平日の夜でもすぐ用意できるので家族に好評でした。' },
  { rating: 4, body: '味は良いのですが、量の割に少し高い気がします。セールの時にまとめて買うのがちょうどいいと思います。' },
  { rating: 4, body: '保存方法が商品ページに書かれていなくて不安でした。届いた箱に書いてあったので分かりましたが、先に知りたかったです。' },
  { rating: 3, body: 'サイズ感が写真だと分かりにくく、届いてから思ったより大きいと感じました。比較写真があると助かります。' },
  { rating: 3, body: '使い方の説明が少なく、最初はどれくらい使えばいいか迷いました。慣れれば問題ありません。' },
  { rating: 2, body: '梱包が簡易で、届いた時に少し潰れていました。中身は問題なかったので使いましたが気になります。' },
  { rating: 2, body: '前に買った他社のものと比べると少し物足りない印象です。価格を考えると仕方ないかもしれません。' },
  { rating: 5, body: '贈り物として使いました。見た目がきれいで喜ばれました。熨斗が付けられるのがよかったです。' },
  { rating: 4, body: '常温で置いておけるのが決め手でした。冷蔵庫の場所を取らないので買い置きしています。' },
  { rating: 5, body: 'コスパが良いと思います。子どもも食べやすいようで、消費が早くなりました。' },
  { rating: 3, body: '悪くはないですが、届くまでに少し時間がかかりました。中身の説明がもう少し詳しいと安心です。' },
];

class SampleReviewProvider implements ReviewProvider {
  readonly name = 'sample';
  readonly isReal = false;
  async fetchReviews(_asin: string | null, limit: number): Promise<ReviewItem[]> {
    return SAMPLE_TEMPLATES.slice(0, limit).map((t) => ({
      rating: t.rating,
      title: null,
      body: t.body,
      postedOn: null,
      verified: true,
      source: 'sample',
    }));
  }
}

export function getReviewProvider(): ReviewProvider {
  const want = str('REVIEW_PROVIDER', 'auto');
  if (config.offline || want === 'mock') return new SampleReviewProvider();
  if (want === 'csv') return new CsvReviewProvider();
  return new AutoReviewProvider();
}

/** CSVがあればCSV、無ければサンプル（＝分析の信頼度を下げて返す） */
class AutoReviewProvider implements ReviewProvider {
  readonly name = 'auto';
  readonly isReal = true;
  private csv = new CsvReviewProvider();
  private sample = new SampleReviewProvider();
  async fetchReviews(asin: string | null, limit: number): Promise<ReviewItem[]> {
    const fromCsv = await this.csv.fetchReviews(asin, limit);
    if (fromCsv.length) return fromCsv;
    return this.sample.fetchReviews(asin, limit);
  }
}
