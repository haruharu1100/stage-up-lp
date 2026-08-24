#!/usr/bin/env node
/**
 * 本番データを流す前の最終点検（＋希望すればサンプルデータのお掃除）。
 *
 * ★このスクリプトは既定では「見るだけ」です。
 *   --clean を付けた時だけ、サンプル（練習用）データを消します。
 *   販売実績・仕入記録・学習データなど「買い直せないデータ」は
 *   --clean を付けても絶対に消しません。
 *
 *   使い方:
 *     node scripts/prelive-check.mjs          … 点検するだけ
 *     node scripts/prelive-check.mjs --clean  … サンプルデータを消してから点検
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = createClient({ url: 'file:' + path.join(ROOT, 'data', 'factory.db') });
const CLEAN = process.argv.includes('--clean');

/** ★消してよいのは「練習で作った調査結果」だけ。実績系は入れない。 */
const SAMPLE_TABLES = ['research_candidates', 'research_runs', 'discoveries', 'discovery_runs'];

/** ★絶対に消さない（買い直せないデータ）。 */
const NEVER_DELETE = [
  'product_lifecycle', 'lifecycle_events', 'sales_results', 'ad_weekly',
  'forecast_accuracy', 'category_bias', 'scoring_weights', 'score_feedback',
  'oem_requirements', 'account_health', 'master_images', 'supplier_price_history',
];

async function count(table) {
  try {
    const r = await db.execute(`SELECT COUNT(*) n FROM ${table}`);
    return Number(r.rows[0].n);
  } catch {
    return null;
  }
}

function line(label, value, note = '') {
  console.log(`  ${String(label).padEnd(30)} ${String(value).padEnd(10)} ${note}`);
}

async function main() {
  console.log('\n=== 本番データを流す前の点検 ===\n');

  // ---- 1. 本番の鍵が入っているか -------------------------------------
  // ★.env と .env.local の両方を見る（Next.js がどちらも読むため）
  const envText = ['.env', '.env.local']
    .map((f) => path.join(ROOT, f))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, 'utf8'))
    .join('\n');

  // ★1行ずつ読む。正規表現の \s は改行も含むため、空の項目
  //   （例 OPENAI_API_KEY=）で「次の行の値」を拾ってしまう事故を防ぐ。
  const env = {};
  for (const raw of envText.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq <= 0) continue;
    const k = l.slice(0, eq).trim();
    let v = l.slice(eq + 1).trim();
    // 値の後ろのコメントと引用符を落とす
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  const get = (k) => (Object.prototype.hasOwnProperty.call(env, k) ? env[k] : null);
  const has = (k) => {
    const v = get(k);
    return v !== null && v !== '';
  };
  console.log('① 鍵の状態');
  line('KEEPA_API_KEY', has('KEEPA_API_KEY') ? '入っています' : '未設定',
    has('KEEPA_API_KEY') ? '' : '★これが無いとサンプルのまま動きます');
  line('OPENAI_API_KEY', has('OPENAI_API_KEY') ? '入っています' : '未設定');

  // ---- 2. 安全スイッチ（お金が動く行為は全部OFFのはず）----------------
  console.log('\n② 安全スイッチ（すべて false のままが正しい）');
  const flags = ['AUTO_PURCHASE', 'AMAZON_AUTO_PUBLISH', 'AD_AUTO_OPTIMIZE', 'AUTO_REORDER', 'RESEARCH_AUTO_APPROVE'];
  let danger = 0;
  for (const f of flags) {
    const raw = get(f);
    const v = raw === null || raw === '' ? '(未設定=false)' : raw;
    const bad = v === 'true';
    if (bad) danger++;
    line(f, v, bad ? '★危険：お金が動く設定になっています' : 'OK');
  }

  // ---- 3. 1回に調べる件数の上限 ---------------------------------------
  console.log('\n③ 1回に調べる件数の上限');
  const lm = get('LIVE_TEST_MODE');
  const ll = get('LIVE_TEST_LIMIT');
  const modeOn = !lm || lm !== 'false';
  line('LIVE_TEST_MODE', modeOn ? 'ON' : 'OFF', modeOn ? '安全弁が効いています' : '★上限なしで動きます');
  line('LIVE_TEST_LIMIT', ll || '20（既定）', '20→50→100 と手で上げてください');

  // ---- 4. サンプルと本番が混ざっていないか -----------------------------
  console.log('\n④ サンプル（練習用）と本番データの混在');
  const liveRuns = await count('research_runs') === null ? null
    : Number((await db.execute('SELECT COUNT(*) n FROM research_runs WHERE live_data=1')).rows[0].n);
  const mockRuns = Number((await db.execute('SELECT COUNT(*) n FROM research_runs WHERE live_data=0')).rows[0].n);
  line('本番データの調査', liveRuns + '回');
  line('サンプルの調査', mockRuns + '回');
  if (liveRuns > 0 && mockRuns > 0) {
    console.log('  ★両方が残っています。--clean でサンプルだけ消せます');
  }

  // ---- 4.5 仕入先が本物かどうか ----------------------------------------
  //   ★ここが「サンプル」のままだと、Amazon側だけ本番・仕入先はニセ物という
  //     いちばん危ない混ざり方をする。利益計算がまるごと嘘になるので必ず止める。
  console.log('\n④-2 仕入先データ（ここがサンプルだと利益計算が嘘になります）');
  const csvPath = path.join(ROOT, 'data', 'supplier_listings.csv');
  const csvOk = fs.existsSync(csvPath);
  line('CSV（data/supplier_listings.csv）', csvOk ? 'あります' : 'ありません',
    csvOk ? '' : '見本: samples/supplier_listings.csv');

  // Googleスプレッドシート（審査も契約も要らない一番早い本物ルート）
  const sheetsOk = has('SUPPLIER_SHEET_ID') || has('SUPPLIER_SHEET_URL');
  line('Googleスプレッドシート', sheetsOk ? '使えます' : '未設定',
    sheetsOk ? '' : '.env に SUPPLIER_SHEET_URL を入れてください');

  const supplierApis = [];
  if (sheetsOk) supplierApis.push('Googleスプレッドシート');

  // ★2026-08-20 訂正：以前は「APP_KEYとAPP_SECRETだけで動く」と書いていましたが誤りでした。
  //   公式FAQ（docId 1957 / 1936）により、アフィリエイト系も access_token が要る前提に改めます。
  //   Alibaba / 1688 は正規の入口が使えないため、ここでは「使える」と表示しない。
  const aliexpressKeys = has('ALIEXPRESS_APP_KEY') && has('ALIEXPRESS_APP_SECRET');
  const aliexpressOk = aliexpressKeys && has('ALIEXPRESS_ACCESS_TOKEN');
  if (aliexpressOk) supplierApis.push('AliExpress');
  line('AliExpress API', aliexpressOk ? '鍵はそろっています' : '鍵が未設定',
    aliexpressOk
      ? '★鍵がそろっても、実商品を1件取れるまで完成扱いにはしません'
      : aliexpressKeys
        ? 'ALIEXPRESS_ACCESS_TOKEN が足りません'
        : 'ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET / ALIEXPRESS_ACCESS_TOKEN');
  line('Alibaba.com API', '使えません', 'バイヤー用API権限の審査待ち（PARTIAL）');
  line('1688 API', '使えません', '日本の個人が使える正規の入口なし（UNAVAILABLE）');

  const supplierLive = csvOk || supplierApis.length > 0;
  if (!supplierLive) {
    console.log('  ★本物の仕入先がひとつもありません。このまま実行すると');
    console.log('    Amazon側＝本番／仕入先＝サンプル（架空の値段）で混ざります。');
  }

  // ---- 5. お掃除（--clean の時だけ）------------------------------------
  if (CLEAN) {
    if (liveRuns > 0) {
      console.log('\n⑤ お掃除：中止しました');
      console.log('  ★すでに本番データの調査が存在します。誤って本番結果を消さないため、自動削除はしません。');
    } else {
      console.log('\n⑤ お掃除：サンプルデータを消します（実績データには一切さわりません）');
      for (const t of SAMPLE_TABLES) {
        const before = await count(t);
        if (before === null) continue;
        await db.execute(`DELETE FROM ${t}`);
        line(t, `${before}件 → 0件`, '消しました');
      }
      console.log('\n  守ったデータ（消していません）:');
      for (const t of NEVER_DELETE) {
        const n = await count(t);
        if (n) line(t, n + '件', '★買い直せないデータなので保持');
      }
    }
  } else {
    console.log('\n⑤ お掃除：していません（--clean を付けると実行します）');
  }

  // ---- 6. まとめ --------------------------------------------------------
  console.log('\n=== まとめ ===');
  if (!has('KEEPA_API_KEY')) {
    console.log('  ▲ Keepaの鍵がまだ入っていません。入れるまで本番データは流れません。');
  } else if (danger > 0) {
    console.log('  ★危険な設定が' + danger + '件あります。false に戻してから流してください。');
  } else if (!supplierLive) {
    console.log('  ▲ まだ本番20商品テストは始められません。');
    console.log('    理由：本物の仕入先データがありません（Amazon側だけ本番になり、仕入値段はサンプルの架空値になります）。');
    console.log('    次のどちらかで解けます：');
    console.log('      A) Googleスプレッドシートを共有設定して .env に SUPPLIER_SHEET_URL を入れる（一番早い／無料／審査なし）');
    console.log('      B) .env に ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET を入れる');
    console.log('      C) data/supplier_listings.csv を置く（見本 samples/supplier_listings.csv をコピーして書き換え）');
  } else {
    console.log('  ○ 本番データを20件だけ流す準備ができています。');
    console.log(`    仕入先：${csvOk ? 'CSV' : ''}${csvOk && supplierApis.length ? '＋' : ''}${supplierApis.join('・')}`);
    console.log('    ★ただし先に「npm run supplier:audit」を通してください。');
    console.log('      （仕入先の商品が実在するか・URLが開くか・価格と通貨が正しいかの確認です）');
    console.log('    それが合格したら 画面 /research の「リサーチ実行」を押してください。');
  }
  console.log('');
}

main().catch((e) => {
  console.error('点検に失敗しました:', e.message);
  process.exit(1);
});
