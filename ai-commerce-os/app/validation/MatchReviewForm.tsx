'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { recordMatchReviewAction } from '../actions';
// 画面から読むので `lib/listing.ts`（外部依存なし）を使う。
// `lib/matchreview.ts` を読むとデータベース層まで引きずってビルドが落ちる。
import { MATCH_VERDICTS } from '@/lib/listing';

const initial = { ok: false, message: '' } as any;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '記録中…' : 'この確認結果を記録する'}
    </button>
  );
}

export type MatchReviewOption = {
  listingKey: string;
  label: string;
  matchedVenueCode: string;
};

/**
 * 「機械が同じ商品だと判定したもの」に、人が答えを付ける。
 *
 * 【なぜ人がやるのか】
 * 型番の照合は、色違い・サイズ違い・年式違い・国内版と海外版・セット品と単品を
 * 見分けられない。ここを機械任せにすると、8万円の相場だと思って仕入れた実物が
 * 相場2万円の別モデルだった、が起きる。
 *
 * 【選択肢を3つに絞っている】
 * 「たぶん合っている」を作らない。迷ったものは全部そこへ入り、結局それが
 * 合格として扱われるため。迷ったら「判断が付かない」を選ぶ。
 */
export default function MatchReviewForm({ options }: { options: MatchReviewOption[] }) {
  const [state, action] = useFormState(recordMatchReviewAction, initial);

  if (options.length === 0) {
    return (
      <div className="note small">
        いま確認が必要な組み合わせはありません。
        （他の市場に同じ商品の相場が登録されると、ここに確認待ちとして出ます）
      </div>
    );
  }

  return (
    <>
      <form action={action} className="panel">
        <div className="field">
          <label htmlFor="mr-target">確認する組み合わせ</label>
          <select id="mr-target" name="pair">
            {options.map((o) => (
              <option key={`${o.listingKey}::${o.matchedVenueCode}`} value={`${o.listingKey}::${o.matchedVenueCode}`}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="small muted">
            実物の写真・説明を見て、本当に同じ商品かどうかを確かめてから選んでください。
          </span>
        </div>
        <div className="field">
          <label htmlFor="mr-verdict">確認結果</label>
          <select id="mr-verdict" name="verdict" defaultValue="CORRECT_MATCH">
            {MATCH_VERDICTS.map((v) => (
              <option key={v.code} value={v.code}>{v.ja}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mr-note">
            何が違ったか（「違う商品だった」を選んだときは必須）
            <span className="small muted">色・サイズ・年式・国内版か海外版か・セット品か単品か、など。</span>
          </label>
          <input id="mr-note" name="note" type="text" />
        </div>
        <SubmitButton />
      </form>
      <ul className="small muted">
        {MATCH_VERDICTS.map((v) => (
          <li key={v.code}><strong>{v.ja}</strong>：{v.note}</li>
        ))}
      </ul>
      {state?.message && (
        <div className={`note ${state.ok ? 'ok' : 'danger'}`}>{state.message}</div>
      )}
    </>
  );
}
