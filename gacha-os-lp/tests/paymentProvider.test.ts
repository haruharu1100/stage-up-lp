/**
 * 決済の送り口の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているたった1つのこと
 * ═══════════════════════════════════════════════════════
 *
 *   「練習用の決済のまま、本番を開ける」を、
 *   コードの上で起こせなくします。
 *
 *   ですので、いちばん大事なのは ③ と ⑦ です。
 *
 *     ③ 本番で練習用のままなら、決済業者の決定そのものが止まること
 *     ⑦ 鍵がそろっていても、本番の保存先でなければ止まること
 *
 *   ③が通らなくなったら、それは
 *   「本番の画面に『支払ったことにする』ボタンが出る」ということです。
 *   ⑦が通らなくなったら、それは
 *   「本当にお金を受け取るのに、記録はいつ消えてもおかしくない場所へ書く」
 *   ということです。
 *
 * ★この試験は、決済会社へ1回も通信しません。
 *   鍵はすべて偽物（test-not-real）です。
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  PAYMENT_CODES,
  PaymentNotConfiguredError,
  isProductionEnv,
  makePaymentProvider,
  paymentReadiness,
  productionDbState,
  resolvePaymentProvider,
  wantedPaymentProvider,
} from "../lib/server/payments";

/** 環境変数を、試験のあいだだけ差し替える */
const KEYS = [
  "DATABASE_ENV",
  "VERCEL_ENV",
  "DATABASE_URL",
  "ALLOW_PRODUCTION_DB",
  "PAYMENT_PROVIDER",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GMO_SHOP_ID",
  "GMO_SHOP_PASSWORD",
  "GMO_WEBHOOK_SECRET",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

function env(patch: Record<string, string | undefined>): NodeJS.ProcessEnv {
  /* ★process.env をそのまま使わないこと。
       手元の .env が混ざると、通ったり通らなかったりする試験になります。
       ここでは、まっさらな入れ物に、必要な分だけ入れます。 */
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) e[k] = v;
  }
  return e as NodeJS.ProcessEnv;
}

after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

/** 本番の保存先がそろっている状態（★本物のURLではありません） */
const PROD_DB = {
  DATABASE_ENV: "production",
  ALLOW_PRODUCTION_DB: "yes-i-am-sure",
  DATABASE_URL: "libsql://example-invalid.turso.io",
};

/** stripe の鍵一式（★本物の鍵ではありません） */
const STRIPE = {
  PAYMENT_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_not_a_real_key_for_tests",
  STRIPE_WEBHOOK_SECRET: "whsec_not_a_real_key_for_tests",
};

/** gmo の鍵一式（★本物の鍵ではありません） */
const GMO = {
  PAYMENT_PROVIDER: "gmo",
  GMO_SHOP_ID: "shop-not-real",
  GMO_SHOP_PASSWORD: "pass-not-real",
  GMO_WEBHOOK_SECRET: "hook-not-real",
};

describe("決済の送り口（Mock / Real の切り替え）", () => {
  it("①既定は練習用。本番でなければ、そのまま使える", () => {
    const e = env({ DATABASE_ENV: "test" });
    assert.equal(wantedPaymentProvider(e), "mock");

    const p = makePaymentProvider(e);
    assert.ok(p);
    assert.equal(p!.kind, "MOCK");

    const r = paymentReadiness(e);
    assert.equal(r.canCharge, true);
    assert.equal(r.blocking, false);
    assert.equal(resolvePaymentProvider(e), "mock");
  });

  it("②練習用は、本番の保存先の設定がそろっていても本番では使えない", () => {
    const e = env({ ...PROD_DB, PAYMENT_PROVIDER: "mock" });
    const r = paymentReadiness(e);
    assert.equal(r.blocking, true);
    assert.equal(r.code, PAYMENT_CODES.MOCK_IN_PRODUCTION);
  });

  it("★③本番で練習用のままなら、決済業者の決定そのものが止まる", () => {
    const e = env({ DATABASE_ENV: "production" });

    const r = paymentReadiness(e);
    assert.equal(r.production, true);
    assert.equal(r.kind, "MOCK");
    assert.equal(r.canCharge, false);
    assert.equal(
      r.blocking,
      true,
      "本番で練習用の決済なのに、公開を止めていません。",
    );
    assert.equal(r.code, PAYMENT_CODES.MOCK_IN_PRODUCTION);

    assert.throws(
      () => resolvePaymentProvider(e),
      (err: unknown) => {
        assert.ok(
          err instanceof PaymentNotConfiguredError,
          "本番で練習用のまま、例外にせず進みました。1円も払わずにポイントを作れる状態です。",
        );
        return true;
      },
    );
  });

  it("④VERCEL_ENV だけが production でも、同じように止まる", () => {
    const e = env({ DATABASE_ENV: "preview", VERCEL_ENV: "production" });
    assert.equal(isProductionEnv(e), true);
    assert.equal(paymentReadiness(e).blocking, true);
  });

  it("⑤APIの鍵が無ければ、本番でなくても止まる", () => {
    const e = env({ DATABASE_ENV: "development", PAYMENT_PROVIDER: "stripe" });
    const r = paymentReadiness(e);
    assert.equal(r.canCharge, false);
    assert.equal(r.blocking, true);
    assert.ok(r.missing.includes("STRIPE_SECRET_KEY"));
  });

  it("★⑥確定通知の鍵が無ければ、鍵があっても止まる", () => {
    const e = env({
      DATABASE_ENV: "development",
      PAYMENT_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_live_not_a_real_key_for_tests",
    });
    const r = paymentReadiness(e);
    assert.equal(
      r.canCharge,
      false,
      "確定通知の鍵が無いのに、決済を受け付けようとしています。偽の通知でポイントを作れます。",
    );
    assert.equal(r.code, PAYMENT_CODES.WEBHOOK_SECRET_MISSING);
    assert.ok(r.missing.includes("STRIPE_WEBHOOK_SECRET"));
  });

  it("★⑦鍵がそろっていても、本番の保存先でなければ止まる", () => {
    const e = env({ DATABASE_ENV: "production", ...STRIPE });
    const r = paymentReadiness(e);
    assert.equal(
      r.canCharge,
      false,
      "本番の保存先が無いのに、本物の決済を有効にしています。お金だけ受け取って記録が消えます。",
    );
    assert.equal(r.code, PAYMENT_CODES.DB_NOT_PRODUCTION);
    assert.ok(r.missing.includes("ALLOW_PRODUCTION_DB=yes-i-am-sure"));
  });

  it("⑧保存先が手元のファイルなら、本番の保存先とは認めない", () => {
    const e = env({
      DATABASE_ENV: "production",
      ALLOW_PRODUCTION_DB: "yes-i-am-sure",
      DATABASE_URL: "file:./data/local.db",
    });
    const s = productionDbState(e);
    assert.equal(s.connected, false);
    assert.ok(s.missing.some((m) => m.startsWith("DATABASE_URL")));
  });

  it("⑨本番でテスト用の鍵を使っていたら止まる（1円も引き落とされないため）", () => {
    const e = env({
      ...PROD_DB,
      ...STRIPE,
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key_for_tests",
    });
    const r = paymentReadiness(e);
    assert.equal(r.canCharge, false);
    assert.ok(
      r.message.includes("引き落とされ"),
      `理由の説明が曖昧です：${r.message}`,
    );
  });

  it("⑩公開鍵を秘密鍵の欄に入れていたら受け取らない", () => {
    const e = env({
      ...PROD_DB,
      ...STRIPE,
      STRIPE_SECRET_KEY: "pk_live_not_a_real_key_for_tests",
    });
    const r = paymentReadiness(e);
    assert.equal(r.canCharge, false);
  });

  it("⑪本番で鍵も保存先もそろっていれば、公開を止めない（stripe）", () => {
    const e = env({ ...PROD_DB, ...STRIPE });
    const r = paymentReadiness(e);
    assert.equal(r.kind, "REAL");
    assert.equal(r.canCharge, true);
    assert.equal(r.blocking, false);
    assert.equal(resolvePaymentProvider(e), "stripe");
  });

  it("⑫本番で鍵も保存先もそろっていれば、公開を止めない（gmo）", () => {
    const e = env({ ...PROD_DB, ...GMO });
    const r = paymentReadiness(e);
    assert.equal(r.canCharge, true);
    assert.equal(resolvePaymentProvider(e), "gmo");
  });

  it("⑬gmo も確定通知の鍵が無ければ止まる", () => {
    const e = env({ ...PROD_DB, ...GMO, GMO_WEBHOOK_SECRET: undefined });
    const r = paymentReadiness(e);
    assert.equal(r.canCharge, false);
    assert.equal(r.code, PAYMENT_CODES.WEBHOOK_SECRET_MISSING);
  });

  it("⑭知らない名前は、本番でなくても止まる（打ち間違いに気づくため）", () => {
    const e = env({ DATABASE_ENV: "development", PAYMENT_PROVIDER: "paypay" });
    const r = paymentReadiness(e);
    assert.equal(r.blocking, true);
    assert.equal(r.code, PAYMENT_CODES.UNKNOWN);
    assert.equal(makePaymentProvider(e), null);
  });

  it("★⑮止まるときに、練習用へ戻していない", () => {
    /* ★これが、このファイル全体をむだにする1行の見張りです。
         「だめなら mock で動かしておく」を書いた瞬間に、ここが落ちます。 */
    for (const e of [
      env({ DATABASE_ENV: "production" }),
      env({ DATABASE_ENV: "production", ...STRIPE }),
      env({ DATABASE_ENV: "development", PAYMENT_PROVIDER: "stripe" }),
      env({ DATABASE_ENV: "development", PAYMENT_PROVIDER: "paypay" }),
    ]) {
      let returned: string | null = null;
      try {
        returned = resolvePaymentProvider(e);
      } catch {
        /* 止まったなら正しい */
      }
      assert.notEqual(
        returned,
        "mock",
        "使えない状態なのに、練習用の決済へ戻しています。本番で1円も払わずにポイントを作れます。",
      );
    }
  });
});

describe("これまでの呼び出し口（pointPurchase）が、そのまま動く", () => {
  it("⑯paymentProvider() は、これまでどおりの符号で断る", async () => {
    const { PurchaseError, paymentProvider } = await import(
      "../lib/server/pointPurchase"
    );

    const savedEnv = { ...process.env };
    try {
      process.env.DATABASE_ENV = "production";
      delete process.env.PAYMENT_PROVIDER;
      delete process.env.VERCEL_ENV;

      assert.throws(
        () => paymentProvider(),
        (e: unknown) => {
          assert.ok(e instanceof PurchaseError);
          /* ★画面のHTTP状態の対応表が知っている符号であること。
               知らない符号だと、画面は「500」としか出せません。 */
          assert.equal((e as { code: string }).code, "PROVIDER_NOT_CONFIGURED");
          return true;
        },
      );

      process.env.PAYMENT_PROVIDER = "paypay";
      assert.throws(
        () => paymentProvider(),
        (e: unknown) => {
          assert.equal((e as { code: string }).code, "PROVIDER_UNKNOWN");
          return true;
        },
      );
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, savedEnv);
    }
  });
});
