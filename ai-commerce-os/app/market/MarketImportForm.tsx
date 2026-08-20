'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { importMarketDataAction } from '../actions';
import { num } from '@/lib/format';

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary" type="submit" disabled={pending}>
      {pending ? '取込・Route再計算中…' : '取り込んでRouteを作りなおす'}
    </button>
  );
}

export default function MarketImportForm({ template }: { template: string }) {
  const [state, action] = useFormState(importMarketDataAction, initial);
  const r = state?.result;
  const routes = state?.routes;

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="file">CSVファイル</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" />
        </div>
        <div className="field">
          <label htmlFor="text">
            または、CSVの中身を貼り付け
            <span className="small muted">見出しは日本語でも英語でも読み取ります。</span>
          </label>
          <textarea id="text" name="text" defaultValue={template} />
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
            <dt>取り込んだ相場</dt><dd>{num(r.inserted)}</dd>
            <dt>取り込めなかった行</dt><dd>{num(r.invalid)}</dd>
            {/*
              実データを1つの数字にまとめない。
              「事業者から提供されたもの」と「自分で見て記録したもの」は立場が違う（2026-08-20 訂正）。
            */}
            <dt>実市場データ</dt><dd>{num(r.realRows ?? 0)}</dd>
            <dt>　うち 事業者から正式に提供</dt><dd>{num(r.providedRows ?? 0)}</dd>
            <dt>　うち 自分で画面を見て記録</dt><dd>{num(r.selfObservedRows ?? 0)}</dd>
          </dl>
          {r.caution && (
            <div className="note warn small">
              <strong>この取込には「自分で記録したデータ」が含まれます</strong>
              <br />
              {r.caution}
            </div>
          )}
          {r.notRealReasons && Object.keys(r.notRealReasons).length > 0 && (
            <>
              <h3>実市場データとして数えなかった理由</h3>
              <ul className="reasons small">
                {Object.entries(r.notRealReasons).map(([reason, count], i: number) => (
                  <li key={i}>{reason}：{num(count as number)}件</li>
                ))}
              </ul>
            </>
          )}
          {r.byVenue && Object.keys(r.byVenue).length > 0 && (
            <p className="small muted">
              市場ごと：{Object.entries(r.byVenue).map(([k, v]) => `${k} ${v}件`).join(' ／ ')}
            </p>
          )}
          {r.errors && r.errors.length > 0 && (
            <>
              <h3>取り込めなかった行</h3>
              <ul className="reasons small">
                {r.errors.slice(0, 20).map((e: { row: number; reason: string }, i: number) => (
                  <li key={i}>{e.row}行目：{e.reason}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {routes && (
        <div className="panel">
          <h3>作りなおしたRoute</h3>
          <dl className="kv">
            <dt>計算した組み合わせ</dt><dd>{num(routes.combinationsTried)}</dd>
            <dt>保存したRoute</dt><dd>{num(routes.routesGenerated)}</dd>
            <dt>成立したRoute</dt><dd>{num(routes.routesOk)}</dd>
            <dt>規約・仕様で使えないRoute</dt><dd>{num(routes.routesBlocked)}</dd>
            <dt>ベストが決まった商品</dt><dd>{num(routes.productsWithRoute)}</dd>
            <dt>SHADOW記録</dt><dd>{num(routes.shadowOpened)}（実際の購入はしていません）</dd>
          </dl>
        </div>
      )}
    </>
  );
}
