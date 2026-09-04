"use client";

import { useEffect, useState } from "react";
import { normalizePlan, planLabel, dealLimit, dealLimitLabel } from "@/lib/plans";

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

// ジャンル一覧。仕入れ先の検索ページを「そのジャンルの商品だけ」に絞り込むための
// 検索キーワード(kw)を持たせている。狭く絞るほど調べる件数が減り、
// Amazon照合サービス(Keepa)の短時間の上限に当たりにくく、利益商品も出やすい。
// ジャンルは「当たりやすい順」に並べている。
// 上のほど型番・ブランド・JANが商品名に載りやすく、Amazonと正確に一致して
// 間違いが起きにくい（＝おすすめ）。下のほど商品名があいまいで一致しにくい。
const GENRES = [
  { key: "printer", label: "★おすすめ プリンター純正インク（型番一致で正確）", kw: "純正インク" },
  { key: "microsd", label: "★おすすめ SD・microSDカード（ブランド品）", kw: "microSDカード SanDisk" },
  { key: "usbmem", label: "★おすすめ USBメモリ（ブランド品）", kw: "USBメモリ" },
  { key: "earphone", label: "★おすすめ ワイヤレスイヤホン・ヘッドホン", kw: "ワイヤレスイヤホン" },
  { key: "ssd", label: "外付けSSD・ポータブルSSD", kw: "ポータブルSSD" },
  { key: "hdd", label: "外付けHDD", kw: "外付けHDD" },
  { key: "battery", label: "モバイルバッテリー・充電器", kw: "モバイルバッテリー Anker" },
  { key: "beauty", label: "美容家電（ドライヤー等）", kw: "ヘアドライヤー" },
  { key: "game", label: "ゲーム周辺機器", kw: "ゲーム コントローラー" },
  { key: "kitchen", label: "調理家電", kw: "調理家電" },
  { key: "hobby", label: "フィギュア・ホビー（一致しにくい）", kw: "フィギュア" },
  { key: "sale", label: "おまかせ（セール全般・広め／精度は下がりがち）", kw: "セール" },
];

function keywordForGenre(genreKey) {
  const g = GENRES.find((x) => x.key === genreKey);
  return g ? g.kw : "セール";
}

// 仕入れ先(sup)の検索ページURLを、指定キーワード(kw)で組み立てる。
// トップページは商品が薄く利益が出にくいので、各社の“検索結果ページ”を使う。
function buildListingUrl(sup, kw) {
  if (!sup) return "";
  let host = "";
  try {
    host = new URL(sup.base_url || "").hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const q = encodeURIComponent(kw || "セール");
  // ↓ 追加した仕入れ先の“検索結果ページ”URLを、ジャンルのキーワードで組み立てる。
  //   ヤフオクは host に yahoo.co.jp を含むので、下の Yahoo!ショッピング判定より前に置く。
  if (host.includes("auctions.yahoo.co.jp"))
    return `https://auctions.yahoo.co.jp/search/search?p=${q}`;
  if (host.includes("7net.omni7.jp"))
    return `https://7net.omni7.jp/search/?keyword=${q}`;
  if (host.includes("netmall.hardoff.co.jp"))
    return `https://netmall.hardoff.co.jp/search/?keyword=${q}`;
  if (host.includes("edion.com"))
    return `https://www.edion.com/item_list.html?keyword=${q}`;
  if (host.includes("ksdenki.com"))
    return `https://www.ksdenki.com/shop/goods/search.aspx?search=x&keyword=${q}`;
  if (host.includes("fril.jp")) return `https://fril.jp/s?query=${q}`;
  if (host.includes("mercari.com"))
    return `https://jp.mercari.com/search?keyword=${q}&status=on_sale&item_condition_id=1`;
  if (host.includes("yodobashi.com")) return `https://www.yodobashi.com/?word=${q}`;
  if (host.includes("biccamera.com"))
    return `https://www.biccamera.com/bc/category/?q=${q}`;
  if (host.includes("rakuten.co.jp"))
    return `https://search.rakuten.co.jp/search/mall/${q}/`;
  if (host.includes("yahoo.co.jp"))
    return `https://shopping.yahoo.co.jp/search?p=${q}`;
  if (host.includes("suruga-ya.jp"))
    return `https://www.suruga-ya.jp/search?search_word=${q}`;
  if (host.includes("amiami.jp"))
    return `https://www.amiami.jp/search/list/?s_keywords=${q}`;
  return sup.base_url || "";
}

// 監視URLの「%E3%82%...」を日本語に戻して読みやすく表示する（リンク先は元のまま）。
function prettyUrl(u) {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
}

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
    genre: "printer",
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

  // 仕入れ先とジャンルを選ぶと、監視URL欄へ「そのジャンルの検索結果ページ」を自動で入れる。
  // トップページは商品が薄く利益商品が出にくいので、各社の“検索結果ページ”を使う。
  // ジャンルで絞るほど調べる件数が減り、Keepaの上限に当たりにくくなる。
  function selectSupplier(id) {
    const sup = suppliers.find((s) => String(s.id) === String(id));
    setForm((f) => {
      const listing = buildListingUrl(sup, keywordForGenre(f.genre));
      return { ...f, supplier_id: id, url: listing || f.url };
    });
  }

  function selectGenre(key) {
    setForm((f) => {
      const sup = suppliers.find((s) => String(s.id) === String(f.supplier_id));
      const listing = buildListingUrl(sup, keywordForGenre(key));
      return { ...f, genre: key, url: listing || f.url };
    });
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
      genre: "printer",
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
    setNotice({ msg: "巡回を開始しています…" });

    // 1) 巡回を開始（ページ取得＋商品抽出）
    const startRes = await fetch("/api/crawl/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: id }),
    });
    const start = await startRes.json();
    if (start.error) {
      setNotice({ err: true, msg: start.error });
      return;
    }
    const jobId = start.jobId;
    const total = start.total || 0;
    if (total === 0) {
      setNotice({
        err: true,
        msg:
          "このページからは商品を読み取れませんでした。トップページではなく、" +
          "「セール」「検索結果」「商品一覧」など商品が並んでいるページのURLをお試しください。" +
          `（抽出 ${start.extracted || 0}件）`,
      });
      load();
      return;
    }

    // 2) 60秒制限に収まる範囲で「続き」を繰り返し呼び、最後まで探し切る
    let r = { extracted: start.extracted, matched: 0, notified: 0, errors: null };
    let done = false;
    let guard = 0;
    while (!done && guard < 60) {
      guard++;
      const stepRes = await fetch("/api/crawl/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const s = await stepRes.json();
      if (s.error) {
        setNotice({ err: true, msg: s.error });
        load();
        return;
      }
      done = s.done;
      r = {
        extracted: s.extracted,
        matched: s.matched,
        notified: s.notified,
        errors: s.errors && s.errors.length ? s.errors : null,
      };
      setNotice({
        msg: `巡回中… ${s.cursor}/${total} 件を確認しました（利益商品 ${s.notified}件）。このまま自動で最後まで探します。`,
      });
      load(); // 見つかった商品をその都度表示に反映
      if (!done) await new Promise((res) => setTimeout(res, 250));
    }

    const stat = `（抽出 ${r.extracted}件 / Amazon一致 ${r.matched}件 / 利益商品 ${r.notified}件）`;
    let msg;
    if (r.notified > 0) {
      // 利益商品が見つかった
      msg = `利益が出る商品を ${r.notified}件 見つけました！「巡回結果」の画面で確認できます。${stat}`;
    } else if (r.extracted === 0) {
      // そもそも商品が読み取れなかった（トップページ等）
      msg =
        `このページからは商品を読み取れませんでした。トップページではなく、` +
        `「セール」「検索結果」「商品一覧」など商品が並んでいるページのURLをお試しください。${stat}`;
    } else if (r.matched === 0) {
      // 商品は取れたがAmazonに一致しなかった
      msg =
        `商品は${r.extracted}件読み取れましたが、Amazonで一致する商品が見つかりませんでした。` +
        `別のジャンル・ページのURLもお試しください。${stat}`;
    } else {
      // 商品もAmazon一致もあったが、利益条件を満たすものが無かった
      msg =
        `商品は取得できましたが、設定した利益条件（利益率・利益額など）を満たす商品はありませんでした。` +
        `条件を少し緩める、またはセール・型落ち・アウトレットなど「安い商品が多いページ」のURLをお試しください。${stat}`;
    }
    setNotice({
      msg,
      err: r.notified === 0,
      errors: r.errors && r.errors.length ? r.errors : null,
    });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1>巡回タスク</h1>
      </div>

      <div className="notice">
        現在のプラン：<strong>{planLabel(plan)}</strong>（1回の巡回で表示される利益商品
        {dealLimitLabel(plan)}まで ／ 巡回タスクは何件でも登録できます）
        <br />
        巡回は<strong>利益が出る商品が{dealLimitLabel(plan)}見つかった時点で終了</strong>します。
        もっと多くの利益商品を見たい場合は、上位プランへのアップグレードでご利用いただけます。
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
            <label>
              ジャンルで絞り込み{" "}
              <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 400 }}>
                （絞るほど利益商品が出やすく、Amazon照合の上限にも当たりにくくなります）
              </span>
            </label>
            <select
              value={form.genre}
              onChange={(e) => selectGenre(e.target.value)}
            >
              {GENRES.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
            <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>
              仕入れ先とジャンルを選ぶと、監視URLが自動で入ります。ジャンルを変えるとURLも切り替わります。
            </p>
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
              <strong>キーワードの入力は不要です。</strong>
              「セール」「商品一覧」「検索結果」など、<strong>商品が並んでいるページ</strong>のURLをそのまま貼り付けてください。
              <br />
              <span style={{ color: "#a13224" }}>
                ※ トップページのURL（例：https://www.yodobashi.com/）のままでは、
                商品一覧が無いため価格・画像・リンクが正しく取得できません。必ず商品が並んでいるページのURLにしてください。
              </span>
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
              <label>販売動向スコア 下限（30日ランク下落回数）</label>
              <input
                type="number"
                value={form.monthly_sales_min}
                onChange={(e) => set("monthly_sales_min", Number(e.target.value))}
              />
            </div>
          </div>

          <button className="btn" type="submit">
            タスクを登録
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
                      {prettyUrl(t.url)}
                    </a>
                  </td>
                  <td>{t.supplier_name || "-"}</td>
                  <td>
                    {condSummary(t)}
                    <br />
                    <span className="badge gray">
                      {t.ship_method === "FBA" ? "FBA" : "自己発送"}
                    </span>{" "}
                    販売動向≥{t.monthly_sales_min}
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
