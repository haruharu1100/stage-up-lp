/**
 * 本物の営業候補をもう一段絞り込む（PHASE A）。
 *
 * ★人が85社を全部読む運用にしないための処理。
 *   ここで全社に点をつけ、商品ごとの内訳を出し、上位20社だけを次の監査へ渡す。
 *
 * ★TESTは1件も混ぜない。混ぜると練習用の会社が営業候補の上位に来る。
 */
import { all, migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { loadOffers } from '../lib/catalog/sync';
import { pricesToDecide } from '../lib/catalog/pricing';
import { rankRealCompanies, type CompanyOpportunity } from '../lib/sales/opportunity';
import { offerGroupOf, OFFER_GROUPS } from '../lib/catalog/definitions';
import { INDUSTRY_LABEL, type IndustryKey } from '../lib/industry';
import { CHANNEL_LABEL } from '../lib/sales/channel';

const yen = (n: number | null) => (n === null ? '未定' : `${n.toLocaleString('ja-JP')}円`);
const pct = (n: number | null) => (n === null ? '未算出' : `${(n * 100).toFixed(2)}%`);

/** 全角は2文字ぶんの幅として数える。数えないと日本語の表がずれて読めなくなる。 */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[　-ヿ㐀-鿿＀-｠]/.test(ch) ? 2 : 1;
  return w;
}
const padR = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
const padL = (s: string, n: number) => ' '.repeat(Math.max(0, n - width(s))) + s;

function industryJa(k: string): string {
  return INDUSTRY_LABEL[k as IndustryKey] ?? k;
}

async function main() {
  await migrate();
  await initSettings();

  const { all: ranked, top } = await rankRealCompanies(20);

  console.log('══════════════════════════════════════════════════════════');
  console.log('PHASE A — 本物の営業候補の再評価');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`評価した会社数（REALのみ・送れる文面あり）: ${ranked.length}社`);
  const testCount = await all("SELECT COUNT(*) n FROM companies WHERE data_origin = 'TEST'");
  console.log(`（参考）練習用の会社: ${Number(testCount[0].n)}社 — この集計には1件も入れていない`);
  console.log('');

  // ---------------------------------------------------------------- A1 商品別の内訳
  console.log('■ A1. 提案している商品ごとの内訳');
  console.log('');
  const byGroup = new Map<string, CompanyOpportunity[]>();
  for (const g of OFFER_GROUPS) byGroup.set(g, []);
  byGroup.set('提案できる商品なし', []);
  for (const r of ranked) {
    const g = r.primary ? offerGroupOf(r.primary.code) : '提案できる商品なし';
    byGroup.get(g)!.push(r);
  }
  console.log(`  ${padR('商品分類', 22)}${padL('候補', 6)}${padL('平均点', 8)}${padL('予想契約金額', 14)}${padL('予想受注率', 12)}${padL('予想利益', 12)}`);
  console.log('  ' + '─'.repeat(74));
  for (const [g, list] of byGroup) {
    if (list.length === 0) continue;
    const avg = Math.round(list.reduce((s, x) => s + x.opportunityScore, 0) / list.length);
    const revs = list.map((x) => x.expectedRevenue).filter((v): v is number => v !== null);
    const profits = list.map((x) => x.expectedProfit).filter((v): v is number => v !== null);
    const rates = list.map((x) => x.closeProbability).filter((v): v is number => v !== null);
    const avgRev = revs.length === 0 ? null : Math.round(revs.reduce((s, x) => s + x, 0) / revs.length);
    const avgProfit = profits.length === 0 ? null : Math.round(profits.reduce((s, x) => s + x, 0) / profits.length);
    const avgRate = rates.length === 0 ? null : rates.reduce((s, x) => s + x, 0) / rates.length;
    console.log(
      `  ${padR(g, 22)}${padL(`${list.length}社`, 6)}${padL(`${avg}点`, 8)}${padL(yen(avgRev), 14)}${padL(pct(avgRate), 12)}${padL(yen(avgProfit), 12)}`,
    );
  }
  console.log('');
  const noRev = ranked.filter((r) => r.expectedRevenue === null).length;
  if (noRev > 0) {
    console.log(`  ※ ${noRev}社は予想契約金額を出せない。理由は商品の値段が決まっていないため（下の「決めるべき値段」を参照）。`);
    console.log('    分からない金額を仮の数字で埋めていない。埋めると、利益にならない会社が上位に来る。');
  }
  console.log('');

  // ---------------------------------------------------------------- A2 1社1商品
  console.log('■ A2. 1社につき提案する商品は1つだけ（PRIMARY）');
  const withSecondary = ranked.filter((r) => r.secondary).length;
  const mismatch = ranked.filter((r) => r.offerMismatch);
  console.log(`  控えの商品（SECONDARY）を持つ会社: ${withSecondary}社 — 初回の営業では出さない`);
  console.log(`  作ってある文面と、いちばん合う商品がずれている会社: ${mismatch.length}社`);
  for (const m of mismatch.slice(0, 10)) console.log(`    ・${m.companyName}: ${m.offerMismatchReason}`);
  console.log('');

  // ---------------------------------------------------------------- 決めるべき値段
  const offers = await loadOffers(false);
  const todo = await pricesToDecide(offers);
  const sellableTodo = todo.filter((t) => t.status === 'SELLABLE');
  console.log('■ 決めるべき値段（ここが空のままだと、金額の予想は一切出せない）');
  if (sellableTodo.length === 0) {
    console.log('  今すぐ売れる商品の値段はすべて決まっている。');
  } else {
    for (const t of sellableTodo) console.log(`  ・${t.offerName}  → 設定キー「${t.settingKey}」が空欄`);
    console.log('  ※ AIは値段を推測して埋めない。人が決めるまで「未定」と出す。');
  }
  console.log('');

  // ---------------------------------------------------------------- A3 TOP20
  console.log('══════════════════════════════════════════════════════════');
  console.log('■ A3. 上位20社（1画面で判断できる形）');
  console.log('══════════════════════════════════════════════════════════');
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    console.log('');
    console.log(`【${i + 1}位】${r.companyName}   ${r.opportunityScore}点`);
    console.log(`  法人番号     : ${r.corporateNumber ?? '不明'}`);
    console.log(`  業種         : ${industryJa(r.industry)}`);
    console.log(`  公式HP       : ${r.website ?? 'なし'}（${r.websiteVerdict}）`);
    console.log(`  営業チャネル : ${r.channel ? CHANNEL_LABEL[r.channel] : '未決定'}`);
    console.log(`  提案商品     : ${r.primary?.name ?? 'なし'}`);
    console.log(`  提案理由     : ${r.primaryReason}`);
    console.log(`  会社固有の根拠: ${r.scoreReason}`);
    console.log(
      `  内訳         : 商品${r.productMatchScore} / 今売る理由${r.needStrengthScore} / 売れる状態${r.productReadinessScore} / 根拠${r.evidenceScore} / 連絡${r.contactabilityScore} / 文章${r.copyQualityScore} / リスク${r.reputationRiskScore} / 手間${r.effortScore}`,
    );
    console.log(`  予想契約金額 : ${yen(r.expectedRevenue)}${r.expectedUnavailableReason ? `（${r.expectedUnavailableReason}）` : ''}`);
    console.log(`  予想受注率   : ${pct(r.closeProbability)}（推定・未実測）`);
    console.log(`  予想利益     : ${yen(r.expectedProfit)}`);
    console.log(`  リスク       : ${r.reputationRiskReason}`);
    console.log(`  控えの商品   : ${r.secondary?.name ?? 'なし'}（${r.secondaryHoldReason}）`);
  }

  console.log('');
  console.log('※ 営業文・電話台本は長いのでここには出さない。管理画面（/outreach）と次の監査で全文を確認する。');
  console.log('※ この時点で外部へ送ったものは0件。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
