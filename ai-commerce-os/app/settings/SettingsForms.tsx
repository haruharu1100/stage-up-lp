'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveFeeRuleAction, saveSettingsAction } from '../actions';
import { BUY_PAYMENT_METHODS } from '@/lib/paymentmethods';

const initial = { ok: false, message: '' } as any;

type Setting = {
  key: string;
  value: string;
  value_type: string;
  label: string;
  group_key: string;
  hint: string | null;
};

type FeeRule = {
  id: number;
  channel_code: string;
  channel_name: string;
  category_key: string;
  marketplace_fee_rate: number;
  payment_fee_rate: number;
  shipping_cost: number;
  authentication_fee: number;
  packing_cost: number;
  expected_return_cost: number;
  other_cost: number;
  is_estimated: number;
  source_note: string | null;
};

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary" type="submit" disabled={pending}>
      {pending ? '保存して再計算中…' : label}
    </button>
  );
}

export function ThresholdForm(
  { settings, unknownFeeMethods = [] }: { settings: Setting[]; unknownFeeMethods?: string[] },
) {
  const [state, action] = useFormState(saveSettingsAction, initial);
  const groups = Array.from(new Set(settings.map((s) => s.group_key)));

  return (
    <form action={action}>
      {groups.map((g) => (
        <div key={g}>
          <h3>{g}</h3>
          <div className="panel">
            {settings
              .filter((s) => s.group_key === g)
              .map((s) => (
                <div className="field row" key={s.key}>
                  <label htmlFor={s.key}>
                    {s.label}
                    {s.hint && <span className="small muted"> {s.hint}</span>}
                  </label>
                  {s.key === 'DEFAULT_MERCARI_BUY_PAYMENT_METHOD' ? (
                    <select id={s.key} name={s.key} defaultValue={s.value}>
                      {BUY_PAYMENT_METHODS.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.ja}
                          {unknownFeeMethods.includes(m.code) ? '（手数料が未確認）' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={s.key}
                      name={s.key}
                      type="number"
                      step={s.value_type === 'rate' ? '0.001' : '1'}
                      min="0"
                      defaultValue={s.value}
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
      <div style={{ marginTop: 14 }}>
        <Save label="保存して全件を再判定する" />
        {state?.message && <span className={`small ${state.ok ? 'pos' : 'neg'}`} style={{ marginLeft: 12 }}>{state.message}</span>}
      </div>
    </form>
  );
}

export function FeeForm({ fee }: { fee: FeeRule }) {
  const [state, action] = useFormState(saveFeeRuleAction, initial);
  return (
    <form action={action} className="panel">
      <input type="hidden" name="fee_rule_id" value={fee.id} />
      <h3 style={{ marginTop: 0 }}>
        {fee.channel_name}（{fee.channel_code}）
        {fee.is_estimated === 1 && <span className="badge est" style={{ marginLeft: 8 }}>概算</span>}
      </h3>

      <div className="grid2">
        <div className="field row">
          <label htmlFor={`m${fee.id}`}>販売手数料率（0.1 = 10%）</label>
          <input id={`m${fee.id}`} name="marketplace_fee_rate" type="number" step="0.001" min="0" defaultValue={fee.marketplace_fee_rate} />
        </div>
        <div className="field row">
          <label htmlFor={`p${fee.id}`}>決済手数料率</label>
          <input id={`p${fee.id}`} name="payment_fee_rate" type="number" step="0.001" min="0" defaultValue={fee.payment_fee_rate} />
        </div>
        <div className="field row">
          <label htmlFor={`s${fee.id}`}>送料（円）</label>
          <input id={`s${fee.id}`} name="shipping_cost" type="number" step="1" min="0" defaultValue={fee.shipping_cost} />
        </div>
        <div className="field row">
          <label htmlFor={`a${fee.id}`}>鑑定料（円）</label>
          <input id={`a${fee.id}`} name="authentication_fee" type="number" step="1" min="0" defaultValue={fee.authentication_fee} />
        </div>
        <div className="field row">
          <label htmlFor={`k${fee.id}`}>梱包費（円）</label>
          <input id={`k${fee.id}`} name="packing_cost" type="number" step="1" min="0" defaultValue={fee.packing_cost} />
        </div>
        <div className="field row">
          <label htmlFor={`r${fee.id}`}>想定返品費用（円）</label>
          <input id={`r${fee.id}`} name="expected_return_cost" type="number" step="1" min="0" defaultValue={fee.expected_return_cost} />
        </div>
        <div className="field row">
          <label htmlFor={`o${fee.id}`}>その他費用（円）</label>
          <input id={`o${fee.id}`} name="other_cost" type="number" step="1" min="0" defaultValue={fee.other_cost} />
        </div>
        <div className="field row">
          <label htmlFor={`n${fee.id}`}>出典メモ</label>
          <input id={`n${fee.id}`} name="source_note" type="text" defaultValue={fee.source_note ?? ''} />
        </div>
      </div>

      <label className="check">
        <input type="checkbox" name="is_estimated" defaultChecked={fee.is_estimated === 1} />
        まだ概算値（公式の実額を確認していない）
      </label>

      <div style={{ marginTop: 10 }}>
        <Save label="保存して再計算する" />
        {state?.message && <span className={`small ${state.ok ? 'pos' : 'neg'}`} style={{ marginLeft: 12 }}>{state.message}</span>}
      </div>
    </form>
  );
}
