/**
 * 3D ノートPC の画面に映る「AI GACHA OS の管理画面」。
 *
 * 6つの画面を順番に映します。
 *   DASHBOARD → AI GACHA DESIGN → BACKTEST → REAL RTP → SHIPPING → AI OPERATOR
 *
 * どれも静止画ではなく、数字・グラフ・文字入力がその場で動きます。
 * 「これは実際に使う管理システムだ」と、見ただけで分かるようにするためです。
 *
 * ★数値はすべて運営例です。実績値ではありません（画面内にもその旨を出しています）。
 */

import {
  UI,
  type Ctx,
  badge,
  bar,
  clamp,
  dot,
  ease,
  fillRR,
  hexA,
  mono,
  rr,
  panel,
  seg,
  shell,
  sparkline,
  tag,
  text,
  typeLines,
} from "./kit";

export const ADMIN_W = 1600;
export const ADMIN_H = 1000;

/** 画面の並び順。3D側はこの順で切り替える */
export const ADMIN_SCREENS = [
  { key: "dashboard", label: "DASHBOARD", ja: "ダッシュボード" },
  { key: "design", label: "AI GACHA DESIGN", ja: "AIガチャ設計" },
  { key: "backtest", label: "BACKTEST", ja: "公開前バックテスト" },
  { key: "rtp", label: "REAL RTP", ja: "実還元率モニタ" },
  { key: "shipping", label: "SHIPPING", ja: "発送管理" },
  { key: "operator", label: "AI OPERATOR", ja: "AI問い合わせ対応" },
] as const;

/**
 * ADMIN_SCREENS は「順番に映す6画面」。
 * publish は自動では映さず、代表シーン（承認→公開）でだけ呼び出す。
 */
export type AdminScreenKey =
  | (typeof ADMIN_SCREENS)[number]["key"]
  | "publish";

const MENU = [
  "ダッシュボード",
  "ガチャ設計",
  "公開前検証",
  "還元率モニタ",
  "市場価格",
  "発送管理",
  "問い合わせ",
  "会員・ポイント",
  "監査ログ",
];

/** メニューのどこが光るか */
const ACTIVE_MENU: Record<AdminScreenKey, number> = {
  dashboard: 0,
  design: 1,
  backtest: 2,
  rtp: 3,
  shipping: 5,
  operator: 6,
  publish: 2,
};

/* ══════════════════ 共通の枠（上バー・左メニュー） ══════════════════ */

const TOP_H = 66;
const SIDE_W = 252;
const CX = SIDE_W + 30; // コンテンツ左端
const CW = ADMIN_W - CX - 30; // コンテンツ幅

function chrome(c: Ctx, key: AdminScreenKey, t: number) {
  shell(c, ADMIN_W, ADMIN_H);

  // 上バー
  c.fillStyle = "rgba(255,255,255,0.028)";
  c.fillRect(0, 0, ADMIN_W, TOP_H);
  c.fillStyle = UI.line;
  c.fillRect(0, TOP_H, ADMIN_W, 1.5);

  // ロゴ
  dot(c, 34, TOP_H / 2, 5.5, UI.blue, 0.6);
  tag(c, "AI GACHA OS", 52, TOP_H / 2 + 6, "rgba(233,241,255,0.86)", 17);

  // publish は ADMIN_SCREENS に無いので、見つからないときの名前を用意しておく
  const cur = ADMIN_SCREENS.find((s) => s.key === key);
  c.fillStyle = UI.line;
  c.fillRect(232, 20, 1.5, TOP_H - 40);
  text(c, cur ? cur.ja : "公開前検証", 254, TOP_H / 2 + 7, {
    size: 19,
    weight: 600,
    color: UI.text2,
  });

  // 右上：稼働表示
  const blink = 0.5 + 0.5 * Math.sin(t * 2.6);
  dot(c, ADMIN_W - 168, TOP_H / 2, 5, UI.ok, blink);
  tag(c, "LIVE", ADMIN_W - 152, TOP_H / 2 + 5, "rgba(52,211,153,0.8)", 14);
  text(c, "運営例データ", ADMIN_W - 34, TOP_H / 2 + 6, {
    size: 15,
    color: UI.text3,
    align: "right",
  });

  // 左メニュー
  c.fillStyle = "rgba(255,255,255,0.018)";
  c.fillRect(0, TOP_H + 1.5, SIDE_W, ADMIN_H - TOP_H);
  c.fillStyle = UI.line;
  c.fillRect(SIDE_W, TOP_H + 1.5, 1.5, ADMIN_H - TOP_H);

  const active = ACTIVE_MENU[key];
  MENU.forEach((m, i) => {
    const y = TOP_H + 62 + i * 54;
    if (i === active) {
      fillRR(c, 18, y - 26, SIDE_W - 44, 44, 11, UI.blueDim);
      c.fillStyle = UI.blue;
      fillRR(c, 18, y - 26, 3.5, 44, 2, UI.blue);
    }
    text(c, m, 40, y + 3, {
      size: 18,
      weight: i === active ? 600 : 500,
      color: i === active ? "#CFE0FF" : UI.text3,
    });
  });

  // 左下：担当者
  fillRR(c, 18, ADMIN_H - 92, SIDE_W - 44, 62, 12, "rgba(255,255,255,0.03)");
  dot(c, 46, ADMIN_H - 61, 13, "rgba(91,140,255,0.5)");
  text(c, "運営 / 管理者", 70, ADMIN_H - 66, { size: 15, color: UI.text2 });
  mono(c, "OPERATOR", 70, ADMIN_H - 46, { size: 12, color: UI.text3 });
}

/** コンテンツ見出し */
function head(c: Ctx, label: string, sub: string) {
  tag(c, label, CX, TOP_H + 52, UI.blue, 14);
  text(c, sub, CX, TOP_H + 92, { size: 27, weight: 700, color: UI.text });
}

/* ══════════════════ 01 DASHBOARD ══════════════════ */

const SALES = [
  0.3, 0.38, 0.32, 0.5, 0.44, 0.6, 0.55, 0.7, 0.63, 0.79, 0.71, 0.86, 0.8, 0.95,
];

function dashboard(c: Ctx, t: number) {
  chrome(c, "dashboard", t);
  head(c, "OPERATION OVERVIEW", "本日の運営状況");

  const p = ease(clamp(t / 1.2, 0, 1));

  // KPI 4枚
  const kpis = [
    { l: "本日の売上", v: 1284300, pre: "¥", d: "+12.4%", col: UI.ok },
    { l: "プレイ回数", v: 3914, pre: "", d: "+8.1%", col: UI.ok },
    { l: "販売中ガチャ", v: 7, pre: "", d: "うち監視中 2", col: UI.text3 },
    { l: "発送待ち", v: 26, pre: "", d: "要対応", col: UI.warn },
  ];
  const kw = (CW - 3 * 20) / 4;
  kpis.forEach((k, i) => {
    const x = CX + i * (kw + 20);
    panel(c, x, TOP_H + 118, kw, 136, 16);
    text(c, k.l, x + 22, TOP_H + 154, { size: 16, color: UI.text2 });
    const shown = Math.round(k.v * p);
    mono(
      c,
      k.pre + shown.toLocaleString("ja-JP"),
      x + 22,
      TOP_H + 208,
      { size: 36, weight: 700, color: UI.text, maxWidth: kw - 44 }
    );
    text(c, k.d, x + 22, TOP_H + 236, { size: 15, weight: 600, color: k.col });
  });

  // 売上グラフ
  const gy = TOP_H + 278;
  panel(c, CX, gy, CW * 0.62 - 10, 268, 16);
  text(c, "売上推移 / 直近14日", CX + 24, gy + 36, { size: 17, color: UI.text2 });
  mono(c, "運営例", CX + CW * 0.62 - 34, gy + 36, {
    size: 13,
    color: UI.text3,
    align: "right",
  });
  const n = Math.max(2, Math.round(SALES.length * p));
  const pts = sparkline(
    c,
    CX + 26,
    gy + 62,
    CW * 0.62 - 72,
    170,
    SALES.slice(0, n),
    UI.blue
  );
  const last = pts[pts.length - 1];
  dot(c, last[0], last[1], 5.5, "#fff", 0.8);

  // 実還元率
  const rx = CX + CW * 0.62 + 10;
  const rw = CW * 0.38 - 10;
  panel(c, rx, gy, rw, 268, 16);
  text(c, "実還元率 / 販売中", rx + 24, gy + 36, { size: 17, color: UI.text2 });
  const gauges = [
    { l: "設定時", v: 100.5, col: UI.text2, p: 0.5 },
    { l: "残数ベース", v: 103.2, col: UI.warn, p: 0.68 },
    { l: "市場価格ベース", v: 108.7, col: UI.danger, p: 0.92 },
  ];
  gauges.forEach((g, i) => {
    const y = gy + 84 + i * 62;
    text(c, g.l, rx + 24, y, { size: 16, color: UI.text2 });
    mono(c, (g.v * p).toFixed(1) + "%", rx + rw - 24, y, {
      size: 23,
      weight: 700,
      color: g.col,
      align: "right",
    });
    bar(c, rx + 24, y + 14, rw - 48, 8, g.p * p, g.col);
  });

  // 警告行
  const ay = gy + 288;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  panel(
    c,
    CX,
    ay,
    CW,
    74,
    16,
    hexA(UI.danger, 0.09 + pulse * 0.05),
    hexA(UI.danger, 0.3 + pulse * 0.2)
  );
  dot(c, CX + 34, ay + 37, 7, UI.danger, pulse);
  text(
    c,
    "市場価格の上昇で、スニーカーBOX #128 の実還元率が 108.7% になりました",
    CX + 58,
    ay + 44,
    { size: 18, weight: 600, color: "#FFD9D9" }
  );
  badge(c, "AIが販売停止を提案", CX + CW - 260, ay + 21, UI.danger, 14);

  // 一覧
  const ty = ay + 96;
  const rows: [string, string, string, string][] = [
    ["#128 スニーカーBOX", "残 128 / 500", "108.7%", UI.danger],
    ["#131 PSA10 スペシャル", "残 402 / 800", "103.2%", UI.warn],
    ["#134 家電フェス", "残 611 / 700", "96.4%", UI.ok],
  ];
  rows.forEach((r, i) => {
    const y = ty + 30 + i * 42;
    text(c, r[0], CX + 8, y, { size: 17, color: "rgba(233,241,255,0.72)" });
    mono(c, r[1], CX + 480, y, { size: 16, color: UI.text3 });
    mono(c, r[2], CX + CW - 8, y, {
      size: 18,
      weight: 700,
      color: r[3],
      align: "right",
    });
    c.fillStyle = UI.line2;
    c.fillRect(CX + 8, y + 14, CW - 16, 1);
  });
}

/* ══════════════════ 02 AI GACHA DESIGN ══════════════════ */

const ORDER = [
  "500円・1000口。",
  "今人気のポケカ中心。",
  "S賞は豪華に。",
];

const TIERS = [
  { l: "S賞", n: 3, note: "PSA10 / 高額シングル", col: UI.gold },
  { l: "A賞", n: 12, note: "人気BOX", col: "#C6D4FF" },
  { l: "B賞", n: 85, note: "上位シングル", col: UI.blue },
  { l: "C賞", n: 899, note: "通常カード", col: UI.text2 },
  { l: "LAST ONE", n: 1, note: "最後の1口", col: UI.cyan },
];

function design(c: Ctx, t: number) {
  chrome(c, "design", t);
  head(c, "AI GACHA DESIGN", "AIに、作りたいガチャを伝える");

  const typing = seg(t, 0.2, 2.6);
  const gen = seg(t, 2.8, 3.9);
  const build = seg(t, 3.9, 6.2);
  const rtpP = seg(t, 6.0, 7.2);

  // 左：指示欄
  const lw = CW * 0.4 - 12;
  const ly = TOP_H + 124;
  panel(c, CX, ly, lw, 300, 16);
  tag(c, "YOUR INSTRUCTION", CX + 24, ly + 36, UI.text3, 12);
  text(c, "人が伝えるのは、ここだけ。", CX + 24, ly + 66, {
    size: 16,
    color: UI.text2,
  });

  fillRR(c, CX + 22, ly + 86, lw - 44, 152, 12, "rgba(255,255,255,0.045)");
  const cur = typeLines(c, ORDER, CX + 44, ly + 126, 42, typing, {
    size: 21,
    weight: 600,
    color: UI.text,
  });
  if (typing < 1 && Math.sin(t * 8) > 0) {
    c.fillStyle = UI.blue;
    c.fillRect(cur.x + 3, cur.y - 19, 2.5, 25);
  }
  // 送信ボタン
  const sendOn = typing >= 1;
  fillRR(
    c,
    CX + lw - 168,
    ly + 252,
    146,
    44,
    22,
    sendOn ? "rgba(91,140,255,0.9)" : "rgba(255,255,255,0.07)"
  );
  text(c, "AIに任せる", CX + lw - 95, ly + 280, {
    size: 17,
    weight: 700,
    color: sendOn ? "#fff" : UI.text3,
    align: "center",
  });

  // 左下：人が決めた条件
  panel(c, CX, ly + 320, lw, 176, 16);
  tag(c, "HUMAN INPUT", CX + 24, ly + 354, UI.text3, 12);
  const conds: [string, string][] = [
    ["1口の価格", "¥500"],
    ["口数", "1,000口"],
    ["ジャンル", "ポケモンカード"],
    ["目標還元率", "95% 前後"],
  ];
  conds.forEach(([k, v], i) => {
    const y = ly + 388 + i * 30;
    text(c, k, CX + 24, y, { size: 16, color: UI.text3 });
    mono(c, v, CX + lw - 24, y, {
      size: 17,
      weight: 600,
      color: UI.text,
      align: "right",
    });
  });

  // 右：AIの生成結果
  const rx = CX + lw + 24;
  const rw = CW - lw - 24;
  panel(c, rx, ly, rw, 372, 16);
  tag(c, "AI GENERATED", rx + 24, ly + 36, UI.blue, 12);

  if (gen < 1) {
    // 生成中
    text(c, "条件を確認しています…", rx + 24, ly + 74, {
      size: 19,
      weight: 600,
      color: UI.text,
    });
    const steps = ["商品候補を探索", "等級バランスを計算", "還元率を試算"];
    steps.forEach((s, i) => {
      const y = ly + 122 + i * 46;
      const on = gen * 3 > i;
      dot(c, rx + 36, y - 6, 5, on ? UI.blue : "rgba(255,255,255,0.16)", on ? 0.6 : 0);
      text(c, s, rx + 56, y, { size: 17, color: on ? UI.text2 : UI.text3 });
      if (on) mono(c, "OK", rx + rw - 30, y, { size: 15, color: UI.ok, align: "right" });
    });
    // 進捗
    bar(c, rx + 24, ly + 300, rw - 48, 7, gen, UI.blue);
    mono(c, `GENERATING ${Math.round(gen * 100)}%`, rx + 24, ly + 336, {
      size: 14,
      color: UI.text3,
    });
  } else {
    text(c, "この構成でどうでしょう。", rx + 24, ly + 74, {
      size: 19,
      weight: 600,
      color: UI.text,
    });
    // 等級テーブル
    TIERS.forEach((tr, i) => {
      const y = ly + 116 + i * 50;
      const appear = ease(clamp(build * TIERS.length - i, 0, 1));
      if (appear <= 0) return;
      c.globalAlpha = appear;
      fillRR(
        c,
        rx + 22,
        y - 26,
        rw - 44,
        42,
        10,
        i === 0 ? hexA(UI.gold, 0.1) : "rgba(255,255,255,0.03)"
      );
      fillRR(c, rx + 22, y - 26, 3.5, 42, 2, tr.col);
      text(c, tr.l, rx + 44, y + 2, { size: 18, weight: 700, color: tr.col });
      text(c, tr.note, rx + 168, y + 2, { size: 15, color: UI.text3 });
      mono(
        c,
        Math.round(tr.n * appear).toLocaleString("ja-JP") + " 本",
        rx + rw - 44,
        y + 2,
        { size: 19, weight: 700, color: UI.text, align: "right" }
      );
      c.globalAlpha = 1;
    });
    // 還元率
    const ry = ly + 372 - 60;
    text(c, "設計上の還元率", rx + 24, ry, { size: 16, color: UI.text2 });
    mono(c, (94.8 * ease(rtpP)).toFixed(1) + "%", rx + rw - 24, ry + 4, {
      size: 30,
      weight: 700,
      color: rtpP > 0.9 ? UI.ok : UI.text,
      align: "right",
    });
    bar(c, rx + 24, ry + 20, rw - 48, 8, 0.948 * ease(rtpP), UI.ok);
  }

  // 右下：次の一手
  panel(c, rx, ly + 392, rw, 104, 16, "rgba(91,140,255,0.06)", hexA(UI.blue, 0.22));
  text(c, "公開する前に、必ずあなたが確認します。", rx + 26, ly + 432, {
    size: 18,
    weight: 600,
    color: UI.text,
  });
  text(c, "AIが作るのは候補まで。公開の判断は運営者です。", rx + 26, ly + 464, {
    size: 15,
    color: UI.text2,
  });
  if (rtpP > 0.6) {
    badge(c, "NEXT : BACKTEST", rx + rw - 226, ly + 424, UI.blue, 14);
  }
}

/* ══════════════════ 03 BACKTEST ══════════════════ */

/** 決まった形の分布（乱数を使わないので毎回同じ絵になる） */
const HIST = [
  2, 4, 7, 12, 19, 29, 41, 55, 68, 79, 86, 88, 84, 75, 63, 50, 38, 27, 18, 11, 6,
  3, 1,
];

function backtest(c: Ctx, t: number) {
  chrome(c, "backtest", t);
  head(c, "PRE-LAUNCH BACKTEST", "公開する前に、1万回売り切ってみる");

  const run = seg(t, 0.3, 3.2);
  const judge = seg(t, 3.4, 4.2);

  // 上：試行状況
  panel(c, CX, TOP_H + 120, CW, 88, 16);
  const trials = Math.round(10000 * run);
  text(c, "試行回数", CX + 26, TOP_H + 152, { size: 16, color: UI.text2 });
  mono(c, trials.toLocaleString("ja-JP") + " / 10,000", CX + 26, TOP_H + 190, {
    size: 26,
    weight: 700,
    color: UI.text,
  });
  bar(c, CX + 330, TOP_H + 158, CW - 620, 10, run, UI.blue);
  mono(c, `${Math.round(run * 100)}%`, CX + 330 + CW - 606, TOP_H + 168, {
    size: 18,
    weight: 700,
    color: UI.text2,
  });
  if (judge > 0.5) {
    badge(c, "SAFE", CX + CW - 150, TOP_H + 142, UI.ok, 20);
  } else {
    badge(c, "RUNNING", CX + CW - 168, TOP_H + 142, UI.blue, 18);
  }

  // ヒストグラム
  const hy = TOP_H + 232;
  const hh = 300;
  panel(c, CX, hy, CW * 0.66 - 10, hh + 96, 16);
  text(c, "売り切ったときの利益の散らばり", CX + 26, hy + 38, {
    size: 17,
    color: UI.text2,
  });
  const bw = (CW * 0.66 - 92) / HIST.length;
  const maxH = Math.max(...HIST);
  HIST.forEach((v, i) => {
    const grow = ease(clamp(run * HIST.length * 1.4 - i, 0, 1));
    const h = (v / maxH) * hh * grow;
    const x = CX + 34 + i * bw;
    // 左端（赤字域）は赤、それ以外は青
    const col = i < 4 ? UI.danger : i < 7 ? UI.warn : UI.blue;
    fillRR(c, x, hy + 64 + hh - h, bw - 5, h, 3, hexA(col, i < 4 ? 0.8 : 0.55));
  });
  // 損益分岐線
  const zx = CX + 34 + 5.2 * bw;
  c.strokeStyle = hexA(UI.text, 0.3);
  c.lineWidth = 1.6;
  c.setLineDash([6, 6]);
  c.beginPath();
  c.moveTo(zx, hy + 60);
  c.lineTo(zx, hy + 64 + hh);
  c.stroke();
  c.setLineDash([]);
  mono(c, "±0", zx, hy + 52, { size: 14, color: UI.text3, align: "center" });
  text(c, "← 赤字になった回", CX + 34, hy + hh + 100, { size: 15, color: UI.danger });
  text(c, "黒字になった回 →", CX + CW * 0.66 - 44, hy + hh + 100, {
    size: 15,
    color: UI.blue,
    align: "right",
  });

  // 右：指標
  const rx = CX + CW * 0.66 + 10;
  const rw = CW * 0.34 - 10;
  const stats: [string, string, string][] = [
    ["実還元率 中央値", (94.8).toFixed(1) + "%", UI.ok],
    ["最悪ケース", "112.4%", UI.warn],
    ["赤字になった割合", "1.8%", UI.ok],
    ["ラストワンまでの平均", "874 口", UI.text],
  ];
  panel(c, rx, hy, rw, hh + 96, 16);
  text(c, "1万回の結果", rx + 24, hy + 38, { size: 17, color: UI.text2 });
  stats.forEach(([k, v, col], i) => {
    const y = hy + 96 + i * 82;
    text(c, k, rx + 24, y, { size: 16, color: UI.text3 });
    mono(c, run > 0.9 ? v : "—", rx + rw - 24, y + 30, {
      size: 30,
      weight: 700,
      color: run > 0.9 ? col : UI.text3,
      align: "right",
    });
    c.fillStyle = UI.line2;
    c.fillRect(rx + 24, y + 48, rw - 48, 1);
  });

  // 判定行
  const jy = hy + hh + 118;
  const on = judge > 0.5;
  panel(
    c,
    CX,
    jy,
    CW,
    76,
    16,
    on ? hexA(UI.ok, 0.09) : "rgba(255,255,255,0.03)",
    on ? hexA(UI.ok, 0.34) : UI.line
  );
  dot(c, CX + 34, jy + 38, 7, on ? UI.ok : UI.text3, on ? 0.8 : 0);
  text(
    c,
    on
      ? "この構成なら、赤字になる確率は 1.8%。公開して問題ありません。"
      : "計算しています…",
    CX + 58,
    jy + 45,
    { size: 18, weight: 600, color: on ? "#CFF5E6" : UI.text2 }
  );
  if (on) {
    fillRR(c, CX + CW - 190, jy + 17, 166, 42, 21, "rgba(52,211,153,0.9)");
    text(c, "承認する", CX + CW - 107, jy + 45, {
      size: 17,
      weight: 700,
      color: "#04231A",
      align: "center",
    });
  }
}

/* ══════════════════ 04 REAL RTP ══════════════════ */

const RTP_LINE = [
  96.2, 96.8, 97.4, 98.1, 99.0, 100.2, 101.4, 102.6, 103.9, 105.4, 106.8, 108.7,
];

function realRtp(c: Ctx, t: number) {
  chrome(c, "rtp", t);
  head(c, "REAL RTP MONITOR", "売っている間、ずっと見ている");

  const p = ease(clamp(t / 2.4, 0, 1));
  const alert = seg(t, 2.6, 3.4);

  // 3本のゲージ
  const gauges = [
    { l: "設定時の還元率", v: 100.5, col: UI.text2, p: 0.5, note: "作ったときの計算" },
    { l: "残数ベース", v: 103.2, col: UI.warn, p: 0.68, note: "売れ残りを反映" },
    {
      l: "市場価格ベース",
      v: 108.7,
      col: UI.danger,
      p: 0.92,
      note: "いまの相場を反映",
    },
  ];
  const gw = (CW - 40) / 3;
  gauges.forEach((g, i) => {
    const x = CX + i * (gw + 20);
    panel(
      c,
      x,
      TOP_H + 120,
      gw,
      190,
      16,
      i === 2 ? hexA(UI.danger, 0.07) : "rgba(255,255,255,0.035)",
      i === 2 ? hexA(UI.danger, 0.28) : UI.line
    );
    text(c, g.l, x + 24, TOP_H + 156, { size: 17, weight: 600, color: UI.text2 });
    text(c, g.note, x + 24, TOP_H + 180, { size: 14, color: UI.text3 });
    mono(c, (g.v * p).toFixed(1) + "%", x + 24, TOP_H + 246, {
      size: 44,
      weight: 700,
      color: g.col,
    });
    bar(c, x + 24, TOP_H + 274, gw - 48, 9, g.p * p, g.col);
  });

  // 推移
  const gy = TOP_H + 336;
  panel(c, CX, gy, CW * 0.64 - 10, 296, 16);
  text(c, "実還元率の推移 / スニーカーBOX #128", CX + 26, gy + 38, {
    size: 17,
    color: UI.text2,
  });
  const n = Math.max(2, Math.round(RTP_LINE.length * p));
  const pts = sparkline(
    c,
    CX + 30,
    gy + 70,
    CW * 0.64 - 80,
    186,
    RTP_LINE.slice(0, n),
    UI.danger
  );
  // 100%ライン
  const yFor = (v: number) => {
    const mx = Math.max(...RTP_LINE);
    const mn = Math.min(...RTP_LINE);
    return gy + 70 + 186 - ((v - mn) / (mx - mn)) * 186;
  };
  c.strokeStyle = hexA(UI.text, 0.26);
  c.setLineDash([6, 6]);
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(CX + 30, yFor(100));
  c.lineTo(CX + CW * 0.64 - 50, yFor(100));
  c.stroke();
  c.setLineDash([]);
  mono(c, "100%（もうけが消える線）", CX + 36, yFor(100) - 10, {
    size: 14,
    color: UI.text3,
  });
  const lp = pts[pts.length - 1];
  dot(c, lp[0], lp[1], 6, UI.danger, 0.9);

  // 右：市場価格の動き
  const rx = CX + CW * 0.64 + 10;
  const rw = CW * 0.36 - 10;
  panel(c, rx, gy, rw, 296, 16);
  text(c, "値上がりした商品", rx + 24, gy + 38, { size: 17, color: UI.text2 });
  const items: [string, string, string][] = [
    ["限定スニーカー 27.0cm", "¥42,000 → ¥68,000", "+61.9%"],
    ["人気モデル 26.5cm", "¥31,000 → ¥39,500", "+27.4%"],
    ["コラボ 28.0cm", "¥25,000 → ¥28,800", "+15.2%"],
  ];
  items.forEach(([nm, pr, up], i) => {
    const y = gy + 92 + i * 66;
    const show = clamp(p * 3 - i, 0, 1);
    c.globalAlpha = show;
    text(c, nm, rx + 24, y, { size: 16, color: UI.text2 });
    mono(c, pr, rx + 24, y + 26, { size: 15, color: UI.text3 });
    mono(c, up, rx + rw - 24, y + 14, {
      size: 20,
      weight: 700,
      color: UI.danger,
      align: "right",
    });
    c.globalAlpha = 1;
  });
  mono(c, "PRICE UPDATED 12 min ago", rx + 24, gy + 276, {
    size: 13,
    color: UI.text3,
  });

  // 下：AIの提案
  const ay = gy + 316;
  const on = alert > 0.4;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
  panel(
    c,
    CX,
    ay,
    CW,
    82,
    16,
    on ? hexA(UI.danger, 0.09 + pulse * 0.05) : "rgba(255,255,255,0.03)",
    on ? hexA(UI.danger, 0.32 + pulse * 0.18) : UI.line
  );
  dot(c, CX + 34, ay + 41, 7, on ? UI.danger : UI.text3, on ? pulse : 0);
  text(
    c,
    on
      ? "このまま売り続けると赤字になります。販売停止をおすすめします。"
      : "監視中",
    CX + 58,
    ay + 40,
    { size: 19, weight: 600, color: on ? "#FFD9D9" : UI.text2 }
  );
  if (on)
    text(c, "停止するかどうかは、運営者が決めます。", CX + 58, ay + 66, {
      size: 15,
      color: UI.text3,
    });
  if (on) {
    fillRR(c, CX + CW - 200, ay + 20, 176, 42, 21, "rgba(239,68,68,0.9)");
    text(c, "販売を停止する", CX + CW - 112, ay + 48, {
      size: 17,
      weight: 700,
      color: "#fff",
      align: "center",
    });
  }
}

/* ══════════════════ 05 SHIPPING ══════════════════ */

const ORDERS: [string, string, string, number][] = [
  ["#20812", "PSA10 リザードン", "東京都", 3],
  ["#20811", "限定スニーカー 27.0", "大阪府", 3],
  ["#20809", "人気BOX 未開封", "福岡県", 2],
  ["#20807", "コラボモデル 26.5", "北海道", 2],
  ["#20804", "上位シングル 3枚", "愛知県", 1],
  ["#20801", "家電セット", "神奈川県", 1],
];

const SHIP_STEP = ["申込", "梱包", "発送", "完了"];

function shipping(c: Ctx, t: number) {
  chrome(c, "shipping", t);
  head(c, "SHIPPING", "実物を送るところまで、同じ画面で");

  const p = ease(clamp(t / 1.6, 0, 1));
  const push = seg(t, 2.6, 3.6);

  // 上：件数
  const kpis: [string, number, string][] = [
    ["発送待ち", 26, UI.warn],
    ["本日発送済", 41, UI.ok],
    ["ポイント還元を選択", 88, UI.blue],
    ["追跡番号 未登録", 0, UI.ok],
  ];
  const kw = (CW - 60) / 4;
  kpis.forEach(([l, v, col], i) => {
    const x = CX + i * (kw + 20);
    panel(c, x, TOP_H + 118, kw, 118, 16);
    text(c, l, x + 22, TOP_H + 152, { size: 16, color: UI.text2 });
    mono(c, String(Math.round(v * p)), x + 22, TOP_H + 208, {
      size: 40,
      weight: 700,
      color: col,
    });
  });

  // 一覧
  const ly = TOP_H + 258;
  panel(c, CX, ly, CW * 0.66 - 10, 372, 16);
  text(c, "発送待ち一覧", CX + 26, ly + 38, { size: 17, color: UI.text2 });
  mono(c, "配送データを書き出す", CX + CW * 0.66 - 34, ly + 38, {
    size: 14,
    color: UI.blue,
    align: "right",
  });
  ORDERS.forEach((o, i) => {
    const y = ly + 84 + i * 46;
    const show = clamp(p * ORDERS.length - i, 0, 1);
    c.globalAlpha = show;
    mono(c, o[0], CX + 28, y, { size: 16, color: UI.text3 });
    text(c, o[1], CX + 132, y, { size: 17, color: "rgba(233,241,255,0.76)" });
    text(c, o[2], CX + 470, y, { size: 16, color: UI.text3 });
    // 進み具合
    const done = o[3];
    SHIP_STEP.forEach((s, k) => {
      const bx = CX + 596 + k * 46;
      dot(c, bx, y - 6, 4.5, k < done ? UI.ok : "rgba(255,255,255,0.16)");
      if (k < SHIP_STEP.length - 1) {
        c.strokeStyle = k < done - 1 ? hexA(UI.ok, 0.5) : "rgba(255,255,255,0.1)";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(bx + 6, y - 6);
        c.lineTo(bx + 40, y - 6);
        c.stroke();
      }
    });
    c.fillStyle = UI.line2;
    c.fillRect(CX + 28, y + 14, CW * 0.66 - 66, 1);
    c.globalAlpha = 1;
  });

  // 右：発送通知
  const rx = CX + CW * 0.66 + 10;
  const rw = CW * 0.34 - 10;
  panel(c, rx, ly, rw, 372, 16);
  text(c, "発送のお知らせ", rx + 24, ly + 38, { size: 17, color: UI.text2 });
  fillRR(c, rx + 22, ly + 62, rw - 44, 150, 12, "rgba(255,255,255,0.04)");
  text(c, "◯◯様", rx + 42, ly + 96, { size: 16, color: UI.text2 });
  text(c, "ご当選の商品を発送しました。", rx + 42, ly + 128, {
    size: 17,
    weight: 600,
    color: UI.text,
  });
  mono(c, "追跡番号 4912-8830-7761", rx + 42, ly + 160, {
    size: 15,
    color: UI.text3,
  });
  mono(c, "お届け予定 8/23", rx + 42, ly + 186, { size: 15, color: UI.text3 });

  const sent = push > 0.6;
  fillRR(
    c,
    rx + 22,
    ly + 234,
    rw - 44,
    48,
    24,
    sent ? "rgba(52,211,153,0.16)" : "rgba(91,140,255,0.9)"
  );
  text(c, sent ? "送信しました" : "お客様へ送る", rx + rw / 2, ly + 264, {
    size: 17,
    weight: 700,
    color: sent ? UI.ok : "#fff",
    align: "center",
  });
  text(
    c,
    "追跡番号を入れると、お客様のマイページにも反映されます。",
    rx + 24,
    ly + 318,
    { size: 15, color: UI.text3 }
  );
  text(c, "文面は運営者が確認してから送ります。", rx + 24, ly + 344, {
    size: 15,
    color: UI.text3,
  });
}

/* ══════════════════ 06 AI OPERATOR ══════════════════ */

const REPLY = [
  "ご連絡ありがとうございます。",
  "8月20日のご当選分は、",
  "本日発送を手配しました。",
  "追跡番号は 4912-8830-7761 です。",
];

function operator(c: Ctx, t: number) {
  chrome(c, "operator", t);
  head(c, "AI OPERATOR", "同じ質問は、AIが下書きする");

  const typing = seg(t, 1.2, 3.6);
  const approve = seg(t, 4.0, 4.8);

  // 左：問い合わせ一覧
  const lw = CW * 0.34 - 12;
  const ly = TOP_H + 120;
  panel(c, CX, ly, lw, 510, 16);
  text(c, "受信した問い合わせ", CX + 24, ly + 38, { size: 17, color: UI.text2 });
  const threads: [string, string, boolean][] = [
    ["発送はいつ頃ですか？", "3分前", true],
    ["ポイントの有効期限は？", "12分前", false],
    ["住所を変更したい", "28分前", false],
    ["当選商品を交換できますか", "1時間前", false],
    ["支払い方法を知りたい", "2時間前", false],
  ];
  threads.forEach(([q, ago, active], i) => {
    const y = ly + 76 + i * 74;
    if (active) fillRR(c, CX + 18, y - 6, lw - 36, 62, 11, UI.blueDim);
    text(c, q, CX + 36, y + 22, {
      size: 17,
      weight: active ? 600 : 500,
      color: active ? UI.text : UI.text2,
      maxWidth: lw - 90,
    });
    mono(c, ago, CX + 36, y + 46, { size: 13, color: UI.text3 });
    if (i < 2)
      dot(c, CX + lw - 34, y + 24, 4.5, i === 0 ? UI.blue : UI.warn, 0);
  });
  // 件数
  const py = ly + 440;
  c.fillStyle = UI.line2;
  c.fillRect(CX + 24, py - 22, lw - 48, 1);
  text(c, "本日の対応", CX + 24, py + 8, { size: 16, color: UI.text3 });
  mono(c, "AI 下書き 38 件", CX + 24, py + 38, {
    size: 18,
    weight: 700,
    color: UI.blue,
  });
  mono(c, "人が確認 38 件", CX + 24, py + 64, {
    size: 18,
    weight: 700,
    color: UI.text,
  });

  // 右：やりとり
  const rx = CX + lw + 24;
  const rw = CW - lw - 24;
  panel(c, rx, ly, rw, 510, 16);

  // お客様の質問
  fillRR(c, rx + 26, ly + 32, rw * 0.62, 96, 14, "rgba(255,255,255,0.05)");
  mono(c, "CUSTOMER", rx + 48, ly + 62, { size: 12, color: UI.text3 });
  text(c, "8月20日に当たった商品、", rx + 48, ly + 92, { size: 18, color: UI.text });
  text(c, "発送はいつ頃になりますか？", rx + 48, ly + 118, {
    size: 18,
    color: UI.text,
  });

  // AIの下書き
  const dy = ly + 156;
  const h = 214;
  panel(c, rx + rw - 26 - rw * 0.72, dy, rw * 0.72, h, 14, hexA(UI.blue, 0.09), hexA(UI.blue, 0.26));
  const dx = rx + rw - 26 - rw * 0.72;
  mono(c, "AI DRAFT", dx + 24, dy + 32, { size: 12, color: UI.blue });
  const cur = typeLines(c, REPLY, dx + 24, dy + 68, 34, typing, {
    size: 18,
    color: UI.text,
  });
  if (typing < 1 && Math.sin(t * 8) > 0) {
    c.fillStyle = UI.blue;
    c.fillRect(cur.x + 3, cur.y - 16, 2.5, 22);
  }
  // 参照した情報
  if (typing > 0.9) {
    mono(c, "参照：注文 #20812 / 発送状況 / 追跡番号", dx + 24, dy + h - 22, {
      size: 13,
      color: UI.text3,
    });
  }

  // 承認ボタン
  const by = dy + h + 34;
  const done = approve > 0.6;
  text(c, "この内容で送りますか？", rx + 26, by + 30, {
    size: 18,
    weight: 600,
    color: UI.text2,
  });
  fillRR(
    c,
    rx + rw - 26 - 176,
    by,
    176,
    50,
    25,
    done ? "rgba(52,211,153,0.16)" : "rgba(91,140,255,0.92)"
  );
  text(c, done ? "送信しました" : "確認して送る", rx + rw - 26 - 88, by + 31, {
    size: 17,
    weight: 700,
    color: done ? UI.ok : "#fff",
    align: "center",
  });
  fillRR(c, rx + rw - 26 - 176 - 148, by, 132, 50, 25, "rgba(255,255,255,0.06)");
  text(c, "書き直す", rx + rw - 26 - 176 - 82, by + 31, {
    size: 17,
    weight: 600,
    color: UI.text2,
    align: "center",
  });

  // 注記
  text(
    c,
    "返信の前に、必ず人が目を通す設計です。AIだけで送ることはありません。",
    rx + 26,
    ly + 486,
    { size: 15, color: UI.text3 }
  );
}

/* ══════════════════ 07 PUBLISH（承認 → 公開） ══════════════════ */

/**
 * 代表シーン専用の画面。
 * 「あなたが承認ボタンを押した、その瞬間に何が起きるか」だけを見せます。
 *
 *   t=0.0〜0.9  … 承認する ボタンにカーソルが寄っていく
 *   t=0.9〜1.4  … 押した（ボタンが沈む）
 *   t=1.4〜2.6  … 公開処理が1行ずつ終わっていく
 *   t=2.6〜     … 公開中。お客様のサイトに出た
 */
const PUBLISH_STEPS: [string, string][] = [
  ["ガチャを保存", "設計・賞の内訳・口数を確定"],
  ["在庫と賞を引き当て", "重複しないように押さえる"],
  ["お客様のサイトへ公開", "example-gacha.jp に掲載"],
  ["監視をはじめる", "実還元率と残数を見はじめる"],
];

function publish(c: Ctx, t: number) {
  chrome(c, "publish", t);
  head(c, "APPROVE & PUBLISH", "あなたが承認した、その瞬間");

  const press = seg(t, 0.9, 1.25);
  const done = seg(t, 2.6, 3.1);

  /* ── 承認カード ── */
  const cy = TOP_H + 150;
  panel(c, CX, cy, CW, 150, 18, hexA(UI.ok, done > 0 ? 0.06 : 0.03));
  dot(c, CX + 40, cy + 58, 8, UI.ok, 0.9);
  text(c, "バックテスト 1万回：赤字になる確率 1.8%", CX + 66, cy + 65, {
    size: 20,
    weight: 600,
    color: "#CFF5E6",
  });
  text(
    c,
    "公開するかどうかを決めるのは、AIではなく運営者です。",
    CX + 40,
    cy + 112,
    { size: 16, color: UI.text3 }
  );

  // 承認ボタン（押し込みを表現する）
  const bw = 210;
  const bh = 56;
  const bx = CX + CW - bw - 32;
  const by = cy + 42 + press * 3;
  const pressed = press > 0.5;
  fillRR(
    c,
    bx,
    by,
    bw,
    bh,
    bh / 2,
    pressed ? "rgba(52,211,153,0.65)" : "rgba(52,211,153,0.92)"
  );
  if (!pressed) {
    // 押される前は光らせて、目を誘導する
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    rr(c, bx - 6, by - 6, bw + 12, bh + 12, (bh + 12) / 2);
    c.strokeStyle = hexA(UI.ok, 0.18 + pulse * 0.24);
    c.lineWidth = 2;
    c.stroke();
  }
  text(c, done > 0 ? "承認しました" : "承認する", bx + bw / 2, by + bh / 2 + 7, {
    size: 18,
    weight: 700,
    color: "#04231A",
    align: "center",
  });

  /* ── 公開の手順 ── */
  const sy = cy + 196;
  panel(c, CX, sy, CW, 372, 18);
  text(c, "公開のためにシステムがやること", CX + 30, sy + 44, {
    size: 17,
    color: UI.text2,
  });

  PUBLISH_STEPS.forEach(([title, sub], i) => {
    const y = sy + 84 + i * 68;
    // 1行ずつ順番に終わる
    const p = seg(t, 1.4 + i * 0.28, 1.85 + i * 0.28);
    const col = p >= 1 ? UI.ok : p > 0 ? UI.blue : UI.text3;

    // チェックの丸
    c.beginPath();
    c.arc(CX + 46, y + 14, 12, 0, Math.PI * 2);
    c.strokeStyle = hexA(col, 0.5);
    c.lineWidth = 2;
    c.stroke();
    if (p >= 1) {
      c.beginPath();
      c.moveTo(CX + 40, y + 14);
      c.lineTo(CX + 45, y + 19);
      c.lineTo(CX + 53, y + 8);
      c.strokeStyle = UI.ok;
      c.lineWidth = 2.6;
      c.lineCap = "round";
      c.stroke();
      c.lineCap = "butt";
    } else if (p > 0) {
      c.beginPath();
      c.arc(CX + 46, y + 14, 12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      c.strokeStyle = UI.blue;
      c.lineWidth = 2.6;
      c.stroke();
    }

    text(c, title, CX + 78, y + 12, {
      size: 19,
      weight: 600,
      color: p > 0 ? UI.text : UI.text3,
    });
    text(c, sub, CX + 78, y + 40, { size: 15, color: UI.text3 });
    if (p >= 1) {
      mono(c, "DONE", CX + CW - 32, y + 22, {
        size: 14,
        color: hexA(UI.ok, 0.8),
        align: "right",
      });
    }
  });

  /* ── 公開できた ── */
  if (done > 0) {
    const y = sy + 300;
    fillRR(c, CX + 24, y, CW - 48, 56, 14, hexA(UI.ok, 0.12 * done));
    dot(c, CX + 54, y + 28, 6, UI.ok, 0.9);
    text(c, "公開中：example-gacha.jp に掲載されました", CX + 78, y + 35, {
      size: 18,
      weight: 600,
      color: "#CFF5E6",
    });
  }
}

/* ══════════════════ 出口 ══════════════════ */

const PAINTERS: Record<AdminScreenKey, (c: Ctx, t: number) => void> = {
  dashboard,
  design,
  backtest,
  rtp: realRtp,
  shipping,
  operator,
  publish,
};

/** 1画面を描く。t は、その画面に入ってからの秒数。 */
export function paintAdmin(c: Ctx, key: AdminScreenKey, t: number) {
  c.save();
  c.clearRect(0, 0, ADMIN_W, ADMIN_H);
  PAINTERS[key](c, t);
  c.restore();
}

/** 画面ごとの見せ場の長さ（秒）。長い演出のものは長く映す。 */
export const ADMIN_DURATION: Record<AdminScreenKey, number> = {
  dashboard: 5.0,
  design: 8.6,
  backtest: 6.2,
  rtp: 5.6,
  shipping: 5.0,
  operator: 6.4,
  publish: 4.2,
};
