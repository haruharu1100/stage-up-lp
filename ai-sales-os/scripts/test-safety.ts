import fs from 'node:fs';
import path from 'node:path';
import { scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { EXTERNAL_ACTIONS_IMPLEMENTED, config } from '../lib/env';
import { checkExternalAction, externalActionStatus } from '../lib/gate';
import { addDeliverable, confirmDeliverable, deliveryReadiness } from '../lib/delivery';
import { insert, nowIso } from '../lib/db/client';
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
  finish([s, d]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
