'use server';

import { revalidatePath } from 'next/cache';
import { setSetting } from '../../lib/settings';
import { rankRealCompanies } from '../../lib/sales/opportunity';

/**
 * 商品の値段・原価・想定作業時間を保存する。
 *
 * ★保存したら、そのまま順位を計算し直す。
 *   値段を直したのに古い順位のままだと、
 *   「直したはずの数字」と「画面の順位」が食い違う。
 *   人はどちらが本当か分からなくなり、古い順位のまま営業先を選ぶことになる。
 *
 * ★保存できなかったときは、その理由をそのまま画面へ返す。
 *   黙って0にしたり、読めるところだけ拾って保存したりしない。
 */
export async function savePriceAction(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '');
  const fields = ['min', 'max', 'margin', 'costDirect', 'estHours'] as const;

  const errors: string[] = [];
  for (const f of fields) {
    const key = String(formData.get(`key_${f}`) ?? '');
    if (!key) continue;
    const value = String(formData.get(`val_${f}`) ?? '');
    const r = await setSetting(key, value);
    if (!r.ok) errors.push(r.reasonJa);
  }

  // ★値段が変われば、予想売上・予想利益・順位が変わる。ここで必ず計算し直す。
  //   （順位に効くのは「値段が決まっているか」の1項目・重み0.15だけ。
  //     金額の大きさそのものは点数に入れていないので、値段を上げても順位は上がらない。）
  if (errors.length === 0) await rankRealCompanies(20);

  revalidatePath('/pricing');
  revalidatePath('/leads');
  revalidatePath('/');

  if (errors.length > 0) {
    // Next.js のサーバー処理から画面へ理由を返す方法として、URLに載せる。
    const { redirect } = await import('next/navigation');
    redirect(`/pricing?err=${encodeURIComponent(errors.join(' / '))}&code=${encodeURIComponent(code)}`);
  }
}
