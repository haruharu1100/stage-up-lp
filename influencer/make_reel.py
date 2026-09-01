#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""あおいの写真を、縦型9:16のリール動画（ゆっくりズーム＋フック文字）にする。

各写真について
  ・1080x1920の縦型に切り出し
  ・ゆっくりズームイン（ケンバーンズ風）
  ・上部に短いフック文字（白文字＋黒フチ）
を入れて mp4 を作る。フック文は Claude API があれば自動生成、なければ内蔵の定型文。

健全運用のみ。露出・性的表現・誇大表現はしない。
"""
import os
import io
import json
import glob

from isolation_guard import 素材フォルダを検査する, 画像が健全側のものか確かめる
import shutil
import datetime
import subprocess
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PERSONA_PATH = os.path.join(HERE, "persona.json")
CHAR_PATH = os.path.join(HERE, "character.json")
PHOTO_DIR = os.path.join(HERE, "output")
REEL_ROOT = os.path.join(HERE, "reels")
BGM_PATH = os.path.join(HERE, "bgm.mp3")

FONT_PATH = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
API_URL = "https://api.anthropic.com/v1/messages"

TW, TH = 1080, 1920      # 縦型9:16
FPS = 30
DURATION = 6.0           # 1本の長さ（秒）
MAX_ZOOM = 1.10          # 最終的なズーム倍率


def load_env():
    env = {}
    p = os.path.join(REPO, "automation", ".env")
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
        "max_tokens": 900,
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


DEFAULT_FALLBACK = [
    "ひとり暮らしの\nゆる節約ルーティン",
    "今日のていねいな\n暮らしメモ",
    "スマホ代、\n見直したら軽くなった話",
    "おうち時間の\nちいさな幸せ",
    "がんばらない\n自炊のコツ",
    "週末の\nおさんぽ記録",
    "買ってよかった\nひとり暮らしグッズ",
    "節約しても\nさみしくない暮らし",
    "ムリしない\nお金の整え方",
    "季節を感じる\nおでかけ",
    "やめたら\nラクになった習慣",
    "今月の\nちいさな見直し",
    "等身大の\n22歳の日常",
    "ていねいに\n暮らすって楽しい",
    "ゆるっと\n続けてる節約",
]


def make_hooks(n, persona_path=None):
    """各写真に添える短いフック文を n 個作る。キャラ設定(persona)からテーマを読む。"""
    persona = json.load(open(persona_path or PERSONA_PATH, encoding="utf-8"))
    # フォールバック文言はキャラ設定に持たせられる（無ければ既定=あおい節約系）
    fallback = persona.get("reel_hooks") or DEFAULT_FALLBACK
    theme = persona.get("niche", "健全で等身大の日常")
    env = load_env()
    api_key = env.get("ANTHROPIC_API_KEY", "")
    model = env.get("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
    if not api_key:
        return (fallback * ((n // len(fallback)) + 1))[:n]

    prompt = (
        "あなたはInstagramリールを作る日本人女性インフルエンサーの中の人です。\n"
        f"キャラ設定: {json.dumps(persona, ensure_ascii=False)}\n\n"
        f"リール動画{n}本ぶんの、画面に出す『フック文字』を作ってください。条件:\n"
        "- 1本につき1〜2行。1行は最大10文字程度。短く。\n"
        "- 思わず見たくなる言葉。でも誇大表現・煽りすぎはNG。\n"
        "- 【重要】具体的な金額・数字は一切書かない（例『月1万円』『年6万』はNG）。\n"
        "  実在しないキャラの嘘の実績・誇大表示になるため。『見直したら軽くなった』のように数字なしで。\n"
        f"- 健全で等身大。テーマは『{theme}』。キャラの口調・世界観に合わせる。\n"
        "- 改行したい所には \\n を入れる。\n\n"
        f'次のJSON配列だけを出力（説明文なし）。要素数はちょうど{n}個:\n'
        '["フック文1", "フック文2", ...]'
    )
    try:
        out = call_claude(api_key, model, prompt)
        s, e = out.find("["), out.rfind("]")
        arr = json.loads(out[s:e + 1])
        arr = [str(x).replace("\\n", "\n") for x in arr if str(x).strip()]
        if len(arr) >= n:
            return arr[:n]
        return (arr + fallback)[:n]
    except Exception as ex:
        print("  フック自動生成は使えませんでした（定型文を使用）:", str(ex)[:120])
        return (fallback * ((n // len(fallback)) + 1))[:n]


def cover_resize(img, w, h):
    """画像を w x h に「埋まるように」リサイズして中央切り抜き。"""
    iw, ih = img.size
    scale = max(w / iw, h / ih)
    nw, nh = int(iw * scale + 0.5), int(ih * scale + 0.5)
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = (nh - h) // 2
    return img.crop((left, top, left + w, left * 0 + top + h))


def wrap_text(text, font, draw, max_w):
    lines = []
    for raw in text.split("\n"):
        if not raw:
            lines.append("")
            continue
        cur = ""
        for ch in raw:
            test = cur + ch
            if draw.textlength(test, font=font) <= max_w or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = ch
        lines.append(cur)
    return lines


def make_text_layer(text, font):
    """フック文字の透過レイヤー（TW x TH）を作る。上部に配置。"""
    layer = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    lines = wrap_text(text, font, draw, int(TW * 0.86))
    asc, desc = font.getmetrics()
    lh = asc + desc + 14
    total_h = lh * len(lines)
    y0 = int(TH * 0.10)

    # 読みやすさ用のやわらかい暗がり（上部）
    grad = Image.new("L", (1, TH), 0)
    gpx = grad.load()
    band_top = int(TH * 0.05)
    band_bot = y0 + total_h + int(TH * 0.04)
    for y in range(TH):
        if band_top <= y <= band_bot:
            gpx[0, y] = 120
    grad = grad.resize((TW, TH))
    shade = Image.new("RGBA", (TW, TH), (0, 0, 0, 255))
    shade.putalpha(grad)
    layer = Image.alpha_composite(layer, shade)
    draw = ImageDraw.Draw(layer)

    y = y0
    for ln in lines:
        tw = draw.textlength(ln, font=font)
        x = (TW - tw) // 2
        draw.text((x, y), ln, font=font, fill=(255, 255, 255, 255),
                  stroke_width=6, stroke_fill=(0, 0, 0, 230))
        y += lh
    return layer


def find_ffmpeg():
    cand = os.path.join(
        REPO, "youtube_shorts", "templates", "remotion", "node_modules",
        "@remotion", "compositor-darwin-arm64", "ffmpeg")
    if os.path.exists(cand):
        return cand
    return "ffmpeg"


def render_reel(photo, hook, font, out_path, ffmpeg):
    src = Image.open(photo).convert("RGB")
    big = cover_resize(src, int(TW * MAX_ZOOM), int(TH * MAX_ZOOM))
    text_layer = make_text_layer(hook, font)

    total = int(FPS * DURATION)
    env = dict(os.environ)
    env["DYLD_LIBRARY_PATH"] = os.path.dirname(ffmpeg)

    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe", "-vcodec", "png", "-framerate", str(FPS), "-i", "-",
    ]
    if os.path.exists(BGM_PATH):
        cmd += ["-stream_loop", "-1", "-i", BGM_PATH]
    cmd += [
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-movflags", "+faststart",
    ]
    if os.path.exists(BGM_PATH):
        cmd += ["-c:a", "aac", "-b:a", "128k", "-shortest", "-map", "0:v:0", "-map", "1:a:0"]
    cmd += [out_path]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, env=env)
    bw, bh = big.size
    for f in range(total):
        p = f / (total - 1) if total > 1 else 0
        z = 1.0 + (MAX_ZOOM - 1.0) * p           # 1.0 → MAX_ZOOM
        crop_w = TW * MAX_ZOOM / z
        crop_h = TH * MAX_ZOOM / z
        left = (bw - crop_w) / 2
        top = (bh - crop_h) / 2
        frame = big.crop((int(left), int(top), int(left + crop_w), int(top + crop_h)))
        frame = frame.resize((TW, TH), Image.LANCZOS).convert("RGBA")
        frame = Image.alpha_composite(frame, text_layer).convert("RGB")
        buf = io.BytesIO()
        frame.save(buf, format="PNG")
        proc.stdin.write(buf.getvalue())
    proc.stdin.close()
    proc.wait()
    return proc.returncode == 0


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--src-dir", default=PHOTO_DIR, help="写真フォルダ（既定: output）")
    ap.add_argument("--pattern", default="aoi*.png", help="対象ファイル名パターン")
    ap.add_argument("--tag", default="", help="出力フォルダ名に付ける目印（例: fullbody）")
    ap.add_argument("--persona", default=PERSONA_PATH, help="フック文のテーマ元(persona.json)")
    args = ap.parse_args()

    # ★成人向け写真集の素材が混ざらないよう、読み込む前に止める。
    #   リール動画はSNSへそのまま出るため、混入は即アカウント凍結につながる。
    安全な写真フォルダ = 素材フォルダを検査する(args.src_dir, "リール動画づくり")

    photos = sorted(glob.glob(os.path.join(安全な写真フォルダ, args.pattern)))
    画像が健全側のものか確かめる(photos, "リール動画づくり")
    if not photos:
        print("写真が %s にありません。先に写真を量産してください。" % args.src_dir)
        return
    if not os.path.exists(FONT_PATH):
        print("日本語フォントが見つかりません:", FONT_PATH)
        return

    ffmpeg = find_ffmpeg()
    font = ImageFont.truetype(FONT_PATH, 76)

    print("%d 本のリール動画を作ります（1本 約%d秒）..." % (len(photos), int(DURATION)))
    hooks = make_hooks(len(photos), args.persona)

    today = datetime.date.today().strftime("%Y%m%d")
    folder = today + ("_" + args.tag if args.tag else "")
    out_dir = os.path.join(REEL_ROOT, folder)
    os.makedirs(out_dir, exist_ok=True)

    made = 0
    for i, photo in enumerate(photos):
        stem = os.path.splitext(os.path.basename(photo))[0]
        out_path = os.path.join(out_dir, "%s.mp4" % stem)
        hook = hooks[i] if i < len(hooks) else ""
        print("[%d/%d] %s  「%s」" % (i + 1, len(photos), stem, hook.replace("\n", " ")))
        try:
            ok = render_reel(photo, hook, font, out_path, ffmpeg)
        except Exception as ex:
            print("  作成エラー:", str(ex)[:200])
            continue
        if ok and os.path.exists(out_path):
            made += 1
        else:
            print("  動画化に失敗しました。")

    print("\n完成: %d 本を reels/%s に保存しました。" % (made, folder))
    if not os.path.exists(BGM_PATH):
        print("（BGMを付けたい時は ai-influencer/bgm.mp3 を置いて、もう一度実行してください）")


if __name__ == "__main__":
    main()
