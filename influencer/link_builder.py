"""
誘導リンクの受け渡し ― persona.json の link_url を、投稿文づくりまで確実に運ぶ。

なぜ必要か
  これまで link_url は persona.json に欄があるだけで、投稿文を作る処理へ
  一度も渡っていなかった。そのため「誘導先を書いたつもりが、どこにも
  つながっていない投稿」が量産される状態だった。

  さらに、URLを本文へ直書きする前提だと Instagram と TikTok では成立しない
  （本文のURLはリンクにならない）。媒体ごとに誘導のしかたを変えられる形にする。

やること
  ① 誘導先URLを取り出す。空・仮の値なら、その場で止める（★仮URLを作らない）
  ② 投稿1本ごとにUTMを付ける
  ③ 媒体（X / Instagram / TikTok）ごとにCTAの出し方を変える
  ④ 投稿・LP・ASP案件の対応表を書き出す

★方針: 迷ったら止める。誘導先が確定していない状態で投稿文を作ると、
  あとから全部を書き直すことになるため。
"""

import os
import re
import csv
import json
import urllib.parse

ここ = os.path.dirname(os.path.abspath(__file__))
設定ファイル = os.path.join(ここ, "cta_settings.json")
対応表ファイル = os.path.join(ここ, "aoi_link_map.json")

# 「まだ決まっていない」を表す値。これらは誘導先として使えない。
仮の値とみなす言葉 = (
    "example.com", "example.jp", "your-domain", "todo", "tbd",
    "xxx", "ここにurl", "未定", "仮", "sample.com", "localhost",
)


class 誘導先が未設定(Exception):
    """誘導先URLが空、または仮の値だったときに投げる。"""
    pass


def 設定を読む(パス=None):
    return json.load(open(パス or 設定ファイル, encoding="utf-8"))


def 対応表を読む(パス=None):
    return json.load(open(パス or 対応表ファイル, encoding="utf-8"))


def 誘導先URLを取り出す(persona, 上書きURL=None):
    """persona.json の funnel.link_url を取り出して検査する。

    空・仮の値なら 誘導先が未設定 を投げる。★勝手に仮URLを作らない。
    """
    url = (上書きURL or persona.get("funnel", {}).get("link_url", "") or "").strip()

    if not url:
        raise 誘導先が未設定(
            "誘導先URL（persona.json の funnel.link_url）が空です。\n"
            "  広告投稿は誘導先が無いと成立しないため、ここで止めます。\n"
            "  ★仮のURLは作りません。作ると『どこにもつながらない投稿』が\n"
            "    出来上がり、あとで全部書き直すことになるためです。\n"
            "  対処: LPのURLが決まったら persona.json の funnel.link_url に書くか、\n"
            "        --link-url でURLを渡してください。\n"
            "  日常投稿だけを作りたい場合は --広告なし を付けてください。"
        )

    if not url.startswith(("http://", "https://")):
        raise 誘導先が未設定("誘導先URLが http:// か https:// で始まっていません: %s" % url)

    小文字 = url.lower()
    for 言葉 in 仮の値とみなす言葉:
        if 言葉 in 小文字:
            raise 誘導先が未設定(
                "誘導先URLが仮の値に見えます（『%s』が入っています）: %s\n"
                "  実際に開けるURLを指定してください。" % (言葉, url)
            )
    return url


def 投稿IDを作る(番号, 設定=None):
    """1 → post_001。自分のLPのUTM(utm_content)で使う。"""
    設定 = 設定 or 設定を読む()
    return 設定["utm"]["投稿IDの形"] % int(番号)


def ASP用IDを作る(媒体, 番号, 設定=None):
    """1, 'x' → x001。

    ASPへ渡すパラメータ（A8.netのid1〜id5など）は
    半角英数字のみ・50バイト以内という制限があるため、
    アンダースコア入りの post_001 は使えない。こちらを使う。
    """
    設定 = 設定 or 設定を読む()
    接頭 = 設定["媒体"][媒体]["asp_idの接頭"]
    値 = "%s%03d" % (接頭, int(番号))
    if not re.fullmatch(r"[0-9A-Za-z]+", 値):
        raise ValueError("ASP用IDに半角英数字以外が入っています: %s" % 値)
    if len(値.encode("utf-8")) > 50:
        raise ValueError("ASP用IDが50バイトを超えています: %s" % 値)
    return 値


def 計測用URLを作る(土台URL, 媒体, 投稿ID, medium=None, 設定=None):
    """土台URLにUTMを付ける。既にクエリがあっても壊さない。"""
    設定 = 設定 or 設定を読む()
    媒体設定 = 設定["媒体"][媒体]

    分解 = urllib.parse.urlsplit(土台URL)
    問い合わせ = urllib.parse.parse_qsl(分解.query, keep_blank_values=True)
    問い合わせ += [
        ("utm_source", 媒体設定["utm_source"]),
        ("utm_medium", medium or 媒体設定["utm_medium"]),
        ("utm_campaign", 設定["utm"]["campaign"]),
        ("utm_content", 投稿ID),
    ]
    return urllib.parse.urlunsplit((
        分解.scheme, 分解.netloc, 分解.path,
        urllib.parse.urlencode(問い合わせ), 分解.fragment,
    ))


def 誘導先パスを足す(土台URL, 相対パス):
    """土台URL（LPの入口）に、そこからの相対パスを足す。

    相対パスは 'sim/' のように先頭に / を付けない形で持つ。
    こうしておくと、あとでLPを独自ドメインの直下へ引っ越しても
    link_url を差し替えるだけで全部のリンクが直る。
    """
    相対パス = (相対パス or "").strip()
    if not 相対パス:
        return 土台URL
    if 相対パス.startswith("/") or "://" in 相対パス:
        # ★ここを許すと https://例/aoi/aoi/ のような二重パスが静かに出来る
        raise ValueError(
            "LPの相対パスは先頭に / を付けず、絶対URLも書かないでください: %s" % 相対パス
        )
    土台 = 土台URL if 土台URL.endswith("/") else 土台URL + "/"
    return urllib.parse.urljoin(土台, 相対パス)


def CTA文を作る(媒体, ラベル, URL, 設定=None):
    """媒体ごとのCTA本文。URLを本文に置けない媒体では URL を差し込まない。"""
    設定 = 設定 or 設定を読む()
    媒体設定 = 設定["媒体"][媒体]
    雛形 = 媒体設定["CTA雛形"]
    文 = 雛形.replace("{ラベル}", ラベル)
    if 媒体設定["本文にURLを置ける"]:
        文 = 文.replace("{URL}", URL)
    else:
        # 本文にURLを置けない媒体では、URLの差し込み口ごと消す
        文 = re.sub(r"\n?\{URL\}", "", 文)
    return 文.strip()


def 本文からURLを取り除く(本文):
    """AIが勝手に書いたURLを消す。仮URLが本文へ混ざるのを防ぐ最後の砦。"""
    return re.sub(r"https?://\S+", "", 本文).strip()


def 本文を媒体向けに仕上げる(本文, 媒体, ラベル, URL, 設定=None):
    """本文中の目印 {{CTA}} を、媒体ごとのCTAに差し替える。

    目印が無く、CTAが必要な場合は本文の末尾に足す。
    """
    設定 = 設定 or 設定を読む()
    目印 = 設定["CTAの目印"]
    CTA = CTA文を作る(媒体, ラベル, URL, 設定)

    if 目印 in 本文:
        return 本文.replace(目印, CTA)
    return (本文.rstrip() + "\n\n" + CTA)


def 対応表の行を作る(番号, 投稿ID, 媒体, 土台URL, ラベル, 対応=None, 設定=None):
    """条件6: 投稿文・LP・ASP案件の対応関係を1行にまとめる。"""
    設定 = 設定 or 設定を読む()
    対応 = 対応 or 対応表を読む()

    送り先キー = 対応.get("投稿テーマ→LP", {}).get(str(番号), {}).get("送り先", "入口")
    テーマ = 対応.get("投稿テーマ→LP", {}).get(str(番号), {}).get("テーマ", "")
    LP = 対応.get("LP", {}).get(送り先キー, {})
    LPパス = LP.get("相対パス", "")

    行 = []
    媒体設定 = 設定["媒体"][媒体]
    宛先 = 誘導先パスを足す(土台URL, LPパス)

    # 本文に置く（or プロフィールに置く）メインのリンク
    行.append({
        "投稿番号": 番号,
        "投稿ID": 投稿ID,
        "媒体": 媒体設定["表示名"],
        "リンクの置き場所": "本文" if 媒体設定["本文にURLを置ける"] else "プロフィール",
        "LP": LP.get("名前", ""),
        "LPパス": LPパス,
        "計測用URL": 計測用URLを作る(宛先, 媒体, 投稿ID if 媒体設定["本文にURLを置ける"] else "bio",
                              媒体設定["utm_medium"], 設定),
        "ASP用ID": ASP用IDを作る(媒体, 番号, 設定),
        "投稿ごとの内訳が出るか": "出る" if 媒体設定["本文にURLを置ける"] else "出ない（全投稿で共通）",
        "テーマ": テーマ,
        "ASP案件": " / ".join(a["事業者"] for a in LP.get("ASP案件", [])),
    })

    # Instagramのストーリーズなど、投稿ごとに測れる追加リンク
    for 名前, 追加 in (媒体設定.get("追加リンク") or {}).items():
        if 追加.get("utm_medium") == 媒体設定["utm_medium"]:
            continue  # メインと同じものは重複させない
        行.append({
            "投稿番号": 番号,
            "投稿ID": 投稿ID,
            "媒体": 媒体設定["表示名"],
            "リンクの置き場所": 名前,
            "LP": LP.get("名前", ""),
            "LPパス": LPパス,
            "計測用URL": 計測用URLを作る(宛先, 媒体, 投稿ID, 追加["utm_medium"], 設定),
            "ASP用ID": ASP用IDを作る(媒体, 番号, 設定),
            "投稿ごとの内訳が出るか": "出る",
            "テーマ": テーマ,
            "ASP案件": " / ".join(a["事業者"] for a in LP.get("ASP案件", [])),
        })
    return 行


対応表の見出し = [
    "投稿番号", "投稿ID", "媒体", "リンクの置き場所", "LP", "LPパス",
    "計測用URL", "ASP用ID", "投稿ごとの内訳が出るか", "テーマ", "ASP案件",
]


def 対応表を書き出す(保存先, 行の一覧):
    with open(保存先, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=対応表の見出し)
        w.writeheader()
        w.writerows(行の一覧)
    return 保存先
