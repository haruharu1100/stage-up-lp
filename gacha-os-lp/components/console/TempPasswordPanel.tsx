/**
 * 仮パスワードの再発行（担当者の一覧つき）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ「押したら発行」にしないのか
 * ═══════════════════════════════════════════════════════
 *
 *   この操作は、相手のパスワードを、こちらが知っている値に
 *   置き換えます。つまり、その人として入れるようになります。
 *   同時に、その人のログインは全部切れます。
 *
 *   これを1回のクリックで起こせる画面にすると、
 *   「一覧の並びが変わっていたことに気づかず、隣の行を押した」
 *   だけで、無関係の人が仕事の途中で締め出されます。
 *
 *   ですから、次の5つに分けます。
 *
 *       ① 誰に出すのかを、名前とメールで見せて確かめる
 *       ② なぜ出すのかを、書いてもらう
 *       ③ 認証アプリの6桁を、いま入れ直してもらう
 *       ④ 何が起きるかを読んでから、実行を押してもらう
 *       ⑤ 発行し、1回だけ表示する
 *
 *   ★③を「ログインのときに通したから省略」にしないこと。
 *     朝ログインした画面が昼まで開いているのは、ふつうの運用です。
 *     その画面の前にいるのが本人だとは、誰も言えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★確認用（デモ）と、本番の違いを、画面に書くこと
 * ═══════════════════════════════════════════════════════
 *
 *   いまは、発行した文字列をこの画面に1回だけ出します。
 *   確認用としては、これがいちばん分かりやすいからです。
 *
 *   ただし本番では、画面に出すのは望ましくありません。
 *   肩越しに見られますし、画面の写真がそのまま鍵になります。
 *   本番では、本人のメールやSMSへ直接渡す形にします。
 *   その差を、画面にはっきり書いておきます。
 *   書かないと「本番でもこう出るもの」と受け取られます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";
import { ROLE_LABEL, type Role } from "@/lib/permissions";
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
};

/** これまでの発行の記録（監査ログから読んだもの） */
type Rireki = {
  at: string;
  byName: string;
  byRole: string;
  summary: string;
  reason: string;
};

/** いまどの段にいるか */
type Step = "LIST" | "REASON" | "CODE" | "CONFIRM" | "DONE";

const MIN_REASON = 4;

/** 日時を、日本語で読める形にする（秒までは要らない） */
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

export default function TempPasswordPanel() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [loadError, setLoadError] = useState("");

  /*
   * ★これまでの発行の記録。
   *
   *   記録は監査ログに残っています。ただ、残しただけでは誰も読みません。
   *   読まれない記録は、無いのと同じです。
   *   押した人が押した直後に見える場所へ置くと、
   *   身に覚えのない発行が並んだときに、いちばん早く気づけます。
   */
  const [rireki, setRireki] = useState<Rireki[] | null>(null);

  const [step, setStep] = useState<Step>("LIST");
  const [target, setTarget] = useState<Admin | null>(null);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* 発行できたときだけ入る。★保存しないこと（再表示できません） */
  const [issued, setIssued] = useState<{ password: string; expiresAt: string } | null>(null);

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

  const loadRireki = useCallback(async () => {
    try {
      const res = await fetch("/api/console/admins/temp-password", {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok?: boolean; history?: Rireki[] };
      /* ★ここが読めなくても、発行そのものは止めないこと。
           記録が見えないことと、発行できないことは、別の話です */
      setRireki(res.ok && data.ok ? (data.history ?? []) : []);
    } catch {
      setRireki([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRireki();
  }, [load, loadRireki]);

  function modoru() {
    setStep("LIST");
    setTarget(null);
    setReason("");
    setCode("");
    setError("");
    setIssued(null);
  }

  /* ── ③ 6桁を、いま入れ直す ───────────────── */
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

  /* ── ⑤ 発行する ───────────────────────────── */
  async function issue() {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/console/admins/temp-password", {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ adminId: target.id, reason: reason.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        code?: string;
        password?: string;
        expiresAt?: string;
      };

      if (!res.ok || !data.ok) {
        /* ★6桁が古くなっていたら、その段まで戻すこと。
             「失敗しました」で終わると、次に何をすればよいか分かりません */
        if (data.code === "FRESH_STEP_UP_REQUIRED" || data.code === "STEP_UP_REQUIRED") {
          setStep("CODE");
          setError(data.message ?? "6桁の数字を、もう一度ご入力ください。");
          return;
        }
        setError(data.message ?? "発行できませんでした。");
        return;
      }

      setIssued({
        password: String(data.password ?? ""),
        expiresAt: String(data.expiresAt ?? ""),
      });
      setStep("DONE");
      void load();
      void loadRireki();
    } catch {
      setError("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  /* ══════════════════════════════════════════════
     ⑤ 発行できた
     ══════════════════════════════════════════════ */
  if (step === "DONE" && issued && target) {
    return (
      <Card title="仮パスワードを発行しました" note="この画面を閉じると、二度と表示できません。">
        <div className="rounded-xl border border-warn/35 bg-warn/12 px-5 py-5">
          <p className="text-note font-bold leading-[1.85] text-warn-ink">
            いま、控えてください
          </p>
          <p className="mt-2 text-note leading-[1.9] text-slate2">
            この文字列は、どこにも保存していません。
            もう一度表示することはできません。
          </p>
          <p className="num mt-4 select-all break-all rounded-xl border border-edge bg-paper px-4 py-4 text-[1.25rem] font-bold tracking-wider text-slate">
            {issued.password}
          </p>
        </div>

        <div className="mt-5">
          <KV k="お渡しする相手" v={`${target.name}（${target.email}）`} />
          <KV k="使える期限" v={<span className="num">{nichiji(issued.expiresAt)}</span>} />
          <KV k="回数" v="1回だけ。ログインに使った時点で無効になります" />
        </div>

        <div className="mt-5 rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-5">
          <p className="text-note font-bold text-slate">本番では、この画面に出しません</p>
          <p className="mt-2 text-note leading-[1.9] text-slate2">
            いまは、動作を確かめていただくために画面へ出しています。
            本番では、ご本人のメールまたはSMSへ直接お送りする形にします。
            画面に出す方式は、肩越しに見られる／画面の写真がそのまま鍵になる、
            という2つの弱点があるためです。
          </p>
        </div>

        <p className="mt-5 text-note leading-[1.9] text-slate3">
          ★チャットに貼らないでください。チャットは、あとから全員が読み返せます。
          お電話か、対面でお伝えください。
        </p>

        <div className="mt-5">
          <Btn onClick={modoru} kind="primary">
            控えました。一覧へ戻る
          </Btn>
        </div>
      </Card>
    );
  }

  /* ══════════════════════════════════════════════
     ①〜④ 手順
     ══════════════════════════════════════════════ */
  if (step !== "LIST" && target) {
    const st = jotai(target);
    return (
      <Card
        title="仮パスワードの再発行"
        note={
          step === "REASON"
            ? "1／3　お相手の確認と、理由のご記入"
            : step === "CODE"
              ? "2／3　認証アプリの6桁"
              : "3／3　最終確認"
        }
        right={<Btn onClick={modoru} kind="ghost">やめる</Btn>}
      >
        {/* ── ① 対象ユーザー確認（どの段でも、常に出しておく） ── */}
        <div className="rounded-xl border border-edge2 bg-paper2 px-5 py-4">
          <p className="text-note font-bold text-slate2">この方に発行します</p>
          <div className="mt-2">
            <KV k="お名前" v={<span className="font-bold text-slate">{target.name}</span>} />
            <KV k="メール" v={<span className="num">{target.email}</span>} />
            <KV k="役割" v={ROLE_LABEL[target.role as Role] ?? target.role} />
            <KV k="いまの状態" v={<Badge tone={st.tone}>{st.label}</Badge>} />
          </div>
        </div>

        {target.awaitingTempPassword && !target.tempPasswordExpired && (
          <div className="mt-4 rounded-xl border border-warn/35 bg-warn/12 px-5 py-4">
            <p className="text-note font-bold leading-[1.85] text-warn-ink">
              この方には、すでに仮パスワードを発行済みです
            </p>
            <p className="mt-2 text-note leading-[1.9] text-slate2">
              いま発行すると、前にお渡ししたものは、その瞬間に使えなくなります。
              お手元で入力中の場合、その入力は通らなくなります。
              期限は {nichiji(target.tempPasswordExpiresAt)} までです。
            </p>
          </div>
        )}

        {/* ── ② 理由 ── */}
        {step === "REASON" && (
          <div className="mt-5 max-w-xl">
            <Field
              label="発行する理由"
              note="あとから記録を読む人が、いちばん知りたいところです。4文字以上でご記入ください。"
              required
            >
              <input
                className={inputClass}
                value={reason}
                maxLength={120}
                placeholder="例：入社のため／パスワードを忘れたと本人から電話"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <p className="mt-3 text-note leading-[1.9] text-slate3">
              ★ここに書いた内容は、操作の記録に残ります。パスワードそのものは残りません。
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
              <Btn onClick={modoru}>やめる</Btn>
            </div>
          </div>
        )}

        {/* ── ③ 6桁 ── */}
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

        {/* ── ④ 実行確認 ── */}
        {step === "CONFIRM" && (
          <div className="mt-5">
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-5 py-5">
              <p className="text-note font-bold leading-[1.85] text-danger-ink">
                実行すると、次のことが同時に起こります
              </p>
              <ul className="mt-3 space-y-2 text-note leading-[1.9] text-slate2">
                <li>・{target.name} さんの、いまのパスワードが使えなくなります</li>
                <li>・{target.name} さんが開いている管理画面は、すべて閉じられます（作業中でも切れます）</li>
                <li>・次にログインしたとき、パスワードの変更と認証アプリの登録を求めます</li>
                <li>・この操作は、あなたのお名前と理由つきで記録に残ります</li>
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
              <Btn kind="danger" disabled={busy} onClick={() => void issue()}>
                {busy ? "発行しています…" : "この内容で発行する"}
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
  return (
    <Card
      title="仮パスワードの再発行"
      note="入れなくなった担当者に、期限つき・1回きりのパスワードをお渡しします。"
      right={<Btn onClick={() => void load()} kind="ghost">最新にする</Btn>}
    >
      <div className="rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-4">
        <p className="text-note leading-[1.9] text-slate2">
          発行すると、その方の<strong className="font-bold text-slate">いまのログインは全部切れます</strong>。
          お渡しした仮パスワードは <strong className="font-bold text-slate">72時間・1回きり</strong> です。
          <br />
          ご自身には発行できません（自分を締め出すだけで、得るものが無いためです）。
        </p>
      </div>

      {loadError && (
        <p className="mt-4 text-note font-bold leading-[1.85] text-danger-ink" role="alert">
          {loadError}
        </p>
      )}

      {admins === null ? (
        <p className="mt-5 text-note text-slate3">読み込んでいます…</p>
      ) : admins.length === 0 ? (
        <p className="mt-5 text-note text-slate3">担当者が見つかりませんでした。</p>
      ) : (
        <div className="mt-5">
          <Table head={["お名前", "役割", "いまの状態", "最終ログイン", ""]}>
            {admins.map((a) => {
              const st = jotai(a);
              return (
                <tr key={a.id}>
                  <Td>
                    <span className="font-bold text-slate">{a.name}</span>
                    <br />
                    <span className="num text-slate3">{a.email}</span>
                  </Td>
                  <Td>{ROLE_LABEL[a.role as Role] ?? a.role}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td className="num whitespace-nowrap">{nichiji(a.lastLoginAt)}</Td>
                  <Td>
                    <Btn
                      disabled={a.isMe}
                      title={a.isMe ? "ご自身には発行できません" : undefined}
                      onClick={() => {
                        setTarget(a);
                        setReason("");
                        setCode("");
                        setError("");
                        setStep("REASON");
                      }}
                    >
                      {a.isMe ? "自分には出せません" : "仮パスワードを再発行"}
                    </Btn>
                  </Td>
                </tr>
              );
            })}
          </Table>

          <Rows>
            {admins.map((a) => {
              const st = jotai(a);
              return (
                <RowCard key={a.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-note font-bold text-slate">{a.name}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="メール" v={<span className="num">{a.email}</span>} />
                    <KV k="役割" v={ROLE_LABEL[a.role as Role] ?? a.role} />
                    <KV k="最終ログイン" v={<span className="num">{nichiji(a.lastLoginAt)}</span>} />
                  </div>
                  <div className="mt-3">
                    <Btn
                      full
                      disabled={a.isMe}
                      onClick={() => {
                        setTarget(a);
                        setReason("");
                        setCode("");
                        setError("");
                        setStep("REASON");
                      }}
                    >
                      {a.isMe ? "自分には出せません" : "仮パスワードを再発行"}
                    </Btn>
                  </div>
                </RowCard>
              );
            })}
          </Rows>
        </div>
      )}

      {/*
        ── これまでの発行の記録 ─────────────────
        ★ここは、この画面でいちばん見落とされやすく、
          いちばん大事なところです。

          発行そのものは、権限と6桁と理由で守っています。
          けれど、正しい鍵を持った人が悪いことをする場合、
          入口では止まりません。止められるのは「あとで読まれる」ことだけです。

          だから、押した人の目の前に並べます。
          自分が押していない発行がここに出ていたら、その日のうちに分かります。
      */}
      <div className="mt-8 border-t border-edge pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-note font-bold text-slate">これまでの発行の記録</h4>
          <Btn kind="ghost" onClick={() => void loadRireki()}>
            最新にする
          </Btn>
        </div>
        <p className="mt-2 text-note leading-[1.9] text-slate3">
          ★身に覚えのない発行が並んでいたら、その日のうちにご連絡ください。
          パスワードそのものは、記録にも残していません。
        </p>

        {rireki === null ? (
          <p className="mt-4 text-note text-slate3">読み込んでいます…</p>
        ) : rireki.length === 0 ? (
          <p className="mt-4 text-note text-slate3">
            まだ、発行された記録はありません。
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {rireki.map((r, i) => (
              <li
                key={`${r.at}-${i}`}
                className="rounded-xl border border-edge bg-paper2 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-note font-bold text-slate">{r.summary}</span>
                  <span className="num text-note text-slate3">{nichiji(r.at)}</span>
                </div>
                <p className="mt-1 text-note leading-[1.85] text-slate2">
                  実行した人：{r.byName}
                  {r.byRole ? `（${ROLE_LABEL[r.byRole as Role] ?? r.byRole}）` : ""}
                </p>
                {r.reason && (
                  <p className="mt-1 text-note leading-[1.85] text-slate2">
                    理由：{r.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
