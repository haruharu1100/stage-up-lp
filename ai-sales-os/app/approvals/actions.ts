'use server';

import { revalidatePath } from 'next/cache';
import { decideApproval } from '../../lib/approval';

/**
 * 「承認」「却下」のボタンから呼ばれる処理。
 *
 * ★承認を押しても外部への送信・応募は起きない。
 *   送る処理コードがこのシステムに無いため、記録が残るだけ。
 */

async function decide(formData: FormData, decision: 'APPROVED' | 'REJECTED') {
  const id = Number(formData.get('id'));
  if (Number.isFinite(id) && id > 0) await decideApproval(id, decision);
  revalidatePath('/approvals');
  revalidatePath('/');
}

export async function approveAction(formData: FormData) {
  await decide(formData, 'APPROVED');
}

export async function rejectAction(formData: FormData) {
  await decide(formData, 'REJECTED');
}
