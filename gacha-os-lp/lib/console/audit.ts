/**
 * 監査ログ（AUDIT LOG）と、その改ざん検知。
 *
 * ═══════════════════════════════════════════════════════
 * ★何のためにあるのか
 * ═══════════════════════════════════════════════════════
 *
 * オンラインガチャでは、ポイント・抽選結果・景品残数が、そのままお金です。
 * だから「誰が・いつ・何を・なぜ変えたか」が後から必ず追える必要があります。
 *
 * ただし、記録を残すだけでは足りません。
 * 記録そのものを後から書き換えられるなら、記録が無いのと変わらないからです。
 * 内部の人が、自分に都合の悪い1行だけをこっそり直せてしまいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ハッシュチェーンという考え方
 * ═══════════════════════════════════════════════════════
 *
 * 1件ごとに、
 *
 *     そのハッシュ = SHA256（ 前の1件のハッシュ ＋ 今回の中身 ）
 *
 * として計算し、鎖のようにつなぎます。
 *
 *     1件目 ─ hash1
 *              └→ 2件目 ─ hash2 = SHA256(hash1 + 中身2)
 *                          └→ 3件目 ─ hash3 = SHA256(hash2 + 中身3)
 *
 * こうしておくと、途中の1件（たとえば2件目）の中身を書き換えた瞬間、
 * hash2 が変わります。すると hash3 の計算元も変わるので hash3 も合わなくなり、
 * そこから後ろが全部ずれます。
 *
 * つまり「1行だけこっそり直す」ことができません。
 * 直すなら、それ以降の全部を作り直す必要があります。
 *
 * ★これは「絶対に改ざんされない」という意味ではありません。
 *   データベースを丸ごと自由にできる人なら、後ろ全部を作り直せます。
 *   ここで保証できるのは「気づかずに1行だけ書き換えることはできない」までです。
 *   本番では、これに加えて、追記しかできない保管先（Object Lock など）へ
 *   写しを送ることを検討します。LPでも、そのように書くこと。
 *   守れる範囲を超えて「改ざん不可能」と書かないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルの決まり
 * ═══════════════════════════════════════════════════════
 *
 *   1) 中身を文字列にする方法（canonical）を変えないこと。
 *      変えると、過去に作った鎖が全部 TAMPER 扱いになります。
 *      どうしても変える必要があるときは version を上げて、
 *      古い版は古い方法で検証すること。
 *
 *   2) ハッシュの計算対象に「そのハッシュ自身」を含めないこと。
 *      当たり前に見えますが、うっかり entry ごと JSON.stringify すると
 *      hash を含んだまま計算してしまい、絶対に一致しなくなります。
 *
 *   3) 検証は「最初の1件から順に」やり直すこと。
 *      保存されている hash を信じて比べるのではなく、自分で計算し直します。
 */

import { sha256 } from "./hash";

/** 監査ログに残す操作の種類 */
export type AuditAction =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "MFA_VERIFIED"
  | "GACHA_CREATE"
  | "BACKTEST_RUN"
  | "GACHA_PUBLISH"
  | "GACHA_PAUSE"
  /**
   * 止めていた販売を、また始めた記録。
   *
   * ★GACHA_PUBLISH と分けて残すこと。
   *   「はじめて世に出した」と「止めていたものを戻した」は、別の出来事です。
   *   戻したということは、その前に止めた理由があったということです。
   *   同じ名前で残すと、あとから読む人が、止めた事実を読み落とします。
   */
  | "GACHA_RESUME"
  | "POINT_ADJUST_REQUEST"
  | "POINT_ADJUST_APPROVE"
  | "POINT_ADJUST_REJECT"
  | "POINT_ADJUST_APPLY"
  /** 担当者（管理画面に入る人）の利用停止・解除。target は admin:… */
  | "USER_SUSPEND"

  /**
   * お客様（会員）の利用停止・解除。target は customer:…
   *
   * ★USER_SUSPEND と分けて残すこと。
   *   同じ名前にすると、「止められているお客様は何人か」を
   *   数えるたびに target の頭文字を見分ける必要が出ます。
   *   見分け方を知らない人が数えると、担当者まで会員として数えます。
   *
   *   止めることの意味も違います。
   *   担当者を止めても、その人が管理画面に入れなくなるだけです。
   *   お客様を止めると、その瞬間からガチャも発送依頼もできません。
   *   重さの違うものを、同じ名前で残さないでください。
   *
   * ★停止と解除は、同じ種類で残します。
   *   解除だけ別にすると、
   *   「止めたが解除されていない人」を数えるのが難しくなります。
   *   どちらなのかは before / after に残ります。
   */
  | "CUSTOMER_SUSPEND"
  | "FRAUD_REVIEW"
  | "FRAUD_BLOCK"
  | "SHIPPING_MARK"
  /**
   * お客様が、当たった景品について「発送」か「ポイント交換」かを選んだ記録。
   *
   * ★ポイント交換は、お金が動くのと同じ扱いにすること。
   *   交換した瞬間に残高が増えます。運営から見れば、
   *   ポイントを1件発行したのと変わりません。
   *   だから管理者の操作と同じ鎖に、同じ厳しさで残します。
   */
  | "PRIZE_SHIP_REQUEST"
  | "PRIZE_EXCHANGE"
  | "USER_ASK"
  | "SUPPORT_REPLY"

  /**
   * お客様の本人確認まわり。
   *
   * ★ログインと住所変更を、必ず残すこと。
   *   乗っ取りは、ほぼ必ずこの順で進みます。
   *     ①見慣れない端末からログイン ②送り先を書き換える ③高いものを発送させる
   *   ①と②が残っていないと、後から③だけを見ることになり、
   *   「なぜこの発送が起きたのか」を誰も説明できません。
   */
  | "CUSTOMER_LOGIN"
  | "CUSTOMER_STEP_UP"
  | "ADDRESS_UPDATE"
  | "SET_CUSTOMER_AUTH"

  /**
   * 止めた記録。
   *
   * ★「起きなかったこと」も残すこと。
   *   成功した操作だけを残すと、記録はいつもきれいなままです。
   *   きれいな記録は、攻撃されていない証明にはなりません。
   *   どこを何回叩かれ、何回止めたのかが分かって、はじめて
   *   「守れている」と言えます。
   */
  | "IDOR_BLOCKED"
  | "RBAC_DENIED"

  /**
   * 出ていった記録と、鍵まわりの記録。
   *
   * ★ログアウトも残すこと。
   *   「いつまで入っていたか」が分からないと、
   *   事故が起きた時刻に誰が中にいたのかを言えません。
   *
   * ★締め出し（ACCOUNT_LOCKED）は、攻撃を受けた証拠そのものです。
   *   何回試されて止めたのかが残ってはじめて「守れている」と言えます。
   *
   * ★二段階認証の入切は、必ず両方残すこと。
   *   乗っ取りは、まず「切る」ところから始まります。
   */
  | "LOGOUT"
  | "CUSTOMER_LOGOUT"
  | "CUSTOMER_SIGNUP"
  | "ACCOUNT_LOCKED"
  | "MFA_ENABLED"
  | "MFA_DISABLED"

  /**
   * 二段階認証の鍵を、捨てて作り直した記録（ローテーション）。
   *
   * ★なぜ MFA_ENABLED と分けて残すのか。
   *   「はじめて登録した」と「前の鍵を捨てて作り直した」は、別の出来事です。
   *   作り直したということは、その前の鍵が
   *   「もう信用できない状態になった」ということです。
   *   同じ名前で残すと、あとから読む人が、その一大事を読み落とします。
   *
   * ★理由（reason）を必ず入れること。
   *   知りたいのは「作り直した」ではなく「なぜ作り直したのか」です。
   *   漏れたのか、担当者が替わったのか、決まった期日が来たのか。
   *
   * ★鍵そのもの（secret）は、絶対に記録へ入れないこと。
   *   監査ログは、あとから多くの人が読みます。
   *   ここに鍵を残せば、作り直した意味がその場で消えます。
   *   残してよいのは「指紋」（鍵から計算した短い文字列）までです。
   *   指紋から鍵は戻せませんが、「同じ鍵かどうか」だけは確かめられます。
   */
  | "MFA_ROTATED"

  /**
   * パスワードまわり。
   *
   * ★仮パスワードの発行を、必ず残すこと。
   *   仮パスワードを発行するということは、その人のパスワードを
   *   こちらが知っている値に置き換えるということです。
   *   つまり、その人として入れます。
   *   これを残さない仕組みは、
   *   「誰にでも成りすませて、跡が残らない」のと同じです。
   *
   * ★発行した理由まで残すこと（reason）。
   *   あとから読み返す人が知りたいのは、
   *   「誰が発行したか」より「なぜ発行したか」です。
   *
   * ★変更そのものも残すこと。
   *   乗っ取られた側は、たいてい
   *   「勝手にパスワードが変わっていた」と言います。
   *   その時刻が残っていないと、確かめようがありません。
   */
  | "TEMP_PASSWORD_ISSUED"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET"

  | "ROLE_CHANGE"
  | "SETTINGS_CHANGE"
  | "DEMO_RESET"

  /**
   * 抽選（ガチャを1回引いた）。
   *
   * ★いちばんお金が動く操作を、鎖の外に置かないこと。
   *   これまで抽選だけが監査ログに入っていませんでした。
   *   ポイントの手動調整は残るのに、
   *   「そのポイントが何に使われ、何が出たか」は残らない状態です。
   *
   *   問い合わせが来たとき、答えられるのは
   *   「残高がこう動きました」までで、
   *   「その回は確かに1回だけ行われ、結果はこれでした」を示せません。
   *   後から結果を書き換えられても気づけません。
   *
   *   だから抽選も同じ鎖に入れます。項目が多いので data（JSON）に入れ、
   *   形式は v2 として扱います（下の canonical を参照）。
   */
  | "DRAW"

  /**
   * 注文（Order）と発送（Shipment）。
   *
   * ═══════════════════════════════════════════════════════
   * ★なぜ、ひとまとめにせず、種類を分けるのか
   * ═══════════════════════════════════════════════════════
   *
   *   後から揉めるのは、ほぼ必ず発送です。
   *   そして、揉め方は毎回ちがいます。
   *
   *       「頼んだ覚えがない」 → 注文がいつ立ったか（ORDER_CREATE）
   *       「まだ届かない」     → いつ箱に入れ、いつ出したか（SHIPMENT_CREATE / SHIPPED）
   *       「宛先が違う」       → 誰がいつ宛先を変えたか（ADDRESS_CHANGE）
   *
   *   1種類にまとめると、この3つを毎回ひとつの山から探すことになります。
   *   探せない記録は、残していないのとほとんど同じです。
   *
   * ★SHIPMENT_SPLIT を別にしている理由。
   *   1つの注文に2つ目の発送が立つ、というのは、
   *   ふつうの発送とは意味が違います。
   *   「まだ全部は送っていない」が、そこで確定します。
   *   在庫や返金の話になったとき、最初に見る行です。
   *
   * ★SHIPMENT_ADDRESS_CHANGE は、前と後の両方を残すこと。
   *   乗っ取りは「送り先を書き換える」で仕上がります。
   *   変えた事実だけでは、何がどう変わったのかを言えません。
   */
  | "ORDER_CREATE"
  | "ORDER_UPDATE"
  | "ORDER_CANCEL"
  | "SHIPMENT_CREATE"
  | "SHIPMENT_SPLIT"
  | "SHIPMENT_TRACKING_SET"
  | "SHIPMENT_SHIPPED"
  | "SHIPMENT_STATUS"
  | "SHIPMENT_ADDRESS_CHANGE"
  | "SHIPMENT_CANCEL"

  /**
   * お知らせを出した記録。
   *
   * ★「送ったつもり」を残さないこと。
   *   メールは、届いたかどうかをこちらから確かめられません。
   *   迷惑メールに入れば、お客様は永久に気づきません。
   *   そのときに「確かに出しました」と言えるのは、
   *   出した記録がある場合だけです。
   *
   *   いまは外の配信会社につないでいません（Mockです）。
   *   つないでいないことも、記録の中にそう書きます。
   *   「送信済み」とだけ書くと、読んだ人は本当に届いたと思います。
   */
  | "NOTIFICATION_CREATE";

export type AuditEntry = {
  /** 通し番号。1から始まる */
  seq: number;
  /** いつ（デモでは固定の文字列。実物では ISO8601 の時刻） */
  at: string;
  /** 誰が */
  actorId: string;
  actorName: string;
  actorRole: string;
  /** 何を */
  action: AuditAction;
  /** 対象（ユーザーID・ガチャIDなど） */
  target: string;
  /** 人が読むための一行 */
  summary: string;
  /** 変更前 → 変更後（金額やポイントなど、数字が動くときだけ） */
  before?: string;
  after?: string;
  /** なぜ（ポイント操作では必須にしている） */
  reason?: string;
  /**
   * 記録の形式。
   *
   * ★省略したものは v1。既に作られた鎖の計算方法を変えないための印です。
   *   v1 の計算方法を書き換えると、過去の記録が全部
   *   「改ざんされている」と判定されます。だから増やすときは、
   *   古い方を触らずに新しい版を足します。
   */
  version?: "v2";
  /**
   * 追加の項目（JSON文字列）。v2 でだけ使う。
   *
   * 抽選のように残す項目が多いものを、決まった欄に押し込まずに済ませるため。
   * ★ここも必ずハッシュの計算に入れること。
   *   入れ忘れると、この中身だけは後から自由に書き換えられます。
   */
  data?: string;
  /** 前の1件のハッシュ。1件目は GENESIS */
  prevHash: string;
  /** この1件のハッシュ */
  hash: string;
};

/** 鎖の始まり。1件目の prevHash に使う */
export const GENESIS = "0".repeat(64);

/**
 * 監査ログ1件を、ハッシュを計算するための1本の文字列にする。
 *
 * ★区切りに （Unit Separator）を使っている理由
 *   カンマや「|」で区切ると、中身にその文字が入ったときに境目がずれます。
 *   たとえば理由に「A|B」と書かれると、2つの項目に見えてしまい、
 *   別の内容なのに同じ文字列になる組み合わせを作れてしまいます。
 *   画面から入力できない制御文字を区切りに使うことで、それを防ぎます。
 */
function canonical(e: Omit<AuditEntry, "hash">): string {
  /* v2 … data 欄を含む形式。抽選のように項目が多い記録で使う。
     ★v1 の並びには一切触らないこと。触ると過去の鎖が全部壊れます。 */
  if (e.version === "v2") {
    return [
      "v2",
      e.seq,
      e.at,
      e.actorId,
      e.actorName,
      e.actorRole,
      e.action,
      e.target,
      e.summary,
      e.before ?? "",
      e.after ?? "",
      e.reason ?? "",
      e.data ?? "",
      e.prevHash,
    ].join("");
  }

  return [
    "v1",
    e.seq,
    e.at,
    e.actorId,
    e.actorName,
    e.actorRole,
    e.action,
    e.target,
    e.summary,
    e.before ?? "",
    e.after ?? "",
    e.reason ?? "",
    e.prevHash,
  ].join("");
}

/**
 * data 欄に入れる中身を、いつも同じ並びのJSONにする。
 *
 * ★キーの順番を必ず揃えること。
 *   JSON.stringify はオブジェクトに入れた順で書き出します。
 *   作る場所ごとに順番が違うと、中身が同じでもハッシュが変わり、
 *   「書き換えていないのに改ざん扱い」が起きます。
 */
export function canonicalData(v: Record<string, unknown>): string {
  const keys = Object.keys(v).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = v[k];
  return JSON.stringify(out);
}

/** 監査ログ1件分のハッシュを計算する */
export function hashEntry(e: Omit<AuditEntry, "hash">): string {
  return sha256(canonical(e));
}

/**
 * 監査ログに1件足す。
 *
 * 既存の配列は書き換えず、新しい配列を返します
 * （画面の状態を扱う reducer の中で使うため）。
 */
export function appendAudit(
  log: AuditEntry[],
  input: Omit<AuditEntry, "seq" | "prevHash" | "hash">,
): AuditEntry[] {
  const prev = log[log.length - 1];
  const base = {
    ...input,
    seq: prev ? prev.seq + 1 : 1,
    prevHash: prev ? prev.hash : GENESIS,
  };
  return [...log, { ...base, hash: hashEntry(base) }];
}

export type VerifyResult =
  | { ok: true; checked: number }
  | {
      ok: false;
      checked: number;
      /** 最初に食い違った件の通し番号 */
      brokenAt: number;
      /** なぜ食い違ったのか（人に見せる用） */
      why: "HASH_MISMATCH" | "CHAIN_BROKEN" | "SEQ_BROKEN";
      detail: string;
    };

/**
 * 監査ログ全体を検証する（AUDIT VERIFY）。
 *
 * 保存されているハッシュを信用せず、最初の1件から自分で計算し直して、
 * 保存されている値と一致するかを見ます。
 *
 * 見つけるもの:
 *   SEQ_BROKEN    … 通し番号が飛んでいる（1件まるごと消された）
 *   CHAIN_BROKEN  … 前の1件のハッシュとつながっていない（差し込まれた）
 *   HASH_MISMATCH … 中身が書き換えられている
 */
export function verifyAudit(log: AuditEntry[]): VerifyResult {
  let prevHash = GENESIS;

  for (let i = 0; i < log.length; i++) {
    const e = log[i];

    if (e.seq !== i + 1) {
      return {
        ok: false,
        checked: i,
        brokenAt: e.seq,
        why: "SEQ_BROKEN",
        detail: `${i + 1}件目にあるはずの記録が、${e.seq}番になっています。間の記録が抜けています。`,
      };
    }

    if (e.prevHash !== prevHash) {
      return {
        ok: false,
        checked: i,
        brokenAt: e.seq,
        why: "CHAIN_BROKEN",
        detail: `${e.seq}番の記録が、ひとつ前の記録につながっていません。記録が差し込まれたか、入れ替えられています。`,
      };
    }

    /* 保存されている hash を信じず、中身から計算し直す。
       hash を取り除くためだけの分解なので、_stored は使いません */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hash: _stored, ...rest } = e;
    const recomputed = hashEntry(rest);
    if (recomputed !== e.hash) {
      return {
        ok: false,
        checked: i,
        brokenAt: e.seq,
        why: "HASH_MISMATCH",
        detail: `${e.seq}番の記録（${e.summary}）の中身が、記録された当時から書き換えられています。`,
      };
    }

    prevHash = e.hash;
  }

  return { ok: true, checked: log.length };
}
