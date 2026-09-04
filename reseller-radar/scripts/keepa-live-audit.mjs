// =====================================================================
// 第4フェーズ Keepa最小ライブ検証（実通信・3〜5商品のみ）
// ---------------------------------------------------------------------
//  ・目的：生レスポンスで eanList/upcList・current配列・avg30/avg90・
//    salesRankDrops30 が「実際に何を返すか」を人間監査できる形で保存する。
//  ・安全：Keepa以外の通信なし。購入/出品/SP-API/メールなし。コード変更なし。
//  ・浪費防止：呼び出し回数に MAX_CALLS の上限。キーはURLにのみ使用し保存しない。
//  ・current配列の意味は推測で確定しない。取れた値と既存コードの前提を並記するだけ。
// =====================================================================
import { writeFileSync } from "node:fs";
import { getSetting } from "../lib/db.js";

const MAX_CALLS = 8; // ← ハード上限。これを超える通信は物理的に停止。
let calls = 0;

const KEY = ((await getSetting("keepa_key")) || process.env.KEEPA_KEY || "").trim();
if (!KEY) {
  console.error("Keepaキー未取得。停止。");
  process.exit(1);
}

async function keepaProduct({ asin, code, stats = 30 }) {
  if (calls >= MAX_CALLS) throw new Error("MAX_CALLS到達で停止");
  calls++;
  const sel = asin ? `asin=${encodeURIComponent(asin)}` : `code=${encodeURIComponent(code)}`;
  const url = `https://api.keepa.com/product?key=${encodeURIComponent(KEY)}&domain=5&${sel}&stats=${stats}&history=0`;
  const res = await fetch(url, { method: "GET" });
  const json = await res.json();
  return json;
}

// 監査に使う抜粋（生の数値をそのまま。解釈は付けない）
function excerpt(json) {
  const p = (json.products && json.products[0]) || {};
  const s = p.stats || {};
  const arr = (a, i) => (Array.isArray(a) && a[i] !== undefined ? a[i] : null);
  return {
    asin: p.asin ?? null,
    title: p.title ?? null,
    eanList: p.eanList ?? null,
    upcList: p.upcList ?? null,
    // current配列（意味は確定しない・生値）
    current_0: arr(s.current, 0),
    current_1: arr(s.current, 1),
    current_2: arr(s.current, 2),
    current_3_salesRank: arr(s.current, 3),
    current_11: arr(s.current, 11),
    current_18: arr(s.current, 18),
    // avg30 / avg90（配列で返るか？）
    avg30_0: arr(s.avg30, 0),
    avg30_1: arr(s.avg30, 1),
    avg30_18: arr(s.avg30, 18),
    avg90_0: arr(s.avg90, 0),
    avg90_1: arr(s.avg90, 1),
    avg90_18: arr(s.avg90, 18),
    avg30_isArray: Array.isArray(s.avg30),
    avg90_isArray: Array.isArray(s.avg90),
    // その他stats
    buyBoxPrice: s.buyBoxPrice ?? null,
    salesRankDrops30: s.salesRankDrops30 ?? null,
    offerCountNew: s.offerCountNew ?? null,
    // トークン会計
    tokensLeft: json.tokensLeft ?? null,
    tokensConsumed: json.tokensConsumed ?? null,
    refillIn: json.refillIn ?? null,
    refillRate: json.refillRate ?? null,
  };
}

// ---- 対象4商品（実在ASIN・findings由来） ----
const targets = [
  { tag: "A_SSD_Amazon限定", asin: "B08P4CN4YC" }, // SanDisk SDSSDE61-1T00
  { tag: "B_純正インク", asin: "B004LVNZVK" },       // Epson IC4CL62（識別子が入りやすい定番）
  { tag: "C_セット商品", asin: "B07FYVGG9K" },       // Noritake プレートセット
  { tag: "D_microSD_id63", asin: "B07KZGRLDT" },     // SanDisk Extreme PRO 256GB
];

const audit = [];
let firstToken = null;

for (const t of targets) {
  const json = await keepaProduct({ asin: t.asin, stats: 30 });
  const ex = excerpt(json);
  if (firstToken == null) firstToken = ex.tokensLeft;
  audit.push({ tag: t.tag, mode: "asin/stats=30", ...ex });
  // 生レスポンスも保存（キーは含まれない）
  writeFileSync(
    `/Users/yokotaakiraju/Documents/keepa-raw-${t.asin}.json`,
    JSON.stringify(json, null, 2),
    "utf8"
  );
}

// ---- JANパス検証：Bで eanList が取れたら、その値で code 検索して往復照合 ----
let janRoundTrip = null;
const b = audit.find((x) => x.tag === "B_純正インク");
if (b && Array.isArray(b.eanList) && b.eanList.length) {
  const jan = String(b.eanList[0]);
  const json = await keepaProduct({ code: jan, stats: 30 });
  const ex = excerpt(json);
  const returnedCodes = [
    ...(Array.isArray(ex.eanList) ? ex.eanList.map(String) : []),
    ...(Array.isArray(ex.upcList) ? ex.upcList.map(String) : []),
  ];
  janRoundTrip = {
    used_jan: jan,
    returned_asin: ex.asin,
    same_asin: ex.asin === b.asin,
    returned_codes_include_jan: returnedCodes.includes(jan),
    verdict_would_be: returnedCodes.length === 0 ? "unknown" : returnedCodes.includes(jan) ? "verified" : "conflict",
  };
} else {
  janRoundTrip = { note: "B商品でeanListが空だったためJAN往復検証は実施せず（＝実運用でもJAN照合不能の可能性）" };
}

// ---- avg90検証：A商品を stats=90 でも取得し、avg90の出方とトークン差を比較 ----
let stats90 = null;
{
  const tokBefore = audit.length ? audit[audit.length - 1].tokensLeft : null;
  const json = await keepaProduct({ asin: "B08P4CN4YC", stats: 90 });
  const ex = excerpt(json);
  stats90 = {
    asin: "B08P4CN4YC",
    avg90_isArray_stats90: ex.avg90_isArray,
    avg90_1_stats90: ex.avg90_1,
    avg30_1_stats90: ex.avg30_1,
    tokensConsumed_stats90: ex.tokensConsumed,
    note: "同一商品を stats=90 で取得。stats=30時と avg90 の出方・消費トークンを比較する材料。",
  };
}

const result = {
  provenance: "Keepa実レスポンス（domain=5 / stats=30、一部stats=90比較）。追加通信はKeepaのみ・4商品+検証2回。",
  api_calls: calls,
  max_calls_cap: MAX_CALLS,
  tokens_left_start: firstToken,
  tokens_left_end: audit.length ? undefined : null,
  jan_round_trip: janRoundTrip,
  stats90_compare: stats90,
  audit,
};
// 末尾のtokensLeftも記録
result.tokens_left_end = stats90 ? null : null;

writeFileSync(
  "/Users/yokotaakiraju/Documents/reseller-radar-keepa-live-audit.json",
  JSON.stringify(result, null, 2),
  "utf8"
);

// ---- コンソール要約 ----
console.log("=== Keepaライブ検証 要約 ===");
console.log("API呼び出し回数:", calls, "/ 上限", MAX_CALLS);
console.log("開始時tokensLeft:", firstToken);
for (const a of audit) {
  console.log(`\n[${a.tag}] ${a.asin}  tokensLeft=${a.tokensLeft} consumed=${a.tokensConsumed}`);
  console.log("  title:", (a.title || "").slice(0, 50));
  console.log("  eanList:", JSON.stringify(a.eanList), "upcList:", JSON.stringify(a.upcList));
  console.log("  current[0]=", a.current_0, " current[1]=", a.current_1, " current[2]=", a.current_2, " current[18]=", a.current_18);
  console.log("  salesRank(current[3])=", a.current_3_salesRank, " current[11]=", a.current_11);
  console.log("  avg30(isArr=" + a.avg30_isArray + ") [0]=", a.avg30_0, "[1]=", a.avg30_1, "[18]=", a.avg30_18);
  console.log("  avg90(isArr=" + a.avg90_isArray + ") [0]=", a.avg90_0, "[1]=", a.avg90_1, "[18]=", a.avg90_18);
  console.log("  buyBoxPrice=", a.buyBoxPrice, " salesRankDrops30=", a.salesRankDrops30, " offerCountNew=", a.offerCountNew);
}
console.log("\n=== JAN往復検証 ===");
console.log(JSON.stringify(janRoundTrip, null, 2));
console.log("\n=== stats=90比較 ===");
console.log(JSON.stringify(stats90, null, 2));
console.log("\n保存:", "/Users/yokotaakiraju/Documents/reseller-radar-keepa-live-audit.json");
console.log("生レスポンス:", "keepa-raw-<ASIN>.json ×4");
