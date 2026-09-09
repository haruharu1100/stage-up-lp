#!/usr/bin/env python3
"""Search Console と GA4 の CSV を読んで、「どこで止まっているか」を出す。

APIの鍵はいらない。管理画面の［エクスポート］で落としたCSVをそのまま渡す。
（鍵の設定を待っていると、いつまでも分析が始まらないため）

使い方:
    python3 tools/analyze_search.py --site review-blog --gsc-queries クエリ.csv
    python3 tools/analyze_search.py --site review-blog --gsc-pages ページ.csv --ga4 チャネル.csv

出るもの:
    artifacts/<日付>/search_<サイト>.md

★この道具がやらないこと（意図的）
    ・検索ボリュームや難易度など、手元に無い数字を作らない
    ・「この語を狙えば何件増える」という予測をしない
    ・欠けている項目は「不明」と書く
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import statistics
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Search Console のCSVは日本語UIと英語UIで列名が違う。両方に対応する。
COL = {
    "query": ["上位のクエリ", "クエリ", "検索キーワード", "top queries", "query", "queries"],
    "page": ["上位のページ", "ページ", "top pages", "page", "pages", "landing page"],
    "clicks": ["クリック数", "clicks", "click"],
    "impressions": ["表示回数", "impressions", "impression"],
    "ctr": ["ctr", "クリック率"],
    "position": ["掲載順位", "平均掲載順位", "position", "average position"],
    "channel": ["セッションのデフォルト チャネル グループ", "デフォルト チャネル グループ",
                "セッション デフォルト チャネル グループ", "session default channel group",
                "default channel group", "session primary channel group"],
    "sessions": ["セッション数", "セッション", "sessions"],
}


def read_csv(path: Path) -> list[dict]:
    """GA4のCSVは先頭に # で始まる説明行が入る。そこを飛ばして表だけ読む。"""
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = raw.splitlines()
    start = 0
    for i, l in enumerate(lines):
        if l.strip() and not l.strip().startswith("#"):
            start = i
            break
    body = "\n".join(lines[start:])
    rows = list(csv.DictReader(io.StringIO(body)))
    return [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in rows]


def col(rows: list[dict], kind: str) -> str | None:
    if not rows:
        return None
    for c in rows[0]:
        if c.lower().strip() in [x.lower() for x in COL[kind]]:
            return c
    return None


def num(s: str) -> float | None:
    """『1,234』『3.5%』を数にする。読めないものは None（0にしない）。

    0にしてしまうと『データが無い』と『本当に0だった』の区別がつかなくなる。
    """
    if s is None:
        return None
    s = str(s).replace(",", "").replace("，", "").replace("%", "").replace("％", "").strip()
    if s in ("", "-", "—", "n/a", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def bucket(pos: float | None) -> str:
    if pos is None:
        return "不明"
    if pos <= 3:
        return "1〜3位"
    if pos <= 10:
        return "4〜10位"
    if pos <= 20:
        return "11〜20位"
    return "21位以下"


def load_gsc(path: Path, kind: str) -> list[dict]:
    rows = read_csv(path)
    key = col(rows, kind)
    c_clicks, c_imp = col(rows, "clicks"), col(rows, "impressions")
    c_ctr, c_pos = col(rows, "ctr"), col(rows, "position")
    if not key or not c_imp:
        sys.exit(f"{path.name}: 列が読めません（見つかった列: {', '.join(rows[0]) if rows else 'なし'}）")
    out = []
    for r in rows:
        imp = num(r.get(c_imp))
        clicks = num(r.get(c_clicks)) if c_clicks else None
        ctr = num(r.get(c_ctr)) if c_ctr else None
        if ctr is None and clicks is not None and imp:
            ctr = clicks / imp * 100
        out.append({
            "name": r.get(key, ""),
            "clicks": clicks,
            "impressions": imp,
            "ctr": ctr,
            "position": num(r.get(c_pos)) if c_pos else None,
        })
    return [r for r in out if r["name"]]


def analyze(rows: list[dict], brand_terms: list[str]) -> dict:
    have_imp = [r for r in rows if r["impressions"]]
    total_imp = sum(r["impressions"] for r in have_imp) if have_imp else 0
    total_clicks = sum(r["clicks"] for r in rows if r["clicks"]) if any(r["clicks"] for r in rows) else None

    # 順位帯ごとの「自社の平均的なクリック率」を、自社データだけから出す。
    # 世間の平均CTR表は業種で大きく違うので持ち込まない。
    by_bucket: dict[str, list[float]] = {}
    for r in rows:
        if r["ctr"] is not None and r["position"] is not None:
            by_bucket.setdefault(bucket(r["position"]), []).append(r["ctr"])
    median = {b: statistics.median(v) for b, v in by_bucket.items() if len(v) >= 3}

    # 「表示は多いのにクリックが少ない」＝同じ順位帯の自社中央値の半分未満
    imps = sorted((r["impressions"] for r in have_imp), reverse=True)
    imp_line = imps[max(0, len(imps) // 4 - 1)] if imps else 0   # 上位25%の表示回数
    low_ctr = []
    for r in rows:
        b = bucket(r["position"])
        m = median.get(b)
        if m and r["ctr"] is not None and r["impressions"] and r["impressions"] >= imp_line:
            if r["ctr"] < m * 0.5:
                low_ctr.append({**r, "順位帯": b, "その帯の中央値": m})
    low_ctr.sort(key=lambda r: -(r["impressions"] or 0))

    almost = sorted(
        [r for r in rows if r["position"] and 10 < r["position"] <= 20],
        key=lambda r: -(r["impressions"] or 0),
    )

    def is_brand(name: str) -> bool:
        n = name.lower()
        return any(t.lower() in n for t in brand_terms)

    brand = [r for r in rows if is_brand(r["name"])]
    nonbrand = [r for r in rows if not is_brand(r["name"])]

    return {
        "rows": rows, "total_imp": total_imp, "total_clicks": total_clicks,
        "median": median, "low_ctr": low_ctr, "almost": almost,
        "brand": brand, "nonbrand": nonbrand, "imp_line": imp_line,
    }


def sum_of(rows, key):
    vals = [r[key] for r in rows if r[key] is not None]
    return sum(vals) if vals else None


def fmt(v, suffix=""):
    if v is None:
        return "不明"
    return f"{v:,.0f}{suffix}" if float(v).is_integer() else f"{v:,.1f}{suffix}"


def ga4_channels(path: Path) -> list[str]:
    rows = read_csv(path)
    c_ch, c_se = col(rows, "channel"), col(rows, "sessions")
    if not c_ch or not c_se:
        return [f"- GA4のCSVから列を読めませんでした（見つかった列: {', '.join(rows[0]) if rows else 'なし'}）"]
    data = {r[c_ch]: num(r[c_se]) for r in rows if r.get(c_ch)}
    organic = data.get("Organic Search")
    ai = data.get("AI Assistant")
    out = ["| チャネル | セッション |", "|---|---:|"]
    for k, v in sorted(data.items(), key=lambda kv: -(kv[1] or 0)):
        out.append(f"| {k} | {fmt(v)} |")
    total = None
    if organic is not None or ai is not None:
        total = (organic or 0) + (ai or 0)
    out += [
        "",
        f"**この案件の『集客』＝ Organic Search {fmt(organic)} ＋ AI Assistant {fmt(ai)} ＝ {fmt(total)}**",
        "",
        "- AI Overviews / AI Mode からの訪問は AI Assistant ではなく Organic Search に入っている（二重に数えない）。",
        "- AI Assistant は2026-05-13に追加された区分。**それ以前の期間は遡って分類し直されない**ので、前年同期比で「AI流入が急増」と読まない。",
        "- リファラの無い流入（アプリ内ブラウザ・コピペ）は Direct のまま。AI流入は**実際より少なく出る**。",
    ]
    return out


def section(title: str, rows: list[dict], limit=15, extra=None) -> list[str]:
    out = [f"## {title}", ""]
    if not rows:
        out += ["該当なし（またはデータ不足）", ""]
        return out
    out += ["| 対象 | 表示 | クリック | CTR | 順位 |", "|---|---:|---:|---:|---:|"]
    for r in rows[:limit]:
        name = r["name"][:60]
        ctr = "不明" if r["ctr"] is None else f"{r['ctr']:.2f}%"
        pos = "不明" if r["position"] is None else f"{r['position']:.1f}"
        out.append(f"| {name} | {fmt(r['impressions'])} | {fmt(r['clicks'])} | {ctr} | {pos} |")
    if len(rows) > limit:
        out.append(f"| …ほか{len(rows)-limit}件 | | | | |")
    out.append("")
    if extra:
        out += extra + [""]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument("--gsc-queries")
    ap.add_argument("--gsc-pages")
    ap.add_argument("--ga4")
    ap.add_argument("--out")
    args = ap.parse_args()

    cfg_path = Path(os.environ.get("SEO_AIO_SITES") or (ROOT / "config" / "sites.json"))
    sites = json.loads(cfg_path.read_text(encoding="utf-8"))["sites"]
    if args.site not in sites:
        sys.exit(f"config/sites.json に『{args.site}』がありません")
    site = sites[args.site]
    brand = site.get("brand_terms") or []

    if not any([args.gsc_queries, args.gsc_pages, args.ga4]):
        sys.exit("CSVを1つ以上渡してください（--gsc-queries / --gsc-pages / --ga4）")

    md = [f"# 検索データの分析：{site['label']}", "",
          f"- 分析日：{date.today().isoformat()}",
          f"- 使ったファイル：" + ", ".join(
              Path(p).name for p in [args.gsc_queries, args.gsc_pages, args.ga4] if p),
          "",
          "> 検索ボリュームや難易度などの外部の数字は使っていない（手元に無い数字を作らないため）。",
          "> ここに出るのは**渡したCSVの範囲だけ**の事実。",
          ""]

    if args.ga4:
        md += ["## 集客の内訳（GA4）", ""] + ga4_channels(Path(args.ga4)) + [""]

    for label, path, kind in [("検索語", args.gsc_queries, "query"), ("ページ", args.gsc_pages, "page")]:
        if not path:
            continue
        rows = load_gsc(Path(path), kind)
        a = analyze(rows, brand)
        md += [f"# {label}の分析（{len(rows)}件）", "",
               f"- 表示回数の合計：{fmt(a['total_imp'])} ／ クリックの合計：{fmt(a['total_clicks'])}",
               ""]
        if a["median"]:
            md += ["自社データから出した順位帯ごとのクリック率（中央値）：", ""]
            md += ["| 順位帯 | CTR中央値 |", "|---|---:|"]
            for b in ["1〜3位", "4〜10位", "11〜20位", "21位以下", "不明"]:
                if b in a["median"]:
                    md.append(f"| {b} | {a['median'][b]:.2f}% |")
            md.append("")
        else:
            md += ["※ 件数が少なく、順位帯ごとのクリック率の中央値は出せなかった（推測しない）。", ""]

        md += section(
            f"表示は多いのにクリックが少ない{label}（表示{fmt(a['imp_line'])}以上・同じ順位帯の中央値の半分未満）",
            a["low_ctr"],
            extra=["**タイトルのせいと決めつけない。** 検索した人が求めているもの（無料/比較/料金）が"
                   "ページの中身と違うだけかもしれない。まず問い合わせ記録と突き合わせる。"])
        md += section(f"あと一歩の{label}（11〜20位）", a["almost"],
                      extra=["ここは**新規作成より既存ページの改善**が効きやすい層。"])

        if label == "検索語":
            bi, ni = sum_of(a["brand"], "impressions"), sum_of(a["nonbrand"], "impressions")
            md += ["## 自社名の検索と、それ以外", "",
                   f"- 自社名を含む検索：{len(a['brand'])}語／表示 {fmt(bi)}",
                   f"- それ以外の検索：{len(a['nonbrand'])}語／表示 {fmt(ni)}",
                   "",
                   "新規のお客さんに出会えているかは**それ以外の検索**で見る（自社名の検索は既に知っている人）。",
                   ""]

    md += ["---", "",
           "## この後にやること",
           "1. 上に出たページを、`context/business.md` の『受注したい仕事』と突き合わせて絞る",
           "2. 残ったものを `strategy/seo-aio.md` に仮説つきで登録する",
           "3. 1件だけ `tasks/SEO-xxx.md` を作り、合格条件を先に書く",
           ""]

    outdir = Path(args.out) if args.out else ROOT / "artifacts" / date.today().isoformat()
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / f"search_{args.site}.md"
    out.write_text("\n".join(md), encoding="utf-8")
    print(f"完了：{out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
