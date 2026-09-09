#!/usr/bin/env python3
"""施策票に書いた「合格条件」を、公開中のページで実際に確かめる。

    python3 tools/verify_task.py tasks/SEO-001.md
    python3 tools/verify_task.py tasks/*.md

やること：施策票の中の ```合格条件 ブロックを読み、そこに書いてある通りに
本物のページを取得して合否を出す。全部通れば 0、1つでも落ちれば 1 を返す。

★合格させるために合格条件を消す・緩めるのは禁止。
  落ちたらページのほうを直す。条件が間違っていた時だけ、理由を書いて条件を直す。

書き方（url が出てくるたびに、そのURL用の検査が1つ始まる）:

    url: https://example.com/pricing
    status: 200
    noindex: false
    canonical_self: true
    mobile_viewport: true
    must_contain: 初期費用0円
    must_not_contain: 今だけ
    link_ok: https://example.com/contact
"""

from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import htmlfacts  # noqa: E402

# HTTPヘッダは日本語を入れると送信時に落ちる（latin-1しか通らない）ため半角英数で書く
UA = "seo-aio-os/1.0 (self-check of our own pages)"
TIMEOUT = 20
WAIT_SEC = 1.0

BLOCK = re.compile(r"```\s*合格条件\s*\n(.*?)```", re.S)
MULTI_KEYS = {"must_contain", "must_not_contain", "link_ok"}
KNOWN_KEYS = MULTI_KEYS | {"url", "status", "noindex", "canonical_self", "mobile_viewport"}
PLACEHOLDER = re.compile(r"[［\[].*[］\]]")     # ひな形のままの ［ここに書く］ を検査に混ぜない


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


def parse_conditions(text: str) -> tuple[list[dict], list[str]]:
    """施策票から検査の一覧を作る。読めない行は黙って捨てず、warnings に残す。"""
    blocks = BLOCK.findall(text)
    if not blocks:
        return [], ["合格条件のブロックがありません（```合格条件 で囲んで書く）"]

    checks: list[dict] = []
    warnings: list[str] = []
    current: dict | None = None

    for block in blocks:
        for raw in block.splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if ":" not in line:
                warnings.append(f"読めない行（「キー: 値」の形にする）: {line}")
                continue
            key, value = line.split(":", 1)
            key, value = key.strip().lower(), value.strip()
            if key not in KNOWN_KEYS:
                warnings.append(f"知らないキー: {key}")
                continue
            if not value or PLACEHOLDER.search(value):
                warnings.append(f"ひな形のまま／空欄なので検査しません: {line}")
                continue

            if key == "url":
                current = {"url": value, "status": 200, "must_contain": [],
                           "must_not_contain": [], "link_ok": []}
                checks.append(current)
                continue
            if current is None:
                warnings.append(f"url より前に書かれているので検査できません: {line}")
                continue
            if key in MULTI_KEYS:
                current[key].append(value)
            elif key == "status":
                if value.isdigit():
                    current["status"] = int(value)
                else:
                    warnings.append(f"status は数字で書く: {line}")
            else:
                current[key] = value.lower() in ("true", "yes", "1", "はい")
    return checks, warnings


def run_check(c: dict) -> list[tuple[bool, str]]:
    """1URL分を検査して [(合否, 説明), ...] を返す。"""
    results: list[tuple[bool, str]] = []
    url = c["url"]

    status, final_url, html, err = fetch(url)
    time.sleep(WAIT_SEC)
    if err:
        results.append((False, f"ページを取得できません（{err}）"))
        return results
    results.append((status == c["status"], f"応答 {status}（期待 {c['status']}）"))
    if status != c["status"] or not html:
        return results

    f = htmlfacts.parse(html)
    text = f.text

    if "noindex" in c:
        has = "noindex" in f.meta_robots
        want = c["noindex"]
        results.append((has == want,
                        f"noindex は{'あり' if has else 'なし'}"
                        f"（期待 {'あり' if want else 'なし＝検索に出る'}）"))

    if c.get("canonical_self"):
        if not f.canonical:
            results.append((False, "正規URL(canonical)の指定がありません"))
        else:
            same = urllib.parse.urljoin(final_url, f.canonical).rstrip("/") == final_url.rstrip("/")
            results.append((same, f"正規URL {'自分自身' if same else '別ページを指している → ' + f.canonical}"))

    if c.get("mobile_viewport"):
        results.append((bool(f.viewport), f"スマホ表示の設定 {'あり' if f.viewport else 'なし'}"))

    for want in c["must_contain"]:
        results.append((want in text, f"「{want}」が表示されている"))
    for ng in c["must_not_contain"]:
        results.append((ng not in text, f"「{ng}」が残っていない"))

    hrefs = {urllib.parse.urljoin(final_url, h) for h, _ in f.links if h}
    for link in c["link_ok"]:
        target = urllib.parse.urljoin(final_url, link)
        s, _, _, e = fetch(target)
        time.sleep(WAIT_SEC)
        linked = target in hrefs or target.rstrip("/") in {h.rstrip("/") for h in hrefs}
        note = "" if linked else "（※このページからは貼られていません）"
        results.append((s == 200, f"リンク先が開ける {target} → {s or e}{note}"))

    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tasks", nargs="+", help="施策票のファイル（tasks/SEO-001.md）")
    args = ap.parse_args()

    failed = 0
    checked = 0
    for p in args.tasks:
        path = Path(p)
        if not path.exists():
            print(f"見つかりません: {p}")
            failed += 1
            continue
        checks, warnings = parse_conditions(path.read_text(encoding="utf-8"))
        print(f"\n=== {path} ===")
        for w in warnings:
            print(f"  注意: {w}")
        if not checks:
            print("  検査できる合格条件が1つもありません → 未検証のまま公開しない")
            failed += 1
            continue

        for c in checks:
            print(f"\n  {c['url']}")
            for ok, msg in run_check(c):
                checked += 1
                print(f"    {'OK  ' if ok else 'NG  '}{msg}")
                if not ok:
                    failed += 1

    print()
    if failed:
        print(f"不合格：{failed} 件（検査 {checked} 件）。ページを直してから、もう一度実行してください。")
        return 1
    print(f"合格：{checked} 件すべて条件どおりです。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
