"use client";

import { useEffect, useState } from "react";

function yen(n) {
  return "¥" + (Number(n) || 0).toLocaleString("ja-JP");
}

// display_category（合否ゲートの判定区分）を表示側の3区分に正規化する。
// 旧データ（display_category が無い）は安全側に倒し、is_deal=1でも「要確認」に入れる。
function bucketOf(it) {
  const c = it.display_category;
  // 出品規制（食品/サプリ/酒/医薬/たばこ）や赤字判定は表示しない。
  if (c === "EXCLUDED") return null;
  if (c === "AUTO_PROFIT" || c === "ESTIMATED_PROFIT" || c === "MANUAL_REVIEW") return c;
  return "MANUAL_REVIEW";
}

const SECTIONS = [
  {
    key: "AUTO_PROFIT",
    title: "利益商品",
    lead:
      "商品一致（JAN／型番で実照合）・利益条件（利益1,500円以上／利益率10%以上／ROI15%以上）・" +
      "値崩れ耐性（価格-10%でも手数料+500円でも黒字）・値崩れリスクの全てを満たした商品です。",
    badge: { bg: "#e7f7ec", color: "#1a7f37", label: "利益商品（全条件クリア）" },
    empty:
      "現在0件です。手数料を実額で確定できるSP-API未接続の間は、条件を満たしても" +
      "「推定利益候補」に留まります（下の枠をご覧ください）。",
  },
  {
    key: "ESTIMATED_PROFIT",
    title: "推定利益候補",
    lead:
      "商品一致・利益条件・値崩れ耐性は満たしています。ただしAmazon手数料が" +
      "推定値（SP-API未接続）のため「確定利益」ではありません。仕入れ前に手数料をご確認ください。",
    badge: { bg: "#e8f0fe", color: "#1a56db", label: "推定利益候補（手数料は推定）" },
    empty: "現在0件です。",
  },
  {
    key: "MANUAL_REVIEW",
    title: "要確認",
    lead:
      "利益の数字は出ていますが、商品一致が未確認（名前・属性だけの一致）または" +
      "値崩れリスクが高い/判定データ不足の候補です。別商品を掴んでいる恐れがあるため、" +
      "仕入れ前に必ずAmazon側のJAN／型番が一致するかご自身で確認してください。",
    badge: { bg: "#fdecec", color: "#b42318", label: "要確認（一致・値崩れが未確認）" },
    empty: "現在0件です。",
  },
];

function DealCard({ it, bucket }) {
  const plus = it.profit >= 0;
  const isReview = bucket === "MANUAL_REVIEW";
  return (
    <div className={"deal-card" + (isReview ? "" : " deal")}>
      {it.image_url || it.asin ? (
        <img
          className="thumb"
          src={
            it.image_url ||
            `https://images-na.ssl-images-amazon.com/images/P/${it.asin}.09._SCLZZZZZZZ_.jpg`
          }
          alt=""
          onError={(e) => {
            const img = e.currentTarget;
            if (it.asin && !img.dataset.fallback) {
              img.dataset.fallback = "1";
              img.src = `https://images-na.ssl-images-amazon.com/images/P/${it.asin}.09._SCLZZZZZZZ_.jpg`;
            }
          }}
        />
      ) : (
        <div className="thumb empty-thumb">画像なし</div>
      )}

      <div className="deal-main">
        <div className="deal-top">
          {it.match_status === "JAN_VERIFIED" && (
            <span className="badge" style={{ background: "#e7f7ec", color: "#1a7f37" }}>
              JAN一致・確実
            </span>
          )}
          {it.match_status === "MODEL_VERIFIED" && (
            <span className="badge" style={{ background: "#e8f0fe", color: "#1a56db" }}>
              型番一致・ほぼ確実
            </span>
          )}
          {it.match_status && it.match_status !== "JAN_VERIFIED" && it.match_status !== "MODEL_VERIFIED" && (
            <span className="badge" style={{ background: "#fdecec", color: "#b42318" }}>
              一致未確認
            </span>
          )}
          {it.condition && (
            <span className={"badge" + (it.condition === "中古" ? " gray" : "")}>
              {it.condition === "中古" ? "中古（Amazon中古価格で比較）" : "新品"}
            </span>
          )}
          <span>{it.supplier_name || "仕入れ先不明"}</span>
          {it.task_name && <span>／ {it.task_name}</span>}
        </div>

        <div className="deal-name">{it.product_name}</div>

        {isReview && (
          <div
            style={{
              fontSize: 12,
              color: "#b42318",
              background: "#fdecec",
              border: "1px solid #f5c2c0",
              borderRadius: 8,
              padding: "6px 10px",
              margin: "4px 0 8px",
              lineHeight: 1.5,
            }}
          >
            ⚠ これは<b>まだ利益商品ではありません</b>。{it.gate_reasons ? `理由：${it.gate_reasons}。` : ""}
            <b>仕入れ前に必ずAmazon側のJAN（{it.jan || "商品コード"}）が一致するか確認</b>してください。
          </div>
        )}

        {bucket === "ESTIMATED_PROFIT" && (
          <div
            style={{
              fontSize: 12,
              color: "#1a56db",
              background: "#eef4ff",
              border: "1px solid #cddcff",
              borderRadius: 8,
              padding: "6px 10px",
              margin: "4px 0 8px",
              lineHeight: 1.5,
            }}
          >
            ℹ Amazon手数料は<b>推定値</b>です（SP-API未接続）。実際の手数料で利益が変わる場合があります。
          </div>
        )}

        {it.amazon_title && (
          <div style={{ fontSize: 12, color: "#55617a", margin: "2px 0 6px", lineHeight: 1.4 }}>
            <span style={{ color: "#98a2b3" }}>Amazon商品名：</span>
            {it.amazon_title}
          </div>
        )}

        <div className="deal-flow">
          <span className="from">仕入れ {yen(it.buy_price)}</span>
          <span className="arrow">→</span>
          <span className="to">
            Amazon（保守価格）{yen(it.amazon_price)}
          </span>
        </div>

        <div className="deal-sub">
          <span className="mono">JAN: {it.jan || "-"}</span>
          <span className="mono">ASIN: {it.asin || "-"}</span>
          <span className="mono">販売動向(30日) {it.monthly_sales}</span>
          {it.roi != null && <span className="mono">ROI {it.roi}%</span>}
          {it.price_risk_score != null && (
            <span className="mono">値崩れリスク {it.price_risk_score}</span>
          )}
        </div>

        <div className="deal-actions">
          {it.source_url && (
            <a className="btn small" href={it.source_url} target="_blank" rel="noreferrer">
              商品ページを開く（購入）
            </a>
          )}
          {it.product_url && (
            <a className="btn secondary small" href={it.product_url} target="_blank" rel="noreferrer">
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
            <div className="plabel">Amazon（保守価格）</div>
            <div className="pval amazon">{yen(it.amazon_price)}</div>
          </div>
        </div>
        <div className={"deal-profit" + (plus ? "" : " minus")}>
          {plus ? "+" : ""}
          {yen(it.profit)}
          {bucket !== "AUTO_PROFIT" && <span style={{ fontSize: 12 }}>（推定）</span>}
        </div>
        <div className={"deal-rate" + (plus ? "" : " minus")}>利益率 {it.profit_rate}%</div>
        <div className="deal-fee">手数料 {yen(it.fees)} 込み（推定）</div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/findings`);
    setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = { AUTO_PROFIT: [], ESTIMATED_PROFIT: [], MANUAL_REVIEW: [] };
  for (const it of items) {
    const b = bucketOf(it);
    if (b) grouped[b].push(it);
  }

  return (
    <div>
      <div className="page-head">
        <h1>巡回結果</h1>
      </div>

      <div className="notice">
        巡回結果を<strong>3段階</strong>で表示します。①<strong>利益商品</strong>（全条件クリア）／
        ②<strong>推定利益候補</strong>（手数料が推定）／③<strong>要確認</strong>（商品一致・値崩れが未確認）。
        <br />
        <strong>「誤った商品」「赤字の商品」を利益商品として出さない</strong>ことを最優先にしています。
        利益・手数料は概算です（SP-API接続前は手数料が推定値）。仕入れ判断はご自身の確認のうえで行ってください。
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
        SECTIONS.map((sec) => {
          const list = grouped[sec.key] || [];
          return (
            <section key={sec.key} style={{ marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{sec.title}</h2>
                <span
                  className="badge"
                  style={{ background: sec.badge.bg, color: sec.badge.color }}
                >
                  {list.length}件
                </span>
              </div>
              <p style={{ fontSize: 13, color: "#55617a", margin: "6px 0 12px", lineHeight: 1.6 }}>
                {sec.lead}
              </p>
              {list.length === 0 ? (
                <div className="card empty" style={{ fontSize: 13 }}>
                  {sec.empty}
                </div>
              ) : (
                list.map((it) => <DealCard key={it.id} it={it} bucket={sec.key} />)
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
