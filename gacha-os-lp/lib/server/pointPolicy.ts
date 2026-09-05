/**
 * ポイントの有効期限を、お店ごとに決めておく場所。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルは「入れ物」です。期限を実行しません
 * ═══════════════════════════════════════════════════════
 *
 *   ここに設定を書いても、ポイントは1ptも消えません。
 *   消す処理は、意図的に作っていません。
 *
 *   なぜ作らないのか。
 *
 *     ポイントの有効期限は、法律（資金決済法・前払式支払手段）に
 *     関わります。期限をどう置くかで、届出が要る／要らないが
 *     変わることがあります。
 *
 *     ★これは、こちらが決めてよいことではありません。
 *       AI も、開発側も、判断しません。
 *       決めるのは、専門家に確かめたお店の方です。
 *
 *     ですので、ここでは「決めた内容を預かる」だけにします。
 *     実際に消す処理は、お店が値を決め、専門家の確認が済み、
 *     そのうえで作ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★既定を「期限なし」にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   はじめの値は "UNSET"（まだ決めていない）です。
 *
 *   これを "NONE"（期限なし）にしたくなります。
 *   そのほうが画面がきれいで、お店にも何も聞かずに済むからです。
 *
 *   ★それをしないこと。
 *     「期限なし」は、立派な1つの決定です。
 *     決めていないことと、同じ見た目にしてはいけません。
 *
 *     こちらが黙って "NONE" を入れると、
 *     お店は「決めた覚えがないのに決まっていた」ことになります。
 *     あとで問題になったとき、誰が決めたのかを誰も言えません。
 *
 *   ★逆に、こちらが「90日」のような数字を既定にするのも、
 *     もっといけません。
 *     法律を避ける目的で、こちらが期間を選んだことになります。
 *     それは、こちらが法律の判断をしたのと同じです。
 *
 * ═══════════════════════════════════════════════════════
 * ★「専門家に確認した」を、こちらで埋めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   confirmed_at は、お店の方が「確認しました」と
 *   自分でチェックしたときだけ入ります。
 *
 *   保存したから自動で入れる、時間が経ったから入れる、
 *   といったことは、いっさいしません。
 *   確認していないことを「確認済み」と記録すると、
 *   その記録は、あとで誰の役にも立ちません。
 */

import { withWriteTx, db } from "./db";
import { appendAuditTx } from "./audit";
import type { Actor } from "./orders";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));

/** まだ決めていない／期限なし／購入から○日／購入から○か月 */
export type ExpiryMode = "UNSET" | "NONE" | "DAYS" | "MONTHS";

export class PointPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PointPolicyError";
    this.code = code;
  }
}

/**
 * 入れられる期間の幅。
 *
 * ★ここを「おすすめの値」として画面に出さないこと。
 *   出した瞬間、それはこちらが選んだ期間になります。
 *   ここは、打ち間違いを止めるためだけの幅です。
 */
export const MIN_DAYS = 1;
export const MAX_DAYS = 3650; /* 10年 */
export const MIN_MONTHS = 1;
export const MAX_MONTHS = 120; /* 10年 */

export type PointPolicy = {
  mode: ExpiryMode;
  /** DAYS / MONTHS のときの数。それ以外は null */
  value: number | null;
  /**
   * お店が「専門家に確認した」と記録した日。
   * ★こちらで入れないこと。空のままでも、それが事実です。
   */
  confirmedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /**
   * まだ決めていないかどうか。
   *
   * ★これを false にする条件を緩めないこと。
   *   「期限なし」を選んだ場合は decided = true です（決めたので）。
   */
  decided: boolean;
  /**
   * お客様にも運営にも、そのまま見せてよい日本語。
   *
   * ★画面ごとに書き直さないこと。
   *   書き直した日から、画面ごとに違う言い方になります。
   */
  label: string;
  /**
   * いま、ポイントが実際に消えるかどうか。
   *
   * ★いまは必ず false です。消す処理を作っていないからです。
   *   設定だけを見て「消えている」と思い込まないための印です。
   */
  enforced: boolean;
};

/**
 * 決まりを、そのまま見せてよい日本語にする。
 *
 * ★"UNSET" を「期限なし」と訳さないこと。
 *   いちばんやってはいけない訳し方です。
 *   決めていないことを、決めたことにしてしまいます。
 */
export function policyLabel(mode: ExpiryMode, value: number | null): string {
  switch (mode) {
    case "NONE":
      return "有効期限なし";
    case "DAYS":
      return `購入から ${Number(value ?? 0).toLocaleString("ja-JP")} 日`;
    case "MONTHS":
      return `購入から ${Number(value ?? 0).toLocaleString("ja-JP")} か月`;
    default:
      return "未設定（お店がまだ決めていません）";
  }
}

function toPolicy(row: Row | null): PointPolicy {
  const rawMode = str(row?.expiry_mode);
  const mode: ExpiryMode =
    rawMode === "NONE" || rawMode === "DAYS" || rawMode === "MONTHS"
      ? rawMode
      : /* ★読めない値が入っていたら "UNSET" に倒すこと。
             勝手に「期限なし」と読み替えると、
             壊れた設定が、決定として通ってしまいます。 */
        "UNSET";

  const value =
    mode === "DAYS" || mode === "MONTHS"
      ? Number(row?.expiry_value ?? 0) || null
      : null;

  const confirmedAt = str(row?.confirmed_at) || null;

  return {
    mode,
    value,
    confirmedAt,
    updatedAt: str(row?.updated_at) || null,
    updatedBy: str(row?.updated_by) || null,
    decided: mode !== "UNSET",
    label: policyLabel(mode, value),
    /* ★ここを true にできるのは、実際に消す処理を作ったときだけです。
         設定を保存できるようになっただけで true にしないこと。 */
    enforced: false,
  };
}

/**
 * いまの決まりを読む。
 *
 * 1行も無ければ「まだ決めていない」を返します。
 * ★無いことを、エラーにしないこと。
 *   新しく契約したお店は、必ずこの状態から始まります。
 */
export async function getPointPolicy(tenantId: string): Promise<PointPolicy> {
  const res = await db().execute({
    sql: `SELECT expiry_mode, expiry_value, confirmed_at, updated_at, updated_by
            FROM tenant_point_policy WHERE tenant_id = ?`,
    args: [tenantId],
  });
  return toPolicy((res.rows[0] as Row) ?? null);
}

/**
 * 入力を確かめる。
 *
 * ★"UNSET" を保存させないこと。
 *   「決めていない状態に戻す」操作を作ると、
 *   決めた記録を消す道ができます。
 *   決め直したいなら、新しい決まりを選んでもらいます。
 */
function check(mode: unknown, value: unknown): { mode: ExpiryMode; value: number | null } {
  const m = str(mode);

  if (m === "NONE") return { mode: "NONE", value: null };

  if (m === "DAYS" || m === "MONTHS") {
    const n = Math.trunc(Number(value));
    const min = m === "DAYS" ? MIN_DAYS : MIN_MONTHS;
    const max = m === "DAYS" ? MAX_DAYS : MAX_MONTHS;
    const tani = m === "DAYS" ? "日" : "か月";

    if (!Number.isFinite(n) || n < min || n > max) {
      throw new PointPolicyError(
        "BAD_VALUE",
        `期間は ${min}〜${max}${tani} の範囲で入力してください。`,
      );
    }
    return { mode: m, value: n };
  }

  if (m === "UNSET" || m === "") {
    throw new PointPolicyError(
      "MODE_REQUIRED",
      "有効期限をどうするかを選んでください。「期限なし」も選べます。",
    );
  }

  throw new PointPolicyError("BAD_MODE", "有効期限の決め方が正しくありません。");
}

/**
 * 決まりを保存する。
 *
 * @param confirmed お店の方が「専門家に確認した」と自分でチェックしたか。
 *   ★呼ぶ側が勝手に true を渡さないこと。
 *     画面のチェックボックスの値を、そのまま持ってきてください。
 */
export async function savePointPolicy(args: {
  tenantId: string;
  mode: unknown;
  value: unknown;
  confirmed: boolean;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<PointPolicy> {
  const at = args.now ?? new Date().toISOString();
  const { mode, value } = check(args.mode, args.value);

  return withWriteTx(async (tx) => {
    const cur = await tx.execute({
      sql: `SELECT expiry_mode, expiry_value, confirmed_at, updated_at, updated_by
              FROM tenant_point_policy WHERE tenant_id = ?`,
      args: [args.tenantId],
    });
    const mae = toPolicy((cur.rows[0] as Row) ?? null);

    /* ★確認済みの印は、外れる方向にも動かせること。
         期間を変えたのに「確認済み」が残っていると、
         確かめていない内容が確認済みに見えます。 */
    const confirmedAt = args.confirmed
      ? (mae.confirmedAt ?? at)
      : null;

    /* 期間そのものが変わったなら、前の確認は、この内容の確認ではありません */
    const kawatta = mae.mode !== mode || mae.value !== value;
    const finalConfirmedAt = kawatta
      ? args.confirmed
        ? at
        : null
      : confirmedAt;

    await tx.execute({
      sql: `INSERT INTO tenant_point_policy
              (tenant_id, expiry_mode, expiry_value, confirmed_at, updated_at, updated_by)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(tenant_id) DO UPDATE SET
              expiry_mode  = excluded.expiry_mode,
              expiry_value = excluded.expiry_value,
              confirmed_at = excluded.confirmed_at,
              updated_at   = excluded.updated_at,
              updated_by   = excluded.updated_by`,
      args: [
        args.tenantId,
        mode,
        value,
        finalConfirmedAt,
        at,
        args.actor.name,
      ],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "POINT_POLICY_UPDATED",
      target: args.tenantId,
      summary:
        `ポイントの有効期限を「${policyLabel(mode, value)}」にしました` +
        (finalConfirmedAt
          ? "（専門家に確認済みとして記録）"
          : "（専門家の確認は、まだ記録されていません）"),
      before: mae.label,
      after: policyLabel(mode, value),
      reason: "お店の設定変更",
      requestId: args.requestId,
      data: {
        modeBefore: mae.mode,
        valueBefore: mae.value,
        modeAfter: mode,
        valueAfter: value,
        confirmedAt: finalConfirmedAt,
        /* ★保存しても、まだ1ptも消えないことを記録に残しておきます。
             あとから「設定したのに消えていない」と言われたときに、
             こちらの記録だけで説明できるようにするためです。 */
        enforced: false,
      },
    });

    return {
      mode,
      value,
      confirmedAt: finalConfirmedAt,
      updatedAt: at,
      updatedBy: args.actor.name,
      decided: true,
      label: policyLabel(mode, value),
      enforced: false,
    };
  });
}

/**
 * 公開の前に、決めておかなければならないことが残っていないか。
 *
 * ★ここで「決めていないなら期限なし」と補わないこと。
 *   補った時点で、こちらが決めたことになります。
 */
export function policyBlocker(p: PointPolicy): string | null {
  if (!p.decided) {
    return (
      "ポイントの有効期限が、まだ決まっていません。" +
      "「有効期限なし」も選べますが、こちらでは決められません。" +
      "お店の判断で選んでください（法律に関わるため、専門家にご確認ください）。"
    );
  }
  if (!p.confirmedAt) {
    return (
      `ポイントの有効期限は「${p.label}」で保存されていますが、` +
      "専門家に確認したという記録がありません。" +
      "確認のうえ、設定画面でチェックを入れてください。"
    );
  }
  return null;
}
