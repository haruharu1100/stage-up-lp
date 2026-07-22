"use client";

import { useEffect, useState } from "react";

function yen(n) {
  return "¥" + (Number(n) || 0).toLocaleString("ja-JP");
}

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [summary, setSummary] = useState(null);

  async function load(hidden) {
    setLoading(true);
    const res = await fetch(`/api/notifications?hidden=${hidden ? 1 : 0}`);
    setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load(showHidden);
  }, [showHidden]);

  async function hide(id) {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, hidden: showHidden ? 0 : 1 }),
    });
    load(showHidden);
  }

  async function crawlAll() {
    setCrawling(true);
    setSummary(null);
    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setSummary(data);
      load(showHidden);
    } catch (e) {
      setSummary({ error: String(e) });
    }
    setCrawling(false);
  }

  return (
    <div>
      <div className="page-head">
        <h1>通知</h1>
        <div className="row-actions">
          <button
            className="btn secondary small"
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? "通常表示に戻す" : "非表示分を見る"}
          </button>
          <button className="btn" onClick={crawlAll} disabled={crawling}>
            {crawling ? "巡回中…" : "今すぐ全タスクを巡回"}
          </button>
        </div>
      </div>

      {summary && (
        <div className="card">
          <strong>巡回結果</strong>
          <pre className="json">{JSON.stringify(summary, null, 2)}</pre>
        </div>
      )}

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <p>
            {showHidden
              ? "非表示にした通知はありません。"
              : "まだ利益商品の通知はありません。"}
          </p>
          {!showHidden && (
            <p>
              <a href="/tasks">巡回タスクを登録</a>して「今すぐ巡回」を押すと、
              利益条件を満たす商品がここに表示されます。
            </p>
          )}
        </div>
      ) : (
        items.map((it) => (
          <div className="card notif" key={it.id}>
            {it.image_url ? (
              <img className="thumb" src={it.image_url} alt="" />
            ) : (
              <div className="thumb" />
            )}
            <div className="body">
              <div className="meta">
                <span className="badge">利益条件 達成</span>
                <span>{it.supplier_name || "仕入れ先不明"}</span>
                <span>{it.found_at}</span>
              </div>
              <div className="pname">{it.product_name}</div>
              <div className="subinfo">
                <span className="mono">JAN: {it.jan || "-"}</span>
                <span className="mono">ASIN: {it.asin || "-"}</span>
                {it.source_url && (
                  <a href={it.source_url} target="_blank" rel="noreferrer">
                    仕入れ元
                  </a>
                )}
                {it.product_url && (
                  <a href={it.product_url} target="_blank" rel="noreferrer">
                    Amazon
                  </a>
                )}
              </div>
            </div>
            <div className="figures">
              <div className="amazon-price mono">{yen(it.amazon_price)}</div>
              <div className="profit mono">
                +{yen(it.profit)}（{it.profit_rate}%）
              </div>
              <div className="small-figures mono">
                仕入 {yen(it.buy_price)} / 手数料 {yen(it.fees)}
                <br />
                月販 {it.monthly_sales}
              </div>
              <button
                className="btn ghost small"
                style={{ marginTop: 8 }}
                onClick={() => hide(it.id)}
              >
                {showHidden ? "再表示" : "非表示"}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
