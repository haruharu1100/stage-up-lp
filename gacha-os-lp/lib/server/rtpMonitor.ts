/**
 * 還元率モニター（サーバー側の集計）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜサーバー側で計算するのか
 * ═══════════════════════════════════════════════════════
 *
 *   画面（ブラウザ）で計算すると、画面ごとに計算式がずれます。
 *   ガチャ一覧では 88％、ガチャ詳細では 91％、といったことが必ず起きます。
 *   どちらが正しいのか、誰にも分からなくなります。
 *
 *   だから計算はここ1か所だけで行い、画面は受け取った数字を
 *   そのまま出すだけにします。画面では割り算をしません。
 *
 * ═══════════════════════════════════════════════════════
 * ★どの記録を正本にするのか
 * ═══════════════════════════════════════════════════════
 *
 *   実績還元率の正本は draws（抽選の記録）です。
 *   1回引くごとに必ず1行、消せない形で残っています。
 *
 *   gachas.revenue / gachas.paid_value にも合計が入っていますが、
 *   これは「足しながら書いている数字」なので、途中で足し忘れると
 *   静かにずれます。実際、2026-08-26 まで、はずれのときの
 *   参加ポイントが paid_value に足されていませんでした。
 *
 *   ★だから、集計値の方を信じないこと。
 *     draws から出した数字を正本にし、集計値とは「突き合わせるだけ」にします。
 *     食い違ったら、どちらが正しいかを勝手に決めず、
 *     「食い違っている」という事実を危険として知らせます。
 *
 * ═══════════════════════════════════════════════════════
 * ★分子の数え方（二重に数えない）
 * ═══════════════════════════════════════════════════════
 *
 *   1回の抽選で、お客様が受け取るのは
 *
 *       S・A・B賞 → 現物（prize_value）。ポイントは0
 *       C・D賞     → ポイント（point_returned）。金額は prize_value と同じ
 *       はずれ     → 参加ポイント（point_returned）。prize_value は0
 *
 *   のどちらか一方だけです。
 *   そこで SQL の側で「等級ごとに片方だけ」を選んで合計します。
 *   両方を単純に足すと、C・D賞を2回数えてしまいます。
 */

import {
  actualRtp,
  designedRtp,
  judgeRtp,
  remainingRtp,
  worstAlert,
  type ActualFacts,
  type Rtp,
  type RtpAlert,
  type StockRow,
} from "../console/rtp";
import { db } from "./db";

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");

/**
 * 現物としてお渡しする等級。
 *
 * ★lib/console/draw.ts の SHIPPED と必ず同じにすること。
 *   ここがずれると、還元率の分子が変わります。
 *   SQL の中に等級名を直接書いているので、片方だけ直すと気づけません。
 */
const SHIPPED_GRADES = ["S", "A", "B"] as const;
const SHIPPED_SQL = SHIPPED_GRADES.map((g) => `'${g}'`).join(",");

/* ══════════════════════════════════════════════
   返す形
   ══════════════════════════════════════════════ */

/** 時系列グラフ1点ぶん */
export type RtpPoint = {
  /** 何回目までの時点か（横軸） */
  plays: number;
  /** その時点までの実績（％）。出せないときは null */
  actual: number | null;
  /** その時点の残数（％）。出せないときは null */
  remaining: number | null;
  /** 設計（％）。ずっと同じ値。比較線として引く */
  designed: number | null;
  /** その時点までの売上（pt） */
  sold: number;
  /** その時点までにお返しした価値（pt） */
  returned: number;
};

export type RtpReport = {
  gachaId: string;
  title: string;
  status: string;
  price: number;
  total: number;
  leftCount: number;

  /** ★3種類。名前を分けたまま渡すこと。画面で混ぜないこと */
  designed: Rtp;
  remaining: Rtp;
  actual: Rtp;

  /** 何回ぶんの実績か（サンプル数）。必ず画面に出すこと */
  plays: number;

  alerts: RtpAlert[];
  worst: RtpAlert;

  /** 台帳（gachas の集計値）との突き合わせ */
  ledger: {
    /** gachas.revenue */
    revenue: number;
    /** gachas.paid_value */
    paidValue: number;
    /** draws から出した売上 */
    revenueFromDraws: number;
    /** draws から出したお返し */
    paidFromDraws: number;
    mismatch: boolean;
    /** 食い違っている理由（人が読む用） */
    note: string | null;
  };

  /** 詳細画面のグラフ用。一覧では空配列で構わない */
  series: RtpPoint[];
};

/* ══════════════════════════════════════════════
   実績の材料を draws から取る
   ══════════════════════════════════════════════ */

/**
 * ★分子を SQL の側で確定させること。
 *   取ってきてから TypeScript 側で「この等級なら…」と振り分けると、
 *   振り分けの条件が2か所（ここと画面）に散らばります。
 */
const FACTS_SQL = `
  SELECT COUNT(*)                                                            AS plays,
         COALESCE(SUM(price), 0)                                             AS sold,
         COALESCE(SUM(CASE WHEN prize_rank IN (${SHIPPED_SQL})
                           THEN prize_value ELSE 0 END), 0)                  AS prizeValue,
         COALESCE(SUM(CASE WHEN prize_rank IN (${SHIPPED_SQL})
                           THEN 0 ELSE point_returned END), 0)               AS pointValue
    FROM draws
   WHERE tenant_id = ? AND gacha_id = ?`;

async function factsOf(
  tenantId: string,
  gachaId: string,
): Promise<ActualFacts> {
  const r = await db().execute({ sql: FACTS_SQL, args: [tenantId, gachaId] });
  const row = (r.rows[0] ?? {}) as Row;
  return {
    plays: num(row.plays),
    sold: num(row.sold),
    prizeValue: num(row.prizeValue),
    pointValue: num(row.pointValue),
  };
}

async function stockOf(
  tenantId: string,
  gachaId: string,
): Promise<StockRow[]> {
  const r = await db().execute({
    sql: `SELECT grade, value, total, drawn FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ?`,
    args: [tenantId, gachaId],
  });
  return (r.rows as Row[]).map((x) => ({
    grade: str(x.grade),
    value: num(x.value),
    total: num(x.total),
    drawn: num(x.drawn),
  }));
}

/* ══════════════════════════════════════════════
   時系列（詳細画面のグラフ）
   ══════════════════════════════════════════════ */

/**
 * 抽選の記録を古い順に足しながら、その時点その時点の還元率を作る。
 *
 * ★1回ごとの値ではなく「そこまでの累計」を出すこと。
 *   1回ごとだと 0％ と 3000％ が交互に並ぶだけで、何も読み取れません。
 *   累計にすると、設計値へ寄っていくか、離れていくかが見えます。
 *
 * ★点が多すぎると読めないので、最大 MAX_POINTS 個に間引きます。
 *   ただし「最後の1点」は必ず入れます。いまの値が抜けては意味がありません。
 */
const MAX_POINTS = 60;

async function seriesOf(args: {
  tenantId: string;
  gachaId: string;
  price: number;
  designedPercent: number | null;
  stock: StockRow[];
}): Promise<RtpPoint[]> {
  const { tenantId, gachaId, price, designedPercent, stock } = args;

  const r = await db().execute({
    sql: `SELECT play_count, price, prize_rank, prize_value, point_returned,
                 remaining_after
            FROM draws
           WHERE tenant_id = ? AND gacha_id = ?
           ORDER BY play_count ASC`,
    args: [tenantId, gachaId],
  });
  const rows = r.rows as Row[];
  if (rows.length === 0) return [];

  /* 箱に最初から入っていた景品の価値の合計。
     これが分かると「その時点で箱に残っていた価値」を逆算できます。 */
  let hakoTotal = 0;
  let hakoOk = stock.length > 0;
  for (const s of stock) {
    if (!Number.isFinite(s.value) || !Number.isFinite(s.total)) hakoOk = false;
    hakoTotal += s.total * s.value;
  }

  const kanTotal = rows.length;
  const step = Math.max(1, Math.ceil(kanTotal / MAX_POINTS));

  const out: RtpPoint[] = [];
  let sold = 0;
  let returned = 0;
  /* 箱から出ていった「景品としての価値」。残数の逆算に使う。
     ポイント返しは箱の中身が減るわけではないので、ここには入れない。 */
  let deta = 0;

  for (let i = 0; i < kanTotal; i++) {
    const row = rows[i];
    const rank = str(row.prize_rank);
    const genbutsu = (SHIPPED_GRADES as readonly string[]).includes(rank);

    sold += num(row.price);
    returned += genbutsu ? num(row.prize_value) : num(row.point_returned);
    deta += num(row.prize_value);

    const saigo = i === kanTotal - 1;
    if (!saigo && (i + 1) % step !== 0) continue;

    const nokoriKuchi = num(row.remaining_after);
    const nokoriKachi = hakoTotal - deta;
    const nokoriBunbo = price * nokoriKuchi;

    out.push({
      plays: num(row.play_count) || i + 1,
      actual: sold > 0 ? Math.round((returned / sold) * 10000) / 100 : null,
      remaining:
        hakoOk && nokoriBunbo > 0 && nokoriKachi >= 0
          ? Math.round((nokoriKachi / nokoriBunbo) * 10000) / 100
          : null,
      designed: designedPercent,
      sold,
      returned,
    });
  }

  return out;
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export async function rtpReport(args: {
  tenantId: string;
  gachaId: string;
  /** 詳細画面のときだけ true。一覧で毎回作ると重くなります */
  withSeries?: boolean;
  /** 急落・急騰を見るための、前回の実績（％） */
  previousActualPercent?: number | null;
}): Promise<RtpReport | null> {
  const { tenantId, gachaId } = args;

  const g = await db().execute({
    sql: `SELECT id, title, status, price, total, left_count, designed_rtp,
                 revenue, paid_value
            FROM gachas
           WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  const row = g.rows[0] as Row | undefined;
  if (!row) return null;

  const price = num(row.price);
  const total = num(row.total);
  const leftCount = num(row.left_count);

  const stock = await stockOf(tenantId, gachaId);
  const facts = await factsOf(tenantId, gachaId);

  const designed = designedRtp(num(row.designed_rtp), total, price);
  const remaining = remainingRtp({ price, leftCount, stock });
  const actual = actualRtp(facts);

  /* ── 台帳との突き合わせ ─────────────────────────
     ★ずれていたら、どちらかを採用して隠さないこと。
       「ずれている」という事実が、いちばん大事な情報です。 */
  const revenue = num(row.revenue);
  const paidValue = num(row.paid_value);
  const revenueFromDraws = facts.sold;
  const paidFromDraws = facts.prizeValue + facts.pointValue;

  const zure: string[] = [];
  if (revenue !== revenueFromDraws) {
    zure.push(
      `売上：集計値 ${revenue.toLocaleString()}pt に対して、抽選の記録は ${revenueFromDraws.toLocaleString()}pt です。`,
    );
  }
  if (paidValue !== paidFromDraws) {
    zure.push(
      `お返し：集計値 ${paidValue.toLocaleString()}pt に対して、抽選の記録は ${paidFromDraws.toLocaleString()}pt です。`,
    );
  }

  const alerts = judgeRtp({
    designed,
    remaining,
    actual,
    previousActualPercent: args.previousActualPercent ?? null,
    ledgerMismatch: zure.length > 0,
  });

  const designedPercent = designed.known ? designed.percent : null;

  return {
    gachaId: str(row.id),
    title: str(row.title),
    status: str(row.status),
    price,
    total,
    leftCount,
    designed,
    remaining,
    actual,
    plays: facts.plays,
    alerts,
    worst: worstAlert(alerts),
    ledger: {
      revenue,
      paidValue,
      revenueFromDraws,
      paidFromDraws,
      mismatch: zure.length > 0,
      note: zure.length > 0 ? zure.join(" ") : null,
    },
    series: args.withSeries
      ? await seriesOf({ tenantId, gachaId, price, designedPercent, stock })
      : [],
  };
}

/**
 * テナントの全ガチャぶん。ガチャ一覧に3種を並べるために使う。
 *
 * ★他社のガチャを絶対に混ぜないこと。
 *   tenant_id で必ず絞ります。ここを緩めると、他社の売上が見えます。
 */
export async function rtpReportAll(tenantId: string): Promise<RtpReport[]> {
  const r = await db().execute({
    sql: `SELECT id FROM gachas WHERE tenant_id = ? ORDER BY created_at DESC`,
    args: [tenantId],
  });

  const out: RtpReport[] = [];
  for (const row of r.rows as Row[]) {
    const rep = await rtpReport({ tenantId, gachaId: str(row.id) });
    if (rep) out.push(rep);
  }
  return out;
}

/**
 * 「今日やること」に出す、危ないガチャだけの一覧。
 *
 * ★OK と、回数不足（INFO）は出さないこと。
 *   毎日出る警告は、読まれなくなります。
 */
export async function rtpDangers(tenantId: string): Promise<
  {
    gachaId: string;
    title: string;
    level: RtpAlert["level"];
    message: string;
    advice?: string;
  }[]
> {
  const all = await rtpReportAll(tenantId);
  return all
    .filter((r) => r.worst.level === "WARN" || r.worst.level === "DANGER")
    .map((r) => ({
      gachaId: r.gachaId,
      title: r.title,
      level: r.worst.level,
      message: r.worst.message,
      advice: r.worst.advice,
    }));
}
