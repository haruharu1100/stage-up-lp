import { all, one, parseJson } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { loadOffers } from '../lib/catalog/sync';
import { matchOffers, primarySellable, saveOfferMatches } from '../lib/sales/offer';
import { decideChannel, isPhoneFriendly, saveChannelDecision, CHANNEL_LABEL, type Channel } from '../lib/sales/channel';
import { computeCompanyScore, saveCompanyScore } from '../lib/sales/score';
import type { NeedFlags } from '../lib/needs';
import { toScaleBand, type IndustryKey } from '../lib/industry';
import { SCOPE_JA, scopeFromArgv, scopeSql } from './_scope';

/**
 * 「この会社に何を売るか」「どうやって連絡するか」「いくらの見込みか」を出す。
 * 読み取り済みの結果（company_analyses）を使うので、先に npm run analyze が必要。
 *
 * 使い方: npm run score -- --real （本物だけ）／ --test （練習用だけ）／ 省略で全部
 */

async function main() {
  await initSettings();
  const offers = await loadOffers(false);
  const scope = scopeFromArgv();
  console.log(`■ 対象: ${SCOPE_JA[scope]}`);
  const companies = await all(`SELECT * FROM companies WHERE ${scopeSql(scope)} ORDER BY id`);
  if (companies.length === 0) {
    console.log('会社が1件も入っていません。先に npm run seed か npm run companies:import を実行してください。');
    return;
  }

  const channels: Record<Channel, number> = { PHONE: 0, EMAIL: 0, FORM: 0, MANUAL: 0, SKIP: 0 };
  const offerCount: Record<string, number> = {};
  let noAnalysis = 0;
  let noOffer = 0;
  let evNull = 0;
  const ranked: { name: string; ev: number; offer: string; channel: Channel }[] = [];

  for (const c of companies) {
    const a = await one('SELECT * FROM company_analyses WHERE company_id = ?', [c.id]);
    if (!a) {
      noAnalysis++;
      continue;
    }
    const needFlags = parseJson<NeedFlags>(a.need_flags, {});
    const industry = String(a.industry) as IndustryKey;
    const confidence = Number(a.confidence ?? 0);

    const matches = matchOffers(industry, needFlags, offers, toScaleBand(c.scale_band));
    await saveOfferMatches(Number(c.id), matches);
    const primary = primarySellable(matches);
    const primaryOffer = primary ? offers.find((o) => o.code === primary.offerCode) ?? null : null;
    if (!primaryOffer) noOffer++;
    else offerCount[primaryOffer.name] = (offerCount[primaryOffer.name] ?? 0) + 1;

    const decision = await decideChannel(c, { phoneFriendly: isPhoneFriendly(industry), hasSellableOffer: primaryOffer !== null });
    await saveChannelDecision(Number(c.id), decision);
    channels[decision.channel]++;

    const s = await computeCompanyScore({ company: c, needFlags, confidence, matches, primaryOffer, channel: decision.channel });
    await saveCompanyScore(Number(c.id), s);
    if (s.expectedValue === null) evNull++;
    else ranked.push({ name: String(c.name), ev: s.expectedValue, offer: primaryOffer?.name ?? '—', channel: decision.channel });
  }

  console.log(`■ 点数付け: ${companies.length}社`);
  if (noAnalysis > 0) console.log(`  読み取り結果が無くて飛ばした: ${noAnalysis}社（先に npm run analyze）`);
  console.log(`  連絡手段: ${(Object.keys(channels) as Channel[]).map((k) => `${CHANNEL_LABEL[k]}${channels[k]}`).join(' / ')}`);
  console.log('  売る商品の内訳:');
  for (const [k, n] of Object.entries(offerCount).sort((a, b) => b[1] - a[1])) console.log(`   ・${n}社 … ${k}`);
  if (noOffer > 0) console.log(`   ・${noOffer}社 … 売れる商品が当たらない`);
  console.log(`  期待値を出せなかった会社: ${evNull}社（出せない理由はデータベースに残してあります。0とは書きません）`);
  console.log('  期待値の高い順（上位10社）:');
  for (const r of ranked.sort((a, b) => b.ev - a.ev).slice(0, 10)) {
    console.log(`   ・${r.ev.toFixed(2)} … ${r.name}／${r.offer}／${CHANNEL_LABEL[r.channel]}`);
  }
  console.log('  ※期待値は「予想契約金額 × 成約確率 ÷ 営業コスト」。成約確率はまだ実測ではなく仮置きの数字です。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
