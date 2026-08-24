/**
 * AliExpress 異常値の監査（npm run aliexpress:audit）
 * ===================================================================
 * ユーザー指示（2026-08-20）：
 *   「Keepaで今回発生したのと同じ問題をAliExpressでも想定してください。
 *     -1 / null / 空文字 / 特殊コード / 存在しない価格 / 0円 / 異常な通貨 / 異常MOQ
 *     などを計算へ流さない。」
 *
 * Keepaで実際に起きたこと（同じ事故を繰り返さないために書き残す）
 *   ・`-1`＝不明 を `=== -1` でしか見ておらず、`-2` が「−2円」として利益計算に流れた。
 *   ・`p.packageWeight || null` で受けていたため、`-1` が truthy で素通りし、
 *     マイナスの重量がFBA手数料の計算に入っていた。
 *
 * このスクリプトがやること（★外部APIは1回も呼びません。課金0円）
 *   1. 危険な値の一覧を関門（ValueGuard）に通し、**本当に弾けるか**を実演する。
 *      → 1つでも通り抜けたら失敗として終了する（回帰テストを兼ねる）。
 *   2. 保存済みの応答原文（api_response_samples）があれば、そこから実データを取り出して
 *      同じ関門に通し、実際に何件弾いたかを日本語で出す。
 *   3. 呼び出し履歴（discovery_call_log）を種類別に集計し、
 *      **「0件」と「失敗」を必ず区別して**表示する。
 */
import { all, migrate } from '../lib/db/client';
import { ValueGuard, describeGuardReport } from '../lib/providers/aliexpressValues';
import { outcomeSummary, OUTCOME_LABEL } from '../lib/research/discoveryOutcome';

/** 「これは絶対に計算へ流してはいけない」値の一覧。実際にKeepaで事故ったものを含む */
const DANGEROUS: { 場面: string; 値: unknown; なぜ危険か: string }[] = [
  { 場面: '価格', 値: -1, なぜ危険か: '「不明」を表す特殊値。マイナスの仕入値として計算に入る' },
  { 場面: '価格', 値: -2, なぜ危険か: '★Keepaで実際に事故った値。「−2円」で売れると判定していた' },
  { 場面: '価格', 値: 0, なぜ危険か: '0円の商品は存在しない。0円仕入＝無限に儲かる、と誤判定する' },
  { 場面: '価格', 値: null, なぜ危険か: '項目が返ってこなかっただけなのに0として扱われる' },
  { 場面: '価格', 値: '', なぜ危険か: '空文字は Number("") で 0 になる。0円と同じ事故' },
  { 場面: '価格', 値: 'N/A', なぜ危険か: '数字として読めない。NaN のまま計算に入ると全部おかしくなる' },
  { 場面: '価格', 値: 9999999, なぜ危険か: '「不明」を表す特殊値として使われることがある' },
  { 場面: '価格', 値: 99999999999, なぜ危険か: '桁が現実的でない（セント単位のまま等の取り違え）' },
  { 場面: '通貨', 値: '', なぜ危険か: '通貨が分からなければ円に換算できない' },
  { 場面: '通貨', 値: 'XXXX', なぜ危険か: '3文字でない＝通貨コードとして成立しない' },
  { 場面: '通貨', 値: '???', なぜ危険か: '記号は通貨コードではない' },
  { 場面: 'MOQ', 値: 0, なぜ危険か: '最低0個の注文はありえない' },
  { 場面: 'MOQ', 値: -1, なぜ危険か: '「不明」の特殊値。マイナスのロット数で仕入額が負になる' },
  { 場面: 'MOQ', 値: 999999999, なぜ危険か: '10万個超のMOQは現実的でない' },
  { 場面: '重量', 値: -1, なぜ危険か: '★Keepaで実際に事故った値。マイナス重量でFBA手数料が狂う' },
  { 場面: '重量', 値: 0, なぜ危険か: '0gの商品は存在しない。送料が0円になる' },
  { 場面: '重量', 値: 900000, なぜ危険か: '500kg超。小型軽量を前提にした判定が壊れる' },
  { 場面: '商品URL', 値: '', なぜ危険か: 'URLが無い＝購入ページへ飛べない。Aランク禁止の条件' },
  { 場面: '商品URL', 値: 'javascript:alert(1)', なぜ危険か: 'http(s)でない。クリックさせてはいけない' },
  { 場面: '商品URL', 値: 'https://example.com/item/1', なぜ危険か: 'AliExpress以外へ飛ばしてしまう' },
  { 場面: '商品URL', 値: 'https://aliexpress.evil.com/x', なぜ危険か: '似せた別ドメイン。本物ではない' },
  { 場面: '商品名', 値: 'null', なぜ危険か: '文字列の "null"。名前として保存すると気づけない' },
  { 場面: '商品名', 値: '-', なぜ危険か: '中身が無いことを表す記号。商品名ではない' },
];

/** 場面ごとに、どの関門を通すか */
function guardFor(g: ValueGuard, 場面: string, 値: unknown): unknown {
  switch (場面) {
    case '価格': return g.price('price', 値);
    case '通貨': return g.currency('currency', 値);
    case 'MOQ': return g.moq('moq', 値);
    case '重量': return g.weightG('weightG', 値);
    case '商品URL': return g.purchaseUrl('purchaseUrl', 値);
    default: return g.text('title', 値);
  }
}

/** 保存済みの応答原文から、商品らしき配列を素直に取り出す */
function itemsFromSample(body: string): any[] {
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const found: any[] = [];
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) {
      for (const el of node) {
        if (el && typeof el === 'object' && (el.itemId || el.product_id || el.productId)) found.push(el);
        else walk(el, depth + 1);
      }
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(json, 0);
  return found;
}

async function main() {
  console.log('=== AliExpress 異常値の監査 ===\n');
  console.log('★外部APIは1回も呼びません（課金0円）。\n');
  await migrate();

  // ---- 1. 危険な値を本当に弾けるか、実演する ----------------------
  console.log('--- 1. 危険な値を関門に通してみる（弾けなければ失敗として止まります）---\n');
  const g1 = new ValueGuard();
  const 通り抜けた: string[] = [];

  for (const d of DANGEROUS) {
    const result = guardFor(g1, d.場面, d.値);
    const 弾いた = result === null;
    const 表示値 = JSON.stringify(d.値 ?? null);
    console.log(`  ${弾いた ? '弾いた ○' : '★通した ×'}  ${d.場面.padEnd(6)} ${表示値.padEnd(28)} ${d.なぜ危険か}`);
    if (!弾いた) 通り抜けた.push(`${d.場面}=${表示値}（受け取った値：${String(result)}）`);
  }

  console.log(`\n  試した危険な値：${DANGEROUS.length}件／弾いた：${DANGEROUS.length - 通り抜けた.length}件`);
  if (通り抜けた.length) {
    console.log('\n★★ 危険な値が計算へ流れる状態です。ここで止めます。');
    for (const t of 通り抜けた) console.log(`    通り抜けた：${t}`);
    process.exit(1);
  }
  console.log('  → 危険な値はすべて「不明（UNKNOWN）」として止まりました。計算には流れません。');

  // ---- 2. 実データがあれば、同じ関門に通す ------------------------
  console.log('\n--- 2. 保存してある本物の応答を、同じ関門に通す ---');
  const samples = await all(
    `SELECT api_name, sample_kind, redacted_body, created_at FROM api_response_samples
      WHERE provider = 'aliexpress' ORDER BY created_at DESC LIMIT 20`,
  ).catch(() => [] as any[]);

  if (!samples.length) {
    console.log('  保存されている応答はまだ0件です。');
    console.log('  ★理由：AliExpressの鍵がまだ無く、1回も呼んでいないためです。');
    console.log('    （「弾いた件数0件」ではなく「そもそも試していない」という意味です）');
  } else {
    const g2 = new ValueGuard();
    let 商品件数 = 0;
    for (const s of samples) {
      const items = itemsFromSample(String(s.redacted_body ?? ''));
      商品件数 += items.length;
      for (const it of items) {
        g2.text('title', it.title ?? it.product_title ?? it.subject);
        g2.price('price', it.targetSalePrice ?? it.salePrice ?? it.sale_price);
        g2.currency('currency', it.salePriceCurrency ?? it.sale_price_currency);
        g2.imageUrl('image', it.itemMainPic ?? it.product_main_image_url);
        g2.purchaseUrl('purchaseUrl', it.itemUrl ?? it.product_detail_url);
        g2.moq('moq', it.sku_bulk_order ?? it.minOrderQuantity);
        g2.stock('stock', it.sku_available_stock ?? it.availableStock);
        g2.weightG('weightG', it.gross_weight ?? it.packageWeight);
      }
    }
    console.log(`  応答${samples.length}件／商品${商品件数}件を確認しました。\n`);
    const lines = describeGuardReport(g2.report());
    if (lines.length) lines.forEach((l) => console.log(l));
    else console.log('  取り出せる項目がありませんでした。');
  }

  // ---- 3. 「0件」と「失敗」を区別して集計 --------------------------
  console.log('\n--- 3. 呼び出し結果の内訳（0件と失敗を必ず区別する）---');
  const sum = await outcomeSummary(30);
  console.log(`  ${sum.headline}\n`);
  if (sum.rows.length) {
    for (const r of sum.rows) {
      console.log(`  ${r.isFailure ? '失敗' : '正常'}  ${String(r.count).padStart(4)}回  ${r.label}`);
    }
  } else {
    console.log(`  ${OUTCOME_LABEL.NO_CREDENTIALS}`);
  }

  console.log('\n=== 監査おわり ===');
  console.log('  この監査は、鍵が無くても「守りが効いているか」だけは必ず確認できます。');
}

main().catch((e) => {
  console.error('失敗しました：', e?.message ?? e);
  process.exit(1);
});
