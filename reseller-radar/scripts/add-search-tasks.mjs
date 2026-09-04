// 改善策：売れ筋かつAmazonと型番一致しやすいブランド商材の検索タスクを一括登録する。
// 成功実績のあるタスク#9(楽天SanDisk)と同じ条件(OR/率10-100/金額1000/FBA)に揃える。
// 仕入れ先IDは既存: 1=ヨドバシ 3=楽天 4=Yahooショッピング 5=駿河屋
import { all, run, get } from "../lib/db.js";

const enc = (s) => encodeURIComponent(s);
const urlFor = (supplierId, kw) => {
  switch (supplierId) {
    case 1: return `https://www.yodobashi.com/?word=${enc(kw)}`;
    case 3: return `https://search.rakuten.co.jp/search/mall/${enc(kw)}/`;
    case 4: return `https://shopping.yahoo.co.jp/search?p=${enc(kw)}`;
    case 5: return `https://www.suruga-ya.jp/search?search_word=${enc(kw)}`;
    default: return null;
  }
};

// [仕入れ先ID, 検索ワード, タスク名]
const PLAN = [
  // 楽天：ブランド家電・周辺機器
  [3, "Anker 充電器", "楽天 Anker充電器"],
  [3, "エレコム", "楽天 エレコム"],
  [3, "ロジクール", "楽天 ロジクール"],
  [3, "LEGO レゴ", "楽天 LEGO"],
  [3, "タミヤ プラモデル", "楽天 タミヤ"],
  [3, "ザバス プロテイン", "楽天 ザバス"],
  [3, "パナソニック エネループ", "楽天 エネループ"],
  // Yahoo：型番系
  [4, "Anker モバイルバッテリー", "Yahoo Ankerバッテリー"],
  [4, "SanDisk microSD", "Yahoo SanDisk"],
  [4, "エプソン インク 純正", "Yahoo エプソン純正インク"],
  [4, "LEGO レゴ", "Yahoo LEGO"],
  [4, "ロジクール マウス", "Yahoo ロジクールマウス"],
  // ヨドバシ：家電周辺機器
  [1, "Anker", "ヨドバシ Anker"],
  [1, "ロジクール", "ヨドバシ ロジクール"],
  // 駿河屋：ホビー
  [5, "amiibo アミーボ", "駿河屋 amiibo"],
  [5, "フィギュア", "駿河屋 フィギュア"],
];

let added = 0, skipped = 0;
for (const [sid, kw, name] of PLAN) {
  const url = urlFor(sid, kw);
  if (!url) { console.log(`URL生成不可: ${name}`); continue; }
  const dup = await get("SELECT id FROM tasks WHERE url = ?", [url]);
  if (dup) { console.log(`既存のためスキップ: ${name} (#${dup.id})`); skipped++; continue; }
  await run(
    `INSERT INTO tasks (name, supplier_id, url, ship_method, cond_pattern, rate_min, rate_max, amount_min, monthly_sales_min, enabled)
     VALUES (?, ?, ?, 'FBA', 'OR', 10, 100, 1000, 0, 1)`,
    [name, sid, url]
  );
  const r = await get("SELECT id FROM tasks WHERE url = ?", [url]);
  console.log(`追加: #${r.id} ${name}`);
  added++;
}
console.log(`\n完了: 追加${added}件 / スキップ${skipped}件`);
process.exit(0);
