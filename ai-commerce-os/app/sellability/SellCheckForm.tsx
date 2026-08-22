'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { recordSellCheckAction } from '../actions';
// 外部依存ゼロの `lib/sellability.ts` だけを読む。
// `lib/sellcheck.ts` を読むとデータベース層まで引きずられてビルドが落ちる（ルール37）。
import {
  SELLABILITY_SOURCE_TOOLS,
  SELLABILITY_SOURCE_TOOL_JA,
  SELLABILITY_THRESHOLDS,
  SELLABILITY_VERDICT_JA,
  SELLABILITY_VERDICT_TONE,
  SELLABILITY_SCOPE_NOTE,
} from '@/lib/sellability';

const initial = { ok: false, message: '', duplicate: false, judged: null, caution: null } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '判定中…' : 'この商品が売れているか判定する'}
    </button>
  );
}

/**
 * Keepa の画面を見て、数字を書き写す欄。
 *
 * 【空欄を埋めさせない】
 * 分からない項目は空欄のままでよい。空欄があれば判定は「判断できない」になる。
 * それでいい。適当に埋めた数字で「売れる」と出るほうが、はるかに危ない。
 */
export default function SellCheckForm({ venues }: { venues: { code: string; name: string }[] }) {
  const [state, action] = useFormState(recordSellCheckAction, initial);
  const judged = state?.judged as
    | { verdict: keyof typeof SELLABILITY_VERDICT_JA; reason: string; warnings: string[]; missing: string[];
        estimatedMonthlySales: number | null; perSellerMonthly: number | null; estimatedTurnoverDays: number | null }
    | null;

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="sc-key">
            商品を指す文字列
            <span className="small muted">JAN・ASIN・型番など。あとで同じ商品を追いかけるための目印です。</span>
          </label>
          <input id="sc-key" name="product_key" type="text" placeholder="例：4901234567890 / B0XXXXXXXX" required />
        </div>

        <div className="field">
          <label htmlFor="sc-name">商品名<span className="small muted">分かる範囲で。空欄でもかまいません。</span></label>
          <input id="sc-name" name="product_name" type="text" />
        </div>

        <div className="field">
          <label htmlFor="sc-venue">どの市場の話か</label>
          <select id="sc-venue" name="venue_code" defaultValue="AMAZON">
            {venues.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sc-tool">
            どの画面を見て記入したか
            <span className="small muted">
              Keepa は Amazon ではなく第三者のツールです。出どころを分けて記録します。
            </span>
          </label>
          <select id="sc-tool" name="source_tool" defaultValue="KEEPA">
            {SELLABILITY_SOURCE_TOOLS.map((t) => (
              <option key={t} value={t}>{SELLABILITY_SOURCE_TOOL_JA[t]}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sc-observed">
            いつ画面を見たか
            <span className="small muted">
              {SELLABILITY_THRESHOLDS.STALE_DAYS}日より古い数字では判定しません。
            </span>
          </label>
          <input id="sc-observed" name="observed_at" type="date" required />
        </div>

        <div className="field">
          <label htmlFor="sc-window">何日間の数字か</label>
          <select id="sc-window" name="window_days" defaultValue="90">
            {SELLABILITY_THRESHOLDS.ALLOWED_WINDOW_DAYS.map((d) => (
              <option key={d} value={d}>{d}日</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sc-drops">
            その期間に売れ筋順位が下がった回数
            <span className="small muted">
              ★これは販売数そのものではありません。1回の注文で2個売れても1回しか下がらないことがあります。
              このシステムは必ず「推定」として扱います。
            </span>
          </label>
          <input id="sc-drops" name="rank_drops" type="number" min="0" step="1" />
        </div>

        <div className="field">
          <label htmlFor="sc-offers">
            いまのライバル出品者数
            <span className="small muted">
              ここが空欄だと判定できません。何人で分け合うかが分からないと、自分に回ってくるかも分からないからです。
            </span>
          </label>
          <input id="sc-offers" name="offer_count" type="number" min="0" step="1" />
        </div>

        <div className="field">
          <label htmlFor="sc-rank">いまの売れ筋順位<span className="small muted">任意</span></label>
          <input id="sc-rank" name="sales_rank" type="number" min="0" step="1" />
        </div>

        <div className="field">
          <label htmlFor="sc-avg">期間の平均価格（円）<span className="small muted">任意</span></label>
          <input id="sc-avg" name="avg_price" type="text" inputMode="numeric" />
        </div>

        <div className="field">
          <label htmlFor="sc-cur">いまの価格（円）<span className="small muted">任意</span></label>
          <input id="sc-cur" name="current_price" type="text" inputMode="numeric" />
        </div>

        <div className="field">
          <label htmlFor="sc-url">
            商品ページURL
            <span className="small muted">
              任意。ご自身がブラウザからコピーしたものだけ貼ってください。システムはURLを作りません。
            </span>
          </label>
          <input id="sc-url" name="product_url" type="url" />
        </div>

        <div className="field">
          <label htmlFor="sc-note">メモ<span className="small muted">任意</span></label>
          <input id="sc-note" name="note" type="text" />
        </div>

        <SubmitButton />
      </form>

      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}

      {judged && (
        <div className={`note ${SELLABILITY_VERDICT_TONE[judged.verdict] === 'ok' ? 'ok'
          : SELLABILITY_VERDICT_TONE[judged.verdict] === 'danger' ? 'danger' : ''}`}>
          <strong>判定：{SELLABILITY_VERDICT_JA[judged.verdict]}</strong>
          <div className="small">{judged.reason}</div>
          {judged.estimatedMonthlySales !== null && (
            <div className="small muted">
              推定の月間販売数 {judged.estimatedMonthlySales.toFixed(1)}個
              ／自分の取り分 月{(judged.perSellerMonthly ?? 0).toFixed(2)}個
              ／1個売れるまで およそ{Math.round(judged.estimatedTurnoverDays ?? 0)}日
              （いずれも推定です）
            </div>
          )}
          {judged.warnings?.length > 0 && (
            <ul className="small">
              {judged.warnings.map((w, k) => <li key={k}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {state?.caution && <div className="note small muted">{state.caution}</div>}
      <div className="note small muted">{SELLABILITY_SCOPE_NOTE}</div>
    </>
  );
}
