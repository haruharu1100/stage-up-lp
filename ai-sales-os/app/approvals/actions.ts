'use server';

import { revalidatePath } from 'next/cache';
import { decideApproval, excludeKind, reviseText } from '../../lib/approval';

/**
 * 承認画面のボタンから呼ばれる処理。
 *
 * ★承認を押しても外部への送信・応募・納品は起きない。
 *   送る処理コードがこのシステムに無いため、記録が残るだけ（gate.ts を参照）。
 * ★ここで行うのは「人がどう判断したか」を残すことだけ。
 *   人が押した判断は、処理をやり直しても上書きされない。
 */

function refresh() {
  revalidatePath('/approvals');
  revalidatePath('/');
}

async function decide(formData: FormData, decision: 'APPROVED' | 'REJECTED' | 'HELD') {
  const id = Number(formData.get('id'));
  if (Number.isFinite(id) && id > 0) await decideApproval(id, decision);
  refresh();
}

export async function approveAction(formData: FormData) {
  await decide(formData, 'APPROVED');
}

export async function rejectAction(formData: FormData) {
  await decide(formData, 'REJECTED');
}

/** いったん判断を止める。あとから承認・却下に進める。 */
export async function holdAction(formData: FormData) {
  await decide(formData, 'HELD');
}

/**
 * 人が直した文章を保存する。
 * ★AIが作った元の文は書き換えない。別に持って、送るときにこちらを優先する。
 */
export async function reviseAction(formData: FormData) {
  const table = String(formData.get('table') ?? '');
  const id = Number(formData.get('refId'));
  const body = String(formData.get('body') ?? '');
  if ((table === 'outreach_drafts' || table === 'proposals') && Number.isFinite(id) && id > 0) {
    await reviseText({ table, id, body });
  }
  refresh();
}

/**
 * 「今後この種類は出さない」を登録する。
 * 押した本人の判断なので、処理をやり直しても消えない。今出ている1件は却下として記録する。
 */
export async function excludeKindAction(formData: FormData) {
  const scope = String(formData.get('scope') ?? '');
  const dimension = String(formData.get('dimension') ?? '');
  const key = String(formData.get('key') ?? '');
  const id = Number(formData.get('id'));
  if ((scope === 'SALES' || scope === 'JOB') && dimension && key) {
    await excludeKind({ scope, dimension, key, reason: '承認画面で「今後この種類は出さない」を押した' });
    if (Number.isFinite(id) && id > 0) await decideApproval(id, 'REJECTED');
  }
  refresh();
}
