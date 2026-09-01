import fs from 'node:fs';
import path from 'node:path';
import { scalar } from '../lib/db/client';
import { initSettings, setSetting } from '../lib/settings';
import { EXTERNAL_ACTIONS_IMPLEMENTED, config, type ExternalAction } from '../lib/env';
import { checkExternalAction, externalActionStatus } from '../lib/gate';
import { readinessSummary } from '../lib/readiness';
import { addDeliverable, confirmDeliverable, deliveryReadiness } from '../lib/delivery';
import { all, insert, nowIso, one, run } from '../lib/db/client';
import { DATA_ORIGINS, canReachExecutor, toOrigin } from '../lib/origin';
import { executorFor, executorInventory, preflight, type ExecutionPlan } from '../lib/executors';
import { canOutreach } from '../lib/sales/guards';
import { identityKpi } from '../lib/sales/enrich';
import { buildDedupeKey } from '../lib/sales/ingest';
import { canAutoOutreachByIdentity, WEBSITE_VERDICTS, verifyWebsiteIdentity } from '../lib/sales/identity';
import { checkDailyLimit, cooldownDays, dailyLimits, REAPPROACH_DAYS } from '../lib/sales/limits';
import { sameOrganization } from '../lib/text';
import { buildOfficialIndex, matchCorporateNumber } from '../lib/sales/corporate-number';
import type { OfficialCompanyRow } from '../lib/sales/official-data';
import { calibration, learningReadiness, recordActual, recordPrediction } from '../lib/outcome';
import {
  decideApproval,
  enqueueApproval,
  excludeKind,
  isKindExcluded,
  listApprovals,
  listPendingApprovals,
  reviseText,
  EMPTY_DETAIL,
  type ApprovalDetail,
} from '../lib/approval';
import {
  copyVersion,
  dailyLimitOf,
  evaluateLiveReadiness,
  idempotencyKey,
  killSwitchState,
  newExecutionId,
  type LiveContext,
} from '../lib/sales/execution';
import type { OfferRow } from '../lib/catalog/sync';
import { draftChannels } from '../lib/sales/channel';
import { formAutoAllowed, formHumanSendAllowed } from '../lib/sales/form-policy';
import { learningState, NOTE_MAX, OBSERVE_ONLY_UNTIL, recordManualSend, scrubNote } from '../lib/sales/manual-send';
import { Suite, finish } from './_harness';

/**
 * 安全のテスト。
 *
 * ここが落ちたら、他が全部合格でも出荷してはいけない。
 * 「送っていないこと」「送る仕組みが存在しないこと」を機械で確かめる。
 */

/** リポジトリ内のコードを全部読む（node_modules と .next は除く）。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'data', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  await initSettings();
  const s = new Suite('安全（外部への操作）');

  // 1. スイッチが全部OFFで始まること
  for (const a of externalActionStatus()) {
    s.check(`初期値がOFF: ${a.label}`, a.flagOn === false, a.flagOn ? '.env でONにされている' : 'OFF');
    s.check(`実行する処理コードが無い: ${a.label}`, a.implemented === false, `implemented=${a.implemented}`);
  }

  // 2. スイッチをONにしても通らないこと（型で allowed: false が固定されている）
  const gate = checkExternalAction('EMAIL');
  s.check('スイッチの状態に関わらず関門を通さない', gate.allowed === false, `allowed=${gate.allowed}`);
  s.check('外部操作の実装フラグがfalse', EXTERNAL_ACTIONS_IMPLEMENTED === false, String(EXTERNAL_ACTIONS_IMPLEMENTED));

  // 3. 実際に送った・応募した記録が1件も無いこと
  s.eq('実際に送信した営業の件数', await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1'), 0, '件');
  s.eq('実際に応募した件数', await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1'), 0, '件');

  // 4. 送信を実行しそうなコードが存在しないこと
  const files = sourceFiles(process.cwd());
  const senders = files.filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    // 実際に外へ出す手段のライブラリ・API。テストのこのファイル自身は除く。
    return /require\(['"]nodemailer|from ['"]nodemailer|twilio|puppeteer|playwright|sendgrid/i.test(t) && !f.endsWith('test-safety.ts');
  });
  s.eq('メール送信・自動操作のライブラリを使っているファイル数', senders.length, 0, '個');
  if (senders.length > 0) console.log(`         ${senders.join(', ')}`);

  // 5. CAPTCHA を回避する処理が無いこと
  const captcha = files.filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    return /(2captcha|anticaptcha|capsolver|captcha.?(solver|bypass))/i.test(t) && !f.endsWith('test-safety.ts');
  });
  s.eq('CAPTCHAを回避する処理を含むファイル数', captcha.length, 0, '個');

  // 6. 秘密情報がコードに直接書かれていないこと
  const hardcoded = files.filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    return /(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-)/.test(t);
  });
  s.eq('APIキーらしき文字列が直接書かれたファイル数', hardcoded.length, 0, '個');

  // 7. .env がコミット対象から外れていること
  const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
  s.check('.env が .gitignore に入っている', /^\.env/m.test(gitignore), gitignore.includes('.env') ? 'ある' : '.gitignore に .env が無い');
  s.check('data/（DB本体）が .gitignore に入っている', /^\/?data\//m.test(gitignore), gitignore.includes('data/') ? 'ある' : '無い');

  // 8. 段階解放が Phase 1 から始まること
  s.check('リリース段階が1（一番慎重な段階）', config.releasePhase === 1, `RELEASE_PHASE=${config.releasePhase}`);

  // 9. 「あと何が要るか」の表が、嘘をつかないこと
  //    ★ここが「もうできている」と言い切ってしまうと、人は用意が済んだと思って先へ進む。
  //      実際には送る処理が無いので何も起きず、原因を探す時間だけが失われる。
  const ready = await readinessSummary();
  s.eq('外部操作のうち「あと何が要るか」を出している数', ready.actions.length, 5, '種類');
  s.check(
    'どの外部操作にも「実行する処理そのものが無い」が必ず載っている',
    ready.actions.every((a) => a.items.some((i) => i.label === '実行する処理そのもの' && i.state === 'BLOCKED')),
    ready.actions
      .filter((a) => !a.items.some((i) => i.label === '実行する処理そのもの' && i.state === 'BLOCKED'))
      .map((a) => a.label)
      .join('・') || '全部載っている',
  );
  s.check(
    '足りない項目には必ず「何をすればよいか」が書いてある',
    ready.actions.every((a) => a.items.filter((i) => i.state !== 'DONE').every((i) => Boolean(i.how))),
    '',
  );
  s.check(
    '「そろっている」と言い切っている外部操作が1つも無い',
    ready.actions.every((a) => a.summary !== 'そろっている'),
    ready.actions
      .filter((a) => a.summary === 'そろっている')
      .map((a) => a.label)
      .join('・') || '無い',
  );
  s.check('次にやることが1つに絞って書かれている', ready.nextStep.length > 10, ready.nextStep.slice(0, 40));

  s.print();

  // ---- 納品の関門
  const d = new Suite('安全（納品の関門）');
  const orderId = Number(
    (await insert('orders', {
      job_id: null,
      title: '安全テスト用の受注（実在しません）',
      amount: 10000,
      cost: 0,
      status: 'IN_PROGRESS',
      started_at: nowIso(),
      created_at: nowIso(),
    })) ?? 0,
  );

  const good = await addDeliverable({
    orderId,
    taskName: '商品説明文',
    content: '商品説明文のたたき台です。\n素材と寸法、使う場面を順に書いています。\n価格は通常価格のみを載せ、効果を断定する言い方は使っていません。\n読んだ人が判断できるよう、事実だけを並べています。\n最後に問い合わせ先を置いています。',
    jobDescription: '商品説明文を作成してください。素材と寸法を明記。',
  });
  d.check('作ったものは自動で「納品してよい」にならない', (await deliveryReadiness(orderId)).ready === false, '人間の確認前は ready=false であること');
  const beforeConfirm = await deliveryReadiness(orderId);
  d.check('人間未確認の成果物があると理由が出る', beforeConfirm.reasonJa.includes('確認'), beforeConfirm.reasonJa);

  await confirmDeliverable(good.id);
  const after = await deliveryReadiness(orderId);
  d.check('人間が確認しても、納品そのものは実行されない', after.ready === false, after.reasonJa);
  d.check('その理由が「納品する処理が無い」であること', after.reasonJa.includes('作っていません') || after.reasonJa.includes('存在') || after.reasonJa.includes('OFF'), after.reasonJa);

  const bad = await addDeliverable({
    orderId,
    taskName: 'キャッチコピー',
    content: 'このサービスを使えば必ず儲かります。絶対に損はしません。',
    jobDescription: 'キャッチコピーを作成してください。',
  });
  d.check('景表法で問題になる表現は自分の見直しで止まる', bad.passed === false, `passed=${bad.passed}`);
  const cannot = await confirmDeliverable(bad.id);
  d.check('問題が残ったものは人間確認済みにできない', cannot.ok === false, cannot.reasonJa);

  d.print();

  // ------------------------------------------------------------------ 1クリック承認
  const a = new Suite('1クリック承認（人の判断）');

  // 本物のデータを汚さないよう、上で作ったテスト用の受注を対象にする。
  const testRef = { kind: 'DELIVER' as const, refTable: 'orders', refId: orderId };
  const detail: ApprovalDetail = {
    ...EMPTY_DETAIL,
    subtitle: 'テスト用',
    offer: 'テスト用の提案内容',
    whyChosen: ['テストのため'],
    scores: [{ label: '点数', value: '50' }],
    body: 'これはテスト用の文章です。\n人が読んで判断できる長さにしています。',
    risks: ['テスト用のリスク'],
    sources: [{ label: 'テスト', url: 'https://example.com/' }],
    excludeKind: { scope: 'JOB', dimension: '__test__', key: '__test_key__', label: 'テスト用の除外' },
    textRef: { table: 'proposals', id: -1 },
  };
  await enqueueApproval({ ...testRef, title: 'テスト用の承認', summary: 'テスト', riskNote: 'テスト', detail });

  const find = async () => (await listApprovals()).find((x) => x.kind === 'DELIVER' && x.refTable === 'orders' && x.refId === orderId) ?? null;
  const item1 = await find();
  a.check('承認待ちに判断材料が保存される', item1?.detail.offer === 'テスト用の提案内容', item1 ? `offer=${item1.detail.offer}` : '見つからない');
  a.check('根拠URLも一緒に保存される', (item1?.detail.sources.length ?? 0) === 1, `${item1?.detail.sources.length ?? 0}件`);

  // 却下 → やり直しても人の判断は消えない
  await decideApproval(item1!.id, 'REJECTED');
  await enqueueApproval({ ...testRef, title: 'テスト用の承認', summary: 'テスト', riskNote: 'テスト', detail });
  a.check('却下した判断は、処理をやり直しても消えない', (await find())?.status === 'REJECTED', `status=${(await find())?.status}`);

  // 保留 → あとから承認できる
  await run('UPDATE approval_queue SET status = ?, decided_at = NULL WHERE id = ?', ['PENDING', item1!.id]);
  const held = await decideApproval(item1!.id, 'HELD');
  a.check('保留にできる', held.ok === true, held.reasonJa);
  a.check('保留は「判断した日時」を空のままにする', (await find())?.decidedAt === null, `decidedAt=${(await find())?.decidedAt}`);
  const afterHold = await decideApproval(item1!.id, 'APPROVED');
  a.check('保留にしたあとでも承認に進める', afterHold.ok === true, afterHold.reasonJa);
  a.check('承認の結果に「送信は起きない」と書かれている', afterHold.reasonJa.includes('実際の送信は起きない'), afterHold.reasonJa);

  // 文章の直し
  const tooShort = await reviseText({ table: 'proposals', id: -1, body: '短い' });
  a.check('短すぎる修正文は保存しない', tooShort.ok === false, tooShort.reasonJa);
  const ng = await reviseText({ table: 'proposals', id: -1, body: 'このサービスを使えば必ず儲かります。絶対に損はしません。' });
  a.check('使えない表現を含む修正文は保存しない', ng.ok === false, ng.reasonJa);
  const okRev = await reviseText({ table: 'proposals', id: -1, body: '人が直した文章です。これを送る文章として扱います。' });
  a.check('直した文章は保存できる', okRev.ok === true, okRev.reasonJa);
  a.check('直した文章が承認画面に出る', (await find())?.revisedBody === '人が直した文章です。これを送る文章として扱います。', String((await find())?.revisedBody));
  await enqueueApproval({ ...testRef, title: 'テスト用の承認', summary: 'テスト', riskNote: 'テスト', detail });
  a.check('直した文章は、処理をやり直しても消えない', (await find())?.revisedBody?.startsWith('人が直した文章') === true, String((await find())?.revisedBody));
  const original = await one('SELECT body FROM proposals WHERE id = -1');
  a.check('AIが作った元の文は書き換えられていない', original === null, original ? '元の行が書き換わっている' : '別の場所に保存されている');

  // 「今後この種類は出さない」
  await excludeKind({ scope: 'JOB', dimension: '__test__', key: '__test_key__', reason: 'テスト' });
  a.check('「今後この種類は出さない」を登録できる', (await isKindExcluded('JOB', '__test__', '__test_key__')) === true, '');
  await run('UPDATE approval_queue SET status = ?, decided_at = NULL WHERE id = ?', ['PENDING', item1!.id]);
  const listed = await listPendingApprovals();
  a.check('出さないと決めた種類は判断待ちに並ばない', listed.items.every((x) => x.id !== item1!.id), `hidden=${listed.hidden}件`);
  a.check('隠した件数と理由が分かる', listed.hidden >= 1 && listed.hiddenLabels.length >= 1, listed.hiddenLabels.join('／'));
  await excludeKind({ scope: 'JOB', dimension: '__test__', key: '__test_key__', reason: 'テスト' });
  a.check('出さないと決めた判断は、やり直しても消えない', (await isKindExcluded('JOB', '__test__', '__test_key__')) === true, '');

  // 承認しても外部へは何も起きない
  await decideApproval(item1!.id, 'APPROVED');
  a.eq('承認したあとに実際に送信した件数', await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1'), 0, '件');
  a.eq('承認したあとに実際に応募した件数', await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1'), 0, '件');

  // テスト用に作ったものを片付ける（本番の判断を残さない）
  await run('DELETE FROM approval_queue WHERE kind = ? AND ref_table = ? AND ref_id = ?', [testRef.kind, testRef.refTable, orderId]);
  await run("DELETE FROM excluded_kinds WHERE dimension = '__test__'");
  await run("DELETE FROM text_revisions WHERE ref_table = 'proposals' AND ref_id = -1");

  // 本物の承認待ちに、判断に必要なものがそろっているか
  const real = (await listPendingApprovals()).items;
  const missing = real.filter((x) => !x.detail.subtitle || x.detail.whyChosen.length === 0 || x.detail.risks.length === 0 || !x.detail.body);
  a.eq('判断材料が足りない承認待ちの件数', missing.length, 0, '件');
  a.check(
    '承認待ちの各件に根拠URLが付いている',
    real.length === 0 || real.every((x) => x.detail.sources.length > 0),
    real.length === 0 ? '承認待ちが0件' : `${real.filter((x) => x.detail.sources.length === 0).length}件にURLが無い`,
  );

  a.print();

  // ================================================================
  // 事故を起こす10通りの型。ここは1つでも落ちたら出荷しない。
  //
  // ★この10個は「起きたら取り返しがつかない事故」を1つずつ機械で塞いだもの。
  //   数字を良く見せるためにここの条件をゆるめることは絶対にしない。
  // ================================================================
  const x = new Suite('事故を起こす10通りの型（必須）');

  // 検査用の会社を2社だけ作る。最後に必ず消す。
  const TEST_MARK = '__safety10__';
  await run('DELETE FROM companies WHERE name LIKE ?', [`%${TEST_MARK}%`]);
  const mkCompany = async (over: Record<string, unknown>): Promise<number> =>
    Number(
      (await insert('companies', {
        name: `${TEST_MARK}検査用`,
        dedupe_key: `${TEST_MARK}${Math.random().toString(36).slice(2)}`,
        source: 'TEST',
        data_origin: 'TEST',
        no_sales_flag: 0,
        phone: '03-1234-5678',
        phone_valid: 1,
        fetched_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
        ...over,
      })) ?? 0,
    );

  // ---- ① 練習用のデータが、本物の数字に混ざらない
  const testCompanyId = await mkCompany({ name: `${TEST_MARK}練習用の会社` });
  const kpiReal = await identityKpi('REAL');
  const kpiTest = await identityKpi('TEST');
  const realIds = await all(`SELECT id FROM companies WHERE data_origin <> 'TEST' AND name LIKE ?`, [`%${TEST_MARK}%`]);
  x.eq('練習用に作った会社が「本物」として数えられていない', realIds.length, 0, '社');
  x.check(
    '本物の集計と練習用の集計が別々に出る',
    kpiReal.scope === 'REAL' && kpiTest.scope === 'TEST',
    `REAL=${kpiReal.companies}社 / TEST=${kpiTest.companies}社（足し算はしない）`,
  );
  x.check(
    '本物の会社数と練習用の会社数が、合計値で混ざっていない',
    kpiReal.companies + kpiTest.companies === Number(await scalar('SELECT COUNT(*) FROM companies')),
    `REAL${kpiReal.companies} + TEST${kpiTest.companies} = 全体${await scalar('SELECT COUNT(*) FROM companies')}`,
  );

  // ---- ② 練習用のデータは、人が承認しても実行へ進めない
  const testPlan: ExecutionPlan = {
    action: 'EMAIL',
    dataOrigin: 'TEST',
    refTable: 'companies',
    refId: testCompanyId,
    subjectName: '練習用の会社',
    corporateNumber: null,
    channelTarget: 'info@example-real.co.jp',
    offerCode: null,
    offerName: null,
    body: 'これは検査用の文章です。三十文字以上の長さがあり、文章が無いという理由では止まりません。',
    evidence: ['検査用の根拠'],
    score: null,
  };
  const testPre = preflight(testPlan);
  x.check(
    '練習用のデータは実行の手前で必ず止まる',
    testPre.blockReasons.some((r) => r.includes('練習用')),
    testPre.blockReasons.join(' / '),
  );
  x.check('練習用だと判定する処理そのものが動いている', canReachExecutor('TEST').ok === false, canReachExecutor('TEST').reason);
  const testGuard = await canOutreach(testCompanyId, 'EMAIL');
  x.check('練習用の会社は営業の関門を通らない', testGuard.blockedBy.includes('DATA_ORIGIN'), testGuard.blockedBy.join(','));

  // ---- ③ すでに閉じた法人には営業しない
  const closedId = await mkCompany({ name: `${TEST_MARK}閉鎖した会社`, closed_at: '2024-03-31T00:00:00.000Z' });
  const closedGuard = await canOutreach(closedId, 'PHONE');
  x.check('閉鎖・解散した法人は営業の関門を通らない', closedGuard.blockedBy.includes('CLOSED'), closedGuard.blockedBy.join(','));
  x.check('止めた理由に閉鎖の日付が書いてある', closedGuard.reasonJa.includes('2024-03-31'), closedGuard.reasonJa);

  // ---- ④ 同じ法人番号の会社が2件並ばない
  x.eq(
    '同じ法人番号の会社が2件以上ある',
    await scalar('SELECT COUNT(*) FROM (SELECT corporate_number FROM companies WHERE corporate_number IS NOT NULL GROUP BY corporate_number HAVING COUNT(*) > 1)'),
    0,
    '組',
  );
  x.check(
    '書き方が違っても、法人番号が同じなら同じ会社として1件にまとまる',
    buildDedupeKey('株式会社テスト商事', '大阪市中央区本町1-1-1', '1111111111111') ===
      buildDedupeKey('テスト商事（株）', '大阪府大阪市中央区本町一丁目1番1号', '1111111111111'),
    '法人番号が一致するので同じ鍵',
  );

  // ---- ⑤ 同じ名前でも、法人番号が違えば別の会社として扱う
  x.check(
    '会社名が同じでも法人番号が違えば別の会社として扱う',
    buildDedupeKey('株式会社山田工業', '東京都新宿区1-1-1', '1111111111111') !==
      buildDedupeKey('株式会社山田工業', '大阪府大阪市北区2-2-2', '2222222222222'),
    '別の鍵になる',
  );
  const sameNameOtherCorp = verifyWebsiteIdentity(
    { name: '株式会社山田工業', corporateNumber: '1111111111111', address: '東京都新宿区1-1-1' },
    {
      url: 'https://yamada-kogyo-osaka.co.jp/',
      title: '株式会社山田工業',
      text: '株式会社山田工業 大阪府大阪市北区2-2-2 法人番号 2222222222222 金属加工を行っています。',
    },
  );
  x.check('同じ社名でも法人番号が違うHPは本人のものにしない', sameNameOtherCorp.verdict === 'MISMATCH', sameNameOtherCorp.reason);

  // ---- ⑤-2 国のデータとの照合が「分からないものを決めてしまわない」こと
  //
  // ★ここが崩れると、別の会社へ営業をかける事故になる。
  //   同名が2件あるのに1件選ぶ／番号が食い違うのに素通しする／未照合を照合済みに見せる、
  //   この3つを機械で止める。
  const officialRow = (corporateNumber: string, name: string, city: string, street: string): OfficialCompanyRow => ({
    corporateNumber,
    name,
    kind: '301',
    kindLabel: '株式会社',
    prefecture: '大阪府',
    city,
    street,
    address: `大阪府${city}${street}`,
    postalCode: null,
    closedAt: null,
    latest: true,
    updatedOn: null,
    assignedOn: null,
  });

  // 同じ町に同じ商号が2件ある状態を作る。
  const twinIndex = buildOfficialIndex([
    officialRow('1000000000001', '株式会社みなと工業', '大阪市港区', '波除1丁目1番1号'),
    officialRow('1000000000002', '株式会社みなと工業', '大阪市港区', '波除2丁目2番2号'),
  ]);
  const ambiguous = matchCorporateNumber(
    { name: '株式会社みなと工業', address: '大阪府大阪市港区波除', city: '大阪市港区', prefecture: '大阪府', corporateNumber: null },
    twinIndex,
  );
  x.check('同名が複数あるとき、法人番号を1つに決めてしまわない', ambiguous.corporateNumber === null, `決めた番号=${ambiguous.corporateNumber ?? 'なし'}`);
  x.check('同名が複数あるときは「絞れない」と記録する', ambiguous.status === 'AMBIGUOUS', `status=${ambiguous.status}／${ambiguous.reasonJa}`);
  x.check('絞れなかった理由が日本語で残る', ambiguous.reasonJa.length > 0, ambiguous.reasonJa);

  // すでに入っている番号が、国のデータでは別の商号だった場合。
  const conflictIndex = buildOfficialIndex([officialRow('1000000000003', '株式会社ほくめい', '大阪市西区', '京町堀1丁目1番1号')]);
  const conflict = matchCorporateNumber(
    { name: '株式会社みらい建設', address: '大阪府大阪市西区京町堀1-1-1', city: '大阪市西区', prefecture: '大阪府', corporateNumber: '1000000000003' },
    conflictIndex,
  );
  x.check('番号の持ち主が別の商号なら「別会社の疑い」にする', conflict.status === 'CONFLICT', `status=${conflict.status}／${conflict.reasonJa}`);
  x.check('別会社の疑いはその場で営業を止める（BLOCK）', conflict.block === true, `block=${conflict.block}`);

  // 国のデータに1件も無いとき。勝手に近い会社を当てない。
  const notFound = matchCorporateNumber(
    { name: '株式会社そんざいしない商会', address: '大阪府大阪市中央区本町1-1-1', city: '大阪市中央区', prefecture: '大阪府', corporateNumber: null },
    conflictIndex,
  );
  x.check('国のデータに無い会社に、似た番号を当てはめない', notFound.corporateNumber === null && notFound.status === 'NOT_FOUND', `status=${notFound.status}`);
  x.check('国のデータに無いだけでは営業を止めない（不明のまま残す）', notFound.block === false, `block=${notFound.block}`);

  // 照合していない会社が、画面で「照合済み」になっていないこと。
  x.eq(
    '法人番号が空なのに「照合済み」になっている会社',
    await scalar("SELECT COUNT(*) FROM companies WHERE corporate_number_status = 'VERIFIED' AND corporate_number IS NULL"),
    0,
    '社',
  );
  x.eq(
    '別会社の疑い（CONFLICT）なのに営業対象のまま残っている会社',
    await scalar("SELECT COUNT(*) FROM companies WHERE corporate_number_status = 'CONFLICT' AND sales_excluded = 0"),
    0,
    '社',
  );
  x.eq(
    '別会社の疑い（CONFLICT）なのに営業候補の順位が付いたままの会社',
    await scalar(
      `SELECT COUNT(*) FROM company_opportunities o JOIN companies c ON c.id = o.company_id
        WHERE c.corporate_number_status = 'CONFLICT' AND o.final_rank IS NOT NULL`,
    ),
    0,
    '社',
  );

  // ---- ⑥ 会社とHPが食い違ったら、そのHPも連絡先も残さない
  x.eq(
    'HPが食い違った会社に、HP・メール・フォームが残っている',
    await scalar(
      "SELECT COUNT(*) FROM companies WHERE website_verdict = 'CONFLICT' AND (website IS NOT NULL OR email IS NOT NULL OR contact_form_url IS NOT NULL)",
    ),
    0,
    '社',
  );
  x.eq(
    '「HPが無い」と判定したのにHP欄にURLが残っている',
    await scalar("SELECT COUNT(*) FROM companies WHERE website_verdict = 'NO_WEBSITE' AND website IS NOT NULL"),
    0,
    '社',
  );
  x.eq('本物のデータで、別会社のHP・電話・メールが営業候補に混ざった件数', kpiReal.wrongLinkLeaked, 0, '件');

  // ---- ⑦ 別会社のメールアドレスを、その会社のものとして使わない
  x.check('別ドメインのメールは同じ会社と認めない', sameOrganization('https://a-kogyo.co.jp/', 'https://b-shoji.co.jp') === false, '別ドメイン');
  const badEmail = await all(
    `SELECT id, name, website, email, email_source FROM companies
      WHERE email IS NOT NULL AND website IS NOT NULL AND email_valid = 1`,
  );
  const emailMismatch = badEmail.filter((r) => !sameOrganization(String(r.website), `https://${String(r.email).split('@')[1] ?? ''}`));
  // ★機械が自分で拾ってきたメールは、HPと同じドメインでなければ使わない。
  //   一方、人が自分の名簿から入れたメール（email_source = MANUAL）は、
  //   プロバイダのアドレス（zaq・so-net など）であることが普通にある。
  //   これを機械が勝手に消すと、本人が持っていた本物の連絡先が失われる。
  //   だから「機械が拾ったものは一致必須」「人が入れたものは出どころを必ず残す」で分ける。
  const machineMismatch = emailMismatch.filter((r) => String(r.email_source ?? '') !== 'MANUAL');
  x.eq('機械が拾ったメールで、HPとドメインが違うものを持っている', machineMismatch.length, 0, '社');
  if (machineMismatch.length > 0) console.log(`         ${machineMismatch.slice(0, 5).map((r) => `${r.name}: ${r.email} / ${r.website}`).join(' | ')}`);
  x.check(
    'HPとドメインが違うメールは、すべて人が入れたものだと記録されている',
    emailMismatch.every((r) => String(r.email_source ?? '') === 'MANUAL'),
    `${emailMismatch.length}社（うち人が入れたもの ${emailMismatch.filter((r) => String(r.email_source ?? '') === 'MANUAL').length}社）`,
  );

  // ---- ⑧ 別会社の問い合わせフォームを、その会社のものとして使わない
  const badForm = await all('SELECT id, name, website, contact_form_url FROM companies WHERE contact_form_url IS NOT NULL AND website IS NOT NULL');
  const formMismatch = badForm.filter((r) => !sameOrganization(String(r.website), String(r.contact_form_url)));
  x.eq('HPと別のドメインのフォームを、その会社の窓口として持っている', formMismatch.length, 0, '社');
  if (formMismatch.length > 0) console.log(`         ${formMismatch.slice(0, 5).map((r) => `${r.name}: ${r.contact_form_url}`).join(' | ')}`);
  // ★フォームは「あるから送る」ではない。フォーム自身が営業の受付を書いているときだけ。
  x.eq(
    'フォームの受付方針が「営業を受け付ける」でないのにフォーム営業に回っている',
    await scalar(
      `SELECT COUNT(*) FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id
        WHERE ch.channel = 'FORM' AND COALESCE(c.form_policy, '') <> 'ALLOWED'`,
    ),
    0,
    '社',
  );
  // ★HPが別会社と食い違った会社・HPが無い会社のフォームは、別会社の窓口の可能性がある。
  x.eq(
    'HPが食い違った会社・HPが無い会社がフォーム営業に回っている',
    await scalar(
      `SELECT COUNT(*) FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id
        WHERE ch.channel = 'FORM' AND c.website_verdict IN ('CONFLICT', 'NO_WEBSITE')`,
    ),
    0,
    '社',
  );

  // ---- ⑨ まだ売り物にできない商品で営業しない
  const notSellableDrafts = await all(
    `SELECT d.id, c.name, d.offer_code, o.status FROM outreach_drafts d
       JOIN companies c ON c.id = d.company_id
       JOIN offers o ON o.code = d.offer_code
      WHERE d.status IN ('READY','NEEDS_APPROVAL') AND o.status <> 'SELLABLE'`,
  );
  x.eq('まだ売れない商品なのに営業文が用意されている', notSellableDrafts.length, 0, '件');
  if (notSellableDrafts.length > 0) console.log(`         ${notSellableDrafts.slice(0, 5).map((r) => `${r.name}: ${r.offer_code}(${r.status})`).join(' | ')}`);
  x.eq(
    '売り物にしないと決めた商品が、会社への提案の1位になっている',
    await scalar(
      `SELECT COUNT(*) FROM company_offers co JOIN offers o ON o.code = co.offer_code
        WHERE co.rank = 1 AND co.sellable = 1 AND o.status <> 'SELLABLE'`,
    ),
    0,
    '件',
  );

  // ---- ⑩ 実行できるのは「何もしない版」だけ
  const inventory = executorInventory();
  x.eq('外部への操作の差し込み口の数', inventory.length, 5, '種類');
  x.check('すべて「何もしない版（DRY_RUN）」である', inventory.every((i) => i.kind === 'DRY_RUN'), inventory.map((i) => `${i.label}=${i.kind}`).join(' / '));
  x.check('実際に送る版が1つも存在しない', inventory.every((i) => i.liveExists === false), inventory.filter((i) => i.liveExists).map((i) => i.label).join('・') || '1つも無い');
  for (const action of ['CALL', 'EMAIL', 'FORM', 'APPLY', 'DELIVER'] as ExternalAction[]) {
    const r = await executorFor(action).execute({ ...testPlan, action, dataOrigin: 'REAL_MANUAL' });
    x.check(
      `本物のデータでも実際には送られない（${action}）`,
      r.executed === false && r.blockReasons.length > 0,
      `executed=${r.executed} / 止めた理由=${r.blockReasons.join('、')}`,
    );
  }
  x.eq('実行した記録として保存された件数', await scalar('SELECT COUNT(*) FROM dry_runs WHERE executed = 1'), 0, '件');

  // ★承認画面は、1件ずつ「本物か練習用か」を言えること。
  //   言えないまま並べると、人は練習用のカードを本物だと思って承認を押す。
  const approvalItems = await listApprovals();
  x.check(
    '承認待ちの1件ずつに「本物か練習用か」が付いている',
    approvalItems.every((a) => (DATA_ORIGINS as readonly string[]).includes(a.dataOrigin)),
    `${approvalItems.length}件を確認`,
  );
  const wrongOrigin: string[] = [];
  for (const a of approvalItems) {
    if (a.refTable !== 'companies' && a.refTable !== 'jobs') continue;
    const src = await one(`SELECT data_origin FROM ${a.refTable} WHERE id = ?`, [a.refId]);
    if (src && toOrigin(src.data_origin) !== a.dataOrigin) wrongOrigin.push(a.title);
  }
  x.eq('元データと違う「本物・練習用」を画面に出している承認待ち', wrongOrigin.length, 0, '件');

  // 検査用に作った会社を消す（本物のデータに残さない）
  await run('DELETE FROM companies WHERE name LIKE ?', [`%${TEST_MARK}%`]);
  x.eq('検査用に作った会社を残していない', await scalar('SELECT COUNT(*) FROM companies WHERE name LIKE ?', [`%${TEST_MARK}%`]), 0, '社');

  x.print();

  // ================================================================
  // 実行記録と、本番実行の14条件（PHASE B・PHASE C）
  // ================================================================
  const e = new Suite('実行の記録と、本番実行の14条件');

  // ---- ① 二重送信の鍵：同じ中身なら何度作っても同じ鍵
  const base = { companyId: 1234, channel: 'EMAIL', destination: 'info@example.co.jp', body: 'はじめまして。○○と申します。' };
  e.eq('同じ内容なら鍵が変わらない', idempotencyKey(base), idempotencyKey({ ...base }));

  // ★時刻を挟んでも変わらないこと。時刻が混ざると毎回別の鍵になり、二重送信が止まらなくなる。
  const k1 = idempotencyKey(base);
  await new Promise((r) => setTimeout(r, 5));
  e.eq('時間が経っても鍵が変わらない', idempotencyKey(base), k1);

  // ★文面を1文字変えたら別の鍵になること。ここが変わらないと「直した文面が送れない」。
  e.check(
    '本文を1文字直すと別の鍵になる',
    idempotencyKey({ ...base, body: `${base.body}。` }) !== k1,
    '1文字違いで別の鍵になった',
  );
  e.check('送り先が変われば別の鍵になる', idempotencyKey({ ...base, destination: 'other@example.co.jp' }) !== k1, '別の鍵');
  e.check('連絡手段が変われば別の鍵になる', idempotencyKey({ ...base, channel: 'FORM' }) !== k1, '別の鍵');
  e.check('相手が変われば別の鍵になる', idempotencyKey({ ...base, companyId: 1235 }) !== k1, '別の鍵');

  // ---- ② 文面の版
  e.eq('同じ本文なら版も同じ', copyVersion('こんにちは'), copyVersion('こんにちは'));
  e.check('本文が違えば版も違う', copyVersion('こんにちは') !== copyVersion('こんにちわ'), '別の版');
  e.check('前後の空白だけの違いは同じ版とみなす', copyVersion('  こんにちは\n') === copyVersion('こんにちは'), '同じ版');

  // ---- ③ 実行番号は1件ごとに違う
  const ids = new Set(Array.from({ length: 50 }, () => newExecutionId('CALL', 7)));
  e.eq('実行番号が50回すべて別のものになる', ids.size, 50, '種類');
  e.check('実行番号に日付と手段と相手が入っている', /^EX-\d{8}-CALL-000007-[0-9a-f]{6}$/.test([...ids][0]), [...ids][0]);

  // ---- ④ 14条件：13個満たしても、実行する処理コードが無ければ通らない
  const okOffer: OfferRow = {
    code: 'TEST_OFFER', name: '検査用の商品', category: 'TEST', status: 'SELLABLE', status_reason: null,
    price_model: 'onetime', price_min: null, price_max: null, gross_margin_rate: null, summary: '検査用',
    price_status: 'UNKNOWN', price_evidence: null, tier: null, scaleFit: [],
    fitIndustries: [], fitNeeds: [],
  };
  const okCtx: LiveContext = {
    company: { data_origin: 'REAL_MANUAL', website_verdict: 'VERIFIED', no_sales_flag: 0, phone: '06-0000-0000' },
    draft: { id: 1, body: 'こんにちは', channel: 'PHONE' },
    offer: okOffer,
    action: 'CALL',
    destination: '06-0000-0000',
    auditVerdict: 'PASS',
    approvedBy: '運用者',
    duplicateExists: false,
    todayCount: 0,
    dailyLimit: 10,
    channelTodayCount: 0,
    channelLimit: 5,
    killSwitch: 'ARMED',
    mode: 'LIVE',
  };
  const okRes = evaluateLiveReadiness(okCtx);
  e.eq('条件の数', okRes.conditions.length, 14, '個');
  e.eq('条件の名前が重複していない', new Set(okRes.conditions.map((k) => k.code)).size, 14, '個');
  // ★ここが「合格」になってはいけない。実際に送るコードが無いのだから、絶対に ALLOW にならない。
  e.eq('他の13条件をすべて満たしても本番実行は通らない', okRes.verdict, 'BLOCK');
  e.eq('欠けている条件は「本番実行の仕組みがある」の1つだけ', okRes.missing.length, 1, '個');
  e.eq('欠けている条件の中身', okRes.conditions.find((k) => !k.ok)?.code, 'EXECUTION_MODE_LIVE');

  // ---- ⑤ 1条件でも欠ければ BLOCK（13通りを1つずつ壊して確かめる）
  //    ★「13個通ったから9割OK」という数え方をしていないことを、機械で確かめる。
  const breakers: { code: string; ctx: LiveContext }[] = [
    { code: 'DATA_ORIGIN_NOT_TEST', ctx: { ...okCtx, company: { ...okCtx.company, data_origin: 'TEST' } } },
    { code: 'IDENTITY_VERIFIED', ctx: { ...okCtx, company: { ...okCtx.company, website_verdict: 'PROBABLE' } } },
    { code: 'COMPANY_NOT_BLOCKED', ctx: { ...okCtx, company: { ...okCtx.company, no_sales_flag: 1 } } },
    { code: 'CONTACT_VERIFIED', ctx: { ...okCtx, destination: '06-9999-9999' } },
    { code: 'OFFER_SELLABLE_NOW', ctx: { ...okCtx, offer: { ...okOffer, status: 'DEV' } } },
    { code: 'COPY_AUDIT_PASS', ctx: { ...okCtx, auditVerdict: 'HUMAN_REVIEW' } },
    { code: 'POLICY_PASS_OR_APPROVED', ctx: { ...okCtx, action: 'FORM', destination: 'https://example.co.jp/contact', company: { ...okCtx.company, website: 'https://example.co.jp/', contact_form_url: 'https://example.co.jp/contact', form_policy: '' } } },
    { code: 'HUMAN_APPROVAL_EXISTS', ctx: { ...okCtx, approvedBy: null } },
    { code: 'NO_DUPLICATE_OUTREACH', ctx: { ...okCtx, duplicateExists: true } },
    { code: 'DAILY_LIMIT_NOT_EXCEEDED', ctx: { ...okCtx, dailyLimit: null } },
    { code: 'DAILY_LIMIT_CHANNEL_NOT_EXCEEDED', ctx: { ...okCtx, channelLimit: null } },
    { code: 'IDENTITY_CONTACT_MISMATCH_RISK', ctx: { ...okCtx, company: { ...okCtx.company, website_verdict: 'UNVERIFIED' } } },
    { code: 'KILL_SWITCH_NOT_OFF', ctx: { ...okCtx, killSwitch: 'OFF' } },
  ];
  for (const b of breakers) {
    const r = evaluateLiveReadiness(b.ctx);
    const failed = r.conditions.filter((k) => !k.ok).map((k) => k.code);
    e.check(
      `「${r.conditions.find((k) => k.code === b.code)?.label}」が欠けたら止まる`,
      r.verdict === 'BLOCK' && failed.includes(b.code),
      `判定=${r.verdict} / 欠けた条件=${failed.join('、')}`,
    );
  }

  // ★承認が無いのに「自動承認」と書いて埋めていないこと（空文字は承認ではない）
  e.check(
    '空欄の承認者を「承認済み」と数えない',
    evaluateLiveReadiness({ ...okCtx, approvedBy: '   ' }).conditions.find((k) => k.code === 'HUMAN_APPROVAL_EXISTS')?.ok === false,
    '空欄は未承認として扱われた',
  );
  // ★上限が未設定のとき「無制限」と読み替えていないこと
  e.check(
    '上限が未設定のときを「無制限」と読み替えない',
    evaluateLiveReadiness({ ...okCtx, dailyLimit: null }).conditions.find((k) => k.code === 'DAILY_LIMIT_NOT_EXCEEDED')?.ok === false,
    '未設定は「超えていないと言えない」として止まった',
  );
  // ★上限ちょうどまで来たら、もう1件は通さない
  e.check(
    '今日の件数が上限ちょうどなら、もう1件は通さない',
    evaluateLiveReadiness({ ...okCtx, todayCount: 10, dailyLimit: 10 }).conditions.find((k) => k.code === 'DAILY_LIMIT_NOT_EXCEEDED')?.ok === false,
    '上限ちょうどで止まった',
  );
  // ★スイッチは1文字でも違えば止まったまま
  e.check(
    '全停止スイッチが空欄なら止まったまま',
    evaluateLiveReadiness({ ...okCtx, killSwitch: 'OFF' }).verdict === 'BLOCK',
    'OFF のまま止まった',
  );
  // ★DRY_RUN は本番ではない
  e.eq('下見（DRY_RUN）は本番実行として通らない', evaluateLiveReadiness({ ...okCtx, mode: 'DRY_RUN' }).verdict, 'BLOCK');

  // ---- ⑥ 設定の既定値が「止まっている側」であること
  e.eq('全停止スイッチの既定値', await killSwitchState(), 'OFF');
  e.eq('1日の上限の既定値（未設定）', await dailyLimitOf(), null);

  // ---- ⑥-2 手段ごとの上限（PHASE 3）
  //      ★既定は全部「未設定」。初期値を勝手に大きくしない。
  const lim = await dailyLimits();
  e.eq('1日の上限（全体）の既定値', lim.all, null);
  e.eq('1日の上限（電話）の既定値', lim.PHONE, null);
  e.eq('1日の上限（メール）の既定値', lim.EMAIL, null);
  e.eq('1日の上限（フォーム）の既定値', lim.FORM, null);
  for (const ch of ['PHONE', 'EMAIL', 'FORM'] as const) {
    const r = await checkDailyLimit(ch);
    e.check(`上限が未設定のあいだ${ch}は実行できない`, r.ok === false, `理由=${r.code}：${r.detailJa}`);
  }

  // ---- ⑥-3 同じ会社への間隔は「短くできない」こと（PHASE 3）
  //      ★設定でガードを弱められないことを機械で確かめる。
  //        数字を良く見せたいときに約束の側を下げられる作りになっていたら、約束ではない。
  const cdDefault = await cooldownDays();
  e.eq('同じ会社への間隔の既定値', cdDefault.days, REAPPROACH_DAYS, '日');
  await setSetting('exec.cooldown_days', '7');
  const cdShort = await cooldownDays();
  e.eq('90日より短い設定を入れても短くならない', cdShort.days, REAPPROACH_DAYS, '日');
  e.eq('短くしようとしたときの扱い', cdShort.source, 'BUILT_IN');
  await setSetting('exec.cooldown_days', '180');
  const cdLong = await cooldownDays();
  e.eq('90日より長い設定は効く', cdLong.days, 180, '日');
  await setSetting('exec.cooldown_days', '');
  e.eq('設定を空欄に戻すと、もとからの日数に戻る', (await cooldownDays()).days, REAPPROACH_DAYS, '日');

  // ---- ⑥-4 件数の欄に読めない値を入れたら保存しないこと
  const badLimit = await setSetting('exec.daily_limit.call', '10件');
  e.check('「10件」のような書き方は保存しない', badLimit.ok === false, badLimit.reasonJa);
  e.eq('保存しなかったので上限は未設定のまま', (await dailyLimits()).PHONE, null);
  const zeroLimit = await setSetting('exec.daily_limit.call', '0');
  e.check('0は上限として保存しない', zeroLimit.ok === false, zeroLimit.reasonJa);

  // ---- ⑥-5 本人性が取れていない会社は、電話番号が正しくても自動営業候補にしない（PHASE 4）
  for (const v of WEBSITE_VERDICTS) {
    const r = canAutoOutreachByIdentity(v);
    if (v === 'VERIFIED') {
      e.check('本人と確認できた会社だけが通る', r.ok === true, r.reasonJa);
    } else {
      e.check(`本人性が「${v}」の会社は通さない`, r.ok === false, r.reasonJa);
    }
  }
  // ★「電話番号だけ正しい」状態を明示的に確かめる。
  //   番号の正しさは、相手が誰かの証明にならない。
  const phoneOnly = evaluateLiveReadiness({ ...okCtx, company: { ...okCtx.company, website_verdict: 'UNVERIFIED' } });
  e.check(
    '電話番号が正しくても本人性が不明ならBLOCK',
    phoneOnly.verdict === 'BLOCK' &&
      phoneOnly.conditions.find((k) => k.code === 'CONTACT_VERIFIED')?.ok === true &&
      phoneOnly.conditions.find((k) => k.code === 'IDENTITY_CONTACT_MISMATCH_RISK')?.ok === false,
    '送り先の確認は通っているが、本人性の条件で止まった',
  );

  // ---- ⑦ 実行記録の中身：外へ出たものが1件も無いこと
  e.eq('実際に外部へ出した実行記録', await scalar('SELECT COUNT(*) FROM outreach_executions WHERE executed = 1'), 0, '件');
  e.eq('本番（LIVE）の実行記録', await scalar("SELECT COUNT(*) FROM outreach_executions WHERE mode <> 'DRY_RUN'"), 0, '件');
  e.eq('本番実行が通ったと記録されたもの', await scalar("SELECT COUNT(*) FROM outreach_executions WHERE live_verdict = 'ALLOW'"), 0, '件');
  // ★鍵が重複した行が保存されていないこと（同じ相手・同じ文面の記録が2行になっていない）
  e.eq(
    '同じ鍵で2行できてしまった実行記録',
    await scalar('SELECT COUNT(*) FROM (SELECT idempotency_key FROM outreach_executions GROUP BY idempotency_key HAVING COUNT(*) > 1)'),
    0,
    '件',
  );
  // ★承認が無いのに承認者名が入っている記録が無いこと
  e.eq(
    '承認していないのに承認者が入っている実行記録',
    await scalar("SELECT COUNT(*) FROM outreach_executions WHERE approved_by IS NOT NULL AND approved_by <> ''"),
    0,
    '件',
  );

  e.print();

  // ================================================================== PHASE K
  //   予測（AIの読み）と実績（実際に起きたこと）が混ざらないこと。
  //   ここが混ざると「読みがどれだけ外れていたか」を確かめる材料が消える。
  const k = new Suite('予測と実績の分離、そして学習を始めてよい件数');

  const TEST_REF = 999_900_001; // 実在しないID。本物の行に触らないため十分大きい値にする。
  const REAL_REF = 999_900_002;
  await run('DELETE FROM outcome_records WHERE ref_id IN (?, ?)', [TEST_REF, REAL_REF]);

  // ---- ① 予測は1度書いたら二度と書き換わらない
  const p1 = await recordPrediction({
    scope: 'SALES', refTable: 'companies', refId: REAL_REF, dataOrigin: 'REAL_MANUAL',
    subjectName: 'テスト用の会社（実在しません）', closeProbability: 0.12, basis: 'ASSUMED', formula: '最初の読み',
  });
  k.check('予測を1件記録できる', p1.recorded === true, p1.reason);
  const p2 = await recordPrediction({
    scope: 'SALES', refTable: 'companies', refId: REAL_REF, dataOrigin: 'REAL_MANUAL',
    subjectName: 'テスト用の会社（実在しません）', closeProbability: 0.88, basis: 'MEASURED', formula: 'あとから書き換えた読み',
  });
  k.check('同じ相手に2度目の予測を書こうとしても断られる', p2.recorded === false, p2.reason);
  const frozen = await one('SELECT * FROM outcome_records WHERE ref_id = ?', [REAL_REF]);
  k.eq('最初に書いた予測の値が残っている', Number(frozen?.predicted_close_probability), 0.12);
  k.eq('最初に書いた根拠の種類が残っている', String(frozen?.predicted_basis), 'ASSUMED');
  k.eq('最初に書いた計算の説明が残っている', String(frozen?.predicted_formula), '最初の読み');

  // ---- ② 範囲外の数字は記録しない（0や1超で埋めない）
  await run('DELETE FROM outcome_records WHERE ref_id = ?', [TEST_REF]);
  const bad1 = await recordPrediction({
    scope: 'SALES', refTable: 'companies', refId: TEST_REF, dataOrigin: 'TEST',
    subjectName: '範囲外', closeProbability: 1.4, basis: 'ASSUMED', formula: '—',
  });
  k.check('1を超える成約確率は記録しない', bad1.recorded === false, bad1.reason);
  const bad2 = await recordPrediction({
    scope: 'SALES', refTable: 'companies', refId: TEST_REF, dataOrigin: 'TEST',
    subjectName: '範囲外', closeProbability: Number.NaN, basis: 'ASSUMED', formula: '—',
  });
  k.check('数字にならない成約確率は記録しない', bad2.recorded === false, bad2.reason);

  // ---- ③ 実績は「予測がある場合だけ」入り、予測の欄を壊さない
  const orphan = await recordActual({ scope: 'SALES', refTable: 'companies', refId: TEST_REF, result: 'WON' });
  k.check('予測が無い相手に実績だけを入れることはできない', orphan.recorded === false, orphan.reason);

  const act1 = await recordActual({ scope: 'SALES', refTable: 'companies', refId: REAL_REF, result: 'LOST', note: 'テスト' });
  k.check('予測がある相手には実績を入れられる', act1.recorded === true, act1.reason);
  const afterActual = await one('SELECT * FROM outcome_records WHERE ref_id = ?', [REAL_REF]);
  k.eq('実績を入れても予測の値は変わらない', Number(afterActual?.predicted_close_probability), 0.12);
  k.eq('実績を入れても予測の根拠は変わらない', String(afterActual?.predicted_formula), '最初の読み');
  k.eq('実績が入っている', String(afterActual?.actual_close_result), 'LOST');
  const act2 = await recordActual({ scope: 'SALES', refTable: 'companies', refId: REAL_REF, result: 'WON' });
  k.check('入った実績も書き換えられない', act2.recorded === false, act2.reason);
  k.eq(
    '書き換えを試みたあとも実績はLOSTのまま',
    String((await one('SELECT actual_close_result FROM outcome_records WHERE ref_id = ?', [REAL_REF]))?.actual_close_result),
    'LOST',
  );

  // ---- ④ 実績を入れる処理のSQLに、予測の列名が1つも出てこないこと
  //      （出てこなければ、書き間違えても予測を壊せない）
  const outcomeSrc = fs.readFileSync(path.join(process.cwd(), 'lib', 'outcome.ts'), 'utf8');
  const updateStatements = outcomeSrc.match(/UPDATE outcome_records[\s\S]*?WHERE[^`]*/g) ?? [];
  k.check('実績を書き込むUPDATE文がちょうど1つだけある', updateStatements.length === 1, `${updateStatements.length}個`);
  k.check(
    '実績のUPDATE文に predicted_ の列が1つも出てこない',
    updateStatements.every((u) => !/predicted_/.test(u)),
    updateStatements.join(' / ').replace(/\s+/g, ' ').slice(0, 160),
  );

  // ---- ⑤ 練習用（TEST）は「学習してよい件数」に1件も入らない
  const before = await learningReadiness();
  const testIds: number[] = [];
  for (let i = 0; i < 25; i++) {
    const rid = 999_910_000 + i;
    testIds.push(rid);
    await run('DELETE FROM outcome_records WHERE ref_id = ?', [rid]);
    await recordPrediction({
      scope: 'SALES', refTable: 'companies', refId: rid, dataOrigin: 'TEST',
      subjectName: `練習用${i}`, closeProbability: 0.3, basis: 'ASSUMED', formula: '練習',
    });
    await recordActual({ scope: 'SALES', refTable: 'companies', refId: rid, result: 'WON' });
  }
  const after25 = await learningReadiness();
  k.eq('練習用を25件足しても、本物の確定件数は増えない', after25.realSettled, before.realSettled, '件');
  k.eq('練習用は練習用として数えられている', after25.testTotal, before.testTotal + 25, '件');
  k.eq('学習に必要な件数は20件のまま', after25.required, 20, '件');
  k.check(
    '練習用25件では「営業のやり方を変えてよい」にならない',
    after25.mayChangeStrategy === false,
    after25.message,
  );
  const calTest = await calibration('SALES');
  k.check(
    '練習用25件では、読みのずれの数字も出さない',
    calTest.available === false,
    calTest.available === false ? calTest.reason : '数字が出てしまっている',
  );

  for (const rid of testIds) await run('DELETE FROM outcome_records WHERE ref_id = ?', [rid]);
  await run('DELETE FROM outcome_records WHERE ref_id IN (?, ?)', [TEST_REF, REAL_REF]);

  // ---- ⑥ 学習表そのものに、練習用が混ざらないこと
  const learnSrc = fs.readFileSync(path.join(process.cwd(), 'lib', 'learning.ts'), 'utf8');
  k.check(
    '法人の学習を作り直すSQLに、本物だけを選ぶ条件が入っている',
    /c\.\$\{REAL_SQL\}/.test(learnSrc),
    'companies を REAL に絞っていること',
  );
  k.check(
    '案件の学習を作り直すSQLに、本物だけを選ぶ条件が入っている',
    /j\.\$\{REAL_SQL\}/.test(learnSrc),
    'jobs を REAL に絞っていること',
  );

  // ---- ⑦ いまの本物の記録が、まだ学習を始めてよい件数に達していないこと
  const now = await learningReadiness();
  k.check(
    '本物の実績が20件たまるまでは、AIが営業のやり方を変えない',
    now.realSettled >= 20 ? now.mayChangeStrategy === true : now.mayChangeStrategy === false,
    now.message,
  );
  k.eq('実際に納品した件数', await scalar('SELECT COUNT(*) FROM deliverables WHERE delivered_at IS NOT NULL'), 0, '件');

  k.print();

  // ================================================================== PHASE SEC
  //   クラウドに置いた画面と、秘密の扱い。
  //
  //   ★ここは「気をつける」では守れない。人は必ず1回書き忘れる。
  //     書き忘れたら落ちるように、機械で確かめる。
  const sec = new Suite('クラウド運用と認証情報の守り');

  const root = process.cwd();
  const readIf = (rel: string): string => {
    const p = path.join(root, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };

  // ---- ① 入口の鍵は、分からないときに「通さない」側へ倒れること
  const mw = readIf('middleware.ts');
  sec.check('入口の鍵の仕組みが存在する', mw.length > 0, 'middleware.ts');
  sec.check(
    'IDとパスワードが未設定なら開けない（設定し忘れで全公開しない）',
    /if \(!user \|\| !pass\)/.test(mw) && /return unauthorized/.test(mw),
    '未設定は401で止める',
  );
  sec.check(
    '照合の途中で失敗しても「通す」側へ倒れない',
    /return unauthorized\('IDとパスワードを入れてください。'\);\s*\}\s*return unauthorized/.test(mw.replace(/\/\/[^\n]*\n/g, '')),
    '最後は必ず401へ落ちる',
  );
  sec.check(
    'パスワードの比較で、違った時点で打ち切らない（1文字ずつ当てられないようにする）',
    /timingSafeEqual/.test(mw),
    '長さが同じなら同じ時間で終わる比較を使う',
  );
  sec.check('鍵そのものがコードに書かれていない', !/SITE_PASSWORD\s*=\s*['"][^'"]+['"]/.test(mw), 'process.env から読むだけ');

  // ---- ② 検索エンジンに載せない指定が3か所とも生きていること
  const cfg = readIf('next.config.js');
  const rb = readIf('app/robots.ts');
  const layout = readIf('app/layout.tsx');
  sec.check('応答ヘッダに「検索に載せるな」が付いている', /X-Robots-Tag/.test(cfg) && /noindex/.test(cfg), 'next.config.js');
  sec.check('robots.txt で全ページを拒否している', /disallow: '\/'/.test(rb), 'app/robots.ts');
  sec.check('ページ側にも「検索に載せるな」を書いている', /robots:\s*\{[^}]*index:\s*false/.test(layout), 'app/layout.tsx');
  sec.check('401で返すときも「検索に載せるな」を付けている', /X-Robots-Tag/.test(mw), 'middleware.ts の401応答');

  // ★入口が「401を返せる」こと自体を確かめる。
  //   HTTPのヘッダーには日本語を入れられない。入れると応答を作る時点で例外が出て、
  //   401ではなく500になり、ブラウザがIDとパスワードの入力欄を出さなくなる。
  //   その状態は「鍵が固い」のではなく「誰も入れない」＝本番が開けない事故なので、必ず見張る。
  const authHeader = mw.match(/'WWW-Authenticate':\s*'([^']*)'/)?.[1] ?? '';
  sec.check('401のヘッダー（WWW-Authenticate）が見つからない', authHeader.length > 0, authHeader || '未検出');
  sec.check(
    '401のヘッダーに日本語が混ざっている（本番でログイン画面が出なくなる）',
    // eslint-disable-next-line no-control-regex
    /^[\x00-\xFF]*$/.test(authHeader),
    authHeader,
  );
  let built = '';
  try {
    new Response('x', { status: 401, headers: { 'WWW-Authenticate': authHeader } });
    built = 'つくれた';
  } catch (e) {
    built = `例外：${e instanceof Error ? e.message : String(e)}`;
  }
  sec.check('401の応答を実際に組み立てられない', built === 'つくれた', built);

  // ---- ③ 秘密がブラウザへ出る書き方をしていないこと
  //         Next.js は NEXT_PUBLIC_ で始まる環境変数だけをブラウザへ埋め込む。
  //         1つも使っていなければ、埋め込みようがない。
  const appAndLib = sourceFiles(path.join(root, 'app')).concat(sourceFiles(path.join(root, 'lib')));
  const publicEnvUsers = appAndLib.filter((f) => /NEXT_PUBLIC_/.test(fs.readFileSync(f, 'utf8')));
  sec.eq('ブラウザへ環境変数を埋め込む書き方を使っているファイル', publicEnvUsers.length, 0, '件');

  // DB接続情報を読む処理が、ブラウザ側の部品（'use client'）に入っていないこと。
  const dbReaders = appAndLib.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return /DATABASE_URL|DATABASE_AUTH_TOKEN/.test(src) && /^\s*['"]use client['"]/m.test(src);
  });
  sec.eq('DBの接続情報を、ブラウザで動く部品が読んでいる', dbReaders.length, 0, '件');

  // ---- ④ 秘密がリポジトリの中に置き去りになっていないこと
  const ignore = readIf('.gitignore');
  sec.check('.env をGit管理から外している', /^\.env$/m.test(ignore), '.gitignore');
  sec.check('ログファイルをGit管理から外している', /\*\.log/.test(ignore), '.gitignore');
  const example = readIf('.env.example');
  sec.check(
    '見本ファイルに本物の値が書かれていない',
    !/^(SITE_PASSWORD|SITE_USER|DATABASE_AUTH_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)=.+$/m.test(example),
    '見本は必ず空欄',
  );

  // コードの中に、鍵らしき文字列が直接書かれていないこと。
  const SECRET_SHAPES: { label: string; re: RegExp }[] = [
    { label: 'OpenAIの鍵', re: /sk-[A-Za-z0-9]{20,}/ },
    { label: 'Googleの鍵', re: /AIza[A-Za-z0-9_-]{20,}/ },
    { label: 'クラウドDBの接続先', re: /libsql:\/\/[a-z0-9-]+\.[a-z]/ },
    { label: '長い署名付きトークン', re: /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/ },
  ];
  const leaks: string[] = [];
  for (const f of sourceFiles(root)) {
    if (f.includes('/scripts/test-safety.ts')) continue; // この検査そのもの
    const src = fs.readFileSync(f, 'utf8');
    for (const shape of SECRET_SHAPES) if (shape.re.test(src)) leaks.push(`${path.relative(root, f)}（${shape.label}）`);
  }
  sec.eq('コードの中に鍵らしき文字列が直接書かれている', leaks.length, 0, '件');
  if (leaks.length > 0) for (const l of leaks.slice(0, 5)) console.log(`      ${l}`);

  // ---- ⑤ お客さまの個人情報を、エラーの記録に出していないこと
  const errorPrinters = appAndLib.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return /console\.(error|log)\([^)]*\b(email|phone|contact_form_url|担当者)\b/.test(src);
  });
  sec.eq('電話番号・メールアドレスをそのまま画面やログへ出している箇所', errorPrinters.length, 0, '件');

  // ---- ⑥ Obsidianへ書き出す前の検査が生きていること
  const sync = readIf('scripts/obsidian-sync.ts');
  sec.check('Obsidianへ書く前に、混入していないか検査している', /function assertSafe/.test(sync), 'assertSafe');
  sec.check('検査に引っかかったら書かずに止まる', /throw new Error\(`\$\{name\} に\$\{f\.label\}/.test(sync), '書き出し中止');
  for (const label of ['メールアドレス', '電話番号', 'APIキーらしき文字列']) {
    sec.check(`Obsidianの検査対象に「${label}」が入っている`, sync.includes(`label: '${label}'`), 'FORBIDDEN');
  }

  sec.print();

  // ================================================================
  // 手で送るフォームの文面（NEEDS_APPROVAL）
  //
  // ★ここで守っているのは1点だけ。
  //   「文面を作ること」と「送ってよいこと」を、絶対に同じ意味にしない。
  //   人が手で送るための文面は増やしてよい。だが機械が送れる文面は1件も増やさない。
  // ================================================================
  const hs = new Suite('手で送るフォームの文面');

  hs.check('自動で送ってよいのは、営業の受付が明記されたフォームだけ',
    formAutoAllowed('ALLOWED') && !formAutoAllowed('APPROVAL_REQUIRED') && !formAutoAllowed('BLOCKED') && !formAutoAllowed(null),
    'ALLOWED以外は自動送信の対象にしない');
  hs.check('人が手で送ってよいのは、営業お断りが書かれていないフォーム',
    formHumanSendAllowed('ALLOWED') && formHumanSendAllowed('APPROVAL_REQUIRED') && formHumanSendAllowed(null) && !formHumanSendAllowed('BLOCKED'),
    'BLOCKEDだけは下書きも作らない');

  const withForm = { id: 1, contact_form_url: 'https://example.co.jp/contact', form_policy: 'APPROVAL_REQUIRED', no_sales_flag: 0 };
  hs.check('電話に決まった会社でも、フォームがあれば文面を用意する',
    draftChannels(withForm as never, 'PHONE').includes('FORM'), draftChannels(withForm as never, 'PHONE').join('+'));
  hs.check('営業お断りのフォームには下書きも作らない',
    !draftChannels({ ...withForm, form_policy: 'BLOCKED' } as never, 'PHONE').includes('FORM'), 'BLOCKED');
  hs.check('営業お断りの会社には下書きも作らない',
    !draftChannels({ ...withForm, no_sales_flag: 1 } as never, 'PHONE').includes('FORM'), 'no_sales_flag=1');
  hs.check('人が判断する相手には、下書きを勝手に足さない',
    draftChannels(withForm as never, 'MANUAL').join('+') === 'MANUAL', draftChannels(withForm as never, 'MANUAL').join('+'));
  hs.check('フォームが無い会社に、フォームの文面を作らない',
    !draftChannels({ id: 2, contact_form_url: null, form_policy: null, no_sales_flag: 0 } as never, 'PHONE').includes('FORM'), '連絡先が無いものは増やさない');

  // ---- 実データ：手で送る文面が、送ってよい条件を勝手に満たしていないこと
  hs.eq(
    '営業の受付が明記されていないのに「使える（自動で送れる）」になっているフォームの文面',
    await scalar(
      `SELECT COUNT(*) FROM outreach_drafts d JOIN companies c ON c.id = d.company_id
        WHERE d.channel = 'FORM' AND d.status = 'READY' AND IFNULL(c.form_policy, '') <> 'ALLOWED'`,
    ),
    0,
    '件',
  );
  hs.eq(
    '営業お断りのフォームなのに文面が作られている会社',
    await scalar(
      `SELECT COUNT(*) FROM outreach_drafts d JOIN companies c ON c.id = d.company_id
        WHERE d.channel = 'FORM' AND (c.form_policy = 'BLOCKED' OR c.no_sales_flag = 1)`,
    ),
    0,
    '社',
  );
  hs.eq(
    '送り先のフォームが分からないのに文面だけある会社',
    await scalar(
      `SELECT COUNT(*) FROM outreach_drafts d JOIN companies c ON c.id = d.company_id
        WHERE d.channel = 'FORM' AND d.status <> 'BLOCKED' AND IFNULL(c.contact_form_url, '') = ''`,
    ),
    0,
    '社',
  );
  hs.eq(
    '手で送る文面が、実際に送った記録になっている件数',
    await scalar("SELECT COUNT(*) FROM outreach_executions WHERE executed = 1"),
    0,
    '件',
  );

  // ---- 手で送る文面は、本番実行の門を通らないこと
  const handCtx: LiveContext = {
    company: { id: 1, name: 'テスト', data_origin: 'HOUJIN_BANGOU', website_verdict: 'VERIFIED', no_sales_flag: 0, contact_form_url: 'https://example.co.jp/contact', form_policy: 'APPROVAL_REQUIRED' } as never,
    draft: { id: 1, status: 'NEEDS_APPROVAL', body: '本文' } as never,
    offer: { code: 'X', name: 'テスト商品', status: 'SELLABLE' } as never as OfferRow,
    action: 'FORM',
    destination: 'https://example.co.jp/contact',
    auditVerdict: 'PASS',
    approvedBy: '本人',
    duplicateExists: false,
    todayCount: 0,
    dailyLimit: 10,
    channelTodayCount: 0,
    channelLimit: 5,
    killSwitch: 'ON',
    mode: 'LIVE',
  };
  const handVerdict = evaluateLiveReadiness(handCtx);
  hs.eq('人が承認しても、判定が付かないフォームは本番実行が通らない', handVerdict.verdict, 'BLOCK');
  hs.check('通らない理由に「規約の判定」が入っている',
    handVerdict.conditions.some((c) => c.code === 'POLICY_PASS_OR_APPROVED' && !c.ok), handVerdict.missing.join('、'));

  hs.print();

  // ---- 人が自分の手で送った記録（manual_sends）
  //      ★ここに記録が入っても「システムが送った」ことにはならない。
  //        その区別が壊れると、外部への送信0件という前提が画面から読めなくなる。
  const ms = new Suite('人が自分の手で送った記録');

  ms.eq('システムが外部へ実行した件数（実行記録）', await scalar('SELECT COUNT(*) FROM outreach_executions WHERE executed = 1'), 0, '件');
  ms.eq('システムが外部へ実行した件数（下書きの記録）', await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1'), 0, '件');
  ms.eq('システムが外部へ実行した件数（下見）', await scalar('SELECT COUNT(*) FROM dry_runs WHERE executed = 1'), 0, '件');

  // 手の記録は、システムの実行記録とは別の表に入っていること
  ms.check(
    '手で送った記録が、システムの実行記録に混ざっている',
    Number(await scalar('SELECT COUNT(*) FROM outreach_executions')) === Number(await scalar('SELECT COUNT(*) FROM outreach_executions WHERE executed = 0')),
    'システム側は常に未実行',
  );
  ms.eq('手で送った記録に、人以外が送ったことになっている行', await scalar("SELECT COUNT(*) FROM manual_sends WHERE sent_by <> 'HUMAN'"), 0, '件');
  ms.eq('手で送った記録に、送信日時が無い行', await scalar("SELECT COUNT(*) FROM manual_sends WHERE IFNULL(sent_at,'') = ''"), 0, '件');
  ms.eq(
    '返信が来たことになっているのに、返信日時が無い行',
    await scalar("SELECT COUNT(*) FROM manual_sends WHERE outcome IN ('REPLIED','POSITIVE','NEGATIVE','MEETING') AND IFNULL(replied_at,'') = ''"),
    0,
    '件',
  );
  ms.eq(
    '練習用の会社に、手で送った記録が残っている',
    await scalar("SELECT COUNT(*) FROM manual_sends m JOIN companies c ON c.id = m.company_id WHERE c.data_origin = 'TEST'"),
    0,
    '件',
  );

  // 練習用のデータには記録を残せないこと（混ざると実績が読めなくなる）
  const testCompany = await one("SELECT id FROM companies WHERE data_origin = 'TEST' LIMIT 1");
  if (testCompany) {
    const refused = await recordManualSend({ companyId: Number(testCompany.id), channel: 'FORM', draftId: null, destination: null, body: '本文', outcome: 'SENT' });
    ms.check('練習用のデータに送信の記録を残せてしまう', refused.ok === false, refused.message);
  } else {
    ms.check('練習用の会社が1社も無い（確認省略）', true, '該当なし');
  }

  // 「送った」より先に返信の記録はできないこと
  const realCompany = await one("SELECT id FROM companies WHERE data_origin <> 'TEST' AND id NOT IN (SELECT company_id FROM manual_sends) LIMIT 1");
  if (realCompany) {
    const early = await recordManualSend({ companyId: Number(realCompany.id), channel: 'FORM', draftId: null, destination: null, body: '本文', outcome: 'POSITIVE' });
    ms.check('送った記録が無いのに、返信の記録を先に残せてしまう', early.ok === false, early.message);
  } else {
    ms.check('記録の無い会社が1社も無い（確認省略）', true, '該当なし');
  }

  // メモから相手の連絡先を落としていること（うっかり返信本文を貼ったときの受け止め）
  const scrubbed = scrubNote('担当の田中さんから返信。tanaka@example.co.jp / 06-1234-5678 https://example.co.jp/reply');
  ms.check('メモにメールアドレスが残る', !/@example\.co\.jp/.test(scrubbed ?? ''), scrubbed ?? '');
  ms.check('メモに電話番号が残る', !/06-1234-5678/.test(scrubbed ?? ''), scrubbed ?? '');
  ms.check('メモにURLが残る', !/https?:\/\//.test(scrubbed ?? ''), scrubbed ?? '');
  const longNote = scrubNote('あ'.repeat(NOTE_MAX + 200));
  ms.check('メモに返信本文を丸ごと貼れてしまう長さになっている', (longNote ?? '').length <= NOTE_MAX, `${(longNote ?? '').length}文字（上限${NOTE_MAX}）`);

  // 1件や2件の結果から学び始めないこと
  const lstate = await learningState();
  ms.check(
    '手で送った件数が少ないのに、学習してよいことになっている',
    lstate.sent >= OBSERVE_ONLY_UNTIL ? lstate.mayLearn === true : lstate.mayLearn === false,
    `${lstate.sent}件 / ${OBSERVE_ONLY_UNTIL}件`,
  );

  // ★相手のフォームへ送信する処理コードが、本当にどこにも無いこと。
  //   「送りません」と書いてあることではなく、送る書き方が1つも無いことで確かめる。
  //
  //   POSTそのものは道具のAPI（地図の検索・AIへの問い合わせ）で使う。POSTの有無では判定できない。
  //   見るのは「相手の会社の住所（フォームURL）へ向けてPOSTしているか」。
  //   相手のフォームURLは contact_form_url / formUrl / destination という名前でしか持っていないので、
  //   その名前を扱うファイルにPOSTが1つでもあれば、それは相手へ送る処理になりうる。
  const srcDirs = ['lib', 'app', 'scripts'];
  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(ent.name)) srcFiles.push(p);
    }
  };
  for (const d0 of srcDirs) if (fs.existsSync(d0)) walk(d0);

  const POST_RE = /method:\s*['"`](POST|PUT|PATCH)['"`]/i;
  const DEST_RE = /(contact_form_url|formUrl|destination)/;
  const posting = srcFiles.filter((file) => POST_RE.test(fs.readFileSync(file, 'utf8')));

  // ① POSTを書いているファイルは、道具のAPIを呼ぶ2か所だけ。増えていたら人が中身を見る。
  const ALLOWED_POST_FILES = ['lib/sales/sources.ts', 'lib/ai/provider.ts'];
  const unexpected = posting.filter((f) => !ALLOWED_POST_FILES.includes(f));
  ms.eq('見覚えのない場所にPOSTが増えている', unexpected.length, 0, `個${unexpected.length > 0 ? `（${unexpected.join('、')}）` : ''}`);

  // ② POSTの宛先が、コードに直接書かれた道具のAPIであること（相手ごとに変わる宛先ではない）
  for (const f0 of posting) {
    const src = fs.readFileSync(f0, 'utf8');
    ms.check(`${f0}：POSTの宛先が相手ごとに変わる作りになっている`, /fetch\(\s*['"`]https:\/\//.test(src) || /fetch\(\s*`https:\/\/[a-z.]+/.test(src), '宛先がコードに直接書いてある');
  }

  // ③ 相手のフォームURLを扱うファイルに、送信の処理が1つも無いこと
  const destFiles = srcFiles.filter((file) => DEST_RE.test(fs.readFileSync(file, 'utf8')));
  const destPosting = destFiles.filter((file) => POST_RE.test(fs.readFileSync(file, 'utf8')));
  ms.eq('相手のフォームURLを扱う場所に、送信の処理が書かれている', destPosting.length, 0, '個');
  ms.check('相手のフォームURLを扱うファイルが見つからない（探せていない）', destFiles.length >= 5, `${destFiles.length}個を確認`);
  ms.check('確かめたファイルが少なすぎる（探せていない）', srcFiles.length > 50, `${srcFiles.length}個を確認`);

  ms.print();
  finish([s, d, a, x, e, k, sec, hs, ms]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
