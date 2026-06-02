#!/usr/bin/env python3
"""
MORIKA第3弾 57社追加処理
- /tmp/morika3_passed.tsv 入力（4バッチ統合済み + 3年フィルタ通過）
- 管理番号 312〜 を割当（既存 m201-m311 = 111社の続き）
- LP生成、auth.js追加、morika_list.json 追記
- HTTP 200確認用にslugリスト出力
"""
import os, re, json
from datetime import datetime
import sys

ROOT = "/Volumes/ORICO/保存用/hp用/hp-auto-system"
INPUT_TSV = "/tmp/morika3_passed.tsv"
EXISTING_JSON = f"{ROOT}/data/morika_list.json"
OUT_JSON = EXISTING_JSON
TODAY = "2026-06-02"
AUTH_JS_PATH = f"{ROOT}/api/auth.js"

# ============================================================
# build_morika_pipeline.py は import 時に副作用（JSON書き換え）を起こすので、
# 重要ファイルを退避してから import し、必要な関数/定数だけ取り出して復元する
# ============================================================
print("[import保護] morika_list.json と auth.js をメモリ退避中…")
with open(EXISTING_JSON, encoding="utf-8") as f:
    _saved_morika_json = f.read()
with open(AUTH_JS_PATH, encoding="utf-8") as f:
    _saved_auth_js = f.read()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_morika_pipeline import (
    PALETTES, HERO_COPIES, BUSINESS_DESCRIPTIONS, SERVICES, INDUSTRY_LONG,
    classify_industry, build_zip_map, add_zip, ZIP_PREFIX,
    extract_region, build_dm_morika, assign_design, gen_lp_html, HERO_IMGS,
    PROP_DIR, AUTH_JS, SALES_JSON,
)

print("[import保護] 退避ファイルを復元中…")
with open(EXISTING_JSON, "w", encoding="utf-8") as f:
    f.write(_saved_morika_json)
with open(AUTH_JS_PATH, "w", encoding="utf-8") as f:
    f.write(_saved_auth_js)
print("[import保護] 復元完了。以降の処理は退避前の状態で実行されます。\n")

# ============================================================
# slug 生成
# ============================================================
def make_slug(idx, name, hojin):
    base = re.sub(r"^(株式会社|有限会社|合同会社|合名会社|有限責任事業組合)", "", name)
    base = re.sub(r"(株式会社|合同会社)$", "", base)
    # 英字+数字+ハイフン抽出
    en = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]*", base)
    if en:
        slug = "-".join(en).lower()[:30]
        slug = re.sub(r"-+", "-", slug).strip("-")
    else:
        roman_map = {
            "エヌエスアール":"nsr","エヌ":"n","エフ":"f","エム":"m","エル":"l",
            "エヌケイユー":"nku","オーエス":"os","オーケー":"ok","オーヴィット":"ovit",
            "オーサカ":"osaka","オーギュスト":"august","オークス":"oaks",
            "オータム":"autumn","エモーション":"emotion","エンフロー":"enflow",
            "エンブリッジ":"enbridge","エンリンク":"enlink","エンカレント":"encurrent",
            "エミリ":"emily","エフ・ケイ":"f-k","エム・アート":"m-art",
            "エムズライフ":"ms-life","エムズラボ":"ms-lab","エムティ":"mt",
            "エムテック":"mtech","エムスマイル":"m-smile","エムケイピー":"mkp",
            "エルアール":"l-r","エルピス":"elpis","エルフューズ":"l-fuse",
            "エルリープ":"el-leap","エルカハウス":"elcahouse",
            "ELシステム":"el-system","オーケー":"ok","オーエス":"os",
            "オージャンクション":"o-junction","オーサカステンレス":"osaka-sus",
            "オージャンクション":"o-junction","Nトラスト":"n-trust",
            "M-STYLE":"m-style","M-Maketh":"m-maketh",
            "Epiphany":"epiphany","EFFECTORY":"effectory","Area27":"area27",
            "緑":"midori","恵比寿":"ebisu","遠山":"toyama","鳥飛":"tobi",
            "エヌ・ケイ・エス":"nks","エヌ・ユー・ピー":"nup","エヌケイ":"nk",
            "エヌディーケー":"ndk","エービー":"ab","エヌティ":"nt",
        }
        slug = None
        for k, v in roman_map.items():
            if k in name:
                slug = v
                break
        if not slug:
            slug = f"co-{hojin[-6:]}"
    return f"m{idx:03d}-{slug}"

# ============================================================
# 入力読込
# ============================================================
companies = []
with open(INPUT_TSV, encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line: continue
        parts = line.split("\t")
        if len(parts) < 4: continue
        hojin, name, addr, established = parts[0], parts[1], parts[2], parts[3]
        companies.append({"hojin": hojin, "name": name, "addr": addr, "established": established})

print(f"入力{len(companies)}社処理開始")

# 既存JSON
with open(EXISTING_JSON, encoding="utf-8") as f:
    existing = json.load(f)
existing_records = existing.get("records", [])
existing_max_no = max((r.get("no", 0) for r in existing_records), default=311)
print(f"既存JSON: {len(existing_records)}社, 最大管理番号: {existing_max_no}")

# 重複判定セット
existing_keys = set()
existing_hojin = set()
for r in existing_records:
    name = r.get("name", "").strip()
    addr = r["row"][2] if len(r.get("row", [])) > 2 else ""
    if name:
        existing_keys.add(name + "|" + addr)
        existing_keys.add(name)
    hojin = r.get("hojin", "")
    if hojin:
        existing_hojin.add(hojin)

# 郵便番号マッピング
zmap = build_zip_map()

# 業種・住所処理 + slug 割当
start_no = existing_max_no + 1  # 312
processed = []
dup_count = 0
for i, c in enumerate(companies):
    name = c["name"].strip()
    addr = c["addr"].strip()
    keyNA = name + "|" + addr
    if keyNA in existing_keys or name in existing_keys or c["hojin"] in existing_hojin:
        dup_count += 1
        continue
    c["mgmt_no"] = start_no + len(processed)
    c["slug"] = make_slug(c["mgmt_no"], name, c["hojin"])
    c["industry"] = classify_industry(name, c["slug"])
    c["addr_z"] = add_zip(addr, zmap)
    c["url"] = f"https://stage-up-lp.vercel.app/{c['slug']}"
    processed.append(c)
    existing_keys.add(keyNA)
    existing_keys.add(name)
    existing_hojin.add(c["hojin"])

print(f"重複スキップ: {dup_count} 件")
print(f"処理対象: {len(processed)} 件")

# 業種内訳
from collections import Counter
print(f"\n業種内訳:")
for ind, cnt in Counter(c["industry"] for c in processed).most_common():
    print(f"  {ind}: {cnt}")

# slugチェック（重複しないか）
slugs = [c["slug"] for c in processed]
if len(slugs) != len(set(slugs)):
    print("⚠️ slug重複あり！")
    from collections import Counter
    for s, n in Counter(slugs).items():
        if n > 1:
            print(f"   {s}: {n}回")
else:
    print(f"✅ slug全件ユニーク")

# LP生成
for c in processed:
    path = f"{PROP_DIR}/{c['slug']}.html"
    with open(path, "w", encoding="utf-8") as f:
        f.write(gen_lp_html(c))
print(f"\n✅ LP生成完了: {len(processed)} 件")

# auth.js 追加
with open(AUTH_JS, encoding="utf-8") as f:
    auth_src = f.read()
new_entries = []
for c in processed:
    if f'"{c["slug"]}"' not in auth_src:
        new_entries.append(f'  "{c["slug"]}":'.ljust(40) + f' SAMPLE_AUTH,  // {c["name"]} / {c["industry"]}')
if new_entries:
    insert_block = f"\n  // ─── MORIKA第3弾 {len(new_entries)}社追加 (312-{start_no+len(processed)-1}) ───\n" + "\n".join(new_entries) + "\n"
    marker = "  // ─── LP作成しない"
    if marker in auth_src:
        new_auth = auth_src.replace(marker, insert_block + "\n" + marker)
    else:
        new_auth = auth_src.replace("};", insert_block + "};", 1)
    with open(AUTH_JS, "w", encoding="utf-8") as f:
        f.write(new_auth)
    print(f"✅ auth.js に {len(new_entries)} slug追加")

# JSON 追加
new_records = []
for c in processed:
    new_row = [
        c["mgmt_no"], c["name"], c["addr_z"], "", "無", c["industry"],
        "", "", "", c["url"],
    ]
    dm_long = build_dm_morika(c["name"], c["addr_z"], c["url"], c["industry"])
    new_records.append({
        "no": c["mgmt_no"],
        "hojin": c["hojin"],
        "name": c["name"],
        "row": new_row,
        "dm_morika": dm_long,
        "established": c["established"],
    })

# 既存 + 新規 でJSON更新
existing["records"] = existing_records + new_records
existing["count"] = len(existing["records"])
existing["generated_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(existing, f, ensure_ascii=False, separators=(',', ':'))

print(f"\n✅ JSON更新: {OUT_JSON}")
print(f"   全レコード数: {len(existing['records'])} ({len(existing_records)} + {len(new_records)})")
print(f"   ファイルサイズ: {os.path.getsize(OUT_JSON):,} bytes")
if new_records:
    print(f"   新規DM長文 平均: {sum(len(r['dm_morika']) for r in new_records)//len(new_records)}字")

# slugリスト出力
slugs_for_check = [c["slug"] for c in processed]
with open("/tmp/morika3_new_slugs.txt", "w") as f:
    f.write("\n".join(slugs_for_check))
print(f"\n新規slug一覧: /tmp/morika3_new_slugs.txt ({len(slugs_for_check)}件)")
