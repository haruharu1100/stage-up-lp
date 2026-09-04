/**
 * ガチャ管理の正本。一覧・詳細・検証・公開・停止・再開。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、ここ1か所にまとめるのか
 * ═══════════════════════════════════════════════════════
 *
 *   ガチャの数字は、いま3つの画面に出ます。
 *
 *       ガチャ管理の一覧
 *       実績還元率の画面
 *       ダッシュボードの警告
 *
 *   それぞれが自分で計算すると、必ずずれます。
 *   2026-08-26、画面に 88.0％ と出ていたのに、
 *   実際にお客様へ返っていたのは 18.23％ でした。
 *
 *   ★だからここは、還元率を自分で計算しません。
 *     lib/server/rtpMonitor.ts が出した数字を、そのまま並べるだけです。
 *     このファイルの中に割り算を書かないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★検証を通していないガチャを、公開させないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「危ないかもしれないが、とりあえず出す」を、
 *   人の注意力で止めてはいけません。忙しい日に必ず破られます。
 *
 *   守りは、画面のボタンを隠すことではありません。
 *   ここ（サーバー側）で断ることです。
 *   入口を直接たたかれても、同じ理由で断ります。
 *
 *       ① 検証していないガチャは公開できない
 *       ② 検証が DANGER のガチャは公開できない
 *       ③ 検証したあとに構成を変えたら、検証しなおし
 *       ④ 公開・停止・再開には理由が要る
 *       ⑤ 全部、監査ログに残る
 *       ⑥ 他社のガチャは、そもそも見つからない
 *
 * ═══════════════════════════════════════════════════════
 * ★「まだ検証していない」を「安全」と読ませないこと
 * ═══════════════════════════════════════════════════════
 *
 *   検証の結果は、SAFE / CAUTION / DANGER と、
 *   「まだ検証していない（null）」の4つです。
 *   null を SAFE に丸めた瞬間、この仕組みは意味を失います。
 *
 *   同じ理由で、材料が足りないまま出た判定も信じません。
 *   景品の値段が全部0円のときに「安全」と出るのは、
 *   構成が安全なのではなく、入力が終わっていないだけです。
 */

import {
  BACKTEST_ENGINE_VERSION,
  DEFAULT_SEED,
  backtestReport,
  designedRtp,
  validateSpec,
  type GachaSpec,
  type Verdict,
} from "@/lib/backtest";
import { can, type Role } from "@/lib/permissions";
import { appendAuditTx } from "./audit";
import { db, withWriteTx } from "./db";
import { id as newId } from "./ids";
import { rtpReport, type RtpReport } from "./rtpMonitor";
import type { Transaction } from "@libsql/client";

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
/** 空欄は空欄のまま返す。0 や「不明」という文字に化けさせない */
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** 理由として短すぎる文字数。担当者管理・仮パスワードと同じ基準にそろえる */
export const MIN_REASON = 4;

/* ══════════════════════════════════════════════
   返すもの
   ══════════════════════════════════════════════ */

/** 公開前検証の結果。まだのときは ran = false */
export type BacktestState =
  | { ran: false; reason: "NEVER" | "SPEC_CHANGED"; message: string }
  | {
      ran: true;
      /** 公開してよいか（構成そのものの判定） */
      verdict: Verdict;
      /** 相場や売れ行きが動いたときの判定。公開は止めないが、見張る線になる */
      stress: Verdict;
      at: string;
      engine: string;
      seed: number;
      /** いま登録されている構成と、検証したときの構成が同じか */
      current: boolean;
    };

export type GachaRow = {
  id: string;
  title: string;
  status: string;
  /** 1回の料金 */
  price: number;
  /** 総口数 */
  total: number;
  /** 残り口数 */
  leftCount: number;

  /**
   * 売上。
   * ★見せてよい人にだけ入ります。見せられない人には null。
   *   0 にしないこと。0 は「1円も売れていない」という意味です。
   */
  revenue: number | null;

  /** ★3種類。名前を分けたまま渡すこと。画面で混ぜないこと */
  designed: RtpReport["designed"];
  remaining: RtpReport["remaining"];
  actual: RtpReport["actual"];
  /** 何回ぶんの実績か。実績還元率と必ず一緒に出すこと */
  plays: number;

  /** いつ公開したか。★分からないときは null。created_at で埋めないこと */
  publishedAt: string | null;
  pausedAt: string | null;
  pauseReason: string | null;

  backtest: BacktestState;

  /** いちばん重い警告。OK と INFO も、そのまま渡す */
  worst: RtpReport["worst"];
  alerts: RtpReport["alerts"];

  /** 台帳（gachas の集計値）と抽選の記録が食い違っているか */
  ledgerMismatch: boolean;
};

export type GachaDetail = GachaRow & {
  createdAt: string | null;
  /** 等級ごとの在庫。箱の中に何本残っているか */
  stock: {
    grade: string;
    name: string;
    value: number;
    total: number;
    drawn: number;
    left: number;
  }[];
  /** 詳細画面のグラフ用 */
  series: RtpReport["series"];
  /** 台帳との食い違いの中身（人が読む用） */
  ledger: RtpReport["ledger"];
};

/* ══════════════════════════════════════════════
   失敗の種類
   ══════════════════════════════════════════════ */

export type GachaAdminCode =
  | "NOT_FOUND"
  | "NO_REASON"
  | "NO_SPEC"
  | "NOT_VERIFIED"
  | "SPEC_CHANGED"
  | "VERDICT_DANGER"
  | "UNUSABLE_SPEC"
  | "BAD_STATUS"
  /** 名前が空・同じ名前がすでにある・数字が入っていない */
  | "NO_TITLE"
  | "DUP_TITLE"
  | "BAD_SPEC";

export class GachaAdminError extends Error {
  constructor(
    readonly code: GachaAdminCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "GachaAdminError";
  }
}

function checkReason(reason: string): string {
  const r = String(reason ?? "").trim();
  if (r.length < MIN_REASON) {
    throw new GachaAdminError(
      "NO_REASON",
      `理由を、${MIN_REASON}文字以上でご記入ください。あとから記録を読む人が、いちばん知りたいのは理由です。`,
    );
  }
  return r;
}

/* ══════════════════════════════════════════════
   構成（賞の中身）を、在庫表から組み立てる
   ══════════════════════════════════════════════ */

/**
 * gacha_stock から、検証にかける構成を作る。
 *
 * ★drawn（もう出た本数）ではなく total（最初の本数）を使うこと。
 *   検証は「このガチャを最初から最後まで売り切ったら、どうなるか」を見ます。
 *   途中の残数で回すと、毎回ちがう答えが出て、
 *   同じ構成なのに「昨日は安全、今日は危険」になります。
 */
/** 取引の中からも、外からも呼べるように。読むだけなのでどちらでも同じ答えになる */
type Yomeru = Pick<Transaction, "execute">;

async function specOf(
  tenantId: string,
  gachaId: string,
  where: Yomeru = db() as unknown as Yomeru,
): Promise<GachaSpec | null> {
  const g = await where.execute({
    sql: `SELECT title, price, total FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  const row = g.rows[0] as Row | undefined;
  if (!row) return null;

  const s = await where.execute({
    sql: `SELECT grade, name, value, total FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ?
           ORDER BY grade ASC`,
    args: [tenantId, gachaId],
  });

  return {
    name: str(row.title),
    price: num(row.price),
    total: num(row.total),
    prizes: (s.rows as Row[]).map((x) => ({
      grade: str(x.grade),
      name: str(x.name),
      count: num(x.total),
      value: num(x.value),
    })),
  };
}

/**
 * 構成が同じかどうかを、1本の文字にして比べる。
 *
 * ★JSON.stringify をそのまま比べないこと。
 *   キーの並び順が変わっただけで「変わった」と言い出します。
 *   毎回「検証しなおしてください」と出て、そのうち誰も読まなくなります。
 */
export function specFingerprint(spec: GachaSpec): string {
  const prizes = spec.prizes
    .map((p) => `${p.grade}:${p.count}:${p.value}`)
    .sort()
    .join("|");
  return `${spec.price}/${spec.total}/${prizes}`;
}

/** DBに残した検証結果を、画面に出せる形にする */
function backtestStateOf(row: Row, spec: GachaSpec | null): BacktestState {
  const verdict = strOrNull(row.backtest_verdict);
  const at = strOrNull(row.backtest_at);

  if (!verdict || !at) {
    return {
      ran: false,
      reason: "NEVER",
      message:
        "まだ公開前の検証をしていません。検証していないガチャは公開できません。",
    };
  }

  const savedSpec = strOrNull(row.backtest_spec);
  const current =
    spec !== null && savedSpec !== null && savedSpec === specFingerprint(spec);

  if (!current) {
    /* ★古い判定を、そのまま「SAFE」として見せないこと。
         賞の本数や値段を変えたあとの SAFE は、
         いまのガチャについて何も言っていません。 */
    return {
      ran: false,
      reason: "SPEC_CHANGED",
      message:
        "検証したあとに、賞の構成が変わっています。前の判定は、いまの構成については何も示しません。検証しなおしてください。",
    };
  }

  return {
    ran: true,
    verdict: verdict as Verdict,
    stress: (strOrNull(row.backtest_stress) ?? "DANGER") as Verdict,
    at,
    engine: strOrNull(row.backtest_engine) ?? "不明",
    seed: num(row.backtest_seed),
    current: true,
  };
}

/* ══════════════════════════════════════════════
   一覧
   ══════════════════════════════════════════════ */

export type GachaListFilter = {
  /** ガチャ名の一部。空なら絞らない */
  q?: string;
  /** 状態。空なら絞らない */
  status?: string;
  /** 危ないものだけ（WARN か DANGER） */
  onlyAlert?: boolean;
};

/**
 * ガチャ一覧。
 *
 * @param role 見ている人の役割。売上を見せてよいかの判断に使う。
 *   ★null は「役割が読み取れなかった」です。そのときは売上を出しません。
 */
export async function gachaList(
  tenantId: string,
  role: Role | null,
  filter: GachaListFilter = {},
): Promise<{ rows: GachaRow[]; total: number; canSeeRevenue: boolean }> {
  const canSeeRevenue = role !== null && can(role, "revenue.view");

  /* ★絞り込みはSQLで行うこと。
       全部読んでから画面で絞ると、件数が増えた日に、
       上限で切られた中だけを絞ることになり、静かに取りこぼします。 */
  const where: string[] = ["tenant_id = ?"];
  const args: string[] = [tenantId];

  const q = String(filter.q ?? "").trim();
  if (q) {
    where.push("LOWER(title) LIKE ?");
    args.push(`%${q.toLowerCase()}%`);
  }
  const status = String(filter.status ?? "").trim().toUpperCase();
  if (status) {
    where.push("status = ?");
    args.push(status);
  }

  const r = await db().execute({
    sql: `SELECT id, title, status, price, total, left_count, revenue, created_at,
                 published_at, paused_at, pause_reason,
                 backtest_verdict, backtest_stress, backtest_at,
                 backtest_engine, backtest_seed, backtest_spec
            FROM gachas
           WHERE ${where.join(" AND ")}
           ORDER BY created_at DESC`,
    args,
  });

  const rows: GachaRow[] = [];
  for (const row of r.rows as Row[]) {
    const built = await buildRow(tenantId, row, canSeeRevenue);
    if (filter.onlyAlert && built.worst.level !== "WARN" && built.worst.level !== "DANGER") {
      continue;
    }
    rows.push(built);
  }

  return { rows, total: rows.length, canSeeRevenue };
}

async function buildRow(
  tenantId: string,
  row: Row,
  canSeeRevenue: boolean,
): Promise<GachaRow> {
  const gachaId = str(row.id);

  /* ★還元率をここで計算しないこと。rtpMonitor が出した数字をそのまま使う */
  const rep = await rtpReport({ tenantId, gachaId });
  const spec = await specOf(tenantId, gachaId);

  return {
    id: gachaId,
    title: str(row.title),
    status: str(row.status),
    price: num(row.price),
    total: num(row.total),
    leftCount: num(row.left_count),

    /* ★見せられないときは null。0 にしないこと */
    revenue: canSeeRevenue ? num(row.revenue) : null,

    designed: rep!.designed,
    remaining: rep!.remaining,
    actual: rep!.actual,
    plays: rep!.plays,

    publishedAt: strOrNull(row.published_at),
    pausedAt: strOrNull(row.paused_at),
    pauseReason: strOrNull(row.pause_reason),

    backtest: backtestStateOf(row, spec),

    worst: rep!.worst,
    alerts: rep!.alerts,
    ledgerMismatch: rep!.ledger.mismatch,
  };
}

/* ══════════════════════════════════════════════
   詳細
   ══════════════════════════════════════════════ */

export async function gachaDetail(
  tenantId: string,
  gachaId: string,
  role: Role | null,
): Promise<GachaDetail | null> {
  const canSeeRevenue = role !== null && can(role, "revenue.view");

  const g = await db().execute({
    sql: `SELECT id, title, status, price, total, left_count, revenue, created_at,
                 published_at, paused_at, pause_reason,
                 backtest_verdict, backtest_stress, backtest_at,
                 backtest_engine, backtest_seed, backtest_spec
            FROM gachas
           WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  const row = g.rows[0] as Row | undefined;
  /* ★「他社のガチャです」と教えないこと。
       有る無しを答えるだけで、他社の中身が推測できます。 */
  if (!row) return null;

  const base = await buildRow(tenantId, row, canSeeRevenue);
  const rep = await rtpReport({ tenantId, gachaId, withSeries: true });

  const s = await db().execute({
    sql: `SELECT grade, name, value, total, drawn FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ?
           ORDER BY grade ASC`,
    args: [tenantId, gachaId],
  });

  return {
    ...base,
    createdAt: strOrNull(row.created_at),
    stock: (s.rows as Row[]).map((x) => ({
      grade: str(x.grade),
      name: str(x.name),
      value: num(x.value),
      total: num(x.total),
      drawn: num(x.drawn),
      left: num(x.total) - num(x.drawn),
    })),
    series: rep!.series,
    ledger: rep!.ledger,
  };
}

/* ══════════════════════════════════════════════
   新しく作る（下書きとして登録する）
   ══════════════════════════════════════════════ */

/**
 * ガチャを1本、下書きとして登録する。
 *
 * ═══════════════════════════════════════════════════════
 * ★2026-09-04 まで、この関数がありませんでした
 * ═══════════════════════════════════════════════════════
 *
 *   AIガチャ作成の画面には「この案を下書きとして登録する」ボタンがあり、
 *   押すと「下書きに登録しました」と緑色で出ていました。
 *   ところが、送り先がどこにもありませんでした。
 *   ブラウザの中の配列に足していただけなので、
 *   画面を開き直した瞬間に消えていました。
 *
 *   ★「押したら保存された、と書く」のは、保存してから書くこと。
 *     保存していないのに書くと、
 *     作った本人が「登録済み」と思ったまま次の作業へ進みます。
 *
 * ═══════════════════════════════════════════════════════
 * ★検証結果を、ここで埋めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   作った直後は backtest_verdict を NULL のままにします。
 *   ここで「作るついでに検証も通しておく」をやると、
 *   公開前の関門が、作成と同時に自動で開くことになります。
 *
 *   作る人と、検証して公開する人は、別の作業として分けます。
 *   ガチャ管理で「検証を実行」を押して、
 *   その結果が保存されてはじめて、公開ボタンが通ります。
 *
 * ★状態は必ず DRAFT で作ること。
 *   「作ったらすぐ売る」を既定にすると、
 *   入力途中のガチャがお客様の画面に出ます。
 */
export async function createGachaDraft(args: {
  tenantId: string;
  title: string;
  spec: GachaSpec;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{ gachaId: string; title: string; designedRtp: number; at: string }> {
  const title = String(args.title ?? "").trim();
  if (title.length === 0) {
    throw new GachaAdminError(
      "NO_TITLE",
      "ガチャの名前を入れてください。お客様の画面に出る名前です。",
    );
  }
  if (title.length > 60) {
    throw new GachaAdminError(
      "NO_TITLE",
      "ガチャの名前が長すぎます。60文字までにしてください。",
    );
  }

  const spec: GachaSpec = {
    name: title,
    price: Math.floor(Number(args.spec?.price ?? 0)),
    total: Math.floor(Number(args.spec?.total ?? 0)),
    prizes: Array.isArray(args.spec?.prizes)
      ? args.spec.prizes.map((p) => ({
          grade: String(p?.grade ?? "").trim(),
          name: String(p?.name ?? "").trim(),
          count: Math.floor(Number(p?.count ?? 0)),
          value: Math.floor(Number(p?.value ?? 0)),
        }))
      : [],
  };

  /* ★入力の点検を、画面と同じ道具で行うこと。
       画面（AIガチャ作成）と別の基準をここに書くと、
       画面では通ったのにサーバーで断られる、が起きます。 */
  const issues = validateSpec(spec);
  if (issues.length > 0) {
    throw new GachaAdminError(
      "BAD_SPEC",
      issues[0].message,
      issues.map((i) => i.code).join(","),
    );
  }
  /* 等級の重複は validateSpec では見ていません。
     在庫表の鍵が（会社・ガチャ・等級）なので、同じ等級が2行あると入りません */
  const grades = spec.prizes.map((p) => p.grade);
  if (grades.some((g) => g.length === 0) || new Set(grades).size !== grades.length) {
    throw new GachaAdminError(
      "BAD_SPEC",
      "賞の記号（S・A・Bなど）が空か、同じものが2つあります。1つずつ別の記号にしてください。",
    );
  }

  const at = new Date().toISOString();
  const gachaId = newId("gac");
  const rtp = designedRtp(spec);

  return withWriteTx(async (tx) => {
    /* ★同じ名前を2本作らせないこと。
         一覧でどちらが本物か分からなくなり、
         止めるつもりで別のガチャを止めます。
         大文字小文字と前後の空白は、同じ名前とみなします。 */
    const dup = await tx.execute({
      sql: `SELECT id FROM gachas
             WHERE tenant_id = ? AND LOWER(TRIM(title)) = ?`,
      args: [args.tenantId, title.toLowerCase()],
    });
    if (dup.rows.length > 0) {
      throw new GachaAdminError(
        "DUP_TITLE",
        "同じ名前のガチャがすでにあります。別の名前にしてください。",
      );
    }

    await tx.execute({
      sql: `INSERT INTO gachas
              (id, tenant_id, title, price, total, left_count, designed_rtp, status,
               revenue, paid_value, created_at,
               published_at, paused_at, pause_reason,
               backtest_verdict, backtest_stress, backtest_at,
               backtest_engine, backtest_seed, backtest_spec)
            VALUES (?,?,?,?,?,?,?, 'DRAFT', 0, 0, ?,
                    NULL, NULL, NULL,
                    NULL, NULL, NULL,
                    NULL, NULL, NULL)`,
      args: [
        gachaId,
        args.tenantId,
        title,
        spec.price,
        spec.total,
        /* 残り口数は、作った時点では総口数と同じ */
        spec.total,
        rtp,
        at,
      ],
    });

    /* ★在庫の行を、必ず一緒に作ること。
         行が無いと「まだ1本も出ていない」と読めてしまい、
         本数の上限が効かなくなります。 */
    for (const p of spec.prizes) {
      await tx.execute({
        sql: `INSERT INTO gacha_stock
                (tenant_id, gacha_id, grade, name, value, total, drawn, reserved)
              VALUES (?,?,?,?,?,?,0,0)`,
        args: [args.tenantId, gachaId, p.grade, p.name || `${p.grade}賞`, p.value, p.count],
      });
    }

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "GACHA_CREATE",
      target: `gacha:${gachaId}`,
      summary: `${title} を下書きとして登録（設計還元率 ${rtp.toFixed(1)}％・未検証）`,
      after: "DRAFT",
      data: {
        gachaId,
        title,
        price: spec.price,
        total: spec.total,
        designedRtp: rtp,
        prizes: spec.prizes.map((p) => ({
          grade: p.grade,
          name: p.name,
          count: p.count,
          value: p.value,
        })),
        /* ★「検証はまだ」を記録にも残す。
             あとから読む人が、公開までの順番を追えるようにするため */
        verified: false,
      },
      requestId: args.requestId,
    });

    return { gachaId, title, designedRtp: rtp, at };
  });
}

/* ══════════════════════════════════════════════
   公開前検証
   ══════════════════════════════════════════════ */

export type VerifyResult = {
  gachaId: string;
  title: string;
  verdict: Verdict;
  stress: Verdict;
  designedRtp: number;
  /** 相場が何％上がったら赤字に変わるか。100％以上の設計なら null */
  stopLineUpPct: number | null;
  maxLossRate: number;
  engine: string;
  seed: number;
  at: string;
  /** 入力が足りていない箇所。1件でもあれば、この判定は使えません */
  issues: { code: string; message: string }[];
  usable: boolean;
};

/**
 * 公開前検証を回して、結果をDBに残す。
 *
 * ★結果を必ず保存すること。
 *   保存しないと「検証を通したから公開した」を、あとから示せません。
 *   示せない検証は、やっていないのと同じ扱いになります。
 */
export async function verifyGacha(args: {
  tenantId: string;
  gachaId: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<VerifyResult> {
  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    const g = await tx.execute({
      sql: `SELECT id, title FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const row = g.rows[0] as Row | undefined;
    if (!row) {
      throw new GachaAdminError("NOT_FOUND", "そのガチャは見つかりませんでした。");
    }

    const spec = await specOf(args.tenantId, args.gachaId, tx);
    if (!spec || spec.prizes.length === 0) {
      /* ★「景品が1本も無い」を、通してはいけません。
           売上がそのまま粗利になるので、計算上は必ず「安全」に見えます。
           安全なのではなく、入力が終わっていないだけです。 */
      throw new GachaAdminError(
        "NO_SPEC",
        "賞の構成が登録されていません。景品を登録してから検証してください。景品が1本も無いと、計算上はどんな構成でも「安全」に見えてしまいます。",
      );
    }

    const rep = backtestReport(spec, DEFAULT_SEED, at);

    await tx.execute({
      sql: `UPDATE gachas
               SET backtest_verdict = ?, backtest_stress = ?, backtest_at = ?,
                   backtest_engine = ?, backtest_seed = ?, backtest_spec = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [
        rep.overall,
        rep.stress,
        at,
        BACKTEST_ENGINE_VERSION,
        DEFAULT_SEED,
        specFingerprint(spec),
        args.tenantId,
        args.gachaId,
      ],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      /* ★新しい名前を作らないこと。検証の記録は、もともと BACKTEST_RUN です。
           同じ出来事に2つの名前が付くと、監査ログを検索した人が
           片方しか見つけられません。 */
      action: "BACKTEST_RUN",
      target: `gacha:${args.gachaId}`,
      summary: `${str(row.title)} の公開前検証：${rep.overall}（設計還元率 ${rep.designedRtp.toFixed(1)}％）`,
      after: rep.overall,
      data: {
        gachaId: args.gachaId,
        title: str(row.title),
        verdict: rep.overall,
        stress: rep.stress,
        designedRtp: rep.designedRtp,
        stopLineUpPct: rep.stopLineUpPct,
        maxLossRate: rep.maxLossRate,
        engine: BACKTEST_ENGINE_VERSION,
        seed: DEFAULT_SEED,
        usable: rep.usable,
        issues: rep.issues.map((i) => i.code),
      },
      requestId: args.requestId,
    });

    return {
      gachaId: args.gachaId,
      title: str(row.title),
      verdict: rep.overall,
      stress: rep.stress,
      designedRtp: rep.designedRtp,
      stopLineUpPct: rep.stopLineUpPct,
      maxLossRate: rep.maxLossRate,
      engine: BACKTEST_ENGINE_VERSION,
      seed: DEFAULT_SEED,
      at,
      issues: rep.issues.map((i) => ({ code: i.code, message: i.message })),
      usable: rep.usable,
    };
  });
}

/* ══════════════════════════════════════════════
   公開・停止・再開
   ══════════════════════════════════════════════ */

/** 公開してよい状態か。ここが、この画面でいちばん大事な守りです */
async function ensurePublishable(
  tx: Transaction,
  tenantId: string,
  gachaId: string,
  row: Row,
): Promise<Verdict> {
  const spec = await specOf(tenantId, gachaId, tx);
  const state = backtestStateOf(row, spec);

  if (!state.ran) {
    throw new GachaAdminError(
      state.reason === "NEVER" ? "NOT_VERIFIED" : "SPEC_CHANGED",
      state.message,
    );
  }

  if (state.verdict === "DANGER") {
    /* ★ここを「警告を出して、それでも押せる」にしないこと。
         押せるボタンは、忙しい日に必ず押されます。
         止めるなら、押せないようにします。 */
    throw new GachaAdminError(
      "VERDICT_DANGER",
      "検証の結果が「危険」でした。この構成のままでは公開できません。賞の本数か値段を見直して、もう一度検証してください。",
    );
  }

  return state.verdict;
}

export async function publishGacha(args: {
  tenantId: string;
  gachaId: string;
  reason: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{ title: string; before: string; after: string; verdict: Verdict; at: string }> {
  const reason = checkReason(args.reason);
  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    const g = await tx.execute({
      sql: `SELECT id, title, status, published_at,
                   backtest_verdict, backtest_stress, backtest_at,
                   backtest_engine, backtest_seed, backtest_spec
              FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const row = g.rows[0] as Row | undefined;
    if (!row) {
      throw new GachaAdminError("NOT_FOUND", "そのガチャは見つかりませんでした。");
    }

    const before = str(row.status);
    if (before === "PUBLISHED") {
      throw new GachaAdminError("BAD_STATUS", "すでに販売中です。");
    }
    if (before === "SOLD_OUT") {
      throw new GachaAdminError(
        "BAD_STATUS",
        "完売したガチャは、公開しなおせません。景品を入れ直して、新しく作ってください。",
      );
    }

    const verdict = await ensurePublishable(tx, args.tenantId, args.gachaId, row);

    /**
     * ★公開日時は、はじめて公開したときだけ書くこと。
     *
     *   一度止めて、また再開したときに上書きすると、
     *   「いつから売っていたか」が消えます。
     *   返金や問い合わせで、いちばん最初に聞かれるのがそこです。
     */
    const hajimete = strOrNull(row.published_at) === null;

    await tx.execute({
      sql: `UPDATE gachas
               SET status = 'PUBLISHED',
                   published_at = COALESCE(published_at, ?),
                   paused_at = NULL,
                   pause_reason = NULL
             WHERE tenant_id = ? AND id = ?`,
      args: [at, args.tenantId, args.gachaId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "GACHA_PUBLISH",
      target: `gacha:${args.gachaId}`,
      summary: `${str(row.title)} を公開（検証：${verdict}）`,
      before,
      after: "PUBLISHED",
      reason,
      data: {
        gachaId: args.gachaId,
        title: str(row.title),
        verdict,
        firstPublish: hajimete,
        publishedAt: hajimete ? at : strOrNull(row.published_at),
      },
      requestId: args.requestId,
    });

    return { title: str(row.title), before, after: "PUBLISHED", verdict, at };
  });
}

/**
 * 販売を止める。
 *
 * ★止めるのに検証は要りません。止めるのは、いつでも通します。
 *   危ないと思ったときに、すぐ止められることの方が大事です。
 *   「止めるのにも手続きが要る」は、事故を大きくします。
 */
export async function pauseGacha(args: {
  tenantId: string;
  gachaId: string;
  reason: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{ title: string; before: string; at: string }> {
  const reason = checkReason(args.reason);
  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    const g = await tx.execute({
      sql: `SELECT id, title, status FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const row = g.rows[0] as Row | undefined;
    if (!row) {
      throw new GachaAdminError("NOT_FOUND", "そのガチャは見つかりませんでした。");
    }

    const before = str(row.status);
    if (before !== "PUBLISHED") {
      throw new GachaAdminError(
        "BAD_STATUS",
        "販売中のガチャだけを止められます。いまは販売していません。",
      );
    }

    await tx.execute({
      sql: `UPDATE gachas
               SET status = 'PAUSED', paused_at = ?, pause_reason = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [at, reason, args.tenantId, args.gachaId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "GACHA_PAUSE",
      target: `gacha:${args.gachaId}`,
      summary: `${str(row.title)} の販売を停止`,
      before,
      after: "PAUSED",
      reason,
      data: { gachaId: args.gachaId, title: str(row.title) },
      requestId: args.requestId,
    });

    return { title: str(row.title), before, at };
  });
}

/**
 * 止めていた販売を、また始める。
 *
 * ★再開にも、公開と同じ検証を通すこと。
 *   止めた理由が「還元率が危ない」だったとき、
 *   何も直さずに再開できてしまうと、止めた意味がありません。
 */
export async function resumeGacha(args: {
  tenantId: string;
  gachaId: string;
  reason: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{ title: string; verdict: Verdict; at: string }> {
  const reason = checkReason(args.reason);
  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    const g = await tx.execute({
      sql: `SELECT id, title, status, pause_reason,
                   backtest_verdict, backtest_stress, backtest_at,
                   backtest_engine, backtest_seed, backtest_spec
              FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const row = g.rows[0] as Row | undefined;
    if (!row) {
      throw new GachaAdminError("NOT_FOUND", "そのガチャは見つかりませんでした。");
    }

    const before = str(row.status);
    if (before !== "PAUSED") {
      throw new GachaAdminError(
        "BAD_STATUS",
        "止まっているガチャだけを再開できます。",
      );
    }

    const verdict = await ensurePublishable(tx, args.tenantId, args.gachaId, row);

    await tx.execute({
      sql: `UPDATE gachas
               SET status = 'PUBLISHED', paused_at = NULL, pause_reason = NULL
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "GACHA_RESUME",
      target: `gacha:${args.gachaId}`,
      summary: `${str(row.title)} の販売を再開（検証：${verdict}）`,
      before: "PAUSED",
      after: "PUBLISHED",
      reason,
      data: {
        gachaId: args.gachaId,
        title: str(row.title),
        verdict,
        /* 何の理由で止まっていたのかも一緒に残す。
           「止めた理由」と「再開した理由」が並んで初めて、判断を追えます */
        pausedBecause: strOrNull(row.pause_reason),
      },
      requestId: args.requestId,
    });

    return { title: str(row.title), verdict, at };
  });
}
