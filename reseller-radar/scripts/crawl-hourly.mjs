// 1時間おきの自動巡回（ローカル実行版）
// ・改良済みのローカルコード（誤マッチ除外＋価格比サニティ＋食品/規制カテゴリ除外）を使う
// ・共有クラウドDB(Turso)に書くのでライブサイトの表示にも反映される
// ・Keepaは6時間キャッシュがあるため、新規/期限切れの商品だけを照会する
//   → 頻繁に回してもトークン(月枠)を無駄にしない
//
// 【改善(2026-09)】
//  ① 照合枠(母数)を段階的に拡大：ローカルは60秒制限が無いので CRAWL_MAX_LOOKUPS を
//     既定40へ引き上げ（Vercel側は従来どおり24のまま＝環境変数で分離）。
//  ② 仕入れ先ごとに探索予算を配分：タスクを supplier ごとにラウンドロビン整列し、
//     楽天とYahooを交互に巡回。途中で時間/トークンが尽きても偏らない。
//  ③ トークン見張り：残トークンが少なければ巡回間隔を自動で延ばし(refill待ち)、
//     枯渇の直前で安全に打ち切る（429連発とムダ消費を防ぐ）。
//
// 実行: node scripts/crawl-hourly.mjs
// launchd から毎時起動される（前回が長引けば launchd は二重起動しない＝実質連続巡回）

import { all, getSetting } from "../lib/db.js";
import { runTask } from "../lib/crawler.js";

// ── 設定（環境変数で調整可能）──
// ローカルは60秒制限なし → 照合枠を段階的に増やす（既定80）。
// タスク数を大幅に増やしたので1回の巡回でより広く照合する。トークン見張りが枯渇を防ぐので安全。
if (!process.env.CRAWL_MAX_LOOKUPS) process.env.CRAWL_MAX_LOOKUPS = "80";
const MAX_LOOKUPS = parseInt(process.env.CRAWL_MAX_LOOKUPS, 10);
// トークンがこの値を下回ったら巡回間隔を延ばす／打ち切る（枯渇保護）。
const TOKEN_FLOOR = parseInt(process.env.KEEPA_TOKEN_FLOOR || "40", 10);
const TOKEN_STOP = parseInt(process.env.KEEPA_TOKEN_STOP || "8", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toLocaleString("ja-JP", { hour12: false });

// Keepa残トークンを確認（/token は無料＝トークンを消費しない）。取得失敗時は null。
async function keepaTokens() {
  try {
    const key = (await getSetting("keepa_key")) || process.env.KEEPA_KEY || "";
    if (!key) return null;
    const r = await fetch("https://api.keepa.com/token?key=" + encodeURIComponent(key.trim()));
    const d = await r.json();
    return { left: d.tokensLeft, rate: d.refillRate, throttle: d.tokenFlowReduction };
  } catch {
    return null;
  }
}

// タスクを supplier ごとにラウンドロビン整列（楽天/Yahoo/… を交互に）。
function roundRobinBySupplier(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (!groups.has(t.supplier_id)) groups.set(t.supplier_id, []);
    groups.get(t.supplier_id).push(t);
  }
  const lists = [...groups.values()];
  const out = [];
  let i = 0;
  while (out.length < tasks.length) {
    const list = lists[i % lists.length];
    if (list.length) out.push(list.shift());
    i++;
  }
  return out;
}

const raw = await all(
  // 実績のある仕入れ先（楽天=3 / Yahoo=4）＋セブン(8)/ヤフオク(13) の有効タスク。
  // ★並び順＝「まだ回っていない→最終巡回が古い順」。毎回ID順で始めると、トークンが尽きる頃には
  //   後ろのタスク（新しい特価タスク等）に永久に順番が来ず飢える。last_run基準で全タスクを公平に回す。
  "SELECT id, name, supplier_id FROM tasks WHERE enabled=1 AND supplier_id IN (3,4,8,13) " +
    "ORDER BY (last_run IS NULL) DESC, last_run ASC, id"
);
const tasks = roundRobinBySupplier(raw);

const tok0 = await keepaTokens();
console.log(
  `==== ${ts()} 自動巡回 開始（対象 ${tasks.length} タスク / 照合枠${MAX_LOOKUPS} / ` +
    `Keepa残${tok0 ? tok0.left : "?"} refill${tok0 ? tok0.rate : "?"}/分）====`
);

let totalExtracted = 0;
let totalMatched = 0;
const perSupplier = new Map();

for (const t of tasks) {
  // トークン見張り：枯渇直前なら安全に打ち切る。少なければ refill を待つ。
  const tk = await keepaTokens();
  if (tk && tk.left <= TOKEN_STOP) {
    console.log(`  [見張り] Keepa残${tk.left}≦${TOKEN_STOP}＝枯渇保護のため今回はここで打ち切り`);
    break;
  }
  if (tk && tk.left < TOKEN_FLOOR) {
    console.log(`  [見張り] Keepa残${tk.left}<${TOKEN_FLOOR}＝refill待ち(15秒)`);
    await sleep(15000);
  }

  try {
    const r = await runTask(t.id);
    const ex = r?.extracted ?? 0;
    const ma = r?.matched ?? 0;
    totalExtracted += ex;
    totalMatched += ma;
    const s = perSupplier.get(t.supplier_id) || { ex: 0, ma: 0, n: 0 };
    s.ex += ex; s.ma += ma; s.n += 1;
    perSupplier.set(t.supplier_id, s);
    console.log(`  task #${t.id} ${t.name} (sup${t.supplier_id}) -> 抽出${ex} 照合${ma}`);
  } catch (e) {
    console.log(`  task #${t.id} ${t.name} -> ERR ${e.message || e}`);
  }
  // 仕入れ先サイトへの連続アクセスを和らげる（ブロック回避）
  await sleep(2000);
}

const tok1 = await keepaTokens();
console.log("---- 仕入れ先別 ----");
for (const [sup, s] of perSupplier) console.log(`  sup${sup}: タスク${s.n} 抽出${s.ex} 照合${s.ma}`);
console.log(
  `==== ${ts()} 自動巡回 終了（合計 抽出${totalExtracted} 照合${totalMatched} / ` +
    `Keepa残${tok1 ? tok1.left : "?"}）====`
);
process.exit(0);
