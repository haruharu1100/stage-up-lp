/**
 * 入口（API）の共通の門番。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この1か所にまとめるのか
 * ═══════════════════════════════════════════════════════
 *
 *   入口は、これから何十個も増えます。
 *   「誰か」「どの会社か」「状態を変える依頼か」の確認を
 *   入口ごとに手で書くと、いつか必ず1つ書き忘れます。
 *
 *   書き忘れた入口は、動きます。自分の会社のIDを送っている限り、
 *   正しく見えます。他社のIDを送ったときだけ、他社のものが返ります。
 *   つまり、普通に使っている限り、誰も気づきません。
 *
 *   だから、門番はここ1つにします。
 *   入口には「通す条件」を書くだけで、確認そのものは書かせません。
 *
 * ═══════════════════════════════════════════════════════
 * ★門番が必ずやること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 誰であるかを、クッキーからだけ決める。
 *      本文やURLの userId / tenantId は、いっさい見ない。
 *
 *   2) 会社ごとの入れ物（scope）を作って渡す。
 *      入口は、この入れ物からしかDBを触れません。
 *      触ると必ず WHERE tenant_id = ? が付きます。
 *
 *   3) 状態が変わる依頼（POST/PUT/PATCH/DELETE）では、
 *      クッキーに入っていない合図（CSRF）を必ず確かめる。
 *      確かめないと、別のサイトに置かれたボタンを踏んだだけで、
 *      お客様の名前のまま操作が成立します。
 *
 *   4) 使われたので、期限を延ばす（延びないほうの期限は触らない）。
 *
 *   5) 断ったときは、断った理由をログに残せる形で返す。
 *      「起きなかったこと」も、あとで数えられるようにします。
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  readSession,
  touchSession,
  type Session,
  type SubjectKind,
} from "./session";
import { scopeFor, type Scope } from "./tenant";
import { id } from "./ids";
import { asRole, can, type Permission, type Role } from "@/lib/permissions";

export type Ctx = {
  requestId: string;
  session: Session;
  /**
   * 依頼した人の役割。お客様のときは null。
   *
   * ★入口の中で、これを見て分岐してもかまいません。
   *   ただし「通す・断る」の判断は guard に書くこと。
   *   入口の中に条件を書き足すと、
   *   次に足す入口で必ず1つ忘れます。
   */
  role: Role | null;
  /** この会社ぶんだけを見る入れ物。ここ以外からDBを触らないこと */
  scope: Scope;
  token: string;
};

export type Guard = {
  /** 誰を通すか。省略するとログインしている人は全員 */
  kind?: SubjectKind;
  /**
   * 追加の本人確認（二段階認証）を通していることを求めるか。
   *
   * ★お金が動く操作では、必ず true にすること。
   */
  stepUp?: boolean;
  /** 管理者のとき、通す役職。省略すると全員 */
  roles?: string[];
  /**
   * この操作に必要な権限。
   *
   * ═══════════════════════════════════════════════════════
   * ★入口には、必ずこれを書くこと
   * ═══════════════════════════════════════════════════════
   *
   *   画面でボタンを消すのは、親切のためです。安全のためではありません。
   *   ボタンが無くても、入口は住所を知っていれば直接叩けます。
   *
   *       curl -X POST /api/console/points/approve ...
   *
   *   このとき断れるのは、ここに書いた1行だけです。
   *
   *   ★判断のもとは lib/permissions.ts の1枚だけ。
   *     画面と同じ表を読むので、
   *     「画面では消えているのに入口は受け付ける」が起きません。
   */
  permission?: Permission;
  /**
   * 「入る前に済ませてもらうこと」が終わっていなくても通す入口か。
   *
   * ═══════════════════════════════════════════════════════
   * ★既定は false（＝終わるまで通さない）にしてあります
   * ═══════════════════════════════════════════════════════
   *
   *   仮パスワードのままの人を、画面だけ止めても意味がありません。
   *   入口の住所を知っていれば、画面を開かずに直接叩けます。
   *
   *   ですから、入口の側でも止めます。
   *   例外は、止める原因そのものを解消する入口だけです。
   *
   *       ・パスワードを変える入口
   *       ・二段階認証を登録する入口
   *       ・ログアウトする入口
   *
   *   ★ここに true を書き足すときは、必ず立ち止まること。
   *     「仮パスワードのままの人に、この操作をさせてよいか」を
   *     一度だけ自分に聞いてください。だいたいの答えは「よくない」です。
   */
  firstRun?: boolean;
};

/** 断ったときの返し方。理由は分けるが、中身は明かさない */
function deny(
  requestId: string,
  code: string,
  message: string,
  status: number,
) {
  return NextResponse.json({ ok: false, code, message, requestId }, { status });
}

/**
 * 門番を通す。
 *
 * 通れば ctx を返し、通らなければ、そのまま返せる応答を返します。
 *
 * 使い方：
 *
 *     const gate = await guard(req, { kind: "ADMIN" });
 *     if (!("scope" in gate)) return gate;   // 断られた
 *     const orders = await gate.scope.list("orders");
 */
export async function guard(
  req: NextRequest,
  need: Guard = {},
): Promise<Ctx | NextResponse> {
  const requestId = id("req");
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  /* ── ① いま誰か ───────────────────────────── */
  const session = await readSession(token);
  if (!session) {
    return deny(
      requestId,
      "UNAUTHENTICATED",
      "ログインが必要です。",
      401,
    );
  }

  /* ── ② お客様か、運営の管理者か ───────────── */
  if (need.kind && session.subjectKind !== need.kind) {
    /* ★「あなたは管理者ではありません」と細かく返さないこと。
         どの入口が管理者用なのかを、外から地図にできます。 */
    return deny(requestId, "FORBIDDEN", "この操作は行えません。", 403);
  }

  /* ── ③ 状態が変わる依頼なら、CSRF の合図を確かめる ──
       ★読み取りだけの依頼にまで求めないこと。
         画面を開くたびに落ちるようになり、
         最終的には「面倒だから外そう」になります。 */
  const changes = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (changes) {
    const { verifyCsrf } = await import("./session");
    const sent = req.headers.get(CSRF_HEADER)?.trim();
    if (!(await verifyCsrf(token, sent))) {
      return deny(
        requestId,
        "CSRF_FAILED",
        "画面を開き直してから、もう一度お試しください。",
        403,
      );
    }
  }

  /* ── ④ 追加の本人確認 ─────────────────────── */
  if (need.stepUp && !session.stepUpAt) {
    return deny(
      requestId,
      "STEP_UP_REQUIRED",
      "この操作には、認証アプリの6桁の数字が必要です。",
      403,
    );
  }

  /* ── ⑤ 役職と権限 ─────────────────────────
       ★役割は、必ずDBから読むこと。
         セッションの中に焼き付けておくと、
         権限を外した担当者が、ログインし直すまで
         強いままになります。外した瞬間から効かせます。 */
  let role: Role | null = null;

  if (session.subjectKind === "ADMIN") {
    const { db } = await import("./db");
    const res = await db().execute({
      sql: `SELECT role, must_change_password, mfa_required, mfa_enabled
              FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [session.subjectId, session.tenantId],
    });
    const me = res.rows[0] as Record<string, unknown> | undefined;
    role = asRole(me?.role);

    /* ── 入る前に済ませてもらうこと ─────────────
         ★画面で止めるだけにしないこと。
           画面を開かずに、この入口を直接叩く道が残ります。 */
    if (!need.firstRun) {
      if (Number(me?.must_change_password ?? 0) === 1) {
        return deny(
          requestId,
          "PASSWORD_CHANGE_REQUIRED",
          "先に、パスワードの変更をお願いします。",
          403,
        );
      }
      if (
        Number(me?.mfa_required ?? 0) === 1 &&
        Number(me?.mfa_enabled ?? 0) !== 1
      ) {
        return deny(
          requestId,
          "MFA_SETUP_REQUIRED",
          "先に、認証アプリの登録をお願いします。",
          403,
        );
      }
    }
  }

  if (need.roles && need.roles.length > 0) {
    if (role === null || !need.roles.includes(role)) {
      return deny(requestId, "FORBIDDEN", "この操作は行えません。", 403);
    }
  }

  if (need.permission) {
    /* ★お客様のセッションで、管理者向けの権限を満たさせないこと */
    if (role === null || !can(role, need.permission)) {
      /* ★足りない権限の名前を、返事に書かないこと。
           何が足りないかを教えると、
           どの役割を狙えばよいかの地図になります。
           記録には残します（下の console.warn）。 */
      console.warn(
        `[guard] denied ${requestId} perm=${need.permission} role=${role ?? "-"}`,
      );
      return deny(requestId, "FORBIDDEN", "この操作は行えません。", 403);
    }
  }

  /* ── ⑥ 使われたので、期限を延ばす ─────────── */
  await touchSession(token);

  /* ★ここが要。会社ごとの入れ物を、セッションから作って渡します。
       入口が自分で tenantId を決める余地を残しません。 */
  return {
    requestId,
    session,
    role,
    scope: scopeFor(session.tenantId),
    token: token as string,
  };
}

/** 門番を通ったかどうか（型を絞るための道具） */
export function passed(gate: Ctx | NextResponse): gate is Ctx {
  return "scope" in gate;
}

/**
 * 想定していない失敗の返し方。
 *
 * ★中身をそのまま返さないこと。
 *   内部の構造が分かる文言は、次に攻める場所の手がかりになります。
 */
export function internalError(requestId: string, where: string, e: unknown) {
  console.error(`[${where}] unexpected`, requestId, e);
  return NextResponse.json(
    {
      ok: false,
      code: "INTERNAL",
      message:
        "処理中に問題が発生しました。もう一度お試しいただくか、しばらくしてからお願いします。",
      requestId,
    },
    { status: 500 },
  );
}
