/**
 * このガチャを、どの棚（カテゴリ）に置くか。
 *
 * ═══════════════════════════════════════════════════════
 * ★「選んだ瞬間に反映」にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここで決めた棚は、そのままお客様の絞り込みに出ます。
 *   触った瞬間に売り場が動くと、
 *   指が当たっただけで、販売中のガチャが棚から消えます。
 *   ですので、選ぶのは画面の中だけ。保存を押したときに送ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★棚が1つも無いときに、こちらで作らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「とりあえず『その他』を作っておきますか？」をしません。
 *   何を売るお店なのかは、お店が決めます。
 *   棚が無くても、ガチャは公開できます。
 *   その場合、お客様の画面には絞り込みが出ないだけです。
 *
 * ★上限はサーバーから来た数を使うこと。
 *   ここに 5 と書き写すと、片方だけ直した日にずれます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  useGachaCategories,
  saveGachaCategories,
  useCategories,
} from "@/lib/console/liveStore";
import { Btn, Empty, ErrorBox, Skeleton } from "./ui";

export default function GachaCategoryPicker({
  gachaId,
  mayEdit,
}: {
  gachaId: string;
  mayEdit: boolean;
}) {
  const { state, reload } = useGachaCategories(gachaId);
  /* 上限（1本のガチャに付けられる棚の数）はこちらから来ます */
  const limits = useCategories();

  const [pick, setPick] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* サーバーから来た「いまの状態」を、下書きの初期値にする */
  useEffect(() => {
    if (state.phase === "ok") setPick(state.data.selected);
  }, [state]);

  const max =
    limits.state.phase === "ok" ? limits.state.data.limits.maxPerGacha : 0;

  const toggle = useCallback(
    (id: string) => {
      setMsg(null);
      setPick((now) => {
        const cur = now ?? [];
        if (cur.includes(id)) return cur.filter((x) => x !== id);
        if (max > 0 && cur.length >= max) return cur;
        return [...cur, id];
      });
    },
    [max],
  );

  const save = useCallback(async () => {
    if (pick === null) return;
    setBusy(true);
    const r = await saveGachaCategories(gachaId, pick);
    setBusy(false);
    if (r.ok) {
      setPick(r.data);
      setMsg({ ok: true, text: "カテゴリを保存しました。" });
    } else {
      setMsg({ ok: false, text: r.message });
    }
  }, [gachaId, pick]);

  if (state.phase === "loading") {
    return <Skeleton rows={2} label="カテゴリを読み込んでいます" />;
  }

  if (state.phase === "ng") {
    /* ★「棚なし」と出さないこと。読めていないだけです */
    return <ErrorBox what={state.why} onRetry={reload} />;
  }

  const { categories, selected } = state.data;
  const now = pick ?? selected;
  const changed =
    now.length !== selected.length || now.some((id) => !selected.includes(id));

  return (
    <div>
      <h3 className="text-note font-bold text-slate2">カテゴリ（棚）</h3>

      {categories.length === 0 ? (
        <div className="mt-2">
          <Empty
            why="カテゴリがまだ1つもありません。"
            next="「開店準備」の画面で棚を作ると、ここで選べるようになります。カテゴリが無くても、このガチャは公開できます。"
          />
        </div>
      ) : (
        <>
          <p className="mt-1 text-note text-slate3">
            お客様のガチャ一覧で、ここで選んだ棚から探せるようになります。
            {max > 0 ? `1本につき ${max} 個まで選べます。` : ""}
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((c) => {
              const on = now.includes(c.id);
              const full = !on && max > 0 && now.length >= max;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!mayEdit || busy || full}
                  onClick={() => toggle(c.id)}
                  aria-pressed={on}
                  title={
                    full ? `選べるのは ${max} 個までです。` : undefined
                  }
                  className={`rounded-full border px-3 py-1.5 text-note transition ${
                    on
                      ? "border-blue-400 bg-blue-50 font-bold text-blue-800"
                      : "border-edge bg-white text-slate2"
                  } ${!mayEdit || busy || full ? "cursor-not-allowed opacity-50" : "hover:border-blue-300"}`}
                >
                  {on ? "✓ " : ""}
                  {c.name}
                </button>
              );
            })}
          </div>

          {mayEdit ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Btn kind="primary" onClick={save} disabled={busy || !changed}>
                {busy ? "保存中…" : "カテゴリを保存"}
              </Btn>
              {changed ? (
                <>
                  <Btn kind="ghost" onClick={() => setPick(selected)} disabled={busy}>
                    元に戻す
                  </Btn>
                  {/* ★「まだ保存していない」ことを、必ず画面に出すこと。
                        押した気になったまま閉じられると、
                        売り場は変わっていないのに変えたつもりになります。 */}
                  <span className="text-note text-warn-ink">
                    まだ保存していません。
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-note text-slate3">
              カテゴリを変更する権限がありません。
            </p>
          )}

          {msg ? (
            <p
              className={`mt-2 whitespace-pre-line rounded-lg border px-3 py-2 text-note ${
                msg.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {msg.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
