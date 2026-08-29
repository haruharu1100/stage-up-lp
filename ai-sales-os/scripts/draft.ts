import { all, one, parseJson, run } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { loadOffers } from '../lib/catalog/sync';
import { buildCallScript, buildDraft, saveCallScript, saveDraft } from '../lib/sales/draft';
import type { Channel } from '../lib/sales/channel';
import type { NeedFlags } from '../lib/needs';
import type { IndustryKey } from '../lib/industry';

/**
 * 会社ごとの文面（メール／フォーム／電話の台本）を作る。送信は一切しない。
 * 先に npm run analyze と npm run score が必要。
 *
 * 使い方: npm run draft [-- --show 3]（--show で中身を何件か表示）
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  await initSettings();
  const offers = await loadOffers(false);
  const companies = await all('SELECT * FROM companies ORDER BY id');
  if (companies.length === 0) {
    console.log('会社が1件も入っていません。');
    return;
  }

  // 前回の文面は先に消す。残したままだと「前回の自分の文面と似ている」で全部止まる。
  const ids = companies.map((c) => Number(c.id));
  await run(`DELETE FROM outreach_drafts WHERE company_id IN (${ids.map(() => '?').join(',')})`, ids);

  const reasons: Record<string, number> = {};
  let ready = 0;
  let blocked = 0;
  const samples: string[] = [];
  const show = Number(arg('show') ?? 0);

  for (const c of companies) {
    const a = await one('SELECT * FROM company_analyses WHERE company_id = ?', [c.id]);
    const ch = await one('SELECT channel FROM channel_decisions WHERE company_id = ?', [c.id]);
    const om = await one('SELECT offer_code FROM company_offers WHERE company_id = ? AND sellable = 1 ORDER BY fit_score DESC LIMIT 1', [c.id]);
    if (!a || !ch) continue;
    const offer = om ? offers.find((o) => o.code === String(om.offer_code)) ?? null : null;
    if (!offer) {
      blocked++;
      reasons['売れる商品が当たらない'] = (reasons['売れる商品が当たらない'] ?? 0) + 1;
      continue;
    }

    const input = {
      company: c,
      industry: String(a.industry) as IndustryKey,
      needFlags: parseJson<NeedFlags>(a.need_flags, {}),
      issues: parseJson<string[]>(a.issues, []),
      evidence: parseJson<string[]>(a.evidence, []),
      offer,
      channel: String(ch.channel) as Channel,
    };
    const d = await buildDraft(input);
    await saveDraft(d);
    if (d.status === 'READY') {
      ready++;
      if (samples.length < show) samples.push(`--- ${c.name}（${input.channel}）\n${d.subject ? `件名: ${d.subject}\n` : ''}${d.body}`);
    } else {
      blocked++;
      const key = (d.blockedReason ?? '理由不明').replace(/（類似度[\d.]+／上限[\d.]+）/, '').trim();
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
    if (input.channel === 'PHONE') await saveCallScript(Number(c.id), offer.code, buildCallScript(input));
  }

  console.log(`■ 文面づくり: 使える${ready}件 / 止めた${blocked}件`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`   ・${n}件 … ${r}`);
  for (const s of samples) console.log(`\n${s}`);
  console.log('\n※ここで作るのは下書きだけです。送る処理はこのシステムにありません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
