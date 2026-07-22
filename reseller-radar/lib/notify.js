import nodemailer from "nodemailer";
import { getSetting } from "./db.js";

// SMTP設定が揃っていればメール送信、未設定ならスキップ
export async function sendNotificationEmail(taskName, items) {
  const host = ((await getSetting("smtp_host")) || "").trim();
  const to = ((await getSetting("notify_email")) || "").trim();
  const user = ((await getSetting("smtp_user")) || "").trim();
  const pass = (await getSetting("smtp_pass")) || "";
  const port = parseInt((await getSetting("smtp_port")) || "587", 10);

  if (!host || !to) {
    return { sent: false, reason: "SMTP未設定のためメール送信をスキップしました。" };
  }
  if (!items || items.length === 0) {
    return { sent: false, reason: "通知対象がありません。" };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });

  const lines = items.map((it) => {
    return [
      `■ ${it.product_name}`,
      `　仕入: ${yen(it.buy_price)} → Amazon: ${yen(it.amazon_price)}`,
      `　利益: ${yen(it.profit)}（利益率 ${it.profit_rate}%）`,
      `　月間販売数(目安): ${it.monthly_sales}`,
      `　商品URL: ${it.product_url || it.source_url || "-"}`,
    ].join("\n");
  });

  const body = [
    `Reseller Radar が利益条件を満たす商品を ${items.length} 件検知しました。`,
    `巡回タスク: ${taskName}`,
    "",
    lines.join("\n\n"),
  ].join("\n");

  await transporter.sendMail({
    from: user || to,
    to,
    subject: `【Reseller Radar】利益商品 ${items.length}件検知（${taskName}）`,
    text: body,
  });

  return { sent: true, count: items.length };
}

function yen(n) {
  const v = Number(n) || 0;
  return "¥" + v.toLocaleString("ja-JP");
}
