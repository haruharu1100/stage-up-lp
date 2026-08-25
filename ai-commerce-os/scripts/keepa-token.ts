/**
 * 【キーが生きているかだけを確かめる】（Phase 3.10・2026-08-25）
 *
 *   npm run keepa:token
 *
 * ------------------------------------------------------------------
 * 【なぜ商品取得とは別のコマンドにするか】
 *
 * キーが間違っていることに、商品を取りにいって初めて気づくのは順序が悪い。
 * 間違ったキーで `product` を叩くと、枠を消費したうえで空の結果が返ってくることがある。
 *
 * Keepa の `token` エンドポイントは**枠を消費しない**。
 * だから「キーが有効か」「いま何個残っているか」だけを、費用ゼロで先に確かめられる。
 *
 * ★ここでもキーの値は一切出さない。出すのは「設定されているか」だけ。
 *   商品データは取らない（このコマンドは何も保存しない）。
 */
import { loadDotEnv } from '../lib/dotenv';
import { fetchKeepaTokenStatus, keepaKeyStatus } from '../lib/keepa/client';
import { bucketCapacity, tokenHeadline } from '../lib/keepa/tokens';

const LINE = '='.repeat(72);

function num(v: number | null | undefined, unit = ''): string {
  return v === null || v === undefined ? '不明' : `${v.toLocaleString()}${unit}`;
}

async function main(): Promise<void> {
  const names = loadDotEnv();

  console.log(LINE);
  console.log('Keepa：キーの有効性と残り枠の確認（商品は取りません・枠を消費しません）');
  console.log(LINE);

  const key = keepaKeyStatus();
  console.log(`.env から読み込んだ変数：${names.length}件（名前だけ。値は表示しません）`);
  console.log(`APIキー：${key.messageJa}`);
  if (!key.configured) {
    console.log('\n通信せずに終了します。');
    process.exit(1);
  }

  const r = await fetchKeepaTokenStatus();

  if (!r.ok) {
    console.log(`\n${LINE}`);
    console.log('【確認できませんでした】');
    console.log(`  ${r.errorJa ?? '理由不明'}`);
    console.log('  キーが正しいか、契約が有効かをご確認ください。');
    console.log('  ※ 商品は取得していません。');
    console.log(LINE);
    process.exit(1);
  }

  const rate = r.tokens.refillRate ?? 0;
  console.log(`\n${LINE}`);
  console.log('【キーは有効です】');
  console.log(LINE);
  console.log(`  いまの残り：${num(r.tokens.tokensLeft)}`);
  console.log(`  1分あたりの補充：${num(r.tokens.refillRate)}`);
  console.log(`  貯められる上限：${num(bucketCapacity(rate))}（補充速度×60分。未使用ぶんは60分で失効）`);
  console.log(`  次の補充まで：${num(r.tokens.refillIn, 'ミリ秒')}`);
  console.log(`  補充速度の低下：${num(r.tokens.tokenFlowReduction)}`);
  console.log(`  この確認で使った枠：${num(r.tokens.tokensConsumed)}（token は無料）`);
  console.log(`\n  ${tokenHeadline({ refillRatePerMin: rate, tokensLeft: r.tokens.tokensLeft, usedToday: 0 })}`);
  console.log(`\n${LINE}`);
  console.log('商品は取得していません。取得は npm run keepa:one -- --asin=... で1件だけ行います。');
  console.log(LINE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
