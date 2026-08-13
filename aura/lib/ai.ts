// AIによる返信下書き生成（Anthropic Messages API）。
// 方針：
//  - 景表法に触れる表現（必ず/絶対/儲かる 等の断定・誇大）は使わせない。
//  - 重い相談・炎上リスク（sensitivity_flag）のリプにはAI下書きを作らない（人が対応）。
//  - あくまで「下書き」。実送信は人の承認（ガード経由）を必須にする。

import { env } from "./env";

export interface DraftInput {
  brandName: string;
  tone?: string | null; // アカウントの口調プロファイル（任意）
  replyText: string; // 相手のリプ本文
  authorHandle?: string | null;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

// 生成させたくない表現（景表法・射幸性）。含まれたら弾く。
const BANNED = [
  "必ず",
  "絶対",
  "儲か",
  "確実",
  "誰でも",
  "100%",
  "大当たり",
];

function containsBanned(s: string): boolean {
  return BANNED.some((w) => s.includes(w));
}

// 返信下書きを1本生成する。失敗時・キー未設定時は null（下書きなし）。
export async function draftReply(input: DraftInput): Promise<string | null> {
  if (!env.anthropicKey) return null;

  const system = [
    `あなたは「${input.brandName}」のSNS運用担当者です。`,
    `Xに届いたリプへ、短く丁寧で親しみやすい日本語の返信案を1つだけ作ります。`,
    `制約：`,
    `- 140字以内。絵文字は多くても1〜2個。`,
    `- 「必ず」「絶対」「儲かる」等の断定・誇大表現は禁止（景表法）。`,
    `- 価格や当選を保証しない。煽らない。`,
    `- 相手の言葉に具体的に反応し、機械的なテンプレにしない。`,
    `- 返信本文だけを出力する（前置き・引用符・説明は不要）。`,
    input.tone ? `口調の参考：${input.tone}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = `届いたリプ（@${input.authorHandle ?? "user"}）:\n${input.replyText}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      console.error("[ai] non-ok", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    const text: string = (json.content?.[0]?.text ?? "").trim();
    if (!text) return null;
    if (containsBanned(text)) return null; // 禁止語が混じったら採用しない
    return text.length > 140 ? text.slice(0, 139) + "…" : text;
  } catch (e) {
    console.error("[ai] throw", e instanceof Error ? e.message : e);
    return null;
  }
}
