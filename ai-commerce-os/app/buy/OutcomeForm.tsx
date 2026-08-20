'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { recordOpenOutcomeAction } from '../actions';
// 画面から読むので外部依存ゼロの `lib/producturl.ts` を使う。
import { PURCHASE_OUTCOMES } from '@/lib/producturl';

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '記録中…' : 'この結果を記録する'}
    </button>
  );
}

export type OutcomeOption = { openId: number; label: string };

/**
 * 「購入ページを開く」を押したあと、どうだったかを人が報告する（ユーザー指示15 16）。
 *
 * 【5択だけ。「その他」を作らない】
 * 「その他」を作ると、面倒なものが全部そこへ入り、何を直せばいいか分からなくなる。
 *
 * 【「違う商品だった」は理由が必須】
 * 取り違えは、画面上いちばん儲かって見える形で起きる。
 * 理由が残らないと、次に同じ取り違えを防げない。
 *
 * 【「購入した」を選んでも、このシステムは買っていない】
 * 人が自分で商品ページから買ったあと、その事実を教えてもらうだけ。
 * 入れるのは実際に支払った金額・送料・購入日時の3つ。分からない送料は空欄のままにする。
 */
export default function OutcomeForm({ options }: { options: OutcomeOption[] }) {
  const [state, action] = useFormState(recordOpenOutcomeAction, initial);

  if (options.length === 0) {
    return (
      <div className="note small">
        結果待ちの記録はありません。
        （「購入ページを開く」を押すと、ここに結果の記入待ちとして出ます）
      </div>
    );
  }

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="oc-open">どの「開いた記録」についてですか</label>
          <select id="oc-open" name="open_id">
            {options.map((o) => (
              <option key={o.openId} value={o.openId}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="oc-outcome">開いてみて、どうでしたか</label>
          <select id="oc-outcome" name="outcome" defaultValue="PASSED">
            {PURCHASE_OUTCOMES.map((o) => (
              <option key={o.code} value={o.code}>{o.ja}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="oc-note">
            補足（「違う商品だった」を選んだときは必須）
            <span className="small muted">色・サイズ・年式・国内版か海外版か・セット品か単品か、など。</span>
          </label>
          <input id="oc-note" name="note" type="text" />
        </div>

        <h3>「購入した」を選んだときだけ入れる</h3>
        <div className="grid2">
          <div className="field row">
            <label htmlFor="oc-price">
              実際に支払った購入価格（円）
              <span className="small muted">表示価格ではなく、支払った金額。</span>
            </label>
            <input id="oc-price" name="actual_price" type="text" inputMode="numeric" />
          </div>
          <div className="field row">
            <label htmlFor="oc-ship">
              実際にかかった送料（円）
              <span className="small muted">分からないときは空欄。0円と書かないでください。</span>
            </label>
            <input id="oc-ship" name="actual_shipping" type="text" inputMode="numeric" />
          </div>
        </div>
        <div className="field row">
          <label htmlFor="oc-at">購入日時<span className="small muted">空欄なら記録した時刻を使います。</span></label>
          <input id="oc-at" name="purchased_at" type="text" placeholder="2026-08-20T21:00" />
        </div>

        <SubmitButton />
      </form>
      <ul className="small muted">
        {PURCHASE_OUTCOMES.map((o) => (
          <li key={o.code}>
            <strong>{o.ja}</strong>
            {o.severe ? '：重大として数えます（1件でもあると次の段階へ進みません）' : ''}
          </li>
        ))}
      </ul>
      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}
    </>
  );
}
