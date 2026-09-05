/**
 * ポイントの有効期限を、お店が決める画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面は「決めた内容を預かる」だけです
 * ═══════════════════════════════════════════════════════
 *
 *   ここで保存しても、ポイントは1ptも消えません。
 *   消す処理は、意図的に作っていません。
 *
 *   ★そのことを、画面に必ず書くこと。
 *     書かないと「設定したから消えているはず」と思われます。
 *     思われたまま何年か経つと、消えていないポイントが
 *     全部そのまま残っていた、という形で表に出ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★はじめから何かを選んでおかないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面を開いた直後は、どれも選ばれていない状態にします。
 *
 *   「期限なし」を先に選んでおくと、そのまま保存されます。
 *   お店は「決めた覚えがないのに決まっていた」ことになります。
 *
 *   「90日」のような数字を先に入れておくのは、もっといけません。
 *   法律を避ける目的で、こちらが期間を選んだことになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★おすすめの期間を書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「180日が一般的です」のような案内を出さないこと。
 *   出した瞬間、それはこちらが選んだ期間になります。
 *   有効期限は法律（資金決済法・前払式支払手段）に関わります。
 *   決めるのは、専門家に確かめたお店の方です。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";
import { Badge, Card, Field, inputClass } from "./ui";

type Mode = "UNSET" | "NONE" | "DAYS" | "MONTHS";

type Policy = {
  mode: Mode;
  value: number | null;
  confirmedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  decided: boolean;
  label: string;
  enforced: boolean;
};

type Limits = {
  minDays: number;
  maxDays: number;
  minMonths: number;
  maxMonths: number;
};

/**
 * 選べる3つ。
 *
 * ★「未設定」を、この一覧に入れないこと。
 *   選べる形にすると、「決めた」を取り消す道になります。
 *   決め直したいなら、新しい決まりを選んでもらいます。
 */
const CHOICES: { mode: Exclude<Mode, "UNSET">; label: string; note: string }[] = [
  {
    mode: "NONE",
    label: "有効期限なし",
    note: "買ったポイントは、いつまでも使えます。これも、お店が決めた1つの決まりです。",
  },
  {
    mode: "DAYS",
    label: "購入から ○日",
    note: "買った日から数えます。日数で決めたいときに選びます。",
  },
  {
    mode: "MONTHS",
    label: "購入から ○か月",
    note: "買った日から数えます。月数で決めたいときに選びます。",
  },
];

export default function PointPolicyPanel() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState("");

  /* ★はじめは「何も選んでいない」。既定値を置かないこと */
  const [mode, setMode] = useState<Mode | "">("");
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/console/point-policy", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        policy?: Policy;
        limits?: Limits;
        blocker?: string | null;
        canEdit?: boolean;
        message?: string;
      };
      if (!res.ok || !data.ok || !data.policy) {
        setLoadError(data.message ?? "有効期限の設定を読み込めませんでした。");
        return;
      }
      setPolicy(data.policy);
      setLimits(data.limits ?? null);
      setBlocker(data.blocker ?? null);
      setCanEdit(data.canEdit === true);

      /* ★すでに決まっているときだけ、その内容を出します。
           未設定のときに何かを選んだ状態にしないこと。 */
      if (data.policy.decided) {
        setMode(data.policy.mode);
        setValue(data.policy.value === null ? "" : String(data.policy.value));
        setConfirmed(data.policy.confirmedAt !== null);
      }
    } catch {
      setLoadError("通信できませんでした。画面を開き直してください。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function hozon() {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const res = await fetch("/api/console/point-policy", {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({
          mode,
          /* ★空を 0 にしないこと。0 は「0日で消える」という別の意味です */
          value: value.trim() === "" ? null : Number(value),
          confirmed,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        policy?: Policy;
        blocker?: string | null;
      };
      if (!res.ok || !data.ok || !data.policy) {
        setError(data.message ?? "保存できませんでした。");
        return;
      }
      setPolicy(data.policy);
      setBlocker(data.blocker ?? null);
      setDone(
        `「${data.policy.label}」で保存しました。` +
          "（この保存では、ポイントはまだ1ptも消えません）",
      );
    } catch {
      setError("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Card title="ポイントの有効期限">
        <p className="text-note leading-[1.9] text-danger-ink">{loadError}</p>
      </Card>
    );
  }

  if (!policy) {
    return (
      <Card title="ポイントの有効期限">
        <p className="text-note leading-[1.9] text-slate3">読み込んでいます…</p>
      </Card>
    );
  }

  const needsValue = mode === "DAYS" || mode === "MONTHS";
  const tani = mode === "MONTHS" ? "か月" : "日";
  const min = mode === "MONTHS" ? limits?.minMonths : limits?.minDays;
  const max = mode === "MONTHS" ? limits?.maxMonths : limits?.maxDays;

  return (
    <Card
      title="ポイントの有効期限"
      note="買っていただいたポイントを、いつまで使えることにするかを決めます。"
      right={
        policy.decided ? (
          policy.confirmedAt ? (
            <Badge tone="ok">決定済み</Badge>
          ) : (
            <Badge tone="warn">確認の記録なし</Badge>
          )
        ) : (
          <Badge tone="danger">未設定</Badge>
        )
      }
    >
      {/* ── いまの状態 ─────────────────────────── */}
      <div className="rounded-xl border border-edge2 bg-paper2 px-5 py-4">
        <p className="text-note leading-[1.9] text-slate2">
          いまの設定：<strong className="font-bold text-slate">{policy.label}</strong>
          {policy.updatedAt && (
            <>
              <br />
              <span className="text-slate3">
                {policy.updatedAt} に {policy.updatedBy ?? "不明"} が保存
              </span>
            </>
          )}
          {policy.confirmedAt && (
            <>
              <br />
              <span className="text-slate3">
                専門家に確認したという記録：{policy.confirmedAt}
              </span>
            </>
          )}
        </p>
      </div>

      {/*
        ★この注意書きを消さないこと。
          設定できることと、実際に消えることは、別です。
      */}
      <p className="mt-4 rounded-xl border border-warn/30 bg-warn/8 px-5 py-4 text-note leading-[1.9] text-warn-ink">
        <strong className="font-bold">
          ★ここで決めても、いまはポイントを失効させません。
        </strong>
        <br />
        有効期限を実際に動かす処理は、まだ作っていません（
        {policy.enforced ? "動いています" : "止まっています"}
        ）。有効期限は法律（資金決済法・前払式支払手段）に関わるため、
        お店が値を決め、専門家のご確認が済んでから作ります。
      </p>

      {blocker && (
        <p className="mt-3 rounded-xl border border-danger/30 bg-danger/8 px-5 py-4 text-note leading-[1.9] text-danger-ink">
          {blocker}
        </p>
      )}

      {!canEdit && (
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★この設定を変えられるのは、全権管理者だけです。内容の確認だけできます。
        </p>
      )}

      {canEdit && (
        <>
          {/* ── 決め方を選ぶ ───────────────────── */}
          <ul className="mt-5 space-y-3">
            {CHOICES.map((c) => (
              <li
                key={c.mode}
                className={`rounded-xl border px-4 py-4 ${
                  mode === c.mode
                    ? "border-blue-ink/30 bg-blue-pale/40"
                    : "border-edge2 bg-paper2"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="expiry-mode"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={mode === c.mode}
                    onChange={() => {
                      setMode(c.mode);
                      if (c.mode === "NONE") setValue("");
                      setDone("");
                      setError("");
                    }}
                  />
                  <span className="min-w-0">
                    <span className="text-note font-bold text-slate">{c.label}</span>
                    <span className="mt-1 block text-note leading-[1.85] text-slate3">
                      {c.note}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {needsValue && (
            <div className="mt-4 max-w-sm">
              <Field
                label={`期間（${tani}）`}
                note={
                  min !== undefined && max !== undefined
                    ? `${min}〜${max}${tani} の範囲で入れられます。打ち間違いを止めるためだけの幅です。`
                    : undefined
                }
                required
              >
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={value}
                  placeholder=""
                  onChange={(e) => {
                    setValue(e.target.value);
                    setDone("");
                    setError("");
                  }}
                />
              </Field>
            </div>
          )}

          {/* ── 専門家の確認 ───────────────────── */}
          <div className="mt-5 rounded-xl border border-edge2 bg-paper2 px-5 py-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  setDone("");
                }}
              />
              <span className="min-w-0 text-note leading-[1.9] text-slate2">
                <strong className="font-bold text-slate">
                  この内容について、専門家（弁護士・行政書士など）に確認しました
                </strong>
                <br />
                <span className="text-slate3">
                  ★お店の方ご自身がチェックしたときだけ、確認した日として記録します。
                  こちらで自動的に入れることはありません。
                  期間を変えたときは、前の確認は引き継ぎません。
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p className="mt-4 text-note leading-[1.9] text-danger-ink">{error}</p>
          )}
          {done && (
            <p className="mt-4 rounded-xl border border-ok/30 bg-ok/10 px-5 py-4 text-note font-bold leading-[1.9] text-ok-ink">
              {done}
            </p>
          )}

          <button
            type="button"
            className="mt-5 rounded-xl bg-slate px-6 py-3 text-note font-bold text-paper disabled:opacity-40"
            disabled={busy || mode === "" || (needsValue && value.trim() === "")}
            onClick={() => void hozon()}
          >
            {busy ? "保存しています…" : "この内容で保存する"}
          </button>

          <p className="mt-4 text-note leading-[1.9] text-slate3">
            ★保存すると、誰がいつ決めたかが監査ログに残ります。
            あとから「誰がこの期間にしたのか」を、記録だけで言えるようにするためです。
          </p>
        </>
      )}
    </Card>
  );
}
