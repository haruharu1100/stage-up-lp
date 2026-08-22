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
  | "POINT_ADJUST_REQUEST"
  | "POINT_ADJUST_APPROVE"
  | "POINT_ADJUST_REJECT"
  | "POINT_ADJUST_APPLY"
  | "USER_SUSPEND"
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

  | "ROLE_CHANGE"
  | "SETTINGS_CHANGE"
  | "DEMO_RESET";

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
