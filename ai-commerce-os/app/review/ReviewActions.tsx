'use client';

import { useFormState } from 'react-dom';
import { resolveConditionAction, reviewDecisionAction } from '../actions';
import { CONDITION_LABELS, CONDITION_RANKS } from '@/lib/conditions';

const initial = { ok: false, message: '' } as any;

export function ConditionMapForm({ supplierCode, rawLabel, count }: { supplierCode: string; rawLabel: string; count: number }) {
  const [state, action] = useFormState(resolveConditionAction, initial);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="supplier_code" value={supplierCode} />
      <input type="hidden" name="raw_label" value={rawLabel} />
      <select name="condition_rank" defaultValue="">
        <option value="" disabled>
          状態を選ぶ
        </option>
        {CONDITION_RANKS.map((r) => (
          <option key={r} value={r}>
            {r}：{CONDITION_LABELS[r]}
          </option>
        ))}
      </select>
      <button className="primary" type="submit">
        {count} 件をまとめて登録
      </button>
      {state?.message && <span className={`small ${state.ok ? 'pos' : 'neg'}`}>{state.message}</span>}
    </form>
  );
}

export function VerdictForm({ id }: { id: number }) {
  const [state, action] = useFormState(reviewDecisionAction, initial);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <button type="submit" name="verdict" value="APPROVE">
        データは正しい
      </button>
      <button type="submit" name="verdict" value="REJECT">
        対象外にする
      </button>
      {state?.message && <span className={`small ${state.ok ? 'pos' : 'neg'}`}>{state.message}</span>}
    </form>
  );
}
