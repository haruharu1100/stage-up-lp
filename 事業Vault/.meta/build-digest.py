#!/usr/bin/env python3
# claims.jsonl と errors.md から DIGEST.md（検証済み原則の要約）を生成する。
# 週次統合ジョブの最後に呼ぶ想定。単体でも `python3 build-digest.py` で実行できる。

import json
from datetime import date, timedelta
from pathlib import Path

VAULT = Path(__file__).resolve().parent.parent
CLAIMS = VAULT / "20_KNOWLEDGE" / "claims.jsonl"
ERRORS = VAULT / "20_KNOWLEDGE" / "errors.md"
OUT = VAULT / "DIGEST.md"

CHAR_LIMIT = 1800          # 本文の目安上限（1500だと原則を1件足すだけで景表法などの既存原則が押し出されるため拡張）
MAX_PER_AREA = 8           # 領域ごとの最大件数
TIER_ORDER = {"一次": 0, "実測": 1, "運用": 2, "通説確度高": 3}
TIER_KEEP = set(TIER_ORDER.keys())  # 採用する tier

# 表示する領域の順序（ここに無い領域は後ろに回す）
AREA_ORDER = ["表現規制", "営業", "X運用", "ブログ/SEO", "ショート動画", "動画品質"]


def load_claims():
    rows = []
    if not CLAIMS.exists():
        return rows
    for line in CLAIMS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return [r for r in rows if r.get("tier") in TIER_KEEP]


def load_error_lines():
    if not ERRORS.exists():
        return []
    out = []
    for line in ERRORS.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("- [誤]"):
            out.append(s[2:])  # 先頭の "- " を除く
    return out


def build_body(claims, errors):
    today = date.today()
    nxt = today + timedelta(days=7)
    lines = []
    lines.append(f"<!-- 自動生成 / 最終更新: {today} / 次回更新: {nxt} -->")
    lines.append("")
    lines.append("# 検証済み原則（要約）")
    lines.append("")
    lines.append("## 絶対にやらないこと（検証で否定済み）")
    if errors:
        lines.extend(f"- {e.replace('[誤] ', '')}" for e in errors)
    else:
        lines.append("- （まだ否定済みの前提はありません）")
    lines.append("")

    by_area = {}
    for c in claims:
        by_area.setdefault(c.get("area", "その他"), []).append(c)

    ordered_areas = [a for a in AREA_ORDER if a in by_area]
    ordered_areas += [a for a in by_area if a not in AREA_ORDER]

    for area in ordered_areas:
        items = sorted(
            by_area[area],
            key=lambda c: (TIER_ORDER.get(c.get("tier"), 9), c.get("last_seen", "")),
        )[:MAX_PER_AREA]
        lines.append(f"## {area}")
        for c in items:
            lines.append(f"- [{c['tier']}] {c['claim']}")
        lines.append("")

    lines.append("---")
    lines.append(f"詳細: {CLAIMS}")
    lines.append("この要約と矛盾する判断をする場合は、必ず理由を述べること。")
    return "\n".join(lines) + "\n"


def trim_to_limit(claims, errors):
    # 本文が長すぎたら tier の低い（=優先度の低い）ものから削る
    body = build_body(claims, errors)
    while len(body) > CHAR_LIMIT and claims:
        claims.sort(key=lambda c: (-TIER_ORDER.get(c.get("tier"), 9), c.get("last_seen", "")))
        claims.pop(0)
        body = build_body(claims, errors)
    return body


def main():
    claims = load_claims()
    errors = load_error_lines()
    body = trim_to_limit(claims, errors)
    OUT.write_text(body, encoding="utf-8")
    print(f"生成完了: {OUT}  ({len(body)}文字 / claims {len(claims)}件 / errors {len(errors)}件)")


if __name__ == "__main__":
    main()
