import fs from 'node:fs';
import path from 'node:path';
import { scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { EXTERNAL_ACTIONS_IMPLEMENTED, config } from '../lib/env';
import { checkExternalAction, externalActionStatus } from '../lib/gate';
import { readinessSummary } from '../lib/readiness';
import { addDeliverable, confirmDeliverable, deliveryReadiness } from '../lib/delivery';
import { insert, nowIso, one, run } from '../lib/db/client';
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
  finish([s, d, a]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
