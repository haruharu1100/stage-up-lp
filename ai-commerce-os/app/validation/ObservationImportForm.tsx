'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { importObservationsAction } from '../actions';
import { num } from '@/lib/format';

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary" type="submit" disabled={pending}>
      {pending ? '記録中…' : '観測を記録する'}
    </button>
  );
}

export default function ObservationImportForm({ template }: { template: string }) {
  const [state, action] = useFormState(importObservationsAction, initial);
  const r = state?.result;

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="obs-file">CSVファイル</label>
          <input id="obs-file" name="file" type="file" accept=".csv,text/csv" />
        </div>
        <div className="field">
          <label htmlFor="obs-text">
            または、CSVの中身を貼り付け
            <span className="small muted">見出しは日本語でも英語でも読み取ります。空欄はそのままで構いません。</span>
          </label>
          <textarea id="obs-text" name="text" defaultValue={template} />
        </div>
        <div className="field">
          <label htmlFor="obs-seconds">
            この取込にかかった時間（秒）
            <span className="small muted">分かる範囲で構いません。空欄なら計測しません。</span>
          </label>
          <input id="obs-seconds" name="import_seconds" type="number" min={0} />
        </div>
        <SubmitButton />
      </form>

      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}

      {r && (
        <div className="panel">
          <dl className="kv">
            <dt>読み取った行数</dt><dd>{num(r.rowCount)}</dd>
            <dt>記録した観測</dt><dd>{num(r.observations)}</dd>
            <dt>新しく追跡し始めた出品</dt><dd>{num(r.newListings)}</dd>
            <dt>取り込めなかった行</dt><dd>{num(r.invalid)}</dd>
            <dt>実市場データとして数えた行</dt><dd>{num(r.realRows)}</dd>
            <dt>　うち 事業者から正式に提供</dt><dd>{num(r.providedRows)}</dd>
            <dt>　うち 自分で画面を見て記録</dt><dd>{num(r.selfObservedRows)}</dd>
            <dt>商品を特定できる情報があった行</dt><dd>{num(r.identifiableRows)}</dd>
          </dl>

          {r.caution && (
            <div className="note warn small">
              <strong>この記録は「自分で見て書き写したデータ」です</strong>
              <br />
              {r.caution}
            </div>
          )}

          {/*
            警告は黙って隠さない。
            とくに「売り切れは確認できたが値段が分からない」は、
            出品価格で埋めたくなる場面なので、必ず目に見える形で残す。
          */}
          {r.warnings?.length > 0 && (
            <>
              <h3>気になった点（止めてはいません）</h3>
              <ul className="reasons small">
                {r.warnings.slice(0, 30).map((w: { row: number; reason: string }, i: number) => (
                  <li key={i}>{w.row}行目：{w.reason}</li>
                ))}
              </ul>
            </>
          )}

          {r.errors?.length > 0 && (
            <>
              <h3>取り込めなかった行</h3>
              <ul className="reasons small">
                {r.errors.slice(0, 30).map((e: { row: number; reason: string }, i: number) => (
                  <li key={i}>{e.row}行目：{e.reason}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
