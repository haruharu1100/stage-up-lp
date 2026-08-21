"use client";

/**
 * LP CONTENT EDITOR の画面。
 *
 * 左が編集、右が見え方。文字を打った瞬間に右が変わります。
 *
 * ★この画面で変えられるのは「文章・改行・出すか出さないか」だけです。
 *   金額の計算、還元率の計算、バックテスト、セキュリティ、
 *   外部との通信の設定は、この画面からは触れません。
 *
 * ★進め方
 *   直す → 右で確かめる → 下書きを保存 → 公開する
 *   公開したものは「変更の記録」からいつでも元に戻せます。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  KIND_LABEL,
  LP_FIELDS,
  LP_GROUPS,
  LP_MAX_LEN,
  type LpStore,
  type LpValue,
} from "@/lib/lpText";

/** プレビューの画面幅。初めて開いたときは 390px（いちばん多いスマホ） */
const WIDTHS = [375, 390, 430, 768, 1024, 1440] as const;
const DEFAULT_WIDTH = 390;

type Props = {
  /** サーバーが読んだ最初の中身 */
  initial: LpStore;
  /** 合言葉（URLに付いていたもの）。保存するときに一緒に送ります */
  adminKey: string;
  /** コード側の元の文章。編集していない項目はこれが出ます */
  fallbacks: Record<string, string>;
};

type Msg = { kind: "ok" | "ng"; text: string } | null;

export default function LpContentEditor({ initial, adminKey, fallbacks }: Props) {
  const [store, setStore] = useState<LpStore>(initial);
  const [values, setValues] = useState<Record<string, LpValue>>(initial.draft ?? {});
  const [group, setGroup] = useState<string>(LP_GROUPS[0]);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [by, setBy] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  /** 編集した名前は次に開いたときも残しておく（毎回入れ直すのは面倒なので） */
  useEffect(() => {
    setBy(localStorage.getItem("lp-editor-by") ?? "");
  }, []);
  useEffect(() => {
    if (by) localStorage.setItem("lp-editor-by", by);
  }, [by]);

  const fields = useMemo(
    () => LP_FIELDS.filter((f) => f.group === group),
    [group],
  );

  /** 公開中と比べて、いま何件ちがうか */
  const dirtyIds = useMemo(() => {
    const ids = Array.from(
      new Set([...Object.keys(values), ...Object.keys(store.published ?? {})]),
    );
    return ids.filter(
      (id) =>
        JSON.stringify(values[id] ?? {}) !==
        JSON.stringify(store.published?.[id] ?? {}),
    );
  }, [values, store.published]);

  const set = (id: string, patch: Partial<LpValue>) =>
    setValues((v) => {
      const next = { ...v, [id]: { ...(v[id] ?? {}), ...patch } };
      // 空になったら項目ごと消す（元の文章に戻る）
      const cur = next[id];
      if (!cur.pc?.trim() && !cur.sp?.trim() && !cur.hidden) delete next[id];
      return next;
    });

  async function send(action: "draft" | "publish" | "revert", at?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/lp-content", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ action, values, by, at }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        store?: LpStore;
      };
      if (j.store) {
        setStore(j.store);
        if (action === "revert") setValues(j.store.draft ?? {});
      }
      setMsg(
        j.error
          ? { kind: "ng", text: j.error }
          : { kind: "ok", text: j.message ?? "保存しました。" },
      );
    } catch {
      setMsg({ kind: "ng", text: "保存できませんでした。通信を確認してください。" });
    } finally {
      setBusy(false);
    }
  }

  /** 読み取り専用のサーバーでも作業を無駄にしないための逃げ道 */
  function download() {
    const blob = new Blob(
      [JSON.stringify({ ...store, draft: values, published: values }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lp-content.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-h-screen bg-paper2">
      {/* ── 上のバー ── */}
      <div className="sticky top-0 z-30 border-b border-edge bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-5 py-3">
          <p className="num text-label font-bold tracking-[0.14em] text-slate">
            LP CONTENT EDITOR
          </p>
          <span className="rounded-full border border-edge2 bg-paper2 px-2.5 py-1 text-[12px] text-slate2">
            公開中とのちがい {dirtyIds.length}件
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              placeholder="あなたの名前"
              className="w-36 rounded-lg border border-edge bg-white px-3 py-2 text-note text-slate placeholder:text-slate3"
            />
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="btn-outline !px-3 !py-2 text-note"
            >
              変更の記録
            </button>
            <button
              type="button"
              onClick={download}
              className="btn-outline !px-3 !py-2 text-note"
            >
              変更内容を書き出す
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => send("draft")}
              className="btn-outline !px-3 !py-2 text-note disabled:opacity-50"
            >
              下書きを保存
            </button>
            <button
              type="button"
              disabled={busy || dirtyIds.length === 0}
              onClick={() => send("publish")}
              className="btn-primary !px-4 !py-2 text-note disabled:opacity-50"
            >
              公開する
            </button>
          </div>
        </div>
        {msg && (
          <div
            className={`px-5 pb-3 text-note ${
              msg.kind === "ok" ? "text-ok-ink" : "text-alert-ink"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>

      {showHistory && (
        <History store={store} busy={busy} onRevert={(at) => send("revert", at)} />
      )}

      <div className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)]">
        {/* ── 左：編集 ── */}
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {LP_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-note transition-colors ${
                  g === group
                    ? "border-blue-ink bg-blue-ink text-white"
                    : "border-edge bg-white text-slate2 hover:border-blue-ink/30"
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            {fields.map((f) => {
              const v = values[f.id] ?? {};
              const fb = fallbacks[f.id] ?? f.fallback;
              const changed = dirtyIds.includes(f.id);
              return (
                <div
                  key={f.id}
                  className={`rounded-2xl border bg-white p-5 ${
                    changed ? "border-blue-ink/40 shadow-lift" : "border-edge"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="text-note font-bold text-slate">{f.label}</p>
                    <span className="rounded-full border border-edge2 bg-paper2 px-2 py-[2px] text-[11px] text-slate3">
                      {KIND_LABEL[f.kind]}
                    </span>
                    {changed && (
                      <span className="rounded-full bg-blue-pale px-2 py-[2px] text-[11px] font-bold text-blue-ink">
                        変更あり
                      </span>
                    )}
                    {f.canHide && (
                      <label className="ml-auto flex items-center gap-2 text-[12px] text-slate2">
                        <input
                          type="checkbox"
                          checked={v.hidden === true}
                          onChange={(e) => set(f.id, { hidden: e.target.checked })}
                        />
                        この項目を出さない
                      </label>
                    )}
                  </div>

                  {f.hint && (
                    <p className="mt-2 text-[12px] leading-[1.7] text-slate3">
                      {f.hint}
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Box
                      title="パソコン用"
                      note="広い画面（640px以上）で出る文章"
                      value={v.pc ?? ""}
                      placeholder={fb}
                      fieldId={f.id}
                      mode="pc"
                      onChange={(s) => set(f.id, { pc: s })}
                    />
                    <Box
                      title="スマホ用"
                      note="空ならパソコン用と同じ文章が出ます"
                      value={v.sp ?? ""}
                      placeholder={v.pc ?? fb}
                      fieldId={f.id}
                      mode="sp"
                      onChange={(s) => set(f.id, { sp: s })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 右：見え方 ── */}
        <div className="min-w-0">
          <div className="sticky top-[86px]">
            <div className="flex flex-wrap items-center gap-2">
              <p className="num text-label text-slate3">PREVIEW</p>
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  /* ★この data-width は自動チェックが掴む目印。消さないこと */
                  data-width={w}
                  onClick={() => setWidth(w)}
                  className={`num whitespace-nowrap rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                    w === width
                      ? "border-blue-ink bg-blue-ink text-white"
                      : "border-edge bg-white text-slate2 hover:border-blue-ink/30"
                  }`}
                >
                  {w}
                </button>
              ))}
              <span className="text-[12px] text-slate3">
                {width < 640 ? "スマホ用の文章" : "パソコン用の文章"}
              </span>
            </div>

            <Preview
              width={width}
              fields={fields}
              values={values}
              fallbacks={fallbacks}
            />

            <p className="mt-3 text-[12px] leading-[1.8] text-slate3">
              ここに出ているのは、選んだ画面幅で実際に折り返した見え方です。
              語の途中で割れていないか、行の終わりが不自然でないかを確かめてください。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 入力欄。改行はそのまま画面の改行になる ── */
function Box({
  title,
  note,
  value,
  placeholder,
  fieldId,
  mode,
  onChange,
}: {
  title: string;
  note: string;
  value: string;
  placeholder: string;
  fieldId: string;
  mode: "pc" | "sp";
  onChange: (s: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  /** 打った分だけ伸びる。下に隠れる文字が出ないように */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-bold text-slate2">{title}</p>
        <p className="num text-[11px] text-slate3">
          {value.length}/{LP_MAX_LEN}
        </p>
      </div>
      <textarea
        ref={ref}
        /* ★この2つは自動チェックが掴む目印。消さないこと */
        data-field={fieldId}
        data-mode={mode}
        value={value}
        maxLength={LP_MAX_LEN}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1.5 w-full resize-none rounded-xl border border-edge bg-paper2/60 px-3 py-2.5 text-note leading-[1.9] text-slate placeholder:text-slate3/70 focus:border-blue-ink focus:outline-none"
      />
      <p className="mt-1 text-[11px] text-slate3">{note}</p>
    </div>
  );
}

/* ── 見え方。実際の文字の大きさで、指定した幅に折り返す ── */
const KIND_CLASS: Record<string, string> = {
  heading: "text-[26px] font-bold leading-[1.45] tracking-[-0.01em] text-slate",
  sub: "text-[15px] leading-[1.9] text-slate2",
  body: "text-[15px] leading-[1.9] text-slate2",
  cta: "inline-flex rounded-xl bg-blue-ink px-5 py-3 text-[15px] font-bold text-white",
  "faq-q": "text-[16px] font-bold leading-[1.7] text-slate",
  "faq-a": "text-[14px] leading-[1.95] text-slate2",
  note: "text-[12px] leading-[1.8] text-slate3",
};

function Preview({
  width,
  fields,
  values,
  fallbacks,
}: {
  width: number;
  fields: readonly (typeof LP_FIELDS)[number][];
  values: Record<string, LpValue>;
  fallbacks: Record<string, string>;
}) {
  /* 1440px の見え方を 620px の枠に入れるので、縮めて全体を見せる */
  const box = 588;
  const scale = width > box ? box / width : 1;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-edge bg-white">
      <div className="flex items-center justify-between border-b border-edge2 bg-paper2/70 px-4 py-2.5">
        <p className="num text-[11px] tracking-[0.12em] text-slate3">
          {width}px{scale < 1 ? `（${Math.round(scale * 100)}%に縮めて表示）` : ""}
        </p>
        <p className="text-[11px] text-slate3">左の入力がそのまま出ます</p>
      </div>
      <div className="overflow-auto p-4">
        <div
          /* ★この目印で「いま何pxで折り返しているか」を自動チェックが実測します */
          data-preview-frame={width}
          style={{
            width,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            marginBottom: scale < 1 ? -(1 - scale) * 400 : 0,
          }}
        >
          <div className="space-y-5 rounded-xl border border-edge2 bg-paper2/40 px-5 py-5">
            {fields.map((f) => {
              const v = values[f.id] ?? {};
              if (v.hidden) return null;
              const fb = fallbacks[f.id] ?? f.fallback;
              const pc = v.pc?.trim() ? v.pc : fb;
              const text = width < 640 && v.sp?.trim() ? v.sp : pc;
              return (
                <div key={f.id}>
                  <p className="num mb-1.5 text-[10px] tracking-[0.12em] text-slate3">
                    {f.label}
                  </p>
                  <div
                    data-preview-field={f.id}
                    className={KIND_CLASS[f.kind] ?? KIND_CLASS.body}
                  >
                    {text.split("\n").map((line, i, all) => (
                      <span key={i}>
                        {line}
                        {i < all.length - 1 ? <br /> : null}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 変更の記録 ── */
function History({
  store,
  busy,
  onRevert,
}: {
  store: LpStore;
  busy: boolean;
  onRevert: (at: string) => void;
}) {
  const ACTION: Record<string, string> = {
    draft: "下書きを保存",
    publish: "公開",
    revert: "元に戻した",
  };
  return (
    <div className="border-b border-edge bg-white">
      <div className="mx-auto max-w-[1500px] px-5 py-5">
        <p className="text-note font-bold text-slate">変更の記録</p>
        {store.history.length === 0 ? (
          <p className="mt-2 text-note text-slate3">まだ記録はありません。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {store.history.map((h) => (
              <li
                key={h.at}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-edge2 bg-paper2/60 px-4 py-3"
              >
                <span className="num text-[12px] text-slate3">
                  {new Date(h.at).toLocaleString("ja-JP")}
                </span>
                <span className="text-note text-slate">{h.by}</span>
                <span className="rounded-full border border-edge2 bg-white px-2 py-[2px] text-[11px] text-slate2">
                  {ACTION[h.action] ?? h.action}
                </span>
                <span className="num text-[12px] text-slate3">
                  {h.changed.length}件
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRevert(h.at)}
                  className="ml-auto rounded-lg border border-edge px-3 py-1.5 text-[12px] text-slate2 transition-colors hover:border-blue-ink/40 hover:text-blue-ink disabled:opacity-50"
                >
                  この時点に戻す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
