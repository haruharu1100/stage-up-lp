/**
 * 本物の決済（契約後に使う側）。
 *
 * ═══════════════════════════════════════════════════════
 * ★いまの状態（正直に書いておきます）
 * ═══════════════════════════════════════════════════════
 *
 *   決済会社との契約は、まだありません。
 *   ですので、このファイルにあるのは
 *
 *     「設定がそろっているか」を調べる部分だけ
 *
 *   です。実際に決済画面を作る処理と、確定通知の署名を確かめる処理は、
 *   契約して仕様書をもらってから書きます。
 *
 *   ★推測で通信部分を書かないこと。
 *     決済会社ごとに、金額の単位も、確定通知の形も、署名の作り方も違います。
 *     推測で書いたものは「動いているように見えて実は照合していない」に
 *     なりやすく、それが二重課金と未入金の原因になります。
 *
 * ═══════════════════════════════════════════════════════
 * ★環境変数（まとめ）
 * ═══════════════════════════════════════════════════════
 *
 *   PAYMENT_PROVIDER        "mock"（既定） / "stripe" / "gmo"
 *
 *   stripe のとき
 *     STRIPE_SECRET_KEY     秘密鍵（sk_ で始まる）
 *     STRIPE_WEBHOOK_SECRET 確定通知の署名を確かめる鍵（whsec_ で始まる）
 *
 *   gmo のとき
 *     GMO_SHOP_ID           ショップID
 *     GMO_SHOP_PASSWORD     ショップパスワード
 *     GMO_WEBHOOK_SECRET    確定通知を確かめるための鍵
 *
 *   ★鍵の値を、このファイルに既定値として書かないこと。
 *     ソースはGitの履歴に永久に残ります。消しても残ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★確定通知の鍵を「必須」にしている理由
 * ═══════════════════════════════════════════════════════
 *
 *   ポイントを足すのは、決済会社から届く確定通知だけです。
 *   その通知が「本当に決済会社から来たのか」を確かめる鍵が無いと、
 *   通知の宛先URLさえ分かれば、誰でも偽の通知を送れます。
 *
 *   つまり、鍵が無い状態は「払っていないのにポイントが増える」入口です。
 *   ですので、鍵が無ければ本番の決済そのものを有効にしません。
 */

import {
  PAYMENT_CODES,
  type PaymentPreflight,
  type PaymentProviderImpl,
  type PaymentProviderName,
} from "./types";

const t = (v: unknown): string => String(v ?? "").trim();

export class RealPaymentProvider implements PaymentProviderImpl {
  readonly kind = "REAL" as const;

  constructor(readonly name: Exclude<PaymentProviderName, "mock">) {}

  preflight(env: NodeJS.ProcessEnv): PaymentPreflight {
    const missing: string[] = [];
    const invalid: string[] = [];

    if (this.name === "stripe") {
      const key = t(env.STRIPE_SECRET_KEY);
      const hook = t(env.STRIPE_WEBHOOK_SECRET);

      if (key === "") missing.push("STRIPE_SECRET_KEY");
      if (hook === "") missing.push("STRIPE_WEBHOOK_SECRET");

      /* ★「公開鍵を秘密鍵の欄に入れてしまった」は、実際によく起きます。
           そのままだと決済作成が毎回失敗し、原因が分からないまま
           「お客様だけが買えない」状態になります。 */
      if (key !== "" && key.startsWith("pk_")) {
        invalid.push(
          "STRIPE_SECRET_KEY に公開鍵（pk_）が入っています。秘密鍵（sk_）を入れてください",
        );
      }
      if (key !== "" && !key.startsWith("pk_") && !key.startsWith("sk_")) {
        invalid.push("STRIPE_SECRET_KEY が秘密鍵（sk_）の形ではありません");
      }
      if (hook !== "" && !hook.startsWith("whsec_")) {
        invalid.push(
          "STRIPE_WEBHOOK_SECRET が確定通知の鍵（whsec_）の形ではありません",
        );
      }
    } else {
      const shop = t(env.GMO_SHOP_ID);
      const pass = t(env.GMO_SHOP_PASSWORD);
      const hook = t(env.GMO_WEBHOOK_SECRET);

      if (shop === "") missing.push("GMO_SHOP_ID");
      if (pass === "") missing.push("GMO_SHOP_PASSWORD");
      if (hook === "") missing.push("GMO_WEBHOOK_SECRET");
    }

    if (missing.length > 0) {
      return {
        ok: false,
        provider: this.name,
        code: missing.some((m) => m.includes("WEBHOOK"))
          ? PAYMENT_CODES.WEBHOOK_SECRET_MISSING
          : PAYMENT_CODES.KEY_MISSING,
        message:
          `決済（${this.name}）の設定が足りません：${missing.join(" / ")}。` +
          "この状態では、ポイント購入を受け付けられません。",
        missing,
      };
    }

    if (invalid.length > 0) {
      return {
        ok: false,
        provider: this.name,
        code: PAYMENT_CODES.KEY_MISSING,
        message: `決済（${this.name}）の設定が正しくありません：${invalid.join(" / ")}。`,
        missing: [],
      };
    }

    return {
      ok: true,
      provider: this.name,
      note: `決済（${this.name}）の設定はそろっています。`,
    };
  }
}

/**
 * 本番で「テスト用の鍵」を使っていないか。
 *
 * ═══════════════════════════════════════════════════════
 * ★これを別にしている理由
 * ═══════════════════════════════════════════════════════
 *
 *   テスト用の鍵は、形としては正しい鍵です。ですので上の検査は通ります。
 *   ところが本番でこれを使うと、こうなります。
 *
 *     ・お客様のカードは、実際には1円も請求されない
 *     ・それでも決済は「成功」で返ってくる
 *     ・ポイントは増える
 *     ・売上は1円も入らない
 *
 *   画面上は完璧に動きます。気づくのは入金日です。
 *   ですので、本番のときだけ、別に見ます。
 *
 * @returns 問題があればその説明。無ければ null
 */
export function liveKeyProblem(
  name: PaymentProviderName,
  env: NodeJS.ProcessEnv,
): string | null {
  if (name !== "stripe") return null;
  const key = t(env.STRIPE_SECRET_KEY);
  if (key.startsWith("sk_test")) {
    return "本番なのに STRIPE_SECRET_KEY がテスト用の鍵（sk_test）です。この鍵では、お客様のカードから実際には1円も引き落とされません。";
  }
  return null;
}
