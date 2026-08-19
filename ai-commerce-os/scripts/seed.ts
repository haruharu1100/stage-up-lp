/**
 * テスト用の架空データを作る。
 *
 * 実在の店舗の実データではない。列の並び・状態表記の書き方だけを
 * 「KOMEHYO風 / BOOKOFF風 / HARD OFF風」に似せた完全な作り物。
 *
 * 判定の各ケース（STRONG BUY / BUY / WATCH / LOW PRIORITY / SKIP /
 * 赤字 / 相場不足 / 重複 / 異常価格）が必ず1件以上出るように、
 * 乱数を使わず価格を逆算して作る。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runImport } from '../lib/pipeline/import';
import { runAnalyze } from '../lib/pipeline/analyze';
import { ensureReady } from '../lib/queries';
import { rebuildPremiumRatioStats } from '../lib/pricing';
import { importMarketData } from '../lib/marketdata';
import { runRoutes } from '../lib/pipeline/routes';
import { all, run } from '../lib/db/client';

/** MERCARI の初期手数料設定に対応した固定費（送料800＋梱包150＋想定返品300）。 */
const EXTRA = 1250;

/**
 * 目的の判定になるように仕入価格を逆算する。
 * F（仕入価格＋固定費）が市場価格の何倍かで結果が決まる。
 */
const F_RATIO: Record<string, number> = {
  STRONG_BUY: 0.57,
  BUY: 0.625,
  WATCH: 0.665,
  LOW_PRIORITY: 0.725,
  LOW_ROI: 0.8,
  LOW_PROFIT: 0.8, // 市場価格が小さいときだけ「利益不足」になる
  MARKET_TOO_LOW: 0.86,
  NEGATIVE: 0.95,
};

function purchaseFor(marketPrice: number, kind: keyof typeof F_RATIO): number {
  return Math.round(marketPrice * F_RATIO[kind]) - EXTRA;
}

type Row = {
  id: string;
  name: string;
  brand: string;
  category: string;
  model: string;
  jan: string;
  size: string;
  color: string;
  condition: string;
  purchase: string;
  market: string;
  stock: string;
  url: string;
  source: string;
  fetched: string;
};

const FRESH = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
const STALE = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);

let seq = 0;
function make(p: {
  prefix: string;
  name: string;
  brand: string;
  category: string;
  model?: string;
  jan?: string;
  size?: string;
  color?: string;
  condition: string;
  market: number | null;
  kind?: keyof typeof F_RATIO;
  purchase?: number | null;
  stock?: number | null;
  source?: string;
  fetched?: string;
  id?: string;
}): Row {
  seq++;
  const market = p.market;
  const purchase =
    p.purchase !== undefined ? p.purchase : market !== null && p.kind ? purchaseFor(market, p.kind) : null;
  return {
    id: p.id ?? `${p.prefix}-${String(seq).padStart(5, '0')}`,
    name: p.name,
    brand: p.brand,
    category: p.category,
    model: p.model ?? '',
    jan: p.jan ?? '',
    size: p.size ?? '',
    color: p.color ?? '',
    condition: p.condition,
    purchase: purchase === null ? '' : String(purchase),
    market: market === null ? '' : String(market),
    stock: p.stock === null ? '' : String(p.stock ?? 1),
    url: `https://example.invalid/${p.prefix.toLowerCase()}/${seq}`,
    source: p.source ?? '',
    fetched: p.fetched ?? '',
  };
}

// --------------------------------------------------------------- KOMEHYO風
// ブランド中古。一点物が中心なので在庫は1、状態はランク表記。
const KOMEHYO_CATALOG = [
  { name: 'ルイヴィトン モノグラム スピーディ30 ハンドバッグ', brand: 'ルイヴィトン', category: 'バッグ', model: 'M41526', color: 'ブラウン', market: 98000 },
  { name: 'シャネル マトラッセ チェーンショルダー 25', brand: 'シャネル', category: 'バッグ', model: 'A01112', color: 'ブラック', market: 620000 },
  { name: 'グッチ GGマーモント ミニバッグ', brand: 'グッチ', category: 'バッグ', model: '446744', color: 'ブラック', market: 148000 },
  { name: 'エルメス ガーデンパーティ PM', brand: 'エルメス', category: 'バッグ', model: 'GP-PM', color: 'エトゥープ', market: 380000 },
  { name: 'プラダ サフィアーノ 二つ折り財布', brand: 'プラダ', category: '財布', model: '1ML018', color: 'ネイビー', market: 42000 },
  { name: 'ロレックス デイトジャスト 36 自動巻', brand: 'ロレックス', category: '時計', model: '126234', color: 'シルバー', market: 1180000 },
  { name: 'オメガ シーマスター アクアテラ', brand: 'オメガ', category: '時計', model: '220.10.38', color: 'ブルー', market: 480000 },
  { name: 'セイコー グランドセイコー クオーツ', brand: 'セイコー', category: '時計', model: 'SBGX261', color: 'ホワイト', market: 210000 },
  { name: 'ルイヴィトン ダミエ ジッピーウォレット', brand: 'ルイヴィトン', category: '財布', model: 'N60015', color: 'ブラウン', market: 62000 },
  { name: 'グッチ GGスプリーム ラウンドファスナー財布', brand: 'グッチ', category: '財布', model: '456117', color: 'ベージュ', market: 46000 },
  { name: 'シャネル ココマーク ピアス', brand: 'シャネル', category: 'アクセサリー', model: 'A88429', color: 'ゴールド', market: 88000 },
  { name: 'エルメス エールライン トートMM', brand: 'エルメス', category: 'バッグ', model: 'HL-MM', color: 'ブラック', market: 96000 },
];

const KOMEHYO_CONDITIONS = ['Aランク', 'Bランク', 'ABランク', 'Sランク', 'Cランク'];
const KOMEHYO_KINDS: (keyof typeof F_RATIO)[] = [
  'STRONG_BUY', 'BUY', 'WATCH', 'LOW_PRIORITY', 'LOW_ROI', 'MARKET_TOO_LOW', 'NEGATIVE', 'BUY',
];

function buildKomehyo(): Row[] {
  const rows: Row[] = [];
  KOMEHYO_CATALOG.forEach((c, i) => {
    // 同じ商品を状態違いで3件ずつ。判定ケースは順番に一巡させる。
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k;
      rows.push(
        make({
          prefix: 'KMH',
          name: c.name,
          brand: c.brand,
          category: c.category,
          model: c.model,
          color: c.color,
          condition: KOMEHYO_CONDITIONS[idx % KOMEHYO_CONDITIONS.length],
          market: c.market,
          kind: KOMEHYO_KINDS[idx % KOMEHYO_KINDS.length],
          stock: 1,
          source: 'メルカリ売却済み中央値',
          fetched: idx % 5 === 0 ? STALE : FRESH,
        }),
      );
    }
  });

  // --- 意図的に入れる異常ケース ---
  rows.push(
    // 安すぎ：データ誤りか真贋の疑い → 人間確認
    make({
      prefix: 'KMH', name: 'ロレックス サブマリーナー デイト', brand: 'ロレックス', category: '時計',
      model: '126610LN', condition: 'Aランク', market: 1800000, purchase: 90000, stock: 1,
      source: '相場サイト', fetched: FRESH,
    }),
    // 高すぎ：データ誤り
    make({
      prefix: 'KMH', name: 'グッチ ホースビット ローファー', brand: 'グッチ', category: '靴',
      model: '406994', condition: 'Bランク', market: 38000, purchase: 152000, stock: 1,
      source: '相場サイト', fetched: FRESH,
    }),
    // 相場データが無い
    make({
      prefix: 'KMH', name: 'ボッテガヴェネタ イントレチャート 長財布', brand: 'ボッテガヴェネタ', category: '財布',
      condition: 'Aランク', market: null, purchase: 38000, stock: 1,
    }),
    // 状態表記が辞書に無い → 人間確認
    make({
      prefix: 'KMH', name: 'カルティエ タンクフランセーズ SM', brand: 'カルティエ', category: '時計',
      model: 'W51008Q3', condition: '当社基準 特A', market: 420000, kind: 'BUY', stock: 1,
      source: 'メルカリ売却済み中央値', fetched: FRESH,
    }),
    // 仕入価格が無い → データ不備
    make({
      prefix: 'KMH', name: 'ティファニー オープンハート ネックレス', brand: 'ティファニー', category: 'アクセサリー',
      condition: 'Aランク', market: 24000, purchase: null, stock: 1,
    }),
    // 在庫ゼロ
    make({
      prefix: 'KMH', name: 'エルメス ボリード31', brand: 'エルメス', category: 'バッグ',
      condition: 'Bランク', market: 520000, kind: 'STRONG_BUY', stock: 0,
      source: 'メルカリ売却済み中央値', fetched: FRESH,
    }),
  );

  // --- 重複ケース ---
  // L1: 同じ商品IDが2回出てくる
  const dupTarget = rows[0];
  rows.push({ ...dupTarget, id: dupTarget.id });
  // L2: 商品IDは違うが中身が同じ
  rows.push({ ...dupTarget, id: 'KMH-DUP-0002' });

  return rows;
}

// --------------------------------------------------------------- BOOKOFF風
// 新品・型番商品が混ざる。JANあり。在庫が複数ある行もある。
const BOOKOFF_CATALOG = [
  { name: 'Nintendo Switch 有機ELモデル ホワイト', brand: '任天堂', category: 'ゲーム機', model: 'HEG-S-KAAAA', jan: '4902370548495', market: 38000 },
  { name: 'PlayStation 5 デジタルエディション', brand: 'ソニー', category: 'ゲーム機', model: 'CFI-2000B01', jan: '4948872416283', market: 62000 },
  { name: 'ソニー ワイヤレスヘッドホン WH-1000XM5', brand: 'ソニー', category: 'オーディオ', model: 'WH-1000XM5', jan: '4548736133235', market: 42000 },
  { name: 'Apple AirPods Pro 第2世代', brand: 'アップル', category: 'オーディオ', model: 'MTJV3J/A', jan: '4549995402452', market: 33000 },
  { name: 'キヤノン EOS Kiss X10 ダブルズームキット', brand: 'キヤノン', category: 'カメラ', model: 'EOSKISSX10', jan: '4549292131857', market: 78000 },
  { name: 'ニコン Z fc ボディ', brand: 'ニコン', category: 'カメラ', model: 'ZFC', jan: '4960759905499', market: 96000 },
  { name: 'ゼルダの伝説 ティアーズ オブ ザ キングダム', brand: '任天堂', category: 'ゲームソフト', model: 'HAC-P-AWXPA', jan: '4902370548501', market: 6200 },
  { name: 'ポケットモンスター スカーレット', brand: '任天堂', category: 'ゲームソフト', model: 'HAC-P-AXQEA', jan: '4902370550733', market: 5200 },
  { name: 'ソニー ブラビア 55型 液晶テレビ', brand: 'ソニー', category: 'テレビ', model: 'KJ-55X80L', jan: '4548736142886', market: 118000 },
  { name: 'アップル iPad 第10世代 64GB Wi-Fi', brand: 'アップル', category: 'タブレット', model: 'MPQ03J/A', jan: '4549995362268', market: 46000 },
];

const BOOKOFF_CONDITIONS = ['新品', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり'];
const BOOKOFF_KINDS: (keyof typeof F_RATIO)[] = [
  'STRONG_BUY', 'BUY', 'WATCH', 'STRONG_BUY', 'LOW_PRIORITY', 'LOW_ROI', 'NEGATIVE',
];

function buildBookoff(): Row[] {
  const rows: Row[] = [];
  BOOKOFF_CATALOG.forEach((c, i) => {
    for (let k = 0; k < 4; k++) {
      const idx = i * 4 + k;
      rows.push(
        make({
          prefix: 'BKO',
          name: c.name,
          brand: c.brand,
          category: c.category,
          model: c.model,
          jan: c.jan,
          color: '',
          condition: BOOKOFF_CONDITIONS[idx % BOOKOFF_CONDITIONS.length],
          market: c.market,
          kind: BOOKOFF_KINDS[idx % BOOKOFF_KINDS.length],
          // 新品・未使用に近いものは複数在庫（再仕入れできる＝ステップアップ方式）
          stock: idx % 4 === 0 ? 12 : idx % 4 === 1 ? 6 : 1,
          source: 'Amazon/メルカリ 直近30日中央値',
          fetched: FRESH,
        }),
      );
    }
  });

  // 単価が小さく利益不足になるケース
  rows.push(
    make({
      prefix: 'BKO', name: '文庫本まとめ 20冊セット', brand: '', category: '本',
      condition: 'やや傷や汚れあり', market: 20000, kind: 'LOW_PROFIT', stock: 1,
      source: 'メルカリ 直近30日中央値', fetched: FRESH,
    }),
    make({
      prefix: 'BKO', name: 'コミック全巻セット 中古', brand: '', category: '本',
      condition: '傷や汚れあり', market: 15000, kind: 'LOW_PROFIT', stock: 1,
      source: 'メルカリ 直近30日中央値', fetched: FRESH,
    }),
    // 相場データ無し
    make({
      prefix: 'BKO', name: '型番不明 ジャンクプリンタ', brand: '', category: 'その他',
      condition: 'やや傷や汚れあり', market: null, purchase: 3000, stock: 1,
    }),
  );

  return rows;
}

// --------------------------------------------------------------- HARD OFF風
// 英語ヘッダ・ジャンク多め。状態表記が独自。
const HARDOFF_CATALOG = [
  { name: 'YAMAHA エレキギター PACIFICA 612', brand: 'YAMAHA', category: '楽器', model: 'PAC612VIIFM', market: 82000 },
  { name: 'Roland 電子ドラム TD-17KVX', brand: 'ROLAND', category: '楽器', model: 'TD-17KVX', market: 168000 },
  { name: 'DENON プリメインアンプ PMA-600NE', brand: 'DENON', category: 'オーディオ', model: 'PMA-600NE', market: 48000 },
  { name: 'THE NORTH FACE ヌプシ ダウンジャケット', brand: 'ノースフェイス', category: 'アパレル', model: 'ND92335', size: 'L', market: 34000 },
  { name: 'NIKE エアジョーダン1 レトロ ハイ OG', brand: 'ナイキ', category: 'スニーカー', model: '555088-063', size: '27.0', market: 42000 },
  { name: 'NEW BALANCE M990 V6', brand: 'ニューバランス', category: 'スニーカー', model: 'M990GL6', size: '27.5', market: 32000 },
  { name: 'ADIDAS SAMBA OG', brand: 'アディダス', category: 'スニーカー', model: 'B75806', size: '26.5', market: 24000 },
  { name: 'Panasonic ドラム式洗濯乾燥機', brand: 'PANASONIC', category: '生活家電', model: 'NA-VX800BL', market: 98000 },
];

const HARDOFF_CONDITIONS = ['A', 'B', 'C', 'ジャンク', 'S'];
const HARDOFF_KINDS: (keyof typeof F_RATIO)[] = [
  'BUY', 'WATCH', 'STRONG_BUY', 'LOW_PRIORITY', 'MARKET_TOO_LOW', 'NEGATIVE',
];

function buildHardoff(): Row[] {
  const rows: Row[] = [];
  HARDOFF_CATALOG.forEach((c, i) => {
    for (let k = 0; k < 4; k++) {
      const idx = i * 4 + k;
      rows.push(
        make({
          prefix: 'HDO',
          name: c.name,
          brand: c.brand,
          category: c.category,
          model: c.model,
          size: c.size ?? '',
          condition: HARDOFF_CONDITIONS[idx % HARDOFF_CONDITIONS.length],
          market: c.market,
          kind: HARDOFF_KINDS[idx % HARDOFF_KINDS.length],
          stock: 1,
          source: idx % 3 === 0 ? 'スニダン直近取引' : '',
          fetched: idx % 3 === 0 ? FRESH : '',
        }),
      );
    }
  });

  rows.push(
    // 独自の状態表記 → 人間確認
    make({
      prefix: 'HDO', name: 'SONY ヘッドホン MDR-1AM2', brand: 'ソニー', category: 'オーディオ',
      model: 'MDR-1AM2', condition: '難あり中古(通電確認のみ)', market: 22000, kind: 'BUY', stock: 1,
      source: 'メルカリ 直近30日中央値', fetched: FRESH,
    }),
    // 安すぎ
    make({
      prefix: 'HDO', name: 'NIKE ダンクロー パンダ', brand: 'ナイキ', category: 'スニーカー',
      model: 'DD1391-100', size: '27.0', condition: 'A', market: 26000, purchase: 2000, stock: 1,
      source: 'スニダン直近取引', fetched: FRESH,
    }),
    // 高すぎ
    make({
      prefix: 'HDO', name: 'ROLAND シンセサイザー JUNO-DS61', brand: 'ROLAND', category: '楽器',
      model: 'JUNO-DS61', condition: 'B', market: 62000, purchase: 210000, stock: 1,
      source: '', fetched: '',
    }),
  );

  return rows;
}

// --------------------------------------------------------------- 通常在庫（大量）
/**
 * 実際の仕入先リストは「ほとんどが利益の出ない普通の在庫」で、
 * その中に数%だけ仕入れるべき商品が埋もれている。
 * AI費用の関門が効いているか（AI処理対象が全体の数%に収まるか）を
 * 現実に近い比率で確かめるため、利益の出ない在庫を大量に混ぜる。
 */
const BULK_CATALOG = [
  { name: '中古 ノートパソコン 15型', brand: 'NEC', category: '家電', model: 'PC-GN', market: 34000 },
  { name: '中古 電子レンジ', brand: 'SHARP', category: '生活家電', model: 'RE-SS', market: 12000 },
  { name: '中古 掃除機 コードレス', brand: 'DYSON', category: '生活家電', model: 'V8', market: 21000 },
  { name: '中古 炊飯器 5.5合', brand: 'ZOJIRUSHI', category: '生活家電', model: 'NP-BK', market: 15000 },
  { name: '中古 液晶モニタ 24型', brand: 'IODATA', category: '家電', model: 'LCD-MF', market: 11000 },
  { name: '中古 コンパクトデジタルカメラ', brand: 'CANON', category: 'カメラ', model: 'IXY650', market: 13000 },
  { name: '中古 ミラーレス標準ズームレンズ', brand: 'NIKON', category: 'カメラ', model: 'NIKKOR-Z', market: 28000 },
  { name: '中古 ブルートゥーススピーカー', brand: 'JBL', category: 'オーディオ', model: 'FLIP6', market: 9000 },
  { name: '中古 腕時計 ソーラー電波', brand: 'CASIO', category: '時計', model: 'OCW-S', market: 46000 },
  { name: '中古 ダウンジャケット', brand: 'UNIQLO', category: 'アパレル', model: 'DWN-01', market: 4200 },
  { name: '中古 ランニングシューズ', brand: 'ASICS', category: 'スニーカー', model: 'GEL-KAYANO', market: 8600 },
  { name: '中古 ビジネスバッグ 本革', brand: 'PORTER', category: 'バッグ', model: 'PT-BIZ', market: 18000 },
  { name: '中古 二つ折り財布', brand: 'COACH', category: '財布', model: 'CH-W2', market: 9800 },
  { name: '中古 アコースティックギター', brand: 'YAMAHA', category: '楽器', model: 'FG830', market: 26000 },
  { name: '中古 キーボード 61鍵', brand: 'CASIO', category: '楽器', model: 'CT-S300', market: 14000 },
  { name: '中古 ゲームソフト 人気タイトル', brand: 'NINTENDO', category: 'ゲームソフト', model: 'HAC-GEN', market: 3800 },
  { name: '中古 家庭用ゲーム機 旧型', brand: 'SONY', category: 'ゲーム機', model: 'CUH-2200', market: 17000 },
  { name: '中古 タブレット 10型', brand: 'LENOVO', category: 'タブレット', model: 'TB-J606', market: 16000 },
  { name: '中古 スマートウォッチ', brand: 'GARMIN', category: '時計', model: 'FR-255', market: 24000 },
  { name: '中古 空気清浄機', brand: 'PANASONIC', category: '生活家電', model: 'F-VXR', market: 19000 },
  { name: '中古 コーヒーメーカー', brand: 'DELONGHI', category: '生活家電', model: 'ECAM', market: 32000 },
  { name: '中古 電動アシスト自転車 バッテリー', brand: 'YAMAHA', category: 'その他', model: 'X0T-82', market: 22000 },
  { name: '中古 プロジェクター 小型', brand: 'EPSON', category: '家電', model: 'EF-12', market: 41000 },
  { name: '中古 マイク コンデンサー', brand: 'AUDIOTECHNICA', category: 'オーディオ', model: 'AT2020', market: 8800 },
  { name: '中古 トートバッグ ナイロン', brand: 'PRADA', category: 'バッグ', model: 'BR4001', market: 52000 },
];

/** 大半が利益の出ない構成。WATCH以上はごくわずかしか出さない。 */
const BULK_KINDS: (keyof typeof F_RATIO)[] = [
  'LOW_ROI', 'MARKET_TOO_LOW', 'NEGATIVE', 'LOW_ROI', 'NEGATIVE',
  'MARKET_TOO_LOW', 'LOW_ROI', 'NEGATIVE', 'MARKET_TOO_LOW', 'LOW_ROI',
  'NEGATIVE', 'MARKET_TOO_LOW', 'LOW_PRIORITY', 'NEGATIVE', 'LOW_ROI',
  'WATCH', 'MARKET_TOO_LOW', 'NEGATIVE', 'LOW_ROI', 'NEGATIVE',
];

function buildBulk(prefix: string, count: number, conditions: string[], withJan: boolean): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const c = BULK_CATALOG[i % BULK_CATALOG.length];
    // 同じ商品でも相場が少しずつ違う想定にして、内容一致の重複扱いにならないようにする
    const market = c.market + (i % 17) * 500;
    rows.push(
      make({
        prefix,
        name: `${c.name} #${i + 1}`,
        brand: c.brand,
        category: c.category,
        model: `${c.model}-${i + 1}`,
        jan: withJan && i % 3 === 0 ? String(4900000000000 + i) : '',
        condition: conditions[i % conditions.length],
        market,
        kind: BULK_KINDS[i % BULK_KINDS.length],
        stock: i % 9 === 0 ? 4 : 1,
        source: i % 4 === 0 ? '相場サイト 直近30日中央値' : '',
        fetched: i % 4 === 0 ? FRESH : '',
      }),
    );
  }
  return rows;
}

// --------------------------------------------------------------- CSV 出力
function toCsv(header: string[], rows: string[][]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

function komehyoCsv(rows: Row[]): string {
  const header = ['管理番号', '商品名', 'ブランド', 'カテゴリ', '型番', 'サイズ', 'カラー', 'ランク', '仕入価格', '相場', '在庫', '商品URL', '相場出典', '相場取得日'];
  return toCsv(
    header,
    rows.map((r) => [r.id, r.name, r.brand, r.category, r.model, r.size, r.color, r.condition, r.purchase, r.market, r.stock, r.url, r.source, r.fetched]),
  );
}

function bookoffCsv(rows: Row[]): string {
  const header = ['商品ID', 'タイトル', 'メーカー', '分類', '品番', 'JANコード', '状態', '仕入値', '市場価格', '在庫数', 'リンク', '相場ソース', '相場日時'];
  return toCsv(
    header,
    rows.map((r) => [r.id, r.name, r.brand, r.category, r.model, r.jan, r.condition, r.purchase, r.market, r.stock, r.url, r.source, r.fetched]),
  );
}

function hardoffCsv(rows: Row[]): string {
  const header = ['id', 'name', 'brand', 'category', 'model', 'size', 'condition', 'cost', 'market_price', 'stock', 'url', 'market_price_source', 'market_fetched_at'];
  return toCsv(
    header,
    rows.map((r) => [r.id, r.name, r.brand, r.category, r.model, r.size, r.condition, r.purchase, r.market, r.stock, r.url, r.source, r.fetched]),
  );
}

// --------------------------------------------------------------- 実行
async function main() {
  const reset = process.argv.includes('--reset') || process.argv.includes('--fresh');
  const dbPath = path.join(process.cwd(), 'data', 'commerce.db');
  if (reset && fs.existsSync(dbPath)) {
    for (const f of ['commerce.db', 'commerce.db-wal', 'commerce.db-shm']) {
      const p = path.join(process.cwd(), 'data', f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    console.log('既存のデータベースを削除しました。');
  }

  await ensureReady();

  const samplesDir = path.join(process.cwd(), 'samples');
  fs.mkdirSync(samplesDir, { recursive: true });

  const komehyo = [...buildKomehyo(), ...buildBulk('KMH', 300, KOMEHYO_CONDITIONS.filter((c) => c !== 'ABランク'), false)];
  const bookoff = [...buildBookoff(), ...buildBulk('BKO', 300, BOOKOFF_CONDITIONS, true)];
  const hardoff = [...buildHardoff(), ...buildBulk('HDO', 300, HARDOFF_CONDITIONS, false)];

  const files: { supplier: string; filename: string; text: string }[] = [
    { supplier: 'KOMEHYO', filename: 'komehyo_sample.csv', text: komehyoCsv(komehyo) },
    { supplier: 'BOOKOFF', filename: 'bookoff_sample.csv', text: bookoffCsv(bookoff) },
    { supplier: 'HARDOFF', filename: 'hardoff_sample.csv', text: hardoffCsv(hardoff) },
  ];

  for (const f of files) {
    fs.writeFileSync(path.join(samplesDir, f.filename), f.text, 'utf8');
  }
  console.log(`架空データを作りました：合計 ${komehyo.length + bookoff.length + hardoff.length} 行 → samples/`);

  for (const f of files) {
    const stats = await runImport({ supplierCode: f.supplier, text: f.text, filename: f.filename });
    console.log(
      `[${f.supplier}] 読込${stats.rowCount} 新規${stats.inserted} 更新${stats.updated} ` +
        `重複${stats.duplicatedL1 + stats.duplicatedL2} 不備${stats.invalid} 状態不明${stats.unknownCondition}`,
    );
  }

  const t0 = Date.now();
  const analyzed = await runAnalyze({ force: true });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `分析：対象${analyzed.targetCount} 完了${analyzed.analyzed} 仕入候補${analyzed.profitable} ` +
      `除外${analyzed.skipped} 人間確認${analyzed.manualReview} ` +
      `AI候補${analyzed.aiCandidates}（全体の${(analyzed.aiCandidateRate * 100).toFixed(1)}%） ${sec}秒`,
  );

  await seedSalesHistory();
  const stats = await rebuildPremiumRatioStats();
  console.log(`相場倍率の学習セグメント：${stats.segments} 件`);

  await seedVenueMarketData();

  const routes = await runRoutes();
  console.log(
    `Route：組み合わせ${routes.combinationsTried} 保存${routes.routesGenerated} ` +
      `使える${routes.routesOk} 使えない${routes.routesBlocked} ` +
      `ベスト決定${routes.productsWithRoute}商品 SHADOW${routes.shadowOpened}件`,
  );

  const decisions = await all(
    `SELECT decision, COUNT(*) AS n FROM supplier_products GROUP BY decision ORDER BY n DESC`,
  );
  console.log('判定の内訳：', decisions.map((d) => `${d.decision ?? '未判定'}=${d.n}`).join(' '));
}

/**
 * 相場倍率の学習が動くことを確認するための架空の販売実績。
 * 打ち切り（censored）も混ぜて、「売れなかった」と混同しないことを確かめる。
 */
async function seedSalesHistory(): Promise<void> {
  const now = new Date().toISOString();
  const records: [string, string, number, number, number, number, number, string][] = [
    // segment_type, segment_key, market, listing, sold, ratio, days, result
    ['brand_category', 'LOUIS VUITTON|バッグ', 98000, 105000, 105000, 1.07, 12, 'SOLD'],
    ['brand_category', 'LOUIS VUITTON|バッグ', 92000, 97000, 97000, 1.054, 9, 'SOLD'],
    ['brand_category', 'LOUIS VUITTON|バッグ', 110000, 121000, 121000, 1.1, 21, 'SOLD'],
    ['brand_category', 'LOUIS VUITTON|バッグ', 88000, 92000, 92000, 1.045, 6, 'SOLD'],
    ['brand_category', 'LOUIS VUITTON|バッグ', 102000, 112000, 112000, 1.098, 18, 'SOLD'],
    ['brand_category', 'LOUIS VUITTON|バッグ', 95000, 140000, 0, 1.47, 0, 'CENSORED'],
    ['brand_category', 'GUCCI|財布', 46000, 47000, 47000, 1.02, 8, 'SOLD'],
    ['brand_category', 'GUCCI|財布', 44000, 45000, 45000, 1.023, 11, 'SOLD'],
  ];
  const existing = await all('SELECT COUNT(*) AS n FROM sales_records');
  if (Number(existing[0]?.n ?? 0) > 0) return;
  for (const r of records) {
    await run(
      `INSERT INTO sales_records
        (segment_type, segment_key, pricing_mode, market_price, listing_price, sold_price,
         market_premium_ratio, days_to_sell, result, created_at)
       VALUES (?, ?, 'PREMIUM_RATIO', ?, ?, ?, ?, ?, ?, ?)`,
      [r[0], r[1], r[2], r[3], r[4] || null, r[5], r[6] || null, r[7], now],
    );
  }
}

/**
 * 市場ごとの相場（架空）。
 *
 * これが無いと、どの市場も同じ相場を当てはめた仮定値になってしまい、
 * 「メルカリでは高い／ヤフオクでは安い」という比較そのものが検証できない。
 * 実在サイトから取ったデータではなく、市場ごとの差を作った完全な作り物。
 *
 * わざと市場ごとに「成約価格が取れる／出品価格しか取れない」を混ぜてある。
 * データ信頼度の差が判定に効くことを確かめるため。
 */
async function seedVenueMarketData(): Promise<void> {
  // side, 相場倍率, 価格の種類, 成約件数, 出品件数, 売却日数, 価格ばらつき
  const PROFILE: [string, string, number, string, number | null, number | null, number | null, number | null][] = [
    ['MERCARI', 'SELL', 1.0, '成約', 14, 30, 12, 0.08],
    ['RAKUMA', 'SELL', 0.96, '成約', 6, 22, 18, 0.09],
    ['YAHUOKU', 'SELL', 0.93, '成約', 9, 26, 10, 0.14],
    ['AMAZON', 'SELL', 1.12, '出品', 3, 12, 25, 0.06],
    ['EBAY', 'SELL', 1.3, '出品', 2, 9, 40, 0.2],
    ['OWN_EC', 'SELL', 1.05, '出品', null, 1, 30, 0.05],
    // 一番高く売れるが、いま出品できない市場。取り逃しが画面に出ることを確かめる
    ['SNKRDUNK', 'SELL', 1.22, '成約', 11, 18, 9, 0.05],
    // 買う側。ここがあるから「メルカリで買ってAmazonで売る」という逆方向も計算できる
    ['MERCARI', 'BUY', 0.72, '出品', null, 30, null, 0.08],
    ['YAHUOKU', 'BUY', 0.68, '出品', null, 26, null, 0.14],
    ['SNKRDUNK', 'BUY', 0.8, '出品', null, 18, null, 0.05],
  ];

  const rows = await all(`
    SELECT sp.brand, sp.model_number, sp.jan, sp.color, sp.size, sp.market_price, sp.category_key
      FROM supplier_products sp
      JOIN products p ON p.id = sp.product_id
     WHERE sp.market_price IS NOT NULL AND sp.market_price > 0
       AND (sp.skip_reason IS NULL OR sp.skip_reason NOT IN ('DUPLICATE','INVALID_DATA'))
     ORDER BY sp.id`);

  const header = '市場,区分,ブランド,型番,JAN,価格,価格の種類,成約件数,出品件数,平均売却日数,価格ばらつき,取得日';
  const lines: string[] = [header];
  const day = new Date().toISOString().slice(0, 10);
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  // 全商品に相場を付けると「どの市場の値も分かっている」という現実にない状態になる。
  // 8件に1件だけ実データがある想定にして、データがある商品と無い商品の両方を作る。
  let n = 0;
  rows.forEach((r, i) => {
    if (i % 8 !== 0) return;
    const market = Number(r.market_price);
    for (const [venue, side, ratio, basis, sold, listing, days, sd] of PROFILE) {
      // スニダンはスニーカー専門。他カテゴリの相場は存在しないので作らない
      if (venue === 'SNKRDUNK' && String(r.category_key ?? '') !== 'sneaker') continue;
      lines.push([
        venue, side, String(r.brand ?? ''), String(r.model_number ?? ''), String(r.jan ?? ''),
        String(Math.round(market * ratio)), basis,
        sold === null ? '' : String(sold), listing === null ? '' : String(listing),
        days === null ? '' : String(days), sd === null ? '' : String(sd), day,
      ].map((v) => esc(String(v))).join(','));
      n++;
    }
  });

  const csv = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(process.cwd(), 'samples', 'venue_market_sample.csv'), csv, 'utf8');
  const res = await importMarketData(csv);
  console.log(`市場ごとの相場（架空）：${n}行 → 取込${res.inserted}件 不備${res.invalid}件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
