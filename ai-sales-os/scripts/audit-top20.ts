/**
 * 上位20社の営業文を、書いた仕組みとは別の目で監査する（PHASE A4）。
 * そのうえで「最初に営業する5社」を決める（PHASE A5）。
 *
 * ★ここでも外部へは1件も送らない。決めるだけ。
 * ★点数の順位（rank_overall）と、監査を通ったあとの順位（final_rank）を分ける。
 *   点が高くても文面に問題があれば、最初の1件にはしない。
 */
import { all, one, migrate, run, nowIso } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { auditCopy, saveCopyAudit, VERDICT_JA, type AuditVerdict, type CopyAudit } from '../lib/sales/audit-copy';
import { buildDraft, saveDraft, objectionSet, type DraftInput } from '../lib/sales/draft';
import { loadOffers, type OfferRow } from '../lib/catalog/sync';
import { INDUSTRY_LABEL, type IndustryKey } from '../lib/industry';
import { CHANNEL_LABEL, type Channel } from '../lib/sales/channel';
import { learningReadiness, recordPrediction } from '../lib/outcome';
import type { NeedFlags } from '../lib/needs';

const yen = (n: number | null) => (n === null ? '未定' : `${n.toLocaleString('ja-JP')}円`);
const pct = (n: number | null) => (n === null ? '未算出' : `${(n * 100).toFixed(2)}%`);
const ja = (k: string) => INDUSTRY_LABEL[k as IndustryKey] ?? k;

const MAX_REWRITES = 2;

function parseNeeds(v: unknown): NeedFlags {
  try {
    return JSON.parse(String(v ?? '{}')) as NeedFlags;
  } catch {
    return {} as NeedFlags;
  }
}
function parseArr(v: unknown): string[] {
  try {
    const a = JSON.parse(String(v ?? '[]'));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

async function main() {
  await migrate();
  await initSettings();

  const offers = await loadOffers(false);
  const offerBy = new Map<string, OfferRow>(offers.map((o) => [o.code, o]));

  const rows = await all(`
    SELECT o.*, c.name AS cname
      FROM company_opportunities o
      JOIN companies c ON c.id = o.company_id
     WHERE o.selected_top20 = 1
     ORDER BY o.rank_overall`);

  console.log('══════════════════════════════════════════════════════════');
  console.log('PHASE A4 — 上位20社を「書いた仕組みとは別の目」で監査');
  console.log('══════════════════════════════════════════════════════════');
  console.log('監査するのは、保存済みの本文そのもの。誰がどう作ったかは見ない。');
  console.log('会社の記録に照らして、10項目を1つずつ確かめ直す。');
  console.log('');

  const results: { opp: Record<string, unknown>; audit: CopyAudit; first: AuditVerdict; rewritten: boolean; note: string | null }[] = [];

  for (const opp of rows) {
    const companyId = Number(opp.company_id);
    const company = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
    const analysis = await one('SELECT * FROM company_analyses WHERE company_id = ?', [companyId]);
    let draft = await one("SELECT * FROM outreach_drafts WHERE company_id = ? AND status = 'READY' ORDER BY id LIMIT 1", [companyId]);
    if (!company || !draft) continue;

    const primaryOfferCode = opp.primary_offer ? String(opp.primary_offer) : null;
    let audit = await auditCopy({
      company,
      draft,
      offer: offerBy.get(String(draft.offer_code)) ?? null,
      analysis,
      primaryOfferCode,
    });
    const first = audit.verdict;
    let rewritten = false;
    let note: string | null = null;

    // ── 書き直し。直せるものだけ、直して、もう一度同じ監査にかける。
    for (let attempt = 1; attempt <= MAX_REWRITES && audit.verdict === 'REWRITE' && audit.fixable; attempt++) {
      const offerCode = audit.checks.find((k) => k.code === 'OFFER_FIT' && !k.ok) && primaryOfferCode ? primaryOfferCode : String(draft.offer_code);
      const offer = offerBy.get(offerCode);
      if (!offer) break;
      const avoid = audit.avoidFacts;
      const why = audit.checks.filter((k) => !k.ok).map((k) => k.label).join('・');

      const input: DraftInput = {
        company,
        industry: String(analysis?.industry ?? company.industry_guess ?? 'UNKNOWN') as IndustryKey,
        needFlags: parseNeeds(analysis?.need_flags),
        issues: parseArr(analysis?.issues),
        evidence: parseArr(analysis?.evidence),
        offer,
        channel: String(draft.channel) as Channel,
        avoidFacts: avoid,
      };
      const rebuilt = await buildDraft(input);
      if (rebuilt.status !== 'READY') {
        note = `書き直しを試みたが、作り直した文面が既存の関門で止まった（${rebuilt.blockedReason}）。元の文面のまま人が読む。`;
        break;
      }
      await saveDraft(rebuilt);
      draft = await one("SELECT * FROM outreach_drafts WHERE company_id = ? AND status = 'READY' ORDER BY id LIMIT 1", [companyId]);
      if (!draft) break;
      audit = await auditCopy({ company, draft, offer, analysis, primaryOfferCode });
      rewritten = true;
      note = `${attempt}回目の書き直し：${why}を直した${avoid.length > 0 ? `（使わないことにした引用${avoid.length}件）` : ''}。結果=${VERDICT_JA[audit.verdict]}`;
    }

    // 直しても直らなかったものは、機械の判断に留めず人へ回す。
    if (audit.verdict === 'REWRITE') {
      audit = { ...audit, verdict: 'HUMAN_REVIEW' };
      note = note ?? `${MAX_REWRITES}回書き直しても基準に届かなかったので、人が読む扱いにした。`;
    }

    await saveCopyAudit(audit, first, rewritten, note);
    await run('UPDATE company_opportunities SET audit_verdict = ?, audit_note = ? WHERE company_id = ?', [audit.verdict, note, companyId]);
    results.push({ opp, audit, first, rewritten, note });
  }

  // ---------------------------------------------------------------- 監査結果の一覧
  const count = (v: AuditVerdict) => results.filter((r) => r.audit.verdict === v).length;
  console.log(`監査した会社: ${results.length}社`);
  console.log(`  合格（PASS）           : ${count('PASS')}社`);
  console.log(`  書き直した（REWRITE）  : ${results.filter((r) => r.rewritten).length}社`);
  console.log(`  人が読む（HUMAN_REVIEW）: ${count('HUMAN_REVIEW')}社`);
  console.log(`  候補から外す（BLOCK）  : ${count('BLOCK')}社`);
  console.log('');

  console.log('■ 会社ごとの判定');
  for (const r of results) {
    const mark = r.audit.verdict === 'PASS' ? '○' : r.audit.verdict === 'BLOCK' ? '×' : '△';
    console.log(`  ${mark} ${String(r.opp.rank_overall).padStart(2)}位 ${String(r.opp.cname)}  → ${VERDICT_JA[r.audit.verdict]}${r.first !== r.audit.verdict ? `（最初の判定は「${VERDICT_JA[r.first]}」）` : ''}`);
    for (const k of r.audit.checks.filter((x) => !x.ok)) {
      console.log(`       ・${k.label}：${k.detail}`);
    }
    if (r.note) console.log(`       → ${r.note}`);
  }
  console.log('');

  // ---------------------------------------------------------------- 10項目ごとの通過率
  console.log('■ 検査項目ごとの結果（どこで落ちているのかを見るため）');
  const codes: { code: string; label: string }[] = [];
  for (const r of results) for (const k of r.audit.checks) if (!codes.some((x) => x.code === k.code)) codes.push({ code: k.code, label: k.label });
  for (const c of codes) {
    const ng = results.filter((r) => r.audit.checks.some((k) => k.code === c.code && !k.ok));
    console.log(`  ${c.label.padEnd(0)}：${results.length - ng.length}/${results.length}社が合格${ng.length > 0 ? `（落ちた会社：${ng.map((r) => String(r.opp.cname)).join('・')}）` : ''}`);
  }
  console.log('');

  // ---------------------------------------------------------------- PHASE A5 TOP5
  const survivors = results.filter((r) => r.audit.verdict === 'PASS');
  const top5 = survivors.slice(0, 5);

  await run('UPDATE company_opportunities SET final_rank = NULL');
  for (let i = 0; i < top5.length; i++) {
    await run('UPDATE company_opportunities SET final_rank = ? WHERE company_id = ?', [i + 1, Number(top5[i].opp.company_id)]);
  }

  // ---------------------------------------------------------------- PHASE K 予測を凍結する
  //   ★「送る前に、何%で決まると読んだか」をここで書き残す。
  //     あとで計算式を直しても、この行だけは書き換えない。書き換えると
  //     「AIの読みがどれだけ外れていたか」を確かめる材料が消える。
  //   ★実績が20件たまるまでは、必ず「仮置き（ASSUMED）」として残す。
  //     仮の数字を実測のふりで残すと、外れたときに原因が追えなくなる。
  const ready = await learningReadiness();
  let frozen = 0;
  const frozenSkips: string[] = [];
  for (const t of top5) {
    const raw = t.opp.close_probability;
    if (raw === null || raw === undefined) {
      frozenSkips.push(`${String(t.opp.cname)}：成約率を出せていないので、予測を残さない（0で埋めない）`);
      continue;
    }
    const r = await recordPrediction({
      scope: 'SALES',
      refTable: 'companies',
      refId: Number(t.opp.company_id),
      dataOrigin: String(t.opp.data_origin ?? 'REAL_MANUAL'),
      subjectName: String(t.opp.cname),
      closeProbability: Number(raw),
      basis: ready.mayChangeStrategy ? 'MEASURED' : 'ASSUMED',
      formula: String(t.opp.close_probability_basis ?? '（根拠の記録なし）'),
    });
    if (r.recorded) frozen++;
    else frozenSkips.push(`${String(t.opp.cname)}：${r.reason}`);
  }
  console.log('');
  console.log('■ 予測の凍結（PHASE K）');
  console.log(`  新しく書き残した予測：${frozen}件`);
  for (const s of frozenSkips) console.log(`  ・${s}`);
  console.log(`  ${ready.message}`);

  console.log('══════════════════════════════════════════════════════════');
  console.log('PHASE A5 — 最初に営業する5社（まだ1件も送っていない）');
  console.log('══════════════════════════════════════════════════════════');
  if (top5.length < 5) {
    console.log(`※ 監査に合格したのは${survivors.length}社しかないため、${top5.length}社しか出せない。`);
    console.log('  数を揃えるために基準を下げることはしない。');
    console.log('');
  }

  for (let i = 0; i < top5.length; i++) {
    const { opp, audit } = top5[i];
    const companyId = Number(opp.company_id);
    const company = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
    const draft = await one("SELECT * FROM outreach_drafts WHERE company_id = ? AND status = 'READY' ORDER BY id LIMIT 1", [companyId]);
    const script = await one('SELECT * FROM call_scripts WHERE company_id = ?', [companyId]);
    const ana = await one('SELECT industry FROM company_analyses WHERE company_id = ?', [companyId]);
    const industry = String(ana?.industry ?? company?.industry_guess ?? 'UNKNOWN');
    const offer = offerBy.get(String(opp.primary_offer ?? ''));
    const channel = String(opp.channel ?? '') as Channel;

    console.log('');
    console.log('──────────────────────────────────────────────────────────');
    console.log(`【${i + 1}位】${String(opp.cname)}`);
    console.log('──────────────────────────────────────────────────────────');
    console.log(`◇ なぜ1位なのか  : ${opp.score_reason}`);
    console.log(`◇ 何を売るのか   : ${opp.primary_offer_name ?? '未定'}（分類：${opp.primary_offer_group ?? '—'}）`);
    console.log(`◇ どのチャネルか : ${channel ? CHANNEL_LABEL[channel] : '未決定'}`);
    const dest = channel === 'PHONE' ? company?.phone : channel === 'EMAIL' ? company?.email : company?.contact_form_url;
    console.log(`                   宛先：${dest ?? '未取得'}`);
    console.log(`◇ いくらの商品か : ${yen(opp.expected_revenue === null ? null : Number(opp.expected_revenue))}${opp.expected_unavailable_reason ? `（${opp.expected_unavailable_reason}）` : ''}`);
    console.log(`                   予想受注率 ${pct(opp.close_probability === null ? null : Number(opp.close_probability))}（推定・未実測）／予想利益 ${yen(opp.expected_profit === null ? null : Number(opp.expected_profit))}`);
    console.log(`◇ なぜ今この会社 : ${opp.primary_reason}`);
    console.log(`                   業種＝${ja(industry)}／HP＝${company?.website ?? 'なし'}（${company?.website_verdict ?? '不明'}）`);
    console.log(`◇ 監査の結果     : ${VERDICT_JA[audit.verdict]}（10項目すべて合格）`);
    console.log('');
    console.log(channel === 'PHONE' ? '◇ 電話台本' : '◇ 送る文章');
    if (draft?.subject) console.log(`  件名: ${draft.subject}`);
    for (const line of String(draft?.body ?? '').split('\n')) console.log(`  │ ${line}`);
    console.log('');
    console.log('◇ 想定される反論と、その答え');
    const objections = script ? (JSON.parse(String(script.objections)) as { say: string; reply: string }[]) : offer ? objectionSet(offer, channel) : [];
    for (const o of objections) {
      console.log(`  ・「${o.say}」`);
      console.log(`     → ${o.reply}`);
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`※ この時点で外部へ送ったものは0件。判定と順位を決めただけ。（${nowIso()}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
