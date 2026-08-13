import { ActionType } from "./types";
import { getGuardSettings } from "./context";
import {
  countTodayActions,
  lastActionAt,
  recentBodies,
} from "./posts";

// section 5: 全てのX書き込みAPI呼び出しは例外なくこのモジュールを経由する。

export interface GuardResult {
  ok: boolean;
  // approval_required により保留（送信せず貯める）
  heldForApproval?: boolean;
  reason?: string;
}

// 正規化レーベンシュタイン類似度（0〜1）。外部依存なし。
function similarity(a: string, b: string): number {
  const s = a.trim();
  const t = b.trim();
  if (!s && !t) return 1;
  const m = s.length;
  const n = t.length;
  if (m === 0 || n === 0) return 0;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

const DUP_THRESHOLD = 0.9;

export interface CheckOptions {
  body?: string; // 重複・NGワード判定用
  // 承認モードを無視して間隔/上限のみ判定したい場合（cron消化の承認済み投稿など）
  ignoreApproval?: boolean;
}

export async function checkGuard(
  accountId: string,
  actionType: ActionType,
  opts: CheckOptions = {}
): Promise<GuardResult> {
  const gs = await getGuardSettings(accountId);

  // 1. 日次上限
  const limitMap: Record<ActionType, number> = {
    post: gs.daily_post_limit,
    reply: gs.daily_reply_limit,
    like: gs.daily_like_limit,
  };
  const used = await countTodayActions(accountId, actionType);
  if (used >= limitMap[actionType]) {
    return {
      ok: false,
      reason: `本日の${jp(actionType)}上限（${limitMap[actionType]}件）に達しました`,
    };
  }

  // 2. 最小間隔（±35%のランダムゆらぎ）
  const last = await lastActionAt(accountId, actionType);
  if (last) {
    const jitter = 1 + (Math.random() * 0.7 - 0.35);
    const needMs = gs.min_interval_seconds * jitter * 1000;
    const elapsed = Date.now() - last.getTime();
    if (elapsed < needMs) {
      const wait = Math.ceil((needMs - elapsed) / 1000);
      return {
        ok: false,
        reason: `前回の${jp(actionType)}から間隔が短すぎます（あと約${wait}秒）`,
      };
    }
  }

  // 3. NGワード & 4. 重複検知（本文がある場合）
  if (opts.body) {
    const hit = gs.ng_words.find(
      (w) => w && opts.body!.includes(w)
    );
    if (hit) {
      return { ok: false, reason: `NGワードが含まれています：「${hit}」` };
    }
    const bodies = await recentBodies(accountId);
    const dup = bodies.find((b) => similarity(b, opts.body!) >= DUP_THRESHOLD);
    if (dup) {
      return {
        ok: false,
        reason: "過去30日の投稿と内容が酷似しています（重複の可能性）",
      };
    }
  }

  // 5. 承認モード（デフォルトON）
  if (gs.approval_required && !opts.ignoreApproval) {
    return { ok: false, heldForApproval: true, reason: "承認待ち" };
  }

  return { ok: true };
}

function jp(a: ActionType): string {
  return a === "post" ? "投稿" : a === "reply" ? "返信" : "いいね";
}

// 重複検知を外部からも使えるよう公開
export { similarity };
