/**
 * 3D スマートフォンの画面に映る「お客様から見えるガチャサイト」。
 *
 *   HOME（NEW GACHA が届く）→ ガチャの詳細 → PLAY → 演出 → 当選 → マイページ
 *
 * ★ここに出すのは、実装済みの機能だけです。
 *   （会員登録・ポイント・抽選・発送 / ポイント還元の選択・マイページ）
 *   未実装のものを「できる」ように見せないこと。
 */

import {
  UI,
  type Ctx,
  clamp,
  dot,
  ease,
  fillRR,
  hexA,
  mono,
  panel,
  seg,
  shell,
  text,
} from "./kit";

export const PHONE_W = 720;
export const PHONE_H = 1560;

export const PHONE_SCREENS = [
  { key: "home", label: "HOME" },
  { key: "detail", label: "GACHA" },
  { key: "play", label: "PLAY" },
  { key: "result", label: "RESULT" },
  { key: "mypage", label: "MY PAGE" },
] as const;

export type PhoneScreenKey = (typeof PHONE_SCREENS)[number]["key"];

const W = PHONE_W;
const H = PHONE_H;
const PAD = 34;

/* ── 共通の枠（時計・サイト名・下メニュー） ── */

function chrome(c: Ctx, title: string, t: number, host = "example-gacha.jp") {
  shell(c, W, H);

  // ステータスバー
  mono(c, "9:41", PAD, 62, { size: 26, weight: 700, color: UI.text });
  for (let i = 0; i < 4; i++) {
    const bh = 8 + i * 5;
    fillRR(c, W - PAD - 96 + i * 13, 52 - bh + 18, 8, bh, 2, hexA(UI.text, 0.75));
  }
  fillRR(c, W - PAD - 34, 44, 30, 16, 4, hexA(UI.text, 0.75));

  // サイト名
  dot(c, PAD + 10, 128, 8, UI.blue, 0.5);
  text(c, title, PAD + 30, 137, { size: 27, weight: 700, color: UI.text });
  mono(c, host, W - PAD, 136, { size: 18, color: UI.text3, align: "right" });
  c.fillStyle = UI.line2;
  c.fillRect(PAD, 168, W - PAD * 2, 1.5);

  // 下メニュー
  const by = H - 116;
  c.fillStyle = "rgba(255,255,255,0.03)";
  c.fillRect(0, by, W, 116);
  c.fillStyle = UI.line2;
  c.fillRect(0, by, W, 1.5);
  const menu = ["ガチャ", "チャージ", "マイページ", "お知らせ"];
  const active = title === "マイページ" ? 2 : 0;
  menu.forEach((m, i) => {
    const x = (W / 4) * (i + 0.5);
    dot(c, x, by + 36, 6, i === active ? UI.blue : "rgba(255,255,255,0.2)");
    text(c, m, x, by + 76, {
      size: 19,
      weight: i === active ? 700 : 500,
      color: i === active ? UI.text : UI.text3,
      align: "center",
    });
  });
  fillRR(c, W / 2 - 68, H - 22, 136, 6, 3, hexA(UI.text, 0.28));
}

/** 商品の絵。写真は使わず、等級の色で「箱」を描く */
function prize(c: Ctx, x: number, y: number, w: number, h: number, col: string, label: string) {
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, hexA(col, 0.34));
  g.addColorStop(1, hexA(col, 0.08));
  fillRR(c, x, y, w, h, 18, g as unknown as string);
  c.strokeStyle = hexA(col, 0.42);
  c.lineWidth = 2;
  c.stroke();
  // 箱のシルエット
  const bw = w * 0.44;
  const bh = h * 0.36;
  const bx = x + (w - bw) / 2;
  const by = y + h * 0.28;
  fillRR(c, bx, by, bw, bh, 8, hexA(col, 0.55));
  fillRR(c, bx, by - bh * 0.22, bw, bh * 0.24, 5, hexA("#FFFFFF", 0.28));
  text(c, label, x + w / 2, y + h - 26, {
    size: 22,
    weight: 700,
    color: hexA("#FFFFFF", 0.9),
    align: "center",
  });
}

/* ══════════════════ 01 HOME ══════════════════ */

function home(c: Ctx, t: number) {
  chrome(c, "オンラインガチャ", t);

  const arrive = seg(t, 0.4, 1.5);

  // ポイント残高
  panel(c, PAD, 200, W - PAD * 2, 128, 18);
  text(c, "保有ポイント", PAD + 28, 248, { size: 21, color: UI.text2 });
  mono(c, "3,500 PT", W - PAD - 28, 288, {
    size: 44,
    weight: 700,
    color: UI.text,
    align: "right",
  });
  text(c, "チャージ", PAD + 28, 294, { size: 20, weight: 600, color: UI.blue });

  // 新着ガチャ
  const ny = 372;
  const glow = arrive * (0.5 + 0.5 * Math.sin(t * 3));
  panel(
    c,
    PAD,
    ny,
    W - PAD * 2,
    420,
    20,
    hexA(UI.blue, 0.06 + glow * 0.05),
    hexA(UI.blue, 0.2 + glow * 0.3)
  );
  c.globalAlpha = arrive;
  fillRR(c, PAD + 24, ny + 24, 148, 44, 22, hexA(UI.cyan, 0.2));
  text(c, "NEW", PAD + 98, ny + 54, {
    size: 22,
    weight: 700,
    color: UI.cyan,
    align: "center",
  });
  text(c, "ポケカ 限定オリパ", PAD + 24, ny + 122, {
    size: 32,
    weight: 700,
    color: UI.text,
  });
  prize(c, PAD + 24, ny + 148, W - PAD * 2 - 48, 190, UI.gold, "S賞 PSA10");
  mono(c, "1回 500 PT", PAD + 24, ny + 384, {
    size: 26,
    weight: 700,
    color: UI.text,
  });
  mono(c, "残り 1,000 口", W - PAD - 24, ny + 384, {
    size: 24,
    weight: 600,
    color: UI.cyan,
    align: "right",
  });
  c.globalAlpha = 1;

  // 販売中のほか
  const oy = ny + 452;
  text(c, "販売中", PAD, oy, { size: 22, weight: 600, color: UI.text2 });
  const others: [string, string][] = [
    ["スニーカー BOX", "1,000 PT"],
    ["家電フェス", "800 PT"],
  ];
  others.forEach(([nm, pr], i) => {
    const y = oy + 30 + i * 108;
    panel(c, PAD, y, W - PAD * 2, 92, 16);
    prize(c, PAD + 16, y + 12, 68, 68, UI.blue, "");
    text(c, nm, PAD + 104, y + 44, { size: 24, weight: 600, color: UI.text });
    mono(c, pr, PAD + 104, y + 74, { size: 20, color: UI.text3 });
    text(c, "引く", W - PAD - 30, y + 56, {
      size: 21,
      weight: 700,
      color: UI.blue,
      align: "right",
    });
  });
}

/* ══════════════════ 02 DETAIL ══════════════════ */

function detail(c: Ctx, t: number) {
  chrome(c, "オンラインガチャ", t);

  const p = ease(clamp(t / 1.2, 0, 1));

  text(c, "ポケカ 限定オリパ", PAD, 232, { size: 34, weight: 700, color: UI.text });
  prize(c, PAD, 260, W - PAD * 2, 300, UI.gold, "S賞 PSA10 リザードン");

  // 価格・残口数
  panel(c, PAD, 586, (W - PAD * 2) / 2 - 8, 118, 16);
  text(c, "1回", PAD + 24, 626, { size: 20, color: UI.text2 });
  mono(c, "500 PT", PAD + 24, 674, { size: 34, weight: 700, color: UI.text });
  const rx = PAD + (W - PAD * 2) / 2 + 8;
  panel(c, rx, 586, (W - PAD * 2) / 2 - 8, 118, 16);
  text(c, "残り口数", rx + 24, 626, { size: 20, color: UI.text2 });
  mono(c, Math.round(1000 * p).toLocaleString("ja-JP") + " 口", rx + 24, 674, {
    size: 34,
    weight: 700,
    color: UI.cyan,
  });

  // 賞の内訳
  text(c, "賞の内訳", PAD, 754, { size: 22, weight: 600, color: UI.text2 });
  const tiers: [string, string, string][] = [
    ["S賞", "3 本", UI.gold],
    ["A賞", "12 本", "#C6D4FF"],
    ["B賞", "85 本", UI.blue],
    ["C賞", "899 本", UI.text2],
    ["LAST ONE", "1 本", UI.cyan],
  ];
  tiers.forEach(([l, n, col], i) => {
    const y = 786 + i * 62;
    const show = clamp(p * tiers.length - i, 0, 1);
    c.globalAlpha = show;
    fillRR(c, PAD, y, W - PAD * 2, 50, 12, "rgba(255,255,255,0.035)");
    fillRR(c, PAD, y, 4, 50, 2, col);
    text(c, l, PAD + 24, y + 33, { size: 23, weight: 700, color: col });
    mono(c, n, W - PAD - 24, y + 33, {
      size: 23,
      weight: 600,
      color: UI.text,
      align: "right",
    });
    c.globalAlpha = 1;
  });

  // PLAY
  const by = 1118;
  const press = 0.5 + 0.5 * Math.sin(t * 2.2);
  const g = c.createLinearGradient(PAD, by, W - PAD, by + 96);
  g.addColorStop(0, "#1B4BD8");
  g.addColorStop(1, "#2F8FD6");
  fillRR(c, PAD, by, W - PAD * 2, 96, 48, g as unknown as string);
  c.globalAlpha = 0.25 * press;
  fillRR(c, PAD - 6, by - 6, W - PAD * 2 + 12, 108, 54, UI.blue);
  c.globalAlpha = 1;
  text(c, "500 PT で引く", W / 2, by + 60, {
    size: 30,
    weight: 700,
    color: "#fff",
    align: "center",
  });
  text(c, "当たった商品は、発送かポイント還元を選べます。", W / 2, by + 148, {
    size: 19,
    color: UI.text3,
    align: "center",
  });
}

/* ══════════════════ 03 PLAY（演出） ══════════════════ */

function play(c: Ctx, t: number) {
  shell(c, W, H);

  const spin = seg(t, 0, 2.2);
  const flash = seg(t, 2.1, 2.5);

  // 中央の光
  const cx = W / 2;
  const cy = H * 0.44;
  const r = 240;

  const glow = c.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9);
  glow.addColorStop(0, hexA(UI.gold, 0.34 + flash * 0.5));
  glow.addColorStop(0.5, hexA(UI.blue, 0.18));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  // 回るリング
  for (let i = 0; i < 3; i++) {
    const rr2 = r - i * 52;
    const a = t * (1.6 + i * 0.5) * (i % 2 ? -1 : 1);
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.beginPath();
    c.arc(0, 0, rr2, 0, Math.PI * 1.35);
    c.strokeStyle = hexA(i === 0 ? UI.gold : UI.blue, 0.5 - i * 0.12);
    c.lineWidth = 5 - i;
    c.lineCap = "round";
    c.stroke();
    c.restore();
  }

  // 中央のカプセル
  const pop = ease(spin) * (1 + flash * 0.14);
  c.save();
  c.translate(cx, cy);
  c.scale(pop, pop);
  fillRR(c, -88, -88, 176, 176, 44, hexA(UI.gold, 0.28));
  c.strokeStyle = hexA(UI.gold, 0.85);
  c.lineWidth = 3;
  c.stroke();
  fillRR(c, -88, -88, 176, 88, 44, hexA("#FFFFFF", 0.2));
  c.restore();

  // 粒
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + t * 0.9;
    const d = 150 + ((i * 37) % 130) + Math.sin(t * 2 + i) * 22;
    dot(
      c,
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d * 0.8,
      2.6 + (i % 3),
      i % 3 === 0 ? UI.gold : UI.cyan,
      0.4
    );
  }

  text(c, spin < 1 ? "抽選中…" : "結果が出ました", W / 2, H * 0.72, {
    size: 32,
    weight: 700,
    color: UI.text,
    align: "center",
  });
  mono(c, "500 PT", W / 2, H * 0.72 + 46, {
    size: 22,
    color: UI.text3,
    align: "center",
  });
}

/* ══════════════════ 04 RESULT（当選） ══════════════════ */

function result(c: Ctx, t: number) {
  chrome(c, "オンラインガチャ", t);

  const p = ease(clamp(t / 0.9, 0, 1));
  const pick = seg(t, 2.4, 3.0);

  c.globalAlpha = p;
  text(c, "おめでとうございます", W / 2, 250, {
    size: 30,
    weight: 700,
    color: UI.gold,
    align: "center",
  });
  const scale = 0.92 + 0.08 * p;
  c.save();
  c.translate(W / 2, 470);
  c.scale(scale, scale);
  c.translate(-W / 2, -470);
  prize(c, PAD, 288, W - PAD * 2, 364, UI.gold, "S賞");
  c.restore();

  text(c, "PSA10 リザードン", W / 2, 706, {
    size: 32,
    weight: 700,
    color: UI.text,
    align: "center",
  });
  mono(c, "参考価格 ¥ 68,000", W / 2, 744, {
    size: 21,
    color: UI.text3,
    align: "center",
  });
  c.globalAlpha = 1;

  // 発送 or ポイント還元
  text(c, "どちらにしますか？", PAD, 830, { size: 22, weight: 600, color: UI.text2 });
  const on = pick > 0.5;
  panel(
    c,
    PAD,
    862,
    W - PAD * 2,
    124,
    18,
    on ? hexA(UI.ok, 0.1) : "rgba(255,255,255,0.035)",
    on ? hexA(UI.ok, 0.36) : UI.line
  );
  text(c, "商品を発送してもらう", PAD + 28, 918, {
    size: 26,
    weight: 700,
    color: on ? "#CFF5E6" : UI.text,
  });
  text(c, "住所へお届けします", PAD + 28, 954, { size: 19, color: UI.text3 });
  if (on) dot(c, W - PAD - 40, 916, 11, UI.ok, 0.7);

  panel(c, PAD, 1006, W - PAD * 2, 124, 18);
  text(c, "ポイントに戻す", PAD + 28, 1062, {
    size: 26,
    weight: 700,
    color: UI.text,
  });
  mono(c, "+ 47,600 PT", PAD + 28, 1098, { size: 21, color: UI.text3 });

  // 確定
  const by = 1166;
  fillRR(
    c,
    PAD,
    by,
    W - PAD * 2,
    92,
    46,
    on ? "rgba(52,211,153,0.9)" : "rgba(255,255,255,0.08)"
  );
  text(c, on ? "発送を依頼する" : "選んでください", W / 2, by + 58, {
    size: 28,
    weight: 700,
    color: on ? "#04231A" : UI.text3,
    align: "center",
  });
}

/* ══════════════════ 05 MY PAGE ══════════════════ */

function mypage(c: Ctx, t: number) {
  chrome(c, "マイページ", t);

  const p = ease(clamp(t / 1.2, 0, 1));

  panel(c, PAD, 200, W - PAD * 2, 118, 18);
  text(c, "保有ポイント", PAD + 28, 246, { size: 21, color: UI.text2 });
  mono(c, "3,000 PT", W - PAD - 28, 286, {
    size: 40,
    weight: 700,
    color: UI.text,
    align: "right",
  });

  text(c, "発送状況", PAD, 372, { size: 22, weight: 600, color: UI.text2 });
  panel(c, PAD, 400, W - PAD * 2, 244, 18);
  text(c, "PSA10 リザードン", PAD + 28, 452, {
    size: 26,
    weight: 700,
    color: UI.text,
  });
  mono(c, "注文 #20812", PAD + 28, 486, { size: 19, color: UI.text3 });

  const steps = ["申込", "梱包", "発送", "お届け"];
  const done = 2 + (p > 0.8 ? 1 : 0);
  steps.forEach((s, i) => {
    const x = PAD + 46 + i * ((W - PAD * 2 - 92) / 3);
    const on = i < done;
    dot(c, x, 552, 11, on ? UI.ok : "rgba(255,255,255,0.16)", on ? 0.5 : 0);
    text(c, s, x, 600, {
      size: 19,
      weight: on ? 700 : 500,
      color: on ? UI.text : UI.text3,
      align: "center",
    });
    if (i < 3) {
      c.strokeStyle = i < done - 1 ? hexA(UI.ok, 0.5) : "rgba(255,255,255,0.1)";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + 16, 552);
      c.lineTo(x + (W - PAD * 2 - 92) / 3 - 16, 552);
      c.stroke();
    }
  });

  // 追跡番号
  panel(c, PAD, 668, W - PAD * 2, 108, 16, hexA(UI.ok, 0.07), hexA(UI.ok, 0.26));
  text(c, "発送しました", PAD + 28, 712, { size: 22, weight: 700, color: "#CFF5E6" });
  mono(c, "追跡番号 4912-8830-7761", PAD + 28, 748, { size: 19, color: UI.text2 });

  // 履歴
  text(c, "プレイ履歴", PAD, 828, { size: 22, weight: 600, color: UI.text2 });
  const hist: [string, string, string][] = [
    ["ポケカ 限定オリパ", "S賞 PSA10 リザードン", UI.gold],
    ["スニーカー BOX", "C賞", UI.text2],
    ["家電フェス", "B賞", UI.blue],
  ];
  hist.forEach(([g, r, col], i) => {
    const y = 860 + i * 96;
    const show = clamp(p * 3 - i, 0, 1);
    c.globalAlpha = show;
    panel(c, PAD, y, W - PAD * 2, 80, 14);
    fillRR(c, PAD, y, 4, 80, 2, col);
    text(c, g, PAD + 26, y + 36, { size: 22, color: UI.text });
    text(c, r, PAD + 26, y + 64, { size: 19, color: col });
    c.globalAlpha = 1;
  });

  text(c, "住所・お知らせ・利用規約もここから確認できます。", PAD, 1188, {
    size: 18,
    color: UI.text3,
  });
}

/* ══════════════════ 出口 ══════════════════ */

const PAINTERS: Record<PhoneScreenKey, (c: Ctx, t: number) => void> = {
  home,
  detail,
  play,
  result,
  mypage,
};

export function paintPhone(c: Ctx, key: PhoneScreenKey, t: number) {
  c.save();
  c.clearRect(0, 0, PHONE_W, PHONE_H);
  PAINTERS[key](c, t);
  c.restore();
}

export const PHONE_DURATION: Record<PhoneScreenKey, number> = {
  home: 4.2,
  detail: 5.0,
  play: 3.2,
  result: 4.6,
  mypage: 4.6,
};

/* ══════════════════ 旧システムの管理画面（移行セクション用） ══════════════════ */

export const OLD_W = 1400;
export const OLD_H = 900;

/**
 * 「いま使っている、よくある管理画面」。
 * 悪く描くのではなく、"別々の道具に分かれている" 状態として描く。
 */
export function paintOldAdmin(c: Ctx, t: number) {
  c.save();
  c.clearRect(0, 0, OLD_W, OLD_H);

  // 明るいグレーの、素朴な管理画面
  c.fillStyle = "#E9EDF3";
  c.fillRect(0, 0, OLD_W, OLD_H);

  // ブラウザのバー
  c.fillStyle = "#D5DBE5";
  c.fillRect(0, 0, OLD_W, 72);
  ["#EF6A5E", "#F5BF4F", "#61C554"].forEach((col, i) => {
    dot(c, 40 + i * 30, 36, 9, col);
  });
  fillRR(c, 150, 18, OLD_W - 200, 38, 19, "#FFFFFF");
  mono(c, "admin.example-gacha.jp", 176, 44, { size: 19, color: "#5A6478" });

  // 上部メニュー
  c.fillStyle = "#3C4A63";
  c.fillRect(0, 72, OLD_W, 62);
  ["ホーム", "商品", "受注", "会員", "設定"].forEach((m, i) => {
    text(c, m, 44 + i * 110, 111, {
      size: 20,
      weight: i === 0 ? 700 : 500,
      color: i === 0 ? "#FFFFFF" : "rgba(255,255,255,0.6)",
    });
  });

  // 表
  const rows = 9;
  fillRR(c, 40, 168, OLD_W - 80, 62 + rows * 56, 8, "#FFFFFF");
  c.fillStyle = "#F1F4F9";
  c.fillRect(40, 168, OLD_W - 80, 62);
  ["注文番号", "会員", "内容", "状態", "更新日"].forEach((h, i) => {
    text(c, h, 76 + i * 250, 206, { size: 18, weight: 700, color: "#48546B" });
  });
  for (let i = 0; i < rows; i++) {
    const y = 230 + i * 56;
    const vals = [
      `#${20812 - i}`,
      `member_${1042 + i * 7}`,
      i % 3 === 0 ? "オリパ 500pt" : i % 3 === 1 ? "BOX 1000pt" : "ポイント購入",
      i % 4 === 0 ? "未処理" : "処理済",
      `8/${21 - (i % 6)}`,
    ];
    vals.forEach((v, k) => {
      text(c, v, 76 + k * 250, y + 36, {
        size: 17,
        color: k === 3 && i % 4 === 0 ? "#C2262A" : "#5A6478",
      });
    });
    c.fillStyle = "#EDF0F5";
    c.fillRect(76, y + 54, OLD_W - 152, 1);
  }

  // 手作業の付箋（別のツールに分かれている状態）
  const wob = Math.sin(t * 1.4) * 3;
  const notes: [string, string, number, number][] = [
    ["Excel  在庫管理.xlsx", "#1D7044", OLD_W - 470, 300],
    ["メール  発送連絡", "#8A5A16", OLD_W - 430, 470],
    ["電卓で還元率を計算", "#7A2E2E", OLD_W - 500, 640],
  ];
  notes.forEach(([label, col, x, y], i) => {
    c.save();
    c.translate(x, y + (i === 1 ? wob : -wob));
    c.rotate(((i - 1) * 1.6 * Math.PI) / 180);
    fillRR(c, 0, 0, 400, 108, 10, "#FFF6D8");
    c.strokeStyle = "rgba(0,0,0,0.1)";
    c.lineWidth = 1.5;
    c.stroke();
    text(c, label, 28, 50, { size: 22, weight: 700, color: col });
    text(c, "手で確認している", 28, 84, { size: 18, color: "#7A7263" });
    c.restore();
  });

  c.restore();
}
