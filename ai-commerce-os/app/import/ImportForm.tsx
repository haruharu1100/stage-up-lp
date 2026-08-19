'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { importCsvAction } from '../actions';
import { num } from '@/lib/format';
import { SKIP_REASONS } from '@/lib/score';

type Supplier = { code: string; name: string; terms_checked: number };

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary" type="submit" disabled={pending}>
      {pending ? '取込・分析中…' : '取り込んで分析する'}
    </button>
  );
}

export default function ImportForm({ suppliers }: { suppliers: Supplier[] }) {
  const [state, action] = useFormState(importCsvAction, initial);
  const stats = state?.stats;
  const analyzed = state?.analyzed;

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="supplier_code">仕入先</label>
          <select id="supplier_code" name="supplier_code" defaultValue={suppliers[0]?.code ?? ''}>
            {suppliers.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}（{s.code}）
              </option>
            ))}
          </select>
          <p className="small muted">
            一覧にない仕入先を使いたい場合は、CSVに「仕入先」の列を入れるか、設定画面から追加してください。
          </p>
        </div>

        <div className="field">
          <label htmlFor="file">CSVファイル</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" />
        </div>

        <div className="field">
          <label htmlFor="text">または、CSVの中身を貼り付け</label>
          <textarea id="text" name="text" placeholder="商品名,ブランド,型番,仕入価格,市場価格,状態,在庫" />
        </div>

        <SubmitButton />
      </form>

      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}

      {stats && (
        <>
          <h2>取込結果</h2>
          <div className="cards">
            <div className="card">
              <div className="k">読み込んだ行</div>
              <div className="v">{num(stats.rowCount)}</div>
            </div>
            <div className="card">
              <div className="k">新規登録</div>
              <div className="v">{num(stats.inserted)}</div>
            </div>
            <div className="card">
              <div className="k">更新</div>
              <div className="v">{num(stats.updated)}</div>
            </div>
            <div className="card">
              <div className="k">重複</div>
              <div className="v">{num(stats.duplicatedL1 + stats.duplicatedL2)}</div>
              <div className="sub">同一商品ID {num(stats.duplicatedL1)} / 中身が同じ {num(stats.duplicatedL2)}</div>
            </div>
            <div className="card">
              <div className="k">データ不備</div>
              <div className="v">{num(stats.invalid)}</div>
            </div>
            <div className="card">
              <div className="k">状態が不明</div>
              <div className="v">{num(stats.unknownCondition)}</div>
              <div className="sub">人間確認へ回しました</div>
            </div>
          </div>

          {analyzed && (
            <>
              <h2>分析結果</h2>
              <div className="cards">
                <div className="card">
                  <div className="k">分析した件数</div>
                  <div className="v">{num(analyzed.analyzed)}</div>
                </div>
                <div className="card hi">
                  <div className="k">仕入候補</div>
                  <div className="v">{num(analyzed.profitable)}</div>
                  <div className="sub">STRONG BUY ＋ BUY</div>
                </div>
                <div className="card">
                  <div className="k">除外</div>
                  <div className="v">{num(analyzed.skipped)}</div>
                </div>
                <div className="card">
                  <div className="k">AI判定にかける候補</div>
                  <div className="v">{num(analyzed.aiCandidates)}</div>
                  <div className="sub">全体の {(analyzed.aiCandidateRate * 100).toFixed(1)}%</div>
                </div>
              </div>

              {Object.keys(analyzed.bySkipReason ?? {}).length > 0 && (
                <>
                  <h3>除外された理由の内訳</h3>
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>理由</th>
                          <th className="num">件数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(analyzed.bySkipReason as Record<string, number>).map(([k, v]) => (
                          <tr key={k}>
                            <td>{SKIP_REASONS[k as keyof typeof SKIP_REASONS] ?? k}</td>
                            <td className="num">{num(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {stats.errors?.length > 0 && (
            <>
              <h3>読み込めなかった行</h3>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="num">行</th>
                      <th>理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.errors.slice(0, 50).map((e: { row: number; reason: string }, i: number) => (
                      <tr key={i}>
                        <td className="num">{e.row}</td>
                        <td>{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
