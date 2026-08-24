#!/usr/bin/env node
/**
 * AmazonFeeProvider の実地確認。
 *
 * ★目的
 *   「Amazon手数料を仮置きから実データへ」が本当に効いているかを、本番Keepaで確かめる。
 *   ・実データ(ACTUAL)が取れているか
 *   ・取れないときに推定(ESTIMATED)／不明(UNKNOWN)へ正しく落ちるか
 *   ・仮置き計算と実データ計算で、利益がいくら変わるか
 *
 * ★読み取り専用。DBにも.envにも一切書き込まない。仕入れも出品も起きない。
 *   使い方: npm run fee:check ["検索語" ...]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function readEnv() {
  const text = ['.env', '.env.local']
    .map((f) => path.join(ROOT, f))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, 'utf8'))
    .join('\n');
  const out = {};
  // ★1行ずつ読む（正規表現の \s は改行を含むため次行の値を拾う事故が起きる）
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i <= 0) continue;
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

/** 本物の lib/providers/amazonFee.ts をそのまま読み込む（別実装で確認しても意味がないため） */
function loadFeeProvider() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'feecheck-'));
  execFileSync(
    path.join(ROOT, 'node_modules/.bin/tsc'),
    [
      'lib/providers/amazonFee.ts',
      '--outDir', out,
      '--rootDir', '.',
      '--module', 'commonjs',
      '--target', 'es2020',
      '--moduleResolution', 'node',
      '--skipLibCheck',
      '--esModuleInterop',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  return { mod: require(path.join(out, 'lib/providers/amazonFee.js')), out };
}

const yen = (n) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString()}円`);
const keepaNum = (v) => (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 ? null : v);
const minutesToIso = (v) => (keepaNum(v) === null ? null : new Date((v + 21564000) * 60000).toISOString());

/** amazonSearch.ts の keepaFeeData と同じ読み取り方 */
function feeDataOf(p) {
  return {
    referralFeePercent: keepaNum(p?.referralFeePercent) ?? keepaNum(p?.referralFeePercentage),
    pickAndPackFeeJpy: keepaNum(p?.fbaFees?.pickAndPackFee),
    feeUpdatedAt: minutesToIso(p?.fbaFees?.lastUpdate) ?? minutesToIso(p?.lastUpdate),
    queried: true,
  };
}

function candidateOf(p) {
  const pl = keepaNum(p.packageLength);
  const pw = keepaNum(p.packageWidth);
  const ph = keepaNum(p.packageHeight);
  const price =
    keepaNum(p?.stats?.buyBoxPrice) ??
    keepaNum(p?.stats?.current?.[1]) ??
    keepaNum(p?.stats?.current?.[0]) ??
    0;
  return {
    source: 'keepa',
    product: {
      id: '',
      asin: p.asin,
      title: p.title || '(タイトル不明)',
      brand: p.brand || p.manufacturer || null,
      category: p.categoryTree?.[0]?.name || null,
      packageSizeCm: pl !== null && pw !== null && ph !== null ? { length: pl / 10, width: pw / 10, height: ph / 10 } : null,
      weightG: keepaNum(p.packageWeight) ?? keepaNum(p.itemWeight),
      temperatureControl: 'ambient',
    },
    market: { source: 'keepa', fetchedAt: new Date().toISOString(), priceJpy: price },
    feeData: feeDataOf(p),
  };
}

async function main() {
  const env = readEnv();
  const key = env.KEEPA_API_KEY;
  if (!key) {
    console.log('KEEPA_API_KEY が未設定です。確認できません。');
    process.exit(1);
  }

  const terms = process.argv.slice(2);
  const searchTerms = terms.length
    ? terms
    : ['ステンレス 水筒 500ml', 'シリコン 鍋蓋', 'スマホスタンド 卓上', 'LED デスクライト'];

  console.log('\n=== Amazon手数料 実データ化の確認 ===');
  console.log('目的：仮置きの一律手数料ではなく、商品ごとの実際の手数料で利益を出せているかの確認\n');

  const { mod, out } = loadFeeProvider();
  const { getAmazonFeeProvider, FEE_CONFIDENCE_LABEL } = mod;

  const products = [];
  for (const term of searchTerms) {
    const url = `https://api.keepa.com/search?key=${key}&domain=5&type=product&term=${encodeURIComponent(term)}&stats=90&history=0`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const json = await res.json();
      const got = (json.products || []).slice(0, 5);
      products.push(...got);
      console.log(`  「${term}」 → ${got.length}件取得（残トークン ${json.tokensLeft}）`);
    } catch (e) {
      console.log(`  「${term}」 → 取得失敗: ${e.message}`);
    }
  }
  if (!products.length) {
    console.log('\n商品が取れなかったため確認できません。');
    process.exit(1);
  }

  const RETURN_RATE = Number(env.ASSUMED_RETURN_RATE || 0.03);
  const counts = { ACTUAL: 0, ESTIMATED: 0, UNKNOWN: 0 };
  const deltas = [];
  let staleCount = 0;
  let aBlocked = 0;

  for (const fulfillment of ['fba', 'fbm']) {
    console.log(`\n\n---- ${fulfillment === 'fba' ? 'FBAで売る場合' : '自己発送で売る場合'} ----`);
    for (const p of products) {
      const cand = candidateOf(p);
      const sell = cand.market.priceJpy;
      if (!sell) continue;
      const fees = getAmazonFeeProvider(cand).getFees(cand, { fulfillment, sellPriceJpy: sell, storageMonths: 1 });

      const referral = fees.referral;
      const ful = fulfillment === 'fbm' ? fees.fbmShipping : fees.fbaFee;
      const storage = fees.storage;
      for (const item of [referral, ful, storage]) counts[item.confidence]++;
      if (fees.freshness.stale) staleCount++;
      if (fees.criticalUnknown.length) aBlocked++;

      const title = String(p.title || '').slice(0, 26);
      console.log(`\n  ${p.asin}  ${title}`);
      console.log(`    販売価格 ${yen(sell)} / サイズ区分 ${fees.sizeTier.value ?? '不明'} / 重量区分 ${fees.weightTier.value ?? '不明'}`);
      console.log(
        `    Amazon紹介料   ${String(yen(referral.jpy)).padStart(9)}  [${FEE_CONFIDENCE_LABEL[referral.confidence]}]` +
          (referral.rate ? `  率${(referral.rate * 100).toFixed(1)}%` : ''),
      );
      console.log(`    ${fulfillment === 'fbm' ? '自己発送送料  ' : 'FBA配送代行料 '} ${String(yen(ful.jpy)).padStart(9)}  [${FEE_CONFIDENCE_LABEL[ful.confidence]}]`);
      console.log(`    FBA在庫保管料  ${String(yen(storage.jpy)).padStart(9)}  [${FEE_CONFIDENCE_LABEL[storage.confidence]}]`);
      console.log(`    手数料データの鮮度：${fees.freshness.label}`);
      if (fees.criticalUnknown.length) {
        console.log(`    ★不明な費目があるためAランク禁止：${fees.criticalUnknown.join('・')}`);
      }

      // ---- 仮置き計算との差（仕入価格は同じなので、差＝手数料の差だけで出る）----
      if (fees.hasActual) {
        const legacy = getAmazonFeeProvider({ ...cand, source: 'csv', feeData: null }).getFees(cand, {
          fulfillment,
          sellPriceJpy: sell,
          storageMonths: 1,
        });
        const legacyFul = fulfillment === 'fbm' ? legacy.fbmShipping : legacy.fbaFee;
        const dRef = (referral.jpy ?? 0) - (legacy.referral.jpy ?? 0);
        const dFul = (ful.jpy ?? 0) - (legacyFul.jpy ?? 0);
        // 返品リスクは配送費に連動するので、その分も利益差に効く
        const dProfit = -(dRef + dFul * (1 + RETURN_RATE));
        deltas.push(dProfit);
        if (Math.round(dProfit) !== 0) {
          console.log(
            `    ★仮置きとの差：利益 ${dProfit > 0 ? '+' : ''}${Math.round(dProfit).toLocaleString()}円` +
              `（紹介料 ${dRef > 0 ? '+' : ''}${Math.round(dRef).toLocaleString()}円 / 配送 ${dFul > 0 ? '+' : ''}${Math.round(dFul).toLocaleString()}円）`,
          );
        } else {
          console.log('    仮置きと実データで差はありませんでした');
        }
      }
    }
  }

  const total = counts.ACTUAL + counts.ESTIMATED + counts.UNKNOWN;
  console.log('\n\n=== まとめ ===');
  console.log(`  調べた費目：${total}件`);
  console.log(`    実データ(ACTUAL)   ${counts.ACTUAL}件`);
  console.log(`    推定値(ESTIMATED)  ${counts.ESTIMATED}件`);
  console.log(`    不明(UNKNOWN)      ${counts.UNKNOWN}件  ※0円にはせず、Aランク禁止で扱う`);
  console.log(`  手数料データが古い／日付不明：${staleCount}件`);
  console.log(`  不明費目があってAランク禁止になった商品：${aBlocked}件`);
  if (deltas.length) {
    const worst = Math.min(...deltas);
    const best = Math.max(...deltas);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    console.log(`\n  仮置き計算 → 実データ計算 の利益変化（${deltas.length}件）`);
    console.log(`    平均 ${Math.round(avg) > 0 ? '+' : ''}${Math.round(avg).toLocaleString()}円 / 最も減った ${Math.round(worst).toLocaleString()}円 / 最も増えた +${Math.round(best).toLocaleString()}円`);
    console.log('    ※マイナス＝仮置きは利益を多く見せていた（＝赤字を見落とす方向だった）');
  } else {
    console.log('\n  実データが取れた商品が無かったため、仮置きとの差は出ていません。');
  }
  console.log('');

  fs.rmSync(out, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('確認に失敗:', e.message);
  process.exit(1);
});
