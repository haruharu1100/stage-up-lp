'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { setUrlStatusAction } from '../actions';
// 画面から読むので外部依存ゼロの `lib/producturl.ts` を使う。
// `lib/purchaselink.ts` を読むとデータベース層まで引きずってビルドが落ちる。
import { URL_STATUS_JA, URL_STATUSES } from '@/lib/producturl';

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '記録中…' : 'この状態を記録する'}
    </button>
  );
}

export type UrlStatusOption = { listingKey: string; label: string };

/**
 * 商品ページがいま生きているかを人が記録する（ユーザー指示3）。
 *
 * 【なぜ人が見るのか】
 * このシステムは商品ページへ通信しない。だから「まだ売っているか」は分からない。
 * 分からないものを「出品中」にすると、消えたページへ人を送ることになる。
 * 既定は「不明」で、押せない状態から始まる。
 */
export default function UrlStatusForm({ options }: { options: UrlStatusOption[] }) {
  const [state, action] = useFormState(setUrlStatusAction, initial);

  if (options.length === 0) {
    return <div className="note small">状態を記録できる出品がまだありません。</div>;
  }

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="us-target">対象の出品</label>
          <select id="us-target" name="listing_key">
            {options.map((o) => (
              <option key={o.listingKey} value={o.listingKey}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="us-status">
            商品ページを見て、いまどうなっていましたか
            <span className="small muted">
              実際にページを開いて確かめてから選んでください。見ていないものを「出品中」にしないでください。
            </span>
          </label>
          <select id="us-status" name="url_status" defaultValue="ACTIVE">
            {URL_STATUSES.map((s) => (
              <option key={s} value={s}>{URL_STATUS_JA[s]}</option>
            ))}
          </select>
        </div>
        <SubmitButton />
      </form>
      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}
    </>
  );
}
