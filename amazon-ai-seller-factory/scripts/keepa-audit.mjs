#!/usr/bin/env node
/**
 * Keepa特殊値の横断監査。
 *
 * ★目的
 *   Keepaは「取れなかった」を負の数で返す（-1 = 不明 / -2 = カートが立っていない 等）。
 *   これを実数として計算に流すと「-2円で売れる」ような壊れた利益計算になる。
 *   価格・ランキング・Buy Box・在庫・出品者数・月販・手数料の各項目について、
 *   本番データに特殊値が混ざっていないかを実際に確認する。
 *
 * ★読み取り専用。DBも.envも書き換えない。
 *   使い方: node scripts/keepa-audit.mjs ["検索語" ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★日本語を含むパスでも壊れないよう fileURLToPath を使う（pathname だと%エンコードされる）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/** 監査する項目。Keepaのどこを見るか＋その値が「価格系か」を持たせる */
const CSV_SERIES = [
  { idx: 0, group: '価格', name: 'Amazon本体価格' },
  { idx: 1, group: '価格', name: '新品価格' },
  { idx: 2, group: '価格', name: '中古価格' },
  { idx: 3, group: 'ランキング', name: 'Sales Rank' },
  { idx: 4, group: '価格', name: 'リスト価格' },
  { idx: 7, group: '価格', name: 'Buy Box価格(履歴)' },
  { idx: 10, group: '在庫', name: 'Amazon在庫状況' },
  { idx: 11, group: '出品者数', name: '新品出品者数' },
  { idx: 12, group: '出品者数', name: '中古出品者数' },
  { idx: 16, group: '評価', name: '評価(rating)' },
  { idx: 17, group: '評価', name: 'レビュー件数' },
];

const STAT_FIELDS = [
  { key: 'buyBoxPrice', group: 'Buy Box', name: 'Buy Box価格' },
  { key: 'buyBoxShipping', group: 'Buy Box', name: 'Buy Box送料' },
  { key: 'buyBoxUsedPrice', group: 'Buy Box', name: 'Buy Box中古価格' },
  { key: 'current', group: '価格', name: 'current配列' },
  { key: 'avg30', group: '価格', name: '30日平均' },
  { key: 'avg90', group: '価格', name: '90日平均' },
  { key: 'avg180', group: '価格', name: '180日平均' },
  { key: 'min', group: '価格', name: '最安値' },
  { key: 'max', group: '価格', name: '最高値' },
  { key: 'offerCountNew', group: '出品者数', name: '新品出品者数' },
  { key: 'totalOfferCount', group: '出品者数', name: '総出品者数' },
  { key: 'outOfStockPercentage30', group: '在庫', name: '30日欠品率' },
  { key: 'outOfStockPercentage90', group: '在庫', name: '90日欠品率' },
  { key: 'rating', group: '評価', name: '評価' },
  { key: 'reviewCount', group: '評価', name: 'レビュー件数' },
];

const TOP_FIELDS = [
  { key: 'monthlySold', group: '月販関連', name: '推定月販' },
  { key: 'referralFeePercent', group: '手数料関連', name: '紹介料率' },
  { key: 'referralFeePercentage', group: '手数料関連', name: '紹介料率(別名)' },
  { key: 'packageWeight', group: 'サイズ', name: '梱包重量' },
  { key: 'packageLength', group: 'サイズ', name: '梱包長さ' },
  { key: 'packageWidth', group: 'サイズ', name: '梱包幅' },
  { key: 'packageHeight', group: 'サイズ', name: '梱包高さ' },
  { key: 'itemWeight', group: 'サイズ', name: '商品重量' },
  { key: 'numberOfItems', group: 'その他', name: '入り数' },
];

/** 見つかった特殊値を貯める */
const found = new Map(); // "グループ|項目|値" -> 件数
function note(group, name, value) {
  const k = `${group}|${name}|${value}`;
  found.set(k, (found.get(k) || 0) + 1);
}

function scanNumber(group, name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  if (v < 0) note(group, name, v);
}

async function main() {
  const env = readEnv();
  const key = env.KEEPA_API_KEY;
  if (!key) {
    console.log('KEEPA_API_KEY が未設定です。監査できません。');
    process.exit(1);
  }

  const terms = process.argv.slice(2);
  const searchTerms = terms.length
    ? terms
    : ['ステンレス 水筒 500ml', 'シリコン 鍋蓋', 'スマホスタンド 卓上', 'ヨガマット 10mm', 'LED デスクライト'];

  console.log('\n=== Keepa特殊値の横断監査 ===');
  console.log('目的：APIの特殊値（-1／-2 など）を実数として計算に流していないかの確認\n');

  const products = [];
  for (const term of searchTerms) {
    const url = `https://api.keepa.com/search?key=${key}&domain=5&type=product&term=${encodeURIComponent(term)}&stats=90&history=1`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const json = await res.json();
      const got = (json.products || []).slice(0, 6);
      products.push(...got);
      console.log(`  「${term}」 → ${got.length}件取得（残トークン ${json.tokensLeft}）`);
    } catch (e) {
      console.log(`  「${term}」 → 取得失敗: ${e.message}`);
    }
  }

  console.log(`\n調べた商品数: ${products.length}件\n`);
  if (!products.length) {
    console.log('商品が取れなかったため監査できません。');
    process.exit(1);
  }

  for (const p of products) {
    const csv = p.csv || [];
    for (const s of CSV_SERIES) {
      const arr = csv[s.idx];
      if (!Array.isArray(arr)) continue;
      // [分, 値, 分, 値, ...] の「値」だけ見る
      for (let i = 1; i < arr.length; i += 2) scanNumber(s.group, s.name, arr[i]);
    }
    const st = p.stats || {};
    for (const f of STAT_FIELDS) {
      const v = st[f.key];
      if (Array.isArray(v)) for (const x of v) scanNumber(f.group, f.name, x);
      else scanNumber(f.group, f.name, v);
    }
    for (const f of TOP_FIELDS) scanNumber(f.group, f.name, p[f.key]);
    if (p.fbaFees) {
      scanNumber('手数料関連', 'FBA手数料(pickAndPack)', p.fbaFees.pickAndPackFee);
      scanNumber('手数料関連', 'FBA手数料(storage)', p.fbaFees.storageFee);
    }
  }

  if (!found.size) {
    console.log('特殊値（負の数）は見つかりませんでした。');
  } else {
    console.log('【見つかった特殊値】※これらを実数として計算に流してはいけない\n');
    const rows = [...found.entries()]
      .map(([k, n]) => {
        const [group, name, value] = k.split('|');
        return { group, name, value: Number(value), n };
      })
      .sort((a, b) => (a.group === b.group ? b.n - a.n : a.group.localeCompare(b.group)));
    let g = '';
    for (const r of rows) {
      if (r.group !== g) {
        g = r.group;
        console.log(`\n[${g}]`);
      }
      const meaning =
        r.value === -1 ? '不明／データ無し' : r.value === -2 ? 'カートが立っていない等' : 'その他の特殊値';
      console.log(`  ${r.name.padEnd(22)} 値 ${String(r.value).padStart(3)}（${meaning}）  ${r.n}箇所`);
    }
  }

  // ---- 現在のコードが正しく弾けるかの実地確認 -------------------------
  console.log('\n\n=== 現在のコードの防御を確認 ===');
  const keepaNum = (v) => (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 ? null : v);
  const samples = [-1, -2, -3, 0, 1, 1990];
  console.log('  keepaNum()（0以下は全てUNKNOWN扱い）:');
  for (const s of samples) {
    const r = keepaNum(s);
    console.log(`    ${String(s).padStart(5)} → ${r === null ? 'UNKNOWN（計算に流さない）' : `${r}（有効な数値）`}`);
  }

  let leaked = 0;
  for (const p of products) {
    const st = p.stats || {};
    if (keepaNum(st.buyBoxPrice) !== null && st.buyBoxPrice < 0) leaked++;
  }
  console.log(`\n  実データで特殊値が素通りした件数: ${leaked}件 ${leaked === 0 ? '（0件＝防御できています）' : '★要修正'}`);
  console.log('');
}

main().catch((e) => {
  console.error('監査に失敗:', e.message);
  process.exit(1);
});
