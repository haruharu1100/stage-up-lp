#!/usr/bin/env python3
"""道具が「正しく通す／正しく落とす」かを、偽サイトを立てて確かめる。

    python3 tests/run_tests.py

本物のサイトには一切つながない。127.0.0.1 に検査用のページを立て、
そこへ道具を向けて結果を確かめる（ネットが無くても実行できる）。

★合格させるためにこのテストを消す・弱めるのは禁止。
  落ちたら道具のほうを直す。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable

PASS, FAIL = [], []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(f"  {'OK  ' if ok else 'NG  '}{name}" + (f"\n        {detail}" if not ok and detail else ""))


# ───────── 検査用の偽サイト ─────────

LONG = "この検査用のページは、本文がテキストとして正しく取れているかを見るために、" \
       "十分な長さの文章を置いています。料金や申し込みの流れを、実際のページと同じように" \
       "文章で説明している状態を再現します。画像の中だけに文字がある状態だと、" \
       "検索エンジンにも生成AIにも中身が伝わらないため、ここでは必ず文章にしています。" * 2


def pages(base: str) -> dict[str, tuple[int, str, str]]:
    """path -> (status, content-type, body)"""
    good = f"""<!doctype html><html lang="ja"><head>
<meta charset="utf-8">
<title>料金と申し込みの流れ｜検査用ページ</title>
<meta name="description" content="検査用ページの説明文です。料金と申し込みの流れをまとめています。">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="{base}/good.html">
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"Article","headline":"料金と申し込みの流れ"}}
</script>
</head><body>
<h1>料金と申し込みの流れ</h1>
<p>{LONG}</p>
<img src="/a.png" alt="申し込みの流れの図">
<a href="/contact">無料で相談する</a>
<form action="/contact"><input name="q"><button>送信</button></form>
</body></html>"""

    bad = f"""<!doctype html><html><head>
<meta charset="utf-8">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="{base}/good.html">
<script type="application/ld+json">{{"@type":"Article", broken}}</script>
</head><body>
<h1>見出しA</h1><h1>見出しB</h1>
<p>短い。</p>
<img src="/b.png">
</body></html>"""

    contact = """<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>お問い合わせ</title></head><body><h1>お問い合わせ</h1></body></html>"""

    # 一覧ページ。記事名を「…」で省略して表示する（実サイトでよくある作り）。
    # 省略されているだけの見出しを「食い違い」と誤検知しないことを確かめるための材料。
    listing = f"""<!doctype html><html lang="ja"><head>
<meta charset="utf-8">
<title>記事の一覧｜検査用ページ</title>
<meta name="description" content="検査用の一覧ページです。">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="{base}/list.html">
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
 {{"@type":"Article","headline":"料金と申し込みの流れを徹底的に解説した長いほうの記事名"}},
 {{"@type":"CollectionPage","name":"検査カテゴリ 記事一覧"}},
 {{"@type":"Article","headline":"画面のどこにも書かれていない架空の記事名"}}]}}
</script>
</head><body>
<h1>検査カテゴリの記事一覧</h1>
<p>料金と申し込みの流れを徹底的に解…</p>
<p>{LONG}</p>
<img src="/c.png" alt="一覧">
<a href="/contact">無料で相談する</a>
</body></html>"""

    return {
        "/good.html": (200, "text/html; charset=utf-8", good),
        "/bad.html": (200, "text/html; charset=utf-8", bad),
        "/list.html": (200, "text/html; charset=utf-8", listing),
        "/contact": (200, "text/html; charset=utf-8", contact),
        "/gone.html": (404, "text/html; charset=utf-8", "<h1>ありません</h1>"),
        "/robots.txt": (200, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /secret\n"),
    }


class Handler(BaseHTTPRequestHandler):
    table: dict = {}

    def do_GET(self):  # noqa: N802
        status, ctype, body = self.table.get(self.path, (404, "text/html; charset=utf-8", "no"))
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):  # サーバのアクセスログは出さない
        pass


def start_server() -> tuple[ThreadingHTTPServer, str]:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base = f"http://127.0.0.1:{srv.server_port}"
    Handler.table = pages(base)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, base


def run(args: list[str], env: dict | None = None) -> subprocess.CompletedProcess:
    e = dict(os.environ)
    e.update(env or {})
    return subprocess.run([PY, *args], cwd=ROOT, env=e, capture_output=True, text=True)


# ───────── 各道具のテスト ─────────

def test_htmlfacts(base: str) -> None:
    print("\n[1] HTMLの読み取り部品")
    sys.path.insert(0, str(ROOT / "tools"))
    import htmlfacts

    f = htmlfacts.parse(pages(base)["/good.html"][2])
    check("タイトルを取れる", f.title == "料金と申し込みの流れ｜検査用ページ", f.title)
    check("正規URLを取れる", f.canonical == f"{base}/good.html", f.canonical)
    check("H1は1つ", f.h1 == ["料金と申し込みの流れ"], str(f.h1))
    check("altの有無を見分ける", f.images == [("/a.png", True)], str(f.images))
    check("フォームを数える", f.forms == 1, str(f.forms))
    data, err = htmlfacts.parse(pages(base)["/good.html"][2]).jsonld()[0]
    check("構造化データを読める", err is None and htmlfacts.jsonld_types(data) == ["Article"], str(err))
    _, err2 = htmlfacts.parse(pages(base)["/bad.html"][2]).jsonld()[0]
    check("壊れた構造化データを黙って捨てない", err2 is not None, "エラーが返っていない")
    scripts = htmlfacts.parse("<body>本文<script>var x=1</script></body>").text
    check("scriptの中身は本文に混ぜない", scripts == "本文", scripts)


def test_audit(base: str, tmp: Path, sites: Path) -> None:
    print("\n[2] ページ検査（audit_pages.py）")
    env = {"SEO_AIO_SITES": str(sites)}

    out = tmp / "audit_good"
    r = run(["tools/audit_pages.py", "testsite", "--urls", "/good.html", "--out", str(out)], env)
    md = (out / "audit_testsite.md").read_text(encoding="utf-8") if (out / "audit_testsite.md").exists() else ""
    check("正しいページは問題なしと判定", r.returncode == 0 and "問題は見つかりませんでした" in md,
          r.stdout + r.stderr + md[:400])

    out2 = tmp / "audit_bad"
    r2 = run(["tools/audit_pages.py", "testsite", "--urls", "/bad.html", "--out", str(out2)], env)
    md2 = (out2 / "audit_testsite.md").read_text(encoding="utf-8") if (out2 / "audit_testsite.md").exists() else ""
    for want in ["タイトルが無い", "説明文", "noindex", "正規URLが別ページ",
                 "見出し(H1)が2個", "本文がテキストで取れていない", "viewport",
                 "構造化データが壊れている", "altの無い画像"]:
        check(f"壊れたページで『{want}』を検出", want in md2, md2[:600])

    out3 = tmp / "audit_list"
    r_list = run(["tools/audit_pages.py", "testsite", "--urls", "/list.html", "--out", str(out3)], env)
    md3 = (out3 / "audit_testsite.md").read_text(encoding="utf-8") if (out3 / "audit_testsite.md").exists() else ""
    check("「…」で省略表示された見出しを食い違いにしない",
          r_list.returncode == 0 and "料金と申し込みの流れを徹底的に解説した長いほうの記事名" not in md3, md3[:600])
    check("助詞だけ違う言い回しを食い違いにしない",
          "検査カテゴリ 記事一覧" not in md3, md3[:600])
    check("画面に無い文言は食い違いとして検出",
          "架空の記事名" in md3, md3[:600])

    r3 = run(["tools/audit_pages.py", "testsite", "--urls", "https://example.com/", "--out", str(tmp / "x")], env)
    check("自社ドメイン以外は取得せず中止する",
          r3.returncode == 1 and "中止" in r3.stdout and "example.com" in r3.stdout, r3.stdout)


def test_ai_crawlers() -> None:
    print("\n[2b] 生成AIのクローラーを止めていないか（robots.txt）")
    sys.path.insert(0, str(ROOT / "tools"))
    import audit_pages

    audit_pages.WAIT_SEC = 0

    def with_robots(body: str) -> str:
        audit_pages.fetch = lambda url, _b=body: (200, url, _b, None)
        return "\n".join(audit_pages.ai_crawler_report("http://x/"))

    ok = with_robots("User-agent: *\nAllow: /\nDisallow: /secret\n")
    check("止めていなければ問題なしと出る", "止めていません" in ok, ok)

    # Cloudflareの「AIボット管理」を入れた時に実際に出る形
    cf = with_robots("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\n"
                     "User-agent: ClaudeBot\nDisallow: /\n")
    check("GPTBotの全面拒否を検出", "GPTBot" in cf and "AIの回答には出ません" in cf, cf)
    check("ClaudeBotの全面拒否を検出", "ClaudeBot" in cf, cf)
    check("全体向けのAllowを拒否と読み違えない", "`*`" not in cf, cf)

    grouped = with_robots("User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n")
    check("まとめ書きされた複数のAIクローラーを両方検出",
          "GPTBot" in grouped and "CCBot" in grouped, grouped)

    partial = with_robots("User-agent: GPTBot\nDisallow: /wp-admin/\n")
    check("一部フォルダだけの拒否は全面拒否と混同しない", "止めていません" in partial, partial)

    audit_pages.fetch = lambda url: (404, url, "", None)
    missing = "\n".join(audit_pages.ai_crawler_report("http://x/"))
    check("robots.txtが読めない時は「不明」と書く（勝手に判断しない）", "不明" in missing, missing)


def test_check_claims(tmp: Path) -> None:
    print("\n[3] 公開前チェック（check_claims.py）")
    claims = tmp / "claims.csv"
    claims.write_text(
        "id,主張,本文に書いてよい言い方,根拠,出典URL,確認日,使用可否,メモ\n"
        "T-001,導入は12社,導入は12社,契約書,,2026-09-09,可,\n",
        encoding="utf-8")

    ng = tmp / "ng.md"
    ng.write_text("必ず儲かる仕組みです。業界No.1の実績。今だけ半額。\n"
                  "I used this product every day.\n", encoding="utf-8")
    r = run(["tools/check_claims.py", str(ng), "--claims", str(claims)])
    for want in ["利益を約束", "最上級", "急かす", "体験"]:
        check(f"NG表現『{want}』で止まる", r.returncode == 1 and want in r.stdout, r.stdout[:500])

    num = tmp / "num.md"
    num.write_text("売上は37%増えました。\n", encoding="utf-8")
    r2 = run(["tools/check_claims.py", str(num), "--claims", str(claims)])
    check("台帳に無い数字で止まる", r2.returncode == 1 and "根拠が台帳に無い数字" in r2.stdout, r2.stdout[:400])

    ok = tmp / "ok.md"
    ok.write_text("導入は12社です。2026年9月9日に確認しました。9:00から受付します。\n", encoding="utf-8")
    r3 = run(["tools/check_claims.py", str(ok), "--claims", str(claims)])
    check("台帳にある数字と日付・時刻は通す", r3.returncode == 0, r3.stdout[:400])

    plain = tmp / "plain.md"
    plain.write_text("料金と申し込みの流れをまとめています。\n", encoding="utf-8")
    r4 = run(["tools/check_claims.py", str(plain), "--claims", str(claims)])
    check("問題のない文章は通す", r4.returncode == 0, r4.stdout[:400])


def test_verify_task(base: str, tmp: Path) -> None:
    print("\n[4] 合格条件チェック（verify_task.py）")
    good = tmp / "SEO-T01.md"
    good.write_text(f"""# SEO-T01 検査用

```合格条件
url: {base}/good.html
status: 200
noindex: false
canonical_self: true
mobile_viewport: true
must_contain: 料金と申し込みの流れ
must_not_contain: 今だけ
link_ok: {base}/contact
```
""", encoding="utf-8")
    r = run(["tools/verify_task.py", str(good)])
    check("条件を満たすページは合格", r.returncode == 0 and "合格" in r.stdout, r.stdout[:600])

    bad = tmp / "SEO-T02.md"
    bad.write_text(f"""# SEO-T02 検査用

```合格条件
url: {base}/bad.html
status: 200
noindex: false
canonical_self: true
mobile_viewport: true
must_contain: 存在しない文言
link_ok: {base}/gone.html
```
""", encoding="utf-8")
    r2 = run(["tools/verify_task.py", str(bad)])
    for want in ["noindex", "正規URL", "スマホ表示の設定 なし", "存在しない文言", "404"]:
        check(f"不合格を『{want}』で言い当てる", r2.returncode == 1 and want in r2.stdout, r2.stdout[:800])

    empty = tmp / "SEO-T03.md"
    empty.write_text("# SEO-T03\n合格条件を書き忘れた施策票\n", encoding="utf-8")
    r3 = run(["tools/verify_task.py", str(empty)])
    check("合格条件が無い施策票は不合格にする", r3.returncode == 1, r3.stdout[:400])

    tpl = run(["tools/verify_task.py", "tasks/TEMPLATE.md"])
    check("ひな形の［　］は検査せず不合格にする",
          tpl.returncode == 1 and "ひな形のまま" in tpl.stdout, tpl.stdout[:400])


def test_analyze(tmp: Path, sites: Path) -> None:
    print("\n[5] 検索データの分析（analyze_search.py）")
    q = tmp / "queries.csv"
    q.write_text(
        "上位のクエリ,クリック数,表示回数,CTR,掲載順位\n"
        "検査用ブランド,50,100,50%,1.2\n"
        "料金 相場,10,2000,0.5%,8.4\n"
        "比較 おすすめ,30,300,10%,7.1\n"
        "選び方 コツ,25,260,9.6%,6.2\n"
        "申し込み 方法,20,220,9.1%,5.5\n"
        "解約 手順,2,900,0.22%,15.3\n"
        "乗り換え 手順,1,800,0.13%,17.8\n",
        encoding="utf-8")
    ga = tmp / "ga4.csv"
    ga.write_text(
        "# ----------------------------------------\n"
        "# 開始日: 20260801\n"
        "セッションのデフォルト チャネル グループ,セッション数\n"
        "Organic Search,1200\n"
        "AI Assistant,80\n"
        "Direct,400\n",
        encoding="utf-8")

    out = tmp / "search"
    r = run(["tools/analyze_search.py", "--site", "testsite",
             "--gsc-queries", str(q), "--ga4", str(ga), "--out", str(out)],
            {"SEO_AIO_SITES": str(sites)})
    md = (out / "search_testsite.md").read_text(encoding="utf-8") if (out / "search_testsite.md").exists() else ""
    check("分析結果が出力される", r.returncode == 0 and md, r.stdout + r.stderr)
    check("集客＝Organic Search＋AI Assistantで足す", "1,280" in md, md[:800])
    check("遡って分類し直されない注意を必ず書く", "遡って分類し直されない" in md)
    check("あと一歩(11〜20位)を拾う", "解約 手順" in md.split("あと一歩")[-1][:600], md[-1500:])
    check("自社名の検索とそれ以外を分ける", "自社名を含む検索：1語" in md, md[-1200:])
    check("外部の推定値を作らない", "検索ボリュームや難易度などの外部の数字は使っていない" in md)


def test_repo_rules() -> None:
    print("\n[6] 運用ルールが道具に埋まっているか")
    agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    check("AGENTS.mdに他社サイトを巡回しない旨がある", "競合" in agents or "他社" in agents)
    cc = (ROOT / "tools" / "check_claims.py").read_text(encoding="utf-8")
    check("禁止語リストを消して通すなと明記", "禁止語リストを消して通す" in cc)
    csv_text = (ROOT / "sources" / "claims.csv").read_text(encoding="utf-8-sig")
    check("主張台帳に確認日の列がある", "確認日" in csv_text)


def main() -> int:
    srv, base = start_server()
    tmpdir = tempfile.TemporaryDirectory()
    tmp = Path(tmpdir.name)

    sites = tmp / "sites.json"
    sites.write_text(json.dumps({"sites": {"testsite": {
        "label": "検査用サイト",
        "base_url": base,
        "own_domains": [base.split("//")[1]],
        "brand_terms": ["検査用ブランド"],
        "cta": {"link_contains": ["/contact"]},
    }}}, ensure_ascii=False), encoding="utf-8")

    print(f"検査用の偽サイトを立てました: {base}")
    try:
        test_htmlfacts(base)
        test_audit(base, tmp, sites)
        test_ai_crawlers()
        test_check_claims(tmp)
        test_verify_task(base, tmp)
        test_analyze(tmp, sites)
        test_repo_rules()
    finally:
        srv.shutdown()
        tmpdir.cleanup()

    print("\n" + "─" * 50)
    print(f"合格 {len(PASS)} 件 ／ 不合格 {len(FAIL)} 件")
    if FAIL:
        for f in FAIL:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
