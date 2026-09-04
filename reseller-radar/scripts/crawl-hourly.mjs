// 1時間おきの自動巡回（ローカル実行版）
// ・改良済みのローカルコード（誤マッチ除外＋価格比サニティ）をそのまま使う
// ・共有クラウドDB(Turso)に書くのでライブサイトの表示にも反映される
// ・Keepaは6時間キャッシュがあるため、新規/期限切れの商品だけを照会する
//   → 頻繁に回してもトークン(月枠)を無駄にしない
//
// 実行: node scripts/crawl-hourly.mjs
// launchd から毎時起動される（前回が長引けば launchd は二重起動しない＝実質連続巡回）

import { all } from "../lib/db.js";
import { runTask } from "../lib/crawler.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ts() {
  return new Date().toLocaleString("ja-JP", { hour12: false });
}

const tasks = await all(
  // 実績のある仕入れ先（楽天=3 / Yahoo=4）＋セブン(8)/ヤフオク(13) の有効タスク
  "SELECT id, name FROM tasks WHERE enabled=1 AND supplier_id IN (3,4,8,13) ORDER BY id"
);

console.log(`==== ${ts()} 自動巡回 開始（対象 ${tasks.length} タスク）====`);
let totalExtracted = 0;
let totalMatched = 0;
for (const t of tasks) {
  try {
    const r = await runTask(t.id);
    const ex = r?.extracted ?? 0;
    const ma = r?.matched ?? 0;
    totalExtracted += ex;
    totalMatched += ma;
    console.log(`  task #${t.id} ${t.name} -> 抽出${ex} 照合${ma}`);
  } catch (e) {
    console.log(`  task #${t.id} ${t.name} -> ERR ${e.message || e}`);
  }
  // 仕入れ先サイトへの連続アクセスを和らげる（ブロック回避）
  await sleep(2000);
}
console.log(
  `==== ${ts()} 自動巡回 終了（合計 抽出${totalExtracted} 照合${totalMatched}）====`
);
process.exit(0);
