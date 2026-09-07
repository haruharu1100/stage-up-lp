// ─────────────────────────────────────────────────────────────
// findings の「利益候補」を走査し、Amazon出品規制カテゴリ
// （食品/サプリ・酒類・医薬品・たばこ）を EXCLUDE へ再分類する監査ツール。
//   既定は dry-run（表示のみ）。実際に更新するには APPLY=1 を付ける。
//     確認だけ : node scripts/audit-restricted-findings.mjs
//     反映する : APPLY=1 node scripts/audit-restricted-findings.mjs
// 本番DBを共有しているため、通常は APPLY=1 で運用者が明示実行する。
// ─────────────────────────────────────────────────────────────
import { all, run } from "../lib/db.js";
import { classifyRestrictedCategory } from "../lib/category-filter.mjs";

const APPLY = process.env.APPLY === "1";

// 利益候補(AUTO/ESTIMATED)に加え、手動確認待ち(MANUAL_REVIEW)も監査対象にする。
// MANUAL_REVIEW には規制カテゴリ(サプリ等)が紛れ込むことがあるため。
// ※classifyRestrictedCategory が該当と判定した行だけ EXCLUDED にするので、
//   非該当の正規な手動確認品は一切触らない（安全）。
const rows = await all(
  "SELECT id, product_name, amazon_title, display_category, profit FROM findings WHERE display_category IN ('AUTO_PROFIT','ESTIMATED_PROFIT','MANUAL_REVIEW')"
);
console.log(`監査対象 findings（利益候補＋手動確認待ち）: ${rows.length} 件`);

const hits = [];
for (const r of rows) {
  const v = classifyRestrictedCategory({ title: r.product_name, amazonTitle: r.amazon_title });
  if (v.excluded) hits.push({ ...r, label: v.label, reason: v.reason });
}

if (!hits.length) {
  console.log("✅ 規制カテゴリの利益候補は残っていません。");
  process.exit(0);
}

console.log(`⚠ 規制カテゴリの利益候補: ${hits.length} 件`);
for (const h of hits) {
  console.log(`  id${h.id} [${h.label}] 利益${h.profit} | ${(h.amazon_title || h.product_name || "").slice(0, 45)}`);
}

if (!APPLY) {
  console.log("\n(dry-run) 反映するには APPLY=1 を付けて再実行してください。");
  process.exit(0);
}

for (const h of hits) {
  await run(
    "UPDATE findings SET display_category='EXCLUDED', is_deal=0, gate_reasons=COALESCE(gate_reasons,'')||' / '||? WHERE id=?",
    [h.reason, h.id]
  );
}
console.log(`\n✅ ${hits.length} 件を EXCLUDED へ再分類しました。`);
process.exit(0);
