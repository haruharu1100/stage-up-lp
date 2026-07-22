"use client";

import { useEffect, useState } from "react";
import { normalizePlan, planLabel, taskLimit, taskLimitLabel } from "@/lib/plans";

const SHIP = [
  { v: "FBA", label: "FBA" },
  { v: "SELF", label: "自己発送" },
];
const COND = [
  { v: "RATE", label: "利益率のみ" },
  { v: "AMOUNT", label: "利益額のみ" },
  { v: "AND", label: "両方(AND)" },
  { v: "OR", label: "どちらか(OR)" },
];

function condSummary(t) {
  const rate = `利益率 ${t.rate_min}〜${t.rate_max}%`;
  const amt = `利益額 ¥${Number(t.amount_min).toLocaleString()}以上`;
  if (t.cond_pattern === "RATE") return rate;
  if (t.cond_pattern === "AMOUNT") return amt;
  if (t.cond_pattern === "AND") return `${rate} かつ ${amt}`;
  if (t.cond_pattern === "OR") return `${rate} または ${amt}`;
  return rate;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [notice, setNotice] = useState(null);
  const [plan, setPlan] = useState("free");
  const [form, setForm] = useState({
    name: "",
    supplier_id: "",
    url: "",
    ship_method: "FBA",
    cond_pattern: "RATE",
    rate_min: 20,
    rate_max: 100,
    amount_min: 2000,
    monthly_sales_min: 0,
  });

  async function load() {
    const [t, s, cfg] = await Promise.all([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/suppliers").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setTasks(t);
    setSuppliers(s.filter((x) => x.enabled));
    setPlan(normalizePlan(cfg && cfg.plan));
  }

  useEffect(() => {
    load();
  }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // 仕入れ先を選んだら、その仕入れ先に登録されているURLを監視URLへ自動入力
  function selectSupplier(id) {
    const sup = suppliers.find((s) => String(s.id) === String(id));
    setForm((f) => ({
      ...f,
      supplier_id: id,
      url: sup && sup.base_url ? sup.base_url : f.url,
    }));
  }

  async function submit(e) {
    e.preventDefault();
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.error) {
      setNotice({ err: true, msg: data.error });
      return;
    }
    setNotice({ msg: "タスクを登録しました。" });
    setForm({
      name: "",
      supplier_id: "",
      url: "",
      ship_method: "FBA",
      cond_pattern: "RATE",
      rate_min: 20,
      rate_max: 100,
      amount_min: 2000,
      monthly_sales_min: 0,
    });
    load();
  }

  async function toggle(t) {
    await fetch("/api/tasks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, enabled: t.enabled ? 0 : 1 }),
    });
    load();
  }

  async function del(id) {
    if (!confirm("このタスクを削除しますか？")) return;
    await fetch(`/api/tasks?id=${id}`, { method: "DELETE" });
    load();
  }

  async function crawlOne(id) {
    setNotice({ msg: "巡回中…" });
    const res = await fetch("/api/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: id }),
    });
    const data = await res.json();
    if (data.error) {
      setNotice({ err: true, msg: data.error });
      return;
    }
    const r = data.result || {};
    setNotice({
      msg: `抽出 ${r.extracted}件 / Amazon一致 ${r.matched}件 / 新規通知 ${r.notified}件`,
      errors: r.errors && r.errors.length ? r.errors : null,
    });
    load();
  }

  const limit = taskLimit(plan);
  const atLimit = tasks.length >= limit;
  const remainingText =
    limit === Infinity
      ? "無制限"
      : `残り ${Math.max(0, limit - tasks.length)}件`;

  return (
    <div>
      <div className="page-head">
        <h1>巡回タスク</h1>
      </div>

      <div className={"notice" + (atLimit ? " err" : "")}>
        現在のプラン：<strong>{planLabel(plan)}</strong>（巡回タスク 上限
        {taskLimitLabel(plan)} ／ 登録済み {tasks.length}件・{remainingText}）
        {atLimit && (
          <>
            {" "}
            — 上限に達しています。さらに登録するには上位プランへのアップグレードが必要です。
          </>
        )}
      </div>

      {notice && (
        <div className={"notice" + (notice.err ? " err" : "")}>
          {notice.msg}
          {notice.errors && (
            <pre className="json">{JSON.stringify(notice.errors, null, 2)}</pre>
          )}
        </div>
      )}

      <div className="card">
        <form onSubmit={submit}>
          <div className="grid2">
            <div className="field">
              <label>タスク名</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="例: ヨドバシ タイムセール監視"
                required
              />
            </div>
            <div className="field">
              <label>仕入れ先</label>
              <select
                value={form.supplier_id}
                onChange={(e) => selectSupplier(e.target.value)}
              >
                <option value="">（選択してください）</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>監視URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://…"
              required
            />
            <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>
              仕入れ先を選ぶと、その仕入れ先に登録されたURLが自動で入ります。
              セール一覧ページなど、実際に見張りたいページのURLに書き換えてもOKです。
            </p>
          </div>

          <div className="grid2">
            <div className="field">
              <label>配送方法</label>
              <div className="seg">
                {SHIP.map((s) => (
                  <button
                    type="button"
                    key={s.v}
                    className={form.ship_method === s.v ? "on" : ""}
                    onClick={() => set("ship_method", s.v)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>通知条件パターン</label>
              <div className="seg">
                {COND.map((c) => (
                  <button
                    type="button"
                    key={c.v}
                    className={form.cond_pattern === c.v ? "on" : ""}
                    onClick={() => set("cond_pattern", c.v)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid3">
            <div className="field">
              <label>利益率 下限（%）</label>
              <input
                type="number"
                value={form.rate_min}
                onChange={(e) => set("rate_min", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>利益率 上限（%）</label>
              <input
                type="number"
                value={form.rate_max}
                onChange={(e) => set("rate_max", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>利益額 下限（円）</label>
              <input
                type="number"
                value={form.amount_min}
                onChange={(e) => set("amount_min", Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid3">
            <div className="field">
              <label>月間販売数 下限</label>
              <input
                type="number"
                value={form.monthly_sales_min}
                onChange={(e) => set("monthly_sales_min", Number(e.target.value))}
              />
            </div>
          </div>

          <button className="btn" type="submit" disabled={atLimit}>
            {atLimit ? "上限に達しています" : "タスクを登録"}
          </button>
        </form>
      </div>

      <div className="card">
        {tasks.length === 0 ? (
          <div className="empty">まだタスクがありません。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>タスク名 / URL</th>
                <th>仕入れ先</th>
                <th>条件</th>
                <th>最終巡回</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <a href={t.url} target="_blank" rel="noreferrer">
                      {t.url}
                    </a>
                  </td>
                  <td>{t.supplier_name || "-"}</td>
                  <td>
                    {condSummary(t)}
                    <br />
                    <span className="badge gray">
                      {t.ship_method === "FBA" ? "FBA" : "自己発送"}
                    </span>{" "}
                    月販≥{t.monthly_sales_min}
                  </td>
                  <td className="mono">{t.last_run || "未実行"}</td>
                  <td>
                    <span className={"badge" + (t.enabled ? "" : " gray")}>
                      {t.enabled ? "有効" : "停止中"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn small"
                        onClick={() => crawlOne(t.id)}
                      >
                        今すぐ巡回
                      </button>
                      <button
                        className="btn secondary small"
                        onClick={() => toggle(t)}
                      >
                        {t.enabled ? "停止" : "再開"}
                      </button>
                      <button
                        className="btn danger small"
                        onClick={() => del(t.id)}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
