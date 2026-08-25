/**
 * 【保存済みの生データだけで、読み取りを検算する】（Phase 3.10・2026-08-25）
 *
 *   npm run keepa:audit                 … 保存済みのASIN一覧を出す
 *   npm run keepa:audit -- --asin=B0…   … その1件を検算する
 *
 * ------------------------------------------------------------------
 * 【このコマンドは Keepa へ一切通信しません】
 *
 * 枠（Token）を1つも使わない。APIキーも読まない。
 * 使うのは、前に取得したときに保存しておいた**生の応答**だけである。
 *
 * なぜこれが要るのか：
 *   読み取り方を直したとき、直ったかどうかを確かめるのに取り直すと、
 *   ①枠を使う ②そのあいだに相場が動く の2つが起きる。
 *   そうすると「直ったから値が変わったのか」「相場が動いたから変わったのか」が
 *   区別できなくなる。生データを残してあるのは、まさにこのためである。
 *
 * ------------------------------------------------------------------
 * 【何を見るか】
 *
 *   ・応答の「形」が想定と違っていないか（SCHEMA_MISMATCH）
 *   ・「不明」の理由を2つに分ける
 *       DATA_NOT_AVAILABLE     … Keepaに値がない（市場データの問題）
 *       PARSER_OR_SCHEMA_ERROR … 値はあるのに読めていない（**当社の不具合**）
 *   ・主要フィールドを1行ずつ突き合わせる
 *   ・データの鮮度（何日前の数字か）
 */
import {
  auditKeepaFields,
  keepaFreshness,
  normalizeKeepaProduct,
  scoreCompetition,
  judgeTrend,
} from '../lib/keepa/normalize';
import { KEEPA_FIELD_SPECS, pickProduct } from '../lib/keepa/schema';
import { latestRawResponse, savedRawAsins } from '../lib/keepa/store';

const LINE = '='.repeat(72);

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
}

async function main(): Promise<void> {
  console.log(LINE);
  console.log('Keepa：保存済みデータの検算（通信しません・枠を1つも使いません）');
  console.log(LINE);

  const asin = (arg('asin') ?? '').toUpperCase();

  if (!asin) {
    const list = await savedRawAsins();
    console.log('\n保存済みの生データがあるASIN（新しい順）：');
    if (list.length === 0) {
      console.log('  ありません。まず npm run keepa:one -- --asin=… で1件取得してください。');
    } else {
      for (const r of list) console.log(`  ・${r.asin}（取得：${r.fetchedAt}）`);
      console.log('\n検算するには：npm run keepa:audit -- --asin=' + list[0].asin);
    }
    console.log(`\n${LINE}`);
    return;
  }

  const saved = await latestRawResponse(asin);
  if (!saved) {
    console.log(`\n${asin} の保存済みデータが見つかりませんでした。`);
    console.log('※ ここで取りにはいきません（このコマンドは通信しない約束のため）。');
    process.exit(1);
  }

  const product = pickProduct(saved.raw);
  if (!product) {
    console.log(`\n${asin} の応答に商品データが入っていませんでした。`);
    process.exit(1);
  }

  const n = normalizeKeepaProduct(product);
  const fresh = keepaFreshness(n);

  console.log(`\n対象：${asin}（保存日時：${saved.fetchedAt}）`);
  console.log(`商品名：${n.title ?? '不明'}`);
  console.log(`検算した項目数：${KEEPA_FIELD_SPECS.length}`);

  /* ---------------------------------------------------------------- */
  console.log(`\n${LINE}`);
  console.log('① 応答の「形」の監査（SCHEMA_AUDIT）');
  console.log(LINE);
  console.log(`  ${n.schema.headlineJa}`);
  if (n.schema.mismatches.length > 0) {
    console.log('\n  ★SCHEMA_MISMATCH（想定と違う形で来ている）：');
    for (const m of n.schema.mismatches) {
      console.log(`   ・${m.labelJa}（${m.path}）`);
      console.log(`       ${m.detailJa}`);
    }
  }
  if (n.schema.notes.length > 0) {
    console.log('\n  （参考）値が入っていなかった項目 — 形は壊れていません：');
    for (const t of n.schema.notes) console.log(`   ・${t.labelJa}（${t.path}）：${t.detailJa}`);
  }

  /* ---------------------------------------------------------------- */
  console.log(`\n${LINE}`);
  console.log('② 「不明」の理由を2つに分ける');
  console.log(LINE);
  const notAvail = n.unknownDetails.filter((u) => u.reason === 'DATA_NOT_AVAILABLE');
  console.log(`  DATA_NOT_AVAILABLE（Keepaに値がない）：${notAvail.length}件`);
  console.log('    → 市場データの問題です。当社にできることはありません。');
  for (const u of notAvail) console.log(`     ・${u.labelJa}（${u.path}）：${u.detailJa}`);

  console.log(`\n  PARSER_OR_SCHEMA_ERROR（値はあるのに読めていない）：${n.parserErrors.length}件`);
  if (n.parserErrors.length === 0) {
    console.log('    → ありません。読み取りの取りこぼしは見つかりませんでした。');
  } else {
    console.log('    → ★これは市場の問題ではなく、当社のコードの不具合です。直す対象です。');
    for (const u of n.parserErrors) console.log(`     ・${u.labelJa}（${u.path}）：${u.detailJa}`);
  }

  /* ---------------------------------------------------------------- */
  console.log(`\n${LINE}`);
  console.log('③ 主要フィールドの突き合わせ');
  console.log(LINE);
  for (const row of auditKeepaFields(product, n)) {
    const flag = row.issue === 'PARSER_OR_SCHEMA_ERROR' ? ' ★不具合' : '';
    console.log(`  ${row.labelJa}${flag}`);
    console.log(`      Keepaの場所：${row.path}`);
    console.log(`      RAWの型：${row.rawShape} ／ RAW値：${row.rawValueJa} ／ 値の有無：${row.hasRawValue ? 'あり' : 'なし'}`);
    console.log(`      当社の値：${row.normalizedJa}`);
    console.log(`      変換ルール：${row.ruleJa}`);
    console.log(`      信用度：${row.confidence} ／ 状態：${row.issue}`);
  }

  /* ---------------------------------------------------------------- */
  console.log(`\n${LINE}`);
  console.log('④ データの鮮度（KEEPA_DATA_AGE_DAYS）');
  console.log(LINE);
  console.log(`  Keepa側の最終更新：${n.lastUpdateIso ?? '不明'}`);
  console.log(`  経過日数：${fresh.ageDays === null ? '不明' : `${fresh.ageDays}日`}`);
  console.log(`  使ってよい上限：${fresh.maxDays}日`);
  console.log(`  判定：${fresh.usable ? '判定に使えます' : '判定しません'}`);
  console.log(`  ${fresh.reasonJa}`);

  /* ---------------------------------------------------------------- */
  console.log(`\n${LINE}`);
  console.log('⑤ 判定に効いているか（読み取り修正の効果）');
  console.log(LINE);
  const comp = scoreCompetition(n);
  const trend = judgeTrend(n);
  console.log(`  ライバルの多さ：${comp.score === null ? '判定不能' : `${comp.score}点`}（${comp.status}）`);
  for (const m of comp.materials) {
    console.log(`   ・${m.labelJa}：${m.detailJa}（${m.points}点／${m.known ? '点に入れた' : '不明なので点に入れない'}）`);
  }
  console.log(`  勢い：${trend.verdict} — ${trend.reasonJa}`);

  console.log(`\n${LINE}`);
  console.log('通信していません。枠は1つも使っていません。');
  console.log(LINE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
