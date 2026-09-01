/**
 * 「いちばん最初に、手で1件送る会社」を決めて、1画面ぶんの内容を出す。
 *
 *   npx tsx scripts/first-send.ts            … 順位・監査・1件目の内容を出す（外へは何もしない）
 *   npx tsx scripts/first-send.ts --verify   … 1件目の会社のHPを実際に開いて、引用の出典URLと
 *                                              フォームの注意書きを確かめ、記録に残す（読むだけ・送らない）
 *
 * ★--verify がすることは「公開されているページを読む」ことだけ。
 *   フォームへの送信は行わない。送信する処理コードがこのシステムに無い。
 */
import { migrate, one, run, nowIso } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { pickFirstSend, pagesRead, quoteSources, type PresendAudit, type RankedCandidate } from '../lib/sales/first-send';
import { getManualSend, learningState, OUTCOME_JA, type Outcome } from '../lib/sales/manual-send';
import { fetchPublicPage } from '../lib/sales/website';
import { INDUSTRY_LABEL, type IndustryKey } from '../lib/industry';

const flat = (s: string) => s.replace(/\s/g, '');

/** フォームのページに、営業を断る記載があるか。★見つかったら送らない。 */
const NO_SALES_RE = /(営業[^。]{0,12}(お断り|ご遠慮|禁止)|セールス[^。]{0,8}(お断り|ご遠慮|禁止)|勧誘[^。]{0,8}(お断り|ご遠慮|禁止)|営業目的[^。]{0,20}(お控え|ご遠慮|お断り)|売り込み[^。]{0,10}(お断り|ご遠慮))/g;

async function verify(c: RankedCandidate): Promise<void> {
  console.log('■ 実際にHPを開いて確かめる（読むだけ。送信はしない）');
  const company = await one('SELECT site_read_note, internal_note FROM companies WHERE id = ?', [c.companyId]);
  const pages = pagesRead(company?.site_read_note ? String(company.site_read_note) : null);
  if (pages.length === 0) {
    console.log('  読んだページの記録が無いため、出典URLを確かめられない。');
    return;
  }

  const found: { quote: string; url: string }[] = [];
  const texts = new Map<string, string>();
  for (const u of pages) {
    const r = await fetchPublicPage(u);
    if (!r.ok) {
      console.log(`  × ${u} … 読めなかった（${r.status}）`);
      continue;
    }
    texts.set(u, flat(String(r.text ?? '')));
    console.log(`  ○ ${u} … 読めた（題名「${r.title ?? '—'}」）`);
  }

  for (const q of c.quotes) {
    let hit: string | null = null;
    for (const [u, t] of texts) {
      if (t.includes(flat(q))) {
        hit = u;
        break;
      }
    }
    if (hit) {
      found.push({ quote: q, url: hit });
      console.log(`  ○ 引用「${q.slice(0, 30)}…」は ${hit} に、そのままの形で載っている。`);
    } else {
      console.log(`  × 引用「${q.slice(0, 30)}…」は、読んだページのどこにも見つからなかった。送る前に人が確かめること。`);
    }
  }

  // フォームのページの注意書き
  let formNote: string | null = null;
  if (c.formUrl) {
    const r = await fetchPublicPage(c.formUrl);
    if (!r.ok) {
      formNote = `フォームのページを開けなかった（${r.status}）。人がブラウザで開いて確かめること。`;
      console.log(`  × フォーム ${c.formUrl} … 開けなかった（${r.status}）`);
    } else {
      const t = String(r.text ?? '');
      const ng = t.match(NO_SALES_RE);
      if (ng) {
        formNote = `★フォームのページに営業を断る記載がある（${[...new Set(ng)].join('／')}）。送らないこと。`;
        console.log(`  × フォーム ${c.formUrl} … 営業お断りの記載が見つかった：${[...new Set(ng)].join('／')}`);
      } else {
        const required = [...t.matchAll(/必須\s*([^\n必須任意]{1,20})/g)].map((m) => m[1].trim()).filter((s) => s.length > 0);
        formNote = `フォームのページ（題名「${r.title ?? '—'}」）に営業を断る記載は見つからなかった。${required.length > 0 ? `必須の入力欄：${[...new Set(required)].join('・')}。` : ''}`;
        console.log(`  ○ フォーム ${c.formUrl} … 営業お断りの記載は見つからなかった（題名「${r.title ?? '—'}」）`);
        if (required.length > 0) console.log(`     必須の入力欄：${[...new Set(required)].join('・')}`);
      }
    }
  }

  const note = JSON.stringify({ quoteSources: { quotes: found, checkedAt: nowIso(), formNote } });
  await run('UPDATE companies SET internal_note = ?, updated_at = ? WHERE id = ?', [note, nowIso(), c.companyId]);
  console.log('  → 確かめた結果を記録に残した。');
  console.log('');
  console.log('  ※ フォームの営業可否（form_policy）は APPROVAL_REQUIRED のまま変えていない。');
  console.log('     機械が読めなかったものを機械が「よし」と決めない。決めるのは、画面を開いた本人。');
  console.log('');
}

function printAudit(a: PresendAudit): void {
  console.log(`◇ 第二の目による監査 : ${a.verdictJa}`);
  for (const k of a.checks.filter((x) => x.group === '文面')) {
    console.log(`   ${k.ok ? '○' : '×'} ${k.label}`);
    console.log(`      ${k.detail}`);
  }
  const human = a.checks.filter((x) => x.group === '送信前に人がやること');
  if (human.length > 0) {
    console.log('');
    console.log('◇ 機械では終わらせられない確認（人がやる）');
    for (const k of human) console.log(`   ・${k.label}：${k.detail}`);
  }
}

async function main() {
  await migrate();
  await initSettings();

  const doVerify = process.argv.includes('--verify');

  const pick = await pickFirstSend({ channel: 'FORM', realOnly: true });

  console.log('══════════════════════════════════════════════════════════');
  console.log('最初に手で1件送る会社を決める');
  console.log('══════════════════════════════════════════════════════════');
  console.log('★このシステムはフォームへ送信しない。送信する処理コードが入っていない。');
  console.log('　決めるのは「どこに、何を書いて送るか」まで。送信ボタンを押すのは人。');
  console.log('');

  console.log('■ 順位（手で送れる文面がある会社）');
  for (const c of pick.ranking) {
    const mark = c.disqualified ? '×' : ' ';
    console.log(
      `  ${mark}${String(c.rank).padStart(2)}位 ${c.total.toFixed(1).padStart(5)}点  ${c.companyName}（${INDUSTRY_LABEL[c.industry as IndustryKey] ?? c.industry}）` +
        `${c.unknownCount > 0 ? ` ※測れなかった観点${c.unknownCount}件` : ''}`,
    );
    for (const r of c.disqualifyReasons) console.log(`         → ${r}`);
  }
  console.log('');
  console.log('  ※ 点数は「安全か」と「提案の理由が本物か」で付けている。売上の見込みでは付けていない。');
  console.log('     売上の見込みは、まだ1件も成約していないので実測ではなく仮の数字でしかない。');
  console.log('');

  if (pick.skipped.length > 0) {
    console.log('■ 監査で1件目にしなかった会社');
    for (const s of pick.skipped) {
      console.log(`  ${s.candidate.rank}位 ${s.candidate.companyName} → ${s.audit.verdictJa}`);
      for (const k of s.audit.checks.filter((x) => !x.ok && x.group === '文面')) console.log(`     ・${k.label}：${k.detail}`);
    }
    console.log('');
  }

  if (!pick.chosen) {
    console.log('■ 1件目に送れる会社は見つからなかった。');
    console.log('  数を揃えるために基準を下げることはしない。');
    return;
  }

  const c = pick.chosen.candidate;
  if (doVerify) await verify(c);

  const company = await one('SELECT * FROM companies WHERE id = ?', [c.companyId]);
  const opp = await one('SELECT primary_reason, score_reason FROM company_opportunities WHERE company_id = ?', [c.companyId]);
  const sources = quoteSources(c.quotes, company?.site_read_note ? String(company.site_read_note) : null, company?.internal_note ? String(company.internal_note) : null);

  console.log('──────────────────────────────────────────────────────────');
  console.log('【1件目】この1社に、この文章を、自分の手で送る');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`◇ 会社名        : ${c.companyName}`);
  console.log(`◇ 公式HP        : ${c.website ?? '—'}`);
  console.log(`◇ フォームURL   : ${c.formUrl ?? '—'}`);
  console.log(`◇ 提案商品      : ${c.offerName ?? c.offerCode}`);
  console.log(`◇ 提案理由      : ${opp?.primary_reason ?? '—'}`);
  console.log('');
  console.log('◇ 引用した公式サイトの文章と、その出典');
  for (const s of sources) {
    console.log(`   「${s.quote}」`);
    if (s.verifiedUrl) console.log(`     出典：${s.verifiedUrl}（${s.verifiedAt} に実際に開いて、同じ文が載っていることを確認）`);
    else console.log(`     出典：読んだページのどれか（${s.candidates.join(' / ') || '記録なし'}）。--verify で1本に絞れる。`);
  }
  console.log('');
  console.log(`◇ フォーム営業可否 : ${company?.form_policy ?? '未確認'}`);
  console.log(`                     ${company?.form_policy_reason ?? '—'}`);
  console.log('');
  printAudit(pick.chosen.audit);
  console.log('');
  console.log('◇ 送る文章（全文）');
  for (const line of c.body.split('\n')) console.log(`  │ ${line}`);
  console.log('');
  console.log('◇ 送信のしかた（システムは送らない）');
  console.log('   1. 上のフォームURLをブラウザで開く');
  console.log('   2. 営業お断りの注意書きが無いことを、自分の目で確かめる（あれば送らない）');
  console.log('   3. 必須項目を自分の情報で埋める');
  console.log('   4. 上の文章をそのまま貼り付ける');
  console.log('   5. 自分で送信ボタンを押す');
  console.log('   6. 画面に戻って「送った」を押す');
  console.log('');

  const sent = await getManualSend(c.companyId, 'FORM');
  console.log('◇ 送ったあとに押す記録');
  const outcomes: Outcome[] = ['SENT', 'REPLIED', 'POSITIVE', 'NEGATIVE', 'MEETING', 'NO_RESPONSE'];
  for (const o of outcomes) console.log(`   ・${OUTCOME_JA[o]}（${o}）`);
  console.log(`   今の記録：${sent ? `${OUTCOME_JA[String(sent.outcome) as Outcome]}（送った日時 ${sent.sent_at}${sent.replied_at ? ` ／ 返信 ${sent.replied_at}` : ''}）` : 'まだ何も記録されていない'}`);
  console.log('   ※ 返信の本文は保存しない（相手の担当者名・連絡先が混ざるため）。結果の分類と日時だけ残す。');
  console.log('');

  const ls = await learningState();
  console.log(`◇ 学習の状態 : ${ls.message}`);
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`※ この時点でシステムが外部へ送ったものは0件。（${nowIso()}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
