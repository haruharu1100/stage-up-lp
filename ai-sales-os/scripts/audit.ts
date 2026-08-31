import { all, migrate, one, parseJson } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { CONTACT_SOURCE_JA, type ContactSource } from '../lib/sales/ingest';
import { ORIGIN_JA, REAL_SQL, TEST_SQL, toOrigin } from '../lib/origin';
import { WEBSITE_VERDICT_JA } from '../lib/sales/identity';
import { INDUSTRY_LABEL, type IndustryKey } from '../lib/industry';

/**
 * 目視監査。
 *
 * ★何のためか。
 *   テストが全部通っても、それは「決めたことが守られている」だけで、
 *   「決めたことが正しい」の証明にはならない。
 *   実際に送る直前の状態を人が読んで、違う会社・違う番号・失礼な文章が
 *   混ざっていないことを、自分の目で確かめるために出す。
 *
 * ★出すのは本物のデータだけ。練習用は混ぜない。
 *
 * 使い方: npm run audit [-- --n 10] [--test]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const NA = (v: unknown, why: string): string => {
  const s = String(v ?? '').trim();
  return s === '' || s === 'null' ? `—（${why}）` : s;
};

function srcJa(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '出どころの記録なし';
  return CONTACT_SOURCE_JA[s as ContactSource] ?? s;
}

async function main() {
  await migrate();
  await initSettings();

  const useTest = process.argv.includes('--test');
  const n = Number(arg('n') ?? 10);
  const where = useTest ? TEST_SQL : REAL_SQL;

  // ★「実際にいちばん先に連絡することになる会社」から見る。
  //   つまり、そのまま出せる文面ができている会社が先。次に点数の高い順。
  //   点数だけで並べると、連絡先が無くて一生送れない会社ばかりを読むことになり、
  //   本当に送られる文章を1件も確かめないまま「監査した」ことになってしまう。
  const rows = await all(
    `SELECT c.*, s.expected_value AS s_ev
       FROM companies c
       LEFT JOIN company_scores s ON s.company_id = c.id
       LEFT JOIN outreach_drafts d ON d.company_id = c.id
      WHERE ${where.replace('data_origin', 'c.data_origin')}
      ORDER BY CASE WHEN d.status = 'READY' THEN 0 ELSE 1 END,
               COALESCE(s.expected_value, -1) DESC,
               c.id
      LIMIT ?`,
    [n],
  );

  console.log(`■ 目視監査：${useTest ? '練習用のデータ（TEST）' : '本物のデータ（REAL）'} 上位${rows.length}社`);
  console.log('  ★1社ずつ「この会社に、この内容で、この番号へ連絡してよいか」を人が読んで確かめます。');
  console.log('');

  for (const [i, c] of rows.entries()) {
    const id = Number(c.id);
    const analysis = await one('SELECT * FROM company_analyses WHERE company_id = ?', [id]);
    const offer = await one('SELECT * FROM company_offers WHERE company_id = ? ORDER BY rank ASC LIMIT 1', [id]);
    const decision = await one('SELECT * FROM channel_decisions WHERE company_id = ?', [id]);
    const draft = await one('SELECT * FROM outreach_drafts WHERE company_id = ?', [id]);

    console.log(`── ${i + 1}社目 ────────────────────────────────`);
    console.log(`【会社】${String(c.name)}`);
    console.log(`  法人番号: ${NA(c.corporate_number, '登記の番号が取れていない')}`);
    console.log(`  住所: ${NA(c.address, '住所が取れていない')}`);
    console.log(`  代表: ${NA(c.representative, '代表者名が取れていない')} / 設立: ${NA(c.established_on, '設立日が取れていない')}`);
    console.log(`  規模: ${NA(c.employees_estimate, '人数が分からない')}名（推定）`);
    console.log(`  出どころ: ${ORIGIN_JA[toOrigin(c.data_origin)]} / 取得元: ${NA(c.source, '不明')}`);
    console.log(`  閉鎖の記録: ${c.closed_at ? `★あり（${String(c.closed_at).slice(0, 10)}）営業しない` : 'なし'}`);
    console.log(`  営業お断りの表記: ${Number(c.no_sales_flag) === 1 ? `★あり（${NA(c.no_sales_evidence, '根拠なし')}）` : 'なし'}`);

    console.log(`【HP】判定: ${WEBSITE_VERDICT_JA[String(c.website_verdict) as keyof typeof WEBSITE_VERDICT_JA] ?? String(c.website_verdict)}`);
    console.log(`  採用したURL: ${NA(c.website, 'HPを本人のものと確認できていない')}`);
    console.log(`  確認できていない候補: ${NA(c.website_candidate, 'なし')}`);
    console.log(`  照合の理由: ${NA(c.website_verify_reason, '記録なし')}`);
    if (c.website_reject_reason) console.log(`  外した理由: ${String(c.website_reject_reason)}`);

    console.log('【連絡先】');
    console.log(`  電話: ${NA(c.phone, '取れていない')}${Number(c.phone_valid) === 1 ? '' : '（使わない印）'} … ${srcJa(c.phone_source)}`);
    console.log(`  メール: ${NA(c.email, '取れていない')}${Number(c.email_valid) === 1 ? '' : '（使わない印）'} … ${srcJa(c.email_source)}`);
    console.log(`  フォーム: ${NA(c.contact_form_url, '取れていない')} … ${srcJa(c.form_source)}`);
    console.log(`  フォームの受付方針: ${NA(c.form_policy, 'まだ読んでいない')}（${NA(c.form_policy_reason, '理由なし')}）`);

    console.log('【業種・事業内容】');
    // ★業種は company_analyses.industry にコードで入っている。
    //   ここで存在しない欄を読むと、値が入っていても毎回「読み取れていない」と表示され、
    //   目視監査のいちばん大事な「業種が合っているか」を人が確かめられなくなる。
    const ind = analysis?.industry ? String(analysis.industry) : '';
    console.log(`  業種の推定: ${ind ? `${INDUSTRY_LABEL[ind as IndustryKey] ?? ind}（${ind}）` : '—（読み取れていない）'}`);
    console.log(`  事業内容: ${NA(c.business_detail, 'HPの本文を取れていない')}`);
    console.log(`  その文章の出どころ: ${srcJa(c.business_detail_source)}`);
    console.log(`  一言紹介: ${NA(c.description, '取れていない')} … ${srcJa(c.description_source)}`);
    if (String(c.business_detail_source ?? '') !== 'OFFICIAL_WEBSITE' && c.business_detail) {
      console.log('  ★HP本文ではないので、営業文にそのまま引用しません。');
    }
    console.log(`  読み取りの確からしさ: ${NA(analysis?.confidence, '記録なし')}`);

    console.log('【売るもの】');
    console.log(`  1位の提案: ${NA(offer?.offer_code, 'まだ決まっていない')}`);
    console.log(`  売ってよい状態か: ${offer ? (Number(offer.sellable) === 1 ? 'はい' : `いいえ（${NA(offer.blocked_reason, '理由なし')}）`) : '—（提案がない）'}`);
    console.log(`  選んだ理由: ${NA(offer?.reason, '記録なし')}`);
    console.log(`  期待値: ${c.s_ev === null || c.s_ev === undefined ? '—（まだ出せない）' : `${Math.round(Number(c.s_ev)).toLocaleString()}円`}`);

    console.log('【営業のしかた】');
    console.log(`  連絡手段: ${NA(decision?.channel, 'まだ決まっていない')} … ${NA(decision?.reason, '理由なし')}`);
    console.log(`  文面の状態: ${NA(draft?.status, 'まだ作っていない')}${draft && String(draft.status) !== 'READY' ? `（${NA(draft.blocked_reason, '理由なし')}）` : ''}`);
    const facts = parseJson<string[]>(draft?.personalization, []);
    console.log(`  その会社だけの根拠: ${facts.length === 0 ? '★0件（当たり障りのない文になっている恐れ）' : facts.map((f) => `「${f}」`).join(' / ')}`);
    const ng = parseJson<string[]>(draft?.expression_ng, []);
    if (ng.length > 0) console.log(`  ★表現で引っかかった: ${ng.join(' / ')}`);

    if (draft?.body) {
      console.log('【実際に送る文章】');
      for (const line of String(draft.body).split('\n')) console.log(`    ${line}`);
    }
    console.log('');
  }

  console.log('■ 人が確かめること（1社ずつ）');
  console.log('  1. 会社名と法人番号と住所が、同じ1社のものか');
  console.log('  2. HPのURLが、本当にその会社のHPか（企業名鑑・求人サイトではないか）');
  console.log('  3. 電話・メール・フォームが、その会社のものか（別会社の番号が混ざっていないか）');
  console.log('  4. 業種の推定が合っているか');
  console.log('  5. 売ろうとしているものが、その会社に本当に要るものか');
  console.log('  6. 営業文に、その会社だけの根拠が入っているか（誰にでも出せる文になっていないか）');
  console.log('  7. 文章に、事実でないこと・失礼なこと・断定しすぎた表現が無いか');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
