"""
リンクプレビュー用の画像（1200×630）を作る。

なぜ必要か：
LINE・メール・X にURLを貼ったとき、画像が無いと文字だけの小さな枠になります。
法人あての営業でURLを送る前提なので、開く前の一瞬で「何の画面か」が伝わる
必要があります。作り物のイラストではなく、実際に動いているデモ画面
（public/video/gacha-os-demo.jpg）を切り出して使います。

使い方： python3 scripts/make-og-image.py
出力　： public/og.jpg
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "video" / "gacha-os-demo.jpg"
DST = ROOT / "public" / "og.jpg"

SIZE = (1200, 630)

# 元画像（1280×800）は、リンクプレビューの比率（1200×630）より縦長です。
# 切り取ると、上の「OPERATOR / 販売状況」や下の帯が消えて、
# 何の画面なのか分からない絵になります。
# そのため切らずに、丸ごと縮めて左右に余白を足します。
# 余白の色は元画像の背景から拾うので、継ぎ目は出ません。


def main() -> None:
    image = Image.open(SRC).convert("RGB")

    scale = min(SIZE[0] / image.width, SIZE[1] / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)), Image.LANCZOS
    )

    background = image.getpixel((2, 2))  # 元画像の背景色
    canvas = Image.new("RGB", SIZE, background)
    canvas.paste(
        resized,
        ((SIZE[0] - resized.width) // 2, (SIZE[1] - resized.height) // 2),
    )
    canvas.save(DST, quality=88, optimize=True)
    print(f"created {DST.relative_to(ROOT)} {SIZE[0]}x{SIZE[1]}")


if __name__ == "__main__":
    main()
