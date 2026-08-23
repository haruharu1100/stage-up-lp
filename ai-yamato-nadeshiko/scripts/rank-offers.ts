/**
 * 申請順を機械で出す。
 *
 * 並べ方 = ①いつ申請できるか（OFFERS.md セクションDの前提条件）
 *          ②同じタイミングなら Offer Score と Survival Score の合成（Survival 重め）
 *
 * ★この出力は「1位に事業を賭けろ」という意味ではない。
 *   1社の承認可否で事業のGO/STOPを決めないための、候補の保持状況の一覧である。
 *
 * 実行: npm run offers:rank
 *       npm run offers:rank -- --freeze   （採点を offer_scores へ凍結して積む）
 */

import {
  rankOffers,
  freezeScores,
  warnThinCoverage,
  offerVerdictAllowed,
  cookieLabel,
  SURVIVAL_FLOOR,
  COMPOSITE_WEIGHT,
  MIN_SAMPLE,
  PRIMARY_CATEGORIES,
  BACKUP_CATEGORIES,
  type RankedOffer,
  type OfferCategory,
} from "../lib/offers.js";

const argv = process.argv.slice(2);
const doFreeze = argv.includes("--freeze");

const CATEGORY_JA: Record<OfferCategory, string> = {
  VPN: "VPN",
  ESIM: "eSIM",
  JAPAN_TRAVEL: "日本旅行/体験",
  JAPANESE_LANGUAGE: "語学",
  JAPAN_PRODUCTS: "日本商品",
  AI_TOOLS: "AIツール",
  OTHER: "その他",
};

// 全角混じりの日本語を等幅で並べるため、東アジア文字を2桁として数える
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}
function trunc(s: string, n: number): string {
  if (width(s) <= n) return s;
  let out = "";
  for (const ch of s) {
    if (width(out) + width(ch) > n - 1) break;
    out += ch;
  }
  return `${out}…`;
}
const pad = (s: string, n: number) => {
  const t = trunc(s, n - 1);
  return t + " ".repeat(Math.max(0, n - width(t)));
};
const padL = (s: string, n: number) => " ".repeat(Math.max(0, n - width(s))) + s;
const line = (n = 96) => "─".repeat(n);

function erpmCell(r: RankedOffer): string {
  return r.erpm.erpmUsd === null ? "算出不可" : `$${r.erpm.erpmUsd.toFixed(3)}`;
}

function basisCell(r: RankedOffer): string {
  const m: Record<string, string> = { FACT: "実測", MIXED: "混合", ASSUMPTION: "全部仮定" };
  return m[r.erpm.basis] ?? r.erpm.basis;
}

const result = await rankOffers();

console.log("");
console.log("AI YAMATO NADESHIKO ／ アフィリエイト案件 申請順");
console.log(`採点時刻: ${result.scoredAt}`);
console.log(
  `合成 = Offer×${COMPOSITE_WEIGHT.offer} + Survival×${COMPOSITE_WEIGHT.survival}` +
    ` ／ Survival下限 ${SURVIVAL_FLOOR}点未満は推薦しない`,
);
console.log(line());

// ---------------------------------------------------------------- 申請順
console.log("");
console.log("【1】申請順（この順で1社ずつ出す。まとめて申請しない）");
console.log("");
console.log(
  pad("順", 4) + pad("案件", 26) + pad("カテゴリ", 14) + padL("Offer", 7) +
    padL("Survival", 10) + padL("ERPM", 10) + "  " + pad("基準", 10) + "いつ申請できるか",
);
console.log(line(112));

result.ranked.forEach((r, i) => {
  console.log(
    pad(`${i + 1}`, 4) +
      pad(r.offer.name, 26) +
      pad(CATEGORY_JA[r.offer.category], 14) +
      padL(r.offerScore.score.toFixed(1), 7) +
      padL(r.survivalScore.score.toFixed(1), 10) +
      padL(erpmCell(r), 10) +
      "  " +
      pad(basisCell(r), 10) +
      r.readinessLabel,
  );
});

if (result.ranked.length === 0) {
  console.log("  （推薦できる案件が0件。verified_at と Survival 下限を満たす案件が無い）");
}
console.log("");
console.log("  ★この順番は「1位に事業を賭けろ」という意味ではない。1位が落ちても事業は止めない。");
console.log("    並べ方 = ①いつ申請できるか（前提条件）→ ②同じタイミングなら合成スコア順。");
console.log("    基準の「混合」は実測があるという意味ではない（下の【7】3を読むこと）。");

// ---------------------------------------------------------------- 各行の理由
console.log("");
console.log("【2】各行の理由（順位が変わったときに説明できるようにする）");

for (const [i, r] of result.ranked.entries()) {
  const o = r.offer;
  console.log("");
  console.log(`  ${i + 1}. ${o.name}  [${o.meta.ref ?? "-"}]  合成${r.composite}`);
  console.log(
    `     報酬: ${o.revsharePct !== null ? `${o.revsharePct}%` : ""}` +
      `${o.payoutAmount !== null ? `${o.revsharePct !== null ? " / " : ""}${o.payoutAmount}${o.payoutCurrency}` : ""}` +
      `${o.revsharePct === null && o.payoutAmount === null ? "UNKNOWN" : ""}` +
      ` ／ Cookie: ${cookieLabel(o.cookieDays)}` +
      ` ／ 最低支払: ${o.minPayoutUsd === null ? "UNKNOWN" : `$${o.minPayoutUsd}`}`,
  );
  console.log(
    `     日本在住: ${o.japanOk} ／ SNS: ${o.allowsSocial} ／ AI生成: ${o.allowsAi}` +
      ` ／ 申請状況: ${o.approvalStatus}`,
  );
  console.log(`     Offer Score ${r.offerScore.score}`);
  for (const c of r.offerScore.components) {
    const v = c.value === null ? "UNKNOWN" : c.value.toFixed(0);
    console.log(`       - ${pad(c.label, 20)} ${padL(v, 8)} (重み${c.weight})  ${c.note}`);
  }
  if (r.offerScore.unknownKeys.length) {
    console.log(
      `       ※ UNKNOWN の段（${r.offerScore.unknownKeys.join(", ")}）は0点にせず加重平均から外した`,
    );
  }
  console.log(`     Survival Score ${r.survivalScore.score}`);
  for (const c of r.survivalScore.components) {
    console.log(
      `       - ${pad(c.label, 20)} ${padL((c.value ?? 0).toFixed(0), 8)} (重み${c.weight})  ${c.note}`,
    );
  }
  console.log(`     ERPM ${erpmCell(r)} / 1,000表示  [${basisCell(r)}]`);
  console.log(
    `       式: 1000 × ${r.erpm.factors.map((f) => f.label).join(" × ")}`,
  );
  for (const f of r.erpm.factors) {
    const tag = f.basis === "FACT" ? "実測" : "仮定";
    const shown = f.key === "payout" ? `$${f.value.toFixed(2)}` : `${(f.value * 100).toFixed(2)}%`;
    console.log(`       - [${tag}] ${pad(f.label, 20)} ${padL(shown, 9)}  ${f.source}／${f.sample}`);
  }
  if (r.erpm.assumedKeys.length) {
    console.log(
      `       ※ 仮定した段: ${r.erpm.factors
        .filter((f) => f.basis === "ASSUMPTION")
        .map((f) => f.label)
        .join(" / ")}`,
    );
  }
  const verdict = await offerVerdictAllowed(o.id);
  if (!verdict.allowed) console.log(`       ※ ${verdict.reason}`);
  if (o.meta.readiness) {
    console.log(`     前提条件: ${o.meta.readiness.when} — ${o.meta.readiness.prereq}`);
  }
}

// ---------------------------------------------------------------- 保留
console.log("");
console.log(line());
console.log("【3】保留（条件は確認できたが、いま申請順に置けない）");
console.log("");
if (result.held.length === 0) {
  console.log("  なし");
} else {
  for (const r of result.held) {
    console.log(
      `  - ${pad(r.offer.name, 24)} ${pad(CATEGORY_JA[r.offer.category], 12)}` +
        ` Offer ${padL(r.offerScore.score.toFixed(1), 5)} / Survival ${padL(r.survivalScore.score.toFixed(1), 5)}`,
    );
    for (const b of r.blockReasons) console.log(`      理由: ${b}`);
  }
}

// ---------------------------------------------------------------- 使用不可
console.log("");
console.log("【4】使用不可（verified_at が無い＝条件を一次情報で確認できていない）");
console.log("");
console.log(`  ${result.unusable.length}件。推薦・送客の対象にしない。`);
console.log("  理由: 「禁止と書いていない＝許可」ではない。承認後に条件変更・報酬没収が起きても抗弁できない。");
const byReason = new Map<string, string[]>();
for (const u of result.unusable) {
  const list = byReason.get(u.reason) ?? [];
  list.push(u.name);
  byReason.set(u.reason, list);
}
for (const [reason, names] of byReason) {
  console.log(`  ・${reason}: ${names.length}件`);
  console.log(`     ${names.join(" / ")}`);
}

// ---------------------------------------------------------------- 除外
console.log("");
console.log("【5】調査で不採用（ここへは送客しない）");
console.log("");
for (const e of result.excluded) {
  console.log(`  - ${pad(e.name, 24)} ${trunc(e.reason, 90)}`);
}

// ---------------------------------------------------------------- カテゴリ保持状況
console.log("");
console.log(line());
console.log("【6】カテゴリの保持状況（★1社依存にしないための本体）");
console.log("");
console.log("  本命3カテゴリ:");
for (const c of result.coverage.filter((x) => PRIMARY_CATEGORIES.includes(x.category))) {
  const mark = c.recommended > 0 ? "⭕" : "✕";
  console.log(
    `    ${mark} ${pad(CATEGORY_JA[c.category], 14)} 申請可能 ${c.recommended}件 / 保留 ${c.held}件`,
  );
}
console.log("  バックアップ3カテゴリ:");
for (const c of result.coverage.filter((x) => BACKUP_CATEGORIES.includes(x.category))) {
  const mark = c.recommended > 0 ? "⭕" : "✕";
  console.log(
    `    ${mark} ${pad(CATEGORY_JA[c.category], 14)} 申請可能 ${c.recommended}件 / 保留 ${c.held}件`,
  );
}

const empty = await warnThinCoverage(result);
const alive = result.coverage.filter((c) => c.recommended > 0).length;
console.log("");
if (empty.length) {
  console.log(
    `  ★申請可能な候補がいないカテゴリ: ${empty.map((c: OfferCategory) => CATEGORY_JA[c]).join(" / ")}`,
  );
}
console.log(`  候補を持てているカテゴリ: ${alive} / 6（申請学習.md の下限は3）`);
if (alive < 3) console.log("  → 下限割れ。通知を作成した。ここを埋めるまで1社依存の状態にある。");

// ---------------------------------------------------------------- 読み方
console.log("");
console.log(line());
console.log("【7】この表の読み方（★誤読するとPhase1の前提が壊れる）");
console.log("");
console.log("  1. これは「申請する順番」であって「1位に事業を賭ける」という意味ではない。");
console.log("     1位が落ちても事業のGO/STOPは判断しない。落ちた理由を記録して2社目へ進むだけ。");
console.log("  2. Offer Score（儲かるか）だけで並べていない。");
console.log(`     Survival Score（続くか）が${SURVIVAL_FLOOR}点未満の案件は、報酬が高くても推薦しない。`);
console.log("     高報酬でもプログラムが消えれば取り分は0（ZenPop 404 / Japan Crate 消滅可能性が実例）。");
if (result.measuredFactors === 0) {
  console.log("  3. ★ERPMは実測ゼロ。表示・LPクリック・成約・承認のどれも1件も計測できていない。");
  console.log("     基準が「混合」の行も、実測ではなく OFFERS.md の一次情報の固定単価を使っただけ。");
  console.log("     よってこの並びは『候補の順序』であって DECISION ではない（KPI定義.md ルール3）。");
} else {
  console.log(
    `  3. ERPMは実測${result.measuredFactors}段と仮定が混在している。各行の[実測]/[仮定]の内訳を必ず見ること。`,
  );
  console.log("     実測が出た段だけを差し替える。最低サンプル未達の段は仮定のまま据え置く。");
}
console.log("  4. AI生成コンテンツの可否は43社すべてUNKNOWN。");
console.log("     Survival Score の「AI可否」10点は現状どの案件も取れていない（満点は90点）。");
console.log("     申請時の自己申告で書面回答を取るまで、ここは埋まらない。");
console.log(
  `  5. 成約が${MIN_SAMPLE.CONVERSIONS_FOR_OFFER_VERDICT}件に満たない案件について「この案件はダメ」とは書けない。`,
);
console.log("     いまは全案件が未成約なので、この表の低い順位は『悪い案件』の意味ではない。");

// ---------------------------------------------------------------- 凍結
console.log("");
if (doFreeze) {
  const n = await freezeScores(result);
  console.log(`offer_scores へ ${n}件を凍結して追記した（上書きはしない）。`);
} else {
  console.log("採点を保存するには: npm run offers:rank -- --freeze");
}
console.log("");
