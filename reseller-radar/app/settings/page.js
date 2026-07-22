"use client";

import { useEffect, useState } from "react";
import { PLANS, PLAN_LABELS, dealLimitLabel } from "@/lib/plans";

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [notice, setNotice] = useState(null);

  async function load() {
    const res = await fetch("/api/settings");
    setS(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  function set(k, v) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function save(e) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    if (res.ok) {
      setNotice({ msg: "設定を保存しました。" });
      load();
    } else {
      setNotice({ err: true, msg: "保存に失敗しました。" });
    }
  }

  if (!s) return <div className="empty">読み込み中…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>設定</h1>
      </div>

      {notice && (
        <div className={"notice" + (notice.err ? " err" : "")}>{notice.msg}</div>
      )}

      <form onSubmit={save}>
        <div className="card">
          <strong>ご利用プラン</strong>
          <div className="field" style={{ marginTop: 12 }}>
            <label>プラン</label>
            <div className="seg">
              {PLANS.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={(s.plan || "free") === p ? "on" : ""}
                  onClick={() => set("plan", p)}
                >
                  {PLAN_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>
            1回の巡回で表示される利益商品の上限：
            {dealLimitLabel(s.plan || "free")}
            （フリー=1件 / スタンダード=10件 / プロ=無制限）
          </p>
        </div>

        <div className="card">
          <strong>Amazon照合（Keepa）</strong>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Keepa APIキー</label>
            <input
              type="password"
              value={s.keepa_key || ""}
              onChange={(e) => set("keepa_key", e.target.value)}
              placeholder="keepa.com で取得（有料）"
            />
          </div>
        </div>

        <div className="card">
          <strong>メール通知（SMTP）</strong>
          <div className="field" style={{ marginTop: 12 }}>
            <label>通知先メールアドレス</label>
            <input
              type="email"
              value={s.notify_email || ""}
              onChange={(e) => set("notify_email", e.target.value)}
            />
          </div>
          <div className="grid2">
            <div className="field">
              <label>SMTPホスト</label>
              <input
                type="text"
                value={s.smtp_host || ""}
                onChange={(e) => set("smtp_host", e.target.value)}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div className="field">
              <label>SMTPポート</label>
              <input
                type="number"
                value={s.smtp_port || ""}
                onChange={(e) => set("smtp_port", e.target.value)}
              />
            </div>
            <div className="field">
              <label>SMTPユーザー</label>
              <input
                type="text"
                value={s.smtp_user || ""}
                onChange={(e) => set("smtp_user", e.target.value)}
              />
            </div>
            <div className="field">
              <label>SMTPパスワード</label>
              <input
                type="password"
                value={s.smtp_pass || ""}
                onChange={(e) => set("smtp_pass", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <strong>手数料・利益計算</strong>
          <div className="field" style={{ marginTop: 12 }}>
            <label>手数料の扱い</label>
            <div className="seg">
              <button
                type="button"
                className={s.include_fees === "1" ? "on" : ""}
                onClick={() => set("include_fees", "1")}
              >
                手数料を含める
              </button>
              <button
                type="button"
                className={s.include_fees === "0" ? "on" : ""}
                onClick={() => set("include_fees", "0")}
              >
                含めない
              </button>
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>販売手数料率（%）</label>
              <input
                type="number"
                value={s.referral_rate || ""}
                onChange={(e) => set("referral_rate", e.target.value)}
              />
            </div>
            <div className="field">
              <label>FBA配送代行料（円）</label>
              <input
                type="number"
                value={s.fba_fee || ""}
                onChange={(e) => set("fba_fee", e.target.value)}
              />
            </div>
            <div className="field">
              <label>自己発送送料（円）</label>
              <input
                type="number"
                value={s.self_ship_fee || ""}
                onChange={(e) => set("self_ship_fee", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <strong>自動巡回</strong>
          <div className="field" style={{ marginTop: 12, maxWidth: 200 }}>
            <label>巡回時刻（0〜23時）</label>
            <input
              type="number"
              min="0"
              max="23"
              value={s.cron_hour || ""}
              onChange={(e) => set("cron_hour", e.target.value)}
            />
          </div>
          <p style={{ color: "#6b7280", fontSize: 13 }}>
            この時刻に毎日1回、全タスクを自動巡回します（cronデーモン起動時）。
          </p>
        </div>

        <button className="btn" type="submit">
          設定を保存
        </button>
      </form>
    </div>
  );
}
