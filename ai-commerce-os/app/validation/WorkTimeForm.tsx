'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { recordWorkAction } from '../actions';
// 画面から読むので `lib/listing.ts`（外部依存なし）を使う。
// `lib/observation.ts` を読むとデータベース層まで引きずってビルドが落ちる。
import { WORK_STEPS } from '@/lib/listing';

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '記録中…' : '作業時間を記録する'}
    </button>
  );
}

/**
 * 工程ごとの作業時間を手で入れる。
 * ストップウォッチを自動で回す仕組みにはしていない。
 * 実際の作業は画面と手元を行き来するので、自動計測すると「席を立っていた時間」まで混ざる。
 */
export default function WorkTimeForm() {
  const [state, action] = useFormState(recordWorkAction, initial);

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="wt-step">工程</label>
          <select id="wt-step" name="step" defaultValue="RECORD">
            {WORK_STEPS.map((s) => (
              <option key={s.code} value={s.code}>{s.ja}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wt-seconds">かかった時間（秒）</label>
          <input id="wt-seconds" name="seconds" type="number" min={1} />
        </div>
        <div className="field">
          <label htmlFor="wt-rows">
            その間に処理した件数
            <span className="small muted">1件あたりの秒数を出すために使います。</span>
          </label>
          <input id="wt-rows" name="rows" type="number" min={0} defaultValue={1} />
        </div>
        <div className="field">
          <label htmlFor="wt-note">メモ</label>
          <input id="wt-note" name="note" type="text" />
        </div>
        <SubmitButton />
      </form>
      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}
    </>
  );
}
