/**
 * 監査ログを読む（GET /api/console/audit）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、わざわざ「読むための入口」を作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   記録は、書いた時点では、まだ半分しか役に立っていません。
 *   読まれてはじめて、記録です。
 *
 *   これまで監査ログの画面は、その場で作った見本を並べていました。
 *   見本は、何が起きても増えません。増えないものを毎日見ていると、
 *   人は、そのうち見なくなります。
 *
 *   ここから先は、サーバーに本当に残っている記録を出します。
 *   仮パスワードを1件発行すれば、この画面が1件増えます。
 *   増えないなら、それは記録されていないということです。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口の決まり（ゆるめないこと）
 * ═══════════════════════════════════════════════════════
 *
 *   ① 自分の会社の記録しか返さない。
 *      監査ログには「誰が・いつ・何を」が全部入っています。
 *      よその会社の記録が1件でも混ざったら、
 *      それは、その会社の内部の動きを渡したのと同じです。
 *
 *   ② 監査ログを見る権限（audit.view）がある人だけ。
 *      全員に見せてよい情報ではありません。
 *
 *   ③ 鍵に見えるものは、何があっても外に出さない。
 *      そもそも監査ログに合言葉を書かない決まりですが、
 *      決まりは、いつか誰かが破ります。
 *      破られた日に備えて、出口でもう一度こしとります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 一度に返す件数の上限 */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

/**
 * 「鍵に見える名前」の一覧。
 *
 * ★ここを短くしないこと。
 *   監査ログの追加項目（data）は、これから先も増えていきます。
 *   増やす人が毎回「これは出してよいか」を正しく考える、
 *   という前提に立った作りは、いつか必ず破れます。
 *   だから、出口で名前を見て落とします。
 *
 * ★完全一致ではなく、部分一致で見ること。
 *   tempPassword / password_hash / newPassword は、
 *   どれも "password" を含みます。
 */
const KIKEN_NA_NA = [
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "otp",
  "totp",
  "mfa",
  "seed",
  "salt",
  "hash",
  "signature",
  "cookie",
  "session",
  "authorization",
  "bearer",
];

/** 値の長さの上限。長すぎるものは、画面にも監査にも要りません */
const MAX_LEN = 300;

/**
 * 追加項目（data）を、外に出してよい形にする。
 *
 * ★「入れた覚えのないものは出さない」ではなく、
 *   「出してよいと分かるものだけ出す」に寄せています。
 *   前者は、書く人を信じる作りです。後者は、信じなくても壊れません。
 */
function anzenNaData(nama: unknown): Record<string, unknown> | null {
  if (nama == null) return null;

  let hodoita: unknown = nama;
  if (typeof nama === "string") {
    try {
      hodoita = JSON.parse(nama);
    } catch {
      /* JSONでないなら、そのまま出さない。中身を推測しないこと */
      return null;
    }
  }
  if (typeof hodoita !== "object" || hodoita === null || Array.isArray(hodoita)) {
    return null;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(hodoita as Record<string, unknown>)) {
    const na = k.toLowerCase();
    if (KIKEN_NA_NA.some((ng) => na.includes(ng))) continue;

    /* 入れ子は、そのまま出さない。
       深いところに鍵が隠れていても、名前だけでは気づけないからです */
    if (typeof v === "object" && v !== null) continue;

    if (typeof v === "string") {
      out[k] = v.length > MAX_LEN ? `${v.slice(0, MAX_LEN)}…` : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    /* undefined / null は、出しても読む人の役に立たないので落とす */
  }

  return Object.keys(out).length === 0 ? null : out;
}

export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    /* ★ここを外さないこと。監査ログは、全員に見せる画面ではありません */
    permission: "audit.view",
  });
  if (!passed(gate)) return gate;

  const url = new URL(req.url);
  const nokoshi = url.searchParams.get("action");
  const kazuMoji = url.searchParams.get("limit");
  const kazu = Math.min(
    Math.max(Number(kazuMoji) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  try {
    const { db } = await import("@/lib/server/db");

    /*
     * ★tenant_id の条件を、絶対に外さないこと。
     *   外した瞬間、この1行が「他社の内部の動きを全部渡す口」になります。
     *   ここは、テストで固定してあります（よその会社の記録は1件も混ざらない）。
     */
    const jouken = nokoshi
      ? { sql: ` AND action = ?`, args: [nokoshi] }
      : { sql: ``, args: [] as string[] };

    const r = await db().execute({
      sql: `SELECT seq, at, actor_kind, actor_id, actor_name, actor_role,
                   action, target, summary, before_text, after_text,
                   reason, data, request_id
              FROM audit_events
             WHERE tenant_id = ?${jouken.sql}
             ORDER BY seq DESC
             LIMIT ?`,
      args: [gate.session.tenantId, ...jouken.args, kazu],
    });

    const kiroku = r.rows.map((raw) => {
      const row = raw as unknown as Record<string, unknown>;
      const moji = (v: unknown) => (v == null ? "" : String(v));
      return {
        seq: Number(row.seq ?? 0),
        at: moji(row.at),
        actorKind: moji(row.actor_kind),
        actorId: moji(row.actor_id),
        actorName: moji(row.actor_name),
        actorRole: moji(row.actor_role),
        action: moji(row.action),
        target: moji(row.target),
        summary: moji(row.summary),
        before: row.before_text == null ? null : String(row.before_text),
        after: row.after_text == null ? null : String(row.after_text),
        reason: row.reason == null ? null : String(row.reason),
        requestId: row.request_id == null ? null : String(row.request_id),
        /* ★生のまま返さないこと。出口でこしとってから渡します */
        data: anzenNaData(row.data),
      };
    });

    /* 何件あるか（画面に「全部で○件」と出すため） */
    const zen = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id = ?`,
      args: [gate.session.tenantId],
    });
    const total = Number(
      (zen.rows[0] as unknown as Record<string, unknown>)?.n ?? 0,
    );

    return NextResponse.json(
      {
        ok: true,
        requestId: gate.requestId,
        total,
        events: kiroku,
      },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "audit-list", e);
  }
}
