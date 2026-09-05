/**
 * 抽選（運営側で行う本番版）。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが守るもの
 * ═══════════════════════════════════════════════════════
 *
 *   1) 結果は運営側で決める。お客様の端末では決めない。
 *   2) 乱数は node:crypto だけを使う（lib/server/rng.ts）。
 *      ガチャID・抽選回数・時刻など、外から見える材料を種にしない。
 *   3) 同じ鍵（Idempotency-Key）で2回届いたら、引き直さず前回の結果を返す。
 *   4) 次の6つを、1回の取引でまとめて行う。1つでも失敗したら全部やめる。
 *
 *        ポイントを引く
 *        景品を決める
 *        景品の残数を減らす
 *        結果を保存する
 *        ポイント台帳に残す
 *        監査ログに残す
 *
 *   5) 残数とポイントの引き算は「条件付き更新」で行う。
 *      残りが1以上のときだけ減らす／残高が足りているときだけ減らす。
 *      これはDBが保証するので、サーバーが何台に増えても効きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★やってはいけない書き方
 * ═══════════════════════════════════════════════════════
 *
 *   「先に読んで、足りているか確かめてから、減らす」だけでは足りません。
 *   読んでから減らすまでの間に、別の依頼が同じことをします。
 *   2人とも「足りている」と読んでから、2人とも減らします。
 *   残数は −1 になり、在庫が無いのに当選だけが2件出ます。
 *
 *   確かめるのと減らすのを、1つの命令にすること。
 *   　UPDATE … SET left_count = left_count - 1 WHERE left_count > 0
 *   これなら、後から来た方は「0行しか変わらなかった」と分かります。
 */

import { drawWith, type DrawOutcome } from "../console/draw";
import { appendAuditTx } from "./audit";
import { SERVER_VERSION, withWriteTx } from "./db";
import { id } from "./ids";
import { nonce, pickBelow } from "./rng";

/** 抽選が成立しなかったときの理由 */
export type DrawErrorCode =
  | "NO_CUSTOMER"
  | "CUSTOMER_SUSPENDED"
  | "EMAIL_NOT_VERIFIED"
  | "NO_GACHA"
  | "NOT_PUBLISHED"
  | "SOLD_OUT"
  | "NOT_ENOUGH_POINTS"
  | "STOCK_CONFLICT"
  | "IN_PROGRESS";

export class DrawError extends Error {
  code: DrawErrorCode;
  constructor(code: DrawErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "DrawError";
  }
}

/** 1回ぶんの抽選結果（お客様にも返す形） */
export type DrawResult = {
  drawId: string;
  /** 前回と同じ鍵だったので、引き直さず前回の結果を返した */
  replayed: boolean;
  gachaId: string;
  gachaTitle: string;
  playCount: number;
  price: number;
  pointBefore: number;
  pointSpent: number;
  pointReturned: number;
  pointAfter: number;
  grade: string;
  prizeId: string | null;
  prizeName: string;
  prizeValue: number;
  /**
   * 当たった賞の写真。お店が登録していなければ null。
   *
   * ★null のときに、ここで代わりの画像を入れないこと。
   *   結果画面は「画像未登録」と出します。それが事実です。
   */
  imageId: string | null;
  lastOne: boolean;
  needsShipping: boolean;
  remainingBefore: number;
  remainingAfter: number;
  at: string;
  auditSeq: number;
};

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");

/* 現物のお届けが要る等級 */
const SHIPPED = new Set(["S", "A", "B"]);

/**
 * ガチャを1回引く。
 *
 * @param idempotencyKey 1回の購入操作につき1つ。連打・再送でも同じ値を送ること。
 * @param requestId      通信1回ごとの識別子（ログを突き合わせるためだけに使う）
 */
export async function drawOnceServer(args: {
  tenantId: string;
  userId: string;
  gachaId: string;
  idempotencyKey: string;
  requestId: string;
  /** 記録に残す時刻。省略時は現在時刻 */
  now?: string;
}): Promise<DrawResult> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    /* ── ① 同じ鍵で、もう処理していないか ─────────────
       ★ここを最初に見ること。
         後ろに置くと、ポイントを引いてから気づくことになります。 */
    const seen = await tx.execute({
      sql: `SELECT status, response FROM idempotency
             WHERE tenant_id = ? AND scope = 'draw' AND key = ?`,
      args: [args.tenantId, args.idempotencyKey],
    });

    if (seen.rows.length > 0) {
      const row = seen.rows[0] as Row;
      if (str(row.status) === "DONE" && row.response) {
        const prev = JSON.parse(str(row.response)) as DrawResult;
        return { ...prev, replayed: true };
      }
      throw new DrawError(
        "IN_PROGRESS",
        "同じご依頼をいま処理しています。少し待ってから、もう一度お試しください。二重には引いていません。",
      );
    }

    /* ── ② お客様 ─────────────────────────────── */
    const cu = await tx.execute({
      sql: `SELECT id, name, points, status, email_verified_at FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cu.rows.length === 0) {
      throw new DrawError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const user = cu.rows[0] as Row;
    if (str(user.status) !== "ACTIVE") {
      throw new DrawError(
        "CUSTOMER_SUSPENDED",
        "このアカウントは現在ご利用いただけません。",
      );
    }

    /* ★メール確認は、ここでも見ること。
         ═══════════════════════════════════════════════
         門番（lib/server/context.ts）でも同じ確認をしています。
         二重に書くのは、ふだんは良くないことです。
         ただし、この入口だけは別です。

         /api/console/draw は、門番を通っていません。
         入口の中で、自分で確認を書き写しています。
         ですから、門番にだけ書くと、この入口は素通りします。

         そして、この入口は「ポイントが実際に減る」唯一の場所です。
         素通りさせると、メール確認をしていない人が、
         画面を開かずに直接叩くだけでガチャを引けます。

         ★片方だけ直さないこと。
           context.ts の EMAIL_NOT_VERIFIED を変えるときは、
           必ずここも一緒に見ること。 */
    if (user.email_verified_at == null) {
      throw new DrawError(
        "EMAIL_NOT_VERIFIED",
        "先に、メールアドレスのご確認をお願いします。" +
          "ご登録時にお送りしたメールのリンクを開いてください。",
      );
    }

    /* ── ③ ガチャ ─────────────────────────────── */
    const ga = await tx.execute({
      sql: `SELECT id, title, price, total, left_count, designed_rtp, status,
                   revenue, paid_value
              FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    if (ga.rows.length === 0) {
      throw new DrawError("NO_GACHA", "このガチャは見つかりません。");
    }
    const g = ga.rows[0] as Row;
    const leftBefore = num(g.left_count);

    /* ★完売の判定を、販売中かどうかの判定より先に置くこと。
       売り切れた瞬間に状態は SOLD_OUT に変わります。
       順番が逆だと、完売した方に「販売していません」と出ます。
       間違いではありませんが、なぜ引けないのかが伝わりません。 */
    if (leftBefore <= 0 || str(g.status) === "SOLD_OUT") {
      throw new DrawError("SOLD_OUT", `「${str(g.title)}」は完売しました。`);
    }
    if (str(g.status) !== "PUBLISHED") {
      throw new DrawError(
        "NOT_PUBLISHED",
        `「${str(g.title)}」はいま販売していません。`,
      );
    }

    const price = num(g.price);
    const pointBefore = num(user.points);
    if (pointBefore < price) {
      throw new DrawError(
        "NOT_ENOUGH_POINTS",
        `残高が ${(price - pointBefore).toLocaleString()}pt 足りません。`,
      );
    }

    /* ── ④ 箱の中身（等級ごとに、もう何本出たか） ───────── */
    const st = await tx.execute({
      sql: `SELECT grade, total, drawn, image_id FROM gacha_stock
             WHERE tenant_id = ? AND gacha_id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const drawn: Record<string, number> = {};
    /* 賞ごとの写真。★ここで「無いから表紙で代用」をしないこと。
       当たっていない物を当選画面に大きく出すことになります。 */
    const shashin: Record<string, string | null> = {};
    for (const r of st.rows as Row[]) {
      drawn[str(r.grade)] = num(r.drawn);
      shashin[str(r.grade)] = r.image_id == null ? null : String(r.image_id);
    }

    /* ── ⑤ 抽選 ───────────────────────────────
       ★乱数はここでしか作らない。材料は node:crypto だけ。
         ガチャIDも抽選回数も渡していないこと（渡すと予測できるようになる）。 */
    const rngNonce = nonce();
    const out: DrawOutcome = drawWith(
      {
        title: str(g.title),
        price,
        total: num(g.total),
        left: leftBefore,
        designedRtp: num(g.designed_rtp),
      },
      drawn,
      pickBelow,
    );

    const needsShipping = SHIPPED.has(out.grade);
    const pointReturned = out.points;
    const pointAfter = pointBefore - price + pointReturned;
    const leftAfter = leftBefore - 1;

    /**
     * この1回で、お客様へ実際にお返しした価値。
     *
     * ★ここを out.value だけにしないこと（2026-08-26 修正）。
     *
     *   S・A・B賞は現物なので、お返しした価値 ＝ 景品の価値（out.value）。
     *   C・D賞はポイントでお返しするので out.points と out.value は同じ額です。
     *   ところが「はずれ（-）」だけは out.value が 0 なのに、
     *   参加ポイント（out.points）を実際にお返ししています。
     *
     *   以前はここで out.value を足していたので、はずれが出るたびに
     *   gachas.paid_value が、実際より少ない額で記録されていました。
     *   その集計値を信じて還元率を出すと、実際より低く見えます。
     *
     *   ★受け取り方（現物かポイントか）で、どちらか片方だけを数えること。
     *     両方足すと、今度は二重に数えてしまいます。
     */
    const returnedValue = needsShipping ? out.value : pointReturned;

    /* ── ⑥ 減らす（条件付き。読んでから減らす、をしない） ───── */
    const decGacha = await tx.execute({
      sql: `UPDATE gachas
               SET left_count = left_count - 1,
                   revenue    = revenue + ?,
                   paid_value = paid_value + ?,
                   status     = CASE WHEN left_count - 1 <= 0 THEN 'SOLD_OUT' ELSE status END
             WHERE tenant_id = ? AND id = ?
               AND status = 'PUBLISHED' AND left_count > 0`,
      args: [price, returnedValue, args.tenantId, args.gachaId],
    });
    if (Number(decGacha.rowsAffected) !== 1) {
      throw new DrawError(
        "SOLD_OUT",
        "ちょうど売り切れました。ポイントは減っていません。",
      );
    }

    if (out.grade !== "-") {
      const decStock = await tx.execute({
        sql: `UPDATE gacha_stock SET drawn = drawn + 1
               WHERE tenant_id = ? AND gacha_id = ? AND grade = ? AND drawn < total`,
        args: [args.tenantId, args.gachaId, out.grade],
      });
      if (Number(decStock.rowsAffected) !== 1) {
        /* ここに来たら、箱の計算と在庫がずれている。
           ★勝手に景品を出さないこと。全部やめて、記録に残す方が安全です。 */
        throw new DrawError(
          "STOCK_CONFLICT",
          "景品の在庫が合いませんでした。安全のため、この抽選は行いませんでした。ポイントは減っていません。",
        );
      }
    }

    const decPoints = await tx.execute({
      sql: `UPDATE customers
               SET points = points - ? + ?,
                   spent  = spent + ?
             WHERE tenant_id = ? AND id = ? AND points >= ?`,
      args: [price, pointReturned, price, args.tenantId, args.userId, price],
    });
    if (Number(decPoints.rowsAffected) !== 1) {
      throw new DrawError(
        "NOT_ENOUGH_POINTS",
        "残高が足りませんでした。抽選は行っていません。",
      );
    }

    /* ── ⑦ 記録 ─────────────────────────────── */
    const playCountRow = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM draws WHERE tenant_id = ? AND gacha_id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const playCount = num((playCountRow.rows[0] as Row).n) + 1;

    const drawId = id("drw");
    const prizeId = needsShipping ? id("prz") : null;

    await tx.execute({
      sql: `INSERT INTO draws
              (id, tenant_id, idempotency_key, request_id, user_id, gacha_id, play_count,
               price, point_before, point_spent, point_returned, point_after,
               prize_id, prize_rank, prize_name, prize_value, last_one,
               remaining_before, remaining_after, rng_source, rng_nonce,
               server_version, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        drawId,
        args.tenantId,
        args.idempotencyKey,
        args.requestId,
        args.userId,
        args.gachaId,
        playCount,
        price,
        pointBefore,
        price,
        pointReturned,
        pointAfter,
        prizeId,
        out.grade,
        out.name,
        out.value,
        out.lastOne ? 1 : 0,
        leftBefore,
        leftAfter,
        "node:crypto/randomInt",
        rngNonce,
        SERVER_VERSION,
        at,
      ],
    });

    if (prizeId) {
      await tx.execute({
        /*
         * ★当たった瞬間の写真を、ここへ写し取ること（018）。
         *
         *   写し取らないと、お店があとで写真を差し替えたときに、
         *   お客様の獲得商品の履歴まで、別の物の写真に変わります。
         *   「私が当てたのは、これではない」と言われたとき、
         *   こちらにもお店にも、確かめる手立てが残りません。
         *   お金を受け取っている以上、当選の記録は動いてはいけません。
         *
         *   ★写ってはいけないものが写っていた場合の逃げ道は、
         *     別に用意してあります（写真の「完全削除」）。
         *     そちらは履歴からも消え、★消したことが監査に残ります。
         *     静かに変わるのと、記録を残して消すのは別のことです。
         */
        sql: `INSERT INTO prizes
                (id, tenant_id, user_id, gacha_id, draw_id, grade, name, value,
                 exchange_pt, status, won_at, image_id)
              VALUES (?,?,?,?,?,?,?,?,?, 'UNCHOSEN', ?, ?)`,
        args: [
          prizeId,
          args.tenantId,
          args.userId,
          args.gachaId,
          drawId,
          out.grade,
          out.name,
          out.value,
          out.value,
          at,
          shashin[out.grade] ?? null,
        ],
      });
    }

    await tx.execute({
      sql: `INSERT INTO point_ledger (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
            VALUES (?,?,?, 'DRAW_SPEND', ?, ?, ?, ?)`,
      args: [
        id("led"),
        args.tenantId,
        args.userId,
        -price,
        `${str(g.title)} を1回`,
        drawId,
        at,
      ],
    });

    if (pointReturned > 0) {
      await tx.execute({
        sql: `INSERT INTO point_ledger (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
              VALUES (?,?,?, 'DRAW_RETURN', ?, ?, ?, ?)`,
        args: [
          id("led"),
          args.tenantId,
          args.userId,
          pointReturned,
          out.grade === "-"
            ? "はずれ（参加ポイント）"
            : `${out.grade}賞（ポイントでお返し）`,
          drawId,
          at,
        ],
      });
    }

    /* ── ⑧ 監査ログ（同じ取引の中で足すこと） ───────────── */
    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "CUSTOMER",
      actorId: args.userId,
      actorName: str(user.name),
      actorRole: "CUSTOMER",
      action: "DRAW",
      target: args.gachaId,
      summary: `${str(g.title)} を1回引き、${out.grade === "-" ? "はずれ" : `${out.grade}賞`}（${out.name}）が出ました。`,
      before: `残高 ${pointBefore.toLocaleString()}pt ／ 残り ${leftBefore.toLocaleString()}口`,
      after: `残高 ${pointAfter.toLocaleString()}pt ／ 残り ${leftAfter.toLocaleString()}口`,
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      data: {
        draw_id: drawId,
        tenant_id: args.tenantId,
        user_id: args.userId,
        gacha_id: args.gachaId,
        request_id: args.requestId,
        idempotency_key: args.idempotencyKey,
        play_count: playCount,
        point_before: pointBefore,
        point_spent: price,
        point_returned: pointReturned,
        point_after: pointAfter,
        prize_id: prizeId,
        prize_rank: out.grade,
        prize_name: out.name,
        prize_value: out.value,
        last_one: Boolean(out.lastOne),
        remaining_before: leftBefore,
        remaining_after: leftAfter,
        rng_source: "node:crypto/randomInt",
        rng_nonce: rngNonce,
        server_version: SERVER_VERSION,
        timestamp: at,
      },
    });

    const result: DrawResult = {
      drawId,
      replayed: false,
      gachaId: args.gachaId,
      gachaTitle: str(g.title),
      playCount,
      price,
      pointBefore,
      pointSpent: price,
      pointReturned,
      pointAfter,
      grade: out.grade,
      prizeId,
      prizeName: out.name,
      prizeValue: out.value,
      imageId: shashin[out.grade] ?? null,
      lastOne: Boolean(out.lastOne),
      needsShipping,
      remainingBefore: leftBefore,
      remainingAfter: leftAfter,
      at,
      auditSeq: audit.seq,
    };

    /* ── ⑨ 鍵をしまう ─────────────────────────
       ★答えごと保存すること。
         「処理した」という印だけを残すと、2回目に届いたときに
         前回の結果を返せません。お客様は結果を見られないまま
         ポイントだけ減った状態になります。 */
    await tx.execute({
      sql: `INSERT INTO idempotency (tenant_id, scope, key, subject_id, status, response, created_at)
            VALUES (?, 'draw', ?, ?, 'DONE', ?, ?)`,
      args: [
        args.tenantId,
        args.idempotencyKey,
        args.userId,
        JSON.stringify(result),
        at,
      ],
    });

    return result;
  });
}
