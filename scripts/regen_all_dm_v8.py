#!/usr/bin/env python3
"""
data/morika_list.json の全168社の dm_morika を新ルール（v8 短文）で再生成
"""
import os, sys, json, re
from datetime import datetime

ROOT = "/Volumes/ORICO/保存用/hp用/hp-auto-system"
EXISTING_JSON = f"{ROOT}/data/morika_list.json"

# import 保護: 退避→import→復元
print("[import保護] morika_list.json を退避中…")
with open(EXISTING_JSON, encoding="utf-8") as f:
    _saved = f.read()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_morika_pipeline import build_dm_morika

print("[import保護] 復元中…")
with open(EXISTING_JSON, "w", encoding="utf-8") as f:
    f.write(_saved)

# 元データ読込
with open(EXISTING_JSON, encoding="utf-8") as f:
    j = json.load(f)

records = j.get("records", [])
print(f"対象: {len(records)} 件")

# 全DM再生成
lengths = []
samples = []
for r in records:
    name = r.get("name", "")
    addr = r["row"][2] if len(r.get("row", [])) > 2 else ""
    url  = r["row"][9] if len(r.get("row", [])) > 9 else ""
    industry = r["row"][5] if len(r.get("row", [])) > 5 else "汎用コーポレート"

    dm_new = build_dm_morika(name, addr, url, industry)
    r["dm_morika"] = dm_new
    lengths.append(len(dm_new))

    if r["no"] in (201, 256, 312):
        samples.append((r["no"], name, industry, dm_new))

# 統計
import statistics
print(f"\n📊 DM文字数:")
print(f"   最小: {min(lengths)}字")
print(f"   最大: {max(lengths)}字")
print(f"   平均: {statistics.mean(lengths):.0f}字")
print(f"   中央値: {statistics.median(lengths):.0f}字")

# レンジチェック
in_range = sum(1 for L in lengths if 600 <= L <= 1000)
print(f"   600〜1000字に収まる: {in_range}/{len(lengths)} 件")

# 必須文言チェック
missing_morika = sum(1 for r in records if "株式会社MORIKA" not in r["dm_morika"])
missing_qr = sum(1 for r in records if "同封のQRコード" not in r["dm_morika"])
missing_5man = sum(1 for r in records if "5万円" not in r["dm_morika"])
missing_line = sum(1 for r in records if "https://line.me/R/ti/p/@015vzsdb" not in r["dm_morika"])
missing_sample = sum(1 for r in records if "サンプル" not in r["dm_morika"])
print(f"\n📝 必須文言チェック (欠けてる件数):")
print(f"   株式会社MORIKA: {missing_morika}")
print(f"   同封のQRコード: {missing_qr}")
print(f"   5万円: {missing_5man}")
print(f"   公式LINE URL: {missing_line}")
print(f"   サンプル: {missing_sample}")

# JSON出力
j["generated_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
with open(EXISTING_JSON, "w", encoding="utf-8") as f:
    json.dump(j, f, ensure_ascii=False, separators=(',', ':'))
print(f"\n✅ JSON更新: {EXISTING_JSON}")
print(f"   ファイルサイズ: {os.path.getsize(EXISTING_JSON):,} bytes")

# サンプル出力
print(f"\n📋 サンプル3社:")
for no, name, ind, dm in samples:
    print(f"\n--- m{no} {name} ({ind}) [{len(dm)}字] ---")
    print(dm)
