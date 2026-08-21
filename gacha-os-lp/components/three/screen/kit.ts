/**
 * 3Dデバイスの「画面の中」を描くための道具箱。
 *
 * ここで描いた絵が、そのまま3DのノートPC／スマートフォンの画面に貼られます。
 * つまり画面の中身は動画でも画像でもなく、毎フレーム描き直している本物のUIです。
 *
 * ・座標はすべて「デザイン上のpx」。実際の解像度は describe 側で拡大します
 * ・色は管理画面（/demo）と同じ濃紺のトーンに合わせています
 * ・文字は必ず measureText で幅を測ってから置く（語の途中で切れないようにするため）
 */

export const JP =
  '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
export const MONO =
  '"JetBrains Mono","SFMono-Regular",Menlo,Consolas,monospace';

/** 画面の中で使う色。LP本体のトークンと対応させている */
export const UI = {
  bg0: "#080D1A",
  bg1: "#0D1426",
  bg2: "#121B33",
  line: "rgba(255,255,255,0.09)",
  line2: "rgba(255,255,255,0.05)",
  text: "#EAF1FF",
  text2: "rgba(233,241,255,0.62)",
  text3: "rgba(233,241,255,0.34)",
  blue: "#5B8CFF",
  blueDim: "rgba(91,140,255,0.16)",
  cyan: "#39D6E8",
  ok: "#34D399",
  warn: "#EAB308",
  danger: "#EF4444",
  gold: "#D9BC7C",
  human: "#FFFFFF",
} as const;

export type Ctx = CanvasRenderingContext2D;

/** 角丸のパス */
export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}

/** 塗りつぶした角丸 */
export function fillRR(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string
) {
  rr(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
}

/** 枠線つきの角丸パネル */
export function panel(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 16,
  fill = "rgba(255,255,255,0.035)",
  stroke: string = UI.line
) {
  rr(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = stroke;
  c.lineWidth = 1.5;
  c.stroke();
}

type TextOpt = {
  font?: string;
  size?: number;
  weight?: number | string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** 与えると、この幅を超える場合に自動で縮める（省略記号は使わない） */
  maxWidth?: number;
};

export function text(c: Ctx, s: string, x: number, y: number, o: TextOpt = {}) {
  const size = o.size ?? 18;
  const weight = o.weight ?? 500;
  const font = o.font ?? JP;
  c.font = `${weight} ${size}px ${font}`;
  c.fillStyle = o.color ?? UI.text;
  c.textAlign = o.align ?? "left";
  c.textBaseline = o.baseline ?? "alphabetic";
  if (o.maxWidth && c.measureText(s).width > o.maxWidth) {
    // 語の途中で「…」を出すより、少しだけ字を詰めるほうが読める
    const scale = o.maxWidth / c.measureText(s).width;
    c.font = `${weight} ${Math.max(9, Math.floor(size * scale))}px ${font}`;
  }
  c.fillText(s, x, y);
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
}

export const mono = (
  c: Ctx,
  s: string,
  x: number,
  y: number,
  o: TextOpt = {}
) => text(c, s, x, y, { ...o, font: MONO });

/** 小さなラベル（英字・字間広め） */
export function tag(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  color: string = UI.text3,
  size = 13
) {
  c.font = `600 ${size}px ${MONO}`;
  c.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    c.fillText(ch, cx, y);
    cx += c.measureText(ch).width + size * 0.18;
  }
}

/** 状態バッジ */
export function badge(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  color: string,
  size = 15
) {
  c.font = `700 ${size}px ${MONO}`;
  const w = c.measureText(s).width + size * 2.2;
  const h = size * 2.1;
  fillRR(c, x, y, w, h, h / 2, hexA(color, 0.16));
  rr(c, x, y, w, h, h / 2);
  c.strokeStyle = hexA(color, 0.42);
  c.lineWidth = 1.4;
  c.stroke();
  text(c, s, x + w / 2, y + h / 2 + 1, {
    font: MONO,
    size,
    weight: 700,
    color,
    align: "center",
    baseline: "middle",
  });
  return w;
}

/** #RRGGBB → rgba() */
export function hexA(hex: string, a: number) {
  if (hex.startsWith("rgba")) return hex;
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((x) => x + x)
          .join("")
      : h,
    16
  );
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 横棒グラフ（進捗・還元率） */
export function bar(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  p: number,
  color: string
) {
  fillRR(c, x, y, w, h, h / 2, "rgba(255,255,255,0.07)");
  const fw = Math.max(h, w * clamp(p, 0, 1));
  const g = c.createLinearGradient(x, 0, x + fw, 0);
  g.addColorStop(0, hexA(color, 0.55));
  g.addColorStop(1, color);
  fillRR(c, x, y, fw, h, h / 2, g as unknown as string);
}

export const clamp = (v: number, a: number, b: number) =>
  v < a ? a : v > b ? b : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0→1 をなめらかに */
export const ease = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** [from,to] の区間だけを 0→1 に切り出す（時間割り当て用） */
export function seg(t: number, from: number, to: number) {
  return clamp((t - from) / (to - from), 0, 1);
}

/** 画面全体の下地 */
export function shell(c: Ctx, w: number, h: number, radius = 0) {
  const g = c.createLinearGradient(0, 0, w * 0.6, h);
  g.addColorStop(0, UI.bg1);
  g.addColorStop(1, UI.bg0);
  if (radius > 0) {
    fillRR(c, 0, 0, w, h, radius, g as unknown as string);
  } else {
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  // 左上からの光
  const gl = c.createRadialGradient(w * 0.18, 0, 0, w * 0.18, 0, h * 1.1);
  gl.addColorStop(0, "rgba(91,140,255,0.13)");
  gl.addColorStop(1, "rgba(91,140,255,0)");
  c.fillStyle = gl;
  c.fillRect(0, 0, w, h);
}

/** 折れ線グラフ */
export function sparkline(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  vals: number[],
  color: string,
  fill = true
) {
  const max = Math.max(...vals, 0.0001);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const pts = vals.map((v, i): [number, number] => [
    x + (i * w) / (vals.length - 1),
    y + h - ((v - min) / span) * h,
  ]);
  if (fill) {
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, hexA(color, 0.34));
    g.addColorStop(1, hexA(color, 0));
    c.beginPath();
    c.moveTo(pts[0][0], y + h);
    pts.forEach(([px, py]) => c.lineTo(px, py));
    c.lineTo(pts[pts.length - 1][0], y + h);
    c.closePath();
    c.fillStyle = g;
    c.fill();
  }
  c.beginPath();
  pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
  c.strokeStyle = color;
  c.lineWidth = 2.6;
  c.lineJoin = "round";
  c.stroke();
  return pts;
}

/** 点滅する丸（LIVE表示など） */
export function dot(c: Ctx, x: number, y: number, r: number, color: string, glow = 0) {
  if (glow > 0) {
    const g = c.createRadialGradient(x, y, 0, x, y, r * (3 + glow * 3));
    g.addColorStop(0, hexA(color, 0.5 * glow));
    g.addColorStop(1, hexA(color, 0));
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r * (3 + glow * 3), 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}

/**
 * 1文字ずつ出す（AIへの指示文の入力演出）。
 * 日本語を途中で改行しないよう、行の折り返しは「、」「。」「・」の後だけにする。
 */
export function typeLines(
  c: Ctx,
  lines: string[],
  x: number,
  y: number,
  lineH: number,
  progress: number,
  o: TextOpt = {}
) {
  const total = lines.join("").length;
  const shown = Math.floor(total * clamp(progress, 0, 1));
  let used = 0;
  let lastX = x;
  let lastY = y;
  lines.forEach((ln, i) => {
    const take = clamp(shown - used, 0, ln.length);
    if (take > 0) {
      const s = ln.slice(0, take);
      text(c, s, x, y + i * lineH, o);
      c.font = `${o.weight ?? 500} ${o.size ?? 18}px ${o.font ?? JP}`;
      lastX = x + c.measureText(s).width;
      lastY = y + i * lineH;
    }
    used += ln.length;
  });
  return { x: lastX, y: lastY, done: shown >= total };
}

/** 縦書きにならない安全な省略（英数のみ） */
export function ellipsis(c: Ctx, s: string, max: number) {
  if (c.measureText(s).width <= max) return s;
  let out = s;
  while (out.length > 1 && c.measureText(out + "…").width > max) out = out.slice(0, -1);
  return out + "…";
}
