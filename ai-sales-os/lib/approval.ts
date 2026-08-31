import { all, nowIso, one, parseJson, run, upsert } from './db/client';
import { toOrigin, type DataOrigin } from './origin';
import { checkExpression } from './text';

/**
 * 1クリック承認キュー。
 *
 * 「自動でやってよいか分からない」ものは、全部ここに来る。
 * 人が押すのは「承認」か「却下」の2つだけ。
 *
 * ★承認を押しても、外部への送信・応募は起きない。
 *   このシステムには送る処理コードが無い（gate.ts を参照）。
 *   承認は「人がこの内容でよいと確認した」という記録にとどまる。
 */

export type ApprovalKind = 'FORM' | 'EMAIL' | 'CALL' | 'APPLY' | 'DELIVER';

/**
 * 承認画面に出す中身。
 *
 * ★人が「この1画面だけを見て」判断できることを条件にしている。
 *   相手・提案内容・なぜ選んだか・点数・予想利益・予想作業時間・使う自社の道具・
 *   規約の判定・実際に送る文章・リスク・根拠URL。
 *   ここに出ていない情報を使って判断させない（別の画面を探させない）。
 * ★分からない項目は空にして理由を書く。0や「なし」で埋めない。
 */
export type ApprovalDetail = {
  /** 相手（会社名／案件名）のすぐ下に出す一行 */
  subtitle: string;
  /** 何を提案するか */
  offer: string | null;
  /** なぜこの相手／この案件を選んだか */
  whyChosen: string[];
  /** 点数（ラベルと値の組） */
  scores: { label: string; value: string }[];
  expectedProfit: number | null;
  expectedProfitNote: string | null;
  expectedHours: number | null;
  expectedHourlyProfit: number | null;
  /** 使う自社のAI・システム（仕上がり具合つき） */
  capabilities: { name: string; readinessLabel: string }[];
  /** 規約の判定 */
  policy: { label: string; kind: 'ok' | 'warn' | 'stop'; reason: string; checkedAt: string | null } | null;
  /** 実際に送る文章 */
  body: string;
  /** 気をつけること */
  risks: string[];
  /** 根拠URL（クリックして元を確認できるもの） */
  sources: { label: string; url: string }[];
  /** 「今後この種類は出さない」を押したときに登録する分類 */
  excludeKind: { scope: 'SALES' | 'JOB'; dimension: string; key: string; label: string } | null;
  /** 文章を直したときの保存先 */
  textRef: { table: 'outreach_drafts' | 'proposals'; id: number } | null;
};

export const EMPTY_DETAIL: ApprovalDetail = {
  subtitle: '',
  offer: null,
  whyChosen: [],
  scores: [],
  expectedProfit: null,
  expectedProfitNote: null,
  expectedHours: null,
  expectedHourlyProfit: null,
  capabilities: [],
  policy: null,
  body: '',
  risks: [],
  sources: [],
  excludeKind: null,
  textRef: null,
};

export type ApprovalItem = {
  id: number;
  kind: ApprovalKind;
  refTable: string;
  refId: number;
  title: string;
  summary: string;
  riskNote: string;
  detail: ApprovalDetail;
  /** 人が直した文章。あればこちらを送る。 */
  revisedBody: string | null;
  /**
   * 元になったデータが本物か練習用か。
   * ★画面に必ず出す。練習用は承認ボタンを押しても外部へ進めないが、
   *   「押したのに何も起きない」という体験そのものが仕組みの誤解を生む。
   *   押す前に、これが練習用だと画面で分かるようにする。
   */
  dataOrigin: DataOrigin;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'HELD';
  createdAt: string;
  decidedAt: string | null;
};

export async function enqueueApproval(args: {
  kind: ApprovalKind;
  refTable: string;
  refId: number;
  title: string;
  summary: string;
  riskNote: string;
  detail?: ApprovalDetail;
}): Promise<void> {
  // ★人がすでに「承認」「却下」を押したものは、二度と書き換えない。
  //   処理をやり直すたびに未判断へ戻すと、人が下した判断が消え、
  //   同じ相手が何度も承認待ちに並ぶ（＝重複営業の入口になる）。
  const existing = await one('SELECT id, status, created_at FROM approval_queue WHERE kind = ? AND ref_table = ? AND ref_id = ?', [
    args.kind,
    args.refTable,
    args.refId,
  ]);
  // 「保留」も人が押した判断なので、やり直しても消さない。
  if (existing && String(existing.status) !== 'PENDING') return;
  await upsert(
    'approval_queue',
    {
      kind: args.kind,
      ref_table: args.refTable,
      ref_id: args.refId,
      title: args.title,
      summary: args.summary,
      risk_note: args.riskNote,
      detail: JSON.stringify(args.detail ?? EMPTY_DETAIL),
      status: 'PENDING',
      decided_at: null,
      decided_by: null,
      created_at: existing ? String(existing.created_at ?? nowIso()) : nowIso(),
    },
    ['kind', 'ref_table', 'ref_id'],
  );
}

/** 承認キューが指す先の表。ここに無い名前は受け付けない（SQLに文字列を差し込むため）。 */
const REF_TABLES = ['companies', 'jobs', 'orders'] as const;

/**
 * システムが自分で並べた「判断待ち」のうち、もう提案しなくなったものを取り下げる。
 *
 * ★消すのは PENDING だけ。人が押した判断（承認・却下・保留）には触れない。
 * ★これをやらないと、前回の実行で並べたものが永久に残る。
 *   条件を直して「もう出さない」と判断した相手が承認待ちに居座り、
 *   人がそれを押した瞬間に、今の判断とは違う内容を送ってしまう。
 * ★今回処理した範囲だけを対象にする。件数制限で処理しなかった分は消さない。
 */
export async function withdrawStaleApprovals(args: {
  kind: ApprovalKind;
  refTable: (typeof REF_TABLES)[number];
  processedRefIds: number[];
  keepRefIds: number[];
}): Promise<number> {
  if (!REF_TABLES.includes(args.refTable)) return 0;
  const before = await one("SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'PENDING' AND kind = ? AND ref_table = ?", [
    args.kind,
    args.refTable,
  ]);

  // 1. 今回処理したのに、今回は並べなかったもの
  if (args.processedRefIds.length > 0) {
    const keep = new Set(args.keepRefIds);
    const drop = args.processedRefIds.filter((id) => !keep.has(id));
    if (drop.length > 0) {
      await run(
        `DELETE FROM approval_queue WHERE status = 'PENDING' AND kind = ? AND ref_table = ? AND ref_id IN (${drop.map(() => '?').join(',')})`,
        [args.kind, args.refTable, ...drop],
      );
    }
  }

  // 2. 指し先の行がもう無いもの（データを入れ直したときに取り残される）
  await run(
    `DELETE FROM approval_queue WHERE status = 'PENDING' AND kind = ? AND ref_table = ? AND ref_id NOT IN (SELECT id FROM ${args.refTable})`,
    [args.kind, args.refTable],
  );

  const after = await one("SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'PENDING' AND kind = ? AND ref_table = ?", [
    args.kind,
    args.refTable,
  ]);
  return Number(before?.n ?? 0) - Number(after?.n ?? 0);
}

export async function listApprovals(status?: ApprovalItem['status']): Promise<ApprovalItem[]> {
  const rows = status
    ? await all('SELECT * FROM approval_queue WHERE status = ? ORDER BY id DESC', [status])
    : await all('SELECT * FROM approval_queue ORDER BY CASE status WHEN \'PENDING\' THEN 0 ELSE 1 END, id DESC');

  const out: ApprovalItem[] = [];
  for (const r of rows) {
    const detail = { ...EMPTY_DETAIL, ...parseJson<Partial<ApprovalDetail>>(r.detail, {}) };
    // 人が直した文章があれば、それを「送る文章」として出す。元の生成物は上書きしない。
    let revisedBody: string | null = null;
    if (detail.textRef) {
      const rev = await one('SELECT body FROM text_revisions WHERE ref_table = ? AND ref_id = ?', [
        detail.textRef.table,
        detail.textRef.id,
      ]);
      if (rev) revisedBody = String(rev.body);
    }

    // ★元データの出どころを、承認カードに出すために引いてくる。
    //   引けない（表が違う・行が消えた）ときは TEST 扱いにする。
    //   分からないものを「本物」と表示するほうが、はるかに危ない。
    let dataOrigin: DataOrigin = 'TEST';
    const table = String(r.ref_table);
    if (table === 'companies' || table === 'jobs') {
      const src = await one(`SELECT data_origin FROM ${table} WHERE id = ?`, [Number(r.ref_id)]);
      dataOrigin = toOrigin(src?.data_origin);
    }

    out.push({
      id: Number(r.id),
      kind: String(r.kind) as ApprovalKind,
      refTable: String(r.ref_table),
      refId: Number(r.ref_id),
      title: String(r.title),
      summary: String(r.summary),
      riskNote: String(r.risk_note),
      detail,
      revisedBody,
      dataOrigin,
      status: String(r.status) as ApprovalItem['status'],
      createdAt: String(r.created_at),
      decidedAt: r.decided_at ? String(r.decided_at) : null,
    });
  }
  return out;
}

/**
 * 判断を待っているもの。
 *
 * ★人が「今後この種類は出さない」を押した種類は、ここから外す。
 *   ただし黙って消さない。何件を何の理由で隠したかを返して、画面に出す。
 */
export async function listPendingApprovals(): Promise<{ items: ApprovalItem[]; hidden: number; hiddenLabels: string[] }> {
  // 保留も「まだ決まっていないもの」なので、一緒に取り出して画面で分けて出す。
  const pending = (await listApprovals()).filter((a) => a.status === 'PENDING' || a.status === 'HELD');
  const excluded = await listExcludedKinds();
  const keys = new Set(excluded.map((e) => `${e.scope}/${e.dimension}/${e.key}`));
  const items: ApprovalItem[] = [];
  const labels = new Set<string>();
  let hidden = 0;
  for (const a of pending) {
    const k = a.detail.excludeKind;
    if (k && keys.has(`${k.scope}/${k.dimension}/${k.key}`)) {
      hidden++;
      labels.add(k.label);
      continue;
    }
    items.push(a);
  }
  return { items, hidden, hiddenLabels: [...labels] };
}

export async function decideApproval(
  id: number,
  decision: 'APPROVED' | 'REJECTED' | 'HELD',
  by = 'human',
): Promise<{ ok: boolean; reasonJa: string }> {
  const item = await one('SELECT * FROM approval_queue WHERE id = ?', [id]);
  if (!item) return { ok: false, reasonJa: '対象が見つからない' };
  // 保留はいったん判断を止めるだけなので、あとから承認・却下に進める。
  if (String(item.status) !== 'PENDING' && String(item.status) !== 'HELD') {
    return { ok: false, reasonJa: 'すでに判断済み' };
  }
  await run('UPDATE approval_queue SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', [
    decision,
    decision === 'HELD' ? null : nowIso(),
    by,
    id,
  ]);
  return {
    ok: true,
    reasonJa:
      decision === 'APPROVED'
        ? '承認として記録した。ただし外部への送信・応募の処理はこのシステムに存在しないため、実際の送信は起きない。'
        : decision === 'REJECTED'
          ? '却下として記録した。'
          : '保留として記録した。あとで判断できる。',
  };
}

/**
 * 人が直した文章を保存する。
 *
 * ★元の生成物（outreach_drafts / proposals）は書き換えない。
 *   書き換えると、次にやり直したときに「AIが作った文」と「人が直した文」の区別が消え、
 *   何をどう直したのかが分からなくなる。別の表に持って、送るときにこちらを優先する。
 */
export async function reviseText(args: {
  table: 'outreach_drafts' | 'proposals';
  id: number;
  body: string;
  by?: string;
}): Promise<{ ok: boolean; reasonJa: string }> {
  const body = args.body.trim();
  if (body.length < 10) return { ok: false, reasonJa: '文章が短すぎるので保存しない' };
  const ng = checkExpression(body);
  if (ng.length > 0) {
    return { ok: false, reasonJa: `使えない表現が入っている: ${ng.map((e) => `「${e.matched}」`).join('、')}` };
  }
  await upsert(
    'text_revisions',
    { ref_table: args.table, ref_id: args.id, body, revised_by: args.by ?? 'human', created_at: nowIso() },
    ['ref_table', 'ref_id'],
  );
  return { ok: true, reasonJa: '直した文章を保存した。次からはこちらを送る文章として扱う。' };
}

/**
 * 「今後この種類は出さないでほしい」を登録する。
 * ★AIが勝手に増やさない。人が承認画面で押したときだけ増える。
 */
export async function excludeKind(args: {
  scope: 'SALES' | 'JOB';
  dimension: string;
  key: string;
  reason: string;
}): Promise<void> {
  await upsert(
    'excluded_kinds',
    { scope: args.scope, dimension: args.dimension, key: args.key, reason: args.reason, created_at: nowIso() },
    ['scope', 'dimension', 'key'],
  );
}

export type ExcludedKind = { scope: string; dimension: string; key: string; reason: string; createdAt: string };

export async function listExcludedKinds(): Promise<ExcludedKind[]> {
  const rows = await all('SELECT * FROM excluded_kinds ORDER BY id DESC');
  return rows.map((r) => ({
    scope: String(r.scope),
    dimension: String(r.dimension),
    key: String(r.key),
    reason: String(r.reason ?? ''),
    createdAt: String(r.created_at),
  }));
}

/** 人が「今後出さない」と決めた種類か。処理をやり直しても、この判断は生き続ける。 */
export async function isKindExcluded(scope: 'SALES' | 'JOB', dimension: string, key: string): Promise<boolean> {
  const r = await one('SELECT id FROM excluded_kinds WHERE scope = ? AND dimension = ? AND key = ?', [scope, dimension, key]);
  return Boolean(r);
}

/**
 * まだ判断していない件数。
 * ★承認画面に実際に並ぶ数と一致させる。人が「今後この種類は出さない」と決めたものは数えない。
 *   ここがズレると、いつまでも減らない数字がトップに出続けることになる。
 */
export async function pendingCount(): Promise<number> {
  const { items } = await listPendingApprovals();
  return items.filter((a) => a.status === 'PENDING').length;
}
