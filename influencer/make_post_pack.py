#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""キャラの写真から「すぐ投稿できるパック」を自動生成する。

各写真に対して Claude API で
  ・日本語キャプション
  ・ハッシュタグ
  ・（たまに）誘導先（persona.json の funnel）への自然な案内文
を作り、日付フォルダに写真とテキスト、投稿カレンダーCSVを出力する。

--persona / --char / --photo-dir / --prefix でキャラを切り替えられる。
既定はあおい（persona.json / character.json / output / aoi_）。

健全運用のみ。露出・性的表現・誇大表現・なりすまし課金はしない。
"""
import os
import csv
import json
import glob

from isolation_guard import 素材フォルダを検査する, 画像が健全側のものか確かめる
import link_builder as 誘導
import argparse
import datetime
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PACK_ROOT = os.path.join(HERE, "post_packs")

API_URL = "https://api.anthropic.com/v1/messages"


def load_env():
    env = {}
    for p in (os.path.join(REPO, "automation", ".env"),):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env


def call_claude(api_key, model, prompt):
    body = json.dumps({
        "model": model,
        "max_tokens": 700,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, headers={
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return "".join(b.get("text", "") for b in data.get("content", []))


def build_prompt(persona, scene_hint, do_cta, 設定, テーマ=""):
    """投稿文づくりの指示。

    ★誘導ありの回でも、AIには生のURLを書かせない。
      本文には目印（{{CTA}}）だけを置かせ、あとから媒体ごとに差し替える。
      理由: Instagram・TikTokは本文のURLがリンクにならないため、
      URLを本文へ直書きする前提だと、そもそも成立しない。
    """
    f = persona["funnel"]
    目印 = 設定["CTAの目印"]
    広告設定 = 設定["広告投稿"]

    if do_cta:
        cta_line = (
            f"この投稿は『広告投稿』です。{f['target_name']}（{f['target_desc']}）への案内を入れてください。"
            + (f"今回のテーマ: {テーマ}。" if テーマ else "")
            + f"ただし★URLは絶対に書かないでください。案内文の最後に、目印として {目印} という文字列だけを"
              "1行で置いてください（あとで媒体ごとに正しいリンク文へ差し替えます）。"
            + f"案内の方針: {f.get('cta_note', '売り込み調にしない。')}"
            + "★あおいは実在しないAIキャラなので、『私が使った』『乗り換えた』のような"
              "使っていないものを使ったと見せる書き方は禁止です。"
              "『調べてまとめた』『比較した』という客観的な立場で書いてください。"
            + f"本文の末尾には必ず『{広告設定['AI明示文']}』と『{広告設定['明示文']}』の2行を入れてください。"
        )
    else:
        cta_line = (
            "この投稿には商品やサービスの誘導は入れないでください。純粋な日常投稿にしてください。"
            f"URLも{目印}も書かないでください。"
            f"本文の末尾には『{広告設定['AI明示文']}』の1行だけを入れてください。"
        )

    return (
        "あなたはInstagramで発信する日本人女性インフルエンサーの中の人です。\n"
        f"キャラ設定: {json.dumps(persona, ensure_ascii=False)}\n\n"
        f"写真の内容: {scene_hint}\n\n"
        "この写真に添える投稿文を作ってください。条件:\n"
        f"- 口調: {persona['tone']}\n"
        "- 日本語。絵文字は自然に少し。3〜5文程度。\n"
        f"- {cta_line}\n"
        "- 健全な内容のみ。露出・性的表現・誇大な金額・嘘の実績はNG。\n"
        "- 未確認の金額（『月◯円浮いた』など）は書かない。\n\n"
        "次のJSONだけを出力してください（前後に説明文をつけない）:\n"
        '{"caption": "本文", "hashtags": "#〜 #〜（8〜12個）", "best_time": "おすすめ投稿時間帯", "has_cta": true/false}'
    )


def parse_json(text):
    s, e = text.find("{"), text.rfind("}")
    if s == -1 or e == -1:
        return None
    try:
        return json.loads(text[s:e + 1])
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", default=os.path.join(HERE, "persona.json"),
                    help="キャラのSNS設定(funnel等)ファイル")
    ap.add_argument("--char", default=os.path.join(HERE, "character.json"),
                    help="シーン説明を流用するキャラ設定ファイル")
    ap.add_argument("--photo-dir", default=os.path.join(HERE, "output"),
                    help="写真フォルダ")
    ap.add_argument("--prefix", default="aoi", help="写真ファイル名の接頭辞")
    ap.add_argument("--link-url", default=None,
                    help="誘導先URL。指定すると persona.json の funnel.link_url より優先する")
    ap.add_argument("--媒体", default="x,instagram,tiktok",
                    help="投稿文を仕上げる媒体（カンマ区切り）")
    ap.add_argument("--広告なし", action="store_true",
                    help="日常投稿だけを作る。誘導先URLが未定でも動く")
    ap.add_argument("--下見", action="store_true",
                    help="AIを呼ばず、誘導先・UTM・対応表だけを確認する")
    args = ap.parse_args()

    persona = json.load(open(args.persona, encoding="utf-8"))
    設定 = 誘導.設定を読む()
    対応 = 誘導.対応表を読む()
    媒体一覧 = [m.strip() for m in args.媒体.split(",") if m.strip()]
    for m in 媒体一覧:
        if m not in 設定["媒体"]:
            print("知らない媒体です: %s（使えるのは %s）" % (m, "/ ".join(設定["媒体"])))
            return

    # ★誘導先URLの確認は、AIを呼ぶ前に済ませる。
    #   途中で止まると、API料金だけ払って使えない投稿文が残るため。
    土台URL = None
    if args.広告なし:
        print("※ --広告なし が指定されています。日常投稿だけを作ります。")
    else:
        try:
            土台URL = 誘導.誘導先URLを取り出す(persona, args.link_url)
        except 誘導.誘導先が未設定 as e:
            print("\n【中止】投稿文づくりを始める前に止めました。\n")
            print(e)
            print("")
            raise SystemExit(1)
        print("誘導先URL: %s" % 土台URL)

    env = load_env()
    api_key = env.get("ANTHROPIC_API_KEY", "")
    model = env.get("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
    if not api_key and not args.下見:
        print("ANTHROPIC_API_KEY が見つかりません。automation/.env を確認してください。")
        return

    # シーンのヒント（キャラ設定ファイルがあれば流用）
    scene_hints = {}
    if os.path.exists(args.char):
        scenes = json.load(open(args.char, encoding="utf-8")).get("scenes", [])
        for i, sc in enumerate(scenes, 1):
            scene_hints["%s_%02d" % (args.prefix, i)] = sc

    # ★成人向け写真集の素材が混ざらないよう、読み込む前に止める。
    #   混ざるとSNS凍結・提携解除になり、あとから取り返せないため。
    安全な写真フォルダ = 素材フォルダを検査する(args.photo_dir, "投稿パックづくり")

    photos = sorted(glob.glob(os.path.join(安全な写真フォルダ, "%s_*.png" % args.prefix)))
    画像が健全側のものか確かめる(photos, "投稿パックづくり")
    if not photos:
        print("写真が %s にありません。先に写真を量産してください。" % args.photo_dir)
        return

    today = datetime.date.today()
    pack_dir = os.path.join(PACK_ROOT, today.strftime("%Y%m%d"))
    os.makedirs(pack_dir, exist_ok=True)

    rows = []
    対応表の行 = []
    間隔 = 設定["広告投稿"]["間隔"]
    ラベル = persona.get("funnel", {}).get("link_label", "まとめ")

    広告になる番号 = [i for i in range(1, len(photos) + 1)
                if (i % 間隔 == 0) and not args.広告なし]
    print("%d 枚の投稿パックを作ります（うち広告投稿は %d 本: %s）。"
          % (len(photos), len(広告になる番号),
             ", ".join(str(i) for i in 広告になる番号) or "なし"))

    if args.下見:
        print("\n── 下見モード（AIは呼びません）──")
        for idx in 広告になる番号:
            投稿ID = 誘導.投稿IDを作る(idx, 設定)
            for 媒体 in 媒体一覧:
                対応表の行 += 誘導.対応表の行を作る(idx, 投稿ID, 媒体, 土台URL, ラベル, 対応, 設定)
                print("  %s / %s → %s"
                      % (投稿ID, 設定["媒体"][媒体]["表示名"],
                         誘導.CTA文を作る(媒体, ラベル, "（URL）", 設定).replace("\n", " ")))
        保存先 = 誘導.対応表を書き出す(os.path.join(pack_dir, "投稿リンク対応表.csv"), 対応表の行)
        print("\n対応表: %s（%d行）" % (保存先, len(対応表の行)))
        return

    for idx, photo in enumerate(photos, 1):
        stem = os.path.splitext(os.path.basename(photo))[0]
        scene = scene_hints.get(stem, "20代女性の日常スナップ写真")
        do_cta = idx in 広告になる番号
        テーマ = 対応.get("投稿テーマ→LP", {}).get(str(idx), {}).get("テーマ", "")
        print("[%d/%d] %s%s" % (idx, len(photos), stem, "  ←広告投稿" if do_cta else ""))
        try:
            out = call_claude(api_key, model, build_prompt(persona, scene, do_cta, 設定, テーマ))
        except Exception as e:
            print("  生成エラー:", str(e)[:200])
            continue
        data = parse_json(out)
        if not data:
            print("  応答を解釈できませんでした。スキップ。")
            continue

        # ★AIが勝手にURLを書いていたら消す。仮URLが本文へ残るのを防ぐ最後の砦。
        本文 = 誘導.本文からURLを取り除く(data.get("caption", ""))
        投稿ID = 誘導.投稿IDを作る(idx, 設定)

        post_day = today + datetime.timedelta(days=idx - 1)
        # 媒体共通の下書き（CTAは目印のまま）
        txt = os.path.join(pack_dir, "%s.txt" % stem)
        with open(txt, "w", encoding="utf-8") as f:
            f.write(本文 + "\n\n" + data.get("hashtags", "") + "\n")

        # 媒体ごとに仕上げる
        for 媒体 in 媒体一覧:
            if do_cta:
                行 = 誘導.対応表の行を作る(idx, 投稿ID, 媒体, 土台URL, ラベル, 対応, 設定)
                対応表の行 += 行
                本文URL = next((r["計測用URL"] for r in 行 if r["リンクの置き場所"] == "本文"), "")
                仕上げ = 誘導.本文を媒体向けに仕上げる(本文, 媒体, ラベル, 本文URL, 設定)
            else:
                仕上げ = 本文.replace(設定["CTAの目印"], "").strip()
            with open(os.path.join(pack_dir, "%s_%s.txt" % (stem, 媒体)), "w", encoding="utf-8") as f:
                f.write(仕上げ + "\n\n" + data.get("hashtags", "") + "\n")

        rows.append({
            "投稿日": post_day.strftime("%Y-%m-%d"),
            "おすすめ時間": data.get("best_time", ""),
            "画像": os.path.basename(photo),
            "誘導あり": "はい" if do_cta else "いいえ",
            "投稿ID": 投稿ID,
            "キャプション": 本文.replace("\n", " "),
            "ハッシュタグ": data.get("hashtags", ""),
        })

    # カレンダーCSV
    csv_path = os.path.join(pack_dir, "投稿カレンダー.csv")
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["投稿日", "おすすめ時間", "画像", "誘導あり",
                                          "投稿ID", "キャプション", "ハッシュタグ"])
        w.writeheader()
        w.writerows(rows)

    # 投稿 → LP → ASP案件 の対応表
    if 対応表の行:
        誘導.対応表を書き出す(os.path.join(pack_dir, "投稿リンク対応表.csv"), 対応表の行)

    # 写真もパックにコピー
    import shutil
    for photo in photos:
        shutil.copy2(photo, os.path.join(pack_dir, os.path.basename(photo)))

    print("\n完成: %d 件を post_packs/%s に保存しました。" % (len(rows), today.strftime("%Y%m%d")))
    print("→ 投稿カレンダー.csv を見ながら、Meta Business Suite などで予約投稿してください。")
    if 対応表の行:
        print("→ 投稿リンク対応表.csv に、どの投稿がどのURLでどのASP案件につながるかを書き出しました。")
    print("※ 自動投稿は作っていません。投稿は人が手で行ってください。")


if __name__ == "__main__":
    main()
