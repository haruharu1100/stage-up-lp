/**
 * 相談フォームの「取りこぼし防止」の受け皿。
 *
 * ★何のためにあるか
 *   本来、相談内容は CONTACT_WEBHOOK_URL（Googleスプレッドシート等）へ飛びます。
 *   その設定が無いまま本番で受け付けると「送ったのにどこにも無い」状態になるため、
 *   従来は 503（受付できません）で断っていました。
 *   広告を出している間にそれが起きると、お金を払って呼んだお客様をそのまま失います。
 *
 * ★ここがやること
 *   自前サーバーで動いている場合に限り、相談内容をサーバー上のファイルへ1行ずつ書き残します。
 *   書き残せた時だけ「受け付けました」と返します。書けなければ従来どおり正直に断ります。
 *
 * ★ここがやらないこと
 *   通知は行いません。つまりこれは「webhookの代わり」ではなく「取りこぼし防止」です。
 *   webhook を設定するまでの間、中身は人が読みに行く必要があります。
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** 書き出し先。未設定なら保存しない（＝Vercel等の書けない環境では無効） */
function sinkPath(): string | null {
  const p = process.env.LEAD_SINK_PATH;
  if (!p || !p.trim()) return null;
  return p.trim();
}

export function leadSinkEnabled(): boolean {
  return sinkPath() !== null;
}

/**
 * 相談1件を追記する。
 * 成功したら true。失敗したら false（呼び出し側は正直に断ること）。
 */
export async function appendLead(payload: unknown): Promise<boolean> {
  const file = sinkPath();
  if (!file) return false;

  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(payload) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch {
    // 失敗理由に本文（個人情報）は含めない
    return false;
  }
}
