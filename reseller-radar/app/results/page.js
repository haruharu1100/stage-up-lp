"use client";

import { useEffect, useState } from "react";

function yen(n) {
  return "¥" + (Number(n) || 0).toLocaleString("ja-JP");
}

export default function ResultsPage() {
  const [items, setItems] = useState([]);
  const [dealOnly, setDealOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(deal) {
    setLoading(true);
    const res = await fetch(`/api/findings?deal=${deal ? 1 : 0}`);
    setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load(dealOnly);
  }, [dealOnly]);

  return (
    <div>
      <div className="page-head">
        <h1>巡回結果</h1>
        <div className="row-actions">
          <button
            className="btn secondary small"
            onClick={() => setDealOnly((v) => !v)}
          >
            {dealOnly ? "すべて表示" : "利益条件を満たす商品だけ"}
          </button>
        </div>
      </div>

      <div className="notice">
        巡回で見つかり、Amazonと照合できた商品の一覧です。各商品の
        <strong>「商品ページを開く」</strong>から、その場で仕入れ先ページを開いて購入できます。
        <br />
        「利益条件 達成」のバッジが付いた商品は、設定した利益条件を満たしています。
      </div>

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <p>まだ巡回結果はありません。</p>
          <p>
            <a href="/tasks">巡回タスク</a>で「今すぐ巡回」を押すと、
            見つかった商品がここに一覧表示されます。
          </p>
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
                {it.is_deal ? (
                  <span className="badge">利益条件 達成</span>
                ) : (
                  <span className="badge gray">参考</span>
                )}
                <span>{it.supplier_name || "仕入れ先不明"}</span>
                <span>{it.task_name || ""}</span>
              </div>
              <div className="pname">{it.product_name}</div>
              <div className="subinfo">
                <span className="mono">JAN: {it.jan || "-"}</span>
                <span className="mono">ASIN: {it.asin || "-"}</span>
                <span className="mono">月販 {it.monthly_sales}</span>
              </div>
              <div className="row-actions" style={{ marginTop: 10 }}>
                {it.source_url && (
                  <a
                    className="btn small"
                    href={it.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    商品ページを開く（購入）
                  </a>
                )}
                {it.product_url && (
                  <a
                    className="btn secondary small"
                    href={it.product_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Amazonで見る
                  </a>
                )}
              </div>
            </div>
            <div className="figures">
              <div className="amazon-price mono">{yen(it.amazon_price)}</div>
              <div className="profit mono">
                {it.profit >= 0 ? "+" : ""}
                {yen(it.profit)}（{it.profit_rate}%）
              </div>
              <div className="small-figures mono">
                仕入 {yen(it.buy_price)} / 手数料 {yen(it.fees)}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
