import * as THREE from "three";

const JP = '"Hiragino Sans","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
const MONO = '"JetBrains Mono","SFMono-Regular",Menlo,monospace';

function rr(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function toTexture(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas);
  t.anisotropy = 4;
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeDashboardTexture(): THREE.Texture {
  const W = 1280;
  const H = 800;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;

  // shell
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0E1730");
  bg.addColorStop(1, "#070B18");
  rr(c, 4, 4, W - 8, H - 8, 26);
  c.fillStyle = bg;
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.14)";
  c.lineWidth = 2;
  c.stroke();

  // top bar
  c.fillStyle = "rgba(255,255,255,0.035)";
  rr(c, 4, 4, W - 8, 60, 26);
  c.fill();
  c.fillStyle = "rgba(255,255,255,0.09)";
  c.fillRect(4, 62, W - 8, 1.5);
  ["#EF4444", "#EAB308", "#34D399"].forEach((col, i) => {
    c.beginPath();
    c.arc(38 + i * 22, 34, 6, 0, Math.PI * 2);
    c.fillStyle = col;
    c.globalAlpha = 0.75;
    c.fill();
    c.globalAlpha = 1;
  });
  c.fillStyle = "rgba(255,255,255,0.5)";
  c.font = `500 20px ${MONO}`;
  c.fillText("AI GACHA OS  /  OPERATION DASHBOARD", 128, 41);
  c.fillStyle = "#34D399";
  c.beginPath();
  c.arc(W - 190, 34, 5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "rgba(255,255,255,0.42)";
  c.font = `500 18px ${MONO}`;
  c.fillText("LIVE", W - 172, 41);

  // sidebar
  c.fillStyle = "rgba(255,255,255,0.022)";
  c.fillRect(4, 64, 218, H - 68);
  c.fillStyle = "rgba(255,255,255,0.07)";
  c.fillRect(221, 64, 1.5, H - 68);
  const menu = [
    "ダッシュボード",
    "ガチャ管理",
    "還元率モニタ",
    "市場価格",
    "発送管理",
    "会員 / ポイント",
    "問い合わせ",
    "監査ログ",
  ];
  menu.forEach((m, i) => {
    const y = 104 + i * 52;
    if (i === 0) {
      c.fillStyle = "rgba(59,130,246,0.16)";
      rr(c, 20, y - 24, 186, 42, 10);
      c.fill();
      c.fillStyle = "#60A5FA";
      c.fillRect(20, y - 24, 3, 42);
    }
    c.fillStyle = i === 0 ? "#CFE0FF" : "rgba(255,255,255,0.4)";
    c.font = `500 19px ${JP}`;
    c.fillText(m, 40, y + 3);
  });

  // KPI cards
  const kpis = [
    { label: "本日売上", val: "¥ 1,284,300", delta: "+12.4%", up: true },
    { label: "プレイ回数", val: "3,914", delta: "+8.1%", up: true },
    { label: "未発送", val: "26", delta: "要対応", up: false },
  ];
  kpis.forEach((k, i) => {
    const x = 258 + i * 328;
    rr(c, x, 96, 300, 132, 16);
    c.fillStyle = "rgba(255,255,255,0.04)";
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.08)";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.42)";
    c.font = `500 17px ${JP}`;
    c.fillText(k.label, x + 22, 130);
    c.fillStyle = "#EAF1FF";
    c.font = `700 38px ${MONO}`;
    c.fillText(k.val, x + 22, 182);
    c.fillStyle = k.up ? "#34D399" : "#EAB308";
    c.font = `600 16px ${MONO}`;
    c.fillText(k.delta, x + 22, 210);
  });

  // chart
  rr(c, 258, 250, 628, 292, 16);
  c.fillStyle = "rgba(255,255,255,0.03)";
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.08)";
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.45)";
  c.font = `500 17px ${JP}`;
  c.fillText("売上推移 / 直近30日", 282, 284);

  const pts: [number, number][] = [];
  const seed = [0.28, 0.36, 0.31, 0.48, 0.42, 0.58, 0.52, 0.67, 0.61, 0.78, 0.72, 0.9];
  seed.forEach((v, i) => {
    pts.push([282 + (i * 580) / (seed.length - 1), 520 - v * 200]);
  });
  const grad = c.createLinearGradient(0, 300, 0, 520);
  grad.addColorStop(0, "rgba(59,130,246,0.42)");
  grad.addColorStop(1, "rgba(59,130,246,0)");
  c.beginPath();
  c.moveTo(pts[0][0], 520);
  pts.forEach(([x, y]) => c.lineTo(x, y));
  c.lineTo(pts[pts.length - 1][0], 520);
  c.closePath();
  c.fillStyle = grad;
  c.fill();
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.strokeStyle = "#60A5FA";
  c.lineWidth = 3;
  c.stroke();

  // RTP gauges panel
  rr(c, 908, 250, 356, 292, 16);
  c.fillStyle = "rgba(255,255,255,0.03)";
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.08)";
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.45)";
  c.font = `500 17px ${JP}`;
  c.fillText("CURRENT REAL RTP", 932, 284);
  const gauges = [
    { l: "設定時", v: "100.5%", col: "#8C97B0", p: 0.5 },
    { l: "残数ベース", v: "103.2%", col: "#EAB308", p: 0.68 },
    { l: "市場価格ベース", v: "108.7%", col: "#EF4444", p: 0.92 },
  ];
  gauges.forEach((g, i) => {
    const y = 330 + i * 68;
    c.fillStyle = "rgba(255,255,255,0.42)";
    c.font = `500 16px ${JP}`;
    c.fillText(g.l, 932, y);
    c.fillStyle = g.col;
    c.font = `700 24px ${MONO}`;
    c.textAlign = "right";
    c.fillText(g.v, 1240, y);
    c.textAlign = "left";
    rr(c, 932, y + 14, 308, 8, 4);
    c.fillStyle = "rgba(255,255,255,0.08)";
    c.fill();
    rr(c, 932, y + 14, 308 * g.p, 8, 4);
    c.fillStyle = g.col;
    c.fill();
  });

  // alert row
  rr(c, 258, 562, 1006, 74, 16);
  c.fillStyle = "rgba(239,68,68,0.10)";
  c.fill();
  c.strokeStyle = "rgba(239,68,68,0.34)";
  c.lineWidth = 1.5;
  c.stroke();
  c.beginPath();
  c.arc(292, 599, 7, 0, Math.PI * 2);
  c.fillStyle = "#EF4444";
  c.fill();
  c.fillStyle = "#FFD7D7";
  c.font = `600 19px ${JP}`;
  c.fillText("警告：スニーカーBOX #128 の市場価格ベース実還元率が 108.7% に上昇", 316, 606);
  rr(c, 1104, 578, 136, 42, 10);
  c.fillStyle = "rgba(239,68,68,0.85)";
  c.fill();
  c.fillStyle = "#fff";
  c.font = `600 17px ${JP}`;
  c.fillText("販売停止", 1136, 605);

  // table
  const rows = [
    ["#128 スニーカーBOX", "残 128/500", "108.7%", "#EF4444"],
    ["#131 PSA10 スペシャル", "残 402/800", "103.2%", "#EAB308"],
    ["#134 家電フェス", "残 611/700", "96.4%", "#34D399"],
  ];
  rows.forEach((r, i) => {
    const y = 668 + i * 40;
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.font = `500 17px ${JP}`;
    c.fillText(r[0], 282, y);
    c.fillStyle = "rgba(255,255,255,0.3)";
    c.font = `500 16px ${MONO}`;
    c.fillText(r[1], 700, y);
    c.fillStyle = r[3];
    c.font = `700 18px ${MONO}`;
    c.textAlign = "right";
    c.fillText(r[2], 1240, y);
    c.textAlign = "left";
    c.fillStyle = "rgba(255,255,255,0.05)";
    c.fillRect(282, y + 12, 958, 1);
  });

  return toTexture(cv);
}

/**
 * エンジン間を流れるデータのチップ。
 * 小さく薄く出す前提。読ませる情報はDOM側にあるので、ここは雰囲気だけ。
 */
export function makeDataChipTexture(
  text: string,
  accent = "#60A5FA"
): THREE.Texture {
  const W = 420;
  const H = 96;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;

  rr(c, 3, 3, W - 6, H - 6, H / 2);
  c.fillStyle = "rgba(8,12,24,0.82)";
  c.fill();
  c.strokeStyle = accent;
  c.globalAlpha = 0.45;
  c.lineWidth = 2.5;
  c.stroke();
  c.globalAlpha = 1;

  c.beginPath();
  c.arc(38, H / 2, 7, 0, Math.PI * 2);
  c.fillStyle = accent;
  c.fill();

  c.fillStyle = "rgba(233,240,255,0.88)";
  c.font = `600 34px ${MONO}`;
  c.textBaseline = "middle";
  c.fillText(text, 62, H / 2 + 1);
  c.textBaseline = "alphabetic";

  return toTexture(cv);
}

export function makeModuleTexture(
  label: string,
  sub: string,
  accent = "#60A5FA"
): THREE.Texture {
  const W = 640;
  const H = 200;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;

  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "rgba(24,34,62,0.96)");
  bg.addColorStop(1, "rgba(10,14,28,0.96)");
  rr(c, 4, 4, W - 8, H - 8, 26);
  c.fillStyle = bg;
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.16)";
  c.lineWidth = 2;
  c.stroke();

  c.beginPath();
  c.arc(52, H / 2, 13, 0, Math.PI * 2);
  c.fillStyle = accent;
  c.fill();
  c.beginPath();
  c.arc(52, H / 2, 24, 0, Math.PI * 2);
  c.strokeStyle = accent;
  c.globalAlpha = 0.35;
  c.lineWidth = 2;
  c.stroke();
  c.globalAlpha = 1;

  c.fillStyle = "#EAF1FF";
  c.font = `700 40px ${JP}`;
  c.fillText(label, 96, H / 2 + 2);
  c.fillStyle = "rgba(255,255,255,0.38)";
  c.font = `500 22px ${MONO}`;
  c.fillText(sub, 96, H / 2 + 38);

  return toTexture(cv);
}
