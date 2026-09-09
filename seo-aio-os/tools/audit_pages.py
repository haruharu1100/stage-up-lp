#!/usr/bin/env python3
"""自社サイトのページを見て回り、「お客さんが止まる場所」を洗い出す。

使い方:
    python3 tools/audit_pages.py review-blog                # sitemapから最大30ページ
    python3 tools/audit_pages.py review-blog --limit 100
    python3 tools/audit_pages.py review-blog --urls a.html b.html
    python3 tools/audit_pages.py --file ページ一覧.txt --site review-blog

出るもの:
    artifacts/<日付>/audit_<サイト>.csv   … 1ページ1行の生データ
    artifacts/<日付>/audit_<サイト>.md    … 人が読む要約（問題の多い順）

★安全装置（外してはいけない）
    ・config/sites.json の own_domains に無いドメインは取得しない（他社サイトの巡回禁止）
    ・robots.txt の Disallow を尊重する
    ・1秒に1回まで
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from urllib.robotparser import RobotFileParser

sys.path.insert(0, str(Path(__file__).resolve().parent))
import htmlfacts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# HTTPヘッダは日本語を入れると送信時に落ちる（latin-1しか通らない）ため半角英数で書く
UA = "seo-aio-os/1.0 (self-audit of our own site)"
TIMEOUT = 20
WAIT_SEC = 1.0

# タイトルの目安。Googleは端末幅で省略するため「何文字にすれば上がる」規則ではない。
# 極端に短い/長いものだけを気づかせるための目安として使う。
TITLE_MIN, TITLE_MAX = 12, 60
TEXT_MIN = 300      # これ未満は「本文がテキストで取れていない」疑い


def load_site(name: str) -> dict:
    # テストからは別の設定ファイルを差し込めるようにする（本番設定を書き換えずに試すため）
    path = Path(os.environ.get("SEO_AIO_SITES") or (ROOT / "config" / "sites.json"))
    cfg = json.loads(path.read_text(encoding="utf-8"))
    sites = cfg["sites"]
    if name not in sites:
        sys.exit(f"config/sites.json に『{name}』がありません。あるのは: {', '.join(sites)}")
    return sites[name]


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
            charset = r.headers.get_content_charset() or "utf-8"
            return r.status, r.geturl(), body.decode(charset, "replace"), None
    except urllib.error.HTTPError as e:
        return e.code, url, "", None
    except Exception as e:
        return 0, url, "", f"{type(e).__name__}: {e}"


def sitemap_urls(sitemap_url: str, limit: int) -> list[str]:
    """sitemap.xmlからURLを集める。索引型（sitemapが入れ子）にも対応する。"""
    seen, out, queue = set(), [], [sitemap_url]
    while queue and len(out) < limit:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        status, _, body, err = fetch(url)
        time.sleep(WAIT_SEC)
        if status != 200 or not body:
            print(f"  sitemap取得できず: {url}（status={status} {err or ''}）")
            continue
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body)
        if "<sitemapindex" in body:
            queue.extend(locs)
        else:
            out.extend(locs)
    return out[:limit]


# 生成AIの回答に載るかどうかを左右するクローラー。
# robots.txt で止めていると、いくら記事を書いてもそのAIからは引用されない。
# Cloudflareの「AIボット管理」を有効にすると、自分で書いた覚えがなくても
# ここが全部Disallowになっていることがある（2026-09-09にblog.gorogorogacha.comで確認）。
AI_CRAWLERS = {
    "GPTBot": "ChatGPT（OpenAI）が中身を取りに来る",
    "OAI-SearchBot": "ChatGPTの検索で参照される",
    "ChatGPT-User": "利用者がChatGPTでリンクを開いた時",
    "ClaudeBot": "Claude（Anthropic）が中身を取りに来る",
    "Claude-SearchBot": "Claudeの検索で参照される",
    "PerplexityBot": "Perplexityで参照される",
    "Google-Extended": "GeminiやVertex AIでの利用（※Google検索の順位やAI Overviewsの表示可否には使われない）",
    "Applebot-Extended": "AppleのAI機能での利用",
    "meta-externalagent": "MetaのAIでの利用",
    "Amazonbot": "AmazonのAI・音声アシスタントでの利用",
    "CCBot": "Common Crawl（多くのAIの元データ）",
    "Bytespider": "ByteDance（TikTok系）のAI",
}

HEAD_LEN = 12      # 「…」で省略された見出しを拾うための先頭文字数
SIMILAR = 0.6      # 言い回しの小さな違いを許す割合


def ai_crawler_report(base_url: str) -> list[str]:
    """robots.txt を読んで、生成AIのクローラーを止めていないか見る。"""
    url = urllib.parse.urljoin(base_url, "/robots.txt")
    status, _, body, err = fetch(url)
    time.sleep(WAIT_SEC)
    if status != 200 or not body:
        return [f"- robots.txt を読めませんでした（{url} / status={status} {err or ''}）→ 不明"]

    # 連続する「User-agent:」行が1つのまとまり。そのあとの Disallow がその相手に効く。
    blocked: list[str] = []
    agents: list[str] = []
    in_agent_block = False
    for line in body.splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if not in_agent_block:
                agents = []
                in_agent_block = True
            agents.append(value)
            continue
        in_agent_block = False
        if key == "disallow" and value == "/":
            for a in agents:
                if a in AI_CRAWLERS and a not in blocked:
                    blocked.append(a)

    if not blocked:
        return ["- 生成AIのクローラーは止めていません（robots.txt 確認済み）"]
    out = ["- ⚠️ **robots.txt で生成AIのクローラーを止めています。"
           "このままでは記事を増やしてもAIの回答には出ません。**"]
    for a in blocked:
        out.append(f"    - `{a}` を全面拒否 … {AI_CRAWLERS[a]}")
    out.append("    - Cloudflareの「AIボット管理」を入れると自動でこうなることがあります。"
               "止めるかどうかは、無断学習を嫌う気持ちと、AIの回答に載りたい狙いのどちらを取るかで決めてください。")
    return out


def shown_on_page(value: str, text: str) -> bool:
    """構造化データの文言が、画面にも出ているとみなせるか。

    丸ごと一致だけを見ると、正しく作られたページを誤検知する（実サイトで確認・2026-09-09）。
      ・一覧ページは記事名を「…」で途中まで表示する
      ・見出しは「トレカの記事一覧」、構造化データは「トレカ 記事一覧」のような小さな差が出る
    ここで見たいのは『画面のどこにも無い話を構造化データにだけ書いていないか』なので、
    上の2つは通し、まるごと存在しないものだけを食い違いとして拾う。
    """
    v, t = re.sub(r"\s+", "", value), re.sub(r"\s+", "", text)
    if v in t:
        return True
    if len(v) >= HEAD_LEN and v[:HEAD_LEN] in t:
        return True
    m = difflib.SequenceMatcher(None, v, t, autojunk=False).find_longest_match(0, len(v), 0, len(t))
    return m.size >= len(v) * SIMILAR


def audit_one(url: str, site: dict, robots: RobotFileParser | None) -> dict:
    row = {
        "url": url, "状態": "", "最終URL": "", "エラー": "",
        "タイトル": "", "タイトル文字数": "", "説明文": "",
        "正規URL": "", "正規URLは自分自身": "", "noindex": "",
        "H1の数": "", "本文の文字数": "", "スマホ設定": "", "言語": "",
        "内部リンク": "", "外部リンク": "", "CTAリンク": "", "フォーム": "",
        "画像": "", "alt無し画像": "", "構造化データ": "", "問題": "",
    }
    problems = []

    if robots is not None and not robots.can_fetch(UA, url):
        row["状態"] = "巡回不可"
        row["問題"] = "robots.txtで禁止されているため取得しませんでした"
        return row

    status, final_url, html, err = fetch(url)
    row["状態"], row["最終URL"], row["エラー"] = status, final_url, err or ""
    if err or status != 200 or not html:
        problems.append(f"ページが開けない（status={status}）")
        row["問題"] = " / ".join(problems)
        return row

    f = htmlfacts.parse(html)

    row["タイトル"] = f.title
    row["タイトル文字数"] = len(f.title)
    row["説明文"] = f.meta_description
    row["正規URL"] = f.canonical
    row["noindex"] = "あり" if "noindex" in f.meta_robots else "なし"
    row["H1の数"] = len(f.h1)
    text = f.text
    row["本文の文字数"] = len(text)
    row["スマホ設定"] = "あり" if f.viewport else "なし"
    row["言語"] = f.lang
    row["フォーム"] = f.forms
    row["画像"] = len(f.images)
    row["alt無し画像"] = sum(1 for _, ok in f.images if not ok)

    host = urllib.parse.urlparse(final_url).netloc
    internal = external = 0
    cta = 0
    cta_patterns = (site.get("cta") or {}).get("link_contains") or []
    for href, _label in f.links:
        if not href or href.startswith(("#", "javascript:")):
            continue
        absolute = urllib.parse.urljoin(final_url, href)
        if urllib.parse.urlparse(absolute).netloc == host:
            internal += 1
        else:
            external += 1
        if any(p in absolute for p in cta_patterns):
            cta += 1
    row["内部リンク"], row["外部リンク"], row["CTAリンク"] = internal, external, cta

    # 正規URL（canonical）は「このページの正しい住所」。
    # 別ページを指していると、このページは検索結果から消える設計になる。
    if f.canonical:
        same = urllib.parse.urljoin(final_url, f.canonical).rstrip("/") == final_url.rstrip("/")
        row["正規URLは自分自身"] = "はい" if same else "いいえ"
        if not same:
            problems.append(f"正規URLが別ページを指している → {f.canonical}")
    else:
        row["正規URLは自分自身"] = "指定なし"

    types, mismatched = [], []
    for data, jerr in f.jsonld():
        if jerr:
            problems.append(f"構造化データが壊れている（{jerr}）")
            continue
        types.extend(htmlfacts.jsonld_types(data))
        for v in htmlfacts.jsonld_values(data):
            # 構造化データにしか無い文言は、AIにも読者にも「画面に無い話」に見える
            if len(v) >= 6 and not shown_on_page(v, text):
                mismatched.append(v)
    row["構造化データ"] = ",".join(sorted(set(types))) or "なし"
    if mismatched:
        problems.append("構造化データと画面の食い違い: " + " / ".join(sorted(set(mismatched))[:3]))

    if not f.title:
        problems.append("タイトルが無い")
    elif not (TITLE_MIN <= len(f.title) <= TITLE_MAX):
        problems.append(f"タイトルの長さが極端（{len(f.title)}文字）")
    if not f.meta_description:
        problems.append("説明文（meta description）が無い")
    if "noindex" in f.meta_robots:
        problems.append("noindex＝検索に出さない設定になっている")
    if len(f.h1) == 0:
        problems.append("見出し(H1)が無い")
    elif len(f.h1) > 1:
        problems.append(f"見出し(H1)が{len(f.h1)}個ある")
    if len(text) < TEXT_MIN:
        problems.append(f"本文がテキストで取れていない疑い（{len(text)}文字）")
    if not f.viewport:
        problems.append("スマホ表示の設定(viewport)が無い")
    if cta_patterns and cta == 0:
        problems.append("CTA（次の一歩）へのリンクが無い")
    if row["alt無し画像"]:
        problems.append(f"altの無い画像が{row['alt無し画像']}枚")

    row["問題"] = " / ".join(problems)
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("site", nargs="?", help="config/sites.json のキー")
    ap.add_argument("--site", dest="site_opt")
    ap.add_argument("--urls", nargs="*", default=[])
    ap.add_argument("--file", help="1行1URLのテキストファイル")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--out", help="出力先フォルダ（既定 artifacts/<日付>）")
    args = ap.parse_args()

    site_key = args.site or args.site_opt
    if not site_key:
        return _die("サイトを指定してください（例: python3 tools/audit_pages.py review-blog）")
    site = load_site(site_key)
    own = set(site.get("own_domains") or [])
    if not own:
        return _die(f"『{site_key}』に own_domains が設定されていません。自社ドメイン以外は巡回しません。")

    urls = list(args.urls)
    if args.file:
        urls += [l.strip() for l in Path(args.file).read_text(encoding="utf-8").splitlines() if l.strip()]
    if not urls:
        if not site.get("sitemap"):
            return _die("URLも sitemap も無いので、何を見ればよいか分かりません（推測で巡回しません）")
        print(f"sitemapを読みます: {site['sitemap']}")
        urls = sitemap_urls(site["sitemap"], args.limit)
        if not urls:
            return _die("sitemapからURLを1件も取得できませんでした")
    urls = [urllib.parse.urljoin(site["base_url"] + "/", u) for u in urls][: args.limit]

    # ★安全装置：自社ドメイン以外が1件でも混ざっていたら、何もせず止まる
    outside = sorted({urllib.parse.urlparse(u).netloc for u in urls} - own)
    if outside:
        return _die("自社ドメイン以外が含まれています。他社サイトは巡回しません → " + ", ".join(outside))

    robots = RobotFileParser()
    robots.set_url(urllib.parse.urljoin(site["base_url"], "/robots.txt"))
    try:
        robots.read()
    except Exception:
        robots = None
        print("  robots.txtが読めませんでした（取得は続けますが、禁止指定は確認できていません）")

    print(f"{len(urls)}ページを検査します（1秒に1ページ）")
    rows = []
    for i, u in enumerate(urls, 1):
        row = audit_one(u, site, robots)
        rows.append(row)
        mark = "!" if row["問題"] else "."
        print(f"  [{i}/{len(urls)}]{mark} {u}")
        time.sleep(WAIT_SEC)

    # 同じタイトルのページは、検索側から見ると「どれを出せばいいか分からない」状態
    seen = {}
    for r in rows:
        t = (r["タイトル"] or "").strip()
        if t:
            seen.setdefault(t, []).append(r["url"])
    for t, us in seen.items():
        if len(us) > 1:
            for r in rows:
                if r["タイトル"] == t:
                    r["問題"] = (r["問題"] + " / " if r["問題"] else "") + f"タイトルが他{len(us)-1}ページと同じ"

    outdir = Path(args.out) if args.out else ROOT / "artifacts" / date.today().isoformat()
    outdir.mkdir(parents=True, exist_ok=True)
    csv_path = outdir / f"audit_{site_key}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    ng = [r for r in rows if r["問題"]]
    lines = [
        f"# ページ検査：{site['label']}",
        "",
        f"- 検査日：{date.today().isoformat()}",
        f"- 検査したページ数：{len(rows)}",
        f"- 問題が見つかったページ：{len(ng)}",
        "",
        "> この検査は「ページが正しく作れているか」を見るもので、"
        "順位や集客が増えるかは分かりません。",
        "",
        "## 生成AIから読めるか（robots.txt）",
        "",
    ] + ai_crawler_report(site["base_url"]) + [
        "",
        "## 直す候補（問題の多い順）",
        "",
    ]
    for r in sorted(ng, key=lambda x: -len(x["問題"].split(" / "))):
        lines.append(f"### {r['url']}")
        lines.append(f"- タイトル：{r['タイトル'] or '（無し）'}")
        for p in r["問題"].split(" / "):
            lines.append(f"- ⚠️ {p}")
        lines.append("")
    if not ng:
        lines.append("問題は見つかりませんでした。")
        lines.append("")
    md_path = outdir / f"audit_{site_key}.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"\n完了：{len(ng)}/{len(rows)} ページに直す候補あり")
    print(f"  {csv_path}")
    print(f"  {md_path}")
    return 0


def _die(msg: str) -> int:
    print("中止：" + msg)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
