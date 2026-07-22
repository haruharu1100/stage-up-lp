"use client";

import { useEffect, useState } from "react";

function yen(n) {
  return "¥" + (Number(n) || 0).toLocaleString("ja-JP");
}

const STEPS = [
  {
    t: "仕入れ先を毎日自動で巡回",
    d: "登録した仕入れ先ページを毎日チェックし、商品と価格を自動で読み取ります。",
  },
  {
    t: "Amazon相場と自動で照合",
    d: "見つけた商品をAmazonの販売価格・手数料と突き合わせ、利益を自動計算します。",
  },
  {
    t: "利益が出る商品だけを通知",
    d: "設定した利益条件を満たした商品だけをここに一覧表示。そのまま仕入れられます。",
  },
];

export default function ResultsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/findings?deal=1`);
    setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>巡回結果</h1>
      </div>

      <div className="steps">
        {STEPS.map((s, i) => (
          <div className="step" key={i}>
            <div className="step-no">{i + 1}</div>
            <div className="step-t">{s.t}</div>
            <div className="step-d">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="notice">
        巡回で見つかった<strong>利益が出る商品</strong>の一覧です。各商品の
        <strong>「商品ページを開く（購入）」</strong>から、その場で仕入れ先ページを開いて購入できます。
        <br />
        ※ プランごとに1回の巡回で表示される件数が変わります（フリー1件／スタンダード10件／プロ無制限）。
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
        items.map((it) => {
          const plus = it.profit >= 0;
          return (
            <div className="deal-card deal" key={it.id}>
              {it.image_url ? (
                <img className="thumb" src={it.image_url} alt="" />
              ) : (
                <div className="thumb empty-thumb">画像なし</div>
              )}

              <div className="deal-main">
                <div className="deal-top">
                  <span className="badge blue">利益条件 達成</span>
                  <span>{it.supplier_name || "仕入れ先不明"}</span>
                  {it.task_name && <span>／ {it.task_name}</span>}
                </div>

                <div className="deal-name">{it.product_name}</div>

                <div className="deal-flow">
                  <span className="from">
                    仕入れ {yen(it.buy_price)}
                  </span>
                  <span className="arrow">→</span>
                  <span className="to">Amazon {yen(it.amazon_price)}</span>
                </div>

                <div className="deal-sub">
                  <span className="mono">JAN: {it.jan || "-"}</span>
                  <span className="mono">ASIN: {it.asin || "-"}</span>
                  <span className="mono">月販 {it.monthly_sales}</span>
                </div>

                <div className="deal-actions">
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

              <div className="deal-figures">
                <div className="deal-prices">
                  <div className="pcol">
                    <div className="plabel">仕入れ価格</div>
                    <div className="pval">{yen(it.buy_price)}</div>
                  </div>
                  <div className="pcol">
                    <div className="plabel">Amazon価格</div>
                    <div className="pval amazon">{yen(it.amazon_price)}</div>
                  </div>
                </div>
                <div className={"deal-profit" + (plus ? "" : " minus")}>
                  {plus ? "+" : ""}
                  {yen(it.profit)}
                </div>
                <div className={"deal-rate" + (plus ? "" : " minus")}>
                  利益率 {it.profit_rate}%
                </div>
                <div className="deal-fee">手数料 {yen(it.fees)} 込み</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
