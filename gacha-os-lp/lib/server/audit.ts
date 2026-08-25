/**
 * 監査ログ（運営側に保存する版）。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面の中の監査ログと、何が違うのか
 * ═══════════════════════════════════════════════════════
 *
 *   lib/console/audit.ts は、鎖の作り方と検証のしかたを持っています。
 *   ここは、それを「保存されたDBに対して」行うところです。
 *
 *   計算方法は同じものを使います。2つ書くと、いつか片方だけ直されて、
 *   画面では正しいのにサーバーでは改ざん扱い、という壊れ方をします。
 *
 * ═══════════════════════════════════════════════════════
 * ★1件足すときの決まり
 * ═══════════════════════════════════════════════════════
 *
 *   1) 必ず書き込みの取引（トランザクション）の中で足すこと。
 *      本体の処理だけ成功して記録が残らない、を起こさないため。
 *
 *   2) 通し番号は、その会社（tenant）ごとに1から数えること。
 *      全社で1本にすると、1社の記録を見せるだけで
 *      他社が何件動いたかが分かってしまいます。
 *
 *   3) 抽選のように項目が多いものは data（JSON）へ入れ、version を v2 にすること。
 *      data もハッシュの計算に入っているので、後から書き換えれば検知されます。
 */

import type { Client, Transaction } from "@libsql/client";
import {
  GENESIS,
  canonicalData,
  hashEntry,
  type AuditAction,
} from "../console/audit";
import { SERVER_VERSION } from "./db";
import { id } from "./ids";

export type ServerAuditInput = {
  tenantId: string;
  at: string;
  /** 誰が … 運営の担当者か、お客様か、システム自身か */
  actorKind: "ADMIN" | "CUSTOMER" | "SYSTEM";
  actorId: string;
  actorName: string;
  actorRole: string;
  action: AuditAction;
  target: string;
  summary: string;
  before?: string;
  after?: string;
  reason?: string;
  /** 追加項目。オブジェクトで渡すと、決まった並びのJSONにしてから鎖に入れる */
  data?: Record<string, unknown>;
  requestId?: string;
  idempotencyKey?: string;
};

/** 監査ログを1件足す（取引の中で呼ぶこと） */
export async function appendAuditTx(
  tx: Transaction,
  input: ServerAuditInput,
): Promise<{ seq: number; hash: string }> {
  const last = await tx.execute({
    sql: `SELECT seq, hash FROM audit_events
           WHERE tenant_id = ?
           ORDER BY seq DESC LIMIT 1`,
    args: [input.tenantId],
  });

  const prev = last.rows[0] as unknown as
    | { seq: number; hash: string }
    | undefined;
  const seq = prev ? Number(prev.seq) + 1 : 1;
  const prevHash = prev ? String(prev.hash) : GENESIS;
  const data = input.data ? canonicalData(input.data) : undefined;

  const hash = hashEntry({
    seq,
    at: input.at,
    actorId: input.actorId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    target: input.target,
    summary: input.summary,
    before: input.before,
    after: input.after,
    reason: input.reason,
    version: "v2",
    data,
    prevHash,
  });

  await tx.execute({
    sql: `INSERT INTO audit_events
            (id, tenant_id, seq, at, actor_kind, actor_id, actor_name, actor_role,
             action, target, summary, before_text, after_text, reason, data,
             request_id, idempotency_key, server_version, prev_hash, hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id("aud"),
      input.tenantId,
      seq,
      input.at,
      input.actorKind,
      input.actorId,
      input.actorName,
      input.actorRole,
      input.action,
      input.target,
      input.summary,
      input.before ?? null,
      input.after ?? null,
      input.reason ?? null,
      data ?? null,
      input.requestId ?? null,
      input.idempotencyKey ?? null,
      SERVER_VERSION,
      prevHash,
      hash,
    ],
  });

  return { seq, hash };
}

export type ServerVerifyResult =
  | { ok: true; checked: number }
  | {
      ok: false;
      checked: number;
      brokenAt: number;
      why: "HASH_MISMATCH" | "CHAIN_BROKEN" | "SEQ_BROKEN";
      detail: string;
    };

/**
 * 保存されている監査ログを、1件目から計算し直して確かめる。
 *
 * ★保存されている hash を信用しないこと。
 *   信用して比べるだけなら、hash も一緒に書き換えれば通ってしまいます。
 */
export async function verifyAuditOfTenant(
  client: Client | Transaction,
  tenantId: string,
): Promise<ServerVerifyResult> {
  const res = await client.execute({
    sql: `SELECT seq, at, actor_id, actor_name, actor_role, action, target, summary,
                 before_text, after_text, reason, data, prev_hash, hash
            FROM audit_events WHERE tenant_id = ? ORDER BY seq ASC`,
    args: [tenantId],
  });

  let prevHash = GENESIS;
  const rows = res.rows as Record<string, unknown>[];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const seq = Number(r.seq);

    if (seq !== i + 1) {
      return {
        ok: false,
        checked: i,
        brokenAt: seq,
        why: "SEQ_BROKEN",
        detail: `${i + 1}件目にあるはずの記録が、${seq}番になっています。間の記録が抜けています。`,
      };
    }

    if (String(r.prev_hash) !== prevHash) {
      return {
        ok: false,
        checked: i,
        brokenAt: seq,
        why: "CHAIN_BROKEN",
        detail: `${seq}番の記録が、ひとつ前の記録につながっていません。差し込まれたか、入れ替えられています。`,
      };
    }

    const recomputed = hashEntry({
      seq,
      at: String(r.at),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      actorRole: String(r.actor_role),
      action: String(r.action) as AuditAction,
      target: String(r.target),
      summary: String(r.summary),
      before: r.before_text == null ? undefined : String(r.before_text),
      after: r.after_text == null ? undefined : String(r.after_text),
      reason: r.reason == null ? undefined : String(r.reason),
      version: "v2",
      data: r.data == null ? undefined : String(r.data),
      prevHash,
    });

    if (recomputed !== String(r.hash)) {
      return {
        ok: false,
        checked: i,
        brokenAt: seq,
        why: "HASH_MISMATCH",
        detail: `${seq}番の記録（${String(r.summary)}）の中身が、記録された当時から書き換えられています。`,
      };
    }

    prevHash = String(r.hash);
  }

  return { ok: true, checked: rows.length };
}
