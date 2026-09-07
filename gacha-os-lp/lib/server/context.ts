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
import {
  ROLE_PERMISSIONS,
  can,
  type Permission,
  type Role,
} from "@/lib/permissions";

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
  /**
   * 「6桁を、いま入れ直したか」まで求めるときの、有効な長さ（分）。
   *
   * ═══════════════════════════════════════════════════════
   * ★stepUp だけでは足りない場面があります
   * ═══════════════════════════════════════════════════════
   *
   *   stepUp は「このログインは、6桁を通っている」という印です。
   *   ログインした時点で付き、そのログインの間ずっと残ります。
   *
   *   ふつうの操作なら、それで十分です。
   *   ただし「他人のアカウントを取れる操作」だけは足りません。
   *
   *   朝ログインした画面が、昼まで開いたままになっている。
   *   これは、悪い運用ではなく、ふつうの運用です。
   *   その画面の前に、席を外した数分の間に誰かが座ったとき、
   *   stepUp の印は、朝のぶんがそのまま効いています。
   *
   *   ですから、いちばん強い操作の直前にだけ、
   *   「いま、もう一度6桁を入れてください」と求めます。
   *   ここに分を書くと、その分より古い印は通りません。
   *
   * ★短くしすぎないこと。
   *   1分にすると、理由を書いている間に切れます。
   *   切れるたびに入れ直す画面は、やがて必ず外されます。
   */
  freshStepUpMinutes?: number;
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

  /**
   * ═══════════════════════════════════════════════════════
   * ★DBが答えなかったときに、投げっぱなしにしないこと
   * ═══════════════════════════════════════════════════════
   *
   *   2026-08-26、わざと壊す試験（tests/failInjection.test.ts）で
   *   分かりました。DBが答えないと、門番の中で起きた失敗が、
   *   そのまま外へ飛び出していました。
   *
   *   飛び出したものは、いまは Next.js が受け止めて 500 にします。
   *   ★つまり、いまは「たまたま」通らない状態です。
   *
   *   たまたま、では困ります。理由は2つあります。
   *
   *     ① 呼ぶ側が包んだ瞬間に、意味が反転します。
   *        「落ちないようにしておこう」と、よかれと思って
   *        まわりを try で包み、失敗したときに先へ進めてしまうと、
   *        DBが不調な数分間、誰でも入れる状態ができます。
   *        書いた人に悪気はありません。だから起きます。
   *
   *     ② requestId が残りません。
   *        あとから「あのとき何が起きたか」を追えなくなります。
   *
   *   ★だから、ここで自分から断ります。
   *     分からないときは通さない。これを、外の親切に任せない。
   */
  try {
    return await guardHonbun(req, need, requestId);
  } catch (e) {
    /* ★中身は返さないこと。DBの都合を、外へ見せる必要はありません */
    console.error(`[guard] ${requestId} 確認ができませんでした`, e);
    return deny(
      requestId,
      "SERVICE_UNAVAILABLE",
      "ただいま確認ができません。少し時間をおいてから、もう一度お試しください。",
      503,
    );
  }
}

async function guardHonbun(
  req: NextRequest,
  need: Guard,
  requestId: string,
): Promise<Ctx | NextResponse> {
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

  /* ── ②' いま開いている住所と、合言葉のお店が合っているか ──

       ═══════════════════════════════════════════════════════
       ★画面側だけで見ないこと（2026-09-07）
       ═══════════════════════════════════════════════════════

         会社コードをやめて、住所（ドメイン）でお店を決めました。
         画面（lib/server/pageAuth.ts）でも同じ確認をしていますが、
         画面を開かずに入口だけを直接叩くことができます。

             curl -H "Cookie: gos_session=…" https://shop-b.example.com/api/…

         このとき、合言葉がA店のものなら、
         B店の住所からA店の中身が取り出せてしまいます。
         ですから、入口の側でも同じ確認をします。

       ★住所からお店が決まらない配置では判断しません。
         判断できないものを断ると、正しく入っている方まで
         すべての操作ができなくなります（tenantHost.ts に理由）。

       ★判断のもとは tenantHost.ts の1か所だけです。
         ここに条件を書き写さないこと。 */
  {
    const { hostFromHeaders, hostMatchesTenantFor } = await import(
      "./tenantHost"
    );
    const h = hostFromHeaders(req.headers);
    if (!(await hostMatchesTenantFor(h, session.tenantId))) {
      console.warn(
        `[guard] host不一致 ${requestId} host=${h} ${req.method} ${req.nextUrl.pathname}`,
      );
      return deny(
        requestId,
        "TENANT_HOST_MISMATCH",
        "このアドレスでは、いまのログインはお使いいただけません。お手数ですが、ログインし直してください。",
        403,
      );
    }
  }

  /* ── ③ 状態が変わる依頼なら、CSRF の合図を確かめる ──
       ★読み取りだけの依頼にまで求めないこと。
         画面を開くたびに落ちるようになり、
         最終的には「面倒だから外そう」になります。 */
  const changes = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);

  /* ── ③' 「見るだけ」のセッションは、ここで全部止める ──

       ═══════════════════════════════════════════════════════
       ★なぜ、役職ではなくセッションで止めるのか
       ═══════════════════════════════════════════════════════

         見学の方には、管理画面の全部を見ていただきたい。
         けれど、1つも動かしてほしくない。
         この2つは、役職の表（lib/permissions.ts）では両立しません。
         見せるために強い役職を渡すと、動かす力も一緒に渡ります。

         だから、力のほうをセッション側で外します。
         役職は何でもかまいません。印が付いていれば、
         状態が変わる依頼は1つも通りません。

       ★この判断を、ここより先に置かないこと。
         権限を見てから断る形にすると、
         「権限は足りているのに動かない」入口と
         「権限が足りないから動かない」入口が混ざり、
         どちらで止まったのかが記録から読めなくなります。

       ★この判断を、入口ごとに書き写さないこと。
         入口は41本あります。42本目で必ず忘れます。
         忘れても画面は正しく見えるので、誰も気づきません。 */
  if (changes && session.readOnly) {
    console.warn(`[guard] read-only ${requestId} ${req.method} ${req.nextUrl.pathname}`);
    return deny(
      requestId,
      "READ_ONLY",
      "この画面は見学用です。内容の変更はできません。",
      403,
    );
  }

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

  /* ── ④ 追加の本人確認 ───────────────────────

       ★お客様と運営で、確かめ方が違います。
         運営 … 認証アプリの6桁
         お客様 … その場でのパスワードの入れ直し
         （お客様に認証アプリを配っていないためです。
           理由は lib/server/auth.ts の verifyCustomerStepUp に。）
         文言だけを分けます。判断は同じです。 */
  const stepUpNaninyoru =
    session.subjectKind === "CUSTOMER"
      ? "パスワードの入れ直し"
      : "認証アプリの6桁の数字";

  if (need.stepUp && !session.stepUpAt) {
    return deny(
      requestId,
      "STEP_UP_REQUIRED",
      `この操作には、${stepUpNaninyoru}が必要です。`,
      403,
    );
  }

  /* ── ④' その確認は、いま行ったものか ─────────
       ★古い印を「通ったこと」にしないこと。
         開きっぱなしの画面の前に、あとから座った人が、
         朝の確認のまま、いちばん強い操作を実行できてしまいます。

       ★この「いま」の計算を、ここに書き写さないこと。
         stepUpPolicy.ts の isStepUpFresh を必ず呼びます。
         別々に書くと、片方だけ長い日ができます。
         長いほうから破られます。 */
  if (need.freshStepUpMinutes) {
    const { isStepUpFresh } = await import("./stepUpPolicy");
    if (!isStepUpFresh(session.stepUpAt, need.freshStepUpMinutes)) {
      return deny(
        requestId,
        "FRESH_STEP_UP_REQUIRED",
        `この操作の前に、${stepUpNaninyoru}を、もう一度お願いいたします。`,
        403,
      );
    }
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
      sql: `SELECT role, status, locked_until,
                   must_change_password, mfa_required, mfa_enabled
              FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [session.subjectId, session.tenantId],
    });
    const me = res.rows[0] as Record<string, unknown> | undefined;

    /* ═══════════════════════════════════════════
       ★分からないときは、通さない
       ═══════════════════════════════════════════

         2026-08-26、公開先の総点検で見つかりました。

         担当者の行が読めなかったとき（消された・別会社・DBが答えない）、
         ここは asRole() を通していました。asRole() は
         「知らない値なら VIEWER」という作りです。
         表示のための道具としては正しい形です。
         ですが、門番がこれを使うと、意味が変わります。

             行が読めない → 役割が分からない → ★VIEWER として通す

         VIEWER は、ガチャ・ポイント・発送・問い合わせを「見る」人です。
         つまり、消したはずの担当者が、手元に残ったクッキーだけで、
         会社の中身を読み続けられます。DBが一瞬答えなかっただけでも、
         同じことが起きます。

         「分からない」は「大丈夫」ではありません。
         読めないなら断る。ここを、いちばん厳しい側に倒します。 */
    if (!me) {
      return deny(
        requestId,
        "UNAUTHENTICATED",
        "ログインが必要です。",
        401,
      );
    }

    const nokoriRole = String(me.role ?? "");
    if (!(nokoriRole in ROLE_PERMISSIONS)) {
      /* 知らない役割が入っていた。読めなかったのと同じ扱いにします */
      console.warn(`[guard] unknown role ${requestId} role=${nokoriRole}`);
      return deny(requestId, "FORBIDDEN", "この操作は行えません。", 403);
    }
    role = nokoriRole as Role;

    /* ★利用を止めた担当者を、開きっぱなしの画面で働かせないこと。
         止めるのは、たいてい「今すぐ止めたい」ときです。
         ログインし直すまで有効、では止めたことになりません。 */
    if (String(me.status ?? "ACTIVE") !== "ACTIVE") {
      return deny(
        requestId,
        "ACCOUNT_SUSPENDED",
        "このアカウントは、現在ご利用いただけません。",
        403,
      );
    }

    /* ★締め出し中（何度も間違えた・管理者が鍵をかけた）も同じ */
    const lock = me.locked_until ? Date.parse(String(me.locked_until)) : NaN;
    if (Number.isFinite(lock) && lock > Date.now()) {
      return deny(
        requestId,
        "ACCOUNT_LOCKED",
        "このアカウントは、現在ご利用いただけません。",
        403,
      );
    }

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

  /* ── ⑤' お客様の側も、毎回DBを見ること ─────────

       ═══════════════════════════════════════════════════════
       ★2026-09-05、会員登録を作っている途中で見つかりました
       ═══════════════════════════════════════════════════════

         ここまで、DBを見ていたのは管理者だけでした。
         お客様は、セッションが生きてさえいれば、そのまま通っていました。

         つまり、こうなっていました。

             運営が「この会員を停止」を押す
               → 会員一覧では停止と表示される
               → ★でも、その方の開きっぱなしの画面は、まだ引ける

         止めるのは、たいてい「今すぐ止めたい」ときです。
         不正が疑われた、支払いが取り消された、といった場面です。
         次にログインし直すまで有効、では、止めたことになりません。

         ★だから、お客様も毎回見ます。管理者と同じ厳しさにします。

       ═══════════════════════════════════════════════════════
       ★メール確認は、ここ1か所で止めること
       ═══════════════════════════════════════════════════════

         入口ごとに「確認が済んでいるか」を書き写すと、
         入口は40本以上あるので、41本目で必ず忘れます。
         忘れても画面は正しく見えるので、誰も気づきません。

         見るだけの依頼（GET）は通します。
         止めるのは、状態が変わる依頼だけです。
         確認前の方にも、どんなガチャがあるかは見ていただきます。
         見えないと、確認しようという気持ちが起きません。

       ★firstRun: true の入口だけが例外です。
         ログアウト、自分の情報、確認メールの再送。
         止めている原因そのものを解消する入口です。 */
  if (session.subjectKind === "CUSTOMER") {
    const { db } = await import("./db");
    const res = await db().execute({
      sql: `SELECT status, email_verified_at
              FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [session.subjectId, session.tenantId],
    });
    const me = res.rows[0] as Record<string, unknown> | undefined;

    /* ★分からないときは、通さない（消された・別会社・DBが答えない） */
    if (!me) {
      return deny(requestId, "UNAUTHENTICATED", "ログインが必要です。", 401);
    }

    if (String(me.status ?? "ACTIVE") !== "ACTIVE") {
      return deny(
        requestId,
        "ACCOUNT_SUSPENDED",
        "このアカウントは、現在ご利用いただけません。",
        403,
      );
    }

    if (changes && !need.firstRun && me.email_verified_at == null) {
      return deny(
        requestId,
        "EMAIL_NOT_VERIFIED",
        "先に、メールアドレスのご確認をお願いします。" +
          "ご登録時にお送りしたメールのリンクを開いてください。",
        403,
      );
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
