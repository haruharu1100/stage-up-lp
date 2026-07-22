"use client";

import { useEffect, useState } from "react";

const EMPTY = {
  id: null,
  name: "",
  base_url: "",
  selector_item: "",
  selector_name: "",
  selector_price: "",
  selector_jan: "",
  selector_link: "",
  selector_image: "",
};

export default function SuppliersPage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);

  async function load() {
    const res = await fetch("/api/suppliers");
    setList(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function startEdit(s) {
    setForm({ ...s });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function reset() {
    setForm(EMPTY);
    setEditing(false);
  }

  async function submit(e) {
    e.preventDefault();
    const method = form.id ? "PUT" : "POST";
    const res = await fetch("/api/suppliers", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.error) {
      setNotice({ err: true, msg: data.error });
      return;
    }
    setNotice({ msg: form.id ? "仕入れ先を更新しました。" : "仕入れ先を追加しました。" });
    reset();
    load();
  }

  async function toggle(s) {
    await fetch("/api/suppliers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, enabled: s.enabled ? 0 : 1 }),
    });
    load();
  }

  async function del(s) {
    if (!confirm(`「${s.name}」を削除しますか？`)) return;
    const res = await fetch(`/api/suppliers?id=${s.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) {
      setNotice({ err: true, msg: data.error });
      return;
    }
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1>仕入れ先</h1>
      </div>

      {notice && (
        <div className={"notice" + (notice.err ? " err" : "")}>{notice.msg}</div>
      )}

      <div className="card">
        <form onSubmit={submit}>
          <strong>{editing ? "仕入れ先を編集" : "仕入れ先を追加"}</strong>
          <div className="grid2" style={{ marginTop: 12 }}>
            <div className="field">
              <label>名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>ベースURL</label>
              <input
                type="text"
                value={form.base_url}
                onChange={(e) => set("base_url", e.target.value)}
                placeholder="https://example.com/"
              />
            </div>
          </div>

          <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 8px" }}>
            CSSセレクタは空欄なら自動検出します。
          </p>
          <div className="grid2">
            <div className="field">
              <label>商品ブロック</label>
              <input
                type="text"
                value={form.selector_item}
                onChange={(e) => set("selector_item", e.target.value)}
                placeholder=".item"
              />
            </div>
            <div className="field">
              <label>商品名</label>
              <input
                type="text"
                value={form.selector_name}
                onChange={(e) => set("selector_name", e.target.value)}
              />
            </div>
            <div className="field">
              <label>価格</label>
              <input
                type="text"
                value={form.selector_price}
                onChange={(e) => set("selector_price", e.target.value)}
              />
            </div>
            <div className="field">
              <label>JAN</label>
              <input
                type="text"
                value={form.selector_jan}
                onChange={(e) => set("selector_jan", e.target.value)}
              />
            </div>
            <div className="field">
              <label>リンク（既定 a）</label>
              <input
                type="text"
                value={form.selector_link}
                onChange={(e) => set("selector_link", e.target.value)}
              />
            </div>
            <div className="field">
              <label>画像（既定 img）</label>
              <input
                type="text"
                value={form.selector_image}
                onChange={(e) => set("selector_image", e.target.value)}
              />
            </div>
          </div>

          <div className="row-actions">
            <button className="btn" type="submit">
              {editing ? "更新" : "追加"}
            </button>
            {editing && (
              <button className="btn secondary" type="button" onClick={reset}>
                キャンセル
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>名称 / ベースURL</th>
              <th>種別</th>
              <th>抽出方法</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <span className="mono" style={{ fontSize: 12, color: "#6b7280" }}>
                    {s.base_url || "-"}
                  </span>
                </td>
                <td>
                  <span className={"badge" + (s.is_preset ? " gray" : "")}>
                    {s.is_preset ? "プリセット" : "カスタム"}
                  </span>
                </td>
                <td>{s.selector_item ? "セレクタ指定" : "自動検出"}</td>
                <td>
                  <span className={"badge" + (s.enabled ? "" : " gray")}>
                    {s.enabled ? "有効" : "無効"}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn small" onClick={() => startEdit(s)}>
                      編集
                    </button>
                    <button
                      className="btn secondary small"
                      onClick={() => toggle(s)}
                    >
                      {s.enabled ? "無効化" : "有効化"}
                    </button>
                    {!s.is_preset && (
                      <button
                        className="btn danger small"
                        onClick={() => del(s)}
                      >
                        削除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
