#!/usr/bin/env python3
"""公開前に、文章を機械で点検する。

止めるのは3種類だけ。
  1. 景品表示法に触れる言い方（断定・誇大・最上級・二重価格・煽り）
  2. 主張台帳 sources/claims.csv に無い数字や実績（＝根拠のない数字）
  3. 使っていない商品を「使った」と書く体験談のふり（AIキャラ運用のFTCルール）

使い方:
    python3 tools/check_claims.py 記事.md
    python3 tools/check_claims.py ../affiliate/lp        # フォルダごと
    python3 tools/check_claims.py 記事.md --claims sources/claims.csv

★このスクリプトの禁止語リストを消して通すのが、いちばんやってはいけない直し方。
  引っかかったら文章のほうを直す。
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_EXT = {".md", ".mdx", ".html", ".htm", ".txt", ".ts", ".tsx", ".jsx", ".js", ".json"}

# ───────── 1. 使ってはいけない言い方（resto-os-lp の check-claims.mjs を土台に統一） ─────────
BANNED = [
    (r"必ず(儲|もう)か", "利益を約束する表現は景品表示法で不可"),
    (r"絶対に?(儲|もう)か", "利益を約束する表現は景品表示法で不可"),
    (r"確実に(売上|利益|儲|集客|上位)", "効果を約束する表現は不可"),
    (r"[0-9０-９]+ ?[%％](アップ|増|向上|改善)(します|する|できます|保証)", "効果の数値約束は不可"),
    (r"売上が?[0-9０-９]+ ?[%％]ア?ッ?プ", "根拠のない数値効果の断定は不可"),
    (r"(検索|順位).{0,6}(1位|上位).{0,6}(保証|確約|必ず)", "順位を保証する表現は不可"),
    (r"業界(No\.?1|ナンバーワン|一)", "客観的な根拠がない最上級表現は不可"),
    (r"日本一|世界一|唯一無二", "客観的な根拠がない最上級表現は不可"),
    (r"損は?しません|失敗しません|リスクはありません|リスクなし", "リスクがないと断定するのは不可"),
    (r"通常価格[^。]{0,12}[→⇒]", "根拠のない二重価格の表示は不可"),
    (r"定価[0-9０-９,，]+円[^。]{0,6}のところ", "根拠のない二重価格の表示は不可"),
    (r"今だけ|本日限り|期間限定価格|残り[0-9０-９]+(名|店|枠)", "購入を急かす煽りは不可"),
    (r"先着[0-9０-９]+(名|店|社)様?限定", "購入を急かす煽りは不可"),
    (r"カウントダウン", "購入を急かす演出は不可"),
    (r"AIが原因を(特定|突き止め|判定)", "AIは相関を出すだけ。原因の断定はさせない"),
    (r"AIが(最適|正解)を(判断|決定)します", "最後に決めるのは人、という設計に反する"),
]

# ───────── 2. 体験談のふり（使っていない商品を「使った」と書かない） ─────────
FAKE_EXPERIENCE = [
    (r"\bI (used|tried|tested|bought)\b", "使っていない商品の実体験主張は不可（客観比較なら可）"),
    (r"\bWhen I (traveled|visited|stayed)\b", "していない体験の主張は不可"),
    (r"(実際に)?(使ってみ|試してみ|泊まってみ)(た|ました)", "体験していないなら書けない。客観比較の書き方にする"),
]

# ───────── 3. 根拠のいる数字 ─────────
# 「30%」「3倍」「1,200円」「12社」のように、事実として読まれる数字を拾う。
NUMBER_PATTERNS = [
    r"[0-9０-９][0-9０-９,，\.]* ?[%％]",
    r"[0-9０-９][0-9０-９,，\.]* ?倍",
    r"[0-9０-９][0-9０-９,，\.]* ?円",
    r"[0-9０-９][0-9０-９,，\.]* ?(社|件|名|店舗|人)",
    r"[0-9０-９][0-9０-９,，\.]* ?(時間|分)(短縮|削減)",
]
# 数字でも根拠がいらないもの（日付・時刻・箇条書き番号・年）
NUMBER_SKIP = re.compile(r"(20[0-9]{2}年|[0-9]{1,2}月|[0-9]{1,2}日|[0-9]{1,2}:[0-9]{2})")

CODE_LINE = re.compile(r"^\s*(//|#|\*|/\*)")


def load_claims(path: Path) -> list[str]:
    """主張台帳から「使ってよい」と承認された文字列を集める。"""
    if not path.exists():
        return []
    ok = []
    with path.open(encoding="utf-8-sig") as fp:
        for row in csv.DictReader(fp):
            if (row.get("使用可否") or "").strip() != "可":
                continue
            for key in ("主張", "本文に書いてよい言い方"):
                v = (row.get(key) or "").strip()
                if v and not v.startswith("［"):
                    ok.append(v)
    return ok


def normalize(s: str) -> str:
    z2h = str.maketrans("０１２３４５６７８９％，．", "0123456789%,.")
    return s.translate(z2h).replace(",", "").replace(" ", "")


def check_text(text: str, approved: list[str], rel: str, strict_numbers: bool) -> list[str]:
    problems = []
    approved_norm = [normalize(a) for a in approved]

    for i, line in enumerate(text.splitlines(), 1):
        t = line.strip()
        if not t or CODE_LINE.match(t):
            continue

        for pat, why in BANNED:
            if re.search(pat, line):
                problems.append(f"{rel}:{i}  使えない表現：{why}\n      {t[:110]}")
        for pat, why in FAKE_EXPERIENCE:
            if re.search(pat, line, re.IGNORECASE):
                problems.append(f"{rel}:{i}  体験の偽装：{why}\n      {t[:110]}")

        if not strict_numbers:
            continue
        for pat in NUMBER_PATTERNS:
            for m in re.finditer(pat, line):
                token = m.group(0)
                around = line[max(0, m.start() - 8): m.end() + 8]
                if NUMBER_SKIP.search(around):
                    continue
                tok = normalize(token)
                if any(tok in a for a in approved_norm):
                    continue
                problems.append(
                    f"{rel}:{i}  根拠が台帳に無い数字：{token}\n"
                    f"      {t[:110]}\n"
                    f"      → sources/claims.csv に「主張・根拠・出典・確認日・使用可否=可」を登録するか、数字を消す"
                )
    return problems


def collect(paths: list[str]) -> list[Path]:
    files = []
    for p in paths:
        path = Path(p)
        if path.is_dir():
            for f in sorted(path.rglob("*")):
                if f.is_file() and f.suffix.lower() in TARGET_EXT and "node_modules" not in f.parts:
                    files.append(f)
        elif path.is_file():
            files.append(path)
        else:
            print(f"見つかりません: {p}")
    return files


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+", help="点検するファイルかフォルダ")
    ap.add_argument("--claims", default=str(ROOT / "sources" / "claims.csv"))
    ap.add_argument("--no-numbers", action="store_true", help="数字の根拠チェックを外す（推奨しない）")
    args = ap.parse_args()

    approved = load_claims(Path(args.claims))
    files = collect(args.paths)
    if not files:
        print("点検対象のファイルがありません")
        return 1

    problems = []
    for f in files:
        if f.name == Path(__file__).name:      # このスクリプト自身は対象外（禁止語一覧が引っかかる）
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            problems.append(f"{f}: 読めません（{e}）")
            continue
        problems += check_text(text, approved, str(f), not args.no_numbers)

    if problems:
        print("\n公開前チェックで問題が見つかりました。直してから公開してください。\n")
        for p in problems:
            print("  - " + p + "\n")
        print(f"合計 {len(problems)} 件（点検 {len(files)} ファイル／台帳の承認済み主張 {len(approved)} 件）\n")
        return 1

    print(f"公開前チェック OK（{len(files)} ファイル／台帳の承認済み主張 {len(approved)} 件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
