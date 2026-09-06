/**
 * ガチャの「棚」（カテゴリ）を、お店が自分で作る画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★棚の名前を、この画面に書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「ポケモン」「ワンピース」「スニーカー」を
 *   初期値としてここに並べたくなります。
 *   親切に見えますが、そうすると
 *   時計を売るお店・ブランド品を売るお店が来たときに、
 *   こちらへ「棚を変えてください」と連絡が来ます。
 *
 *   そのたびに直して出し直すのなら、
 *   それは商品ではなく、受託です。
 *
 *   ですので、この画面は空から始めます。
 *   何を売るお店なのかは、お店が決めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★「棚を消す」と「ガチャを消す」を、見た目で区別すること
 * ═══════════════════════════════════════════════════════
 *
 *   棚を消しても、中のガチャは消えません。
 *   消えるのは「この棚に入っている」というつながりだけです。
 *
 *   ここが伝わらないと、お店は棚を1つも消せなくなります。
 *   消したら商品が消えるかもしれない、と思うからです。
 *   ですので、確認のときも、消したあとも、
 *   「ガチャ自体は消えていません」と必ず書きます。
 *   その文はサーバーが作っています。ここでは書き換えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★上限の数を、この画面で決めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   何個まで作れるかはサーバー（lib/server/gachaCategories.ts）が
 *   決めていて、GET のときに limits として渡ってきます。
 *   こちらで 30 と書き写すと、片方だけ直した日にずれます。
 *   ずれると、画面では作れるのに保存で断られます。
 */

"use client";

import { useCallback, useState } from "react";

import {
  useCategories,
  categoryOp,
  type StoreCategory,
} from "@/lib/console/liveStore";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorBox,
  Field,
  Skeleton,
  inputClass,
} from "./ui";

/* ══════════════════════════════════════════════
   小さな部品
   ══════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════
   1つの棚
   ══════════════════════════════════════════════ */

function CategoryRow({
  category,
  canEdit,
  onDone,
  onFail,
}: {
  category: StoreCategory;
  canEdit: boolean;
  onDone: (categories: StoreCategory[], message: string | null) => void;
  onFail: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const rename = useCallback(async () => {
    const next = name.trim();
    if (next === "" || next === category.name) {
      setEditing(false);
      setName(category.name);
      return;
    }
    setBusy(true);
    const r = await categoryOp({
      op: "rename",
      categoryId: category.id,
      name: next,
    });
    setBusy(false);
    if (r.ok) {
      setEditing(false);
      onDone(r.data.categories, "カテゴリの名前を変えました。");
    } else {
      onFail(r.message);
    }
  }, [name, category.id, category.name, onDone, onFail]);

  const remove = useCallback(async () => {
    setBusy(true);
    const r = await categoryOp({ op: "delete", categoryId: category.id });
    setBusy(false);
    setConfirming(false);
    if (r.ok) {
      /* ★サーバーが返した文をそのまま出すこと。
           「何本が棚なしになったか」は、こちらでは数えられません。 */
      onDone(r.data.categories, r.data.message);
    } else {
      onFail(r.message);
    }
  }, [category.id, onDone, onFail]);

  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <input
            className={`${inputClass} max-w-[16rem] flex-1`}
            value={name}
            autoFocus
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename();
              if (e.key === "Escape") {
                setEditing(false);
                setName(category.name);
              }
            }}
          />
        ) : (
          <span className="flex-1 truncate text-[0.95rem] font-semibold text-slate">
            {category.name}
          </span>
        )}

        {/* ★「0本」を隠さないこと。
              空の棚が並んでいることに気づけないと、
              お客様の画面に、中身のない棚が出続けます。 */}
        <Badge tone={category.gachaCount > 0 ? "blue" : "neutral"}>
          ガチャ {category.gachaCount} 本
        </Badge>

        {canEdit ? (
          editing ? (
            <>
              <Btn kind="primary" onClick={rename} disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Btn>
              <Btn
                kind="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setName(category.name);
                }}
              >
                やめる
              </Btn>
            </>
          ) : (
            <>
              <Btn kind="normal" onClick={() => setEditing(true)}>
                名前を変える
              </Btn>
              <Btn kind="ghost" onClick={() => setConfirming(true)}>
                削除
              </Btn>
            </>
          )
        ) : null}
      </div>

      {confirming ? (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-note text-amber-900">
            「{category.name}」を削除します。
            <br />
            {/* ★この2行を消さないこと。
                  消えるのがガチャ本体だと思われると、
                  お店は棚を1つも整理できなくなります。 */}
            この棚に入っている {category.gachaCount} 本のガチャは、
            <b>消えません</b>。棚から外れて「カテゴリなし」になるだけです。
            <br />
            お客様の画面では、絞り込みの選択肢からこの棚が消えます。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="danger" onClick={remove} disabled={busy}>
              {busy ? "削除中…" : "削除する"}
            </Btn>
            <Btn kind="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              やめる
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function CategoryPanel() {
  const { state, reload, put } = useCategories();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const applied = useCallback(
    (categories: StoreCategory[], text: string | null) => {
      if (state.phase === "ok") put({ ...state.data, categories });
      else reload();
      if (text !== null) setMsg({ ok: true, text });
    },
    [state, put, reload],
  );

  const failed = useCallback((text: string) => {
    setMsg({ ok: false, text });
  }, []);

  const create = useCallback(async () => {
    const next = name.trim();
    if (next === "") return;
    setBusy(true);
    const r = await categoryOp({ op: "create", name: next });
    setBusy(false);
    if (r.ok) {
      setName("");
      applied(r.data.categories, "カテゴリを追加しました。");
    } else {
      failed(r.message);
    }
  }, [name, applied, failed]);

  if (state.phase === "loading") {
    return (
      <Card title="カテゴリ（棚）">
        <Skeleton rows={3} label="カテゴリを読み込んでいます" />
      </Card>
    );
  }

  if (state.phase === "ng") {
    /* ★ここで「カテゴリはありません」と出さないこと。
         読めていないだけです。空だと出すと、
         お店は消えたと思って作り直します。 */
    return (
      <Card title="カテゴリ（棚）">
        <ErrorBox what={state.why} onRetry={reload} />
      </Card>
    );
  }

  const { canEdit, categories, limits } = state.data;
  const full =
    limits.maxCategories > 0 && categories.length >= limits.maxCategories;

  return (
    <Card
      title="カテゴリ（棚）"
      note="お客様のガチャ一覧で、絞り込みに使われます"
      right={
        <span className="text-note text-slate3">
          {categories.length}
          {limits.maxCategories > 0 ? ` / ${limits.maxCategories}` : ""} 個
        </span>
      }
    >
      <p className="text-note text-slate3">
        棚の名前は、お店が自由に決められます。扱う商品に合わせてお作りください。
        <br />
        1本のガチャは、最大 {limits.maxPerGacha} 個の棚に入れられます。
        棚への入れ方は、ガチャ管理の画面から設定します。
      </p>

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Field label="新しいカテゴリ名">
              <input
                className={inputClass}
                value={name}
                disabled={busy || full}
                placeholder=""
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
              />
            </Field>
          </div>
          <Btn
            kind="primary"
            onClick={create}
            disabled={busy || full || name.trim() === ""}
          >
            {busy ? "追加中…" : "追加する"}
          </Btn>
        </div>
      ) : (
        <p className="mt-3 text-note text-slate3">
          カテゴリを変更する権限がありません。
        </p>
      )}

      {full ? (
        <p className="mt-2 text-note text-slate3">
          カテゴリはこれ以上作れません（上限 {limits.maxCategories} 個）。
          使っていない棚を削除すると、また作れます。
        </p>
      ) : null}

      {msg ? <Msg ok={msg.ok} text={msg.text} /> : null}

      <div className="mt-3 space-y-2">
        {categories.length === 0 ? (
          <Empty
            why="カテゴリはまだ1つもありません。"
            next="お店で扱う商品に合わせて、棚をお作りください。カテゴリが無くても、ガチャは公開できます。"
          />
        ) : (
          categories.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              canEdit={canEdit}
              onDone={applied}
              onFail={failed}
            />
          ))
        )}
      </div>
    </Card>
  );
}
