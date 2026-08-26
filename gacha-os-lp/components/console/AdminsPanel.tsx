/**
 * 担当者の管理（権限を変える・利用を止める）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これが無いと、退職者を止められません
 * ═══════════════════════════════════════════════════════
 *
 *   仕組み（サーバー側）は前から動いていました。
 *   止まっている人は断られますし、権限は毎回読み直しています。
 *   けれど「止める」「権限を変える」を押す場所がありませんでした。
 *
 *   押す場所が無いと、運営の方は結局こうします。
 *
 *       ・退職者のアカウントを、そのまま放置する
 *       ・急ぎのときは、誰かのアカウントを借りる
 *
 *   どちらも、記録の上では「その人がやったこと」になります。
 *   あとから誰も、本当は誰がやったのかを言えなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面は「守り」ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   ボタンを消しても、入口（API）を直接たたけば同じことができます。
 *   ですから、断る理由は全部 lib/server/adminManage.ts にあります。
 *
 *       ・自分の権限は下げられない
 *       ・自分を止められない
 *       ・最後の管理者は、降格も停止もできない
 *       ・他社の担当者は、そもそも見つからない
 *
 *   ここで押せなくしているのは、
 *   「押してから断られる」より「押す前に気づける」ほうが親切だからです。
 *   守りだと思って、こちらだけを直さないでください。
 *
 * ═══════════════════════════════════════════════════════
 * ★手順を分けること
 * ═══════════════════════════════════════════════════════
 *
 *       ① 誰に対してかを、名前とメールで見せる
 *       ② 何をどう変えるかを、変える前と後で並べて見せる
 *       ③ なぜ変えるのかを、書いてもらう
 *       ④ 認証アプリの6桁を、いま入れ直してもらう
 *       ⑤ 何が起きるかを読んでから、実行を押してもらう
 *
 *   ★④を省略しないこと。
 *     席を外した隙に、開いたままの画面から
 *     共犯者を管理者に格上げできるようになります。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";
import { ROLE_LABEL, ROLE_ORDER, type Role } from "@/lib/permissions";
import { Badge, Btn, Card, Field, KV, RowCard, Rows, Table, Td, inputClass } from "./ui";

type Admin = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  awaitingTempPassword: boolean;
  tempPasswordExpiresAt: string | null;
  tempPasswordExpired: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  isMe: boolean;
  isLastSuperAdmin: boolean;
};

/** いま何をしようとしているか */
type Mode = "ROLE" | "SUSPEND";

/** いまどの段にいるか */
type Step = "LIST" | "PICK" | "REASON" | "CODE" | "CONFIRM" | "DONE";

const MIN_REASON = 4;

/** 役割の強さ。下げるときだけ、自分自身を止めます */
const TSUYOSA: Record<Role, number> = {
  VIEWER: 1,
  SUPPORT: 2,
  OPERATOR: 3,
  FINANCE: 4,
  SECURITY: 5,
  SUPER_ADMIN: 6,
};

/** 役割の一言説明。役割名だけでは、何を任せるのか決められません */
const ROLE_NOTE: Record<Role, string> = {
  VIEWER: "見るだけ。何も変えられません。",
  SUPPORT: "問い合わせの対応。お金は動かせません。",
  OPERATOR: "ガチャと発送の毎日の運営。",
  FINANCE: "ポイントの承認ができます。お金に触ります。",
  SECURITY: "不正と監査を見ます。会員を止められます。",
  SUPER_ADMIN: "全部できます。他の人の権限も変えられます。",
};

function nichiji(v: string | null): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** その人が、いまどういう状態か。1行で言い切る */
function jotai(a: Admin): { label: string; tone: "neutral" | "ok" | "warn" | "danger" } {
  if (a.status !== "ACTIVE") return { label: "停止中", tone: "danger" };
  if (a.lockedUntil && Date.parse(a.lockedUntil) > Date.now())
    return { label: "締め出し中", tone: "danger" };
  if (a.awaitingTempPassword && a.tempPasswordExpired)
    return { label: "仮パスワード期限切れ", tone: "danger" };
  if (a.awaitingTempPassword) return { label: "仮パスワード発行済み", tone: "warn" };
  if (!a.mfaEnabled) return { label: "認証アプリ未登録", tone: "warn" };
  return { label: "通常", tone: "ok" };
}

/**
 * 権限を変えられない理由。押せないなら、必ず理由を言うこと。
 *
 * ★null を返したときだけ押せます。
 *   「なぜか押せない」を作らないでください。
 *   理由が分からないと、人はDBを直接さわりに行きます。
 */
function roleNG(a: Admin): string | null {
  if (a.isMe) return "ご自身の権限は、この画面からは変えられません。";
  if (a.isLastSuperAdmin)
    return "いま使える管理者（全権）が、この方だけです。降格すると、誰も権限を戻せなくなります。";
  return null;
}

/** 止められない理由 */
function suspendNG(a: Admin): string | null {
  if (a.isMe) return "ご自身は止められません。止めると、その場で締め出されます。";
  if (a.isLastSuperAdmin)
    return "いま使える管理者（全権）が、この方だけです。止めると、誰も入れなくなります。";
  return null;
}

export default function AdminsPanel() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [mode, setMode] = useState<Mode>("ROLE");
  const [step, setStep] = useState<Step>("LIST");
  const [target, setTarget] = useState<Admin | null>(null);
  const [newRole, setNewRole] = useState<Role | "">("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/console/admins", { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; admins?: Admin[]; message?: string };
      if (!res.ok || !data.ok) {
        setLoadError(data.message ?? "担当者の一覧を読み込めませんでした。");
        setAdmins([]);
        return;
      }
      setAdmins(data.admins ?? []);
    } catch {
      setLoadError("通信できませんでした。画面を開き直してください。");
      setAdmins([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function modoru() {
    setStep("LIST");
    setTarget(null);
    setNewRole("");
    setReason("");
    setCode("");
    setError("");
    setDone("");
  }

  function hajimeru(a: Admin, m: Mode) {
    setMode(m);
    setTarget(a);
    setNewRole("");
    setReason("");
    setCode("");
    setError("");
    setDone("");
    setStep(m === "ROLE" ? "PICK" : "REASON");
  }

  /* ── ④ 6桁を、いま入れ直す ───────────────── */
  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/step-up", {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "6桁の数字を確かめられませんでした。");
        return;
      }
      setCode("");
      setStep("CONFIRM");
    } catch {
      setError("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  /* ── ⑤ 実行する ───────────────────────────── */
  async function jikkou() {
    if (!target) return;
    setBusy(true);
    setError("");

    const suspending = target.status === "ACTIVE";
    const url =
      mode === "ROLE" ? "/api/console/admins/role" : "/api/console/admins/suspend";
    const body =
      mode === "ROLE"
        ? { adminId: target.id, role: newRole, reason: reason.trim() }
        : { adminId: target.id, suspend: suspending, reason: reason.trim() };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        note?: string;
        targetName?: string;
        before?: string;
        after?: string;
        status?: string;
      };

      if (!res.ok || !data.ok) {
        /* ★6桁が古くなっていたら、その段まで戻すこと。
             「失敗しました」で終わると、次に何をすればよいか分かりません */
        if (data.code === "FRESH_STEP_UP_REQUIRED" || data.code === "STEP_UP_REQUIRED") {
          setStep("CODE");
          setError(data.message ?? "6桁の数字を、もう一度ご入力ください。");
          return;
        }
        setError(data.message ?? "実行できませんでした。");
        return;
      }

      setDone(
        mode === "ROLE"
          ? `${data.targetName ?? target.name} さんの権限を、${
              ROLE_LABEL[(data.before ?? "") as Role] ?? data.before
            } から ${ROLE_LABEL[(data.after ?? "") as Role] ?? data.after} に変えました。${data.note ?? ""}`
          : `${data.targetName ?? target.name} さんを${
              suspending ? "止めました" : "元に戻しました"
            }。${data.note ?? ""}`,
      );
      setStep("DONE");
      void load();
    } catch {
      setError("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  /* ══════════════════════════════════════════════
     終わったあと
     ══════════════════════════════════════════════ */
  if (step === "DONE") {
    return (
      <Card title="担当者の管理" note="変更しました。">
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-5 py-5">
          <p className="text-note font-bold leading-[1.9] text-ok-ink">{done}</p>
        </div>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★この操作は、あなたのお名前と理由つきで監査ログに残りました。
          「監査ログ」の画面から、いつでも読み返せます。
        </p>
        <div className="mt-5">
          <Btn kind="primary" onClick={modoru}>
            一覧へ戻る
          </Btn>
        </div>
      </Card>
    );
  }

  /* ══════════════════════════════════════════════
     ①〜⑤ 手順
     ══════════════════════════════════════════════ */
  if (step !== "LIST" && target) {
    const st = jotai(target);
    const ima = (ROLE_LABEL[target.role as Role] ?? target.role) as string;
    const suspending = target.status === "ACTIVE";
    const title = mode === "ROLE" ? "権限を変える" : suspending ? "利用を止める" : "停止を解除する";

    const junjo: Step[] = mode === "ROLE"
      ? ["PICK", "REASON", "CODE", "CONFIRM"]
      : ["REASON", "CODE", "CONFIRM"];
    const ima_dan = junjo.indexOf(step) + 1;

    return (
      <Card
        title={title}
        note={`${ima_dan}／${junjo.length}　${
          step === "PICK"
            ? "新しい権限を選ぶ"
            : step === "REASON"
              ? "理由のご記入"
              : step === "CODE"
                ? "認証アプリの6桁"
                : "最終確認"
        }`}
        right={
          <Btn onClick={modoru} kind="ghost">
            やめる
          </Btn>
        }
      >
        {/* ── ① 誰に対してか（どの段でも、常に出しておく） ── */}
        <div className="rounded-xl border border-edge2 bg-paper2 px-5 py-4">
          <p className="text-note font-bold text-slate2">この方が対象です</p>
          <div className="mt-2">
            <KV k="お名前" v={<span className="font-bold text-slate">{target.name}</span>} />
            <KV k="メール" v={<span className="num">{target.email}</span>} />
            <KV k="いまの権限" v={ima} />
            <KV k="いまの状態" v={<Badge tone={st.tone}>{st.label}</Badge>} />
          </div>
        </div>

        {/* ── ② 新しい権限を選ぶ ── */}
        {step === "PICK" && (
          <div className="mt-5">
            <p className="text-note font-bold text-slate2">新しい権限</p>
            <ul className="mt-3 space-y-2">
              {ROLE_ORDER.map((r) => {
                const onaji = r === (target.role as Role);
                return (
                  <li key={r}>
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${
                        newRole === r
                          ? "border-blue-ink/40 bg-blue-pale/40"
                          : "border-edge bg-paper"
                      } ${onaji ? "opacity-50" : ""}`}
                    >
                      <input
                        type="radio"
                        name="newRole"
                        className="mt-1"
                        checked={newRole === r}
                        disabled={onaji}
                        onChange={() => setNewRole(r)}
                      />
                      <span>
                        <span className="text-note font-bold text-slate">
                          {ROLE_LABEL[r]}
                          {onaji && (
                            <span className="ml-2 font-normal text-slate3">（いまと同じ）</span>
                          )}
                        </span>
                        <span className="mt-1 block text-note leading-[1.85] text-slate3">
                          {ROLE_NOTE[r]}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {/*
              ★格上げのときだけ、はっきり警告すること。
                降格は「できることが減る」だけですが、
                格上げは「できることが増える」ので、
                間違えたときの被害が桁違いに大きくなります。
            */}
            {newRole !== "" && TSUYOSA[newRole] > TSUYOSA[(target.role as Role) ?? "VIEWER"] && (
              <div className="mt-4 rounded-xl border border-warn/35 bg-warn/12 px-5 py-4">
                <p className="text-note font-bold leading-[1.85] text-warn-ink">
                  これは、できることを増やす変更です
                </p>
                <p className="mt-2 text-note leading-[1.9] text-slate2">
                  {newRole === "SUPER_ADMIN"
                    ? "管理者（全権）にすると、ポイントの承認も、ガチャの公開も、他の人の権限変更も、すべてできるようになります。この方が退職されるときは、必ずこの画面から止めてください。"
                    : `${ROLE_LABEL[newRole]} は、いまより広い範囲に触れるようになります。ご本人が必要とされている作業だけで足りるかを、もう一度ご確認ください。`}
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Btn
                kind="primary"
                disabled={newRole === ""}
                onClick={() => {
                  setError("");
                  setStep("REASON");
                }}
              >
                次へ（理由の記入）
              </Btn>
              <Btn onClick={modoru}>やめる</Btn>
            </div>
          </div>
        )}

        {/* ── ③ 理由 ── */}
        {step === "REASON" && (
          <div className="mt-5 max-w-xl">
            {mode === "ROLE" && newRole !== "" && (
              <div className="mb-4 rounded-xl border border-edge bg-paper px-4 py-3">
                <KV k="変える前" v={ima} />
                <KV
                  k="変えたあと"
                  v={<span className="font-bold text-slate">{ROLE_LABEL[newRole]}</span>}
                />
              </div>
            )}

            {/*
              ★解除にも理由を書かせること。
                止めるより、戻すほうが危ない場面があります。
                「間違えて止めた」のか「話がついたので戻す」のかは、
                あとから記録を読む人には分かりません。
            */}
            <Field
              label={
                mode === "ROLE"
                  ? "権限を変える理由"
                  : suspending
                    ? "止める理由"
                    : "解除する理由"
              }
              note="あとから記録を読む人が、いちばん知りたいところです。4文字以上でご記入ください。"
              required
            >
              <input
                className={inputClass}
                value={reason}
                maxLength={120}
                placeholder={
                  mode === "ROLE"
                    ? "例：発送担当になったため／異動により経理を外れる"
                    : suspending
                      ? "例：本日付で退職／不審なログインの調査中"
                      : "例：誤って停止したため／復職"
                }
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <p className="mt-3 text-note leading-[1.9] text-slate3">
              ★ここに書いた内容は、操作の記録に残ります。
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Btn
                kind="primary"
                disabled={reason.trim().length < MIN_REASON}
                onClick={() => {
                  setError("");
                  setStep("CODE");
                }}
              >
                次へ（本人確認）
              </Btn>
              <Btn onClick={() => (mode === "ROLE" ? setStep("PICK") : modoru())}>
                {mode === "ROLE" ? "戻る" : "やめる"}
              </Btn>
            </div>
          </div>
        )}

        {/* ── ④ 6桁 ── */}
        {step === "CODE" && (
          <div className="mt-5 max-w-xl">
            <div className="rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-4">
              <p className="text-note leading-[1.9] text-slate2">
                ログインのときに入れた6桁は、ここでは使いません。
                いま認証アプリに出ている数字を、あらためて入れてください。
                <br />
                <span className="text-slate3">
                  ★席を外している間に、開いたままの画面から実行されるのを防ぐためです。
                </span>
              </p>
            </div>
            <div className="mt-4">
              <Field label="認証アプリの6桁" required>
                <input
                  className={`${inputClass} num tracking-[0.4em]`}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            {error && (
              <p className="mt-3 text-note font-bold leading-[1.85] text-danger-ink" role="alert">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <Btn kind="primary" disabled={code.length !== 6 || busy} onClick={() => void sendCode()}>
                {busy ? "確認しています…" : "確認する"}
              </Btn>
              <Btn onClick={() => setStep("REASON")}>戻る</Btn>
            </div>
          </div>
        )}

        {/* ── ⑤ 実行確認 ── */}
        {step === "CONFIRM" && (
          <div className="mt-5">
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-5 py-5">
              <p className="text-note font-bold leading-[1.85] text-danger-ink">
                実行すると、次のことが起こります
              </p>
              <ul className="mt-3 space-y-2 text-note leading-[1.9] text-slate2">
                {mode === "ROLE" ? (
                  <>
                    <li>
                      ・{target.name} さんの権限が {ima} から{" "}
                      {newRole === "" ? "" : ROLE_LABEL[newRole]} に変わります
                    </li>
                    <li>・次の操作から、すぐに効きます。ログインし直す必要はありません</li>
                    <li>・開いている画面は閉じません（作業中でも切れません）</li>
                    <li>・この操作は、あなたのお名前と理由つきで記録に残ります</li>
                  </>
                ) : suspending ? (
                  <>
                    <li>・{target.name} さんは、次の1回からログインできなくなります</li>
                    <li>
                      ・いま開いている管理画面は、すべて閉じられます（作業中でも切れます）
                    </li>
                    <li>・アカウントは消えません。あとから、この画面で解除できます</li>
                    <li>・この操作は、あなたのお名前と理由つきで記録に残ります</li>
                  </>
                ) : (
                  <>
                    <li>・{target.name} さんは、また入れるようになります</li>
                    <li>・権限は、止める前のままです（変わりません）</li>
                    <li>・この操作は、あなたのお名前と理由つきで記録に残ります</li>
                  </>
                )}
              </ul>
            </div>

            <div className="mt-4">
              <KV k="理由" v={reason} />
              <KV k="実行する人" v="あなた（いま6桁で確認済み）" />
            </div>

            {error && (
              <p className="mt-4 text-note font-bold leading-[1.85] text-danger-ink" role="alert">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Btn kind="danger" disabled={busy} onClick={() => void jikkou()}>
                {busy
                  ? "実行しています…"
                  : mode === "ROLE"
                    ? "この内容で権限を変える"
                    : suspending
                      ? "この内容で止める"
                      : "この内容で解除する"}
              </Btn>
              <Btn onClick={modoru}>やめる</Btn>
            </div>
          </div>
        )}
      </Card>
    );
  }

  /* ══════════════════════════════════════════════
     一覧
     ══════════════════════════════════════════════ */
  const ikiteru = (admins ?? []).filter(
    (a) => a.role === "SUPER_ADMIN" && a.status === "ACTIVE",
  ).length;

  return (
    <Card
      title="担当者の管理"
      note="権限を変える・利用を止める。どちらも理由と、認証アプリの6桁が要ります。"
      right={
        <Btn onClick={() => void load()} kind="ghost">
          最新にする
        </Btn>
      }
    >
      <div className="rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-4">
        <p className="text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-slate">退職された方は、必ずここで止めてください。</strong>
          止めると、その方が開いている画面もその場で閉じられます。
          アカウントは消えないので、記録は残ります。
          <br />
          ご自身の権限を下げること、ご自身を止めることはできません。
          最後の管理者（全権）も、降格・停止できません。
        </p>
      </div>

      {loadError && (
        <p className="mt-4 text-note font-bold leading-[1.85] text-danger-ink" role="alert">
          {loadError}
        </p>
      )}

      {/*
        ★管理者（全権）が1人しかいない状態を、先に伝えること。
          その1人がスマートフォンを失くした日に、会社ごと締め出されます。
          止められてから言っても、もう手遅れです。
      */}
      {admins !== null && ikiteru <= 1 && (
        <div className="mt-4 rounded-xl border border-warn/35 bg-warn/12 px-5 py-4">
          <p className="text-note font-bold leading-[1.85] text-warn-ink">
            いま使える管理者（全権）が {ikiteru}名 です
          </p>
          <p className="mt-2 text-note leading-[1.9] text-slate2">
            この方が認証アプリを失くされると、誰も権限を戻せなくなります。
            もう1名、管理者（全権）をご登録ください。
          </p>
        </div>
      )}

      {admins === null ? (
        <p className="mt-5 text-note text-slate3">読み込んでいます…</p>
      ) : admins.length === 0 ? (
        <p className="mt-5 text-note text-slate3">担当者が見つかりませんでした。</p>
      ) : (
        <div className="mt-5">
          <Table head={["お名前", "権限", "状態", "2段階認証", "最終ログイン", ""]}>
            {admins.map((a) => {
              const st = jotai(a);
              const rNG = roleNG(a);
              const sNG = suspendNG(a);
              const tomeru = a.status === "ACTIVE";
              return (
                <tr key={a.id}>
                  <Td>
                    <span className="font-bold text-slate">{a.name}</span>
                    {a.isMe && <span className="ml-2 text-slate3">（あなた）</span>}
                    <br />
                    <span className="num text-slate3">{a.email}</span>
                  </Td>
                  <Td>{ROLE_LABEL[a.role as Role] ?? a.role}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={a.mfaEnabled ? "ok" : "warn"}>
                      {a.mfaEnabled ? "設定済み" : "未設定"}
                    </Badge>
                  </Td>
                  <Td className="num whitespace-nowrap">{nichiji(a.lastLoginAt)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Btn
                        disabled={rNG !== null}
                        title={rNG ?? undefined}
                        onClick={() => hajimeru(a, "ROLE")}
                      >
                        権限を変える
                      </Btn>
                      <Btn
                        kind={tomeru ? "danger" : "normal"}
                        disabled={sNG !== null}
                        title={sNG ?? undefined}
                        onClick={() => hajimeru(a, "SUSPEND")}
                      >
                        {tomeru ? "利用を止める" : "停止を解除"}
                      </Btn>
                    </div>
                    {(rNG ?? sNG) && (
                      <p className="mt-2 text-note leading-[1.7] text-slate3">{rNG ?? sNG}</p>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>

          <Rows>
            {admins.map((a) => {
              const st = jotai(a);
              const rNG = roleNG(a);
              const sNG = suspendNG(a);
              const tomeru = a.status === "ACTIVE";
              return (
                <RowCard key={a.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-note font-bold text-slate">
                      {a.name}
                      {a.isMe && <span className="ml-2 font-normal text-slate3">（あなた）</span>}
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="メール" v={<span className="num">{a.email}</span>} />
                    <KV k="権限" v={ROLE_LABEL[a.role as Role] ?? a.role} />
                    <KV
                      k="2段階認証"
                      v={
                        <Badge tone={a.mfaEnabled ? "ok" : "warn"}>
                          {a.mfaEnabled ? "設定済み" : "未設定"}
                        </Badge>
                      }
                    />
                    <KV k="最終ログイン" v={<span className="num">{nichiji(a.lastLoginAt)}</span>} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <Btn full disabled={rNG !== null} onClick={() => hajimeru(a, "ROLE")}>
                      権限を変える
                    </Btn>
                    <Btn
                      full
                      kind={tomeru ? "danger" : "normal"}
                      disabled={sNG !== null}
                      onClick={() => hajimeru(a, "SUSPEND")}
                    >
                      {tomeru ? "利用を止める" : "停止を解除"}
                    </Btn>
                    {(rNG ?? sNG) && (
                      <p className="text-note leading-[1.7] text-slate3">{rNG ?? sNG}</p>
                    )}
                  </div>
                </RowCard>
              );
            })}
          </Rows>
        </div>
      )}

      {/*
        ★この一覧は、本物のデータです。
          この画面の他の項目（見本の数字）と混ぜて読まれないよう、
          はっきり書いておきます。
      */}
      <p className="mt-6 border-t border-edge pt-4 text-note leading-[1.9] text-slate3">
        ★この一覧は、実際に登録されている担当者です（見本ではありません）。
        他社の担当者は、ここには出ません。
        権限の変更・停止・解除は、すべて監査ログに残ります。
      </p>
    </Card>
  );
}
