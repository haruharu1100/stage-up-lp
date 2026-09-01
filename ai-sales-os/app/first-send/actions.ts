'use server';

import { revalidatePath } from 'next/cache';
import { isOutcome, recordManualSend } from '../../lib/sales/manual-send';

/**
 * 「1件目」画面のボタンから呼ばれる処理。
 *
 * ★ここにあるのは「人が自分の手で送った結果」を控えるだけの処理。
 *   フォームへ送信する処理はこの画面にも、このシステムのどこにも無い。
 *   ボタンを押しても外へは何も出て行かない。記録が1行増えるだけ。
 */

export async function recordOutcomeAction(formData: FormData) {
  const companyId = Number(formData.get('companyId'));
  const channel = String(formData.get('channel') ?? 'FORM');
  const draftIdRaw = Number(formData.get('draftId'));
  const outcome = String(formData.get('outcome') ?? '');
  const destination = String(formData.get('destination') ?? '') || null;
  const body = String(formData.get('body') ?? '');
  const note = String(formData.get('note') ?? '') || null;

  if (!Number.isFinite(companyId) || companyId <= 0) return;
  if (!isOutcome(outcome)) return;

  await recordManualSend({
    companyId,
    channel,
    draftId: Number.isFinite(draftIdRaw) && draftIdRaw > 0 ? draftIdRaw : null,
    destination,
    body,
    outcome,
    note,
  });

  revalidatePath('/first-send');
  revalidatePath('/');
}
