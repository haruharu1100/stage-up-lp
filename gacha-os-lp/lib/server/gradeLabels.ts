/**
 * 賞の「呼び名」を、お店ごとに決められるようにする道具。
 *
 * ═══════════════════════════════════════════════════════
 * ★これが何のためにあるのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、賞の呼び名は S賞 / A賞 / B賞 / C賞 / D賞 に固定でした。
 *   ですが、実際のお店はそれぞれ別の呼び方をします。
 *
 *     ・特賞 / 1等 / 2等 / 3等 / 参加賞
 *     ・PSA10賞 / BOX賞 / ラストワン賞
 *     ・SSR / SR / R / N
 *
 *   呼び名が変えられないと、お店は自分の売り方ができません。
 *   ここは、その呼び名だけを持ちます。
 *
 * ═══════════════════════════════════════════════════════
 * ★いちばん大事な決まり（これを破ると壊れます）
 * ═══════════════════════════════════════════════════════
 *
 *   ★中の記号（grade = "S" "A" "B" "C" "D"）は、絶対に書き換えないこと。
 *
 *   理由：
 *     ・gacha_stock は (tenant_id, gacha_id, grade) が主キーです。
 *       grade を書き換えると、在庫の行そのものが別物になります。
 *     ・prizes（当選履歴）にも grade が入っています。
 *       過去に当たった記録と、今の在庫のつながりが切れます。
 *     ・還元率の計算（rtpMonitor）は grade で「現物かポイントか」を
 *       見分けています。書き換えると、還元率が丸ごと狂います。
 *
 *   ですので、ここで持つのは「見せる文字」だけです。
 *   呼び名を何回変えても、抽選・残数・当選履歴・記録（Audit）は
 *   1件も壊れません。呼び名は、表示の直前にだけ足されます。
 *
 * ═══════════════════════════════════════════════════════
 * ★決めていないことは、決めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   お店が呼び名を入れていない場合は、これまでどおり
 *   「S賞」「A賞」…を出します。空欄のまま表示しません。
 *   空欄にすると、お客様の当選画面に「（空白）が当たりました」と出ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★「今の呼び名を出す場所」と「そのときの呼び名を残す場所」
 * ═══════════════════════════════════════════════════════
 *
 *   この2つを混ぜないこと。分け方は次のとおりです。
 *
 *   ■ 今の呼び名を、表示の直前に足す（＝あとから変わる）
 *       ・売り場の一覧／ガチャ詳細の賞の表（lib/server/shop.ts）
 *       ・当選画面（app/api/console/draw/route.ts）
 *       ・獲得商品の一覧（lib/server/prizes.ts）
 *
 *     理由：これらは「いま何を持っているか」「いま何が当たるか」を
 *     見せる画面です。お店が「S賞」を「特賞」に改めたのに、
 *     過去の当選だけ「S賞」と出続けると、お客様には別の賞に見えます。
 *
 *   ■ そのときの呼び名を、書いたまま残す（＝あとから変わらない）
 *       ・ポイント台帳の摘要（point_ledger.memo）
 *       ・監査ログの要約（audit_log.summary）
 *
 *     理由：こちらは記録です。「そのとき、お客様の画面に
 *     何と出ていたか」を残します。あとから書き換わる記録は、
 *     記録として使えません。
 *     ★記録には、呼び名だけでなく記号（S / A …）も一緒に残すこと。
 *       呼び名だけだと、変えたあとにどの等級か分からなくなります。
 *
 *   ■ どちらでもない（＝そもそも入れない）
 *       ・抽選結果そのもの（DrawResult）。
 *         これは idempotency に保存され、連打・再送のときに
 *         そのまま返されます。ここへ呼び名を混ぜると、
 *         お店が呼び名を変えた日から、保存された文字と
 *         いま画面に出る文字が食い違います。
 */

import { db, withWriteTx } from "./db";
import { appendAuditTx } from "./audit";
import type { Actor } from "./orders";

/** 中の記号。★ここは仕様であって、お店が変えられる場所ではありません */
export const GRADE_KEYS = ["S", "A", "B", "C", "D"] as const;
export type GradeKey = (typeof GRADE_KEYS)[number];

/** 賞に当たらず、ポイントだけをお返しした場合の記号 */
export const POINT_GRADE = "-";

/**
 * お店が何も決めていないときの呼び名。
 *
 * ★ここを「サンプル」「デモ」にしないこと。
 *   そのままお客様の当選画面に出ます。
 */
export function defaultGradeLabel(grade: string): string {
  if (grade === POINT_GRADE) return "参加ポイント";
  return `${grade}賞`;
}

export type GradeLabelMap = Record<string, string>;

/**
 * そのお店の呼び名を、まとめて読む。
 *
 * 返すのは「記号 → 見せる文字」の対応表です。
 * 決めていない記号は、既定の呼び名で埋めて返します。
 * ★呼ぶ側が「無かったらどうする」を毎回書かなくて済むようにするためです。
 * 　書かせると、必ずどこかで書き忘れて空欄が表示されます。
 */
export async function getGradeLabels(tenantId: string): Promise<GradeLabelMap> {
  const out: GradeLabelMap = {};
  for (const g of GRADE_KEYS) out[g] = defaultGradeLabel(g);
  out[POINT_GRADE] = defaultGradeLabel(POINT_GRADE);

  if (!tenantId) return out;

  const r = await db().execute({
    sql: `SELECT grade, label FROM tenant_grade_labels WHERE tenant_id = ?`,
    args: [tenantId],
  });
  for (const row of r.rows as unknown as Array<Record<string, unknown>>) {
    const g = String(row.grade ?? "").trim();
    const l = String(row.label ?? "").trim();
    /* ★空文字は採用しないこと。空欄で上書きすると表示が消えます */
    if (g !== "" && l !== "") out[g] = l;
  }
  return out;
}

/** 1つだけ引きたいとき */
export function gradeLabelOf(map: GradeLabelMap, grade: string): string {
  const l = map[grade];
  return l && l.trim() !== "" ? l : defaultGradeLabel(grade);
}

/** 呼び名の長さの上限。★画面の札からはみ出さない範囲にしています */
export const GRADE_LABEL_MAX = 20;

export class GradeLabelError extends Error {
  constructor(
    public code: "TOO_LONG" | "BAD_INPUT" | "DUPLICATE",
    message: string,
  ) {
    super(message);
    this.name = "GradeLabelError";
  }
}

/** 入れてもらった文字を、そのまま保存してよい形に整える */
function checkLabel(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new GradeLabelError("BAD_INPUT", "賞の呼び名は文字で入れてください。");
  }
  /* 改行・タブは1文字の空白にする。
     ★そのまま保存しないこと。札の中で行が折れて、他の表示を押しつぶします。 */
  const l = raw.replace(/[\r\n\t]+/g, " ").trim();
  if (l.length > GRADE_LABEL_MAX) {
    throw new GradeLabelError(
      "TOO_LONG",
      `賞の呼び名は ${GRADE_LABEL_MAX} 文字までにしてください（いま ${l.length} 文字）。`,
    );
  }
  return l;
}

/**
 * 呼び名を保存する。
 *
 * ★記号そのものは受け取りません。GRADE_KEYS にあるものだけを見ます。
 *   画面から知らない記号が来ても、新しい等級を作らせないためです。
 *   等級を増やす／減らすのは、在庫や還元率の作りに関わるので、
 *   「呼び名を変える」画面からできてはいけません。
 *
 * ★同じ呼び名を2つの等級に付けさせないこと。
 *   「特賞」が2つあると、お客様には同じ賞に見えます。
 *   当たった等級が違うのに同じ名前で出るのは、優良誤認になり得ます。
 *
 * ★変えたことは必ず記録（Audit）に残すこと。
 *   呼び名はお客様が見る文字です。「いつ・誰が・何を何に変えたか」が
 *   残っていないと、後で問い合わせが来たときに答えられません。
 */
export async function saveGradeLabels(args: {
  tenantId: string;
  labels: Record<string, unknown>;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<GradeLabelMap> {
  const at = args.now ?? new Date().toISOString();

  /* ── ① まず全部を検査する（1つでも駄目なら、1件も保存しない） ──
       ★途中まで保存してから弾かないこと。
         S賞だけ新しい名前・A賞は古い名前、という中途半端が残ります。 */
  const kettei: Array<{ grade: GradeKey; label: string }> = [];
  for (const g of GRADE_KEYS) {
    const raw = args.labels[g];
    if (raw === undefined) continue;
    kettei.push({ grade: g, label: checkLabel(raw) });
  }
  if (kettei.length === 0) return getGradeLabels(args.tenantId);

  /* ── ② 重なりを見る（保存されない等級は、既定の呼び名で比べる） ── */
  const mae = await getGradeLabels(args.tenantId);
  const ato: Record<string, string> = { ...mae };
  for (const k of kettei) {
    ato[k.grade] = k.label === "" ? defaultGradeLabel(k.grade) : k.label;
  }
  const mita = new Set<string>();
  for (const g of GRADE_KEYS) {
    const l = ato[g];
    if (mita.has(l)) {
      throw new GradeLabelError(
        "DUPLICATE",
        `「${l}」が2つの賞に付いています。お客様から見て同じ賞になってしまうため、別の呼び名にしてください。`,
      );
    }
    mita.add(l);
  }

  /* ── ③ 変わったものだけ、まとめて保存する ── */
  const kawatta = kettei.filter((k) => mae[k.grade] !== ato[k.grade]);
  if (kawatta.length === 0) return mae;

  await withWriteTx(async (tx) => {
    for (const k of kawatta) {
      if (k.label === "" || k.label === defaultGradeLabel(k.grade)) {
        /* 空にした／既定に戻したときは、行ごと消して既定に戻す。
           ★空文字を保存しないこと。空欄が表示されます */
        await tx.execute({
          sql: `DELETE FROM tenant_grade_labels WHERE tenant_id = ? AND grade = ?`,
          args: [args.tenantId, k.grade],
        });
        continue;
      }

      await tx.execute({
        sql: `INSERT INTO tenant_grade_labels (tenant_id, grade, label, updated_at, updated_by)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (tenant_id, grade)
              DO UPDATE SET label = excluded.label,
                            updated_at = excluded.updated_at,
                            updated_by = excluded.updated_by`,
        args: [args.tenantId, k.grade, k.label, at, args.actor.id],
      });
    }

    const naiyou = kawatta
      .map((k) => `${k.grade}：「${mae[k.grade]}」→「${ato[k.grade]}」`)
      .join("／");

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "GRADE_LABEL_UPDATE",
      target: "settings:grade-labels",
      summary: `賞の呼び名を変えました（${naiyou}）`,
      before: kawatta.map((k) => `${k.grade}=${mae[k.grade]}`).join(","),
      after: kawatta.map((k) => `${k.grade}=${ato[k.grade]}`).join(","),
      reason: "お店の設定変更",
      requestId: args.requestId,
      /* ★記号（grade）も一緒に残すこと。
           呼び名だけ残しても、あとから「どの等級のことか」が分かりません。 */
      data: {
        changed: kawatta.map((k) => ({
          grade: k.grade,
          before: mae[k.grade],
          after: ato[k.grade],
        })),
      },
    });
  });

  return getGradeLabels(args.tenantId);
}
