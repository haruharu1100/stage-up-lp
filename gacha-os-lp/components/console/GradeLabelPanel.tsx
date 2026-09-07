/**
 * 賞の「呼び名」を、お店が自分で決める画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★呼び名の例を、初期値として入れないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「特賞」「1等」を最初から入れておきたくなります。
 *   親切に見えますが、そうすると
 *   別の呼び方をするお店が来たときに、
 *   こちらへ「呼び名を変えてください」と連絡が来ます。
 *
 *   ですので、この画面は既定の呼び名（S賞…）から始めます。
 *   何と呼ぶかは、お店が決めます。
 *   下の「例：」は、入力欄の外に書いた説明であって、初期値ではありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★「呼び名を変える」と「等級を変える」を、はっきり分けること
 * ═══════════════════════════════════════════════════════
 *
 *   ここで変わるのは、お客様に見える文字だけです。
 *   中の記号（S / A / B / C / D）は変わりません。
 *
 *   記号は在庫（gacha_stock）の主キーの一部で、
 *   当選履歴にも入っていて、還元率の計算にも使われています。
 *
 *   これが伝わらないと、お店は呼び名を1つも変えられません。
 *   変えたら過去の当選や在庫が壊れるかもしれない、と思うからです。
 *   ですので、画面にもはっきり書きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★文字数の上限を、この画面で決めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   何文字までかはサーバー（lib/server/gradeLabels.ts）が決めていて、
 *   GET のときに maxLength として渡ってきます。
 *   こちらで 20 と書き写すと、片方だけ直した日にずれます。
 *   ずれると、画面では入力できるのに保存で断られます。
 */

"use client";

import { useCallback, useMemo, useState } from "react";

import {
  useGradeLabels,
  saveGradeLabels,
  type GradeLabelRow,
} from "@/lib/console/liveStore";
import { Badge, Btn, Card, ErrorBox, Field, Skeleton, inputClass } from "./ui";

function Msg({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      className={`mt-3 whitespace-pre-line rounded-lg border px-3 py-2 text-note ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-800"
      }`}
    >
      {text}
    </p>
  );
}

/**
 * その等級が、お客様から見てどういう賞なのか。
 *
 * ★ここは仕様です。お店が変えられる場所ではありません。
 *   S / A / B は現物をお届けし、C / D はポイントでお返しします。
 *   この区別を書いておかないと、お店は
 *   「D賞をいちばん豪華な賞の名前にする」ことができてしまいます。
 */
const SHIKUMI: Record<string, string> = {
  S: "現物をお届けします",
  A: "現物をお届けします",
  B: "現物をお届けします",
  C: "ポイントでお返しします",
  D: "ポイントでお返しします",
};

export default function GradeLabelPanel() {
  const { state, reload, put } = useGradeLabels();
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const grades: GradeLabelRow[] =
    state.phase === "ok" ? state.data.grades : [];

  /* いま入力欄に入っている文字。まだ触っていない等級は、いまの呼び名。
     ★サーバーの値を直接書き換えないこと。
       保存に失敗したときに、画面だけ新しい呼び名になります。 */
  const nakami = useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of grades) out[g.grade] = edit?.[g.grade] ?? g.label;
    return out;
  }, [grades, edit]);

  const kawatta = useMemo(
    () => grades.some((g) => nakami[g.grade] !== g.label),
    [grades, nakami],
  );

  const change = useCallback((grade: string, v: string) => {
    setMsg(null);
    setEdit((prev) => ({ ...(prev ?? {}), [grade]: v }));
  }, []);

  const save = useCallback(async () => {
    /* ★触った等級だけを送ること。
         全部送ると、他の人が別のタブで変えた呼び名を上書きします。 */
    const okuru: Record<string, string> = {};
    for (const g of grades) {
      if (nakami[g.grade] !== g.label) okuru[g.grade] = nakami[g.grade];
    }
    if (Object.keys(okuru).length === 0) return;

    setBusy(true);
    const r = await saveGradeLabels(okuru);
    setBusy(false);

    if (r.ok) {
      setEdit(null);
      if (state.phase === "ok") {
        put({
          canEdit: r.data.canEdit,
          grades: r.data.grades,
          maxLength: r.data.maxLength,
        });
      } else {
        reload();
      }
      setMsg({
        ok: true,
        text: r.data.message ?? "賞の呼び名を保存しました。",
      });
    } else {
      /* ★入力をここで消さないこと。
           打ち直させるのは、いちばんやってはいけないことです。 */
      setMsg({ ok: false, text: r.message });
    }
  }, [grades, nakami, state, put, reload]);

  const modosu = useCallback(() => {
    setEdit(null);
    setMsg(null);
  }, []);

  if (state.phase === "loading") {
    return (
      <Card title="賞の呼び名">
        <Skeleton rows={5} label="賞の呼び名を読み込んでいます" />
      </Card>
    );
  }

  if (state.phase === "ng") {
    /* ★ここで「未設定です」と出さないこと。
         読めていないだけで、設定は消えていません。 */
    return (
      <Card title="賞の呼び名">
        <ErrorBox what={state.why} code="grade-labels" onRetry={reload} />
      </Card>
    );
  }

  const { canEdit, maxLength } = state.data;

  return (
    <Card
      title="賞の呼び名"
      note="お客様の売り場・当選画面・獲得商品の一覧に出る文字です"
    >
      <p className="text-note leading-[1.9] text-slate3">
        「S賞」「A賞」…のままでも使えますが、お店の呼び方に変えられます。
        <br />
        例：特賞 ／ 1等 ／ 2等 ／ ラストワン賞 ／ PSA10賞 ／ BOX賞 ／ SSR
        <br />
        1つあたり {maxLength} 文字までです。
      </p>

      {/* ★この一文を消さないこと。
            これが無いと、お店は怖くて呼び名を変えられません。 */}
      <p className="mt-3 rounded-lg border border-edge bg-paper2 px-3 py-2 text-[0.72rem] leading-[1.8] text-slate3">
        変わるのは、お客様に見える文字だけです。
        抽選・残り口数・過去の当選履歴・操作の記録は、いっさい変わりません。
        呼び名を変えても、公開中のガチャを止める必要はありません。
        <br />
        過去に当たった賞の表示も、新しい呼び名に変わります
        （同じ賞の言い換えのため、古い呼び名を残すと別の賞に見えてしまいます）。
      </p>

      <div className="mt-4 space-y-3">
        {grades.map((g) => (
          <div
            key={g.grade}
            className="flex flex-wrap items-end gap-3 rounded-xl border border-edge bg-paper px-3 py-3"
          >
            <div className="w-[9.5rem] shrink-0">
              <span className="nb block text-note font-bold text-slate">
                {g.grade}
                <span className="ml-1 font-normal text-slate3">
                  （中の記号）
                </span>
              </span>
              <span className="mt-1 block text-[0.7rem] leading-[1.7] text-slate3">
                {SHIKUMI[g.grade] ?? ""}
              </span>
            </div>

            <div className="min-w-[13rem] flex-1">
              <Field label="お客様に見せる呼び名">
                <input
                  className={inputClass}
                  value={nakami[g.grade] ?? ""}
                  disabled={!canEdit || busy}
                  maxLength={maxLength}
                  aria-label={`${g.grade} の呼び名`}
                  onChange={(e) => change(g.grade, e.target.value)}
                />
              </Field>
            </div>

            <div className="pb-1">
              {g.customized ? (
                <Badge tone="ok">変更済み</Badge>
              ) : (
                <Badge tone="neutral">既定のまま</Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn kind="primary" onClick={save} disabled={busy || !kawatta}>
            {busy ? "保存中…" : "呼び名を保存する"}
          </Btn>
          <Btn onClick={modosu} disabled={busy || !kawatta}>
            入力を取り消す
          </Btn>
          {/* ★空欄にしたらどうなるかを、その場に書いておくこと。
                書かないと「消えたまま公開される」と思われます。 */}
          <span className="text-[0.72rem] text-slate3">
            空欄にして保存すると、既定の呼び名（S賞など）に戻ります。
          </span>
        </div>
      ) : (
        <p className="mt-4 text-note text-slate3">
          賞の呼び名を変更する権限がありません。
        </p>
      )}

      {msg !== null && <Msg ok={msg.ok} text={msg.text} />}
    </Card>
  );
}
