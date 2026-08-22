/**
 * Phase 3.9d（売れるかテスト）の受け入れテスト。
 *
 * 【このテストが生まれた理由】
 * ユーザーの判断：
 *
 *   「一旦これが売れるものなのかどうかテストするので keepa を使用して」
 *
 * 「使う」と決まった道具ほど、なし崩しに扱いが甘くなる。
 * ここで潰しておきたいのは、将来こうなることである。
 *
 *   1. Keepa の数字を「Amazon が提供したデータ」と同じ扱いにしてしまう
 *   2. 売れ筋順位の下落回数を「販売数」と書いてしまう（推定が事実になる）
 *   3. 空欄を推測で埋めて「売れる」と判定してしまう
 *   4. 候補を増やしたくて閾値をこっそり下げる
 *   5. システムが Keepa へ自分でアクセスし始める
 *   6. ASIN から商品ページURLを組み立て始める（ルール55違反）
 *   7. Keepa 由来の件数を「実市場データ100件」に数え始める
 *   8. 同じものを2回登録して件数が水増しされる
 *   9. 「売れる」判定を「買ってよい」判定として使い始める
 *  10. SP-API を見送った事実が、どこにも残らないまま忘れられる
 */
import fs from 'node:fs';
import path from 'node:path';
import { all, run } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import {
  judgeSellability,
  SELLABILITY_SCOPE_NOTE,
  SELLABILITY_SOURCE_TOOLS,
  SELLABILITY_THRESHOLDS,
  SELLABILITY_VERDICTS,
  SELLABILITY_VERDICT_JA,
  THIRD_PARTY_TOOL_CAUTION,
} from '../lib/sellability';
import { recordSellCheck, sellCheckSummary } from '../lib/sellcheck';
import { FIRST_LIVE_CONNECTOR_STATUS_JA, VENUE_RESEARCH, passesGate } from '../lib/venuepermissions';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  NG   ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = path.join(__dirname, '..');
const readFile = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** きょうから n 日前の日付（ISO）。 */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  await ensureReady();

  // ================================================================
  console.log('\n[1. 判定は4種類。売れる／売れないの2択にしていない]');
  check('判定は4種類ある', SELLABILITY_VERDICTS.length === 4);
  check('「売れてはいるがライバルが多い」を別に持っている',
    SELLABILITY_VERDICTS.includes('CROWDED' as any));
  check('「判断できない」を持っている', SELLABILITY_VERDICTS.includes('UNKNOWN' as any));
  check('4つとも日本語の説明がある',
    SELLABILITY_VERDICTS.every((v) => (SELLABILITY_VERDICT_JA[v] ?? '').length > 0));

  // ================================================================
  console.log('\n[2. 空欄を推測で埋めない]');
  {
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 90, rankDrops: 40, offerCount: null });
    check('ライバル出品者数が空欄なら判定しない', r.verdict === 'UNKNOWN');
    check('何が足りないかを日本語で言う', r.missing.length > 0 && r.reason.includes('判断できません'));
  }
  {
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 90, rankDrops: null, offerCount: 3 });
    check('下落回数が空欄なら判定しない', r.verdict === 'UNKNOWN');
  }
  {
    const r = judgeSellability({ observedAt: null, windowDays: 90, rankDrops: 40, offerCount: 3 });
    check('観測日が空欄なら判定しない', r.verdict === 'UNKNOWN');
  }

  // ================================================================
  console.log('\n[3. 古い数字・おかしい数字で「売れる」と言わない]');
  {
    const r = judgeSellability({
      observedAt: daysAgo(SELLABILITY_THRESHOLDS.STALE_DAYS + 5),
      windowDays: 90, rankDrops: 90, offerCount: 1,
    });
    check('観測が古すぎると判定しない', r.verdict === 'UNKNOWN');
    check('古い理由を日本語で言う', r.reason.includes('日たっています'));
  }
  {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const r = judgeSellability({ observedAt: future, windowDays: 90, rankDrops: 90, offerCount: 1 });
    check('観測日が未来なら判定しない', r.verdict === 'UNKNOWN');
  }
  {
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 45, rankDrops: 40, offerCount: 3 });
    check('決めた期間（30/90/180日）以外は判定しない', r.verdict === 'UNKNOWN');
  }
  {
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 90, rankDrops: -1, offerCount: 3 });
    check('下落回数がマイナスなら判定しない', r.verdict === 'UNKNOWN');
  }

  // ================================================================
  console.log('\n[4. 少ない材料で「売れる」と言わない]');
  {
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 90, rankDrops: 0, offerCount: 2 });
    check('1回も動いていなければ「売れていない」', r.verdict === 'DOES_NOT_SELL');
  }
  {
    const r = judgeSellability({
      observedAt: daysAgo(1), windowDays: 90,
      rankDrops: SELLABILITY_THRESHOLDS.MIN_RANK_DROPS - 1, offerCount: 0,
    });
    check('動きが少なすぎるときは「売れる」と言わない', r.verdict === 'UNKNOWN');
    check('たまたまと区別がつかないことを日本語で言う', r.reason.includes('たまたま'));
  }

  // ================================================================
  console.log('\n[5. 売れていても、自分に回ってこないなら分けて出す]');
  {
    // 90日で30回＝月10回。ライバル99人なら自分の取り分は月0.1回。
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 90, rankDrops: 30, offerCount: 99 });
    check('ライバルが多いときは SELLS にしない', r.verdict === 'CROWDED');
    check('自分の取り分を数字で出している', (r.perSellerMonthly ?? 0) > 0 && (r.perSellerMonthly ?? 0) < 1);
    check('何日で1個売れるかを出している', (r.estimatedTurnoverDays ?? 0) > 30);
  }
  {
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 90, rankDrops: 30, offerCount: 2 });
    check('十分に回るなら「売れている」', r.verdict === 'SELLS');
    check('自分の取り分が月1個以上ある',
      (r.perSellerMonthly ?? 0) >= SELLABILITY_THRESHOLDS.MIN_PER_SELLER_MONTHLY);
  }
  {
    // 自分を数に入れずに割ると取り分を多く見積もる。ライバル数+1で割っていることを確かめる。
    const r = judgeSellability({ observedAt: daysAgo(1), windowDays: 30, rankDrops: 10, offerCount: 9 });
    check('取り分はライバル数+1で割っている（自分を数に入れている）',
      Math.abs((r.perSellerMonthly ?? 0) - 1) < 0.0001);
  }

  // ================================================================
  console.log('\n[6. 数字を「推定」と呼び続けている]');
  {
    const src = readFile('lib/sellability.ts');
    check('下落回数は販売数ではない、とファイルに書いてある',
      src.includes('販売数そのものではない'));
    check('取り出す値の名前が estimated（推定）で始まっている',
      src.includes('estimatedMonthlySales') && src.includes('estimatedTurnoverDays'));
    const page = readFile('app/sellability/page.tsx');
    check('画面にも「推定」と出している', page.includes('推定'));
    check('画面に「販売数そのものではありません」と書いてある',
      page.includes('販売数そのものではありません'));
  }

  // ================================================================
  console.log('\n[7. 閾値を勝手に緩めない仕掛けがある]');
  {
    const src = readFile('lib/sellability.ts');
    check('閾値は定数として1か所にまとめてある', src.includes('SELLABILITY_THRESHOLDS'));
    check('「甘くしてはいけない」と理由が書いてある',
      src.includes('商品数を増やすためにAI判定を甘くしてはいけません'));
    check('下落回数の下限は3以上', SELLABILITY_THRESHOLDS.MIN_RANK_DROPS >= 3);
    check('自分の取り分の下限は月1個以上', SELLABILITY_THRESHOLDS.MIN_PER_SELLER_MONTHLY >= 1);
    check('古さの上限は30日以内', SELLABILITY_THRESHOLDS.STALE_DAYS <= 30);
    const page = readFile('app/sellability/page.tsx');
    check('判定の決まりを画面に出している（隠していない）', page.includes('勝手に緩めません'));
  }

  // ================================================================
  console.log('\n[8. システムが Keepa へアクセスしない]');
  {
    for (const f of ['lib/sellability.ts', 'lib/sellcheck.ts', 'app/sellability/page.tsx', 'app/sellability/SellCheckForm.tsx']) {
      const src = readFile(f);
      const hasNet = /\bfetch\s*\(|axios|node-fetch|https?\.request|puppeteer|playwright/.test(src);
      check(`${f} に通信処理が入っていない`, !hasNet);
    }
    const src = readFile('lib/sellcheck.ts');
    check('URLを組み立てる関数を作っていない（ルール55）',
      !/function\s+(build|make|generate)Url/i.test(src));
    check('ASINからAmazonのURLを組み立てていない',
      !src.includes('amazon.co.jp/dp/') && !src.includes('/dp/${'));
  }

  // ================================================================
  console.log('\n[9. 出どころを分けて持っている]');
  {
    check('見た画面の種類を持っている', SELLABILITY_SOURCE_TOOLS.length >= 3);
    check('Keepa を第三者ツールとして持っている',
      SELLABILITY_SOURCE_TOOLS.includes('KEEPA' as any));
    check('第三者ツールの数字に注意書きが付く',
      THIRD_PARTY_TOOL_CAUTION.includes('正式に提供されたデータではありません'));
    check('注意書きに「規約の確認はご本人」と書いてある',
      THIRD_PARTY_TOOL_CAUTION.includes('ご本人の確認が必要'));
  }

  // ================================================================
  console.log('\n[10. Keepa を許可8項目の一覧に登録してある]');
  {
    const keepa = VENUE_RESEARCH.find((r) => r.connector_code === 'KEEPA_API');
    check('Keepa が一覧にある', !!keepa);
    check('8項目のうち、確認できていないものは UNKNOWN のまま',
      Object.values(keepa?.permissions ?? {}).filter((v) => v === 'UNKNOWN').length >= 6);
    check('「APIがあるから使ってよい」にしていない',
      keepa?.permissions.api_exists === 'UNKNOWN');
    check('Gate を通していない（自動接続の候補にしていない）', keepa ? !passesGate(keepa) : false);
    check('公式ページを開けなかったことを記録してある',
      (keepa?.note ?? '').includes('403'));
    check('第三者記事を根拠にしていないと書いてある',
      (keepa?.note ?? '').includes('第三者記事'));
    check('いまの使い方が人の手入力だと書いてある',
      (keepa?.note ?? '').includes('HUMAN_ENTRY'));
    check('未確認の項目が残してある', (keepa?.unknowns ?? []).length >= 5);
  }

  // ================================================================
  console.log('\n[11. SP-API を見送った事実が残っている]');
  {
    const sp = VENUE_RESEARCH.find((r) => r.connector_code === 'AMAZON_SP_API');
    check('見送りになったことが記録されている', (sp?.note ?? '').includes('見送り'));
    check('見送りの理由が書いてある', (sp?.note ?? '').includes('Keepa'));
    check('調査の点数は下げていない（事実と判断を混ぜていない）',
      (sp?.scores.commercial ?? 0) > 0 && (sp?.scores.storage ?? 0) > 0);
    check('第1自動市場の一行に、見送りの事実が入っている',
      FIRST_LIVE_CONNECTOR_STATUS_JA.includes('見送り'));
    check('★候補が0件になっても繰り上げないと書いてある',
      FIRST_LIVE_CONNECTOR_STATUS_JA.includes('繰り上げはしません'));
    check('第1自動市場はご本人と一緒に決めると書いてある',
      FIRST_LIVE_CONNECTOR_STATUS_JA.includes('ご本人と一緒に決めます'));
  }

  // ================================================================
  console.log('\n[12. 記録は積む。上書きしない。2回押しても増えない]');
  {
    // このテストが作った行だけを消す（他のデータに触らない）。
    const KEY = 'TESTKEY-SELLCHECK-9D';
    await run('DELETE FROM sellability_checks WHERE product_key = ?', [KEY]);

    const day = daysAgo(2);
    const first = await recordSellCheck({
      productKey: KEY, venueCode: 'AMAZON', sourceTool: 'KEEPA',
      observedAt: day, windowDays: 90, rankDrops: 30, offerCount: 2,
      avgPrice: '10000', currentPrice: '10200',
    });
    check('1件記録できた', first.ok && !first.duplicate);
    check('判定が返ってくる', first.judged?.verdict === 'SELLS');
    check('第三者ツールの注意書きが付いてくる', (first.caution ?? '').length > 0);

    const again = await recordSellCheck({
      productKey: KEY, venueCode: 'AMAZON', sourceTool: 'KEEPA',
      observedAt: day, windowDays: 90, rankDrops: 30, offerCount: 2,
    });
    check('同じ内容をもう一度入れても増えない（冪等）', again.ok && again.duplicate);

    const rows1 = await all('SELECT COUNT(*) AS n FROM sellability_checks WHERE product_key = ?', [KEY]);
    check('行は1件のまま', Number(rows1[0]?.n) === 1);

    // 別の日に見たら積む（上書きしない）
    await recordSellCheck({
      productKey: KEY, venueCode: 'AMAZON', sourceTool: 'KEEPA',
      observedAt: daysAgo(1), windowDays: 90, rankDrops: 4, offerCount: 40,
    });
    const rows2 = await all(
      'SELECT verdict FROM sellability_checks WHERE product_key = ? ORDER BY observed_at ASC', [KEY],
    );
    check('日を変えると積み上がる', rows2.length === 2);
    check('前の判定が残っている（上書きしていない）', String(rows2[0]?.verdict) === 'SELLS');
    check('変化が分かる（今回は鈍った）', String(rows2[1]?.verdict) !== 'SELLS');

    // 判断できないものも捨てずに残す
    await recordSellCheck({
      productKey: KEY, venueCode: 'AMAZON', sourceTool: 'KEEPA',
      observedAt: daysAgo(3), windowDays: 90, rankDrops: 30, offerCount: null,
    });
    const unknowns = await all(
      `SELECT COUNT(*) AS n FROM sellability_checks WHERE product_key = ? AND verdict = 'UNKNOWN'`, [KEY],
    );
    check('「判断できない」も捨てずに記録している', Number(unknowns[0]?.n) === 1);

    // ------------------------------------------------------------
    console.log('\n[13. Keepa由来を実市場データに数えていない]');
    const counted = await all(
      'SELECT COUNT(*) AS n FROM sellability_checks WHERE counts_as_real_market = 1',
    );
    check('実市場データ100件に数えている件数は0', Number(counted[0]?.n) === 0);
    const summary = await sellCheckSummary();
    check('まとめでも0件と出る', summary.countedAsRealMarket === 0);
    check('件数と商品点数を分けて数えている', summary.total >= summary.distinctProducts);
    const page = readFile('app/sellability/page.tsx');
    check('画面にも「数えていません」と書いてある', page.includes('数えていません'));

    await run('DELETE FROM sellability_checks WHERE product_key = ?', [KEY]);
  }

  // ================================================================
  console.log('\n[14. 「売れる」を「買ってよい」にすり替えていない]');
  {
    check('売れるかテストの適用範囲が書いてある',
      SELLABILITY_SCOPE_NOTE.includes('買ってよいかどうかの判定ではありません'));
    check('利益・手数料は別の画面だと書いてある',
      SELLABILITY_SCOPE_NOTE.includes('利益') && SELLABILITY_SCOPE_NOTE.includes('手数料'));
    const page = readFile('app/sellability/page.tsx');
    check('画面にも限界を書いている', page.includes('この画面の限界'));
    const form = readFile('app/sellability/SellCheckForm.tsx');
    check('入力欄の画面にも適用範囲を出している', form.includes('SELLABILITY_SCOPE_NOTE'));
  }

  // ================================================================
  console.log('\n[15. 画面の部品がデータベース層を引きずっていない（ルール37）]');
  {
    const form = readFile('app/sellability/SellCheckForm.tsx');
    check('入力欄は lib/sellability.ts だけを読んでいる', form.includes("@/lib/sellability"));
    check('入力欄は lib/sellcheck.ts を読んでいない', !form.includes("@/lib/sellcheck"));
    const vocab = readFile('lib/sellability.ts');
    check('lib/sellability.ts は他のファイルを import していない',
      !/^\s*import\s/m.test(vocab));
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log('【売れるかテストの正直な数字】');
  const s = await sellCheckSummary();
  console.log(`  調べた商品：${s.distinctProducts}点（記録 ${s.total}件）`);
  console.log(`  売れている：${s.byVerdict.SELLS}件 ／ ライバルが多い：${s.byVerdict.CROWDED}件`);
  console.log(`  売れていない：${s.byVerdict.DOES_NOT_SELL}件 ／ 判断できない：${s.byVerdict.UNKNOWN}件`);
  console.log(`  実市場データ100件に数えた件数：${s.countedAsRealMarket}件`);
  console.log('='.repeat(72));

  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.9d（売れるかテスト）の受け入れ条件をすべて満たしています。');
  console.log('※ このシステムは Keepa にも Amazon にも一切アクセスしません。人が見て書き写す方式だけです。');
  console.log('※ 売れ筋順位の下落回数は販売数そのものではないため、出す数字はすべて「推定」です。');
  console.log('※ Keepa 由来の記録は、実市場データ100件には数えていません。');
  console.log('※ これは「売れているか」だけの判定で、「買ってよいか」の判定ではありません。');
}

main().catch((e) => { console.error(e); process.exit(1); });
