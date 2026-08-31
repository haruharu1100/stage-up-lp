'use server';

import { revalidatePath } from 'next/cache';
import { setSetting } from '../../lib/settings';
import { COOLDOWN_KEY, DAILY_LIMIT_KEYS } from '../../lib/sales/limits';

/**
 * 1日の上限と、同じ会社への間隔を保存する。
 *
 * ★ここでAIが勝手に初期値を入れない。
 *   「とりあえず1日10件」と埋めた瞬間、それは人が決めた上限として画面に出る。
 *   決めていないものを決めたことにすると、事故のとき「誰が10件と決めたのか」が誰にも答えられない。
 *
 * ★読めない値は保存しない。直して保存する、ということもしない。
 *   「10件」を10として拾うと、「1日10件」のつもりが別の数で回る余地ができる。
 */
export async function saveLimitsAction(formData: FormData): Promise<void> {
  const targets: string[] = [DAILY_LIMIT_KEYS.all, DAILY_LIMIT_KEYS.PHONE, DAILY_LIMIT_KEYS.EMAIL, DAILY_LIMIT_KEYS.FORM, COOLDOWN_KEY];

  const errors: string[] = [];
  for (const key of targets) {
    const raw = formData.get(key);
    // 欄がフォームに無い場合は触らない（送られてこなかったものを空欄扱いにして消さない）。
    if (raw === null) continue;
    const r = await setSetting(key, String(raw));
    if (!r.ok) errors.push(r.reasonJa);
  }

  revalidatePath('/system');
  revalidatePath('/');

  if (errors.length > 0) {
    const { redirect } = await import('next/navigation');
    redirect(`/system?err=${encodeURIComponent(errors.join(' / '))}`);
  }
}
