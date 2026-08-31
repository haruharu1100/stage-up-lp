import crypto from 'node:crypto';
import { one, nowIso, run, type Row } from '../db/client';
import { loadSettings } from '../settings';
import { EXTERNAL_ACTIONS_IMPLEMENTED, EXTERNAL_ACTION_LABEL, type ExternalAction } from '../env';
import { isReal, toOrigin } from '../origin';
import { isOwnSiteUrl } from '../text';
import { dailyLimits, todayExecuted } from './limits';
import type { OfferRow } from '../catalog/sync';

/**
 * 「1件の営業を実行した」という記録と、
 * 「本当に外へ出してよいか」を決める14個の条件（PHASE B・PHASE C・PHASE 3-4）。
 *
 * ★このファイルにも送信処理は無い。
 *   ここで作るのは記録と判定だけ。実際に電話・メール・フォーム送信を行うコードは
 *   このリポジトリのどこにも存在しない（executors.ts / gate.ts を参照）。
 *
 * ★なぜ「実行記録」を、まだ送っていない今のうちに作るのか。
 *   送り始めてから記録を足すと、記録が無い1件目・2件目が必ず出る。
 *   そこで事故が起きても、何を誰にいつ送ったのか後から追えない。
 *   だから記録の形を先に決めて、DRY RUN の時点から同じ形で残す。
 *   実行版を作るときに変えるのは mode の値だけで済むようにしておく。
 */

// ── 実行1件を指す番号 ────────────────────────────────────────────

/**
 * 実行1件ごとの番号。人が口頭で読み上げられる形にする。
 * 例: EX-20260830-CALL-000123-a1b2c3
 */
export function newExecutionId(action: ExternalAction, refId: number): string {
  const d = nowIso().slice(0, 10).replace(/-/g, '');
  const rnd = crypto.randomBytes(3).toString('hex');
  return `EX-${d}-${action}-${String(refId).padStart(6, '0')}-${rnd}`;
}

/**
 * 二重送信を止めるための鍵（idempotency key）。
 *
 * ★何を同じ1件とみなすかを決めるのが、この鍵の設計そのもの。
 *   ここを間違えると、同じ会社に同じ文面を2回送るか、
 *   逆に「文面を直したのに送れない」のどちらかが起きる。
 *
 * ★入れるもの（4つ）
 *   ① 相手（company_id）           … 誰に
 *   ② 連絡手段（channel）          … どこへ
 *   ③ 送り先の実体（電話番号・メール・URL）… 番号が変わったら別の相手
 *   ④ 文面の中身そのもの（本文のハッシュ＝copy_version）… 文面が変われば別の連絡
 *
 * ★入れないもの（意図的に外す）
 *   ・時刻            … 入れると毎回違う鍵になり、二重送信が止まらない
 *   ・商品コード      … 同じ相手へ商品だけ変えて送り直すのは「別の営業」ではなく追撃。
 *                       これは日次上限と重複チェックで止める話で、鍵で許してはいけない
 *   ・実行者          … 誰が押しても、同じ相手に同じ文面が2通行ってはいけない
 *
 * ★結果として
 *   同じ相手・同じ手段・同じ宛先・同じ文面 なら、何度実行しても記録は1行のまま。
 *   文面を直したら別の鍵になるので、直したものは送れる。
 */
export function idempotencyKey(input: {
  companyId: number;
  channel: string;
  destination: string | null;
  body: string;
}): string {
  const material = [
    String(input.companyId),
    input.channel,
    (input.destination ?? '').trim().toLowerCase(),
    copyVersion(input.body),
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** 文面の版。本文が1文字でも変われば別の版になる。 */
export function copyVersion(body: string): string {
  return crypto.createHash('sha256').update(body.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12);
}

// ── PHASE C: 本番実行を許すための14条件 ──────────────────────────

export type LiveCondition = {
  code: string;
  /** 人がそのまま読める条件名。 */
  label: string;
  ok: boolean;
  /** なぜ満たしている／満たしていないのか。 */
  detail: string;
};

export type LiveReadiness = {
  /** ★14個すべてが ok のときだけ 'ALLOW'。1つでも欠ければ 'BLOCK'。 */
  verdict: 'ALLOW' | 'BLOCK';
  conditions: LiveCondition[];
  missing: string[];
};

export type LiveContext = {
  company: Row;
  draft: Row | null;
  offer: OfferRow | null;
  action: ExternalAction;
  destination: string | null;
  /** copy_audits の判定。PASS でなければ通さない。 */
  auditVerdict: string | null;
  /** 人が承認した記録。無ければ null。 */
  approvedBy: string | null;
  /** 同じ鍵で既に実行した記録があるか。 */
  duplicateExists: boolean;
  /** 今日すでに実行した件数（全体）。 */
  todayCount: number;
  /** 1日の上限（全体。未設定なら null）。 */
  dailyLimit: number | null;
  /** 今日すでに実行した件数（この手段だけ）。 */
  channelTodayCount: number;
  /** 1日の上限（この手段だけ。未設定なら null）。 */
  channelLimit: number | null;
  /** 全停止スイッチの状態。 */
  killSwitch: string;
  /** 実行の種類。LIVE 以外は本番ではない。 */
  mode: 'DRY_RUN' | 'LIVE';
};

/**
 * 本番実行の14条件。
 *
 * ★1つでも欠ければ BLOCK。「13個通ったから9割OK」という数え方はしない。
 *   点数ではなく門にしてあるのは、外へ出たものは取り消せないから。
 * ★条件を満たせないときは、条件をゆるめるのではなく、満たせるまで送らない。
 */
export function evaluateLiveReadiness(ctx: LiveContext): LiveReadiness {
  const c = ctx.company;
  const conditions: LiveCondition[] = [];
  const add = (code: string, label: string, ok: boolean, detail: string) => conditions.push({ code, label, ok, detail });

  // ① 練習用データではないこと
  const origin = toOrigin(c.data_origin);
  add(
    'DATA_ORIGIN_NOT_TEST',
    '練習用のデータではない',
    isReal(origin),
    isReal(origin) ? `本物のデータ（${origin}）。` : '練習用（TEST）のデータ。人が承認しても外部へは出さない。',
  );

  // ② 会社の本人確認が取れていること
  const verdict = String(c.website_verdict ?? 'NO_WEBSITE');
  add(
    'IDENTITY_VERIFIED',
    '相手が誰なのか確認できている',
    verdict === 'VERIFIED',
    verdict === 'VERIFIED' ? '公式HPがその会社本人のものだと確認済み。' : `本人確認が取れていない（判定=${verdict}）。別会社へ送る危険がある。`,
  );

  // ③ 連絡してはいけない相手ではないこと
  const blocked = Number(c.no_sales_flag ?? 0) === 1;
  add(
    'COMPANY_NOT_BLOCKED',
    '連絡してはいけない相手ではない',
    !blocked,
    blocked ? `営業お断りの会社（${c.no_sales_evidence ?? '記録あり'}）。` : '営業お断りの表記・登録はいずれも無い。',
  );

  // ④ 送り先が確かめられていること
  const destOk = ctx.destination !== null && ctx.destination.trim().length > 0 && destinationLooksRight(ctx.action, ctx.destination, c);
  add(
    'CONTACT_VERIFIED',
    '送り先が確かめられている',
    destOk,
    destOk ? `送り先＝${ctx.destination}（その会社の記録から取ったもの）。` : `送り先が無いか、その会社のものだと確かめられていない（${ctx.destination ?? '未取得'}）。`,
  );

  // ④-2 「送り先が正しい」と「相手が本人」が同時に成り立っていること
  //
  //      ★②と④を別々に見ているだけでは足りないので、両方が揃っていることを1つの条件にする。
  //        画面上で条件が並んでいると、片方だけ通っているのを見て
  //        「電話番号は合っているのだから大丈夫だろう」と読んでしまう。
  //        だが番号の正しさは、その番号がこの会社のものだという証明にはならない。
  //        人が台帳から書き写した正しい番号が、別の会社の番号であることは普通に起きる。
  //      ★片方でも欠ければ、番号が正しくてもBLOCK。
  const identityOk = verdict === 'VERIFIED';
  const bothOk = identityOk && destOk;
  add(
    'IDENTITY_CONTACT_MISMATCH_RISK',
    '送り先と相手が同じ会社だと言い切れる',
    bothOk,
    bothOk
      ? '本人確認済みのHPと、その会社の記録から取った送り先が揃っている。'
      : identityOk
        ? '相手は本人だと確認できているが、送り先がその会社のものだと確かめられていない。'
        : destOk
          ? `送り先は記録から取ったものだが、相手が本人だと確認できていない（判定=${verdict}）。番号が正しくても、別の会社へ送る危険がある。`
          : `相手の本人確認（判定=${verdict}）も送り先の確認も取れていない。`,
  );

  // ⑤ 売る商品が今すぐ売れる状態であること
  const sellable = ctx.offer !== null && ctx.offer.status === 'SELLABLE';
  add(
    'OFFER_SELLABLE_NOW',
    '売る商品が今すぐ売れる',
    sellable,
    sellable ? `「${ctx.offer?.name}」は今すぐ売れる。` : `商品が今すぐ売れる状態ではない（${ctx.offer ? ctx.offer.status : '商品が決まっていない'}）。`,
  );

  // ⑥ 文面が監査に合格していること
  add(
    'COPY_AUDIT_PASS',
    '文面が監査に合格している',
    ctx.auditVerdict === 'PASS',
    ctx.auditVerdict === 'PASS' ? '別の目による10項目の監査に合格済み。' : `監査に合格していない（判定=${ctx.auditVerdict ?? '未監査'}）。`,
  );

  // ⑦ 規約・法令の判定が通っているか、人が判断していること
  const policy = policyStateOf(c, ctx.action);
  add('POLICY_PASS_OR_APPROVED', '規約の判定が通っている', policy.ok, policy.detail);

  // ⑧ 人の承認が実在すること
  const approved = typeof ctx.approvedBy === 'string' && ctx.approvedBy.trim().length > 0;
  add(
    'HUMAN_APPROVAL_EXISTS',
    '人が承認した記録がある',
    approved,
    approved ? `承認者＝${ctx.approvedBy}。` : '人が承認した記録が無い。機械の判断だけでは外へ出さない。',
  );

  // ⑨ 同じ相手へ同じ文面を二重に送っていないこと
  add(
    'NO_DUPLICATE_OUTREACH',
    '同じ相手へ二重に送っていない',
    !ctx.duplicateExists,
    ctx.duplicateExists ? '同じ相手・同じ手段・同じ文面での実行記録が既にある。' : '同じ内容での実行記録は無い。',
  );

  // ⑩ 1日の上限（全体）を超えていないこと
  const limitOk = ctx.dailyLimit !== null && ctx.todayCount < ctx.dailyLimit;
  add(
    'DAILY_LIMIT_NOT_EXCEEDED',
    '1日の上限（全体）を超えていない',
    limitOk,
    ctx.dailyLimit === null
      ? '1日の上限（全体）が決まっていない。上限が無い状態を「超えていない」とは数えない。'
      : `今日${ctx.todayCount}件／上限${ctx.dailyLimit}件。`,
  );

  // ⑩-2 その手段の1日の上限を超えていないこと
  //
  //     ★全体の上限と別に持つ理由。
  //       電話は相手の時間を奪う。メールは相手の受信箱に残る。フォームは相手の窓口を埋める。
  //       1件あたりの重さが違うのに1つの数字でまとめると、
  //       「今日はメールを50件出したので電話の枠が無い」という意味のない止まり方をする。
  //     ★こちらも未設定は通さない。未設定を「余っている」とは数えない。
  const chLabel = ctx.action === 'CALL' ? '電話' : ctx.action === 'EMAIL' ? 'メール' : 'フォーム';
  const chLimitOk = ctx.channelLimit !== null && ctx.channelTodayCount < ctx.channelLimit;
  add(
    'DAILY_LIMIT_CHANNEL_NOT_EXCEEDED',
    `1日の上限（${chLabel}）を超えていない`,
    chLimitOk,
    ctx.channelLimit === null
      ? `1日の上限（${chLabel}）が決まっていない。手段ごとの上限も決めるまで外へは出さない。`
      : `今日${chLabel}で${ctx.channelTodayCount}件／上限${ctx.channelLimit}件。`,
  );

  // ⑪ 全停止スイッチが「停止」になっていないこと
  //    ★初期値は OFF（全停止）。人が意図して解除しないかぎり、外へは何も出ない。
  const killOk = ctx.killSwitch !== 'OFF';
  add(
    'KILL_SWITCH_NOT_OFF',
    '全停止スイッチが停止になっていない',
    killOk,
    killOk ? `全停止スイッチ＝${ctx.killSwitch}（解除済み）。` : '全停止スイッチが OFF（全停止）のまま。外への操作を一切通さない。',
  );

  // ⑫ 実行の種類が LIVE であること（かつ実行する処理コードが存在すること）
  const liveOk = ctx.mode === 'LIVE' && EXTERNAL_ACTIONS_IMPLEMENTED;
  add(
    'EXECUTION_MODE_LIVE',
    '本番実行の仕組みがある',
    liveOk,
    EXTERNAL_ACTIONS_IMPLEMENTED
      ? `実行の種類＝${ctx.mode}。`
      : `${EXTERNAL_ACTION_LABEL[ctx.action]}を実際に行う処理コードが、このシステムに存在しない（実行の種類＝${ctx.mode}）。`,
  );

  const missing = conditions.filter((k) => !k.ok).map((k) => k.label);
  return { verdict: missing.length === 0 ? 'ALLOW' : 'BLOCK', conditions, missing };
}

/** 送り先が、その会社のものとして筋が通っているか。 */
function destinationLooksRight(action: ExternalAction, destination: string, c: Row): boolean {
  const d = destination.trim();
  switch (action) {
    case 'CALL':
      return d === String(c.phone ?? '');
    case 'EMAIL':
      return d === String(c.email ?? '');
    case 'FORM':
      // フォームは、その会社自身のドメインでなければ別会社の窓口に送ることになる。
      return d === String(c.contact_form_url ?? '') && isOwnSiteUrl(d);
    default:
      return false;
  }
}

/** 規約まわりの状態。フォームだけは注意書きの確認が要る。 */
function policyStateOf(c: Row, action: ExternalAction): { ok: boolean; detail: string } {
  if (action !== 'FORM') return { ok: true, detail: '規約上の追加確認が要る手段ではない。' };
  const p = String(c.form_policy ?? '');
  if (p === 'ALLOWED') return { ok: true, detail: 'フォームの注意書きを確認済み（営業利用を禁じていない）。' };
  if (p === 'HUMAN_APPROVED') return { ok: true, detail: '人がフォームの注意書きを読んで許可した。' };
  return { ok: false, detail: `フォームを営業に使ってよいか確認できていない（判定=${p || '未確認'}）。` };
}

// ── 実行記録の書き込み ─────────────────────────────────────────

export type ExecutionRecord = {
  executionId: string;
  idempotencyKey: string;
  companyId: number;
  companyName: string;
  channel: string;
  action: ExternalAction;
  destination: string | null;
  offerCode: string | null;
  offerName: string | null;
  copyVersion: string;
  draftId: number | null;
  approvedBy: string | null;
  /** ★DRY_RUN 以外の値がこの表に入ることは、今の実装では起こらない。 */
  mode: 'DRY_RUN' | 'LIVE';
  executed: boolean;
  liveVerdict: 'ALLOW' | 'BLOCK';
  liveMissing: string[];
  blockReasons: string[];
  executedAt: string;
};

/**
 * 実行記録を1行だけ残す。
 * ★同じ鍵の行が既にあれば、新しい行を作らずに既存の行を返す（二重送信を記録の側でも止める）。
 */
export async function recordExecution(r: ExecutionRecord): Promise<{ inserted: boolean; existingId: string | null }> {
  const existing = await one('SELECT execution_id FROM outreach_executions WHERE idempotency_key = ?', [r.idempotencyKey]);
  if (existing) return { inserted: false, existingId: String(existing.execution_id) };

  await run(
    `INSERT INTO outreach_executions
       (execution_id, idempotency_key, company_id, company_name, channel, action, destination,
        offer_code, offer_name, copy_version, draft_id, approved_by, mode, executed,
        live_verdict, live_missing, block_reasons, executed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      r.executionId,
      r.idempotencyKey,
      r.companyId,
      r.companyName,
      r.channel,
      r.action,
      r.destination,
      r.offerCode,
      r.offerName,
      r.copyVersion,
      r.draftId,
      r.approvedBy,
      r.mode,
      r.executed ? 1 : 0,
      r.liveVerdict,
      JSON.stringify(r.liveMissing),
      JSON.stringify(r.blockReasons),
      r.executedAt,
    ],
  );
  return { inserted: true, existingId: null };
}

/** 全停止スイッチの状態。設定が無ければ OFF（＝全停止）として扱う。 */
export async function killSwitchState(): Promise<string> {
  const v = String((await loadSettings()).get('exec.kill_switch') ?? '').trim();
  return v.length === 0 ? 'OFF' : v.toUpperCase();
}

/** 1日の上限。決まっていなければ null（「無制限」ではなく「未設定」として扱う）。 */
export async function dailyLimitOf(): Promise<number | null> {
  const v = String((await loadSettings()).get('exec.daily_limit') ?? '').trim();
  if (v.length === 0) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 今日すでに実行した件数（DRY RUN を含まない）。 */
export async function todayExecutedCount(): Promise<number> {
  const today = nowIso().slice(0, 10);
  const r = await one("SELECT COUNT(*) AS n FROM outreach_executions WHERE executed = 1 AND substr(executed_at, 1, 10) = ?", [today]);
  return Number(r?.n ?? 0);
}

/** 手段ごとの1日の上限。決まっていなければ null（「無制限」ではなく「未設定」）。 */
export async function channelDailyLimitOf(action: ExternalAction): Promise<number | null> {
  const l = await dailyLimits();
  return action === 'CALL' ? l.PHONE : action === 'EMAIL' ? l.EMAIL : l.FORM;
}

/** 今日その手段で実行した件数（DRY RUN を含まない）。 */
export async function todayExecutedCountByChannel(action: ExternalAction): Promise<number> {
  const t = await todayExecuted();
  return action === 'CALL' ? t.PHONE : action === 'EMAIL' ? t.EMAIL : t.FORM;
}
